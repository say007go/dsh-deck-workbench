# DSH Deck Workbench 插件 Spec

- 版本：v0.2（设计稿）+ 0.1.52 实现
- 状态：v1 已实现，按实际使用持续迭代
- 项目目录：`<插件根>`
- 插件包名：`dsh-deck-workbench`
- 显示名：方案工作台 / Deck Workbench
- 主面板 key / 侧栏 id：`deck-workbench`

## 1. 目标

把“需求 → 逐页文案 → 按需生成 HTML / 图片 / 原生 PPTX”做成一个可视工作台：

- 在 DSH 内新建项目、输入/导入需求；
- 打开项目专属的内容对话，多轮生成和优化逐页文案；
- 每页文案有版本、可对比、可确认、可恢复；
- 按页按需生成 HTML / 图片 / PPTX，并直接预览；
- 页面、文案、产物一一对应。

工作台不重写内容、排版、生图规则，也不提供版式模板或骨架。

## 2. 已确认的决策

1. 项目根由设置 `projectsRoot` 提供，代码不写死盘符；未设置时回退 `<home>/DeckWorkbench/projects`。工作台“其他设置 → 项目根目录”可覆盖，保存后重启 DSH 生效。
2. 不做只读 MVP；v1 直接包含创建项目、导入需求、内容对话、文案版本、三种产物和预览。
3. 不导入已有项目；只管理工作台新建的项目。
4. 插件名 `dsh-deck-workbench` / 显示名“方案工作台”。
5. 多轮对话复用 DSH 自己的 Conversation，不在工作台里重写聊天 UI。

参考素材库：默认根为 `<projectsParent>/references`，可由 `referencesRoot` 覆盖；每个库是 `references/<中文库名>/`，注册表 `~/.dsh/storages/deck-workbench/references.json` 维护 id/name/root，`reference.json` 只指向当前激活库。技能脚本仍按 `--reference` / `DECK_REFERENCE_ROOT` / `reference.json` 解析。内容技能不依赖该库。界面支持新建、切换、重命名、删除、重建和校验。

## 3. v1 范围

### 项目

- 新建项目：客户、项目名、需求文本、需求文件；
- 项目列表、项目详情、删除/归档（可选）；
- 项目根配置、刷新、打开文件夹。

### 内容

- 每个项目一个**内容会话**（DSH Session），cwd 指向项目目录；
- 在工作台点“打开内容对话”进入该会话；
- 多轮对话由 DSH Chat 承担；内容技能或内置默认提示词写入 `content/pages/P01.md`；
- 工作台监听文件变化，自动生成文案版本；
- 版本历史、文本 diff、确认版本、恢复版本；
- 页面级“继续优化”：把当前页和用户反馈发送到内容会话。

### 产物

- 按页生成 HTML / 图片 / PPTX：从工作台向内容会话发送目标指令；
- 图片生成前的 `ask_user_question` 确认仍在对话里完成；
- 产物写入 `renders/`，工作台自动发现；
- HTML iframe、图片 img、PPTX 首屏 PNG 预览（PDF/PPTX 作为完整查看入口）；
- 状态：已生成 / 过期 / 缺失；整份 `deck.pptx` 作为项目级产物。

### 工作台

- 项目列表；
- 页面列表 + 页面 × 产物状态矩阵；
- 左侧文案、右侧预览；
- 版本历史/对比/确认/恢复；
- 生成按钮、优化按钮、打开对话；
- 明暗主题、空状态、错误状态。

## 4. 项目文件夹协议

```text
<projectsRoot>/
└── jiangling-leader-2026/
    ├── project.json                 # 工作台元数据（含 workspaceId / contentSessionId）
    ├── content/
    │   ├── brief.md                 # 需求正文
    │   ├── input/                   # 需求附件（docx/pdf/txt/md…）
    │   ├── blueprint.json           # 可选：页面顺序/标题
    │   ├── pages/
    │   │   ├── P01.md               # 当前纯文案
    │   │   └── P02.md
    │   └── history/
    │       └── P01/
    │           ├── v001-<hash>.md
    │           └── v002-<hash>.md
    ├── renders/
    │   ├── html/P01.html
    │   ├── image/P01.png
    │   └── pptx/P01.pptx            # 或 deck.pptx
    ├── workbench/
    │   ├── pages.json               # 工作台管理的版本/确认状态
    │   ├── renders.json             # 可选：精确的产物来源
    │   └── .preview/                # PPTX→PNG/PDF 缓存
```

