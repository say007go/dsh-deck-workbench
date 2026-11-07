import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProject, listHistory, readWorkbenchState } from '../lib/projects.js'
import { createHistoryWatcher } from '../lib/history.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deck-workbench-watch-'))
  const project = await createProject(root, { title: '测试方案', client: '测试客户' })
  const page = join(root, project.id, 'content', 'pages', 'P01.md')
  await writeFile(page, '# 页面标题\n\n第一版文案\n', 'utf8')
  const watcher = createHistoryWatcher({ root, intervalMs: 60_000, maxVersions: 50 })
  await watcher.scan()
  return {
    root,
    id: project.id,
    page,
    watcher,
    async cleanup() {
      watcher.stop()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('repeated scans of an unchanged page do not add versions', async () => {
  const f = await fixture()
  try {
    await f.watcher.scan()
    await f.watcher.scan()
    await f.watcher.scan()
    const versions = await listHistory(f.root, f.id, 'P01')
    assert.equal(versions.length, 1)
    const state = await readWorkbenchState(f.root, f.id)
    assert.equal(state.pages.P01.currentVersion, 1)
  } finally {
    await f.cleanup()
  }
})

test('touching a page without changing content keeps the version count', async () => {
  const f = await fixture()
  try {
    const future = new Date(Date.now() + 5_000)
    await utimes(f.page, future, future)
    await f.watcher.scan()
    const versions = await listHistory(f.root, f.id, 'P01')
    assert.equal(versions.length, 1, '同一内容重写不应生成新版本')
  } finally {
    await f.cleanup()
  }
})

test('a content change after the stamp check still lands as a new version', async () => {
  const f = await fixture()
  try {
    await f.watcher.scan()
    await writeFile(f.page, '# 页面标题\n\n第二版文案\n', 'utf8')
    await f.watcher.scan()
    const versions = await listHistory(f.root, f.id, 'P01')
    assert.equal(versions.length, 2)
    const state = await readWorkbenchState(f.root, f.id)
    assert.equal(state.pages.P01.currentVersion, 2)
  } finally {
    await f.cleanup()
  }
})
