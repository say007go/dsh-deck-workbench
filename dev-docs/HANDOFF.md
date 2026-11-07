# HANDOFF — dsh-deck-workbench

> **新 agent / 新对话先读这里。** 本目录随仓库版本控制，只排除在 npm 包外。阅读顺序：本文件 → [SPEC.md](SPEC.md) → [DESIGN.md](DESIGN.md) → [AUDIT.md](AUDIT.md) → [README.md](../README.md)，并遵守 [AGENTS.md](../AGENTS.md) 的编辑边界。

- 快照日期：2026-11-07
- 当前版本：**0.1.52**
- 插件目录：`<插件根>`
- 设计规格：[SPEC.md](SPEC.md)
- 使用说明：[README.md](../README.md)
- 流程审计：[AUDIT.md](AUDIT.md)

## 1. 当前定位

DSH 方案工作台插件：管理项目文件夹、打开项目专属内容会话、维护逐页文案版本、按需触发 PPTX/图片/HTML 生成并在工作台预览。

工作台**不重写**内容/排版/生图技能；它只负责：

- 项目与文件协议；
- 项目 workspace / session；
- 文案版本与确认；
- 页面级提示词发送；
- 产物预览和状态矩阵。

## 2. 关键路径

```text
<插件根>
├─ README.md
├─ dev-docs/
│  ├─ SPEC.md
│  ├─ HANDOFF.md
│  ├─ DESIGN.md
│  └─ AUDIT.md
├─ package.json
├─ cordis.patch.yml
├─ lib/
│  ├─ index.js          # host apply / HTTP 路由 / 根目录
│  ├─ projects.js       # 项目 CRUD / 历史 / 文件协议
│  ├─ history.js        # 2s 扫描与文案快照
│  ├─ settings.js       # 全局设置归一化与唯一默认值来源
│  ├─ references.js     # 多参考库注册表与状态
│  ├─ reference-build.js# 参考库构建任务（子进程 + 进度）
│  ├─ preview.js        # PPTX→PDF/PNG（并发去重）/ 系统打开
│  ├─ bundled-skills.js # 三个内置排版技能的注册
│  └─ http.js
├─ client/client.js     # 手写 __ModuleLoader__ 客户端 bundle
├─ skills/              # ppt-layout / html-layout / image-layout
├─ tools/reference_builder.py
├─ test/                # node --test：inside / references / approval / http
├─ locale/
└─ icon.svg
```

默认项目根：

```text
<项目根>
```

全局设置文件（**独立于项目根，换根目录后仍保留**）：

```text
~/.dsh/storages/deck-workbench/settings.json
```

旧版设置文件 `<项目根>/settings.json` 只作为迁移来源，启动时若全局设置不存在会读取它并写入全局设置。

参考素材库：默认根为 `<projectsParent>/references`（可用 `referencesRoot` 覆盖），库目录名直接使用中文库名；注册表在 `~/.dsh/storages/deck-workbench/references.json`，当前库指针在 `reference.json`。`ppt-layout` / `html-layout` / `image-layout` 都读取当前激活库，技能目录不保存参考素材。`slide-layout` 已退役。

## 3. 当前设置模型

设置页三个标签：

1. **提示词设置**
   - 第一项“内容生成”二选一：调用内容技能 / 不调用内容技能；
   - 内容生成方式 `contentMode`：`skill` / `builtin`；
   - 内容技能 `skills.content` 可选；调用时显示对应提示词；
   - 不调用技能时的内置提示词 `contentFallbackPrompt`；默认要求每页从页面内容提炼一小段提纲挈领的总领段；
   - 内容默认要求 `contentPrompt`，两类共用；
   - 三套版式取舍规则 `renderPrompts.default / preserve / compress`；
   - 优化此页不设预设，反馈每次在弹窗填写。
2. **参考库**
   - 可保存多个库，目录为 `references/<中文库名>`；
   - 新建库时填写库名并上传 PPTX；后台构建到该库目录；
   - 列表显示页数、路径、构建时间、可用状态；同一时间只有一个当前库；
   - 支持切换、重命名、删除、重新构建、校验；
   - 旧 `_reference` 升级时自动登记并迁移；没有默认库。
3. **其他设置**
   - 项目根目录 `projectsRoot`；参考库根目录自动推导为同级 `references`，界面不再单独显示；
   - 项目根保存后**重启 DSH 生效**；参考库根只影响新建库；
   - 图片生成能力显示和“重新检测”；
   - 刷新能力状态、恢复默认提示词、路径复制。

