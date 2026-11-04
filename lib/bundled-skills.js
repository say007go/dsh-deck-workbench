import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILLS_ROOT = fileURLToPath(new URL('../skills/', import.meta.url))
const BUNDLED = ['ppt-layout', 'html-layout', 'image-layout']

function parseSkill(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const hit = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!hit) continue
    let value = hit[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[hit[1]] = value
  }
  return { meta, body: text.slice(match[0].length) }
}

/**
 * Register the three layout skills as in-memory bundled skills.
 * Resources stay on disk under the plugin's skills/ directory, so the model can
 * still read references and run scripts without a separate skill installation.
 */
export function registerBundledSkills(ctx, injectedSkills) {
  const skills = injectedSkills?.skills || injectedSkills
  if (!skills || typeof skills.register !== 'function') return []
  const registered = []
  for (const name of BUNDLED) {
    const dir = join(SKILLS_ROOT, name)
    const file = join(dir, 'SKILL.md')
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      ctx.logger?.warn?.(`[deck-workbench] bundled skill ${name} missing: ${error.message}`)
      continue
    }
    const { meta, body } = parseSkill(text)
    const content = `> 技能资源目录：${dir}
> 本技能中的 \`scripts/\`、\`references/\`、\`assets/\` 均相对于此目录；执行脚本时使用绝对路径，或先 cd 到该目录。

${body.trim()}
`

    const definition = {
      name: meta.name || name,
      description: meta.description || `Bundled ${name} layout skill`,
      ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
      content,
      source: 'bundled',
      path: file,
      resourceBase: { kind: 'directory', path: dir },
      invocation: { modelInvocable: true, userInvocable: true },
      metadata: { bundledBy: 'dsh-deck-workbench', resourceDirectory: dir },
    }
    try {
      const dispose = skills.register(definition)
      if (typeof dispose === 'function') {
        ctx.effect?.(() => dispose, `deck-workbench bundled skill ${name}`)
      }
      registered.push({ name: definition.name, dir })
    } catch (error) {
      ctx.logger?.warn?.(`[deck-workbench] bundled skill ${name} registration failed: ${error.message}`)
    }
  }
  return registered
}

export { SKILLS_ROOT, BUNDLED }
