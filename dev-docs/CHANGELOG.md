# 变更记录

> 0.1.52 起的实现变更按版本倒序记录在这里；更早的阶段记录见文末附录。
> 版本号同时出现在 `package.json`、`README.md` 顶部和 `HANDOFF.md` 顶部，升级时三处一起改。

## 0.1.60 — 2026-11-07

空态只留一个动作：生成。

### 界面

- 预览面板没有产物时，不再显示两个灰掉的「打开 PDF / 打开 PPTX」。没有东西可打开时它们只是噪音；产物出现后这两个按钮照常出现在预览上方。
- 空态文案改用产物名（PPTX / 图片 / HTML），不再冒出 `IMAGE` 这种英文枚举值。

## 0.1.59 — 2026-11-07

修掉桌面宿主里一批「点了没反应」的按钮：原生 confirm/prompt 被 Electron 禁用。

### 修复

- 根因：Electron 不实现 `window.prompt`（直接返回 `null`），DSH 的 webview 又设了 `disableDialogs: true`，`window.confirm` 一律返回 `false`。于是「参考库重命名」拿到 `null` 就 return，用户看到的是点了没反应；其余确认框也等于被自动取消。
- 新增应用内对话框：`askConfirm` / `askText` + `DialogHost`（Esc 取消、Enter 确认、点遮罩取消、文本框自动聚焦），替换 6 处原生调用——参考库重命名、删除参考库、删除项目、恢复历史版本、恢复默认提示词、有未保存修改时关闭设置。
- 「选择目录」在宿主没有 `pickDirectory` 时给出提示，不再静默失败。
- `test/client.test.js` 增加守卫：客户端源码里出现 `window.confirm(` / `window.prompt(` / `window.alert(` / `target="_blank"` 就让测试失败（这三样在桌面端都不可用）。

### 测试

- 53 → 54 例。

## 0.1.58 — 2026-11-07

界面上的版本号改为从服务端读取，不再写死。

### 修复

- 工作台页头与设置页的版本号是两处硬编码字符串（`client/client.js` 里的 `0.1.51`），升到 0.1.57 后界面仍显示旧号。现在服务端从 `package.json` 读版本，随 `GET/POST /api/settings` 返回 `version`，客户端只渲染这个值；读不到时显示「未加载」，而不是一个过期的数字。
- `test/routes.test.js` 新增一条断言：`/api/settings` 的 `version` 必须等于 `package.json`，防止两边再次漂移。
- 测试总数 52 → 53。

## 0.1.57 — 2026-11-07

参考库的回滚路径补上测试，并修掉一个改名的破坏性 bug。

### 修复

- **bug**：把参考库改成它现在的名字，`uniqueLibraryName` 只看到“目标目录已存在”（那正是它自己），于是推到 `名字-2` 并把目录真的搬过去。现在比较目标路径时会排除库自身，同名改名是 no-op。
- `test/reference-guards.test.js` 12 个用例：激活时指针写失败要回滚 `activeId`；改名后指针写失败要把目录搬回原名；删除拒绝在用库 / 根目录 / 库外路径 / 不存在的 id；改名拒绝库外路径、同名 no-op、撞名自动加后缀且不覆盖已有目录；`ensureRegistry` 清理失效指针、无 activeId 时提升第一个、库外库登记为 legacy 且不搬动；`libraryStatus` 缺索引判不可用、manifest 页数优先；列表把在用库排在最前；`sanitizeLibraryName` 处理 `.`、长度截断、结尾点。
- 测试总数 40 → 52。

## 0.1.56 — 2026-11-07

客户端纯函数补上单元测试，仍然没有构建步骤。

### 可维护性

- `client/client.js` 末尾新增 `exports.__internals`，暴露 `endpoint` / `fileUrl` / `formatTime` / `statusText` / `statusColor` / `diffLines` / 三个 `build*Prompt`，宿主只读 `apply` 与 `inject`。
- `test/client.test.js` 用 `vm` + 最小 React stub 把客户端当普通脚本加载，14 个用例覆盖：URL 拼接与转义、时间与状态文案、diff 的新增/删除/超长退化、三种产物的提示词路径与技能名、`custom` 策略只认自己的备注、未知策略回落默认、内容技能替换与缺失提示、内置模式与内容要求追加。
- 测试总数 26 → 40。

