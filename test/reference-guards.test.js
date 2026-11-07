import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  activateLibrary,
  createLibrary,
  ensureRegistry,
  getReferenceState,
  libraryStatus,
  readPointer,
  readRegistry,
  removeLibrary,
  renameLibrary,
  sanitizeLibraryName,
  writeRegistry,
} from '../lib/references.js'

// 这些用例专门盯“出错时会不会把用户已有的库弄坏”：指针写失败要回滚注册表，
// 目录改名之后失败要把目录搬回去，删除要拒绝一切危险目标。

function makeLibrary(root, pages = 1) {
  mkdirSync(join(root, 'assets', 'pages'), { recursive: true })
  mkdirSync(join(root, 'references'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ pageCount: pages, createdAt: '2026-01-01T00:00:00Z' }))
  writeFileSync(join(root, 'references', 'index.jsonl'), '')
  for (let i = 1; i <= pages; i += 1) {
    writeFileSync(join(root, 'assets', 'pages', `P${String(i).padStart(2, '0')}.webp`), 'x')
  }
}

function makePaths() {
  const base = mkdtempSync(join(tmpdir(), 'deck-reference-guards-'))
  const projectsRoot = join(base, 'projects')
  const referencesRoot = join(base, 'references')
  const registryFile = join(base, 'state', 'references.json')
  const pointerFile = join(base, 'state', 'reference.json')
  mkdirSync(projectsRoot, { recursive: true })
  return { base, projectsRoot, referencesRoot, registryFile, pointerFile }
}

// 把指针写到一个“父级是文件”的路径上，writeJson 的 mkdir 必然失败。
function blockedPointer(base, name = 'blocked.json') {
  const blocker = join(base, name)
  writeFileSync(blocker, 'x')
  return join(blocker, 'reference.json')
}

