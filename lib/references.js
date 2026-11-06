import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { HttpError } from './http.js'
import { inside } from './projects.js'

export const DEFAULT_LIBRARY_NAME = '参考库'
const REGISTRY_SCHEMA = 1
const POINTER_SCHEMA = 1
const INVALID_NAME = /[\u0000-\u001f<>:"/\\|?*]/g
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function nowIso() {
  return new Date().toISOString()
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function pathExists(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function libraryId(registry) {
  const used = new Set((registry?.libraries || []).map((item) => item.id))
  let id
  do {
    id = `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  } while (used.has(id))
  return id
}

export function sanitizeLibraryName(value) {
  let name = String(value ?? '').normalize('NFC').trim()
  name = name.replace(INVALID_NAME, '-').replace(/[. ]+$/g, '').trim()
  if (!name || name === '.' || name === '..') name = DEFAULT_LIBRARY_NAME
  if (RESERVED_NAME.test(name)) name = `${name}-库`
  if (name.length > 80) {
    name = name.slice(0, 80).replace(/[. ]+$/g, '')
    if (!name) name = DEFAULT_LIBRARY_NAME
  }
  return name
}

export function defaultReferencesRoot(projectsRoot) {
  const root = resolve(projectsRoot || '.')
  return resolve(dirname(root), 'references')
}

export function resolveReferencesRoot(settings, projectsRoot) {
  const explicit = String(settings?.referencesRoot || '').trim()
  return explicit ? resolve(explicit) : defaultReferencesRoot(projectsRoot)
}

export function readRegistry(file) {
  const data = readJson(file, null)
  const libraries = Array.isArray(data?.libraries)
    ? data.libraries
      .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.root === 'string')
      .map((item) => ({
        id: item.id,
        name: item.name,
        root: resolve(item.root),
        createdAt: String(item.createdAt || ''),
        updatedAt: String(item.updatedAt || ''),
      }))
    : []
  return {
    schemaVersion: REGISTRY_SCHEMA,
    activeId: libraries.some((item) => item.id === data?.activeId) ? data.activeId : null,
    libraries,
  }
}

export function writeRegistry(file, registry) {
  writeJson(file, {
    schemaVersion: REGISTRY_SCHEMA,
    activeId: registry.activeId || null,
    libraries: registry.libraries || [],
  })
}

export function readPointer(file) {
  const data = readJson(file, null)
  return data && typeof data.root === 'string' ? data : null
}

export function writePointer(file, library) {
  if (!library?.root) {
    rmSync(file, { force: true })
    return
  }
  writeJson(file, {
    schemaVersion: POINTER_SCHEMA,
    activeId: library.id || null,
    root: resolve(library.root),
    updatedAt: nowIso(),
  })
}

export function libraryStatus(root) {
  const dir = String(root || '').trim() ? resolve(root) : ''
  const pagesDir = dir ? join(dir, 'assets', 'pages') : ''
  const indexPath = dir ? join(dir, 'references', 'index.jsonl') : ''
  let pages = 0
  let manifestPages = null
  let builtAt = ''
  let sourceSha = ''
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    const declared = manifest?.page_count ?? manifest?.pageCount
    if (Number.isInteger(declared) && declared > 0) manifestPages = declared
    builtAt = String(manifest?.createdAt || manifest?.created_at || '')
    sourceSha = String(manifest?.sourceSha256 || manifest?.source_sha256 || '')
  } catch {
    // manifest is optional for status
  }
  try {
    if (pagesDir && existsSync(pagesDir)) {
      pages = readdirSync(pagesDir).filter((name) => /\.webp$/i.test(name)).length
    }
  } catch {
    pages = 0
  }
  if (manifestPages) pages = manifestPages
  const pagesDirOk = !!pagesDir && existsSync(pagesDir)
  const indexOk = !!indexPath && existsSync(indexPath)
  const ok = !!dir && pagesDirOk && indexOk && pages > 0
  return {
    root: dir,
    ok,
    pages,
    builtAt,
    sourceSha,
    pagesDir: pagesDirOk,
    index: indexOk,
    error: ok ? null : (dir ? '参考库不可用：需要 assets/pages 和 references/index.jsonl，且至少有一页' : '未选择参考库'),
  }
}

function uniqueLibraryName(referencesRoot, name, registry, exceptId = '') {
  const used = new Set((registry.libraries || [])
    .filter((item) => item.id !== exceptId)
    .map((item) => item.name.toLowerCase()))
  const base = sanitizeLibraryName(name)
  let candidate = base
  let index = 2
  while (used.has(candidate.toLowerCase()) || pathExists(join(referencesRoot, candidate))) {
    const suffix = `-${index++}`
    candidate = `${base.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`
  }
  return candidate
}

function writeLibraryMetadata(library) {
  if (!library?.root || !pathExists(library.root)) return
  writeJson(join(library.root, 'library.json'), {
    schemaVersion: 1,
    id: library.id,
    name: library.name,
    createdAt: library.createdAt || nowIso(),
    updatedAt: nowIso(),
  })
}

export function getReferenceState({ registryFile, settings, projectsRoot }) {
  const refsRoot = resolveReferencesRoot(settings, projectsRoot)
  const registry = readRegistry(registryFile)
  const active = registry.libraries.find((item) => item.id === registry.activeId) || null
  const libraries = registry.libraries.map((library) => ({
    ...library,
    ...libraryStatus(library.root),
    active: !!active && library.id === active.id,
  }))
  libraries.sort((a, b) => Number(b.active) - Number(a.active) || String(a.name).localeCompare(String(b.name), 'zh-CN'))
  return {
    registry,
    referencesRoot: refsRoot,
    activeId: active?.id || null,
    active,
    libraries,
    reference: active
      ? { ...active, ...libraryStatus(active.root), active: true }
      : { root: '', ok: false, pages: 0, builtAt: '', sourceSha: '', pagesDir: false, index: false, error: '未选择参考库' },
  }
}

export function createLibrary({ registryFile, referencesRoot, name }) {
  const registry = readRegistry(registryFile)
  const clean = uniqueLibraryName(referencesRoot, name, registry)
  const library = {
    id: libraryId(registry),
    name: clean,
    root: join(resolve(referencesRoot), clean),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  registry.libraries.push(library)
  writeRegistry(registryFile, registry)
  return { library, registry }
}

export function activateLibrary({ registryFile, pointerFile, id }) {
  const registry = readRegistry(registryFile)
  const library = registry.libraries.find((item) => item.id === id)
  if (!library) throw new HttpError(404, '参考库不存在')
  const status = libraryStatus(library.root)
  if (!status.ok) throw new HttpError(400, status.error || '参考库不可用')
  const previous = registry.activeId
  registry.activeId = library.id
  writeRegistry(registryFile, registry)
  try {
    writePointer(pointerFile, library)
  } catch (error) {
    registry.activeId = previous || null
    try { writeRegistry(registryFile, registry) } catch {}
    throw error
  }
  // Metadata is a browsing convenience; a failure here must not desync the active pointer.
  try { writeLibraryMetadata(library) } catch {}
  return library
}

export function renameLibrary({ registryFile, pointerFile, referencesRoot, id, name }) {
  const registry = readRegistry(registryFile)
  const library = registry.libraries.find((item) => item.id === id)
  if (!library) throw new HttpError(404, '参考库不存在')
  if (!inside(referencesRoot, library.root)) throw new HttpError(400, '旧路径参考库不能自动重命名')
  if (!pathExists(library.root)) throw new HttpError(404, '参考库目录不存在')
  const clean = uniqueLibraryName(referencesRoot, name, registry, id)
  if (clean === library.name) return library
  const target = join(resolve(referencesRoot), clean)
  try {
    renameSync(library.root, target)
  } catch (error) {
    throw new HttpError(400, `参考库重命名失败：${error?.message || error}`)
  }
  const previous = { ...library }
  const previousActive = registry.activeId
  const previousIndex = registry.libraries.findIndex((item) => item.id === id)
  library.name = clean
  library.root = target
  library.updatedAt = nowIso()
  try {
    if (registry.activeId === library.id) writePointer(pointerFile, library)
    writeRegistry(registryFile, registry)
    try { writeLibraryMetadata(library) } catch {}
    return library
  } catch (error) {
    if (registry.activeId === library.id) {
      try { writePointer(pointerFile, previous) } catch {}
    }
    if (previousIndex >= 0) registry.libraries[previousIndex] = previous
    registry.activeId = previousActive
    try { writeRegistry(registryFile, registry) } catch {}
    try { renameSync(target, previous.root) } catch {}
    throw error
  }
}

export function removeLibrary({ registryFile, referencesRoot, id }) {
  const registry = readRegistry(registryFile)
  const library = registry.libraries.find((item) => item.id === id)
  if (!library) throw new HttpError(404, '参考库不存在')
  if (registry.activeId === id) throw new HttpError(409, '当前参考库不能删除，请先切换到其他库')
  if (resolve(library.root) === resolve(referencesRoot)) throw new HttpError(400, '不能删除参考库根目录')
  if (!inside(referencesRoot, library.root)) throw new HttpError(400, '旧路径参考库不能从这里删除')
  if (pathExists(library.root)) rmSync(library.root, { recursive: true, force: true })
  registry.libraries = registry.libraries.filter((item) => item.id !== id)
  writeRegistry(registryFile, registry)
  return library
}

export function ensureRegistry({ registryFile, pointerFile, referencesRoot, projectsRoot, legacyRoot = '' }) {
  let registry = readRegistry(registryFile)
  if (registry.libraries.length) {
    if (!registry.activeId) {
      registry.activeId = registry.libraries[0].id
      writeRegistry(registryFile, registry)
    }
    const active = registry.libraries.find((item) => item.id === registry.activeId)
    if (active) {
      writePointer(pointerFile, active)
      writeLibraryMetadata(active)
    }
    return registry
  }

  const oldDefault = join(resolve(projectsRoot), '_reference')
  const pointer = readPointer(pointerFile)
  const candidates = [pointer?.root, legacyRoot, oldDefault]
  let source = ''
  for (const candidate of candidates) {
    if (candidate && pathExists(candidate) && statSync(candidate).isDirectory()) {
      source = resolve(candidate)
      break
    }
  }

  if (!source) {
    writeRegistry(registryFile, { activeId: null, libraries: [] })
    rmSync(pointerFile, { force: true })
    return registry
  }

  mkdirSync(resolve(referencesRoot), { recursive: true })
  let name = basename(source)
  let root = source
  let legacyPath = false
  if (resolve(source) === resolve(oldDefault)) {
    const targetName = uniqueLibraryName(referencesRoot, DEFAULT_LIBRARY_NAME, registry)
    const target = join(resolve(referencesRoot), targetName)
    try {
      renameSync(source, target)
      root = target
      name = targetName
    } catch {
      legacyPath = true
      name = name === '_reference' ? DEFAULT_LIBRARY_NAME : name
    }
  } else if (!inside(referencesRoot, source)) {
    legacyPath = true
  }

  const library = {
    id: libraryId(registry),
    name: sanitizeLibraryName(name),
    root,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...(legacyPath ? { legacy: true } : {}),
  }
  registry.libraries.push(library)
  registry.activeId = library.id
  writeRegistry(registryFile, registry)
  writePointer(pointerFile, library)
  writeLibraryMetadata(library)
  return registry
}
