# DSH 集成约定（HTML）

本技能是纯指令 + 本地脚本 + 外部参考库，不 import 任何插件、不调用网络、不读写插件配置。HTML 是唯一路线，不执行 imagegen。

## 环境与权限

- Python：使用当前环境可用的解释器（`python` / `sys.executable`）；Pillow、Playwright 等依赖按实际环境探测。不安装新依赖。
- 浏览器：`render_slide.py` 先用 Playwright 自带 Chromium；未下载时回退系统已安装浏览器，不下载浏览器。
- 控制台：如遇中文乱码，设置 `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`（跨平台可用，不要求固定路径）。
- 参考库：由 `scripts/reference_root.py` 解析，优先级 `--reference` → `DECK_REFERENCE_ROOT` → 工作台配置文件 → 无本地回退。未配置时脚本给出明确错误。
- 工作区：source、plan、gallery、导出物都写本次会话工作目录，不写参考库。
- 沙箱：默认 workspace-write 会拦截浏览器子进程，`render_slide.py` 跑不起来。需要截图时，先向用户说明并申请一次更宽权限的命令；获批后再运行。未获批就不做 agent 侧截图，改为静态检查 + 让用户在 DSH 侧栏或浏览器里看，并如实说明“未看图”。
- HTML 预览：DSH 右侧文档预览可打开 `.html`；交互预览会执行导出器加的缩放脚本，静态预览禁用脚本，可能只显示 1920×1080 画布的一部分。交付时提示用户用浏览器打开或交互预览。
- 看图与交付：`read_image` 查看 PNG/WebP；`present` 交付图片/文件卡片；不要用 markdown 图片内联 4K 大图。

## 滑移边界

- 不写死插件版本号、provider、模型名、API Key 或云存储配置。
- 不读写插件配置文件，不自动安装/启用插件。
- 不调用除参考库检索和本地 HTML 导出之外的网络服务。
- 参考库可以是项目级或用户级；脚本按名字/路径解析，不假设固定盘符。

## 命名与分发

- 技能目录名与 frontmatter `name` 都是 `html-layout`。
- 不携带参考页码、参考稿或客户素材；参考库由用户配置。
- 技能可独立安装；不依赖其它 skill 或插件才能加载。
