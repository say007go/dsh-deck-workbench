import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle } from '../lib/index.js'

async function start() {
  const root = await mkdtemp(join(tmpdir(), 'deck-workbench-routes-'))
  const settingsFile = join(root, 'settings.json')
  const server = createServer((req, res) => {
    handle(req, res, join(root, 'projects'), settingsFile, '', {}, () => null, () => null)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}/deck-workbench`
  return {
    base,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('health reports the configured root', async () => {
  const app = await start()
  try {
    const res = await fetch(`${app.base}/api/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.name, 'deck-workbench')
    assert.match(body.root, /projects$/)
  } finally {
    await app.close()
  }
})

test('settings include the server-side defaults', async () => {
  const app = await start()
  try {
    const res = await fetch(`${app.base}/api/settings`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.defaults.skills, { content: 'page-content' })
    assert.equal(typeof body.defaults.renderPrompts.default, 'string')
  } finally {
    await app.close()
  }
})

test('an empty root lists no projects', async () => {
  const app = await start()
  try {
    const res = await fetch(`${app.base}/api/projects`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.projects, [])
  } finally {
    await app.close()
  }
})

test('cross-origin writes are rejected', async () => {
  const app = await start()
  try {
    const res = await fetch(`${app.base}/api/projects`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ title: '恶意项目' }),
    })
    assert.equal(res.status, 403)
    assert.equal((await res.json()).ok, false)
  } finally {
    await app.close()
  }
})

test('unexpected failures answer with a request id instead of the raw error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deck-workbench-routes-'))
  // 让 settings 文件变成一个目录：readSettings 会抛 EISDIR，进入 500 分支。
  const settingsFile = join(root, 'settings.json')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(settingsFile, { recursive: true })
  const server = createServer((req, res) => {
    handle(req, res, join(root, 'projects'), settingsFile, '', {}, () => null, () => null)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/deck-workbench/api/settings`)
    assert.equal(res.status, 500)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.match(body.error, /服务内部错误（[0-9a-f]{8}）/)
    assert.equal(body.error.includes('EISDIR'), false, '不应把系统错误文本回给页面')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('unknown routes and paths outside the prefix answer 404', async () => {
  const app = await start()
  try {
    const unknown = await fetch(`${app.base}/api/nope`)
    assert.equal(unknown.status, 404)
    const outside = await fetch(app.base.replace('/deck-workbench', '') + '/api/health')
    assert.equal(outside.status, 404)
  } finally {
    await app.close()
  }
})
