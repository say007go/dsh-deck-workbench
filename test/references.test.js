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
  readPointer,
  removeLibrary,
  renameLibrary,
  sanitizeLibraryName,
} from '../lib/references.js'

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
  const base = mkdtempSync(join(tmpdir(), 'deck-references-'))
  const projectsRoot = join(base, 'projects')
  const referencesRoot = join(base, 'references')
  const registryFile = join(base, 'state', 'references.json')
  const pointerFile = join(base, 'state', 'reference.json')
  mkdirSync(projectsRoot, { recursive: true })
  return { base, projectsRoot, referencesRoot, registryFile, pointerFile }
}

test('sanitizeLibraryName keeps Chinese and removes invalid filesystem characters', () => {
  assert.equal(sanitizeLibraryName('方案排版参考'), '方案排版参考')
  assert.equal(sanitizeLibraryName('江铃/领军人才'), '江铃-领军人才')
  assert.equal(sanitizeLibraryName('  MBB 2026  '), 'MBB 2026')
  assert.equal(sanitizeLibraryName('CON'), 'CON-库')
})

test('ensureRegistry registers the current pointer library without moving it', () => {
  const p = makePaths()
  try {
    const current = join(p.referencesRoot, '方案排版参考')
    makeLibrary(current, 2)
    mkdirSync(join(p.base, 'state'), { recursive: true })
    writeFileSync(p.pointerFile, JSON.stringify({ root: current }))
    ensureRegistry({
      registryFile: p.registryFile,
      pointerFile: p.pointerFile,
      referencesRoot: p.referencesRoot,
      projectsRoot: p.projectsRoot,
    })
    const state = getReferenceState({
      registryFile: p.registryFile,
      settings: { referencesRoot: p.referencesRoot },
      projectsRoot: p.projectsRoot,
    })
    assert.equal(state.activeId, state.libraries[0].id)
    assert.equal(state.libraries[0].name, '方案排版参考')
    assert.equal(state.libraries[0].pages, 2)
    assert.equal(readPointer(p.pointerFile).root, current)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('ensureRegistry moves a legacy _reference library under references', () => {
  const p = makePaths()
  try {
    const legacy = join(p.projectsRoot, '_reference')
    makeLibrary(legacy, 1)
    ensureRegistry({
      registryFile: p.registryFile,
      pointerFile: p.pointerFile,
      referencesRoot: p.referencesRoot,
      projectsRoot: p.projectsRoot,
    })
    const target = join(p.referencesRoot, '参考库')
    assert.equal(existsSync(legacy), false)
    assert.equal(existsSync(target), true)
    assert.equal(readPointer(p.pointerFile).root, target)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('create/activate/rename/delete keep one active library', () => {
  const p = makePaths()
  try {
    const first = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: '方案排版参考' }).library
    makeLibrary(first.root, 1)
    activateLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, id: first.id })

    const second = createLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, name: 'MBB 2026' }).library
    makeLibrary(second.root, 1)
    activateLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, id: second.id })

    assert.equal(readPointer(p.pointerFile).root, second.root)
    assert.throws(() => removeLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, id: second.id }), /当前参考库不能删除/)

    renameLibrary({ registryFile: p.registryFile, pointerFile: p.pointerFile, referencesRoot: p.referencesRoot, id: second.id, name: 'MBB 方案' })
    assert.equal(readPointer(p.pointerFile).root, join(p.referencesRoot, 'MBB 方案'))

    removeLibrary({ registryFile: p.registryFile, referencesRoot: p.referencesRoot, id: first.id })
    const state = getReferenceState({
      registryFile: p.registryFile,
      settings: { referencesRoot: p.referencesRoot },
      projectsRoot: p.projectsRoot,
    })
    assert.equal(state.libraries.length, 1)
    assert.equal(state.libraries[0].name, 'MBB 方案')
    assert.match(readFileSync(p.registryFile, 'utf8'), /MBB 方案/)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})
