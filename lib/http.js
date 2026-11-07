import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function mimeFor(filePath) {
  return MIME[extname(String(filePath)).toLowerCase()] ?? 'application/octet-stream'
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: String(message || 'request failed') })
}

export function sendFile(res, filePath, contentType = mimeFor(filePath)) {
  return stat(filePath).then((info) => {
    const headers = {
      'cache-control': 'no-store',
      'content-type': contentType,
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
    }
    if (/^text\/html/i.test(contentType)) {
      // 产物 HTML 由 agent 生成，按不透明源运行：脚本照常执行，但拿不到控制 API 的同源权限。
      headers['content-security-policy'] = 'sandbox allow-scripts'
    }
    res.writeHead(200, headers)
    createReadStream(filePath).pipe(res)
  })
}

export function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    return parsed.host === req.headers.host
  } catch {
    return false
  }
}

export function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        finish(new HttpError(413, `请求体超过上限（${Math.floor(limit / 1024 / 1024)}MB）`))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(null, Buffer.concat(chunks)))
    req.on('error', (error) => finish(error))
    req.on('aborted', () => finish(new HttpError(400, '请求已中断')))
  })
}

export async function readJson(req, limit = 2 * 1024 * 1024) {
  const raw = await readBody(req, limit)
  if (raw.length === 0) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new HttpError(400, 'JSON 格式无效')
  }
}

export function decode(value) {
  try {
    return decodeURIComponent(String(value ?? ''))
  } catch {
    return String(value ?? '')
  }
}
