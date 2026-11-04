#!/usr/bin/env python3
"""Build a reference library from an arbitrary PPTX.

The builder produces the required raster pages, metadata, manifest and style tokens.
Semantic family/relations annotations are intentionally left as ``builder_auto`` and
must be reviewed by an agent; use --apply-annotations to merge a reviewed JSONL.
This tool does not write into a skill directory and does not prescribe any layout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from lxml import etree

IMAGE_SIZE = (1920, 1080)
IMAGE_QUALITY = 80
DEFAULT_STYLE = {
    "schemaVersion": 1,
    "name": "reference deck tokens",
    "canvas": {"width": 1920, "height": 1080, "aspect": "16:9"},
    "palette": {
        "background": "#FFFFFF", "ink": "#161616", "body": "#242424", "muted": "#8C8C8C",
        "accent": "#AD0101", "accent2": "#C00000", "tint": "#FBF3F3", "line": "#E4E4E4",
    },
    "fonts": {
        "family": "MiSans, Microsoft YaHei, Noto Sans SC",
        "heading": "MiSans Demibold, MiSans Semibold, MiSans, Microsoft YaHei",
        "body": "MiSans, Microsoft YaHei, Noto Sans SC",
    },
    "type_scale": {"title": 46, "lead": 24, "body": 24, "table_body": 22, "label": 16, "source": 15},
    "density": "high",
    "imagery": "none-unless-requested",
    "bullet": {"char": "square", "color": "#AD0101"},
}

THEME_NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def norm_text(text: str) -> str:
    lines = [re.sub(r"[ \t\u00a0]+", " ", line).strip() for line in str(text or "").splitlines()]
    return "\n".join(line for line in lines if line)


def find_soffice(explicit: str | None) -> str:
    candidates = [explicit, os.environ.get("PPT_SOFFICE"), os.environ.get("SOFFICE"), shutil.which("soffice")]
    for key in ("PROGRAMFILES", "PROGRAMFILES(X86)"):
        root = os.environ.get(key)
        if root:
            candidates.extend([
                str(Path(root) / "LibreOffice" / "program" / "soffice.com"),
                str(Path(root) / "LibreOffice" / "program" / "soffice.exe"),
            ])
    for value in candidates:
        if value and Path(value).is_file():
            return str(Path(value))
    raise SystemExit("LibreOffice not found: pass --soffice or set PPT_SOFFICE/SOFFICE")


def convert_to_pdf(pptx: Path, work: Path, soffice: str) -> Path:
    profile = work / ".lo_profile"
    out = work / "pdf"
    out.mkdir(parents=True, exist_ok=True)
    cmd = [soffice, "--headless", "--norestore", f"-env:UserInstallation={profile.resolve().as_uri()}",
           "--convert-to", "pdf", "--outdir", str(out), str(pptx)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
    pdfs = sorted(out.glob("*.pdf"))
    if not pdfs:
        detail = (result.stderr or result.stdout or "").strip()[-1200:]
        raise RuntimeError(f"LibreOffice did not produce a PDF. {detail}")
    return pdfs[0]


def color_from_theme(root, name: str) -> str | None:
    el = root.find(f".//a:clrScheme/a:{name}", THEME_NS)
    if el is None:
        return None
    srgb = el.find("a:srgbClr", THEME_NS)
    if srgb is not None and srgb.get("val"):
        return "#" + srgb.get("val").upper()
    sysclr = el.find("a:sysClr", THEME_NS)
    if sysclr is not None and sysclr.get("lastClr"):
        return "#" + sysclr.get("lastClr").upper()
    return None


def mix_white(hex_color: str, ratio: float = 0.9) -> str:
    value = hex_color.lstrip("#")
    if len(value) != 6:
        return "#FBF3F3"
    rgb = [int(value[i:i + 2], 16) for i in (0, 2, 4)]
    rgb = [round(c + (255 - c) * ratio) for c in rgb]
    return "#" + "".join(f"{c:02X}" for c in rgb)


def extract_style(prs: Presentation, title: str) -> dict:
    style = json.loads(json.dumps(DEFAULT_STYLE))
    style["name"] = title or "reference deck tokens"
    raw = {}
    try:
        theme_part = prs.slide_masters[0].part.part_related_by(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme")
        root = etree.fromstring(theme_part.blob)
        accent = color_from_theme(root, "accent1") or DEFAULT_STYLE["palette"]["accent"]
        accent2 = color_from_theme(root, "accent2") or DEFAULT_STYLE["palette"]["accent2"]
        background = color_from_theme(root, "lt1") or "#FFFFFF"
        text = color_from_theme(root, "dk1") or "#161616"
        line = color_from_theme(root, "accent3") or "#E4E4E4"
        major = root.find(".//a:fontScheme/a:majorFont/a:latin", THEME_NS)
        minor = root.find(".//a:fontScheme/a:minorFont/a:latin", THEME_NS)
        major_name = major.get("typeface") if major is not None else ""
        minor_name = minor.get("typeface") if minor is not None else ""
        raw = {"accent": accent, "accent2": accent2, "text": text, "line": line,
               "font": minor_name or major_name}
        style["palette"].update({
            "background": background, "ink": text, "body": text,
            "accent": accent, "accent2": accent2, "tint": mix_white(accent, 0.9), "line": "#D9D9D9",
        })
        style["bullet"]["color"] = accent
        if major_name or minor_name:
            style["fonts"] = {
                "family": minor_name or major_name,
                "heading": major_name or minor_name,
                "body": minor_name or major_name,
            }
    except Exception as exc:
        raw = {"theme_error": str(exc)}

    sizes = []
    font_counts = Counter()
    for slide in prs.slides:
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            for paragraph in shape.text_frame.paragraphs:
                for run in paragraph.runs:
                    if run.font.size:
                        sizes.append(round(run.font.size.pt, 1))
                    if run.font.name:
                        font_counts[run.font.name] += 1
    if font_counts:
        dominant = font_counts.most_common(1)[0][0]
        style["fonts"] = {"family": dominant, "heading": dominant, "body": dominant}
    if sizes:
        counts = Counter(sizes)
        title_pt = max(counts)
        body_pt = max((pt for pt in counts if pt != title_pt), default=title_pt)
        scale = 2.0
        style["type_scale"] = {
            "title": max(40, min(72, round(title_pt * scale))),
            "lead": max(22, min(36, round(body_pt * scale * 1.6))),
            "body": max(20, min(32, round(body_pt * scale))),
            "table_body": max(18, min(30, round(body_pt * scale * 0.9))),
            "label": max(14, min(24, round(body_pt * scale * 0.7))),
            "source": max(12, min(20, round(body_pt * scale * 0.6))),
        }
    style["palette"] = {k: str(v).upper() if isinstance(v, str) and v.startswith("#") else v
                        for k, v in style["palette"].items()}
    style["source_palette"] = raw
    images = sum(1 for slide in prs.slides for shape in slide.shapes if is_picture(shape))
    style["imagery"] = "mixed-references" if images else "none-unless-requested"
    style["density"] = "high"
    style["notes"] = "Generated from the reference deck; tokens only, no layout prescription. Replace or refine after review."
    return style


def shape_kind(shape) -> str:
    try:
        return shape.shape_type.name.lower()
    except Exception:
        return type(shape).__name__.lower()


def is_picture(shape) -> bool:
    try:
        return shape.shape_type == MSO_SHAPE_TYPE.PICTURE
    except Exception:
        return False


def shape_objects(slide, slide_w: int, slide_h: int) -> list[dict]:
    out = []
    for shape in slide.shapes:
        try:
            left, top, width, height = int(shape.left), int(shape.top), int(shape.width), int(shape.height)
        except Exception:
            continue
        text = ""
        if getattr(shape, "has_text_frame", False):
            text = norm_text(shape.text_frame.text)
        obj = {
            "kind": shape_kind(shape),
            "text": text[:4000],
            "bbox": [round(left / slide_w, 4), round(top / slide_h, 4),
                     round(width / slide_w, 4), round(height / slide_h, 4)],
        }
        try:
            geom = shape.auto_shape_type.name.lower()
            obj["geometry"] = [geom]
        except Exception:
            pass
        out.append(obj)
    return out


def build_library(pptx: Path, out: Path, title: str, limit: int | None, soffice: str, force: bool, progress_enabled: bool = False) -> Path:
    def emit(stage: str, percent: int, message: str = ""):
        if progress_enabled:
            print(json.dumps({"progress": True, "stage": stage, "percent": percent, "message": message}, ensure_ascii=False), flush=True)

    if not pptx.is_file():
        raise SystemExit(f"PPTX not found: {pptx}")
    if out.exists() and not force:
        raise SystemExit(f"Output exists: {out}; pass --force to replace (a backup is kept)")
    work = out.parent / f".{out.name}.building-{os.getpid()}-{int(time.time())}"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    backup = None
    try:
        assets = work / "assets"
        pages_dir = assets / "pages"
        refs = work / "references"
        pages_dir.mkdir(parents=True)
        refs.mkdir(parents=True)
        shutil.copy2(pptx, assets / "reference.pptx")
        emit("converting", 5, "LibreOffice 导出 PDF")
        pdf = convert_to_pdf(pptx, work, soffice)
        emit("rendering", 15, "渲染页面图")

        import pymupdf
        prs = Presentation(str(pptx))
        slide_w, slide_h = prs.slide_width, prs.slide_height
        doc = pymupdf.open(str(pdf))
        total = min(len(prs.slides), len(doc))
        if limit:
            total = min(total, limit)
        style = extract_style(prs, title or pptx.stem)
        index_rows, corpus_rows, page_index_rows, signature_rows = [], [], [], []
        family_counts = Counter()
        for i in range(total):
            page = doc[i]
            rect = page.rect
            scale = min(IMAGE_SIZE[0] / rect.width, IMAGE_SIZE[1] / rect.height)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            image.thumbnail(IMAGE_SIZE, Image.LANCZOS)
            canvas = Image.new("RGB", IMAGE_SIZE, style["palette"].get("background", "#FFFFFF"))
            canvas.paste(image, ((IMAGE_SIZE[0] - image.width) // 2, (IMAGE_SIZE[1] - image.height) // 2))
            image_path = pages_dir / f"{i + 1:03d}.webp"
            canvas.save(image_path, "WEBP", quality=IMAGE_QUALITY, method=6)
            emit("rendering", 15 + round(70 * (i + 1) / max(1, total)), f"渲染 {i + 1}/{total}")

            slide = prs.slides[i]
            text = norm_text(page.get_text("text")) or norm_text("".join(
                shape.text_frame.text for shape in slide.shapes if getattr(shape, "has_text_frame", False)))
            title_shape = slide.shapes.title
            page_title = norm_text(title_shape.text) if title_shape is not None else ""
            if not page_title:
                page_title = next((line for line in text.splitlines() if line.strip()), f"Page {i + 1}")[:160]
            match = re.match(r"^([^：:]{1,16})[：:]", page_title)
            category = match.group(1).strip() if match else "未分类"
            char_count = len(re.sub(r"\s+", "", text))
            density = "low" if char_count < 180 else "medium" if char_count < 450 else "high"
            shapes = list(slide.shapes)
            pictures = sum(1 for s in shapes if is_picture(s))
            tables = sum(1 for s in shapes if getattr(s, "has_table", False))
            major = [s for s in shapes if s.width * s.height >= slide_w * slide_h * 0.02]
            group_count = max(1, min(6, len(major)))
            objects = shape_objects(slide, slide_w, slide_h)
            family = "unknown"
            family_counts[family] += 1
            layout_note = f"builder 自动生成：{len(shapes)} 个对象、{pictures} 张图片、{tables} 个表格；待 agent 标注关系"
            row = {
                "page": i + 1, "category": category, "title": page_title,
                "char_count": char_count, "density": density,
                "relation_hints": [], "primary_family": family, "relations": [],
                "object_count": len(shapes), "annotation_basis": "builder_auto",
                "image": f"assets/pages/{i + 1:03d}.webp",
                "group_count": group_count,
                "layout_note": layout_note,
                "detail_review": "auto_build_pending_agent_review",
            }
            index_rows.append(row)
            corpus_rows.append({"page": i + 1, "text": text})
            page_index_rows.append({"page": i + 1, "category": category, "text": text,
                                    "shapes": len(shapes), "pictures": pictures, "tables": tables})
            sizes = sorted({round(run.font.size.pt, 1) for sh in shapes if getattr(sh, "has_text_frame", False)
                            for p in sh.text_frame.paragraphs for run in p.runs if run.font.size})
            rect = sum(1 for s in shapes if shape_kind(s) in ("auto_shape", "rectangle"))
            roundrect = sum(1 for s in shapes if "round" in shape_kind(s))
            signature_rows.append({
                "page": i + 1, "category": category,
                "sig": {"rows": group_count, "arrows": 0, "cards": len(shapes),
                        "roundRect": roundrect, "rect": rect, "red": 0, "accent": 0,
                        "nshape": len(shapes), "sizes": sizes},
                "conn_samples": [], "card_samples": [],
            })
            page_json = {
                "page": i + 1, "category": category, "title": page_title, "text": text,
                "char_count": char_count, "density": density, "relation_hints": [],
                "primary_family": family, "relations": [], "objects": objects,
                "group_count": group_count, "annotation_basis": "builder_auto",
                "layout_note": layout_note,
            }
            (refs / "pages").mkdir(exist_ok=True)
            (refs / "pages" / f"{i + 1:03d}.json").write_text(
                json.dumps(page_json, ensure_ascii=False, indent=2), encoding="utf-8")

        jsonl(refs / "index.jsonl", index_rows)
        jsonl(refs / "corpus.jsonl", corpus_rows)
        jsonl(refs / "page-index.jsonl", page_index_rows)
        jsonl(refs / "page-signature.jsonl", signature_rows)
        jsonl(refs / "annotation-template.jsonl", [
            {"page": r["page"], "primary_family": "", "relations": [], "group_count": r["group_count"], "layout_note": ""}
            for r in index_rows
        ])
        emit("indexing", 90, "写入索引、manifest 和 style")
        style_path = work / "style.json"
        style_path.write_text(json.dumps(style, ensure_ascii=False, indent=2), encoding="utf-8")
        created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        library_manifest = {
            "page_count": total, "source_sha256": sha256_file(assets / "reference.pptx"),
            "source_slide_size_emu": [slide_w, slide_h], "page_image_size": list(IMAGE_SIZE),
            "contact_sheet_count": 0,
            "renderer": "LibreOffice PDF export + PyMuPDF rasterization",
            "visual_review": "auto-generated; agent visual annotation pending",
            "note": "All pages included up to --limit; images are reference renders, not a claim of pixel identity to Microsoft PowerPoint.",
            "full_size_inspected_pages": [], "primary_family_counts": dict(family_counts),
            "asset_encoding": {
                "format": "webp",
                "page_images": {"width": IMAGE_SIZE[0], "height": IMAGE_SIZE[1], "quality": IMAGE_QUALITY, "required": True},
                "thumbnails": {"required": False, "derivedFrom": "page_images"},
                "contact_sheets": {"required": False, "width": 1600},
            },
            "needs_annotation": True,
        }
        (refs / "library-manifest.json").write_text(json.dumps(library_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        manifest = {
            "schemaVersion": 1, "pageCount": total,
            "sourceSha256": library_manifest["source_sha256"], "createdAt": created,
            "sourceFiles": {"pptx": "assets/reference.pptx", "library": "references/library-manifest.json",
                            "searchIndex": "references/index.jsonl", "geometryIndex": "references/page-signature.jsonl",
                            "styleProfile": "style.json"},
            "assetEncoding": {
                "format": "webp",
                "page_images": {"width": IMAGE_SIZE[0], "height": IMAGE_SIZE[1], "quality": IMAGE_QUALITY, "required": True},
                "thumbnails": {"required": False, "derivedFrom": "page_images",
                               "note": "Optional; find_reference.py resizes page_images when absent."},
                "contact_sheets": {"required": False, "note": "Optional; find_reference.py --gallery builds candidate sheets on demand."},
            },
            "asset_encoding": {
                "format": "webp",
                "page_images": {"width": IMAGE_SIZE[0], "height": IMAGE_SIZE[1], "quality": IMAGE_QUALITY, "required": True},
                "thumbnails": {"required": False, "derivedFrom": "page_images"},
                "contact_sheets": {"required": False, "width": 1600},
            },
            "provenance": {"source": pptx.name, "builder": "tools/reference_builder.py", "needsAnnotation": True},
            "needsAnnotation": True,
        }
        (work / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        (work / "references" / "library-map.md").write_text(render_map(index_rows, title or pptx.stem), encoding="utf-8")
        (work / "README.md").write_text(render_readme(title or pptx.stem, total), encoding="utf-8")
        doc.close()
        del doc
        del prs
        import gc
        gc.collect()
        shutil.rmtree(work / "pdf", ignore_errors=True)
        shutil.rmtree(work / ".lo_profile", ignore_errors=True)
        if backup is None and out.exists():
            backup = out.parent / f".{out.name}.backup-{int(time.time())}"
            out.rename(backup)
        if out.exists():
            raise RuntimeError(f"Output still exists: {out}")
        emit("switching", 96, "切换到新参考库")
        work.rename(out)
        emit("done", 100, "参考库构建完成")
        return out
    except Exception:
        if backup and backup.exists() and not out.exists():
            backup.rename(out)
        if work.exists():
            shutil.rmtree(work, ignore_errors=True)
        raise


def render_map(rows: list[dict], title: str) -> str:
    lines = [f"# {title} 参考库导航", "", "本库由 `tools/reference_builder.py` 自动生成；关系/层级标注待 agent 复核。", "",
             "| 页 | 分类 | 标题 | 密度 | 组数 | 标注 |", "|---|---|---|---|---|---|"]
    for row in rows:
        title = row["title"].replace("|", "\\|")
        lines.append(f"| {row['page']} | {row['category']} | {title} | {row['density']} | {row['group_count']} | {row['annotation_basis']} |")
    return "\n".join(lines) + "\n"


def render_readme(title: str, pages: int) -> str:
    return f"""# {title} 参考库

