import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sendFile } from '../lib/http.js'

async function serve(file) {
  const server = createServer((req, res) => {
    sendFile(res, file).catch((error) => {
      res.writeHead(500)
      res.end(String(error))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) }
}

test('generated html is served as an opaque sandbox with nosniff', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deck-workbench-http-'))
  const file = join(dir, 'page.html')
  await writeFile(file, '<!doctype html><script>window.__ok = 1</script>', 'utf8')
  const { url, close } = await serve(file)
  try {
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(res.headers.get('content-security-policy'), 'sandbox allow-scripts')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(await res.text(), /__ok/)
  } finally {
    await close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('other content types keep the plain header set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deck-workbench-http-'))
  const file = join(dir, 'page.md')
  await writeFile(file, '# 标题\n', 'utf8')
  const { url, close } = await serve(file)
  try {
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-security-policy'), null)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  } finally {
    await close()
    await rm(dir, { recursive: true, force: true })
  }
})
