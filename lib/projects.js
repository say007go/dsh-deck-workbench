import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { HttpError } from './http.js'

export const TARGETS = ['pptx', 'image', 'html']
export const PAGE_RE = /^P(\d{2,})\.md$/i
export const HISTORY_RE = /^v(\d+)-([a-f0-9]{8,16})\.md$/i
export const INPUT_EXTS = new Set(['.docx', '.pdf', '.txt', '.md', '.pptx'])
export const FILE_EXTS = new Set([
  '.html', '.css', '.js', '.json', '.md', '.txt',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.pdf', '.pptx', '.woff', '.woff2', '.ttf',
])

const now = () => new Date().toISOString()

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return out
}
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)

export function normalizeTargets(value) {
  const input = Array.isArray(value) ? value : TARGETS
  const picked = [...new Set(input.filter((item) => TARGETS.includes(item)))]
  return picked.length ? picked : [...TARGETS]
}

export function slugify(value) {
  const ascii = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return ascii || 'project'
}

export function assertProjectId(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id ?? ''))) {
    throw new HttpError(400, '项目 ID 无效')
  }
  return String(id)
}

export function assertPageId(pageId) {
  if (!/^P\d{2,}$/i.test(String(pageId ?? ''))) {
    throw new HttpError(400, '页面 ID 无效')
  }
  return String(pageId)
}

