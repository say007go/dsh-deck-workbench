---
name: image-layout
description: "把用户已有的PPT页面原文交给生图模型，生成16:9方案页面图片。按配置的参考库检索参考页，完整原文、取词删词规则和参考图交给模型自由设计；不制作PPTX、不写HTML、不撰写业务内容。"
---

# image-layout

本技能只负责 imagegen 路线：输入用户已有的页面原文，实际调用生图工具生成 16:9 页面图片。不再询问“HTML 还是图片”，不切换到 HTML 路线，也不调用其它 skill。

参考库由 `scripts/reference_root.py` 解析（`--reference` / `DECK_REFERENCE_ROOT` / 工作台配置），技能目录内不保存素材；脚本从参考库读取页码、清晰页图和元数据。

视觉语言由参考库的 `style.json` 提供；没有 profile 时回退以下当前默认：纯白全页背景，黑色文字，单主色及其平涂浅色；以文字、信息图、关系图示和适量功能图标表达。除非用户明确要求，不使用照片、场景插画、底图、纹理或装饰性背景。图形要边界清楚、线条明确、层次可分辨，适合后续用PPT原生二维对象重建；不用渐变、光效、阴影、立体透视或模糊叠化表现关系。复杂度来自内容关系，不来自视觉特效。这约束视觉风格，不预设页面布局；生图模型可自主决定构图、图示与文字取舍。

参考库有 `style.json` 时，先运行 `scripts/style_profile.py` 读取 tokens（背景/文字/主色/浅色/线、字体、字阶、密度、图像策略）；它们只描述视觉语言，不规定构图、分区或图形。没有 `style.json` 时使用上一段当前默认。

## 开始时读取

- 必读 [文字保真](references/copy-policy.md) 和 [设计验收](references/design-quality.md)。
- 首次使用或不熟悉调用时读 [检索与制作](references/workflow.md)。
- 生图工具契约、路径、权限与环境约定见 [DSH 集成](references/dsh-integration.md)。
- imagegen 接口见 [制作接口](references/rendering.md) 和 [imagegen路线](references/imagegen-mode.md)。
- 参考库完整导航在 `<参考库>/references/library-map.md`；不假设它在技能目录内。

## 必要工作流程

1. 用 `scripts/snapshot_source.py --page <源文案> --out <工作区>/source.txt` 原样复制本次原文，保留段落、数字、标点和换行；不手打、不清洗 Markdown。随后不得为通过检查修改原文。识别并列、递进、映射、交叉、层级、闭环等真实内容关系；只记录语义，不预先指定页面布局。
2. 用 `scripts/find_reference.py` 在参考库中本地检索，默认返回约 8 个候选，用 `--gallery` 生成候选总览。不默认只查精选页，也不一次读入整库或全部清晰图。
3. 实际查看总览（`read_image`），选择并打开约 1–3 张相关清晰图；需要时读对应 `references/pages/NNN.json` 的文字量、对象边界和样式。候选不适合则扩展检索，不能用索引标签代替看图。
4. 看完后写内部 `reference-choice.json`：所选参考页、当前内容关系、每页的具体观察、借用的视觉语言/信息表达品质、明确不用的元素，以及本次的设计意图；用户明确要求创新时，再记录至少一个认真考虑过的不同方向及取舍（不强制数量）。只记录视觉语言、信息密度与真实内容关系，不制定分栏、坐标、区域比例、阅读路径或指定图形；参考图不是待复制的布局模板。运行 `scripts/check_reference.py`；不通过不进入制作。记录不进入客户页面。
5. Agent 不预选、不压缩、不改写正文；完整原文连同取词删词规范、内容关系及风格参考一起交给模型，由模型结合设计自主取舍。只有用户明确要求全文逐字呈现时才启用 `verbatim_required`。完整原文输入不等于全文必须上图；标题、总领段、主体是语义层级，不固定位置。
6. 用 `scripts/prepare_imagegen.py` 生成提示词，完整原样纳入 `source.txt`，附文字规则和已看过的参考图路径；不给明确页面布局要求，不先做 HTML 让模型照着画。然后实际调用当前环境的生图工具（本环境为 `image_generate`），按 [DSH 集成](references/dsh-integration.md) 先展示提示词全文、尺寸、参考图来源和保存路径，再请用户确认；只有用户确认后才提交。
7. 生成后用 `read_image` 查看真实图片和 `actual_size`，对照完整 `source.txt` 核对实际可见文字，记录出处、删词及核心内容覆盖；不能把“原文已完整传入”当成图中文字已保真。检查标题与总领意思、实质论点、必要支撑、关系、可读性、参考风格和 16:9；有问题定向修正，保持其它合格部分。
8. 多页检查主体重复与阅读节奏，不为多样性强换形式。交付实际生成并核验的图片；内部提示词、截图、计划和审计默认不附，用户另要时再给。不能无条件保证服务可用、中文零错误或任何文案都一遍达到参考质量；不能静默拆页、叠加 HTML 文字或切换路线。