0.1.31 起移除只读的“固定规则”标签（内容与提示词设置页重复，没有操作价值）。0.1.33 起增加“技能与参考库”标签。

设置 API：

```text
GET  /deck-workbench/api/settings
POST /deck-workbench/api/settings
GET  /deck-workbench/api/skills/available?name=<skill>&cwd=<project>
GET  /deck-workbench/api/reference/status
GET  /deck-workbench/api/reference/job
POST /deck-workbench/api/reference/activate
POST /deck-workbench/api/reference/upload
POST /deck-workbench/api/reference/rebuild
POST /deck-workbench/api/reference/validate
PATCH  /deck-workbench/api/reference/libraries/:id
DELETE /deck-workbench/api/reference/libraries/:id
```

返回包含：

- `settings`；
- `root`（当前进程实际使用的根目录）；
- `restartRequired`（保存值与当前运行根目录不一致时为 true）。

## 4. 必须保留的约束

- DSH `session.create` 的 `workspaceId` 与 `cwd` **互斥**，不能同时传。
- `workspaces.create` 返回的 workspace 字段是 `workspaceId`，不是 `id`。
- 项目 workspace 先创建/解析，再 `sessions.create({ workspaceId })`；失败时回退 `uiWorkspace.connectWorkspace`。
- 项目目录由 `projectsRoot + projectId` 组成；所有文件操作必须经过路径守卫。
- 生成提示词固定要求不得回写 `content/pages/*.md`；版式技能只能写 `renders/`。
- 系统指令（内容技能或内置默认启动、优化此页、HTML/图片/PPTX 格式）在 UI 中只读，改动应改代码而不是设置。
- 项目根目录改动只影响新建项目，不做自动迁移。

## 5. 当前提示词结构

### 新建 / 空白项目首次打开

```text
项目目录：<project.path>
需求文件：content/brief.md，需求附件在 content/input/。
请使用 <settings.skills.content> 技能：先读取需求，输出项目框架与页面蓝图；等我确认蓝图后，再逐页写 content/pages/P01.md、P02.md……
不要写版式、页面类型/关系、机器编号或视觉建议；只交内容。
内容要求：
<settings.contentPrompt>
```

### 优化此页

```text
项目目录：<project.path>
页面：<page.id> <page.title>
当前文案：content/pages/<page.id>.md
请只优化这一页，保留其他页面不变。先读取当前文案，再按下面的反馈修改，并把结果写回同一路径。
不要添加版式、页面类型/关系、机器编号或视觉建议。
反馈：<优化弹窗中用户填写的完整内容>
```

### 生成页面

```text
项目目录：<project.path>
页面：<page.id> <page.title>
源文案：content/pages/<page.id>.md
产物路径：renders/{pptx|image|html}/<page.id>.*
请使用 <skill> 为这一页制作页面。<固定产物要求>
<选中的版式取舍规则，或本页临时备注>
不要回写 content/pages 下的源文案。
```

## 6. 已验证

- 全部 JS `node --check` 通过。
- Host 项目 CRUD、历史、审批/恢复、删除临时项目通过。
- PPTX→PDF 预览通过。
- 侧栏 `sidebar.panellist` 与 `main` 注册通过。
- 设置 API 通过：返回 `settings / root / restartRequired`，全局设置文件已落盘。
- 项目 workspace + session 创建通过（历史验证；项目可能已被用户删除）。
- 设置页两标签布局已做组件级验证；真实 DSH 内的主题观感、根目录选择器、三栏拖动仍需目测。
- 0.1.30：设置弹窗改为固定高度（`min(720px, 88vh)`），标题/标签栏/底部按钮固定，仅内容区滚动；已用 Playwright 加载真实 `SettingsModal` 组件验证各标签高度一致（1440×900 下均为 840×720）、内容区滚动、底部按钮可见，1280×720 下高度 633.6 且完整落在视口内。
- 0.1.31：移除“固定规则”只读标签，设置页由三标签变为两标签；组件级复测两个标签高度仍一致，提示词页可滚动、底栏常驻。真实 DSH 内的明暗主题外观仍需刷新后目测。
- 阶段 A（参考库外置，插件代码未改）：
  - `<projectsRoot>/_reference` 已创建：搬迁时 853 个文件、79,570,497 字节逐文件 SHA-256 一致；删除可再生的 thumbs 后为 583 个文件、约 69MB；
  - 工作台共享参考库（不在插件包内）目录含 272 张 1920×1080 WebP、23 张总览图、`reference.pptx`、`index/corpus/pages`、`page-index/page-signature`、`manifest.json`；`thumbs` 改为可选缓存，缺失时 `find_reference.py` 从 pages 缩放；
  - `slide-layout/scripts`（阶段 A 时的实现，逻辑后迁入 `html-layout` / `image-layout`）支持 `--reference` / `DECK_REFERENCE_ROOT` / `reference.json` / 技能内副本回退，默认解析到外部库；
  - 5 组检索 query 的候选页、顺序、分数与本地库完全一致；删除 thumbs 后复测仍一致；总览图改由 pages 缩放生成，像素与旧预生成 thumbs 略有差异，候选选择与最终生成不受影响；
  - `prepare_imagegen.py` 在两条路径下生成的提示词除参考图绝对路径外逐字一致，原文 SHA-256/字符数相同；
  - `validate_library.py` 通过（thumbs 可选、contacts 可选）；`ppt-layout` 的 `reference.pptx` / `page-index` / `page-signature` 哈希一致，`probe_spec` / `scan_parts --spec` 输出一致；
  - `_reference` 不会被 `listProjects` 识别为项目；插件客户端代码与提示词未改。
  - `ppt-layout` 已切换：`probe_spec.py` / `scan_parts.py` 默认解析共享库，`check_deps.py` / `selfcheck.py` 通过；技能内副本保留为回退。
