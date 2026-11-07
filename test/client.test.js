import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// 客户端是手写 UMD：没有构建步骤，也没有 ESM 导出。
// 这里用 vm + 最小 React stub 把它当普通脚本跑起来，只取 __internals 里的纯函数。
const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')

function loadClient() {
  const noop = () => {}
  class Component {
    constructor(props) { this.props = props }
    setState() {}
  }
  const react = {
    Component,
    createElement: noop,
    Fragment: 'fragment',
    useState: noop,
    useEffect: noop,
    useMemo: noop,
    useRef: noop,
    useCallback: noop,
  }
  let exported = null
  const sandbox = {
    console,
    document: {
      hidden: false,
      baseURI: 'http://127.0.0.1:9999/',
      addEventListener: noop,
      removeEventListener: noop,
      createElement: () => ({ style: {}, setAttribute: noop, click: noop, remove: noop }),
    },
    navigator: { clipboard: { writeText: async () => {} } },
    URL,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    window: { __ModuleLoader__: { load: (mod) => { exported = mod.factory(() => react) } } },
  }
  sandbox.window.window = sandbox.window
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return exported
}

const client = loadClient()
// vm 里的对象属于另一个 realm，deepEqual 会因为原型不同而失败，先搬回本域。
const plain = (lines) => Array.from(lines, (line) => ({ type: line.type, text: line.text }))
const {
  endpoint, fileUrl, formatTime, statusText, statusColor,
  diffLines, buildOptimizePrompt, buildRenderPrompt, buildStartPrompt,
} = client.__internals

test('endpoint keeps the plugin prefix and drops leading slashes', () => {
  assert.equal(endpoint('api/health'), '/deck-workbench/api/health')
  assert.equal(endpoint('/api/health'), '/deck-workbench/api/health')
  assert.equal(endpoint(''), '/deck-workbench/')
})

test('fileUrl encodes project ids and every path segment', () => {
  assert.equal(fileUrl('p 1', 'renders/html/P01.html'), '/deck-workbench/files/p%201/renders/html/P01.html')
  assert.equal(fileUrl('p1', '/renders//a b.png'), '/deck-workbench/files/p1/renders/a%20b.png')
})

test('formatTime tolerates empty and invalid values', () => {
  assert.equal(formatTime(''), '')
  assert.equal(formatTime(null), '')
  assert.equal(formatTime('not a date'), '')
  assert.match(formatTime('2026-11-07T09:05:00Z'), /\d{2}\/\d{2} \d{2}:\d{2}/)
})

test('status text and color cover every known state', () => {
  assert.equal(statusText('done'), '已生成')
  assert.equal(statusText('stale'), '过期')
  assert.equal(statusText('missing'), '缺失')
  assert.equal(statusText('deck'), '整份')
  assert.equal(statusText('whatever'), 'whatever')
  assert.equal(statusColor('done'), '#2f8f5b')
  assert.equal(statusColor('stale'), '#b26a00')
  assert.equal(statusColor('deck'), '#1565c0')
  assert.match(statusColor('missing'), /rgba/)
})

test('diffLines marks identical text as unchanged', () => {
  const lines = plain(diffLines('a\nb\nc', 'a\nb\nc'))
  assert.deepEqual(lines, [
    { type: 'same', text: 'a' },
    { type: 'same', text: 'b' },
    { type: 'same', text: 'c' },
  ])
})

test('diffLines reports additions and deletions around the change', () => {
  const lines = plain(diffLines('a\nb\nc', 'a\nx\nc'))
  assert.deepEqual(lines.map((line) => `${line.type}:${line.text}`), ['same:a', 'del:b', 'add:x', 'same:c'])
  assert.equal(lines.filter((line) => line.type === 'add').length, 1)
  assert.equal(lines.filter((line) => line.type === 'del').length, 1)
})

test('diffLines falls back for very large inputs instead of hanging', () => {
  const oldText = Array.from({ length: 300 }, (_, i) => `old ${i}`).join('\n')
  const newText = Array.from({ length: 400 }, (_, i) => `new ${i}`).join('\n')
  const lines = plain(diffLines(oldText, newText))
  assert.match(lines[0].text, /跳过逐行 diff/)
  assert.equal(lines.filter((line) => line.type === 'add').length, 400)
})

