# 参考库调用（HTML路线）

## 分层读取

1. 用 `scripts/snapshot_source.py` 把本次原文原样复制为 source.txt；不手打、不清洗 Markdown，判断真实内容关系、组数和密度，据此规划 HTML 结构。Markdown 表格语法在 copy-plan 中以 omission 处理，不进入可见文字。
2. 用 `scripts/find_reference.py` 本地检索完整参考库；脚本读取索引，但只返回少量候选，不输出全库文字。
3. 看候选总览（`read_image`），通常约 8 页，再打开约 2–4 张 1920×1080 清晰图。
4. 需要尺寸、样式细节时才读这些页的 `references/pages/NNN.json`。
5. Agent 先取词删词、核验再规划排版；HTML 完成后与原文和参考对照验收。

参考库页数由 `manifest.json` 决定，不写死。正常单页只需要少量候选记录、一个总览和几张清晰图，不加载整库。thumbs/contacts 是可选缓存；`--gallery` 缺失时从 pages 缩放。

## 检索接口

在工作区运行，输出放在本次工作区，不能写回参考库。命令中的 `python` 指当前可用解释器；参考库路径由 `--reference` / `DECK_REFERENCE_ROOT` / `reference.json` 解析。

```text
python scripts/snapshot_source.py --page <源文案> --out <工作区>/source.txt
python scripts/find_reference.py --query "五阶段，每阶段有任务成果，第三阶段双线并行" --relation "matrix flow comparison" --density high --blocks 5 --limit 8 --gallery <工作区>/candidates.png --output <工作区>/candidates.json
python scripts/find_reference.py --pages 18 115 204 --gallery <工作区>/selected.png
python scripts/check_reference.py --choice <工作区>/reference-choice.json --candidates <工作区>/candidates.json --reference <参考库>
```

`relation` 接受英文家族名或中文词；关系权重大于业务主题。`blocks` 是主要内容组数的近似偏好，不等于栏目容量。`density` 基于原稿文本量粗分，不能替代测量。`--used 115 129` 轻度降低本任务已用页排序，不禁止复用。

候选不合适时删业务词，保留关系、长短、数量再查，或用 `<参考库>/references/library-map.md` 手动查看；全部页可查，无精选白名单。脚本仅在合理候选范围内分散结构，不为凑足 8 个引入无关页。

## 设计记录

看完清晰图后，写内部 `reference-choice.json` 并运行 `scripts/check_reference.py`。它只验证证据是否真的存在，不规定版式：

```json
{
  "selected_pages": [2, 5],
  "content_relationships": "本页真实关系，例如三层承接/并列/递进",
  "observations": "每张参考页的具体观察：标题与导语关系、分组和阅读路径、色彩角色、字阶、密度、装饰；不写‘很高级’",
  "borrow": "只借哪些视觉语言或表达方法",
  "reject": "明确不用的元素及原因",
  "design_intent": "先写内容需要什么阅读路径，再写本页结构；说明是否与参考骨架相近以及原因",
  "alternatives": [
    {"direction": "认真考虑过的不同结构", "why_rejected": "取舍理由"}
  ]
}
```

`alternatives` 只在用户明确要求创新/不要模板时记录，不强制数量；没有真正不同的方向就不要编。参考图只传递视觉语言与信息密度，不当布局模板；不得带入历史客户文案、数据、师资、截图、图片、Logo或事实。记录不进入客户页面。

制作后做一次“换参考测试”：如果换掉选中的参考页，这个结构是否仍由本页内容支持？如果只是换色、加脊线或改字阶，说明结构仍是参考默认，要说明或重做；如果内容本身是表格，表格可以保留，但要能说清是内容需要。

## 资源与交付

参考稿是固定快照，不自动同步。页面为 1920×1080 WebP；thumbs/contacts 可选。使用候选时必须看清晰图；源稿裁切、小字和拥挤不能继承。

HTML 用制作前的 `copy-plan.json` 和 `export_html.py`；source.txt 必须与源文案逐字一致，`check_copy.py --page-file` 会校验。审计写到工作区，不写 `renders/html`。交付独立可打开的 `.html`，不默认附截图。内部计划、审计和删词记录默认不交付，用户询问时可提供。检查库完整性可运行 `scripts/validate_library.py`，正常制作无须每次全库验证。
