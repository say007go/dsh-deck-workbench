import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { servePreviewPng, servePreviewPptx, serveProjectFile } from './preview.js'
import { createHistoryWatcher } from './history.js'
import { readSettings, readSettingsSync, writeSettings, writeSettingsSync } from './settings.js'
import { registerBundledSkills } from './bundled-skills.js'
import { getReferenceJob, isReferenceJobRunning, startReferenceBuild, validateReference } from './reference-build.js'

export const name = 'deck-workbench'

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))


const PREFIX = '/deck-workbench'
const SETTINGS_FILE = join(homedir(), '.dsh', 'storages', 'deck-workbench', 'settings.json')
const REFERENCE_FILE = join(homedir(), '.dsh', 'storages', 'deck-workbench', 'reference.json')

function readReferenceRoot() {
  try {
    const data = JSON.parse(readFileSync(REFERENCE_FILE, 'utf8'))
    return typeof data?.root === 'string' ? data.root.trim() : ''
  } catch {
    return ''
  }
}

function referenceStatus(settingRoot, projectRoot) {
  const configured = String(settingRoot || '').trim() || readReferenceRoot()
  const source = String(settingRoot || '').trim() ? 'settings' : configured ? 'reference.json' : 'auto'
  const root = resolve(configured || join(projectRoot || '.', '_reference'))
  const pagesDir = join(root, 'assets', 'pages')
  const indexPath = join(root, 'references', 'index.jsonl')
  let pages = 0
  let manifestPages = null
  let builtAt = ''
  let sourceSha = ''
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
    const declared = manifest?.page_count ?? manifest?.pageCount
    if (Number.isInteger(declared) && declared > 0) manifestPages = declared
    builtAt = String(manifest?.createdAt || manifest?.created_at || '')
    sourceSha = String(manifest?.sourceSha256 || manifest?.source_sha256 || '')
  } catch {
    // manifest is optional for status
  }
  try {
    if (existsSync(pagesDir)) pages = readdirSync(pagesDir).filter((name) => /\.webp$/i.test(name)).length
  } catch {
    pages = 0
  }
  if (manifestPages) pages = manifestPages
  const ok = existsSync(pagesDir) && existsSync(indexPath) && pages > 0
  return {
    root,
    source,
    ok,
    pages,
    builtAt,
    sourceSha,
    pagesDir: existsSync(pagesDir),
    index: existsSync(indexPath),
    error: ok ? null : '参考库不可用：需要 assets/pages 和 references/index.jsonl，且至少有一页',
  }
}

