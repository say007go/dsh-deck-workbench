# -*- coding: utf-8 -*-
"""probe_spec —— 一条命令读出参考稿的完整视觉规格

    python probe_spec.py <参考稿.pptx> [--page N] [--json]

输出该参考稿的：主题色与字体 / 标题规格 / 导语规格 / 段落样式 /
字阶 / 项目符号 / 典型正文页 / 形状清单。这些值就是后续出页要继承的东西，
**全部来自实测，不预设**。

先跑这一步，能把"这份稿到底长什么样"从猜测变成可核对的事实，
也避免直接拿封面页当参考而崩版。
"""
import argparse
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation

from pptx_kit import (open_reference, load_palette, probe_theme, probe_bullet_style,
                     probe_lead_spec, probe_title_spec, probe_para_style, size_profile,
                     probe_type_scale, pick_reference_page, find_lead_box, find_title_box,
                     _find_lead_shape, text_width_in, probe_part_vocab)
from reference_root import resolve as resolve_reference


def shape_list(slide, limit=40):
    out = []
    for sh in list(slide.shapes)[:limit]:
        t = ''
        try:
            if sh.has_text_frame:
                t = sh.text_frame.text.strip().replace('\n', '|')[:34]
        except Exception:
            pass
        out.append({
            'name': sh.name,
            'placeholder': bool(sh.is_placeholder),
            'L': round((sh.left or 0) / 914400.0, 3),
            'T': round((sh.top or 0) / 914400.0, 3),
            'W': round((sh.width or 0) / 914400.0, 3),
            'H': round((sh.height or 0) / 914400.0, 3),
            'text': t,
        })
    return out


def main():
    ap = argparse.ArgumentParser(description='读出参考稿的视觉规格')
    ap.add_argument('pptx', nargs='?', default='', help='参考稿路径；省略时解析共享参考库')
    ap.add_argument('--reference', default='', help='共享参考库目录；省略时读 DECK_REFERENCE_ROOT 或 reference.json')
    ap.add_argument('--page', type=int, default=0,
                    help='指定参考页（1-based）；不给则自动挑典型正文页')
    ap.add_argument('--json', action='store_true', help='输出 JSON')
    args = ap.parse_args()

    if args.pptx:
        src = os.path.abspath(args.pptx)
    else:
        skill = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        root = resolve_reference(args.reference, ('assets/reference.pptx',), skill)
        if root is None:
            ap.error('缺少参考稿路径，且未配置共享参考库（--reference / DECK_REFERENCE_ROOT / reference.json）')
        src = os.path.join(str(root), 'assets', 'reference.pptx')
    if not os.path.exists(src):
        ap.error('参考稿不存在：%s' % src)
    raw = Presentation(src)
    total = len(raw.slides)
    auto = pick_reference_page(raw)
    page = args.page or auto

    prs, slide = open_reference(src, keep=page)
    pal = probe_theme(prs)
    load_palette(prs)

    spec = probe_lead_spec(slide)
    tspec = probe_title_spec(slide)
    lb = find_lead_box(slide)
    tb = find_title_box(slide)
    para = probe_para_style(lb.text_frame.paragraphs[0]) if lb is not None else None
    scale = size_profile(slide)
    vocab = probe_part_vocab(raw)
    types = probe_type_scale(slide)

    info = {
        'file': os.path.basename(src),
        'total_pages': total,
        'auto_picked_page': auto,
        'used_page': page,
        'layout': slide.slide_layout.name,
        'slide_size_in': [round(prs.slide_width / 914400.0, 3),
                          round(prs.slide_height / 914400.0, 3)],
        'palette': pal,
        'bullet_style': probe_bullet_style(raw),
        'title_spec': tspec,
        'lead_spec': spec,
        'lead_para_style': para,
        'type_scale': scale,
        'type_scale_inferred': types,
        'part_vocab': vocab,
        'lead_box': (lb.name if lb is not None else None),
        'title_box': (tb.name if tb is not None else None),
        'shapes': shape_list(slide),
    }

    if args.json:
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    print('=' * 64)
    print('参考稿：%s' % info['file'])
    print('总页数 %d ｜ 自动选的典型正文页 = 第 %d 页 ｜ 本次使用 = 第 %d 页'
          % (total, auto, page))
    print('版式：%s ｜ 画幅 %s x %s in' % (info['layout'], *info['slide_size_in']))
    print()
    print('【配色与字体】全部实测，不预设')
    for k, v in sorted(pal.items()):
        print('   %-10s = %s' % (k, v))
    print()
    print('【项目符号】%s' % info['bullet_style'])
    print()
    print('【标题】%s' % (info['title_box'] or '未找到'))
    if tspec:
        print('   几何 L=%.3f T=%.3f W=%.3f H=%.3f ｜ 占位符=%s'
              % (tspec['left'], tspec['top'], tspec['width'], tspec['height'],
                 tspec['is_placeholder']))
        print('   字号 主=%s 副=%s ｜ 颜色 %s / %s ｜ 字体 %s'
              % (tspec['size_lead'], tspec['size_sub'], tspec['color_lead'],
                 tspec['color_sub'], tspec['font']))
        if not tspec['is_placeholder']:
            print('   ⚠ 标题不是占位符：新建页不会自动带出标题框，'
                  '需用 add_title_box() 按此规格补建')
    print()
    print('【导语】%s' % (info['lead_box'] or '未找到'))
    if spec:
        print('   几何 L=%.3f T=%.3f W=%.3f H=%.3f'
              % (spec['left'], spec['top'], spec['width'], spec['height']))
        print('   字号 %s ｜ 字体 %s ｜ 颜色 %s'
              % (spec['size'], spec['font'], spec['color']))
        if para:
            print('   段落样式 行距=%s 缩进=%s/%s 符号=%s(%s) 符号色=%s'
                  % (para.get('line_spacing'), para.get('marL'), para.get('indent'),
                     para.get('bullet'), para.get('bu_font'), para.get('bu_color')))
    print()
    print('【字阶】字号分布（按字符数）')
    for sz, n in sorted(scale.items(), reverse=True):
        print('   %5.1f pt × %d' % (sz, n))
    print('   推断档位：%s' % types)
    print()
    print('【构件语汇】参考稿正文区实心块的形状比例（出页只用这里的比例，别自创）')
    for k, v in vocab['buckets'].items():
        print('   %-18s %d' % (k, v))
    print('   常用尺寸: %s' % ', '.join('%s x%d' % (d, c) for d, c in vocab['top_dims'][:10]))
    print('   窄色条(0.035-0.12" 宽)全稿 %d 根，单页最多 %d 根'
          % (vocab['narrow_bar_total'], vocab['narrow_bar_max_per_page']))
    print()
    print('【形状清单（前 %d 个）】' % len(info['shapes']))
    for s in info['shapes']:
        print('   %-22s ph=%-5s L=%6.3f T=%6.3f W=%6.3f H=%6.3f  %s'
              % (s['name'][:22], s['placeholder'], s['L'], s['T'], s['W'], s['H'],
                 s['text']))
    print()
    print('下一步：用 open_reference(src, keep=%d) 打开后即可按上述规格出页。' % page)
    return 0


if __name__ == '__main__':
    sys.exit(main())