## 0.1.55 — 2026-11-07

界面样式收敛成 token，且不引入构建步骤。

### 界面

- `client/client.js` 里 41 处 `fontSize` 字面量与 30 处裸色值全部换成 `TYPE.*` 与颜色角色；`grep` 校验现在为零裸值。
- 颜色角色补齐：`DANGER` / `SUCCESS` / `WARN` / `INFO` / `ON_ACCENT` / `CANVAS` / `TOAST_BG` / `GRADIENT`；产物 done 的 `#2e7d32` 并入 `SUCCESS #2f8f5b`，与 DESIGN.md 一致。
- `TYPE` 补三档：`small 12`、`hero 15`、`title 16`，主界面不再出现标尺外的字号。
- DESIGN.md 从「设置弹窗规范」扩为「界面设计规范」，覆盖工作台主界面，并注明零裸值的回归检查。

## 0.1.54 — 2026-11-07

读盘和人眼的节奏对齐：不再为「看一眼」付出全量 I/O。

### 性能

- 页面元信息按 `mtimeMs + size` 缓存，列表与详情不再重复读全文算 hash；`readPage` 不再二次读页面与历史。
- 产物目录每个项目只 `readdir` 一次，缺失的候选文件不再逐个 `stat`；页面摘要 8 路并发。
- 前端轮询只在窗口可见时进行（列表 10s、详情 8s），切回前台立刻补一次；详情轮询加防重入。
- 文件响应带 `ETag` 与 304 再验证，预览图/PDF 重复打开不再整段重传。
- 新增 `npm run bench`：900 文件的临时库上 `listProjects` 127ms → 19ms，`loadProject` 31ms → 4.6ms。

## 0.1.53 — 2026-11-07

- 历史扫描先比 `mtime + size`，文件没动就不读全文；已删除的项目/页面会从内存 cache 里清掉。2s 轮询对多项目不再线性变重。

### 可靠性

- 非预期错误不再把异常文本回给页面：只回 `服务内部错误（8 位 id）`，堆栈带同一个 id 进宿主日志。`handle()` 导出来供测试直接调用。
- 新建项目不再创建空的 `exports/` 目录（SPEC 中同步删除）。
- 测试 16 → 25 例：新增 `test/history-watch.test.js`（扫描缓存）与 `test/routes.test.js`（health / settings / 项目列表 / 跨站 403 / 500 脱敏 / 404），路由从零覆盖变成有回归。

## 0.1.52 — 2026-11-07

- 批准状态改为派生值：`workbench/pages.json` 不再写 `copyStatus`，`pageSummary` 用 `approvedHash === currentHash` 现算（没有 hash 时回退版本号比较）。改稿自动回到草稿；恢复到已确认的那版内容会自动重新算作已确认。

### 安全与正确性

- 产物 HTML 响应加 `content-security-policy: sandbox allow-scripts` 和 `x-content-type-options: nosniff`，agent 生成的页面不再拥有与控制 API 的同源权限。
- 默认提示词只在 `lib/settings.js` 定义一份；`GET/POST /api/settings` 返回 `defaults`，客户端删掉本地副本，改为 `SERVER_DEFAULTS` 缓存。
- 删除设置里的 `skills.pptx/html/image` 死字段，只保留 `skills.content`。
- PPTX→PDF/PNG 转换按 `pptx.path` 去重，并发请求共用同一个 Promise，不再互相删掉产物。
- 测试 11 → 16 例：新增批准状态机（`test/approval.test.js`）与 HTML 响应头（`test/http.test.js`）。
- `dev-docs/` 重新纳入版本控制，只靠 `.npmignore` 与 `package.json files` 排除在包外。

---

## 附录：0.1.30–0.1.51 阶段记录

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
