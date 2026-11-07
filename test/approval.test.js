import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approvePage,
  createProject,
  listHistory,
  pageSummary,
  restorePage,
} from '../lib/projects.js'
import { createHistoryWatcher } from '../lib/history.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deck-workbench-approval-'))
  const project = await createProject(root, { title: '测试方案', client: '测试客户' })
  const id = project.id
  const page = join(root, id, 'content', 'pages', 'P01.md')
  await writeFile(page, '# 页面标题\n\n第一版文案\n', 'utf8')
  const watcher = createHistoryWatcher({ root, intervalMs: 60_000, maxVersions: 50 })
  await watcher.scan()
  return {
    root,
    id,
    page,
    watcher,
    async cleanup() {
      watcher.stop()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('first scan snapshots the page as v1 and leaves it a draft', async () => {
  const f = await fixture()
  try {
    const versions = await listHistory(f.root, f.id, 'P01')
    assert.equal(versions.length, 1)
    const summary = await pageSummary(f.root, f.id, 'P01')
    assert.equal(summary.currentVersion, 1)
    assert.equal(summary.copyStatus, 'draft')
    assert.equal(summary.approvedVersion, null)
  } finally {
    await f.cleanup()
  }
})

test('approval survives until the copy changes, then falls back to draft', async () => {
  const f = await fixture()
  try {
    await approvePage(f.root, f.id, 'P01', 1)
    assert.equal((await pageSummary(f.root, f.id, 'P01')).copyStatus, 'approved')

    // 改一个字：新版本写入历史，批准状态必须自己退回草稿。
    await writeFile(f.page, '# 页面标题\n\n第一版文案（改）\n', 'utf8')
    await f.watcher.scan()

    const versions = await listHistory(f.root, f.id, 'P01')
    assert.equal(versions.length, 2)
    const summary = await pageSummary(f.root, f.id, 'P01')
    assert.equal(summary.currentVersion, 2)
    assert.equal(summary.copyStatus, 'draft')
    assert.equal(summary.approvedVersion, 1)
  } finally {
    await f.cleanup()
  }
})

test('restoring the approved content counts as approved again', async () => {
  const f = await fixture()
  try {
    await approvePage(f.root, f.id, 'P01', 1)
    await writeFile(f.page, '# 页面标题\n\n第二版文案\n', 'utf8')
    await f.watcher.scan()
    assert.equal((await pageSummary(f.root, f.id, 'P01')).copyStatus, 'draft')

    await restorePage(f.root, f.id, 'P01', 1)
    await f.watcher.scan()

    const summary = await pageSummary(f.root, f.id, 'P01')
    assert.equal(summary.currentVersion, 3)
    assert.equal(summary.copyStatus, 'approved', '内容与已确认版本一致时应重新算作已确认')
  } finally {
    await f.cleanup()
  }
})
