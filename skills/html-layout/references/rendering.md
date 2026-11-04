# 制作接口（HTML）

## 文案计划

`source.txt` 必须是源文案的逐字副本，创建后不改动；用 `scripts/snapshot_source.py` 复制，不要手打或清洗 Markdown。先保存文件，再用 `check_copy.read_source` 读取并计算 UTF-8 内容的 `source_sha256` 及位置，避免 Windows 写文件时换行转换导致偏移不一致。所有位置均为 Python Unicode 码点，0 起算、左闭右开，不能用 JS UTF-16 偏移。Markdown 表格的 `#`、`|`、`---`、`<br>` 等结构标记作为 omission 覆盖，不进入可见文字。

```json
{
  "source_sha256": "实际原文内容的SHA-256",
  "items": [
    {"id":"page_title","role":"title","mode":"keep","origin":[0,4]},
    {"id":"body_a","role":"body","mode":"delete","origin":[5,20],"keep":[[5,10],[12,20]],"deletion_reason":"具体说明冗余修饰及为何不改变含义"},
    {"id":"label_a","role":"label","mode":"extract","origin":[7,10]}
  ],
  "omissions": [],
  "protected_ranges": []
}
```

位置仅示意，必须根据实际原文计算。`keep` 保留整个 origin；`delete` 的 keep 片段保持原顺序且不插新字；`extract` 的 origin 只能是一个连续短语。标签与正文可共享来源。

每个非空白原文字元需归入某显示项 origin 或明确省略区。省略格式 `{"range":[a,b],"reason":"具体原因"}` 只用于重复信息或纯格式标记，不偷偷丢实质内容。数字限定不能借省略绕过保护；重要名称和条件可列 `protected_ranges` 要求实际显示。

```text
python scripts/check_copy.py --source <工作区>/source.txt --plan <工作区>/copy-plan.json --page-file <源文案> --report <工作区>/copy-audit.json
```

不能为通过检查改源文件、编理由或关闭检查。程序不判断信息重要性，仍需语义复核。

## HTML模板接口

- 根节点 `#slide` 为 1920×1080 CSS 像素，`body` margin:0，字体使用已安装的中文字体。
- 可见文字全部用空的 `data-copy` 节点，例如 `<span data-copy="page_title"></span>`；渲染器将原文切片注入，防止重打字差。不要在其它可见节点、SVG 文字、CSS 伪元素、自动列表编号中加未绑定文字。
- 强调段落中的词时拆为多个按原顺序排列的绑定节点。数字、标签、序号、页脚也需要来源；图形符号不能暗示原文没有的关系。
- 根据内容设计标题、总领段和主体；实质正文默认 24–30px 起步，优先调结构和断行。
- 不用参考页作背景或新成果，不挪用历史截图、Logo、数字。图内文字不受自动审计，须另核查。实质文字不能栅格化藏进素材。
- 页面使用本地资源，不依赖远程字体、CDN 或服务，渲染时 HTTP/HTTPS 被阻断。不以透明、零字号、裁切或画布外放置藏字。

```text
python scripts/export_html.py --html <工作区>/slide.html --source <工作区>/source.txt --plan <工作区>/copy-plan.json --page-file <源文案> --output <工作区>/page-01.html --report <工作区>/P01.audit.json
```

最终 HTML 要能单独打开，不依赖 `source.txt`、`copy-plan.json` 或 Python 注入。资源内嵌，随窗口等比显示 16:9。模板中的空 `data-copy` 节点不是可交付成品。

`scripts/render_slide.py` 可用于内部排版检查和截图，默认 3840×2160；截图默认不交付。它优先用 Playwright 自带 Chromium，缺失时回退系统浏览器，不下载新浏览器。DSH 默认沙箱下浏览器子进程会被拦截，需按 [DSH 集成](dsh-integration.md) 向用户申请一次更宽权限后再跑。

检查包括出处、遗漏、隐藏项、明显溢出和未绑定新增文字，但不能完整识别遮挡、低对比、关系错误或美感。必须实际查看最终 HTML 及密集局部（截图或用户侧预览），必要时对照参考修改。
