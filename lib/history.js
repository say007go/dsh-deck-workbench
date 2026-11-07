import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  listHistory,
  listPageIds,
  listProjectIds,
  pagePath,
  projectDir,
  readPageCopy,
  readWorkbenchState,
  writeHistoryVersion,
  writeWorkbenchState,
} from './projects.js'

/**
 * Snapshot page copy into content/history whenever it changes.
 * The workbench owns this history; content skills only write the current page.
 */
export function createHistoryWatcher({ root, intervalMs = 2000, maxVersions = 50, onError } = {}) {
  const cache = new Map()
  let running = false
  let stopped = false
  let timer = null

  const report = (error) => {
    if (typeof onError === 'function') onError(error)
    else console.warn('[deck-workbench] history scan failed:', error?.message || error)
  }

  /**
   * mtime + size 是“文件有没有动”的廉价判据：2s 轮询下全文读取才是主要开销。
   * 同内容重写会命中读取分支，但 hash 相同，不会产生新版本。
   */
  async function pageStamp(rootId, pageId) {
    try {
      const info = await stat(pagePath(root, rootId, pageId))
      return { mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      return null
    }
  }

  async function updateState(rootId, pageId, version) {
    const state = await readWorkbenchState(root, rootId)
    const previous = state.pages?.[pageId] ?? {}
    state.pages[pageId] = {
      ...previous,
      currentVersion: version.version,
      currentHash: version.hash,
      updatedAt: new Date().toISOString(),
    }
    await writeWorkbenchState(root, rootId, state)
    return state
  }

  async function prune(rootId, pageId, state) {
    const versions = await listHistory(root, rootId, pageId)
    if (versions.length <= maxVersions) return
    const approved = Number(state.pages?.[pageId]?.approvedVersion ?? 0)
    const keep = new Set(versions.slice(-maxVersions).map((item) => item.version))
    if (approved) keep.add(approved)
    const dir = join(projectDir(root, rootId), 'content', 'history', pageId)
    for (const version of versions) {
      if (keep.has(version.version)) continue
      await rm(join(dir, version.file), { force: true })
    }
  }

  async function scanProject(rootId, seen) {
    const pageIds = await listPageIds(root, rootId)
    if (!pageIds.length) return
    let state = await readWorkbenchState(root, rootId)
    let dirty = false
    for (const pageId of pageIds) {
      if (stopped) return
      const key = `${rootId}/${pageId}`
      seen.add(key)
      const previous = cache.get(key)
      const stamp = await pageStamp(rootId, pageId)
      if (previous && stamp && previous.mtimeMs === stamp.mtimeMs && previous.size === stamp.size) continue
      const copy = await readPageCopy(root, rootId, pageId)
      const statePage = state.pages?.[pageId] ?? {}

      if (!previous) {
        const versions = await listHistory(root, rootId, pageId)
        if (!versions.length) {
          const version = await writeHistoryVersion(root, rootId, pageId, copy.text)
          state = await updateState(rootId, pageId, version)
          dirty = true
          cache.set(key, { hash: version.hash, version: version.version, mtimeMs: stamp?.mtimeMs ?? copy.mtimeMs, size: stamp?.size })
        } else {
          const latest = versions.at(-1)
          if (statePage.currentHash !== copy.hash) {
            const version = await writeHistoryVersion(root, rootId, pageId, copy.text)
            state = await updateState(rootId, pageId, version)
            dirty = true
            cache.set(key, { hash: version.hash, version: version.version, mtimeMs: stamp?.mtimeMs ?? copy.mtimeMs, size: stamp?.size })
          } else {
            cache.set(key, { hash: copy.hash, version: statePage.currentVersion ?? latest.version, mtimeMs: stamp?.mtimeMs ?? copy.mtimeMs, size: stamp?.size })
            if (statePage.currentVersion !== latest.version) {
              state.pages[pageId] = { ...statePage, currentVersion: latest.version, currentHash: copy.hash }
              dirty = true
            }
          }
        }
      } else if (previous.hash !== copy.hash) {
        const version = await writeHistoryVersion(root, rootId, pageId, copy.text)
        state = await updateState(rootId, pageId, version)
        dirty = true
        cache.set(key, { hash: version.hash, version: version.version, mtimeMs: stamp?.mtimeMs ?? copy.mtimeMs, size: stamp?.size })
      }
    }
    if (dirty) {
      await writeWorkbenchState(root, rootId, state)
      for (const pageId of pageIds) await prune(rootId, pageId, state)
    }
  }

  async function scan() {
    if (running || stopped) return
    running = true
    try {
      const rootIds = await listProjectIds(root)
      const seen = new Set()
      for (const rootId of rootIds) {
        if (stopped) return
        try {
          await scanProject(rootId, seen)
        } catch (error) {
          report(error)
        }
      }
      // 已删除的项目/页面不能一直留在 cache 里。
      if (!stopped) for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key)
    } catch (error) {
      report(error)
    } finally {
      running = false
    }
  }

  const start = () => {
    void scan()
    timer = setInterval(() => { void scan() }, Math.max(500, Number(intervalMs) || 2000))
    timer.unref?.()
  }

  return {
    scan,
    start,
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