- 阶段 B（拆分与插件切换）：
  - `slide-layout` 拆成 `html-layout`（仅 HTML）和 `image-layout`（仅 imagegen）；两个新技能不带本地素材、不点名其他 skill，参考库由 `scripts/reference_root.py` 解析；
  - 两个新技能的检索结果与旧 `slide-layout` 五组 query 一致；`image-layout` 的 `prepare_imagegen` 提示词与旧 imagegen 路线逐字一致；`html-layout` 的 `export_html` 样例导出通过；
  - 插件提示词已切到 `html-layout` / `image-layout` / `ppt-layout`，版本 0.1.32；`slide-layout` 移出 skills 目录，旧备份保留。
  - 流程加固：`snapshot_source.py` 原样复制 source，`check_copy.py --page-file` 校验；`reference-choice.json` + `check_reference.py` 作为制作前证据门槛；`export_html.py --report` 把审计写到工作区。只查证据/出处，不规定版式。
- 阶段 C（0.1.33–0.1.34，设置与能力检测）：
  - 设置 API 新增 `referenceRoot`、`skills`；宿主返回参考库状态（根、页数、index/pages 是否可用）和 `image_generate` 检测结果；
  - 宿主启动不再写死盘符或无条件创建配置根；项目根从设置读取，无设置时回退 `<home>/DeckWorkbench/projects`；
  - 客户端新增“技能与参考库”标签；参考库、可选内容技能可配；`image_generate` 检测只提示，不阻止图片按钮，工具缺失时由技能正常报错；
  - HTML/图片/PPTX 提示词使用固定的内置技能名；内容启动提示词读 `skills.content`，缺失时使用内置默认提示词；
  - 组件级验证三个标签高度一致、底栏常驻；宿主设置 API 用 mock 服务验证返回 `reference`/`imagegen`、引用库 272 页、图片可用；真实 DSH 重启仍需复测。
  - 0.1.34：去掉图片目标的预禁用逻辑；检测只做提示，图片标签页和新建项目的图片按钮始终可用，工具缺失时由技能在生成阶段报错。
- 阶段 D（起步）：
  - 参考库新增 `style.json`，记录当前 house tokens（背景/文字/主色/浅色/线、字体、字阶、密度、图像策略）；同时保留参考稿实测 `source_palette` 供构建器参考；
  - `html-layout` / `image-layout` 新增 `style_profile.py`，从参考库读取 tokens，缺失时回退当前默认；tokens 不规定版式；
  - `tools/reference_builder.py`：任意 PPTX → LibreOffice PDF → 1920×1080 WebP + index/corpus/pages/page-index/page-signature/manifest/style/library-map；`primary_family`/`relations` 标记 `builder_auto`，生成 `annotation-template.jsonl`，可用 `--apply-annotations` 合并；`--force` 保留备份；
  - 已用 3 页测试稿和真实参考稿 `--limit 3` 验证；auto 库在 `validate_library` 中只报“Unreviewed layout”，补标注后通过。
