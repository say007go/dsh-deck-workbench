// 项目读取路径的基准：造一个临时项目库，量 listProjects / loadProject / readPage。
// 用法：npm run bench -- [项目数] [每项目页数] [每页历史版本数]
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createProject,
  listProjects,
  loadProject,
  readPage,
  writeHistoryVersion,
  writePageCopy,
} from '../lib/projects.js'

const PROJECTS = Number(process.argv[2] ?? 4)
const PAGES = Number(process.argv[3] ?? 25)
const VERSIONS = Number(process.argv[4] ?? 8)

const root = await mkdtemp(join(tmpdir(), 'deck-bench-'))
for (let p = 0; p < PROJECTS; p++) {
  const project = await createProject(root, { title: `压力项目 ${p}`, client: '测试客户' })
  for (let i = 1; i <= PAGES; i++) {
    const pageId = `P${String(i).padStart(2, '0')}`
    await writePageCopy(root, project.id, pageId, `# 第 ${i} 页\n\n${'正文段落。'.repeat(200)}`)
    for (let v = 0; v < VERSIONS; v++) {
      await writeHistoryVersion(root, project.id, pageId, `# 第 ${i} 页\n\n历史 ${v}`)
    }
    await mkdir(join(root, project.id, 'renders', 'pptx'), { recursive: true })
    await writeFile(join(root, project.id, 'renders', 'pptx', `${pageId}.pptx`), 'x')
  }
}

const time = async (label, fn, rounds = 10) => {
  await fn()
  const start = performance.now()
  for (let i = 0; i < rounds; i++) await fn()
  console.log(`${label.padEnd(30)} ${((performance.now() - start) / rounds).toFixed(1)} ms`)
}

const t0 = performance.now()
const projects = await listProjects(root)
console.log(`${'cold listProjects'.padEnd(30)} ${(performance.now() - t0).toFixed(1)} ms`)
await time('warm listProjects', () => listProjects(root))
await time('warm loadProject', () => loadProject(root, projects[0].id))
await time('warm readPage', () => readPage(root, projects[0].id, 'P01'))
console.log(`${PROJECTS} projects × ${PAGES} pages × ${VERSIONS} versions = ${PROJECTS * PAGES * (VERSIONS + 1)} files`)

await rm(root, { recursive: true, force: true })
