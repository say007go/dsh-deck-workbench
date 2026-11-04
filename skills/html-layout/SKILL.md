---
name: html-layout
description: "把用户已有的PPT页面原文精确排版为16:9、可独立打开的HTML页面。按配置的参考库检索参考页，继承其视觉语言与信息密度；只取词删词、不改写。不制作PPTX、不生图、不撰写业务内容。"
---

# html-layout

本技能只负责 HTML 路线：输入用户已有的页面原文，交付可独立打开的 HTML 页面。不再询问“HTML 还是图片”，不切换到生图路线，也不调用其它 skill。

参考库由 `scripts/reference_root.py` 解析（`--reference` / `DECK_REFERENCE_ROOT` / 工作台配置），技能目录内不保存参考库素材；所有脚本从参考库读取页码、清晰图和元数据。

视觉语言由参考库的 `style.json` 提供；没有 profile 时回退以下当前默认：纯白全页背景，黑色文字，单主色及其平涂浅色；以文字、信息图、关系图示和适量功能图标表达。除非用户明确要求，不使用照片、场景插画、底图、纹理或装饰性背景。图形要边界清楚、线条明确、层次可分辨，适合后续用PPT原生二维对象重建；不用渐变、光效、阴影、立体透视或模糊叠化表现关系。复杂度来自内容关系，不来自视觉特效。这约束视觉风格，不预设页面布局。

参考库有 `style.json` 时，先运行 `scripts/style_profile.py` 读取 tokens（背景/文字/主色/浅色/线、字体、字阶、密度、图像策略）；它们只描述视觉语言，不规定栏目、坐标或结构。没有 `style.json` 时使用上一段当前默认。

## 开始时读取

- 必读 [文字保真](references/copy-policy.md) 和 [设计验收](references/design-quality.md)。
- 首次使用或不熟悉调用时读 [检索与制作](references/workflow.md)。
- DSH 的工具契约、路径、权限与环境约定见 [DSH 集成](references/dsh-integration.md)。
- HTML 接口见 [制作接口](references/rendering.md) 和 [HTML路线](references/html-mode.md)。
- 参考库的完整导航在 `<参考库>/references/library-map.md`；不假设它在技能目录内。

## 必要工作流程

1. 用 `scripts/snapshot_source.py --page <源文案> --out <工作区>/source.txt` 原样复制本次原文，保留数字、标点和换行；不要手打、不要先清洗 Markdown。随后不得为通过检查修改原文。识别并列、递进、映射、交叉、层级、闭环等真实内容关系；据此规划 HTML 结构。若源文案是 Markdown 表格，`source.txt` 保留原始 Markdown，表格语法在 copy-plan 中作为 omission 处理，不进入可见文字。
2. 用 `scripts/find_reference.py` 在参考库中本地检索，默认返回约 8 个候选，用 `--gallery` 生成候选总览。不默认只查精选页，也不一次读入整库或全部清晰图。
3. 实际查看总览（`read_image`），打开约 2–4 张相关清晰图；需要时读对应 `references/pages/NNN.json` 的文字量、对象边界和样式。候选不适合则扩展检索，不能用索引标签代替看图。
4. 看完后写内部 `reference-choice.json`：所选参考页、当前内容关系、每页的具体观察、借用的视觉语言、明确不用的元素，以及本页的设计意图/重组方法；用户明确要求创新时，再记录至少一个认真考虑过的不同方向及取舍（不强制数量）。参考图只传递视觉语言与信息密度，不当布局模板。运行 `scripts/check_reference.py`；不通过不进入制作。该文件是证据记录，不规定栏目、坐标或结构。
5. Agent 先取词、审慎删词，形成上图文案和 `copy-plan.json`，运行 `scripts/check_copy.py --page-file <源文案>` 检查原文是否逐字一致、出处、顺序、覆盖及受保护词，并人工复核语义。保留实质论点、必要支撑和关键限定；标题、总领段、主体属于内容层级，缺文字时不能补写。
6. 在工作区制作 `slide.html` 模板：1920×1080 CSS 画布，可见文字使用空 `data-copy` 节点，文字层级和 CSS 图示精确控制；只用本次授权素材，不用参考页截图作背景。运行 `scripts/export_html.py`，将来源切片实际写进 HTML，内嵌本地图片与 CSS 资源，加入随窗口等比缩放；审计写到工作区，不写交付目录。
7. 打开最终 HTML，确认无需文字注入也能显示，并在 1920×1080 和较小的常用窗口查看；DSH 侧栏可预览 HTML（交互预览会执行缩放脚本，静态预览不执行，可能裁切）。检查语义、可读性、信息密度和参考风格；无法兼顾关键内容与可读性时说明冲突，不静默改字、拆页或切路线。
8. 多页检查主体重复与阅读节奏，不为多样性强换形式。交付独立 `.html` 文件及必要资源（优先单文件），默认不附 PNG；内部截图、脚本、计划、审计默认不附，用户另要时再给。不能无条件保证服务可用、中文零错误或任何文案都一遍达到参考质量。