- 阶段 E（0.1.35，内置布局技能与独立内容）：
  - `html-layout` / `image-layout` / `ppt-layout` 已复制到插件 `skills/`，启动时用 `ctx.skills.register` 注册为内存内置技能；外部独立安装的三个目录已移到 `skills-retired/layouts-2026-11-04`；
  - 设置去掉三个排版技能选择，只保留可选“内容技能”；内容技能留空/不可用时，客户端用内置默认文案提示词；
  - 宿主新增 `/api/skills/available`，用 `ctx.skills.list({cwd})` 检测内容技能；真实宿主里插件 scope 可能漏掉用户级 skill，已加项目/用户 `SKILL.md` 文件兜底。
  - 内置 `ppt-layout` 去掉本地参考副本，`probe_spec`/`scan_parts`/`selfcheck` 对共享库输出与外部版一致；`selfcheck` 已识别共享参考文件，全部通过。
  - 需重启 DSH 后验证内置技能在技能目录可见、加载和脚本路径。
  - 迁移：旧设置里的 `skills.pptx/html/image` 自定义值会被忽略，固定使用内置名；外部三个布局技能已移出 `~/.dsh/skills`，重启后只应由插件注册。
- 阶段 F（0.1.36，设置重构与参考库上传）：
  - 设置改为“提示词设置 / 参考库 / 其他设置”；
  - 第一项“内容生成”二选一：调用内容技能 / 不调用内容技能；新增可编辑 `contentFallbackPrompt`；内容生成改为完整提示词文档内联编辑；
  - 参考库改为上传 PPTX → 后台构建 → 进度轮询 → 自动写 `reference.json`；正常界面不再显示原始参考库路径；已有目录也放在参考库页覆盖；
  - 图片能力移到“其他设置”并增加“重新检测”；
  - 增加参考库替换确认、构建进度、重新构建、校验、路径复制、恢复默认提示词、保存脏状态。

### 0.1.37–0.1.51 当前状态（2026-11-05）

- 当前版本 **0.1.51**；公开 README 已重写，开发文档收进 `dev-docs/`，不随 npm 包或公开仓库发布。
- 参考库状态接口增加 `builtAt`；新增 `POST /api/reference/validate`，设置页“校验”会实际运行 `validate_library.py` 并显示错误。
- 重新构建参考库会通过 `--reuse-annotations` 复用旧 `references/index.jsonl` 中已复核的标注，避免 `--force` 把 agent 标注重置成 `builder_auto`。
- 当前共享参考库：272 页、`page-signature.jsonl` 272 行、14 个 primary family；`validate_library.py` 返回 `ok: true`。
- 三个排版 skill 不再有本地参考副本；`ppt-layout/references/page-guide.md` 已改成按共享参考库选页，不再写死 272 页页码。
- 代码扫描无本机盘符绝对路径；Python 通过 `DECK_PYTHON`/`PYTHON`/PATH，LibreOffice 通过 `PPT_SOFFICE`/`SOFFICE_PATH`/PROGRAMFILES/PATH。
- 内容生成设置：完整提示词文档内联编辑，固定规则只读；不再单列“实际发送的提示词”预览。
- 设置弹窗重设计：左侧分区导航、页面标题层级、文档式编辑区、固定底栏状态；参考库改为列表/虚线新建区，其他设置改为分区行式布局。
- 多参考库：`references.json` 注册表、当前库指针、中文库名目录、全局单活切换、重命名/删除、旧库迁移已接入；构建成功不再自动改当前指针，上传后由客户端调用激活。
- UI：项目卡片去掉静态 `phase` 徽标，改为标题/客户/已确认进度/有效产物/更新时间；产物预览区去掉重复的 `+PPT/+图/+HTML` 快捷按钮，每个 tab 内提供生成/重新生成；PPTX 预览改为 LibreOffice 首屏 PNG，PDF/PPTX 作为完整查看入口。
- 交接入口：先读本文件，再读 `SPEC.md`、`DESIGN.md`、`AUDIT.md`、`README.md`；改代码前按 `AGENTS.md` 的边界执行。

### 0.1.52（2026-11-07）

- 批准状态改为派生值：`workbench/pages.json` 不再写 `copyStatus`，`pageSummary` 用 `approvedHash === currentHash` 现算（没有 hash 时回退版本号比较）。改稿自动回到草稿；恢复到已确认的那版内容会自动重新算作已确认。
- 产物 HTML 响应加 `content-security-policy: sandbox allow-scripts` 和 `x-content-type-options: nosniff`，agent 生成的页面不再拥有与控制 API 的同源权限。
- 默认提示词只在 `lib/settings.js` 定义一份；`GET/POST /api/settings` 返回 `defaults`，客户端删掉本地副本，改为 `SERVER_DEFAULTS` 缓存。
- 删除设置里的 `skills.pptx/html/image` 死字段，只保留 `skills.content`。
- PPTX→PDF/PNG 转换按 `pptx.path` 去重，并发请求共用同一个 Promise，不再互相删掉产物。
- 测试 11 → 16 例：新增批准状态机（`test/approval.test.js`）与 HTML 响应头（`test/http.test.js`）。
- `dev-docs/` 重新纳入版本控制，只靠 `.npmignore` 与 `package.json files` 排除在包外。