export function inside(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  // rel 是相对路径；勿对它再 resolve()，否则会相对 cwd 变成绝对路径，
  // 导致合法子目录也被误判为「项目路径越界」。
  // 用 isAbsolute(rel) 同时挡住 POSIX 根路径与 Windows 盘符/UNC 绝对路径。
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function projectDir(root, id) {
  const safe = assertProjectId(id)
  const dir = resolve(root, safe)
  if (!inside(root, dir)) throw new HttpError(400, '项目路径越界')
  return dir
}

export function pagePath(root, id, pageId) {
  const safe = assertPageId(pageId)
  return join(projectDir(root, id), 'content', 'pages', `${safe}.md`)
}

export function workbenchStatePath(root, id) {
  return join(projectDir(root, id), 'workbench', 'pages.json')
}

export function hashText(text) {
  return hash(text)
}

export function titleFromCopy(text) {
  const line = String(text ?? '').split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? '未命名页面'
  return line.replace(/^#+\s*/, '').slice(0, 100)
}

export async function ensureRoot(root) {
  await mkdir(root, { recursive: true })
}

export async function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonFile(file, value) {
  await mkdir(resolve(file, '..'), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function writeJsonAtomic(file, value) {
  await mkdir(resolve(file, '..'), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(tmp, file)
  } catch {
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rm(tmp, { force: true })
  }
}

export async function readWorkbenchState(root, id) {
  const state = await readJsonFile(workbenchStatePath(root, id), null)
  if (state && typeof state === 'object' && state.pages && typeof state.pages === 'object') return state
  return { schemaVersion: 1, pages: {} }
}

export async function writeWorkbenchState(root, id, state) {
  await writeJsonAtomic(workbenchStatePath(root, id), state)
}

export async function readProjectJson(root, id) {
  return readJsonFile(join(projectDir(root, id), 'project.json'), null)
}

export async function listPageIds(root, id) {
  const dir = join(projectDir(root, id), 'content', 'pages')
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && PAGE_RE.test(entry.name))
    .map((entry) => entry.name.replace(/\.md$/i, ''))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
}

export async function listProjectIds(root) {
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const projectFile = join(root, entry.name, 'project.json')
    const pagesDir = join(root, entry.name, 'content', 'pages')
    try {
      await stat(projectFile)
      out.push(entry.name)
    } catch {
      try {
        const pages = await readdir(pagesDir)
        if (pages.some((name) => PAGE_RE.test(name))) out.push(entry.name)
      } catch {
        // not a project
      }
    }
  }
  return out
}

export async function listHistory(root, id, pageId, options = {}) {
  const withStats = options.stats !== false
  const safe = assertPageId(pageId)
  const dir = join(projectDir(root, id), 'content', 'history', safe)
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const versions = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = HISTORY_RE.exec(entry.name)
    if (!match) continue
    if (!withStats) {
      versions.push({ version: Number(match[1]), hash: match[2], file: entry.name })
      continue
    }
    const file = join(dir, entry.name)
    const info = await stat(file)
    versions.push({
      version: Number(match[1]),
      hash: match[2],
      file: entry.name,
      size: info.size,
      mtimeMs: info.mtimeMs,
    })
  }
  return versions.sort((a, b) => a.version - b.version)
}

export async function readHistoryVersion(root, id, pageId, version) {
  const versions = await listHistory(root, id, pageId)
  const hit = versions.find((item) => item.version === Number(version))
  if (!hit) throw new HttpError(404, '版本不存在')
  const text = await readFile(join(projectDir(root, id), 'content', 'history', assertPageId(pageId), hit.file), 'utf8')
  return { ...hit, text }
}

export async function readHistoryFile(root, id, pageId, version) {
  const hit = await readHistoryVersion(root, id, pageId, version)
  return hit
}

export async function writeHistoryVersion(root, id, pageId, text) {
  const safe = assertPageId(pageId)
  const dir = join(projectDir(root, id), 'content', 'history', safe)
  await mkdir(dir, { recursive: true })
  const versions = await listHistory(root, id, safe)
  const contentHash = hash(text)
  const latest = versions.at(-1)
  if (latest && latest.hash === contentHash) return latest
  const version = (versions.at(-1)?.version ?? 0) + 1
  const file = join(dir, `v${String(version).padStart(3, '0')}-${contentHash}.md`)
  await writeFile(file, text, { encoding: 'utf8', flag: 'wx' }).catch(async (error) => {
    if (error?.code !== 'EEXIST') throw error
  })
  const info = await stat(file)
  return { version, hash: contentHash, file: basename(file), size: info.size, mtimeMs: info.mtimeMs }
}

// 列表 / 轮询 / 打开页面都会反复问同一批页面，而读全文 + 算 hash 是其中唯一的重活。
// 这里只做一件事：stamp（mtime + size）没变就不再读盘。写页面会改 stamp，所以不会读到旧内容。
const META_CACHE_LIMIT = 512
const metaCache = new Map()

export async function readPageMeta(root, id, pageId) {
  const file = pagePath(root, id, pageId)
  let info
  try {
    info = await stat(file)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, '页面不存在')
    throw error
  }
  const cached = metaCache.get(file)
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached
  const text = await readFile(file, 'utf8')
  const entry = {
    hash: hash(text),
    mtimeMs: info.mtimeMs,
    size: info.size,
    title: titleFromCopy(text),
  }
  if (metaCache.size >= META_CACHE_LIMIT) metaCache.clear()
  metaCache.set(file, entry)
  return entry
}

export async function readPageCopy(root, id, pageId) {
  const meta = await readPageMeta(root, id, pageId)
  const text = await readFile(pagePath(root, id, pageId), 'utf8')
  return { text, hash: meta.hash, mtimeMs: meta.mtimeMs, size: meta.size }
}

export async function renderListing(root, id) {
  const dir = join(projectDir(root, id), 'renders')
  const names = async (sub) => {
    try {
      return new Set(await readdir(join(dir, sub)))
    } catch {
      return new Set()
    }
  }
  const [html, image, pptx] = await Promise.all([names('html'), names('image'), names('pptx')])
  return { html, image, pptx }
}