function writeReferenceRoot(root) {
  const payload = { schemaVersion: 1, root, updatedAt: new Date().toISOString() }
  mkdirSync(dirname(REFERENCE_FILE), { recursive: true })
  writeFileSync(REFERENCE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
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
      sendJson(res, 200, {
        ok: true,
        reference: referenceStatus(stored.referenceRoot, projectsRoot),
        job: getReferenceJob(),
      })
      return
    }

    if (sub === '/api/reference/validate' && req.method === 'POST') {
      if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const current = referenceStatus(stored.referenceRoot, projectsRoot)
      if (!current.ok) throw new HttpError(400, current.error || '参考库不可用')
      const report = await validateReference(current.root, PLUGIN_ROOT)
      sendJson(res, 200, { ok: report?.ok === true, report, reference: current })
      return
    }

    if (sub === '/api/reference/upload' && req.method === 'POST') {
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const rawName = decode(req.headers['x-filename'] || 'reference.pptx')
      const filename = basename(String(rawName).replace(/\\/g, '/'))
      if (!/\.pptx$/i.test(filename)) throw new HttpError(400, '只支持 .pptx 参考文件')
      const body = await readBody(req, 200 * 1024 * 1024)
      if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) {
        throw new HttpError(400, '文件不是有效的 PPTX（缺少 ZIP 头）')
      }
      const uploads = join(dirname(REFERENCE_FILE), 'uploads')
      mkdirSync(uploads, { recursive: true })
      const temp = join(uploads, `reference-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pptx`)
      writeFileSync(temp, body)
      const explicit = String(stored.referenceRoot || '').trim()
      const target = resolve(explicit || join(projectsRoot, '_reference'))
      try {
        const job = startReferenceBuild({
          pptxPath: temp,
          outRoot: target,
          title: filename.replace(/\.pptx$/i, ''),
          pluginRoot: PLUGIN_ROOT,
          referenceFile: REFERENCE_FILE,
          cleanupPath: temp,
        })
        sendJson(res, 202, { ok: true, job, target })
      } catch (error) {
        try { rmSync(temp, { force: true }) } catch {}
        if (error?.code === 'REFERENCE_BUSY') throw new HttpError(409, error.message)
        throw error
      }
      return
    }

    if (sub === '/api/reference/rebuild' && req.method === 'POST') {
      if (isReferenceJobRunning()) throw new HttpError(409, '参考库正在构建，请等待完成')
      const stored = await readSettings(settingsFile, root)
      const projectsRoot = stored.projectsRoot || root
      const current = referenceStatus(stored.referenceRoot, projectsRoot)
      const source = join(current.root, 'assets', 'reference.pptx')
      if (!existsSync(source)) throw new HttpError(400, `当前参考库没有源文件：${source}`)
      const uploads = join(dirname(REFERENCE_FILE), 'uploads')
      mkdirSync(uploads, { recursive: true })
      const temp = join(uploads, `rebuild-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pptx`)
      copyFileSync(source, temp)
      const oldIndex = join(current.root, 'references', 'index.jsonl')
      let reuseAnnotations = ''
      if (existsSync(oldIndex)) {
        reuseAnnotations = join(uploads, `rebuild-annotations-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`)
        copyFileSync(oldIndex, reuseAnnotations)
      }
      try {
        const job = startReferenceBuild({
          pptxPath: temp,
          outRoot: current.root,
          title: basename(current.root),
          pluginRoot: PLUGIN_ROOT,
          referenceFile: REFERENCE_FILE,
          cleanupPath: temp,
          reuseAnnotations,
        })
        sendJson(res, 202, { ok: true, job, target: current.root })
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

    if (sub === '/api/settings') {
      if (req.method === 'GET') {
        const stored = await readSettings(settingsFile, root)
        const projectsRoot = stored.projectsRoot || root
        const reference = referenceStatus(stored.referenceRoot, projectsRoot || root)
        const detected = imagegenCapability(ctx, getTools?.())
        sendJson(res, 200, {
          ok: true,
          settings: { ...stored, projectsRoot },
          root,
          restartRequired: resolve(projectsRoot) !== resolve(root),
          reference,
          imagegen: detected,
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
        let referenceRoot = current.referenceRoot
        if (body.referenceRoot !== undefined) {
          const requested = String(body.referenceRoot || '').trim()
          if (requested) {
            if (!isAbsolute(requested)) throw new HttpError(400, '参考库目录必须是绝对路径')
            referenceRoot = resolve(requested)
            if (!existsSync(referenceRoot)) throw new HttpError(400, '参考库目录不存在')
          } else {
            referenceRoot = ''
          }
        }
        let referenceWriteError = null
        let saved
        try {
          saved = await writeSettings(settingsFile, { ...current, ...body, projectsRoot, referenceRoot }, root)
          if (saved.referenceRoot) {
            writeReferenceRoot(saved.referenceRoot)
          } else {
            const auto = referenceStatus('', saved.projectsRoot || root)
            if (auto.source === 'auto') writeReferenceRoot(auto.root)
          }
        } catch (error) {
          referenceWriteError = String(error?.message || error)
          saved = await readSettings(settingsFile, root)
        }
        const reference = referenceStatus(saved.referenceRoot, saved.projectsRoot || root)
        const detected = imagegenCapability(ctx, getTools?.())
        sendJson(res, 200, {
          ok: true,
          settings: saved,
          root,
          restartRequired: resolve(saved.projectsRoot) !== resolve(root),
          reference,
          imagegen: detected,
          referenceWriteError,
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

export { referenceStatus, imagegenCapability }