### 4.1 文案

- `content/pages/P01.md` 是纯文案，不带机器编号、页面类型/关系、视觉字段。
- `content/history/P01/vNNN-<hash>.md` 由工作台生成；内容技能不需要写历史。
- `content/blueprint.json` 可选；工作台只读它获取顺序/标题，不覆盖。
- 工作台自己的状态写在 `workbench/pages.json`，避免和内容技能争写文件。

`workbench/pages.json`：

```json
{
  "schemaVersion": 1,
  "pages": {
    "P01": {
      "currentVersion": 3,
      "currentHash": "a1b2c3d4",
      "approvedVersion": 2,
      "approvedHash": "9f8e7d6c",
      "updatedAt": "2026-11-03T12:00:00+08:00"
    }
  }
}
```

### 4.2 产物

| 目标 | 单页 | 整份 |
|---|---|---|
| HTML | `renders/html/P01.html` | 按页 |
| 图片 | `renders/image/P01.png/.jpg/.webp` | 按页 |
| PPTX | `renders/pptx/P01.pptx` | `renders/pptx/deck.pptx` |

- 单页 PPTX 优先；只有 `deck.pptx` 时在项目级显示，页面级标为 `deck`。
- 不强制排版技能写 manifest；用 mtime 判断过期；后续可写 `workbench/renders.json` 记录 source hash。

### 4.3 状态

- 文案：`draft` / `approved`。由 `workbench/pages.json` 的 `approvedVersion` / `approvedHash` 与当前文案现算，不落库：改稿自动回到 `draft`，恢复到已确认的那版内容会自动重新算作 `approved`。
- 产物：`missing` / `done` / `stale` / `deck`。
- 过期：产物 mtime 早于当前文案，或 `renders.json` 的 source hash 不匹配。

## 5. 架构

```text
Client 工作台（main: deck-workbench）
  ├─ Host HTTP
  │   ├─ 项目 CRUD / 需求上传
  │   ├─ 文案读取 / 版本 / 确认 / 恢复
  │   ├─ 产物扫描 / 文件服务 / PPTX→PDF
  │   └─ workbench 元数据
  └─ DSH Client Services
      ├─ sessions.create({ cwd })
      ├─ uiWorkspace.openSession(sessionId)
      └─ sessions.using + binding.session.prompt(...)
```

### 5.1 插件形态

- 一个 bundle，宿主 + 客户端两半；
- `package.json` 声明 `dsh.bundle.patch`、`dsh.client`；
- 客户端注册 `sidebar.panellist`（`id: deck-workbench`）和 `main`（`key: deck-workbench`）；
- 宿主通过 `ctx.inject(['webServer'], ...)` 注册路由；
- 客户端不引入构建链，`client/client.js` 是手写 `__ModuleLoader__` 模块；超过约 1500 行再引入 esbuild/tsdown。

### 5.2 内容会话

- 新建项目后：
  1. 宿主创建项目文件夹并返回绝对路径；
  2. 客户端用 `ctx.workspaces.create({ path: projectPath })` 创建/解析项目 workspace，并重命名为项目名；
  3. 用 `ctx.sessions.create({ workspaceId })` 在该 workspace 下创建会话；失败时回退 `ctx.uiWorkspace.connectWorkspace(workspaceId)`；
  4. 把 `workspaceId`、`sessionId` 写回 `project.json`，对话按项目 workspace 分组。
- 已有 `workspaceId` + `contentSessionId`：直接 `openSession`，不再落在“未分组”。
- 会话丢失：在同一 workspace 重新连接；workspace 丢失：按项目路径重新解析/创建。
- 注意：DSH `session.create` 的 `workspaceId` 与 `cwd` 互斥，不能同时传。
- 工作台不渲染聊天消息；多轮对话在 DSH Conversation 中进行。
- 页面级“继续优化”：
  - 工作台弹出反馈输入框；
  - 通过 `ctx.sessions.using(sessionId, { source: 'controllerOperation' }, ref => ref.binding.session.prompt([...], 'queue'))` 把“页码 + 当前文案 + 反馈”发送到会话；
  - 发送成功后提示“已发送到内容对话”；
  - 发送失败则复制提示词并打开对话，作为降级。

### 5.3 生成动作

- “生成 HTML / 图片 / PPTX”按钮把目标指令发送到同一内容会话；
- 图片生成必须由对话中的 `ask_user_question` 确认，工作台不绕过；
- 排版技能自行选参考、判断版式，工作台不传页面类型/关系/版式建议；
- 工作台只监听 `renders/` 并刷新状态。

