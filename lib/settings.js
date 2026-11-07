import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export const DEFAULT_RENDER_PROMPTS = Object.freeze({
  default: '按技能默认规则决定版式与文案取舍。',
  preserve: '本页文案必须完全保留，不得增删、替换或改写文字内容；只允许断行、分段和版式层级调整。如果页面放不下，停止制作并说明容量不足，不要自行删减。',
  compress: '本页允许为版式需要取词、删词、断行、短标题提炼和层级重组；不得新增内容，不得改变事实、数据、主体、承诺与结论，关键数字、专有名词和限定语必须保留。如果压缩导致语义变化，停止并说明。',
})


export const DEFAULT_SKILLS = Object.freeze({
  content: 'page-content',
})


export const DEFAULT_CONTENT_PROMPT = '页数按需求与蓝图确定，默认控制在 12–18 页；先输出项目框架和页面蓝图，确认后再逐页写；优先使用表格、分点和矩阵等可扫读结构；不虚构客户事实、数据、政策或案例。'

export const DEFAULT_CONTENT_FALLBACK_PROMPT = [
  '请直接读取需求，输出项目框架与页面蓝图；等我确认蓝图后，再逐页写 content/pages/P01.md、P02.md……',
  '每页在标题下写一小段提纲挈领的总领段（约 60–120 字），概括本页核心内容；从页面内容本身提炼，不虚构事实、数据或结论，不要写成空泛套话。',
  '不要写版式、页面类型/关系、机器编号或视觉建议；只交内容。',
  '不要虚构客户事实；缺少信息先问。',
  '本次不调用内容技能；请独立完成，不要因为缺少技能停下。',
].join('\n')

const LEGACY_CONTENT_FALLBACK_PROMPTS = [
  [
    '请直接读取需求，输出项目框架与页面蓝图；等我确认蓝图后，再逐页写 content/pages/P01.md、P02.md……',
    '不要写版式、页面类型/关系、机器编号或视觉建议；只交内容。',
    '不要虚构客户事实；缺少信息先问。',
    '本次不调用内容技能；请独立完成，不要因为缺少技能停下。',
  ].join('\n'),
  [
    '请直接读取需求，输出项目框架与页面蓝图；等我确认蓝图后，再逐页写 content/pages/P01.md、P02.md……',
    '每页按内容组织标题、总领段（如需要）和正文；没有合适的总领段就不要硬写。',
    '不要写版式、页面类型/关系、机器编号或视觉建议；只交内容。',
    '不要虚构客户事实；缺少信息先问。',
    '本次不调用内容技能；请独立完成，不要因为缺少技能停下。',
  ].join('\n'),
  [
    '请直接读取需求，输出项目框架与页面蓝图；等我确认蓝图后，再逐页写 content/pages/P01.md、P02.md……',
    '每页在标题下写一小段提纲挈领的总领段，概括本页核心内容；从页面内容本身提炼，不虚构事实、数据或结论，不要写成空泛套话。',
    '不要写版式、页面类型/关系、机器编号或视觉建议；只交内容。',
    '不要虚构客户事实；缺少信息先问。',
    '本次不调用内容技能；请独立完成，不要因为缺少技能停下。',
  ].join('\n'),
]

const LEGACY_CONTENT_PROMPT = '页数按需求与蓝图确定，默认控制在 12–18 页；每页标题不超过 28 字；总领段 100–150 字；正文 300–500 字；优先使用表格、分点和矩阵等可扫读结构；不虚构客户事实、数据、政策或案例。'

export const DEFAULT_SETTINGS = Object.freeze({
  projectsRoot: '',
  referencesRoot: '',
  referenceRoot: '',
  contentMode: 'skill',
  skills: { ...DEFAULT_SKILLS },
  contentPrompt: DEFAULT_CONTENT_PROMPT,
  contentFallbackPrompt: DEFAULT_CONTENT_FALLBACK_PROMPT,
  renderPrompts: { ...DEFAULT_RENDER_PROMPTS },
})

// 默认值只在这里定义一份：客户端通过 /api/settings 的 defaults 字段获取，不在前端复制。
export const DEFAULTS = Object.freeze({
  renderPrompts: DEFAULT_RENDER_PROMPTS,
  skills: DEFAULT_SKILLS,
  contentPrompt: DEFAULT_CONTENT_PROMPT,
  contentFallbackPrompt: DEFAULT_CONTENT_FALLBACK_PROMPT,
})

const cleanText = (value, max = 12000) => (typeof value === 'string' ? value.slice(0, max) : '')

export function normalizeSettings(input = {}, fallbackRoot = '') {
  const renderPrompts = input?.renderPrompts && typeof input.renderPrompts === 'object' ? input.renderPrompts : {}
  const inputSkills = input?.skills && typeof input.skills === 'object' ? input.skills : {}
  const rawContent = cleanText(input?.contentPrompt).trim()
  const contentPrompt = !rawContent
    ? DEFAULT_CONTENT_PROMPT
    : rawContent === LEGACY_CONTENT_PROMPT
      ? DEFAULT_CONTENT_PROMPT
      : rawContent
  const contentMode = input?.contentMode === 'builtin' ? 'builtin' : 'skill'
  return {
    projectsRoot: cleanText(input?.projectsRoot, 4000).trim() || fallbackRoot,
    referencesRoot: cleanText(input?.referencesRoot, 4000).trim(),
    // Legacy single-library override, imported once into the library registry.
    referenceRoot: cleanText(input?.referenceRoot, 4000).trim(),
    contentMode,
    skills: {
      content: inputSkills.content === undefined ? DEFAULT_SKILLS.content : cleanText(inputSkills.content, 200).trim(),
    },
    contentPrompt,
    contentFallbackPrompt: (() => {
      const raw = cleanText(input?.contentFallbackPrompt, 12000).trim()
      if (!raw || LEGACY_CONTENT_FALLBACK_PROMPTS.includes(raw)) return DEFAULT_CONTENT_FALLBACK_PROMPT
      return raw
    })(),
    renderPrompts: {
      default: cleanText(renderPrompts.default, 6000) || DEFAULT_RENDER_PROMPTS.default,
      preserve: cleanText(renderPrompts.preserve, 6000) || DEFAULT_RENDER_PROMPTS.preserve,
      compress: cleanText(renderPrompts.compress, 6000) || DEFAULT_RENDER_PROMPTS.compress,
    },
  }
}

export async function readSettings(file, fallbackRoot = '') {
  try {
    return normalizeSettings(JSON.parse(await readFile(file, 'utf8')), fallbackRoot)
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return normalizeSettings({}, fallbackRoot)
    throw error
  }
}

export function readSettingsSync(file, fallbackRoot = '') {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')), fallbackRoot)
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return normalizeSettings({}, fallbackRoot)
    throw error
  }
}

export async function writeSettings(file, input, fallbackRoot = '') {
  const settings = normalizeSettings(input, fallbackRoot)
  await mkdir(file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))), { recursive: true })
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return settings
}

export function writeSettingsSync(file, input, fallbackRoot = '') {
  const settings = normalizeSettings(input, fallbackRoot)
  mkdirSync(file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return settings
}
