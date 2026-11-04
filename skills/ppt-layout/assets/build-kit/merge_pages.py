# -*- coding: utf-8 -*-
"""
merge_pages —— 把多个单页 pptx 合并成一份多页 deck

    python merge_pages.py --out 方案.pptx 页1.pptx 页2.pptx ...

为什么需要：单页出页（open_reference）便于逐页打磨，但交付形态是「一份 N 页
方案」。本工具把已做好的单页按顺序合并，保留母版/版式/主题，各页视觉一致。

实现要点：
  · 以第一个 pptx 为基底（它已含母版、版式、主题、页面尺寸）
  · 后续每页：新建 slide（沿用同一 layout）→ 搬入源页 spTree 里的形状
  · 只搬「形状」层（sp / pic / graphicFrame / cxnSp），不搬标题占位本身：
    新页自带的标题占位与源页标题同名同位，保留新页的即可
  · 源页若有图片关系（r:embed），同步复制图片部件并重映射 rId

页序 = 命令行给出的顺序。
"""
import argparse, copy, io, os, shutil, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from pptx import Presentation
from lxml import etree

A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
PA = '{%s}' % A
PP = '{%s}' % P
PR = '{%s}' % R

SHAPE_TAGS = {PP + t for t in ('sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp')}


def _rpr_with_embed(el):
    """收集元素内所有 r:embed / r:link 的 rId。"""
    out = []
    for node in el.iter():
        for k, v in node.attrib.items():
            if k.startswith('{%s}' % R) and k.split('}')[1] in ('embed', 'link', 'id'):
                out.append(v)
    return out


def _find_title_placeholder(slide):
    """返回该页的标题占位符（idx==0），没有则 None。"""
    for sh in slide.shapes:
        if not sh.is_placeholder:
            continue
        try:
            if sh.placeholder_format.idx == 0:
                return sh
        except Exception:
            pass
    return None


def _copy_title_text(dst_slide, src_slide):
    """把源页标题的**文字与几何**搬进目标页自带的标题占位符。

    为什么单独处理：形状搬移时源页标题占位被跳过（目标页自带的占位符在
    占位身份/继承关系上才是对的），但两样东西必须补回来：

      1. 标题文字 —— 否则合并后第 2 页起全部丢标题；
      2. 标题框几何 —— setup_title() 会把标题框**放宽**到版式标题带的可用
         范围（避免长标题挤到换行），而 add_slide(layout) 新建的占位符宽度
         取的是版式默认值。几何不搬，合并后标题会重新折行。

    这里只搬段落与 a:xfrm，不搬整个 spPr —— 填充/描边等仍由占位符与版式决定。
    """
    src_title = _find_title_placeholder(src_slide)
    dst_title = _find_title_placeholder(dst_slide)
    if src_title is None or dst_title is None:
        return False

    src_tx = src_title.text_frame._txBody
    dst_tx = dst_title.text_frame._txBody
    paras = src_tx.findall(PA + 'p')
    if not paras:
        return False
    for p in list(dst_tx.findall(PA + 'p')):
        dst_tx.remove(p)
    for p in paras:
        dst_tx.append(copy.deepcopy(p))

    # 几何：源页标题的 xfrm（位置 + 宽高）原样搬过来
    src_xfrm = src_title._element.find(PP + 'spPr')
    src_xfrm = src_xfrm.find(PA + 'xfrm') if src_xfrm is not None else None
    if src_xfrm is not None:
        dst_spPr = dst_title._element.find(PP + 'spPr')
        if dst_spPr is None:
            dst_spPr = dst_title._element.makeelement(PP + 'spPr', {})
            dst_title._element.insert(0, dst_spPr)
        old = dst_spPr.find(PA + 'xfrm')
        if old is not None:
            dst_spPr.remove(old)
        dst_spPr.insert(0, copy.deepcopy(src_xfrm))
    return True


