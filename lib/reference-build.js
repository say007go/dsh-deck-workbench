import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
let activeJob = null

function nowIso() {
  return new Date().toISOString()
}

function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    percent: job.percent,
    message: job.message,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    root: job.root,
    libraryId: job.libraryId || null,
    error: job.error,
  }
}

function pythonCommand() {
  return process.env.DECK_PYTHON || process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
}

export function getReferenceJob() {
  return publicJob(activeJob)
}

export function isReferenceJobRunning() {
  return activeJob?.status === 'running'
}

/**
 * Start a builder process. At most one build runs per plugin instance.
 * The builder's --progress JSONL is folded into the job state; the final
 * close code plus manifest presence is the only success signal.
 */
export function startReferenceBuild({ pptxPath, outRoot, title, pluginRoot, libraryId, cleanupPath, reuseAnnotations }) {
  if (activeJob?.status === 'running') {
    const error = new Error('参考库正在构建，请等待完成')
    error.code = 'REFERENCE_BUSY'
    throw error
  }
  const job = {
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    stage: 'starting',
    percent: 0,
    message: '准备构建参考库',
    startedAt: nowIso(),
    finishedAt: null,
    root: outRoot,
    libraryId: libraryId || null,
    error: null,
  }
  activeJob = job
  const builder = join(pluginRoot, 'tools', 'reference_builder.py')
  const cleanupPaths = [cleanupPath, reuseAnnotations].filter(Boolean)
  const cleanupTemporaries = () => {
    for (const path of cleanupPaths) {
      try { rmSync(path, { force: true }) } catch {}
    }
  }
  if (!existsSync(builder)) {
    job.status = 'error'
    job.stage = 'error'
    job.error = `找不到参考库构建器：${builder}`
    job.finishedAt = nowIso()
    cleanupTemporaries()
    return publicJob(job)
  }
  let stderrTail = ''
  let stdoutBuffer = ''
  let child
  try {
    child = spawn(pythonCommand(), [
      builder,
      '--pptx', pptxPath,
      '--out', outRoot,
      '--title', title || '参考库',
      '--force',
      '--progress',
      ...(reuseAnnotations ? ['--reuse-annotations', reuseAnnotations] : []),
    ], {
      cwd: pluginRoot,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
  } catch (error) {
    job.status = 'error'
    job.stage = 'error'
    job.error = String(error?.message || error)
    job.finishedAt = nowIso()
    cleanupTemporaries()
    return publicJob(job)
  }
  const handleLine = (line) => {
    const text = line.trim()
    if (!text) return
    try {
      const data = JSON.parse(text)
      if (data?.progress === true) {
        job.stage = String(data.stage || job.stage)
        job.percent = Math.max(0, Math.min(100, Number(data.percent) || 0))
        job.message = String(data.message || job.message)
        return
      }
      if (data?.ok === true) {
        job.percent = 100
        job.message = '参考库构建完成'
      }
    } catch {
      // Builder may print a traceback or LibreOffice chatter; keep it for errors only.
    }
  }
  child.stdout?.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''
    for (const line of lines) handleLine(line)
  })
  child.stderr?.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000)
  })
  child.on('error', (error) => {
    job.status = 'error'
    job.stage = 'error'
    job.error = `无法启动 Python：${error.message}`
    job.finishedAt = nowIso()
    cleanupTemporaries()
  })
  child.on('close', (code) => {
    if (job.status === 'error') return
    if (stdoutBuffer.trim()) handleLine(stdoutBuffer)
    if (code === 0 && existsSync(join(outRoot, 'manifest.json'))) {
      job.status = 'done'
      job.stage = 'done'
      job.percent = 100
      job.message = '参考库构建完成'
      job.finishedAt = nowIso()
    } else {
      job.status = 'error'
      job.stage = 'error'
      job.error = stderrTail.trim() || `构建器退出码 ${code}，未生成 manifest.json`
      job.finishedAt = nowIso()
    }
    cleanupTemporaries()
  })
  return publicJob(job)
}

export async function validateReference(root, pluginRoot) {
  const script = join(pluginRoot, 'skills', 'html-layout', 'scripts', 'validate_library.py')
  if (!existsSync(script)) throw new Error(`找不到参考库校验脚本：${script}`)
  try {
    const { stdout } = await execFileAsync(pythonCommand(), [script, '--reference', root], {
      cwd: pluginRoot,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    return JSON.parse(stdout)
  } catch (error) {
    // validate_library.py prints the report and exits 1 when the report is not ok.
    try {
      const report = JSON.parse(String(error?.stdout || '').trim())
      if (report && typeof report.ok === 'boolean') return report
    } catch {}
    const detail = String(error?.stderr || error?.message || error).trim()
    throw new Error(detail || '参考库校验失败')
  }
}