test('buildRenderPrompt picks the artifact path and skill per target', () => {
  const project = { path: 'D:/work/project-1' }
  const page = { id: 'P03', title: '人才梯队' }
  const settings = { renderPrompts: { default: '默认取舍', preserve: '保留原文', compress: '压缩表达' } }

  const pptx = buildRenderPrompt(project, page, 'pptx', 'default', '', settings)
  assert.match(pptx, /产物路径：renders\/pptx\/P03\.pptx/)
  assert.match(pptx, /请使用 ppt-layout/)
  assert.match(pptx, /默认取舍/)
  assert.match(pptx, /不要回写 content\/pages/)

  const html = buildRenderPrompt(project, page, 'html', 'preserve', '', settings)
  assert.match(html, /renders\/html\/P03\.html/)
  assert.match(html, /请使用 html-layout/)
  assert.match(html, /保留原文/)

  const image = buildRenderPrompt(project, page, 'image', 'compress', '', settings)
  assert.match(image, /renders\/image\/P03\.png/)
  assert.match(image, /请使用 image-layout/)
  assert.match(image, /压缩表达/)
})

test('buildRenderPrompt uses the custom note only for the custom policy', () => {
  const project = { path: 'D:/work/project-1' }
  const page = { id: 'P01', title: '封面' }
  const settings = { renderPrompts: { default: '默认取舍' } }

  const custom = buildRenderPrompt(project, page, 'pptx', 'custom', '  按封面处理，不放图表  ', settings)
  assert.match(custom, /按封面处理，不放图表/)
  assert.doesNotMatch(custom, /默认取舍/)

  const fallback = buildRenderPrompt(project, page, 'pptx', 'custom', '   ', settings)
  assert.match(fallback, /默认取舍/)
})

test('buildRenderPrompt falls back to the default preset for unknown policies', () => {
  const project = { path: 'D:/work/project-1' }
  const page = { id: 'P02', title: '目标' }
  const settings = { renderPrompts: { default: '默认取舍' } }
  assert.match(buildRenderPrompt(project, page, 'pptx', 'nonsense', '', settings), /默认取舍/)
})

test('buildStartPrompt swaps the placeholder skill for the configured one', () => {
  const project = { path: 'D:/work/project-1' }
  const settings = { contentMode: 'skill', skills: { content: 'my-content-skill' } }
  const prompt = buildStartPrompt(project, settings)
  assert.match(prompt, /请使用 my-content-skill/)
  assert.doesNotMatch(prompt, /page-content/)
  assert.match(prompt, /需求文件：content\/brief\.md/)
})

test('buildStartPrompt warns when skill mode has no skill configured', () => {
  const project = { path: 'D:/work/project-1' }
  const settings = { contentMode: 'skill', skills: { content: '' }, contentFallbackPrompt: '内置内容提示词' }
  const prompt = buildStartPrompt(project, settings)
  assert.match(prompt, /内置内容提示词/)
  assert.match(prompt, /未填写内容技能，已使用内置提示词/)
})

test('buildStartPrompt uses the builtin prompt in builtin mode and appends content requirements', () => {
  const project = { path: 'D:/work/project-1' }
  const settings = { contentMode: 'builtin', skills: { content: 'ignored' }, contentFallbackPrompt: '内置内容提示词', contentPrompt: '对齐集团人才规划' }
  const prompt = buildStartPrompt(project, settings)
  assert.match(prompt, /内置内容提示词/)
  assert.doesNotMatch(prompt, /ignored/)
  assert.match(prompt, /内容要求：\n对齐集团人才规划/)
})

test('buildOptimizePrompt keeps the page scope and the feedback', () => {
  const project = { path: 'D:/work/project-1' }
  const page = { id: 'P04', title: '实施路径' }
  const prompt = buildOptimizePrompt(project, page, '第二段太满，删掉一句', {})
  assert.match(prompt, /页面：P04 实施路径/)
  assert.match(prompt, /当前文案：content\/pages\/P04\.md/)
  assert.match(prompt, /反馈：第二段太满，删掉一句/)
  assert.match(prompt, /请只优化这一页/)
})