参考不是只取配色：实际把已看过的参考图片传给模型，并说明它们的单色视觉语言、图文融合、信息密度和层次；成品与选定参考并排检视，记录层级、图示解释力、图文对应、可读密度及空间利用的差距再修正。仅文字放得下或配色相似，不算达到参考效果。如果成品与参考骨架相近，要说明这是内容关系需要，还是只是参考的默认；前者可以保留，后者重做或如实告知，不为“看起来不同”加装饰。详见设计验收的“参考效果怎样落实”。

## 快速调用

在工作区运行脚本，输出写本次工作区，不写参考库；不安装新依赖。

```text
python scripts/style_profile.py --css
python scripts/snapshot_source.py --page <源文案> --out <工作区>/source.txt
python scripts/find_reference.py --query "五阶段，每阶段有任务成果，第三阶段双线并行" --relation "matrix flow comparison" --density high --blocks 5 --gallery <工作区>/candidates.png
python scripts/check_reference.py --choice <工作区>/reference-choice.json --candidates <工作区>/candidates.json --reference <参考库>
python scripts/prepare_imagegen.py --source <工作区>/source.txt --brief <工作区>/imagegen-brief.json --pages 15 26 --output <工作区>/imagegen-prompt.txt
```

`prepare_imagegen.py` 只生成提示词，不调用模型；生成必须实际调用当前环境的生图工具。工具缺失时如实说明阻塞，提出安装对应生图能力或改用 HTML，不假造执行、不自行写API调用器、不静默切路线。

## 参考库与边界

参考库根由 `scripts/reference_root.py` 解析；下列路径均相对参考库根：

- `assets/pages/NNN.webp`：1920×1080 清晰页图，是必需栅格源；作为参考图实际传入模型。
- `assets/thumbs/`、`assets/contacts/`：可选缓存；缺失时 `find_reference.py` 从 pages 缩放，不报错。
- `references/index.jsonl`、`corpus.jsonl`、`pages/NNN.json`：检索元数据；脚本按需读取，不整份加载。
- `references/library-map.md`：全库导航，检索不足时手动浏览。
- `manifest.json`：页数、源文件 hash、素材编码；页数以 manifest 为准，不写死。

参考库是固定快照，不自动同步原文件；更新须由用户明确要求并验收新版本。由 LibreOffice 导出的渲染图可能与 PowerPoint 有细节差异；参考图只传递视觉语言与信息表达品质。当前实现会把本地参考图压缩后上传生图服务，使用前告知用户。

## 与其它能力的分工

本技能只负责“已有页面原文 → 图片”。原生可编辑 PPTX、整套方案内容、课程/师资检索由当前环境中的其它能力负责；本技能不自动调用或依赖任何具体 skill。任务若需要 PPTX 或整套内容，应明确告知用户切换到相应能力。
