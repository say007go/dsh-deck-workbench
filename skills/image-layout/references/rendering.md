# 制作接口（imagegen）

## 完整原文提示词

使用 `snapshot_source.py` 把源文案原样复制为 `source.txt`，再用 `prepare_imagegen.py` 直接读取完整 `source.txt`，附文字取舍规范、真实内容关系和少量实际看过的参考图；不输入 `copy-plan.json` 或预选上图文案。先写 `reference-choice.json` 并通过 `check_reference.py`，不通过不进入制作。不传 HTML 布局，不指定分栏、位置、坐标、尺寸比例、阅读路径或图形。

```text
python scripts/snapshot_source.py --page <源文案> --out <工作区>/source.txt
python scripts/check_reference.py --choice <工作区>/reference-choice.json --candidates <工作区>/candidates.json --reference <参考库>
python scripts/prepare_imagegen.py --source <工作区>/source.txt --brief <工作区>/imagegen-brief.json --pages 15 26 --output <工作区>/imagegen-prompt.txt
```

`imagegen-brief.json` 只接受语义字段：

```json
{
  "content_relationships": "只说明本次语义关系，不要求怎样画。",
  "verbatim_required": false,
  "authorized_labels": []
}
```

- `content_relationships` 是文字；不得夹带布局、坐标、分栏或指定图形。
- `verbatim_required` 仅在用户明确要求全文逐字上图时为 true。
- `authorized_labels` 仅填用户明确授权的标签，不把单页批准推广到所有页面。
- 脚本拒绝旧 `text_groups`、`layout` 和其它字段；脚本不调用模型，不证明图中文字保真。

`--pages` 是本次已看过的 1–3 张参考图页码；脚本校验图片存在，并把参考图路径写入提示词清单。默认主色 `#AD0101`；用户有品牌色时加 `--brand-color #XXXXXX`。脚本只替换提示词里的主色值，不改变其它约束。

## 调用

先读 [DSH 集成](dsh-integration.md) 的工具契约。实际调用当前环境的生图工具（本环境为 `image_generate`）：

- `prompt`：准备好的全文，整段内联传入；插件不读文件。
- `reference_images`：已看过的 1–3 张本地图；不传页码字符串或没看过的图。
- `save_path`：指向工作区；目标已存在会报错。
- `size`：不传，除非用户明确指定分辨率。
- 不传工具没有的参数。
- 提交前展示最终 prompt 全文、尺寸、模型、参考图来源和 save_path，再用确认问题让用户选择“确认生成 / 修改 / 取消”；只有“确认生成”才提交。
- 一次只生成一张；提交后通常 1–4 分钟。超时不要重开任务，用 `task_id` 续等。
- 工具缺失时如实说明阻塞，不假造执行、不自行写 API 调用器、不静默切路线。

## 生成后验收

1. 用 `read_image` 查看真实生成图，读取 `actual_size`；核对 16:9，不用放大图冒称原生分辨率。
2. 对照完整 `source.txt` 逐项读图，在内部 `imagegen-copy-review.json` 记录实际可见文字、原文出处及删词理由。连续取词或句内有序删词才符合规则；错字、同义改写、跨句拼接、无依据标签、主语归属或条件变化均需修正。OCR 仅辅助。
3. 检查标题和总领意思、各项实质论点、必要支撑是否保留；允许取舍不等于任意删论点。
4. 检查真实内容关系、可读性、图示解释力、参考风格和用户认可的亮点；检查纯白底、单色平涂、无未经要求的照片/底图/场景插画，以及形状边界、连接和分组是否清楚、便于 PPT 重建。
5. 有问题用 `image_generate` 定向修正，保持其它合格部分；提供原始上下文和具体错误，避免重写整页。每次修正同样需要确认；正常本轮最多两次有明确目标的修正，仍有关键问题如实说明。
6. 把选定生成图存到工作区交付；原文、提示词和核验记录默认内部使用。原文传递完整不等于图中文字已通过核验。
