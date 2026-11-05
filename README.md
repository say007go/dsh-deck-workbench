# dsh-deck-workbench

DSH（DeepSeek Harness）方案工作台插件：把项目文件、内容对话、逐页文案、参考库和页面产物放进同一个工作台。内容生成、文案确认、页面生成、版本回看都在一个项目里完成，适合需要反复打磨的企业培训方案、汇报材料和 PPT 页面。

> 当前版本：**0.1.43** · License：MIT

## 它解决什么问题

做一套方案 PPT，通常会在几个地方来回切换：需求文档、聊天窗口、逐页文案、参考稿、PPT/HTML/图片产物。这个插件把这条链收进一个项目文件夹：

- 内容技能或内置提示词写 `content/pages/P01.md`、`P02.md`……
- 确认后的文案可以在工作台里回看、比较、恢复
- 页面生成直接调用内置排版技能，产出原生 PPTX、HTML 或图片
- 参考库只作为视觉参考，不套用整页模板

## 功能特性

### 项目、内容对话与文案版本

- 新建项目时填写客户、项目名、需求正文，上传需求附件
- 每个项目自动创建一个同名 workspace，内容对话运行在项目目录下
- 页面文案保存在 `content/pages/Pxx.md`
- 文案自动保存历史版本，支持 diff、确认和恢复
- 工作台显示页码 × 产物的状态矩阵，缺失或过期一目了然

### 内容生成可配置，不绑定固定技能

- 默认内容技能是 `page-content`，但名称可以在设置里修改
- 可以换成任何能被 DSH 加载的内容技能
- 也可以选择“不调用内容技能”，使用内置提示词
- 内置提示词会要求每页从页面内容提炼 60–120 字的总领段
- 内容技能只负责“写什么”，不负责版式

### 三种页面产物

- **PPTX**：调用 `ppt-layout` 生成原生可编辑页面
- **HTML**：调用 `html-layout` 生成独立可打开的 16:9 HTML
- **图片**：调用 `image-layout`，经 `image_generate` 生成 16:9 页面图片

三个排版技能随插件内置，不需要单独安装。

### 参考库

- 参考库独立于项目，默认与 `<项目根>` 同级的 `references` 目录
- 可以保存多个参考库，分别放在 `references/<库名>`，同一时间只激活一个
- 上传任意参考 PPTX 后，后台构建页面图、检索索引、几何签名和风格 token
- 三个排版技能在运行时读取当前激活库，不把参考稿打进插件
- 支持新建、切换、重命名、删除、重新构建和校验
- 参考库可能包含客户资料，不会被提交到仓库或打进安装包

### 所见即所得的提示词设置

- 设置页分为“提示词设置 / 参考库 / 其他设置”
- 内容生成二选一：调用内容技能 / 不调用内容技能
- 选中哪个，就只显示哪个对应的提示词
- 底部显示“实际发送的提示词”，固定文字 + 当前输入会完整拼在一起
- 可以分别调整内容要求、优化此页和页面生成规则

## 工作流

```text
新建项目
  → 打开项目内容对话
  → 内容技能 / 内置提示词生成框架与页面蓝图
  → 确认蓝图并逐页写 content/pages/Pxx.md
  → 在工作台确认文案
  → 选择页面与产物类型
  → 排版技能读取参考库并生成 PPTX / HTML / 图片
  → 预览、审计、回看和迭代
```

内容技能不存在时，可以切到内置提示词；不会因为缺少某个固定技能而卡住。

## 安装

在 DSH 插件页添加本仓库地址，安装后启用 `dsh-deck-workbench` 并重启 DSH。

如果使用命令行，命令形如：

```bash
dsh plugin --profile <你的 profile> add <本仓库地址>
```

## 快速开始

1. 安装并启用插件，重启 DSH；
2. 打开左侧栏 **方案工作台**；
3. 点 **新建项目**，填写客户、项目名和需求；
4. 创建后进入项目内容对话，生成框架和蓝图；
5. 确认蓝图，逐页生成 `content/pages/P01.md` 等文案；
6. 回到工作台，选页预览文案，按需生成 PPTX / HTML / 图片；
7. 在设置里上传参考 PPTX，构建并激活第一个参考库。