## 6. API

### 项目与需求

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/deck-workbench/api/health` | 健康检查 |
| GET | `/deck-workbench/api/projects` | 项目列表 |
| POST | `/deck-workbench/api/projects` | 新建项目 |
| GET | `/deck-workbench/api/projects/:id` | 项目详情 |
| DELETE | `/deck-workbench/api/projects/:id` | 删除项目目录 |
| GET/POST | `/deck-workbench/api/settings` | 读取/保存内容要求、生成规则、项目根目录、参考库根目录 |
| POST | `/deck-workbench/api/projects/:id/inputs` | 上传需求附件（raw body） |
| POST | `/deck-workbench/api/projects/:id/session` | 保存/更新 `contentSessionId` / `workspaceId` |

### 文案与版本

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/deck-workbench/api/projects/:id/pages/:pageId` | 当前文案 + 版本 + 产物状态 |
| GET | `/deck-workbench/api/projects/:id/pages/:pageId/history` | 版本列表 |
| GET | `/deck-workbench/api/projects/:id/pages/:pageId/history/:version` | 指定版本内容 |
| POST | `/deck-workbench/api/projects/:id/pages/:pageId/approve` | 确认某版本 |
| POST | `/deck-workbench/api/projects/:id/pages/:pageId/restore` | 恢复到某版本 |

### 预览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/deck-workbench/files/:id/<path>` | HTML/图片/PDF 原文件 |
| GET | `/deck-workbench/api/projects/:id/pages/:pageId/preview?target=pptx&format=image\|pdf` | PPTX 首屏 PNG / 完整 PDF（按需缓存） |
| GET | `/deck-workbench/api/reference/status` | 当前库、库列表、构建任务 |
| POST | `/deck-workbench/api/reference/activate` | 切换当前参考库 |
| POST | `/deck-workbench/api/reference/upload` | 新建库并后台构建 |
| POST | `/deck-workbench/api/reference/rebuild` | 重建指定库 |
| POST | `/deck-workbench/api/reference/validate` | 校验指定库 |
| PATCH/DELETE | `/deck-workbench/api/reference/libraries/:id` | 重命名/删除库 |

路径必须解析到项目目录内；拒绝 `..`、符号链接/重解析点和目录列表。

## 7. UI

### 项目列表

- 卡片：项目名、客户、已确认进度、有效产物数量（PPTX/图片/HTML）、更新时间；不再显示静态 phase 徽标。
- 顶部：新建项目、设置、刷新。
- 设置分三个标签：提示词设置 / 参考库 / 其他设置。提示词设置第一项“内容生成”二选一：调用内容技能 / 不调用内容技能，设置弹窗采用左侧分区导航、页面标题、文档式编辑区和固定底栏；内容生成用完整提示词文档呈现，固定规则只读，技能名、内置提示词和内容要求内联编辑，不再单列预览；参考库通过上传 PPTX 新建到 `references/<库名>`，列表支持切换、重命名、删除、重建和校验；其他设置只显示项目根目录，参考库根目录自动推导，图片能力重新检测和恢复默认也在其他设置。
- 设置弹窗使用固定高度（`min(720px, 88vh)`）：标题、标签栏和底部按钮固定，只有标签内容区滚动，切换标签时弹窗尺寸不变。

### 新建项目

- 字段：客户、项目名、需求文本、需求附件、目标格式；
- 需求文本写入 `content/brief.md`；
- 附件写入 `content/input/`；
- 创建后直接打开内容对话；
- 项目 ID 由标题/客户生成 slug + 时间后缀，避免冲突。

### 项目详情

```text
┌ 顶部：项目名 / 客户 / 阶段 / 根路径 / 打开对话 / 刷新 ─────────┐
│ 左侧页码              │ 中间文案                  │ 右侧预览       │
│ P01 ● HTML ✓ 图片 ✓   │ 当前版本 / 确认状态       │ 产物预览        │
│ P02 ○ HTML – 图片 –   │ 文案正文                  │ PNG/HTML/img   │
│ ...                   │ 版本 / 对比 / 恢复 / 优化  │                │
└ 底部：页面 × 产物状态矩阵 ──────────────────────────────────┘
```