## 7. 待办 / 已知限制

1. 在真实 DSH 主题下最终复测设置页三个标签、内容两种选择、参考库上传/重建/校验、图片能力重新检测和项目根目录保存；组件级测试已通过。
2. 项目根目录修改后重启才生效；旧项目不自动出现在新根目录。
3. 自动发送启动指令目前始终开启；用户曾讨论“手动开始”，但本轮未实现。若要做：加 `autoStart` 设置 + 项目详情“开始内容生成”按钮，手动按钮发送同一启动提示词；cwd/项目文件仍可读。
4. 产物重新生成会覆盖原文件，无产物版本历史。
5. 三栏拖动宽度未持久化。
6. 旧测试会话可能仍在“未分组”，可在 DSH 里删除。
7. 所有设置是工作台全局，不是每项目覆盖。
8. 设置页里的路径示例是占位，实际发送使用 `project.path`。

### 参考库与拆分后续

1. `ppt-layout` 的本地参考副本已移除；`slide-layout` 退役备份只在本地，不随插件发布。新参考库上传后要跑一次 annotation/review 流程。
2. 完成三个排版 skill 的独立化验证：不带本地素材、不点名其他 skill、可在任意配置的参考库上加载。
3. 参考库构建器基础版已完成：任意 PPTX → PDF/逐页图/索引/风格 profile；agent 仍需分批目视补 `primary_family`/`relations`，不能承诺全自动。缩略图/总览/多页联系表尚未内置，`find_reference --gallery` 可按需生成候选总览。
4. 开源整理：去本地路径、私有 skill 名、品牌色硬编码；参考稿与 profile 密钥不入库。
5. ~~插件设置增加参考库状态/路径、四个 skill 槽位与 `image_generate` 能力检测~~（后续改为：三个排版技能内置、只保留可选内容技能；0.1.35）。

## 8. 继续开发建议

优先顺序：

1. 确认真实 DSH 已加载 0.1.52：设置三个标签、参考库状态/校验、可选内容技能/默认文案、图片按钮、项目列表；
2. 新建真实项目走“会话 → 蓝图 → 页面 → 生成 PPTX/图片/HTML”全链路，验证共享参考库下的 PPTX/HTML/图片输出；
3. 验证 `html-layout` / `image-layout` 的独立加载和真实页面出图/HTML，再清理退役备份与技能内参考副本；
4. 完成参考库构建器的 agent 标注闭环与开源整理；
5. 已验证三个排版 skill 内置和无 content skill 时的内置文案生成；继续补 HTML/图片真实页面回归；
6. 需要时再实现 `autoStart` + 手动“开始内容生成”、项目级覆盖、产物版本、分栏宽度持久化。

安装/更新方式：

```text
plugin_manager remove_bundle -> dsh-deck-workbench
plugin_manager install_bundle -> <插件根>
刷新/重启 DSH
```

不要在没有确认的情况下删除 `projectsRoot` 或批量迁移项目目录。


## 9. 文档分工

- `README.md`：公开入口，只保留项目介绍、功能、安装、设置、使用、目录结构、运行要求和已知限制；
- `SPEC.md`：功能规格、项目文件夹协议、API、UI 与验收标准；
- `HANDOFF.md`：当前实现状态、关键路径、提示词结构、已验证项、待办和继续开发注意事项；
- `DESIGN.md`：设置弹窗的视觉规范（颜色角色、字号 token、只读/可编辑形态、禁止事项）；
- `AUDIT.md`：流程等价性、资产边界和发布前审计记录；
- 上述开发文档统一放在 `dev-docs/`，随仓库版本控制，仅通过 `.npmignore` 和 `package.json files` 排除在 npm 包外；不要在 README 中链接它们。
- 原 README 中的提示词分层、设置模型、参考库构建、已验证项和已知限制，已分别并入本文件第 3、5、6、7 节及 `SPEC.md` 第 4、5、7 节；公开 README 不再承载这些开发细节。