test('activating a library rolls the registry back when the pointer cannot be written', () => {
  const p = makePaths()
  try {
    const first = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '红库' }).library
    makeLibrary(first.root, 1)
    activateLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, id: first.id })

    const second = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '蓝库' }).library
    makeLibrary(second.root, 1)

    assert.throws(() =>
      activateLibrary({ registryFile: p.registryFile, pointerFile: blockedPointer(p.base), id: second.id }))

    const registry = readRegistry(p.registryFile)
    assert.equal(registry.activeId, first.id, '激活失败后 activeId 必须还是原来那个')
    assert.equal(readPointer(p.pointerFile).root, first.root, '旧指针不能被改掉')
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('renaming rolls the directory back when the pointer cannot be written', () => {
  const p = makePaths()
  try {
    const library = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '旧名字' }).library
    makeLibrary(library.root, 1)
    activateLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, id: library.id })
    const originalRoot = library.root

    assert.throws(() =>
      renameLibrary({
        registryFile: p.registryFile,
        pointerFile: blockedPointer(p.base, 'blocked-rename.json'),
        referencesRoot: p.referencesRoot,
        id: library.id,
        name: '新名字',
      }))

    assert.equal(existsSync(originalRoot), true, '失败后目录必须搬回原名')
    assert.equal(existsSync(join(p.referencesRoot, '新名字')), false)
    const registry = readRegistry(p.registryFile)
    assert.equal(registry.libraries[0].name, '旧名字')
    assert.equal(registry.libraries[0].root, originalRoot)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('removeLibrary refuses the active library, the root itself, and libraries outside the root', () => {
  const p = makePaths()
  try {
    const active = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '在用库' }).library
    makeLibrary(active.root, 1)
    activateLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, id: active.id })
    assert.throws(
      () => removeLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, id: active.id }),
      /当前参考库不能删除/,
    )

    const registry = readRegistry(p.registryFile)
    registry.libraries.push(
      { id: 'root-itself', name: '根目录', root: p.referencesRoot, createdAt: '', updatedAt: '' },
      { id: 'outside', name: '外部库', root: join(p.base, 'outside'), createdAt: '', updatedAt: '' },
    )
    writeRegistry(p.registryFile, registry)

    assert.throws(
      () => removeLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, id: 'root-itself' }),
      /不能删除参考库根目录/,
    )
    assert.throws(
      () => removeLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, id: 'outside' }),
      /旧路径参考库不能从这里删除/,
    )
    assert.throws(
      () => removeLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, id: 'no-such-id' }),
      /参考库不存在/,
    )
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('removeLibrary deletes both the directory and the registry entry', () => {
  const p = makePaths()
  try {
    const first = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '红库' }).library
    makeLibrary(first.root, 1)
    activateLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, id: first.id })

    const second = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '蓝库' }).library
    makeLibrary(second.root, 1)

    removeLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, id: second.id })
    assert.equal(existsSync(second.root), false)
    assert.deepEqual(readRegistry(p.registryFile).libraries.map((item) => item.name), ['红库'])
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('renameLibrary rejects libraries it cannot move and is a no-op for the same name', () => {
  const p = makePaths()
  try {
    const outside = join(p.base, 'outside', '外部库')
    makeLibrary(outside, 1)
    const registry = { schemaVersion: 1, activeId: null, libraries: [{ id: 'outside', name: '外部库', root: outside, createdAt: '', updatedAt: '' }] }
    writeRegistry(p.registryFile, registry)

    assert.throws(
      () => renameLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, referencesRoot: p.referencesRoot, id: 'outside', name: '改名' }),
      /旧路径参考库不能自动重命名/,
    )

    const local = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '本地库' }).library
    makeLibrary(local.root, 1)
    assert.equal(
      renameLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, referencesRoot: p.referencesRoot, id: local.id, name: '本地库' }).name,
      '本地库',
    )

    const same = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '撞名库' }).library
    makeLibrary(same.root, 1)
    const renamed = renameLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, referencesRoot: p.referencesRoot, id: same.id, name: '外包库' })
    assert.equal(renamed.root, join(p.referencesRoot, '外包库'))
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('renaming onto an existing directory picks a free name instead of overwriting', () => {
  const p = makePaths()
  try {
    const library = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '待改名' }).library
    makeLibrary(library.root, 1)
    mkdirSync(join(p.referencesRoot, '占位库'), { recursive: true })
    writeFileSync(join(p.referencesRoot, '占位库', 'keep.txt'), 'keep')

    const renamed = renameLibrary({
      registryFile: p.registryFile,
      pointerFile: p.pointerFile,
      referencesRoot: p.referencesRoot,
      id: library.id,
      name: '占位库',
    })
    assert.notEqual(renamed.name, '占位库')
    assert.match(renamed.name, /^占位库-\d+$/)
    assert.equal(readFileSync(join(p.referencesRoot, '占位库', 'keep.txt'), 'utf8'), 'keep')
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('ensureRegistry clears a stale pointer when nothing usable is left', () => {
  const p = makePaths()
  try {
    mkdirSync(join(p.base, 'state'), { recursive: true })
    writeFileSync(p.pointerFile, JSON.stringify({ root: join(p.base, 'gone') }))
    ensureRegistry({
      registryFile: p.registryFile,
      pointerFile: p.pointerFile,
      referencesRoot: p.referencesRoot,
      projectsRoot: p.projectsRoot,
    })
    assert.equal(readPointer(p.pointerFile), null)
    assert.deepEqual(readRegistry(p.registryFile).libraries, [])
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('ensureRegistry promotes the first library when the registry has no active id', () => {
  const p = makePaths()
  try {
    const first = join(p.referencesRoot, '一号库')
    const second = join(p.referencesRoot, '二号库')
    makeLibrary(first, 1)
    makeLibrary(second, 1)
    writeRegistry(p.registryFile, {
      activeId: null,
      libraries: [
        { id: 'a', name: '一号库', root: first, createdAt: '', updatedAt: '' },
        { id: 'b', name: '二号库', root: second, createdAt: '', updatedAt: '' },
      ],
    })
    ensureRegistry({
      registryFile: p.registryFile,
      pointerFile: p.pointerFile,
      referencesRoot: p.referencesRoot,
      projectsRoot: p.projectsRoot,
    })
    assert.equal(readRegistry(p.registryFile).activeId, 'a')
    assert.equal(readPointer(p.pointerFile).root, first)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('a library outside referencesRoot is registered as legacy and left in place', () => {
  const p = makePaths()
  try {
    const outside = join(p.base, 'elsewhere', '老库')
    makeLibrary(outside, 1)
    mkdirSync(join(p.base, 'state'), { recursive: true })
    writeFileSync(p.pointerFile, JSON.stringify({ root: outside }))

    const registry = ensureRegistry({
      registryFile: p.registryFile,
      pointerFile: p.pointerFile,
      referencesRoot: p.referencesRoot,
      projectsRoot: p.projectsRoot,
    })
    assert.equal(registry.libraries.length, 1)
    assert.equal(registry.libraries[0].legacy, true)
    assert.equal(registry.libraries[0].root, outside)
    assert.equal(existsSync(outside), true)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('library status needs both pages and an index, and trusts the manifest page count', () => {
  const p = makePaths()
  try {
    const broken = join(p.referencesRoot, '缺索引')
    mkdirSync(join(broken, 'assets', 'pages'), { recursive: true })
    writeFileSync(join(broken, 'assets', 'pages', 'P01.webp'), 'x')
    const brokenStatus = libraryStatus(broken)
    assert.equal(brokenStatus.ok, false)
    assert.equal(brokenStatus.pagesDir, true)
    assert.equal(brokenStatus.index, false)
    assert.match(brokenStatus.error, /index\.jsonl/)

    const declared = join(p.referencesRoot, '清单页数')
    makeLibrary(declared, 1)
    writeFileSync(join(declared, 'manifest.json'), JSON.stringify({ pageCount: 12 }))
    assert.equal(libraryStatus(declared).pages, 12)

    assert.equal(libraryStatus(join(p.referencesRoot, '不存在')).ok, false)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('updated libraries list the active one first', () => {
  const p = makePaths()
  try {
    const b = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: 'B 库' }).library
    makeLibrary(b.root, 1)
    const a = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: 'A 库' }).library
    makeLibrary(a.root, 1)
    activateLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, id: b.id })

    const state = getReferenceState({
      registryFile: p.registryFile,
      settings: { referencesRoot: p.referencesRoot },
      projectsRoot: p.projectsRoot,
    })
    assert.deepEqual(state.libraries.map((item) => item.name), ['B 库', 'A 库'])
    assert.equal(state.reference.name, 'B 库')
    assert.equal(state.activeId, b.id)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('sanitizeLibraryName truncates long names and never returns a bare dot', () => {
  assert.equal(sanitizeLibraryName('.'), '参考库')
  assert.equal(sanitizeLibraryName('..'), '参考库')
  assert.equal(sanitizeLibraryName('   '), '参考库')
  assert.equal(sanitizeLibraryName('尾巴...  '), '尾巴')
  assert.equal(sanitizeLibraryName('长'.repeat(120)).length, 80)
})
