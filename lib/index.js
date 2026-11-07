import { existsSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HttpError,
  decode,
  readBody,
  readJson,
  sameOrigin,
  sendError,
  sendJson,
} from './http.js'
import {
  approvePage,
  createProject,
  importInput,
  deleteProject,
  listHistory,
  listProjects,
  loadProject,
  readHistoryVersion,
  readPage,
  restorePage,
  updateProject,
} from './projects.js'
import {
  ensurePreviewPdf,
  findPptx,
  openInSystem,
  servePreviewPng,
  servePreviewPptx,
  serveProjectFile,
} from './preview.js'
import { createHistoryWatcher } from './history.js'
import { DEFAULTS, readSettings, readSettingsSync, writeSettings, writeSettingsSync } from './settings.js'
import { registerBundledSkills } from './bundled-skills.js'
import {
  activateLibrary,
  createLibrary,
  ensureRegistry,
  getReferenceState,
  removeLibrary,
  renameLibrary,
  resolveReferencesRoot,
} from './references.js'
import { getReferenceJob, isReferenceJobRunning, startReferenceBuild, validateReference } from './reference-build.js'

export const name = 'deck-workbench'

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))


const PREFIX = '/deck-workbench'
const STORAGE_DIR = join(homedir(), '.dsh', 'storages', 'deck-workbench')
const SETTINGS_FILE = join(STORAGE_DIR, 'settings.json')
const REFERENCE_FILE = join(STORAGE_DIR, 'reference.json')
const REFERENCES_FILE = join(STORAGE_DIR, 'references.json')

function referenceState(settings, projectsRoot) {
  return getReferenceState({ registryFile: REFERENCES_FILE, settings, projectsRoot })
}

function imagegenCapability(ctx, tools = null) {
  try {
    const registry = tools?.tools || tools || ctx?.tools || (typeof ctx?.get === 'function' ? ctx.get('tools') : null)
    if (!registry || typeof registry.get !== 'function') {
      return { available: null, detected: 'unknown', source: 'registry-unavailable', detail: '无法读取工具注册表' }
    }
    const tool = registry.get('image_generate')
    return tool
      ? { available: true, detected: 'available', source: 'tool-registry', detail: 'image_generate 已注册' }
      : { available: false, detected: 'missing', source: 'tool-registry', detail: 'image_generate 未注册' }
  } catch (error) {
    return { available: null, detected: 'unknown', source: 'registry-error', detail: String(error?.message || error) }
  }
}

export function apply(ctx, config = {}) {
  const configuredRoot = config?.projectsRoot ? resolve(config.projectsRoot) : ''

  let settings = readSettingsSync(SETTINGS_FILE, configuredRoot)
  if (!existsSync(SETTINGS_FILE)) {
    try {
      const legacyFile = configuredRoot ? join(configuredRoot, 'settings.json') : null
      if (legacyFile && existsSync(legacyFile)) {
        const legacy = readSettingsSync(legacyFile, configuredRoot)
        settings = { ...legacy, projectsRoot: legacy.projectsRoot || configuredRoot }
      }
    } catch {
      // keep defaults
    }
    try {
      writeSettingsSync(SETTINGS_FILE, settings, configuredRoot)
    } catch {
      // settings persistence is best-effort at boot
    }
  }

  let root = settings.projectsRoot ? resolve(settings.projectsRoot) : configuredRoot
  if (!root) {
    root = resolve(join(homedir(), 'DeckWorkbench', 'projects'))
    settings = { ...settings, projectsRoot: root }
    try {
      writeSettingsSync(SETTINGS_FILE, settings, root)
    } catch {
      // best-effort
    }
  }
  try {
    mkdirSync(root, { recursive: true })
  } catch {
    const fallback = configuredRoot || resolve(join(homedir(), 'DeckWorkbench', 'projects'))
    if (fallback === root) throw new Error('项目根目录不可用')
    root = fallback
    mkdirSync(root, { recursive: true })
  }

  const referencesRoot = resolveReferencesRoot(settings, root)
  settings = { ...settings, referencesRoot }
  try {
    writeSettingsSync(SETTINGS_FILE, settings, root)
    ensureRegistry({
      registryFile: REFERENCES_FILE,
      pointerFile: REFERENCE_FILE,
      referencesRoot,
      projectsRoot: root,
      legacyRoot: String(settings.referenceRoot || '').trim(),
    })
  } catch (error) {
    ctx.logger?.warn?.(`deck-workbench reference registry: ${error?.message || error}`)
  }

  const watcher = createHistoryWatcher({
    root,
    intervalMs: Number(config?.scanIntervalMs) || 2000,
    maxVersions: Number(config?.maxVersionsPerPage) || 50,
  })
  watcher.start()
  ctx.effect(() => () => watcher.stop(), 'deck-workbench history')

  let toolsRef = null
  ctx.inject(['tools'], (injected) => { toolsRef = injected?.tools || injected })

  let skillsRef = null
  ctx.inject(['skills'], (injected) => {
    skillsRef = injected?.skills || injected
    registerBundledSkills(ctx, skillsRef)
  })

  ctx.inject(['webServer'], (host) => {
    const dispose = host.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => handle(req, res, root, SETTINGS_FILE, configuredRoot, ctx, () => toolsRef, () => skillsRef),
    })
    ctx.effect(() => () => dispose(), 'deck-workbench routes')
  })
}

