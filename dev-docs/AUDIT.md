# 工作台流程审计（0.1.52）

审计日期：2026-11-07  
范围：插件启动、设置、新建项目、内容生成、页面生成、参考库、图片、PPTX、HTML、参考库构建器。  
目的：确认三个排版技能并入插件后，流程可独立运行，且产出标准与原技能一致；只查证据和流程，不引入版式模板。

## 1. 第一性原理：这个插件到底靠什么工作

一次页面产出只依赖四件事：

1. **项目目录**：需求、`content/pages`、`renders` 都在这里；
2. **内容来源**：内容技能可用时用技能，否则用内置默认文案提示词；
3. **排版技能**：PPTX / HTML / 图片三条路线，各自需要固定的排版规则和脚本；
4. **参考库**：页面图、索引、几何签名、风格 tokens；由参考库注册表、当前库指针和 `referencesRoot` 解析。

因此“独立运行”不等于“脱离工具”，而是：

- 三个排版技能不再要求用户单独安装；
- 没有内容技能时仍能生成文案；
- 参考库可以缺失，但缺失时应给出明确提示，而不是静默假参考；
- 图片工具缺失时只在生成阶段自然报错，不预先禁用按钮。

## 2. 全流程遍历

| 阶段 | 入口 | 依赖 | 结果 | 审计结论 |
|---|---|---|---|---|
| 插件启动 | DSH 载入 `lib/index.js` | webServer、tools、skills、settings、history | 注册路由、设置、参考库状态、内置技能 | 代码路径存在；内置技能用 `ctx.skills.register` 注册 |
| 读取设置 | `GET /api/settings` | `settings.json`、`references.json`、`reference.json` | 项目根、参考库根、当前库、库列表、图片检测 | 272 页参考库、`imagegen.available=true` mock 通过；新增 `contentMode` / `contentFallbackPrompt` |
| 参考库上传 | `POST /api/reference/upload` + `/api/reference/job` | PPTX、LibreOffice、Python | 新库目录、后台构建、进度；完成后由客户端激活 | 隔离环境上传 3 页测试稿，构建成功、状态可用；UI 进度轮询 mock 通过 |
| 新建项目 | `NewProjectModal` | 项目根、文件写入 | 项目目录、workspace、会话、启动提示词 | 写文件 → 建会话 → 发提示词顺序不变 |
| 内容生成 | 启动提示词 | 用户二选一：内容技能或内置提示词 | `content/pages/*.md` | 选择调用时发送带技能提示词，不调用时发送内置提示词；不再自动替用户切换；内容技能为空时回落内置并标注 |
| 页面生成 | 生成按钮/弹窗 | 固定技能名 + 项目目录 | `renders/...` | HTML/图片/PPTX 三条路线仍用原技能名 |
| 参考检索 | 技能脚本 | 参考库 | 候选页、几何签名、风格 tokens | 共享库优先；缺失时明确报错 |
| PPTX | `ppt-layout` | 共享参考稿、python-pptx、LibreOffice | 单页/整份 PPTX、审计 | 生成脚本与外部版一致；仅自检适配共享库 |
| HTML | `html-layout` | 共享参考图、Playwright | 独立 HTML、审计 | 脚本与外部版一致；提示词/导出链通过 |
| 图片 | `image-layout` | `image_generate` + 参考图 | 图片提示词/结果 | 生成前确认；无工具时生成阶段报错 |
| 参考库构建 | `tools/reference_builder.py` | LibreOffice、PyMuPDF、Pillow | 页面图、索引、manifest、style | 3 页测试稿、真实稿 `--limit 3` 通过；补标注后校验通过 |

## 3. 三个排版技能并入后的等价性

### 3.1 内置方式

- 插件内 `skills/html-layout`、`skills/image-layout`、`skills/ppt-layout`；
- 启动时读 `SKILL.md`，去掉 YAML frontmatter，通过 `ctx.skills.register` 注册；
- `resourceBase` 指向插件内技能目录；
- 技能正文顶部注入资源目录，避免脚本相对路径落到项目目录；
- 外部单独安装的三个目录已移到 `~/.dsh/skills-retired/layouts-2026-11-04`。

### 3.2 PPTX 等价性证据