参考不是只取配色：借鉴合适的结构和图文组织后重组，成品与选定参考并排检视，记录层级、图示解释力、图文对应、可读密度及空间利用的差距再修正。仅文字放得下、配色相似或程序检查通过，不算达到参考效果。如果成品与参考的骨架相近，要说明这是内容关系需要，还是只是参考的默认；前者可以保留，后者重做或如实告知，不为“看起来不同”强加装饰。详见设计验收的“参考效果怎样落实”。

## 快速调用

在工作区运行脚本，输出写本次工作区，不写参考库；不安装新依赖。

```text
python scripts/style_profile.py --css
python scripts/snapshot_source.py --page <源文案> --out <工作区>/source.txt
python scripts/find_reference.py --query "五阶段，每阶段有任务成果，第三阶段双线并行" --relation "matrix flow comparison" --density high --blocks 5 --gallery <工作区>/candidates.png
python scripts/check_reference.py --choice <工作区>/reference-choice.json --candidates <工作区>/candidates.json --reference <参考库>
python scripts/check_copy.py --source <工作区>/source.txt --plan <工作区>/copy-plan.json --page-file <源文案> --report <工作区>/copy-audit.json
python scripts/export_html.py --html <工作区>/slide.html --source <工作区>/source.txt --plan <工作区>/copy-plan.json --page-file <源文案> --output <工作区>/page-01.html --report <工作区>/P01.audit.json
```

`scripts/render_slide.py` 可用于内部排版检查和截图；截图默认不交付。它优先用 Playwright 自带 Chromium，缺失时回退已安装浏览器；DSH 默认沙箱会拦截浏览器子进程，需要截图时先说明并申请一次更宽权限。未获批就做静态检查 + 让用户在侧栏或浏览器查看。

## 参考库与边界

参考库根由 `scripts/reference_root.py` 解析；下列路径均相对参考库根：

- `assets/pages/NNN.webp`：1920×1080 清晰页图，是必需栅格源；agent 只看这些，不使用其它技能目录内的副本。
- `assets/thumbs/`、`assets/contacts/`：可选缓存；缺失时 `find_reference.py` 从 pages 缩放，不报错。
- `references/index.jsonl`、`corpus.jsonl`、`pages/NNN.json`：检索元数据；脚本按需读取，不整份加载。
- `references/library-map.md`：全库导航，检索不足时手动浏览。
- `manifest.json`：页数、源文件 hash、素材编码；页数以 manifest 为准，不写死。

参考库是固定快照，不自动同步原文件；更新须由用户明确要求并验收新版本。由 LibreOffice 导出的渲染图可能与 PowerPoint 有细节差异；使用候选前仍看清晰图，不继承源稿的拥挤、裁切或历史事实。

## 与其它能力的分工

本技能只负责“已有页面原文 → HTML”。原生可编辑 PPTX、整套方案内容、课程/师资检索由当前环境中的其它能力负责；本技能不自动调用或依赖任何具体 skill。任务若需要 PPTX 或整套内容，应明确告知用户切换到相应能力。