## 设置

### 提示词设置

- **内容生成**：调用内容技能 / 不调用内容技能
- **内容技能**：默认 `page-content`，可以填写其他技能名
- **内置提示词**：不调用内容技能时使用，可编辑
- **内容要求**：页数、结构、写作约束等
- **实际发送的提示词**：完整预览，不是示例
- **优化此页 / 生成页面**：固定系统指令和可编辑的版式取舍规则

### 参考库

- 新建参考库：填写库名，上传 `.pptx`
- 每个库独立保存页面图、索引、manifest 和构建时间
- 列表里切换当前库；同一时间只有一个当前库
- 支持重命名、删除、重新构建和校验
- 旧版 `projects/_reference` 会在升级时自动登记并迁移到 `references/方案排版参考` 或 `references/参考库`

### 其他设置

- 项目根目录（参考库自动放在与 `projects` 同级的 `references`，不需要单独设置）
- 图片生成能力检测和重新检测
- 刷新能力状态
- 恢复默认提示词

设置文件：

```text
~/.dsh/storages/deck-workbench/settings.json
~/.dsh/storages/deck-workbench/references.json   # 参考库注册表
~/.dsh/storages/deck-workbench/reference.json    # 当前激活库指针
```

修改项目根目录后需要重启 DSH；只影响新建项目，已有项目不迁移。参考库根目录自动跟随项目根目录推导，不单独显示。

## 目录结构

```text
dsh-deck-workbench/
├── README.md
├── AGENTS.md
├── LICENSE
├── package.json
├── cordis.patch.yml
├── icon.svg
├── client/
│   └── client.js
├── lib/
│   ├── index.js
│   ├── projects.js
│   ├── history.js
│   ├── settings.js
│   ├── references.js
│   ├── preview.js
│   └── http.js
├── locale/
├── skills/
│   ├── ppt-layout/
│   ├── html-layout/
│   └── image-layout/
└── tools/
    └── reference_builder.py
```

`dev-docs/` 是本地开发资料，不属于公开仓库，也不会进入安装包。

## 参考库目录

```text
DeckWorkbench/
├── projects/
│   └── <project-id>/
└── references/
    ├── 方案排版参考/
    ├── MBB 2026/
    └── ...
```

每个参考库内部结构一致：

```text
references/<库名>/
├── library.json
├── manifest.json
├── assets/
│   └── pages/
└── references/
    └── index.jsonl
```

同一时间只有一个当前库；切换当前库只更新 `reference.json`，所有排版技能立即读取新库。

## 产物与项目目录

```text
<项目根>/<项目>/
├── project.json
├── content/
│   ├── brief.md
│   ├── input/
│   └── pages/
│       ├── P01.md
│       └── P02.md
├── renders/
│   ├── pptx/
│   ├── html/
│   └── image/
└── workbench/
```

## 运行要求

- DSH 宿主，且 `skills`、`webServer`、`tools` 等服务可用
- Python 3.10+
- LibreOffice（PPTX 预览和参考库 PDF 渲染）
- Python 依赖：`python-pptx`、`PyMuPDF`、`Pillow`，参考库构建另需 `lxml`
- 图片路线需要可用的 `image_generate` 工具
- 内容技能可选；不安装内容技能时使用内置提示词

## 已知限制

- 项目根目录修改后需要重启 DSH 生效，只影响新建项目
- 多参考库是全局单活：切换后影响所有项目，暂不支持项目级覆盖
- 内容会话依赖宿主 workspace 服务
- PPTX 预览依赖本机 LibreOffice；转换失败时提供原文件下载
- 工作台未运行时发生的文案修改可能漏记历史；启动时会补当前版本
- 产物重新生成会覆盖原文件，不保留产物历史
- 三栏宽度只在当前页面会话内生效，未持久化
- 不提供版式模板；排版逻辑在三个内置排版技能中
- 不包含内容技能、参考 PPT 或任何参考库素材，这些由用户自行安装/上传

## License

MIT。见 [LICENSE](LICENSE)。