export async function scanRenders(root, id, pageId, copyMtimeMs, listing = null) {
  const dir = join(projectDir(root, id), 'renders')
  const result = {}

  const html = join(dir, 'html', `${assertPageId(pageId)}.html`)
  result.html = listing && !listing.html.has(`${assertPageId(pageId)}.html`)
    ? { status: 'missing', target: 'html' }
    : await renderEntry(html, root, id, copyMtimeMs, 'html')

  const imageDir = join(dir, 'image')
  const imageExts = ['.png', '.jpg', '.jpeg', '.webp']
  let image = null
  for (const ext of imageExts) {
    if (listing && !listing.image.has(`${assertPageId(pageId)}${ext}`)) continue
    const candidate = join(imageDir, `${assertPageId(pageId)}${ext}`)
    const entry = await renderEntry(candidate, root, id, copyMtimeMs, 'image')
    if (entry.status !== 'missing') { image = entry; break }
  }
  result.image = image ?? { status: 'missing', target: 'image' }

  const pagePptx = join(dir, 'pptx', `${assertPageId(pageId)}.pptx`)
  const pageEntry = listing && !listing.pptx.has(`${assertPageId(pageId)}.pptx`)
    ? { status: 'missing', target: 'pptx' }
    : await renderEntry(pagePptx, root, id, copyMtimeMs, 'pptx')
  if (pageEntry.status !== 'missing') {
    result.pptx = pageEntry
  } else if (listing && !listing.pptx.has('deck.pptx')) {
    result.pptx = { status: 'missing', target: 'pptx' }
  } else {
    const deck = join(dir, 'pptx', 'deck.pptx')
    const deckEntry = await renderEntry(deck, root, id, copyMtimeMs, 'pptx')
    result.pptx = deckEntry.status === 'missing'
      ? { status: 'missing', target: 'pptx' }
      : { ...deckEntry, status: 'deck', deck: true }
  }
  return result
}

