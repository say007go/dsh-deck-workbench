# HANDOFF — dsh-deck-workbench

> **新 agent / 新对话先读这里。** 本目录随仓库版本控制，只排除在 npm 包外。阅读顺序：本文件 → [SPEC.md](SPEC.md) → [DESIGN.md](DESIGN.md) → [AUDIT.md](AUDIT.md) → [README.md](../README.md)，并遵守 [AGENTS.md](../AGENTS.md) 的编辑边界。历史变更查 [CHANGELOG.md](CHANGELOG.md)，本文件只写当前状态。

- 快照日期：2026-11-07
- 当前版本：**0.1.57**
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
│  ├─ AUDIT.md
│  └─ CHANGELOG.md      # 0.1.52 起逐版本变更 + 0.1.30–0.1.51 阶段记录
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
├─ scripts/bench-projects.mjs  # npm run bench，不进 npm 包
├─ test/                # node --test：inside / routes / approval / history-watch / http
│                       #             references / reference-guards / client
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

## 6. 当前状态

### 6.1 基线

- 版本 **0.1.57**；`npm test` 52 例全绿（`node --test`）。
- 每个改动的 JS 文件提交前跑 `node --check`。客户端没有构建步骤，改完刷新页面即生效；改成 `lib/` 才需要重启 DSH。
- 工作区行尾是 LF。用脚本改文件时必须按原行尾写回，否则会产出整文件假 diff（踩过三次：`lib/index.js`、`lib/settings.js`、`lib/references.js`）。

### 6.2 能力 × 覆盖

| 能力 | 自动化 | 人工 / 集成验证 | 未覆盖 |
| --- | --- | --- | --- |
| 项目 CRUD、文件协议、路由 | `test/routes.test.js`：health / settings / 空列表 / 跨站 403 / 500 脱敏 / 404 | 手工建项目、删项目 | 50 页以上的大项目 |
| 文案版本与批准 | `test/approval.test.js`、`test/history-watch.test.js`：首扫、改稿回草稿、恢复算批准、mtime 短路 | 真实项目 P03–P05 状态与 `copyApproved` 核对 | — |
| 参考库 | `test/references.test.js`、`test/reference-guards.test.js`：迁移、激活回滚、改名回滚、删除保护、legacy 登记 | 上传 / 重建 / 校验在 0.1.51 前手工验证过 | 真实 DSH 里的重命名与删除 |
| 客户端纯函数 | `test/client.test.js`：URL、时间、状态、diff、三个 `build*Prompt` | — | 组件渲染、拖拽分栏、轮询 |
| 预览转换 | 无（依赖 LibreOffice，不进单测） | PPTX→PDF 首转 7.2s；PNG 273949 字节；两个并发请求去重后只转一次（19.2s） | 三路以上并发、损坏的 PPTX |
| 安全头与缓存 | `test/http.test.js`：CSP、nosniff、ETag/304 | `curl` 实测 304 返回 0 字节 | — |
| 性能 | `npm run bench`（900 文件临时库） | `listProjects` 127→19ms、`loadProject` 31→4.6ms；线上详情 3.8ms | 40 页以上的真实项目 |

### 6.3 只能靠人眼确认的

1. 真实 DSH 主题下设置弹窗三个标签、参考库页、项目三栏的观感。
2. 0.1.55 引入的两处像素变化：`S.h2` 14 → 13.5，设置导航副标题行高 1.65 → 1.5。

### 6.4 历史

逐版本变更见 [CHANGELOG.md](CHANGELOG.md)：0.1.52 起有完整记录，0.1.30–0.1.51 的阶段记录（参考库外置、技能拆分、内置技能、设置重构）在该文件附录。

## 7. 待办 / 已知限制

### 7.1 需要真机复测

1. 在真实 DSH 里完整走一遍 0.1.57：设置三个标签、参考库上传/重建/校验、内容两种模式、图片能力重新检测、项目根目录保存。
2. 新项目走「会话 → 蓝图 → 页面 → 生成 PPTX/图片/HTML」全链路，重点看共享参考库下的实际产出。

### 7.2 没有自动化覆盖的地方

3. 客户端组件层（渲染、拖拽分栏、轮询）：要补测试需要 jsdom 或截图比对，投入大、当前收益低。
4. `lib/preview.js`：依赖 LibreOffice，只能做集成测试；建议用 `skip: !findSoffice()` 的方式挂在外部环境里跑。
5. 路由仍是长 if 链（`lib/index.js:486` 起）。改成表驱动之前，先把新路由同步进 `test/routes.test.js`。

### 7.3 产品功能缺口

6. 自动发送启动指令始终开启；未实现 `autoStart` 设置与“手动开始内容生成”按钮。
7. 产物重新生成会覆盖原文件，没有产物版本历史。
8. 三栏拖动宽度不持久化；所有设置是全局的，不能按项目覆盖。
9. 参考库构建器已能自动切页、生成索引与 style profile，但 `primary_family` / `relations` 仍需 agent 分批目视补，不能承诺全自动。

### 7.4 已知小坑

10. `npm pack` 不含 `dev-docs/` 与 `test/`（`files` 白名单 + `.npmignore`），这是有意为之。
11. Windows 下仓库根会出现 `CON` 伪条目（设备名，不是真实文件），`git status` 不受影响，不要试图删除。
12. 项目根目录改动后要重启 DSH 才生效，旧项目不会自动出现在新根目录。

## 8. 继续开发建议

优先顺序：

1. 真机复测 0.1.57（第 7.1 节两条），有偏差先修，再谈新功能。
2. 等真实使用反馈再决定客户端是否要拆：触发条件是「出现第二个前端开发者」「文件超过 3000 行」「组件间传 5 个以上 props 或需要引第三方库」。到那天再上 esbuild（`client/src/*.js` → `client/client.js`，配 `--watch`），不要提前加构建步骤——它会破坏 link 安装下“改完刷新即生效”的开发方式。
3. 想再提升稳健性，性价比最高的是给 `preview.js` 加集成测试（临时 PPTX + 真实 soffice，缺失时 skip）。
4. 参考库构建器的标注闭环与开源整理（去私有 skill 名、去品牌色硬编码、参考稿不入库）。
5. 需要时再实现 `autoStart`、项目级设置覆盖、产物版本、分栏宽度持久化。

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
- `HANDOFF.md`：**当前状态**——关键路径、提示词结构、能力×覆盖矩阵、待办和继续开发的边界；不记流水账；
- `CHANGELOG.md`：逐版本变更。修了什么、为什么改、影响哪些文件；历史全部在这里，不要写回 HANDOFF；
- `DESIGN.md`：界面设计规范（颜色角色、字号 token、只读/可编辑形态、禁止事项），覆盖设置弹窗与主界面；
- `AUDIT.md`：流程等价性、资产边界和发布前审计记录；
- 上述开发文档统一放在 `dev-docs/`，随仓库版本控制，仅通过 `.npmignore` 和 `package.json files` 排除在 npm 包外；不要在 README 中链接它们。
- 原 README 中的提示词分层、设置模型、参考库构建、已验证项和已知限制，已分别并入本文件第 3、5、6、7 节及 `SPEC.md` 第 4、5、7 节；公开 README 不再承载这些开发细节。