- 页面级操作：优化此页、确认当前版本、查看历史、生成 PPTX/图片/HTML；
- 三栏可拖动中缝调宽；
- 产物顺序统一为 PPTX → 图片 → HTML；新建项目默认只勾选 PPTX；
- 版本面板：版本号、hash、时间、确认状态；diff 用简单行级对比；
- 预览标签：PPTX（首屏 PNG + 打开 PDF/下载 PPTX）、图片（img）、HTML（sandbox iframe）；每个 tab 内有生成/重新生成，不另设顶部重复按钮；
- 过期提示：当前文案 hash 与产物来源不一致时显示“文案已更新，产物待重制”。

## 8. 版本与监听

- 宿主每 2 秒扫描一次 `content/pages/*.md`（或使用 fs.watch，带防抖）；
- 内存保存每个页面最后内容；检测到变化：
  1. 把旧内容写入 `content/history/P01/vNNN-<hash>.md`（去重）；
  2. 更新 `workbench/pages.json` 的 currentVersion/currentHash；
  3. 通知客户端刷新。
- 首次扫描：把当前内容记为 v001，不重复写。
- 每个页面默认保留最近 50 个版本；可配置。
- 恢复版本：把历史内容写回 `content/pages/P01.md`，随后按新版本记录。
- 工作台未启动期间的编辑可能漏记历史；v1 接受这个限制，启动时把当前内容补为最新版本。

## 9. 安全

- 项目根之外一律拒绝；
- 文件路径 realpath 后仍在项目目录内；
- 上传大小上限 25MB/文件，白名单 `.docx/.pdf/.txt/.md/.pptx`；
- 文件服务只允许白名单扩展名，不做目录列表；
- HTML iframe `sandbox="allow-scripts"`，不加同源；
- POST 同源校验；如果宿主提供 `connection.requestRejection`，先过宿主门禁；
- 日志不输出客户正文；
- 不把客户资料发给外部服务；图片生成的上传行为由对应技能在对话中确认。

## 10. 开发顺序（同一 v1，不是分批发布）

1. bundle 骨架：package、patch、icon、locale，能安装启用；
2. 宿主：项目 CRUD、上传、文件服务、workbench 元数据；
3. 客户端：侧栏图标、主面板、项目列表、新建项目、项目详情；
4. 内容会话：`sessions.create` + `openSession` + sessionId 回写；
5. 文案：页面读取、版本历史、diff、确认、恢复；
6. 动作：优化/生成提示发送到会话；状态刷新；
7. 预览：HTML/图片；PPTX→PDF 与缓存；
8. 端到端验收与安装测试。

## 11. v1 验收

- [ ] 安装启用后，侧栏出现“方案工作台”；
- [ ] 新建项目：输入客户/项目名/需求，上传附件，生成正确目录；
- [ ] 项目创建后能打开项目专属内容对话；
- [ ] 对话中多轮生成/修改文案，工作台自动出现新页面和版本；
- [ ] 页面级优化能把反馈发送到对话；
- [ ] 版本历史可查看、对比、确认、恢复；
- [ ] 三种产物按需生成，状态正确；
- [ ] HTML/图片/PPTX 能预览；PPTX 失败时有下载降级；
- [ ] 页面 × 产物矩阵能看出缺失/过期；
- [ ] 不导入已有项目；
- [ ] 不重写技能逻辑，不提供版式模板；
- [ ] 路径穿越、目录列表、超大文件被拒绝。

## 12. 非目标

- 不在插件内写文案、排版或生图；
- 不提供版式模板/骨架/配方；
- 不做内嵌完整聊天 UI；
- 不做云同步、多人协作；
- 不做幻灯片编辑器；
- 不做旧项目迁移。

## 13. 风险与待确认

1. **会话创建**：已验证 `workspaces.create` + `sessions.create({ workspaceId })`；`workspaceId` 与 `cwd` 互斥，不能同时传。
2. **发送提示**：`sessions.using` + `binding.session.prompt` 已实现；失败时降级为复制提示并打开对话。
3. **工作区/会话清理**：删除项目时先删目录，再归档 session、删除 workspace；清理失败会提示。
4. **PPTX 预览**依赖 LibreOffice；v1 做，失败时给下载。
5. **需求附件**只存原文，不在 v1 做文本提取；由 agent 读取。
6. **版本历史**在插件未运行期间可能漏记；v1 接受。
7. **项目根目录**修改后需重启 DSH；只影响新建项目，已有项目不迁移。

## 14. 下一步

v1 已完成并进入迭代。当前实现状态、文件清单、验证矩阵和继续开发注意事项见：

- [HANDOFF.md](HANDOFF.md)
- [README.md](../README.md)