由 `tools/reference_builder.py` 自动生成，共 {pages} 页。

## 必需

- `assets/pages/NNN.webp`：1920×1080 页面渲染（必需栅格源）
- `assets/reference.pptx`：源稿
- `references/index.jsonl`、`corpus.jsonl`、`pages/NNN.json`：检索与页面资料
- `references/page-index.jsonl`、`page-signature.jsonl`：几何索引
- `manifest.json`、`references/library-manifest.json`
- `style.json`：视觉 tokens（颜色/字体/字阶/密度/图像策略；不含版式）

## 待完成

`references/index.jsonl` 的 `primary_family` / `relations` 仍为 `builder_auto`。请 agent
按页面实际内容补标注，然后运行：

```text
python tools/reference_builder.py --out <本目录> --apply-annotations <标注.jsonl>
```

标注字段：`page, primary_family, relations, group_count, layout_note`。

`assets/thumbs` / `assets/contacts` 未生成；`find_reference.py --gallery` 会按需从页面图缩放。
"""


def apply_annotations(out: Path, annotations: Path) -> None:
    index_path = out / "references" / "index.jsonl"
    if not index_path.is_file():
        raise SystemExit(f"Not a reference library: {out}")
    rows = [json.loads(x) for x in index_path.read_text(encoding="utf-8").splitlines() if x.strip()]
    by_page = {r["page"]: r for r in rows}
    updates = {}
    for line in annotations.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        page = item.get("page")
        if page not in by_page:
            raise SystemExit(f"Unknown page in annotations: {page}")
        updates[page] = item
    for page, item in updates.items():
        row = by_page[page]
        if item.get("annotation_basis") == "builder_auto":
            continue
        if item.get("primary_family"):
            row["primary_family"] = str(item["primary_family"]).strip()
        if isinstance(item.get("relations"), list):
            row["relations"] = [str(x).strip() for x in item["relations"] if str(x).strip()]
        if isinstance(item.get("group_count"), int) and item["group_count"] > 0:
            row["group_count"] = item["group_count"]
        if item.get("layout_note"):
            row["layout_note"] = str(item["layout_note"]).strip()
        row["annotation_basis"] = "agent_visual_contact_sheet_review"
    jsonl(index_path, rows)
    page_dir = out / "references" / "pages"
    for page, item in updates.items():
        if item.get("annotation_basis") == "builder_auto":
            continue
        p = page_dir / f"{page:03d}.json"
        if not p.is_file():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        data.update({k: item[k] for k in ("primary_family", "relations", "group_count", "layout_note") if k in item})
        data["annotation_basis"] = "agent_visual_contact_sheet_review"
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = Counter(r.get("primary_family", "unknown") for r in rows)
    for manifest_path in (out / "references" / "library-manifest.json", out / "manifest.json"):
        if not manifest_path.is_file():
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["primary_family_counts"] = dict(counts)
        manifest["needs_annotation"] = any(r.get("annotation_basis") == "builder_auto" for r in rows)
        manifest["needsAnnotation"] = manifest["needs_annotation"]
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "references" / "library-map.md").write_text(render_map(rows, out.name), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pptx", help="Source PPTX")
    parser.add_argument("--out", required=True, help="Reference-library output directory")
    parser.add_argument("--title", default="", help="Library display title")
    parser.add_argument("--limit", type=int, help="Only build the first N pages (testing)")
    parser.add_argument("--force", action="store_true", help="Replace an existing output; a backup is kept")
    parser.add_argument("--soffice", help="LibreOffice executable")
    parser.add_argument("--apply-annotations", help="Merge an agent-reviewed JSONL into an existing library")
    parser.add_argument("--reuse-annotations", help="After a rebuild, merge annotations from a previous library index")
    parser.add_argument("--progress", action="store_true", help="Emit JSONL progress lines for the host UI")
    args = parser.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    out = Path(args.out).resolve()
    if args.apply_annotations:
        apply_annotations(out, Path(args.apply_annotations).resolve())
        print(json.dumps({"ok": True, "output": str(out), "annotations": args.apply_annotations}, ensure_ascii=False, indent=2))
        return
    if not args.pptx:
        parser.error("--pptx is required unless --apply-annotations is used")
    result = build_library(Path(args.pptx).resolve(), out, args.title, args.limit, find_soffice(args.soffice), args.force, args.progress)
    if args.reuse_annotations:
        apply_annotations(result, Path(args.reuse_annotations).resolve())
    print(json.dumps({"ok": True, "output": str(result), "pages": len(list((result / "assets/pages").glob("*.webp"))),
                      "annotations_reused": bool(args.reuse_annotations),
                      "next": "Review assets/pages, fill references/annotation-template.jsonl, then run --apply-annotations."},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
