import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  listHistory,
  listPageIds,
  listProjectIds,
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

  async function updateState(rootId, pageId, version) {
    const state = await readWorkbenchState(root, rootId)
    const previous = state.pages?.[pageId] ?? {}
    state.pages[pageId] = {
      ...previous,
      currentVersion: version.version,
      currentHash: version.hash,
      copyStatus: previous.copyStatus || 'draft',
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

  async function scanProject(rootId) {
    const pageIds = await listPageIds(root, rootId)
    if (!pageIds.length) return
    let state = await readWorkbenchState(root, rootId)
    let dirty = false
    for (const pageId of pageIds) {
      if (stopped) return
      const copy = await readPageCopy(root, rootId, pageId)
      const key = `${rootId}/${pageId}`
      const previous = cache.get(key)
      const statePage = state.pages?.[pageId] ?? {}

      if (!previous) {
        const versions = await listHistory(root, rootId, pageId)
        if (!versions.length) {
          const version = await writeHistoryVersion(root, rootId, pageId, copy.text)
          state = await updateState(rootId, pageId, version)
          dirty = true
          cache.set(key, { hash: version.hash, version: version.version })
        } else {
          const latest = versions.at(-1)
          if (statePage.currentHash !== copy.hash) {
            const version = await writeHistoryVersion(root, rootId, pageId, copy.text)
            state = await updateState(rootId, pageId, version)
            dirty = true
            cache.set(key, { hash: version.hash, version: version.version })
          } else {
            cache.set(key, { hash: copy.hash, version: statePage.currentVersion ?? latest.version })
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
        cache.set(key, { hash: version.hash, version: version.version })
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
      for (const rootId of rootIds) {
        if (stopped) return
        try {
          await scanProject(rootId)
        } catch (error) {
          report(error)
        }
      }
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