async function renderEntry(file, root, id, copyMtimeMs, target) {
  try {
    const info = await stat(file)
    if (!info.isFile()) return { status: 'missing', target }
    const rel = relative(projectDir(root, id), file).split(sep).join('/')
    const stale = Number(copyMtimeMs) > 0 && info.mtimeMs < Number(copyMtimeMs)
    return {
      status: stale ? 'stale' : 'done',
      target,
      path: rel,
      name: basename(file),
      size: info.size,
      mtimeMs: info.mtimeMs,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing', target }
    throw error
  }
}

function blueprintMap(blueprint) {
  const map = new Map()
  if (Array.isArray(blueprint?.pages)) {
    for (const page of blueprint.pages) {
      if (page && typeof page.id === 'string') map.set(page.id, page)
    }
  }
  return map
}

export async function pageSummary(root, id, pageId, options = {}) {
  const state = options.state ?? await readWorkbenchState(root, id)
  const blueprint = options.blueprint ?? await readJsonFile(join(projectDir(root, id), 'content', 'blueprint.json'), null)
  const pageCopy = options.copy ?? await readPageMeta(root, id, pageId)
  const history = options.history ?? await listHistory(root, id, pageId, { stats: false })
  const statePage = state.pages?.[pageId] ?? {}
  const blueprintPage = blueprintMap(blueprint).get(pageId) ?? {}
  const title = blueprintPage.title || (pageCopy.text ? titleFromCopy(pageCopy.text) : pageCopy.title)
  const currentVersion = Number(statePage.currentVersion ?? history.at(-1)?.version ?? 0)
  const currentHash = statePage.currentHash || pageCopy.hash
  const approvedVersion = Number(statePage.approvedVersion ?? 0) || null
  const approvedHash = typeof statePage.approvedHash === 'string' ? statePage.approvedHash : ''
  // 批准是“当前文案是否等于已确认内容”的派生判断，不落库：改稿自动回到草稿，
  // 恢复到已确认的那版内容会自动重新算作已确认。
  const copyStatus = approvedHash
    ? (approvedHash === currentHash ? 'approved' : 'draft')
    : (approvedVersion && approvedVersion === currentVersion ? 'approved' : 'draft')
  const renders = await scanRenders(root, id, pageId, pageCopy.mtimeMs, options.listing ?? null)
  const mtimes = [pageCopy.mtimeMs, ...Object.values(renders).map((r) => r.mtimeMs || 0)]
  return {
    id: pageId,
    title,
    order: Number(blueprintPage.order ?? pageId.slice(1)) || 0,
    copyStatus,
    currentVersion,
    currentHash,
    approvedVersion,
    copyMtimeMs: pageCopy.mtimeMs,
    updatedAt: new Date(Math.max(...mtimes)).toISOString(),
    historyCount: history.length,
    renders,
  }
}

export async function readPage(root, id, pageId) {
  const copy = await readPageCopy(root, id, pageId)
  const history = await listHistory(root, id, pageId)
  const summary = await pageSummary(root, id, pageId, { copy, history })
  return { ...summary, copy: copy.text, history }
}

export async function loadProject(root, id) {
  const dir = projectDir(root, id)
  const project = await readJsonFile(join(dir, 'project.json'), null)
  if (!project && !(await listPageIds(root, id)).length) throw new HttpError(404, '项目不存在')
  const base = project && typeof project === 'object' ? project : {}
  const state = await readWorkbenchState(root, id)
  const blueprint = await readJsonFile(join(dir, 'content', 'blueprint.json'), null)
  const pageIds = await listPageIds(root, id)
  const listing = await renderListing(root, id)
  const pages = await mapLimit(pageIds, 8, (pageId) => pageSummary(root, id, pageId, { state, blueprint, listing }))
  pages.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const renderCounts = { html: 0, image: 0, pptx: 0 }
  for (const page of pages) {
    for (const target of TARGETS) {
      if (page.renders[target]?.status && page.renders[target].status !== 'missing') {
        renderCounts[target] += 1
      }
    }
  }
  const updatedAt = [base.updatedAt, ...pages.map((page) => page.updatedAt)]
    .filter(Boolean)
    .sort()
    .at(-1) ?? now()
  return {
    id,
    title: base.title || id,
    client: base.client || '',
    phase: base.phase || 'content',
    targets: normalizeTargets(base.targets),
    contentSessionId: base.contentSessionId || null,
    workspaceId: base.workspaceId || null,
    createdAt: base.createdAt || updatedAt,
    updatedAt,
    path: dir,
    pageCount: pages.length,
    copyApproved: pages.filter((page) => page.copyStatus === 'approved').length,
    renders: renderCounts,
    pages,
  }
}

export async function listProjects(root) {
  const ids = await listProjectIds(root)
  const projects = []
  for (const id of ids) {
    try {
      const project = await loadProject(root, id)
      projects.push({
        id: project.id,
        title: project.title,
        client: project.client,
        phase: project.phase,
        pageCount: project.pageCount,
        copyApproved: project.copyApproved,
        renders: project.renders,
        updatedAt: project.updatedAt,
      })
    } catch {
      // skip invalid project directories
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createProject(root, input = {}) {
  const title = String(input.title ?? '').trim() || '未命名项目'
  const client = String(input.client ?? '').trim()
  const brief = String(input.brief ?? '')
  const targets = normalizeTargets(input.targets)
  const base = slugify(client || title)
  let id = `${base}-${Date.now().toString(36)}`
  let attempt = 1
  while (true) {
    try {
      await stat(projectDir(root, id))
      id = `${base}-${Date.now().toString(36)}-${attempt++}`
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      break
    }
  }
  const dir = projectDir(root, id)
  await mkdir(join(dir, 'content', 'pages'), { recursive: true })
  await mkdir(join(dir, 'content', 'input'), { recursive: true })
  await mkdir(join(dir, 'content', 'history'), { recursive: true })
  await mkdir(join(dir, 'renders', 'html'), { recursive: true })
  await mkdir(join(dir, 'renders', 'image'), { recursive: true })
  await mkdir(join(dir, 'renders', 'pptx'), { recursive: true })
  await mkdir(join(dir, 'workbench', '.preview'), { recursive: true })
  const timestamp = now()
  const project = {
    schemaVersion: 1,
    id,
    title,
    client,
    phase: 'content',
    targets,
    contentSessionId: null,
    workspaceId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await writeJsonFile(join(dir, 'project.json'), project)
  await writeFile(join(dir, 'content', 'brief.md'), `# ${title}\n\n${brief}\n`, 'utf8')
  await writeJsonFile(join(dir, 'workbench', 'pages.json'), { schemaVersion: 1, pages: {} })
  return loadProject(root, id)
}

export async function updateProject(root, id, patch) {
  const file = join(projectDir(root, id), 'project.json')
  const project = await readJsonFile(file, null)
  if (!project) throw new HttpError(404, '项目不存在')
  const next = { ...project, ...patch, updatedAt: now() }
  await writeJsonFile(file, next)
  return next
}

export async function importInput(root, id, filename, bytes) {
  const safe = basename(String(filename ?? 'input.txt')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 160) || 'input.txt'
  const ext = extname(safe).toLowerCase()
  if (!INPUT_EXTS.has(ext)) throw new HttpError(400, `不支持的文件类型：${ext || '无扩展名'}`)
  const dir = join(projectDir(root, id), 'content', 'input')
  await mkdir(dir, { recursive: true })
  let target = join(dir, safe)
  let suffix = 1
  while (true) {
    try {
      await stat(target)
      target = join(dir, `${basename(safe, ext)}-${suffix++}${ext}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      break
    }
  }
  await writeFile(target, bytes)
  return { name: basename(target), size: bytes.length }
}

export async function approvePage(root, id, pageId, version) {
  const hit = await readHistoryVersion(root, id, pageId, version)
  const state = await readWorkbenchState(root, id)
  const previous = state.pages?.[pageId] ?? {}
  state.pages[pageId] = {
    ...previous,
    approvedVersion: hit.version,
    approvedHash: hit.hash,
    updatedAt: now(),
  }
  await writeWorkbenchState(root, id, state)
  return { pageId, approvedVersion: hit.version, approvedHash: hit.hash }
}

export async function restorePage(root, id, pageId, version) {
  const hit = await readHistoryVersion(root, id, pageId, version)
  const target = pagePath(root, id, pageId)
  await writeFile(target, hit.text, 'utf8')
  await updateProject(root, id, { updatedAt: now() })
  return { pageId, restoredVersion: hit.version }
}

export async function deleteProject(root, id) {
  const dir = projectDir(root, id)
  if (resolve(dir) === resolve(root)) throw new HttpError(400, '不能删除项目根目录')
  let info
  try {
    info = await stat(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, '项目不存在')
    throw error
  }
  if (!info.isDirectory()) throw new HttpError(404, '项目不存在')
  await rm(dir, { recursive: true, force: true })
  return { id, deleted: true }
}

export async function resolveProjectFile(root, id, rel) {
  const raw = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!raw || raw.includes('\0')) throw new HttpError(400, '文件路径无效')
  const dir = projectDir(root, id)
  const candidate = resolve(dir, raw)
  if (!inside(dir, candidate)) throw new HttpError(403, '文件路径越界')
  try {
    const real = await realpath(candidate)
    const realRoot = await realpath(dir)
    if (!inside(realRoot, real)) throw new HttpError(403, '文件路径越界')
    const info = await stat(real)
    if (!info.isFile()) throw new HttpError(404, '文件不存在')
    const ext = extname(real).toLowerCase()
    if (!FILE_EXTS.has(ext)) throw new HttpError(403, '不支持的文件类型')
    return { path: real, size: info.size, mtimeMs: info.mtimeMs }
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error?.code === 'ENOENT') throw new HttpError(404, '文件不存在')
    throw error
  }
}

export function pageFileRel(pageId) {
  assertPageId(pageId)
  return `content/pages/${pageId}.md`
}

export async function writePageCopy(root, id, pageId, text) {
  const target = pagePath(root, id, pageId)
  await writeFile(target, text, 'utf8')
  await updateProject(root, id, { updatedAt: now() })
}
