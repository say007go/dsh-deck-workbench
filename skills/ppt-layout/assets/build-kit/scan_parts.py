# -*- coding: utf-8 -*-
"""
scan_parts —— 参考稿的客观几何索引与零件检索

    python scan_parts.py --build                     生成/刷新参考库的签名索引
    python scan_parts.py --find arrows --min 3       找含 ≥3 个箭头连接件的页
    python scan_parts.py --find cols --min 4         找存在 4 列等宽卡片组的页
    python scan_parts.py --find geom --geom chevron  按 prstGeom 过滤
    python scan_parts.py --spec 116                  导出某页的零件规格表（几何/填充/字号/文本）

设计立场：
    本工具只描述参考稿的**客观几何**——形状类型、位置尺寸、填充描边、字号。
    它不判断"这一页适不适合"，也不推荐任何版式；选型仍由人/模型按内容关系决定。
    它的作用是把整库参考页压缩成可检索的结构签名，让目视复核从全库降到几十页。
"""
import argparse, io, json, os, re, sys
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from pptx import Presentation
from lxml import etree
from reference_root import resolve as resolve_reference

A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
EMU = 914400.0

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(os.path.dirname(HERE))
# 默认路径优先解析共享参考库（--reference / DECK_REFERENCE_ROOT / reference.json），
# 找不到时回退本 skill 自带副本。**用 --reference / --signature / --index 可覆盖**。
REFERENCE_ROOT = resolve_reference(
    None,
    ('assets/reference.pptx', 'references/page-index.jsonl', 'references/page-signature.jsonl'),
    SKILL,
)


def _ref_asset(rel):
    if REFERENCE_ROOT is None:
        return ''
    p = os.path.join(str(REFERENCE_ROOT), *rel.split('/'))
    return p if os.path.exists(p) else ''


REFERENCE = _ref_asset('assets/reference.pptx')
INDEX = _ref_asset('references/page-index.jsonl')
SIGNATURE = _ref_asset('references/page-signature.jsonl')

# 运行期可被命令行覆盖的路径
REF_PATH = REFERENCE
IDX_PATH = INDEX
SIG_PATH = SIGNATURE


def _require(path, what, flag):
    """路径不存在时给出可操作的报错，而不是静默失败或空结果。"""
    if path and os.path.exists(path):
        return path
    print('!! 找不到%s：%s' % (what, path or '（本技能不内置该文件）'))
    print('   本工具不内置参考稿时，请用 %s <路径> 指定。' % flag)
    sys.exit(2)

# 视为「连接件」的几何形状
CONNECTOR_GEOMS = {'rightArrow', 'leftArrow', 'leftRightArrow', 'upArrow', 'downArrow',
                   'bentArrow', 'curvedRightArrow', 'chevron', 'homePlate',
                   'triangle', 'arrow', 'circularArrow', 'swooshArrow'}
# 卡片类几何
CARD_GEOMS = {'roundRect', 'rect', 'round1Rect', 'round2SameRect', 'flowChartProcess',
              'snip1Rect', 'snip2SameRect', 'chevron'}

REDISH = ('AD0101', 'C00000', 'A6091D', '9E1B32', 'BE1E2D', 'D00000', 'E03C31')


def _hex_rgb(v):
    """'#RRGGBB' -> (r,g,b)；不是 srgb 实色则返回 None。"""
    if not v or not v.startswith('#') or len(v) != 7:
        return None
    try:
        return int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16)
    except ValueError:
        return None


def _near(a, b, tol=42):
    """两个实色是否足够接近（按 RGB 立方距离的宽松阈值）。"""
    ra, ga, ba = a
    rb, gb, bb = b
    return abs(ra - rb) + abs(ga - gb) + abs(ba - bb) <= tol