function skillNameIsSafe(name) {
  return /^[a-z0-9][a-z0-9-]*$/.test(String(name || ''))
}

function fileSkillAvailable(name, cwd) {
  if (!skillNameIsSafe(name)) return false
  const roots = []
  let current = resolve(cwd || '.')
  for (let depth = 0; depth < 12; depth += 1) {
    roots.push(join(current, '.dsh', 'skills'), join(current, '.agents', 'skills'))
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  roots.push(join(homedir(), '.dsh', 'skills'), join(homedir(), '.agents', 'skills'))
  return roots.some((root) => existsSync(join(root, name, 'SKILL.md')))
}

async function handle(req, res, root, settingsFile, configuredRoot, ctx, getTools, getSkills) {
  try {
    const url = new URL(req.url || '/', 'http://deck-workbench.local')
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
      throw new HttpError(404, 'Not found')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { allow: 'GET, POST, DELETE, OPTIONS' })
      res.end()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
      throw new HttpError(403, '跨站请求被拒绝')
    }
    const sub = url.pathname.slice(PREFIX.length) || '/'
    if (sub === '/' || sub === '') throw new HttpError(404, 'Not found')

    if (sub === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, name: 'deck-workbench', root })
      return
    }

    if (sub === '/api/skills/available' && req.method === 'GET') {
      const name = String(url.searchParams.get('name') || '').trim()
      const cwd = String(url.searchParams.get('cwd') || root).trim() || root
      if (!name) throw new HttpError(400, 'name required')
      const skills = getSkills?.()
      let available = false
      let reason = ''
      if (skills && typeof skills.list === 'function') {
        try {
          const list = await skills.list({ cwd })
          available = list.some((skill) => skill.name === name)
        } catch (error) {
          reason = String(error?.message || error)
        }
      } else {
        reason = 'skill registry unavailable'
      }
      if (!available && fileSkillAvailable(name, cwd)) {
        available = true
        reason = 'filesystem skill'
      }
      sendJson(res, 200, { ok: true, name, cwd, available, ...(reason ? { reason } : {}) })
      return
    }

    if (sub === '/api/reference/job' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, job: getReferenceJob() })
      return
    }

    if (sub === '/api/reference/status' && req.method === 'GET') {
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const state = referenceState(stored, projectsRoot)
      sendJson(res, 200, {
        ok: true,
        reference: state.reference,
        libraries: state.libraries,
        activeId: state.activeId,
        referencesRoot: state.referencesRoot,
        job: getReferenceJob(),
      })
      return
    }

    if (sub === '/api/reference/activate' && req.method === 'POST') {
      if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
      const body = await readJson(req)
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const state = referenceState(stored, projectsRoot)
      const id = String(body.id || '').trim()
      if (!id) throw new HttpError(400, '缺少参考库 id')
      activateLibrary({ registryFile: REFERENCES_FILE, pointerFile: REFERENCE_FILE, id })
      const next = referenceState(stored, projectsRoot)
      sendJson(res, 200, { ok: true, reference: next.reference, libraries: next.libraries, activeId: next.activeId, referencesRoot: next.referencesRoot })
      return
    }

    if (sub === '/api/reference/validate' && req.method === 'POST') {
      if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
      const body = await readJson(req)
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const state = referenceState(stored, projectsRoot)
      const requested = String(body.id || '').trim()
      const library = requested ? state.libraries.find((item) => item.id === requested) : state.active
      if (!library) throw new HttpError(400, '未选择参考库')
      if (!library.ok) throw new HttpError(400, library.error || '参考库不可用')
      const report = await validateReference(library.root, PLUGIN_ROOT)
      sendJson(res, 200, { ok: report?.ok === true, report, reference: library })
      return
    }

    if (sub === '/api/reference/upload' && req.method === 'POST') {
      if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const state = referenceState(stored, projectsRoot)
      const rawName = decode(req.headers['x-filename'] || 'reference.pptx')
      const filename = basename(String(rawName).split(String.fromCharCode(92)).join('/'))
      if (!/\.pptx$/i.test(filename)) throw new HttpError(400, '只支持 .pptx 参考文件')
      const rawLibraryName = decode(req.headers['x-library-name'] || '')
      const libraryName = rawLibraryName.trim() || filename.replace(/\.pptx$/i, '')
      const body = await readBody(req, 200 * 1024 * 1024)
      if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) {
        throw new HttpError(400, '文件不是有效的 PPTX（缺少 ZIP 头）')
      }
      const uploads = join(STORAGE_DIR, 'uploads')
      mkdirSync(uploads, { recursive: true })
      const temp = join(uploads, `reference-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pptx`)
      writeFileSync(temp, body)
      const { library } = createLibrary({ registryFile: REFERENCES_FILE, referencesRoot: state.referencesRoot, name: libraryName })
      try {
        const job = startReferenceBuild({
          pptxPath: temp,
          outRoot: library.root,
          title: library.name,
          pluginRoot: PLUGIN_ROOT,
          libraryId: library.id,
          cleanupPath: temp,
        })
        sendJson(res, 202, { ok: true, job, library, target: library.root })
      } catch (error) {
        try { rmSync(temp, { force: true }) } catch {}
        try { removeLibrary({ registryFile: REFERENCES_FILE, referencesRoot: state.referencesRoot, id: library.id }) } catch {}
        if (error?.code === 'REFERENCE_BUSY') throw new HttpError(409, error.message)
        throw error
      }
      return
    }

    if (sub === '/api/reference/rebuild' && req.method === 'POST') {
      if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
      const body = await readJson(req)
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const state = referenceState(stored, projectsRoot)
      const requested = String(body.id || '').trim()
      const library = requested ? state.libraries.find((item) => item.id === requested) : state.active
      if (!library) throw new HttpError(400, '未选择参考库')
      const source = join(library.root, 'assets', 'reference.pptx')
      if (!existsSync(source)) throw new HttpError(400, `当前参考库没有源文件：${source}`)
      const uploads = join(STORAGE_DIR, 'uploads')
      mkdirSync(uploads, { recursive: true })
      const temp = join(uploads, `rebuild-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pptx`)
      copyFileSync(source, temp)
      const oldIndex = join(library.root, 'references', 'index.jsonl')
      let reuseAnnotations = ''
      if (existsSync(oldIndex)) {
        reuseAnnotations = join(uploads, `rebuild-annotations-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`)
        copyFileSync(oldIndex, reuseAnnotations)
      }
      try {
        const job = startReferenceBuild({
          pptxPath: temp,
          outRoot: library.root,
          title: library.name,
          pluginRoot: PLUGIN_ROOT,
          libraryId: library.id,
          cleanupPath: temp,
          reuseAnnotations,
        })
        sendJson(res, 202, { ok: true, job, library, target: library.root })
      } catch (error) {
        try { rmSync(temp, { force: true }) } catch {}
        if (reuseAnnotations) {
          try { rmSync(reuseAnnotations, { force: true }) } catch {}
        }
        if (error?.code === 'REFERENCE_BUSY') throw new HttpError(409, error.message)
        throw error
      }
      return
    }

    const libraryRoute = /^\/api\/reference\/libraries\/([^/]+)$/.exec(sub)
    if (libraryRoute) {
      const id = decode(libraryRoute[1])
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const state = referenceState(stored, projectsRoot)
      if (req.method === 'PATCH') {
        if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
        const body = await readJson(req)
        if (!String(body.name || '').trim()) throw new HttpError(400, '参考库名称不能为空')
        renameLibrary({
          registryFile: REFERENCES_FILE,
          pointerFile: REFERENCE_FILE,
          referencesRoot: state.referencesRoot,
          id,
          name: body.name,
        })
        const next = referenceState(stored, projectsRoot)
        sendJson(res, 200, { ok: true, reference: next.reference, libraries: next.libraries, activeId: next.activeId, referencesRoot: next.referencesRoot })
        return
      }
      if (req.method === 'DELETE') {
        if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
        removeLibrary({ registryFile: REFERENCES_FILE, referencesRoot: state.referencesRoot, id })
        const next = referenceState(stored, projectsRoot)
        sendJson(res, 200, { ok: true, reference: next.reference, libraries: next.libraries, activeId: next.activeId, referencesRoot: next.referencesRoot })
        return
      }
      throw new HttpError(405, 'Method not allowed')
    }

    if (sub === '/api/settings') {
      if (req.method === 'GET') {
        const stored = await readSettings(settingsFile, root)
        const projectsRoot = stored.projectsRoot || root
        const state = referenceState(stored, projectsRoot || root)
        const detected = imagegenCapability(ctx, getTools?.())
        sendJson(res, 200, {
          ok: true,
          settings: { ...stored, projectsRoot, referencesRoot: state.referencesRoot },
          root,
          restartRequired: resolve(projectsRoot) !== resolve(root),
          reference: state.reference,
          libraries: state.libraries,
          activeId: state.activeId,
          referencesRoot: state.referencesRoot,
          imagegen: detected,
          defaults: DEFAULTS,
        })
        return
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const current = await readSettings(settingsFile, root)
        let projectsRoot = current.projectsRoot || root
        if (body.projectsRoot !== undefined) {
          const requested = String(body.projectsRoot || '').trim()
          if (!requested) throw new HttpError(400, '项目根目录不能为空')
          if (!isAbsolute(requested)) throw new HttpError(400, '项目根目录必须是绝对路径')
          projectsRoot = resolve(requested)
          try {
            mkdirSync(projectsRoot, { recursive: true })
          } catch {
            throw new HttpError(400, '项目根目录不可用')
          }
        }
        let referencesRoot = resolveReferencesRoot({}, projectsRoot)
        if (body.referencesRoot !== undefined) {
          const requested = String(body.referencesRoot || '').trim()
          if (requested) {
            if (!isAbsolute(requested)) throw new HttpError(400, '参考库根目录必须是绝对路径')
            referencesRoot = resolve(requested)
          } else {
            referencesRoot = resolveReferencesRoot({}, projectsRoot)
          }
        }
        try {
          mkdirSync(referencesRoot, { recursive: true })
        } catch {
          throw new HttpError(400, '参考库根目录不可用')
        }
        const saved = await writeSettings(settingsFile, {
          ...current,
          ...body,
          projectsRoot,
          referencesRoot,
          referenceRoot: '',
        }, root)
        try {
          ensureRegistry({
            registryFile: REFERENCES_FILE,
            pointerFile: REFERENCE_FILE,
            referencesRoot,
            projectsRoot: saved.projectsRoot || root,
            legacyRoot: String(current.referenceRoot || '').trim(),
          })
        } catch (error) {
          throw new HttpError(400, `参考库注册表初始化失败：${error?.message || error}`)
        }
        const state = referenceState(saved, saved.projectsRoot || root)
        const detected = imagegenCapability(ctx, getTools?.())
        sendJson(res, 200, {
          ok: true,
          settings: { ...saved, projectsRoot: saved.projectsRoot || root, referencesRoot: state.referencesRoot },
          root,
          restartRequired: resolve(saved.projectsRoot) !== resolve(root),
          reference: state.reference,
          libraries: state.libraries,
          activeId: state.activeId,
          referencesRoot: state.referencesRoot,
          imagegen: detected,
          defaults: DEFAULTS,
        })
        return
      }
      throw new HttpError(405, 'Method not allowed')
    }

    if (sub === '/api/projects') {
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, projects: await listProjects(root) })
        return
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const project = await createProject(root, body)
        sendJson(res, 201, { ok: true, project })
        return
      }
      throw new HttpError(405, 'Method not allowed')
    }

    const parts = sub.split('/').filter(Boolean).map(decode)

    if (parts[0] === 'files' && req.method === 'GET') {
      if (parts.length < 3) throw new HttpError(400, '文件路径缺失')
      await serveProjectFile(root, parts[1], parts.slice(2).join('/'), res)
      return
    }

    if (parts[0] !== 'api' || parts[1] !== 'projects') throw new HttpError(404, 'Not found')
    const projectId = parts[2]
    if (!projectId) throw new HttpError(400, '项目 ID 缺失')

    if (parts.length === 3 && req.method === 'GET') {
      sendJson(res, 200, { ok: true, project: await loadProject(root, projectId) })
      return
    }

    if (parts.length === 3 && req.method === 'DELETE') {
      await deleteProject(root, projectId)
      sendJson(res, 200, { ok: true, deleted: projectId })
      return
    }

    if (parts[3] === 'inputs' && parts.length === 4 && req.method === 'POST') {
      const raw = await readBody(req, 25 * 1024 * 1024)
      const filename = decode(req.headers['x-filename'] || 'input.txt')
      const saved = await importInput(root, projectId, filename, raw)
      sendJson(res, 201, { ok: true, file: saved })
      return
    }

    if (parts[3] === 'session' && parts.length === 4 && req.method === 'POST') {
      const body = await readJson(req)
      const patch = {}
      if ('sessionId' in body) patch.contentSessionId = typeof body.sessionId === 'string' ? body.sessionId : null
      if ('workspaceId' in body) patch.workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : null
      await updateProject(root, projectId, patch)
      sendJson(res, 200, { ok: true, ...patch })
      return
    }

    if (parts[3] === 'pages' && parts[4]) {
      const pageId = parts[4]
      if (parts.length === 5 && req.method === 'GET') {
        sendJson(res, 200, { ok: true, page: await readPage(root, projectId, pageId) })
        return
      }
      if (parts[5] === 'history' && req.method === 'GET') {
        if (parts.length === 6) {
          sendJson(res, 200, { ok: true, history: await listHistory(root, projectId, pageId) })
          return
        }
        const version = Number(parts[6])
        if (!Number.isFinite(version)) throw new HttpError(400, '版本号无效')
        sendJson(res, 200, { ok: true, version: await readHistoryVersion(root, projectId, pageId, version) })
        return
      }
      if (parts[5] === 'approve' && parts.length === 6 && req.method === 'POST') {
        const body = await readJson(req)
        const version = Number(body.version)
        if (!Number.isFinite(version)) throw new HttpError(400, '版本号无效')
        sendJson(res, 200, { ok: true, ...(await approvePage(root, projectId, pageId, version)) })
        return
      }
      if (parts[5] === 'restore' && parts.length === 6 && req.method === 'POST') {
        const body = await readJson(req)
        const version = Number(body.version)
        if (!Number.isFinite(version)) throw new HttpError(400, '版本号无效')
        sendJson(res, 200, { ok: true, ...(await restorePage(root, projectId, pageId, version)) })
        return
      }
      if (parts[5] === 'preview' && parts.length === 6 && req.method === 'GET') {
        const target = url.searchParams.get('target') || 'pptx'
        if (target !== 'pptx') throw new HttpError(400, '仅支持 pptx 预览')
        const format = url.searchParams.get('format') || 'pdf'
        if (format === 'image' || format === 'png') {
          await servePreviewPng(root, projectId, pageId, res)
        } else {
          await servePreviewPptx(root, projectId, pageId, res)
        }
        return
      }
      if (parts[5] === 'open' && parts.length === 6 && req.method === 'POST') {
        const target = url.searchParams.get('target') || 'pptx'
        if (target === 'pdf') {
          const { pdf } = await ensurePreviewPdf(root, projectId, pageId)
          sendJson(res, 200, { ok: true, opened: 'pdf', path: openInSystem(pdf) })
          return
        }
        if (target !== 'pptx') throw new HttpError(400, '仅支持 PPTX 与 PDF')
        const pptx = await findPptx(root, projectId, pageId)
        if (!pptx) throw new HttpError(404, '没有找到 PPTX 产物')
        sendJson(res, 200, { ok: true, opened: 'pptx', path: openInSystem(pptx.path) })
        return
      }
    }

    throw new HttpError(404, 'Not found')
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error)
      return
    }
    const status = error instanceof HttpError ? error.status : 500
    if (status >= 500) console.warn('[deck-workbench] request failed:', error)
    sendError(res, status, error?.message || 'request failed')
  }
}

export { imagegenCapability }
