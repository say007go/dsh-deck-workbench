# ppt-layout

按一份既有参考稿的页面设计，制作新页面或整套方案。主线是**复刻参考稿的视觉语言**，
信息骨架每次重新设计。

## 目录结构

```
ppt-layout/
├── SKILL.md                      工作流程与继承判据
├── README.md                     本文件
├── assets/
│   └── build-kit/
│       ├── reference_root.py     共享参考库路径解析
│       ├── pptx_kit.py           出页工具箱（度量、造型、继承、渲染链）
│       ├── audit.py               一条命令跑完复核链
│       ├── merge_pages.py        多页合并成一份 deck
│       └── scan_parts.py         几何检索与骨架查重
└── references/
    ├── design-rules.md            设计规则与借鉴层级判据
    ├── quickstart.md              快速路径与坑表
    ├── page-guide.md              参考页选用指南
    └── parts-catalog.md           零件目录
```

参考稿、页面图、`page-index.jsonl` 和 `page-signature.jsonl` 都在共享参考库中，不放在技能目录；由 `assets/build-kit/reference_root.py` 解析。

## 快速上手

```bash
# 1) 在参考稿里找目标页（按几何特征筛，不逐页翻）
python assets/build-kit/scan_parts.py <筛选条件>   # 默认解析共享参考库

# 2) 出页（颜色走 pal()，不写死）
python my_page.py

# 3) 合并多页
python assets/build-kit/merge_pages.py --out 成品.pptx p1.pptx p2.pptx ...

# 4) 审计（单页 --pptx，多页 --all）
python assets/build-kit/audit.py --all --pptx 成品.pptx
```

## 依赖

系统 Python 需有 `python-pptx`、`lxml`、`Pillow`、`numpy`、`pymupdf`；
渲染 PDF 需本机装有 LibreOffice（`soffice`）。调用时用系统 Python 的**完整路径**。

## 工具箱能力一览

- **继承与探测**：`open_reference()` `open_deck()` `probe_theme()` `probe_lead_spec()`
  `probe_title_spec()` `probe_para_style()` `probe_bullet_style()` `probe_type_scale()`
  `pick_reference_page()`
- **出页**：`setup_title()` `setup_lead()` `add_textbox()` `add_round_rect()` `add_arrow()`
  `add_strip()` `add_chip()` `bullet_para()` `set_para_multiline()`
- **度量与预检**：`text_width_in()` `fit_check()` `wrap_manual()` `orphan_check()`
- **复核**：`audit.py`（八道关）`measure_text_bands()` `lead_clearance_audit()`
  `text_overflow_audit()` `type_scale_audit()` `scan_parts.py --skeleton`
- **自检**：`selfcheck.py`（7 项：语法／导入／文件闭合／文档-实现闭合／探测链路／常量口径／**门禁有效性自证**）
- **交付**：`merge_pages.py` 合并多页；`render_pdf()` / `render_png()` / `crop_regions()` 渲染链