| 检查 | 外部版 | 内置版 | 结果 |
|---|---|---|---|
| `probe_spec.py --page 2 --reference <shared>` | 5103 bytes | 5103 bytes | **逐字节一致** |
| `scan_parts.py --find cards --top 5 --reference <shared>` | 输出 A | 输出 B | **逐字节一致** |
| `check_deps.py` | 通过 | 通过 | 除路径标题外一致 |
| `selfcheck.py` | 通过 | 通过 | 内置版能识别共享参考库，7/7 通过 |
| 生成/审计脚本 | 原文件 | 原文件 | `pptx_kit`、`audit`、`merge_pages`、`probe_spec`、`scan_parts`、`reference_root`、`check_deps` 的 SHA-256 前 12 位全部相同；仅 `selfcheck.py` 增加共享库识别 |
| `SKILL.md` 规则 | 原文件 | 原文件 | diff 只有“本地副本回退”改为“共享库缺失明确报错”；设计规则、页面选用、审计门禁未改 |
| `references/quickstart.md` | 原文件 | 原文件 | diff 只有参考稿依赖说明；工作流和输出标准未改 |
| 参考稿解析 | 本地副本或共享 | 共享 | 同一个当前激活库，探测输出一致 |

**结论**：`ppt-layout` 的页面生成、审计、合并链路没有改规则；改变的是“技能从哪里加载”和“参考稿本地副本不再随技能分发”。共享参考库存在时，产出标准与原版一致。

附带移除项：`ppt-layout` 的本地 `assets/reference.pptx`、`references/page-index.jsonl`、`references/page-signature.jsonl`、`asset-manifest.json` 不再随插件分发；它们对应共享参考库中的同名文件。生成脚本不读取这些本地副本，`scan_parts`/`probe_spec` 默认走共享库；`selfcheck` 已能识别共享文件。

### 3.3 HTML / 图片

- `html-layout`、`image-layout` 的 `SKILL.md`、`scripts/`、`references/` 与外部版逐文件一致（仅 `__pycache__` 不同）；
- 内置 `find_reference`、`validate_library`、`style_profile`、`check_reference`、`check_copy`、`export_html`、`prepare_imagegen` 均用共享库跑通；
- 图片提示词与拆分前基线 **逐字节一致**；
- 没有新增版式模板、栏目数或固定页面类型。

## 4. 无内容技能时的独立性

- 设置只保留可选“内容技能”；
- 内容技能留空时直接使用内置默认提示词；
- 内容技能填了但宿主检测不到时，也回落内置提示词，并向模型说明“本次不调用内容技能”；
- 宿主新增 `GET /api/skills/available?name=...&cwd=...`，用 `ctx.skills.list({cwd})` 查目录；真实宿主里插件 scope 可能看不到用户级 skill（page-content 实测返回 false），因此再按项目 `.dsh/.agents` 与用户 `~/.dsh/.agents` 的 `SKILL.md` 做文件系统兜底；
- 旧宿主没有该接口时客户端按不可用处理，保证不会卡在“找不到 skill”。

内置提示词覆盖：读需求、项目框架、页面蓝图、确认后逐页写 `content/pages/P01.md`、不写版式/页面类型/机器编号/视觉建议。

## 5. 已验证项

- `node --check`：`client.js`、`index.js`、`settings.js`、`bundled-skills.js`、`reference-build.js` 全部通过；
- 设置弹窗：三个标签、固定高度、提示词设置/参考库/其他设置结构，组件级测试 PASS；
- 宿主 mock：设置 API 返回内容模式/内置提示词、reference 272 页、imagegen available；内置技能注册、`/api/skills/available` true/false 正确；
- 内容提示词：调用技能、不调用技能、技能名为空回落三种输出正确；设置页完整提示词文档与发送函数一致；
- 参考库上传：隔离环境上传 3 页 PPTX，`converting → rendering → done` 进度、构建成功、页面/manifest 存在，客户端激活后 `reference.json` 指向新库；`/api/reference/rebuild` 再次构建成功；UI 上传/轮询 mock 通过；
- 设置持久化：`contentMode=builtin`、空内容技能、自定义内置提示词 POST 后 GET 一致；
- 内置 `ppt-layout`：`probe_spec`/`scan_parts` 与外部版逐字节一致，`selfcheck` 全部通过；
- 内置 HTML/图片：检索、校验、风格、复制审计、导出、图片提示词全部跑通；
- 参考库构建器：测试稿 3 页 + 真实稿 3 页构建；补标注后 `validate_library` 通过；
- 图片按钮：无预禁用，检测只提示。