def copy_slide_shapes(dst_slide, src_pptx_path, src_index=0):
    """把源 pptx 某一页的形状搬进目标页（标题占位保留目标页的，文字另搬）。"""
    src = Presentation(src_pptx_path)
    src_slide = src.slides[src_index]

    src_tree = src_slide._element.find(PP + 'cSld').find(PP + 'spTree')
    dst_tree = dst_slide._element.find(PP + 'cSld').find(PP + 'spTree')

    # 源页标题占位的 shape id（不搬，用目标页自带的）
    src_title_ids = set()
    for sh in src_slide.shapes:
        if sh.is_placeholder:
            try:
                if sh.placeholder_format.idx == 0:
                    src_title_ids.add(sh.shape_id)
            except Exception:
                pass

    # 目标页现有的非标题形状（先移除，避免重复）
    for sh in list(dst_tree):
        if sh.tag in SHAPE_TAGS:
            nv = sh.find('.//' + PP + 'cNvPr')
            sid = nv.get('id') if nv is not None else None
            if sid and int(sid) in src_title_ids:
                continue
            dst_tree.remove(sh)

    # 图片部件映射：源 rId -> 目标 rId
    rid_map = {}

    def copy_media(rid):
        if rid in rid_map:
            return rid_map[rid]
        try:
            part = src_slide.part.related_part(rid)
        except Exception:
            return None
        image_part, new_rid = dst_slide.part.get_or_add_image_part(part.blob)
        rid_map[rid] = new_rid
        return new_rid

    moved = 0
    for sh in src_tree:
        if sh.tag not in SHAPE_TAGS:
            continue
        nv = sh.find('.//' + PP + 'cNvPr')
        sid = int(nv.get('id')) if nv is not None and nv.get('id') else None
        if sid and sid in src_title_ids:
            continue
        new = copy.deepcopy(sh)
        # 重映射图片 rId
        for old_rid in set(_rpr_with_embed(new)):
            if old_rid in rid_map:
                continue
            new_rid = copy_media(old_rid)
            if new_rid:
                for node in new.iter():
                    for k, v in list(node.attrib.items()):
                        if k.startswith('{%s}' % R) and v == old_rid:
                            node.set(k, new_rid)
        # shape id 重编号，避免与目标页冲突
        ids = [int(n.get('id')) for n in dst_tree.iter(PP + 'cNvPr')
               if n.get('id') and n.get('id').isdigit()]
        new_id = max(ids) + 1 if ids else 100
        for n in new.iter(PP + 'cNvPr'):
            n.set('id', str(new_id))
            break
        dst_tree.append(new)
        moved += 1
    _copy_title_text(dst_slide, src_slide)
    return moved


def merge(pptx_paths, out_path, template=None):
    """按顺序合并多个单页 pptx 到一份 deck。"""
    if not pptx_paths:
        raise ValueError('至少给一个 pptx')
    base = Presentation(template or pptx_paths[0])
    # 确保基底只有第一页内容，后续用它的 layout 新建
    base_slide = base.slides[0]
    layout = base_slide.slide_layout

    # 第一页：直接把源页形状搬进基底页
    moved0 = copy_slide_shapes(base_slide, pptx_paths[0])

    for path in pptx_paths[1:]:
        ns = base.slides.add_slide(layout)
        copy_slide_shapes(ns, path)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    base.save(out_path)
    kb = os.path.getsize(out_path) / 1024.0
    print('已合并 %d 页 -> %s (%.0f KB)' % (len(pptx_paths), out_path, kb))
    return out_path


def main():
    ap = argparse.ArgumentParser(description='把多个单页 pptx 合并成一份多页 deck')
    ap.add_argument('pptx', nargs='+', help='按页序排列的单页 pptx')
    ap.add_argument('--out', required=True, help='输出的多页 pptx 路径')
    ap.add_argument('--template', default='', help='基底模板（默认用第一个 pptx）')
    args = ap.parse_args()
    merge(args.pptx, args.out, args.template or None)


if __name__ == '__main__':
    main()
