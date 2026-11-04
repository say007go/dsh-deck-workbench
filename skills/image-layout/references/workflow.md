# 参考库调用（imagegen路线）

## 分层读取

1. 用 `scripts/snapshot_source.py` 原样复制本次原文，判断真实内容关系、组数和密度；只记录语义，不预先决定页面布局。
2. 用 `scripts/find_reference.py` 本地检索完整参考库；脚本读取索引，但只返回少量候选，不输出全库文字。
3. 看候选总览（`read_image`），通常约 8 页，再打开约 1–3 张 1920×1080 清晰图。
4. 需要尺寸、样式细节时才读这些页的 `references/pages/NNN.json`。
5. 参考图只传递视觉语言、信息密度和图文表达品质；不把参考页几何、HTML 结构或布局写入生图提示词。
6. 生图后对照完整原文核验实际可见文字，记录来源、删词和核心内容覆盖。

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

看完清晰图后，写内部 `reference-choice.json` 并运行 `scripts/check_reference.py`。它只验证证据，不规定版式：

```json
{
  "selected_pages": [2, 5],
  "content_relationships": "本页真实关系，只写语义",
  "observations": "每张参考页的具体观察：标题与信息层级、图文融合、信息密度、色彩角色、完成度；不写‘很高级’",
  "borrow": "只借哪些视觉语言或信息表达品质",
  "reject": "明确不用的元素及原因",
  "design_intent": "生图模型应保留的内容层级和表达品质，不指定分栏、坐标或图形",
  "alternatives": [
    {"direction": "认真考虑过的不同视觉方向", "why_rejected": "取舍理由"}
  ]
}
```

`alternatives` 只在用户明确要求创新/不要模板时记录，不强制数量；没有真正不同的方向就不要编。只记录视觉语言、信息密度和真实内容关系；不写布局蓝图，不把 HTML 结构或参考页几何传入生图。记录不进入客户页面。

生成后做一次“换参考测试”：如果换掉选中的参考页，成品是否仍由本页内容支撑？如果只是换色或换字体，说明参考只是贴皮；如果内容本身适合某种结构，仍然可以保留，但要能说清原因。

## 资源与交付

参考稿是固定快照，不自动同步。页面为 1920×1080 WebP；thumbs/contacts 可选。使用候选时必须看清晰图；源稿裁切、小字和拥挤不能继承。

imagegen 使用完整 `source.txt`、取词删词规则、真实内容关系和已看过的 1–3 张参考图，输出实际生成的 16:9 图片；不默认附提示词、审计或截图。内部提示词、核验记录和计划默认不交付，用户询问时可提供。检查库完整性可运行 `scripts/validate_library.py`，正常制作无须每次全库验证。
