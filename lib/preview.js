import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { HttpError, mimeFor, sendFile } from './http.js'
import { projectDir } from './projects.js'

const run = promisify(execFile)

function sofficeCandidates() {
  const programRoots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean)
  const windows = programRoots.flatMap((root) => [
    join(root, 'LibreOffice', 'program', 'soffice.com'),
    join(root, 'LibreOffice', 'program', 'soffice.exe'),
  ])
  return [
    process.env.PPT_SOFFICE,
    process.env.SOFFICE_PATH,
    ...windows,
    'soffice',
  ].filter(Boolean)
}

export function findSoffice() {
  for (const candidate of sofficeCandidates()) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (existsSync(candidate)) return candidate
    } else {
      return candidate
    }
  }
  return 'soffice'
}

export async function findPptx(root, id, pageId) {
  const dir = projectDir(root, id)
  const page = join(dir, 'renders', 'pptx', `${pageId}.pptx`)
  try {
    const info = await stat(page)
    if (info.isFile()) return { path: page, name: basename(page), page: true, mtimeMs: info.mtimeMs }
  } catch {
    // fall through to deck
  }
  const deck = join(dir, 'renders', 'pptx', 'deck.pptx')
  try {
    const info = await stat(deck)
    if (info.isFile()) return { path: deck, name: basename(deck), page: false, mtimeMs: info.mtimeMs }
  } catch {
    // no pptx
  }
  return null
}

export async function ensurePreviewPdf(root, id, pageId) {
  const pptx = await findPptx(root, id, pageId)
  if (!pptx) throw new HttpError(404, '没有找到 PPTX 产物')
  const dir = join(projectDir(root, id), 'workbench', '.preview')
  await mkdir(dir, { recursive: true })
  const profileDir = join(dir, '.lo_profile')
  await mkdir(profileDir, { recursive: true })
  const pdf = join(dir, `${pptx.page ? pageId : 'deck'}.pdf`)
  try {
    const info = await stat(pdf)
    if (info.mtimeMs >= pptx.mtimeMs) return { pdf, pptx }
  } catch {
    // convert below
  }
  const soffice = findSoffice()
  try {
    await rm(pdf, { force: true })
    await run(soffice, [
      '--headless',
      '--norestore',
      `-env:UserInstallation=file:///${profileDir.replace(/\\/g, '/')}`,
      '--convert-to',
      'pdf',
      '--outdir',
      dir,
      pptx.path,
    ], {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    throw new HttpError(502, `PPTX 转 PDF 失败：${error?.message || error}`)
  }
  try {
    await stat(pdf)
  } catch {
    throw new HttpError(502, 'PPTX 转 PDF 未产生输出文件')
  }
  return { pdf, pptx }
}

export async function servePreviewPptx(root, id, pageId, res) {
  const { pdf } = await ensurePreviewPdf(root, id, pageId)
  await sendFile(res, pdf, mimeFor(pdf))
}

export async function ensurePreviewPng(root, id, pageId) {
  const pptx = await findPptx(root, id, pageId)
  if (!pptx) throw new HttpError(404, '没有找到 PPTX 产物')
  const dir = join(projectDir(root, id), 'workbench', '.preview')
  await mkdir(dir, { recursive: true })
  const profileDir = join(dir, '.lo_profile_png')
  await mkdir(profileDir, { recursive: true })
  const base = pptx.page ? pageId : 'deck'
  const png = join(dir, `${base}.png`)
  try {
    const info = await stat(png)
    if (info.mtimeMs >= pptx.mtimeMs) return { png, pptx }
  } catch {
    // convert below
  }
  const soffice = findSoffice()
  try {
    await rm(png, { force: true })
    await run(soffice, [
      '--headless',
      '--norestore',
      `-env:UserInstallation=file:///${profileDir.replace(/\\/g, '/')}`,
      '--convert-to',
      'png',
      '--outdir',
      dir,
      pptx.path,
    ], {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    throw new HttpError(502, `PPTX 转图片失败：${error?.message || error}`)
  }
  try {
    await stat(png)
  } catch {
    throw new HttpError(502, 'PPTX 转图片未产生输出文件')
  }
  return { png, pptx }
}

export async function servePreviewPng(root, id, pageId, res) {
  const { png } = await ensurePreviewPng(root, id, pageId)
  await sendFile(res, png, mimeFor(png))
}

export async function serveProjectFile(root, id, rel, res) {
  const file = await resolveProjectFileForServing(root, id, rel)
  await sendFile(res, file.path, mimeFor(file.path))
}

async function resolveProjectFileForServing(root, id, rel) {
  const { resolveProjectFile } = await import('./projects.js')
  return resolveProjectFile(root, id, rel)
}