def probe_accent(reference=REF_PATH):
    """从参考稿主题读出强调色（accent1），失败返回 None。

    用于统计「强调色块」——这是**跟随参考稿主题色**的通用特征，
    而 sig['red'] 是内置红黑稿专属的固定色值表（保留以兼容既有签名库）。
    """
    try:
        prs = Presentation(reference)
        theme = prs.slide_masters[0].part.part_related_by(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme')
        root = etree.fromstring(theme.blob)
        ns = {'a': A}
        scheme = root.find('.//a:clrScheme', ns)
        if scheme is None:
            return None
        el = scheme.find('a:accent1', ns)
        if el is None:
            return None
        srgb = el.find('a:srgbClr', ns)
        if srgb is None:
            return None
        v = srgb.get('val')
        return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
    except Exception:
        return None


def shape_info(sh):
    """提取单个形状的客观规格。"""
    try:
        xml = etree.tostring(sh._element).decode('utf-8')
    except Exception:
        return None
    gm = re.search(r'prstGeom prst="(\w+)"', xml)
    if not gm:
        return None                      # 只收真实形状（占位符/图片另计）
    geom = gm.group(1)

    fill = 'none'
    fm = re.search(r'<a:solidFill>(.*?)</a:solidFill>', xml, re.S)
    if fm:
        t = fm.group(1)
        c = re.search(r'srgbClr val="([0-9A-Fa-f]{6})"', t)
        s = re.search(r'schemeClr val="(\w+)"', t)
        fill = ('#' + c.group(1)) if c else (('scheme:' + s.group(1)) if s else '?')
        al = re.search(r'alpha val="(\d+)"', t)
        if al:
            fill += '@%d%%' % (int(al.group(1)) // 1000)
    else:
        alt = re.search(r'<a:(noFill|gradFill|blipFill)', xml)
        fill = alt.group(1) if alt else '-'

    line = 'none'
    lm = re.search(r'<a:ln[^>]*>(.*?)</a:ln>', xml, re.S)
    if lm:
        t = lm.group(1)
        c = re.search(r'srgbClr val="([0-9A-Fa-f]{6})"', t)
        if c:
            w = re.search(r'<a:ln[^>]*w="(\d+)"', xml)
            line = '#%s w=%s' % (c.group(1),
                                 round(int(w.group(1)) / 12700, 2) if w else '-')
        elif '<a:noFill/>' in t:
            line = 'none'

    adj = re.findall(r'<a:gd name="(\w+)" fmla="val (-?\d+)"', xml)
    sizes = sorted({int(s) / 100 for s in re.findall(r'sz="(\d+)"', xml)})
    # 文本框也带 prstGeom rect；骨架判定必须把文本框与形状卡区分开
    is_textbox = 'txBox="1"' in xml
    try:
        txt = ' '.join(sh.text_frame.text.split())[:40]
    except Exception:
        txt = ''
    return {
        'g': geom,
        'tx': is_textbox,
        'L': round(sh.left / EMU, 2), 'T': round(sh.top / EMU, 2),
        'W': round(sh.width / EMU, 2), 'H': round(sh.height / EMU, 2),
        'f': fill, 'ln': line,
        'adj': {k: int(v) for k, v in adj[:2]},
        'sz': sizes,
        't': txt,
    }


def signature(shapes, accent_rgb=None):
    """由几何推出结构签名（纯客观）。"""
    sig = {}
    # 横向等宽组：同一 top、同一 height、N 个同宽形状
    rows = defaultdict(list)
    for s in shapes:
        rows[(round(s['T'], 1), s['H'])].append(s)
    cols = []
    for (t, h), grp in rows.items():
        if len(grp) >= 2 and len({round(g['W'], 2) for g in grp}) == 1:
            cols.append(len(grp))
    if cols:
        sig['cols'] = max(cols)
    # 纵向等高组：同一 left、同一 width、N 个同高形状
    colsg = defaultdict(list)
    for s in shapes:
        colsg[(round(s['L'], 1), s['W'])].append(s)
    rowsn = []
    for (l, w), grp in colsg.items():
        if len(grp) >= 2 and len({round(g['H'], 2) for g in grp}) == 1:
            rowsn.append(len(grp))
    if rowsn:
        sig['rows'] = max(rowsn)

    g = Counter(s['g'] for s in shapes)
    sig['arrows'] = sum(g[k] for k in CONNECTOR_GEOMS)
    sig['cards'] = sum(g[k] for k in CARD_GEOMS)
    for k in ('chevron', 'rightArrow', 'ellipse', 'roundRect', 'rect', 'trapezoid',
              'pentagon', 'diamond', 'line', 'pie', 'arc', 'can', 'cube'):
        if g.get(k):
            sig[k] = g[k]
    sig['red'] = sum(1 for s in shapes if any(r in s['f'].upper() for r in REDISH))
    # 强调色块：跟随参考稿主题 accent1 的通用特征（不写死色值）。
    # 与 sig['red'] 并存：后者是内置红黑稿的固定口径，用于兼容既有签名库。
    if accent_rgb:
        sig['accent'] = sum(1 for s in shapes
                            if _hex_rgb(s['f']) and _near(_hex_rgb(s['f']), accent_rgb))
    sig['nshape'] = len(shapes)
    # 字号谱
    allsz = Counter()
    for s in shapes:
        for z in s['sz']:
            allsz[z] += 1
    sig['sizes'] = sorted(allsz)
    return sig


def collect(reference=REFERENCE):
    prs = Presentation(reference)
    out = []
    for pn, slide in enumerate(prs.slides, 1):
        shapes = []
        for sh in slide.shapes:
            info = shape_info(sh)
            if info:
                shapes.append(info)
        out.append((pn, shapes))
    return out


def build():
    idx = {}
    if IDX_PATH and os.path.exists(IDX_PATH):
        for line in open(IDX_PATH, encoding='utf-8'):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                idx[r['page']] = r.get('category', '')
            except Exception:
                pass
    else:
        print('（未找到参考页文本索引 %s：本次签名的 category 字段将为空，'
              '不影响骨架查重）' % (IDX_PATH or '（本技能不内置该文件）'))
    rows = []
    acc = probe_accent(REF_PATH)
    for pn, shapes in collect(REF_PATH):
        sig = signature(shapes, acc)
        # 连接件与卡片的尺寸样本 —— 取件时可直接复用
        conn = [s for s in shapes if s['g'] in CONNECTOR_GEOMS]
        card = [s for s in shapes if s['g'] in CARD_GEOMS]
        rows.append({
            'page': pn,
            'category': idx.get(pn, ''),
            'sig': sig,
            'conn_samples': [{'g': s['g'], 'W': s['W'], 'H': s['H'], 'f': s['f']}
                             for s in conn[:6]],
            'card_samples': [{'g': s['g'], 'W': s['W'], 'H': s['H'],
                              'f': s['f'], 'ln': s['ln'], 'adj': s['adj']}
                             for s in card[:6]],
        })
    # 写到 **SIG_PATH**（运行期可被 --signature 覆盖），不是常量 SIGNATURE。
    # 写常量的话，传了 --signature 也只是改了读路径，生成物仍落在默认位置。
    if not SIG_PATH:
        print('!! 本技能不内置签名库：请用 --signature <输出路径.jsonl> 指定')
        sys.exit(2)
    with open(SIG_PATH, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    kb = os.path.getsize(SIG_PATH) / 1024.0
    print('已生成: %s (%d 页, %.0f KB)' % (SIG_PATH, len(rows), kb))
    return rows


def load():
    if not SIG_PATH or not os.path.exists(SIG_PATH):
        print('签名索引不可用：%s' % (SIG_PATH or '（本技能不内置签名库）'))
        print('   生成：python scan_parts.py --build --reference <参考稿.pptx>')
        print('   或指定：python scan_parts.py --find ... --signature <既有索引.jsonl>')
        sys.exit(2)
    return [json.loads(l) for l in open(SIG_PATH, encoding='utf-8') if l.strip()]


# ================================================================ 骨架指纹
# 用途：交付前自检「同一套方案的各页骨架是否撞车」。
#
# 严格区分两层：
#   零件层（颜色、圆角、描边、字号、填充）—— **一律不参与判定**。
#     同一套方案里多页共用红头卡/浅红底条是正常的，不该被判成撞型。
#   骨架层（分几栏几行、块的排列、连接件拓扑）—— 判定的唯一依据。
#
# 因此指纹只由「块的行分布 + 行内横向位置 + 连接件数量」构成，
# 与用什么颜色、什么形状、什么字号无关。

def _is_block(s):
    """是否为「块」：有视觉面积的对象。纯文本载体（无填充文本框）不算。"""
    if s['g'] in CONNECTOR_GEOMS:
        return False
    if not s['tx']:
        return True
    # 文本框：只有带填充或描边的才算块（参考稿里卡片常做成带底色的文本框）
    return s['f'] not in ('none', 'noFill', '-') or s['ln'] != 'none'


def skeleton_fingerprint(shapes, page_w=13.333):
    """由几何推出骨架指纹（纯客观，不含零件信息）。

    返回 dict：
      nrows      横向带（行）数
      row_counts 每行的块数
      row_xs     每行内各块的 left 位置（英寸）
      nconn      连接件数量
      conn_kinds 连接件几何类型计数
    """
    blocks = [s for s in shapes if _is_block(s)]
    conns = [s for s in shapes if s['g'] in CONNECTOR_GEOMS and not s['tx']]

    # 按 top 聚成横向带（同一行的块 top 相同或相差极小）
    rows = []
    for s in sorted(blocks, key=lambda x: (x['T'], x['L'])):
        placed = False
        for r in rows:
            if abs(r['T'] - s['T']) <= 0.30:
                r['items'].append(s)
                placed = True
                break
        if not placed:
            rows.append({'T': s['T'], 'items': [s]})
    rows.sort(key=lambda r: r['T'])

    row_counts, row_xs = [], []
    for r in rows:
        xs = sorted(i['L'] for i in r['items'])
        row_counts.append(len(xs))
        row_xs.append([round(x, 2) for x in xs])

    kinds = Counter(c['g'] for c in conns)
    return {
        'nrows': len(rows),
        'row_counts': row_counts,
        'row_xs': row_xs,
        'nconn': len(conns),
        'conn_kinds': dict(kinds),
    }


def skeleton_distance(a, b):
    """两页骨架距离。0 = 同一骨架；越大差异越大。

    只比骨架层。零件层（配色/圆角/字号）完全不参与。
    """
    d = 0.0
    if a['nrows'] != b['nrows']:
        d += 1.0 + 0.3 * abs(a['nrows'] - b['nrows'])
    if a['row_counts'] != b['row_counts']:
        d += 1.0
        # 行数相同但每行块数不同，按错配比例追加
        n = min(len(a['row_counts']), len(b['row_counts']))
        if n:
            mism = sum(1 for i in range(n) if a['row_counts'][i] != b['row_counts'][i])
            d += mism / float(n)
    # 行内横向位置（归一化到页面宽度比例），容忍 0.6" 抖动
    n = min(len(a['row_xs']), len(b['row_xs']))
    if n:
        worst = 0.0
        for i in range(n):
            xa, xb = a['row_xs'][i], b['row_xs'][i]
            if len(xa) != len(xb):
                continue
            if not xa:
                continue
            # 按各自页宽归一化。写死 13.333 会让 4:3 稿（10"）的距离被放大
            # 1.33 倍，骨架查重对非 16:9 参考稿/产出件失准。
            wa = a.get('pw', 13.333) or 13.333
            wb = b.get('pw', 13.333) or 13.333
            for pa, pb in zip(xa, xb):
                worst = max(worst, abs(pa / wa - pb / wb))
        d += worst * 2.0
    if abs(a['nconn'] - b['nconn']) > 1:
        d += 0.3 * abs(a['nconn'] - b['nconn'])
    return d


def fingerprint_pptx(path):
    """取 pptx 第 1 页的骨架指纹。"""
    prs = Presentation(path)
    slide = prs.slides[0]
    shapes = []
    for sh in slide.shapes:
        info = shape_info(sh)
        if info:
            shapes.append(info)
    try:
        pw = prs.slide_width / EMU
    except Exception:
        pw = 13.333
    return skeleton_fingerprint(shapes, pw)


def check_deck(paths, threshold=0.85):
    """一组 pptx 两两比骨架，返回撞型对列表。

    threshold 越小越敏感。返回 [(名A, 名B, 距离), ...]，距离 < threshold 即判撞型。
    """
    fps = []
    for p in paths:
        try:
            fps.append((os.path.basename(p), fingerprint_pptx(p)))
        except Exception as e:
            print('  跳过 %s: %s' % (os.path.basename(p), e))
    hits = []
    for i in range(len(fps)):
        for j in range(i + 1, len(fps)):
            d = skeleton_distance(fps[i][1], fps[j][1])
            if d < threshold:
                hits.append((fps[i][0], fps[j][0], d))
    return hits, fps


def find(rows, mode, minimum, geom=None):
    hits = []
    for r in rows:
        sig = r['sig']
        if mode == 'arrows':
            ok = sig.get('arrows', 0) >= minimum
        elif mode == 'cards':
            ok = sig.get('cards', 0) >= minimum
        elif mode == 'cols':
            ok = sig.get('cols', 0) >= minimum
        elif mode == 'rows':
            ok = sig.get('rows', 0) >= minimum
        elif mode == 'red':
            ok = sig.get('red', 0) >= minimum
        elif mode == 'accent':
            ok = sig.get('accent', 0) >= minimum
        elif mode == 'geom':
            ok = geom in sig
        else:
            ok = False
        if ok:
            hits.append(r)
    return hits


def print_hits(hits, top=40):
    print('命中 %d 页\n' % len(hits))
    for r in hits[:top]:
        s = r['sig']
        tag = ' '.join('%s=%s' % (k, s[k]) for k in
                       ('cols', 'rows', 'arrows', 'cards', 'red', 'accent') if k in s)
        print('  p%03d [%-8s] %s' % (r['page'], r['category'][:8], tag))
    if len(hits) > top:
        print('  ... 另有 %d 页' % (len(hits) - top))


def spec(page_no):
    """导出某页的零件规格表。"""
    prs = Presentation(_require(REF_PATH, '参考稿', '--reference'))
    slide = prs.slides[page_no - 1]
    print('SLIDE %d  shapes=%d\n' % (page_no, len(slide.shapes)))
    print('%-4s %-14s %-7s %-22s %-20s %-16s %s'
          % ('#', 'geom', 'adj', '几何 L/T/W/H (in)', 'fill', 'line', 'text'))
    for i, sh in enumerate(slide.shapes):
        info = shape_info(sh)
        if not info:
            print('%-4d %-14s %s' % (i, sh.name[:14], '(非形状)'))
            continue
        adj = ','.join('%s=%s' % (k, v) for k, v in info['adj'].items()) or '-'
        print('%-4d %-14s %-7s %-22s %-20s %-16s %s'
              % (i, info['g'], adj,
                 '%.2f/%.2f/%.2f/%.2f' % (info['L'], info['T'], info['W'], info['H']),
                 info['f'], info['ln'], info['t'][:30]))


def print_skeleton(paths, threshold=0.85):
    """打印各页骨架指纹 + 两两撞型判定。"""
    hits, fps = check_deck(paths, threshold)
    print('骨架指纹（零件层不参与判定）\n')
    for nm, fp in fps:
        print('  %-46s 行数=%-2d 每行块数=%-18s 连接件=%d'
              % (nm[:46], fp['nrows'], str(fp['row_counts']), fp['nconn']))
    print('\n两两比对（阈值 %.2f，越小越敏感）' % threshold)
    if not hits:
        print('  未发现撞型 —— 各页骨架互不相同')
        return 0
    for a, b, d in hits:
        print('  !! 撞型: %s  <->  %s   距离=%.2f' % (a, b, d))
    return 1


def main():
    ap = argparse.ArgumentParser(description='参考稿几何索引与零件检索')
    ap.add_argument('--build', action='store_true', help='生成/刷新签名索引')
    ap.add_argument('--reference', default='', help='参考稿 pptx 路径（默认解析共享参考库）')
    ap.add_argument('--signature', default='', help='签名索引 jsonl 路径')
    ap.add_argument('--index', default='', help='页面分类索引 jsonl 路径')
    ap.add_argument('--find', choices=['arrows', 'cards', 'cols', 'rows', 'red', 'accent', 'geom'])
    ap.add_argument('--min', dest='minimum', type=int, default=2)
    ap.add_argument('--geom', default='', help='配合 --find geom 使用的 prstGeom 名')
    ap.add_argument('--spec', type=int, default=0, help='导出指定页的零件规格表')
    ap.add_argument('--top', type=int, default=40)
    ap.add_argument('--skeleton', nargs='+', default=[], metavar='PPTX',
                    help='一组 pptx，检查各页骨架是否撞车（只看骨架层）')
    ap.add_argument('--thresh', type=float, default=0.85,
                    help='撞型判定距离阈值，越小越敏感（默认 0.85）')
    args = ap.parse_args()

    global REF_PATH, IDX_PATH, SIG_PATH
    if args.reference:
        REF_PATH = os.path.abspath(args.reference)
    if args.signature:
        SIG_PATH = os.path.abspath(args.signature)
    if args.index:
        IDX_PATH = os.path.abspath(args.index)
    if args.build and not args.signature:
        local_sig = os.path.abspath(os.path.join(SKILL, 'references', 'page-signature.jsonl'))
        if SIG_PATH and os.path.abspath(SIG_PATH) != local_sig:
            print('!! --build 默认不覆盖共享参考库的签名索引；'
                  '重建请显式传 --signature <工作区路径>')
            sys.exit(2)

    if args.build:
        _require(REF_PATH, '参考稿', '--reference')
        build()
        return
    if args.spec:
        spec(args.spec)
        return
    if args.skeleton:
        sys.exit(print_skeleton(args.skeleton, args.thresh))
    if args.find:
        rows = load()
        hits = find(rows, args.find, args.minimum, args.geom)
        print_hits(hits, args.top)
        return
    ap.print_help()


if __name__ == '__main__':
    main()