## 6. 仍需真实 DSH 重启后验证

以下项目**不能靠 mock 证明**，必须在重启后的真实宿主确认：

1. 内置技能是否出现在技能目录，`skill` 工具能按名字加载；
2. 加载后的技能正文是否包含正确资源目录，脚本能在项目会话里按该路径执行；
3. 内容技能检测接口在真实 `ctx.skills.list` 下返回正确；用户级 skill 的文件系统兜底需重启后复测；
4. 新设置三个标签、内容两种选择/完整提示词文档、保存脏状态在真实主题下的观感；
5. 在真实设置里上传一份参考 PPTX，确认上传/构建/进度/替换备份/重新构建/校验全链路；
6. 真实页面端到端：内容 → 参考选择 → HTML/图片/PPTX 产出 → 审计；
7. `image_generate` 缺失时，图片按钮可点、生成阶段报错符合预期。

## 7. 已知边界

- 内置技能仍需要 DSH 的 `skills` 服务；如果宿主整体禁用技能系统，`ctx.skills.register` 不会执行，这是宿主能力边界，不是插件模板问题；
- `ppt-layout` 不再自带参考稿副本；没有共享参考库时，必须先用构建器建库，否则技能应明确报错；
- 内置内容提示词只保证“能独立生成”，不承诺达到 `page-content` 的专业深度；
- 参考库构建器的 `primary_family`/`relations` 仍需要 agent 目视补标注，auto 库会被 `validate_library` 标为 unreviewed，这是有意的质量门槛；
- 无内容技能时，内置内容提示词要求每页从页面内容提炼一小段提纲挈领的总领段；排版技能不负责补写，也不改动三个排版 skill。

## 8. 0.1.51 全量复核

- 多参考库：注册表、中文目录、单活切换、旧 `_reference` 迁移、构建/激活分离已加入。

- **原始 skill 对照**：对照所用原始 `ppt-layout` skill 包（不随插件分发，也不是运行依赖）中的 `pptx_kit.py` / `merge_pages.py` 与内置版逐字节一致；`audit.py` / `probe_spec.py` / `scan_parts.py` 仅在参考库解析、签名保护和环境探测上有 bundle 适配，`probe_spec` 的输出除路径外与原始版相等，`scan_parts` 命中结果一致。
- **HTML/图片对照**：对照所用原始 `slide-layout` skill（不随插件分发）的检索脚本输出、`prepare_imagegen` 提示词在相同原文/参考库下逐字一致；`check_copy` / `export_html` 只增加页文件精确来源参数；`validate_library` 的校验结果一致。新 split 技能的路由提示、证据文件和 HTML/imagegen 分支没有交叉执行。
- **内容与排版衔接**：内容技能或内置提示词都写 `content/pages/Pxx.md`；三个排版技能的启动提示都读取同一路径，PPT/HTML/图片的输出路径和审计边界不变。无内容技能时，默认提示词要求 60–120 字总领段，沿用 `page-content` 的内容层级。
- **私有资产**：`npm pack` 仅含 `html-layout` / `image-layout` / `ppt-layout` 三个内置 skill，不含 `page-content`、`reference.pptx`、运行时参考库或任何页面图；参考库只通过 `reference_root.py` 在运行时解析。
- **路径**：代码中的本机绝对路径已移除；LibreOffice 通过 `PPT_SOFFICE` / `SOFFICE_PATH` / `PROGRAMFILES` 派生路径和 PATH 探测，Python 通过 `DECK_PYTHON` / `PYTHON` / PATH 解析。`check_deps.py` 中的盘符文本是路径检测规则，不是实际使用路径。
- **参考库交互**：`/api/reference/status` 返回 `builtAt`，设置页显示构建时间；新增 `POST /api/reference/validate` 实际运行 `validate_library.py`，校验按钮显示通过/失败和错误项；重新构建把旧 `index.jsonl` 的已复核标注作为 `--reuse-annotations` 合并，避免 `--force` 把 agent 标注重置为 `builder_auto`。

- **参考页指南**：移除 272 页固定页码/章节表，改为按共享参考库索引、签名和清晰图选择；避免任意上传参考库时页码失效，也避免把原参考稿内容带进技能包。

