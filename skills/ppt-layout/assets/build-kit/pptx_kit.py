# -*- coding: utf-8 -*-
"""
pptx_kit —— ppt-layout 出页工具箱

定位：把「画一页 PPT」拆成两层。
  · 本模块负责**工程确定性**：度量、溢出预检、受控断行、造型、引用整理、单页瘦身、渲染链。
  · **设计判断仍在人/模型手里**：本页要表达什么关系、用什么骨架、借鉴哪些零件。
    工具不替你决定版式，只保证你定下来的版式不溢出、不返工。

用法：
    import sys; sys.path.insert(0, r'<技能目录>/assets/build-kit')
    from pptx_kit import *
"""

import io, os, re, subprocess, sys, zipfile

from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, PP_PLACEHOLDER
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR, MSO_AUTO_SIZE
from lxml import etree

A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def q(tag):
    return '{%s}%s' % (A, tag)


def qp(tag):
    return '{%s}%s' % (P, tag)


# ================================================================ 视觉常量
# 取自参考稿实测（见 references/design-rules.md）
RED     = 'AD0101'   # 主题深红 accent1，主强调色
RED2    = 'C00000'   # 实心卡强调色
TINT    = 'FCF4F4'   # 5% 红 + 白底，浅红底
LINEGRY = 'D9D9D9'   # 浅灰描边
GRAY    = '666666'   # 辅助文字
BLACK   = '000000'
WHITE   = 'FFFFFF'
EA      = '微软雅黑'

# 版式参数。
# ⚠️ 这一组常量**不要删**。它们是内置参考稿的实测值，且历史出页脚本通过
#   `from pptx_kit import *` 直接取用（例：TITLE_W 被一处工程脚本使用、
#   GRAY 被另一处使用）——删掉会让下游脚本直接 NameError。
#   「kit 内部零使用」不等于死代码。
#   换参考稿时**不要用这些常量**，用运行时探测值：
#     页面尺寸 -> prs.slide_width / slide_height
#     版心宽窄 -> PAGE_BOUNDS['l'] / PAGE_BOUNDS['r']（load_layout 原地更新）
#     标题几何 -> LAYOUT['title']        导语几何 -> LAYOUT['lead']
#     字号档位 -> LAYOUT['scale']
LH = 1.15                            # 行高系数（**规划用**的保守估值：fit_check、标题降档判定）
RENDER_LH = 1.20                     # **实测**渲染行高 / (字号×行距)。
                                    # 微软雅黑 @LibreOffice，200~300dpi 像素字带量行距：
                                    #   无显式行距 → 1.200em；spcPct=100% → 1.200em；
                                    #   spcPct=115% → 1.189em；spcPct=150% → 1.200em。
                                    # 结论：**真实行高 = 字号 × 行距 × 1.20**（无行距按行距 1.0 算）。
DEFAULT_TITLE_SIZES = (28, 20)       # 标题两段字号（**仅在探测不到任何字号时**兜底）

PAGE_W, PAGE_H = 13.333, 7.5         # 内置参考稿页面尺寸（英寸，16:9）
TITLE_TOP, TITLE_H = 0.353, 0.456    # 内置参考稿标题占位几何
TITLE_W = 12.166                     # 内置参考稿标题带宽度
LEAD_TOP, LEAD_H = 1.02, 0.78        # 内置参考稿导语区默认位置
GRAY = '666666'                      # 辅助文字色

# 参考库默认快照的**内容区左右边界兜底值**（实测 0.561 / 12.774）。
# 这不是"版式预设"；换一份参考库必须用运行时探测值 PAGE_BOUNDS。
#
# 保留这两个名字还有一个硬理由：历史出页脚本通过 `from pptx_kit import *`
# 直接取用，删除会导致下游 NameError。
# ⚠️ 改动本文件任何**被下游 import * 消费的名字**前，先 grep 下游脚本确认。
PG_L, PG_R = 0.56, 12.78

# 运行时探测到的内容区左右边界。load_layout() 会原地更新它——
# 用可变容器而不是裸常量，是因为 `from pptx_kit import *` 拿到的是**值拷贝**，
# 模块级重新绑定对调用方无效（与 PALETTE 同一个坑）。
PAGE_BOUNDS = dict(l=PG_L, r=PG_R)

# 度量字体：随参考稿正文字体走。用雅黑度量宋体/等线排版的稿，
# 英文与数字宽度会偏 10%+，换行点与实际渲染对不上。
METRIC_FONT = dict(name=EA)

# 字体名 -> 字体文件（度量用）。找不到则回落雅黑并告警一次。
_FONT_MAP = {
    '微软雅黑': 'msyh.ttc', 'microsoft yahei': 'msyh.ttc',
    '微软雅黑 light': 'msyhl.ttc',
    '宋体': 'simsun.ttc', '新宋体': 'simsun.ttc', 'simsun': 'simsun.ttc',
    '黑体': 'simhei.ttf', 'simhei': 'simhei.ttf',
    '楷体': 'simkai.ttf', '仿宋': 'simfang.ttf',
    '等线': 'Deng.ttf', '等线 light': 'Dengl.ttf',
    '华文中宋': 'STZhongsong.ttf', '华文细黑': 'STXihei.ttf',
    'Arial': 'arial.ttf', 'Calibri': 'calibri.ttf',
    'Times New Roman': 'times.ttf', 'Cambria': 'cambria.ttc',
    'Segoe UI': 'segoeui.ttf', 'Georgia': 'georgia.ttf',
    'Source Han Sans SC': 'SourceHanSansSC-Regular.otf',
    '思源黑体': 'SourceHanSansSC-Regular.otf',
    'Noto Sans CJK SC': 'NotoSansCJK-Regular.ttc',
    'PingFang SC': 'PingFang.ttc',
    '文泉驿正黑': 'wqy-zenhei.ttc',
}


def _resolve_font_dirs():
    """找出本机**存在**的字体目录（按优先级）。

    不写死 `C:\\Windows\\Fonts`——那在 macOS / Linux 上根本不存在，
    连"雅黑兜底"都无从谈起。这里按优先级逐个探测，**找到就用**：
    环境变量 → Windows 系统目录 → 用户字体目录 → 各平台常见目录。
    """
    cands = []
    env = os.environ.get('PPT_FONT_DIR')
    if env:
        cands.append(env)
    for key in ('WINDIR', 'SystemRoot'):
        w = os.environ.get(key)
        if w:
            cands.append(os.path.join(w, 'Fonts'))
    home = os.path.expanduser('~')
    cands += [
        os.path.join(home, '.fonts'),
        os.path.join(home, '.local', 'share', 'fonts'),
        os.path.join(home, 'Library', 'Fonts'),
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        '/Library/Fonts',
        '/System/Library/Fonts',
    ]
    out = []
    for c in cands:
        if c and os.path.isdir(c) and c not in out:
            out.append(c)
    return out


_FONT_DIRS = _resolve_font_dirs()
# 仅用于报错提示（首选目录）。不写死任何平台路径——探测不到就是探测不到。
_FONT_DIR = _FONT_DIRS[0] if _FONT_DIRS else ''

# 雅黑也没有时，按这份清单在本机找一个能用的中文字体（跨平台兜底）
_CJK_FALLBACKS = [
    'msyh.ttc', 'msyhl.ttc', 'simhei.ttf', 'simsun.ttc', 'Deng.ttf',
    'SourceHanSansSC-Regular.otf', 'NotoSansCJK-Regular.ttc',
    'NotoSansSC-Regular.otf', 'wqy-zenhei.ttc', 'wqy-microhei.ttc',
    'PingFang.ttc', 'STHeiti Medium.ttc',
]


def E(v):
    """英寸 -> EMU"""
    return int(round(v * 914400))


# ================================================================ 字体度量
from PIL import ImageFont

_fcache = {}
_font_warned = set()


def _resolve_font_file(name, bold):
    """字体名 -> 字体文件路径。**在所有探测到的字体目录里找**。
    找不到返回 None（调用方回落雅黑/本机中文字体）。"""
    key = (name or '').strip().lower()
    if not key:
        return None
    fname = _FONT_MAP.get(key) or _FONT_MAP.get(key.replace(' ', ''))
    if not fname:
        return None
    if bold and fname == 'msyh.ttc':
        fname = 'msyhbd.ttc'
    for d in _FONT_DIRS:
        p = os.path.join(d, fname)
        if os.path.exists(p):
            return p
    return None


def _pick_cjk_font():
    """本机可用的中文字体（雅黑优先），用于度量兜底。找不到返回 None。"""
    for d in _FONT_DIRS:
        for fname in _CJK_FALLBACKS:
            p = os.path.join(d, fname)
            if os.path.exists(p):
                return p
    return None


def _font(size_pt, bold, font_name=None):
    """取度量字体实例。font_name 省略时用 METRIC_FONT（随参考稿走）。"""
    name = font_name or METRIC_FONT.get('name')
    key = (round(size_pt * 4), bool(bold), (name or '').lower())
    if key not in _fcache:
        path = _resolve_font_file(name, bold)
        if path is None or not os.path.exists(path):
            if name and name.lower() not in _font_warned:
                _font_warned.add(name.lower())
                print('  [度量] 字体 %r 无对应文件，改用本机中文字体度量（宽度可能偏大）' % name)
            path = _pick_cjk_font()
            if path is None:
                raise FileNotFoundError(
                    '本机找不到可用的中文字体，无法度量文字宽度。\n'
                    '  已探测的字体目录：%s\n'
                    '  装一个中文字体（微软雅黑 / 思源黑体 / Noto CJK 皆可），'
                    '或设环境变量 PPT_FONT_DIR 指向字体目录。'
                    % (', '.join(_FONT_DIRS) or '(无)'))
        _fcache[key] = ImageFont.truetype(path, int(round(size_pt * 96 / 72)))
    return _fcache[key]


def text_width_in(text, size_pt, bold=False, font_name=None):
    """文本宽度（英寸）。用真实字体度量，不用估算。"""
    if not text:
        return 0.0
    return _font(size_pt, bold, font_name).getlength(text) / 96.0


def n_lines(text, size_pt, width_in, bold=False, font_name=None):
    """按可用宽度估算折行数（逐字累计，保守）"""
    if not text:
        return 1
    f = _font(size_pt, bold, font_name)
    limit = width_in * 96
    lines, cur = 1, 0.0
    for ch in text:
        w = f.getlength(ch)
        if cur + w > limit:
            lines += 1
            cur = w
        else:
            cur += w
    return lines


# 中文避头尾：这些字符不能出现在行首
_NO_LINE_START = '，。、；：！？）】》」』%…·'


def wrap_manual(text, size_pt, width_in, bold=False, font_name=None):
    """受控断行：返回行数组，标点不落行首，并避免末行孤字。

    自动换行会在词中间断开（如把四字词断成前三字+末字）。做图示页时用本
    函数把长句预先拆成整段单行（每段放进独立段落），从源头消除断词。
    """
    if not text:
        return []
    f = _font(size_pt, bold, font_name)
    limit = width_in * 96
    lines, cur, cur_w = [], '', 0.0
    for ch in text:
        w = f.getlength(ch)
        if cur_w + w > limit and cur:
            # 当前字符若为禁则标点，回退到上一行末尾之前断行
            if ch in _NO_LINE_START:
                lines.append(cur)
                cur, cur_w = ch, w
            else:
                lines.append(cur)
                cur, cur_w = ch, w
        else:
            cur += ch
            cur_w += w
    if cur:
        lines.append(cur)
    # 末行孤字：把上一行末尾一字挪到末行
    if len(lines) >= 2 and len(lines[-1]) <= 1:
        lines[-2], lines[-1] = lines[-2][:-1], lines[-2][-1] + lines[-1]
    return lines


def fit_check(label, text, size, box_w, box_h, bold=False, ls=1.0, extra=0.0, quiet=False):
    """溢出预检。返回 True=通过。预检不等同目视，但它能在生成阶段挡掉多数溢出。

    行高按 **RENDER_LH（实测 1.20）** 折算，与真实渲染一致——用 1.15 会
    低估 4%，窄框里正好是「末行被切一半」的那一刀。
    """
    ln = n_lines(text, size, box_w, bold)
    need = ln * size * RENDER_LH * ls / 72.0 + extra
    ok = need <= box_h + 0.005
    if not quiet:
        print(('  OK ' if ok else '  !! ') +
              '%s: 行数=%d 需高=%.2f" 框高=%.2f"' % (label, ln, need, box_h))
    return ok


def orphan_check(label, lines, size, width_in, quiet=False):
    """孤字行检测：末行只剩 1 字时报警（中文排版观感硬伤）。"""
    bad = [i for i, ln in enumerate(lines) if len(ln.strip()) <= 1 and i < len(lines) - 1]
    if not quiet:
        print(('  OK ' if not bad else '  !! ') + '%s: 孤字行 %s' % (label, bad or '无'))
    return not bad


# ================================================================ 文本与造型
def _strip_style(el):
    st = el.find(qp('style'))
    if st is not None:
        el.remove(st)


def _no_shadow(sh):
    spPr = sh._element.spPr
    for e in spPr.findall(q('effectLst')):
        spPr.remove(e)
    etree.SubElement(spPr, q('effectLst'))


# ================================================================ 公开的"去样式"与"画线"
def strip_style(shape):
    """去掉形状的**主题样式引用**与**默认阴影**。

    为什么必须是公开名：`from pptx_kit import *` **不会带出下划线开头的
    名字**（`_strip_style` / `_no_shadow` 拿不到），于是出页脚本新建的形状
    带着 PowerPoint 默认的阴影与主题描边——参考稿里根本没有这种效果，
    混排时一眼看出不是同一套语言。公开出来才能被统一调用。
    """
    try:
        _strip_style(shape._element)
    except Exception:
        pass
    try:
        _no_shadow(shape)
    except Exception:
        pass
    return shape


def no_shadow(shape):
    """只去掉阴影（保留主题样式引用）。"""
    try:
        _no_shadow(shape)
    except Exception:
        pass
    return shape


def add_connector(slide, x1, y1, x2, y2, color=None, width_pt=0.75,
                  dash=None, arrow_end=False):
    """画一条**真正的线**（connector），不是实心细条。

    为什么必须用线：参考稿的轴线、分隔线、连接件全部是 line；而"实心细条"
    在构件语汇里属于**窄色条**（外来套路高发区），拿实心块冒充线会被
    `audit.py` 第 8 关判成语汇外构件。线用线，块用块。

    参数：起止点为英寸；`arrow_end=True` 在末端加箭头。
    """
    from pptx.enum.shapes import MSO_CONNECTOR
    cn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,
                                     E(x1), E(y1), E(x2), E(y2))
    try:
        cn.line.color.rgb = RGBColor.from_string(
            (color or pal('line') or 'D9D9D9'))
    except Exception:
        pass
    try:
        cn.line.width = Pt(width_pt)
    except Exception:
        pass
    if dash is not None:
        try:
            cn.line.dash_style = dash
        except Exception:
            pass
    if arrow_end:
        try:
            ln = cn.line._get_or_add_ln()
            tail = etree.SubElement(ln, q('tailEnd'))
            tail.set('type', 'triangle')
            tail.set('w', 'med')
            tail.set('len', 'med')
        except Exception:
            pass
    return cn


def _set_ea(rPr, name):
    for tag in ('ea', 'cs'):
        for e in rPr.findall(q(tag)):
            rPr.remove(e)
    latin = rPr.find(q('latin'))
    idx = list(rPr).index(latin) + 1 if latin is not None else len(rPr)
    for tag in ('ea', 'cs'):
        e = etree.Element(q(tag))
        e.set('typeface', name)
        rPr.insert(idx, e)
        idx += 1


def cn_quotes(t):
    """ASCII 直引号 -> 中文弯引号。PowerPoint 渲染 ASCII 直引号时会带出多余空隙。"""
    out, flag = [], True
    for ch in t:
        if ch == '"':
            out.append('“' if flag else '”')
            flag = not flag
        else:
            out.append(ch)
    return ''.join(out)


def style_run(r, text, size, bold=False, color=BLACK, name=EA):
    r.text = cn_quotes(text)
    f = r.font
    f.size = Pt(size)
    f.bold = bold
    f.color.rgb = RGBColor.from_string(color)
    f.name = name
    rPr = r._r.get_or_add_rPr()
    rPr.set('lang', 'zh-CN')
    rPr.set('altLang', 'en-US')
    rPr.set('dirty', '0')
    _set_ea(rPr, name)


def set_para(p, runs, align=PP_ALIGN.LEFT, line_spacing=None, space_before=0, space_after=0):
    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    p.alignment = align
    if line_spacing:
        p.line_spacing = line_spacing
    if space_before:
        p.space_before = Pt(space_before)
    if space_after:
        p.space_after = Pt(space_after)
    for spec in runs:
        r = p.add_run()
        # 五元组可带字体名（text, size, bold, color, font）——字体同样属于
        # 参考稿的视觉语言，不该被强制成写死的默认字体。
        style_run(r, spec[0], spec[1],
                  spec[2] if len(spec) > 2 else False,
                  spec[3] if len(spec) > 3 else BLACK,
                  spec[4] if len(spec) > 4 else EA)


# a:pPr 子元素的 schema 顺序 —— 插错 PowerPoint 会报「需要修复」
_PPR_ORDER = ['lnSpc', 'spcBef', 'spcAft', 'buClrTx', 'buClr', 'buSzTx', 'buSzPct', 'buSzPts',
              'buFontTx', 'buFont', 'buNone', 'buAutoNum', 'buChar', 'tabLst', 'defRPr', 'extLst']


def _pPr_insert(pPr, el):
    tag = etree.QName(el).localname
    idx = _PPR_ORDER.index(tag)
    for child in list(pPr):
        ctag = etree.QName(child).localname
        if ctag not in _PPR_ORDER or _PPR_ORDER.index(ctag) > idx:
            child.addprevious(el)
            return
    pPr.append(el)


def set_para_multiline(p, lines, size, bold=False, color=BLACK,
                       align=PP_ALIGN.LEFT, ls=1.14, sa=0, cont_marL=137160):
    """受控断行：首行留在原段落，其余行作为**续段段落**紧随其后。

    为什么不用 <a:br/>：LibreOffice 对「项目符号段落内的 br」处理不可靠——
    行较长时会出现整行空白，或续行与首行叠印在同一位置（实测 16 字首行必现）。
    续段段落用 buNone + marL 悬挂对齐，视觉与 br 等价且稳定。

    用途：窄栏（如多列卡片）里长句会被自动换行断在词中间。先把长句预先拆成
    整段单行（每段独立排布），从源头消除断词。

    cont_marL：续行段落的左缩进（EMU）。项目符号段落用默认 137160（0.15"）；
    **无项目符号的纯文本块要传 0**，否则第二行会比第一行右移一截。
    """
    lines = list(lines)
    if not lines:
        return p
    set_para(p, [(lines[0], size, bold, color)], align=align,
             line_spacing=ls, space_after=(sa if len(lines) == 1 else 0))
    prev = p
    for i, ln in enumerate(lines[1:]):
        last = (i == len(lines) - 2)
        prev = _cont_para_after(prev, ln, size, bold, color, align, ls,
                                sa if last else 0, cont_marL)
    return p


def _cont_para_after(p, text, size, bold=False, color=BLACK,
                      align=PP_ALIGN.LEFT, ls=1.14, sa=0, cont_marL=137160):
    """在段落 p 之后插入一个续行段落：无项目符号，悬挂对齐到 p 的文字起始位。"""
    from copy import deepcopy
    from pptx.text.text import _Paragraph

    new_p = deepcopy(p._p)
    p._p.addnext(new_p)
    cp = _Paragraph(new_p, getattr(p, '_parent', None))
    set_para(cp, [(text, size, bold, color)], align=align,
             line_spacing=ls, space_after=sa)
    pPr = cp._p.get_or_add_pPr()
    pPr.set('marL', str(int(cont_marL)))
    pPr.set('indent', '0')
    for tag in ('buChar', 'buAutoNum', 'buNone', 'buClr', 'buSzPct', 'buFont'):
        for e in pPr.findall(q(tag)):
            pPr.remove(e)
    _pPr_insert(pPr, etree.Element(q('buNone')))
    return cp


def bullet_para(p, text, size, color=None, ls=1.14, sa=4, bullet_color=None,
                bullet=None, bullet_font=None, lines=None):
    """真实项目符号（默认取参考稿的符号规格）+ 悬挂缩进。

    传 lines 时：首行带项目符号，其余行作为续段段落（无符号、悬挂对齐）排在其后。
    不使用 <a:br/>——见 set_para_multiline 的说明。

    **默认全部跟随参考稿**：符号字符 / 字体 / 大小 / 颜色来自
    `probe_bullet_style()` 探测到的 `BULLET_STYLE`，正文色来自主题 `pal('text')`。
    写成 `bullet_color=RED` 这类**函数定义期默认值是死代码**——调色板是运行时
    才装载的，默认值在定义时就已固化，换参考稿后仍是旧参考稿的颜色。
    """
    if color is None:
        color = pal('text') or BLACK
    if bullet_color is None:
        bullet_color = BULLET_STYLE.get('color') or pal('accent') or RED
    if bullet is None:
        bullet = BULLET_STYLE.get('char') or '•'
    if bullet_font is None:
        bullet_font = BULLET_STYLE.get('font') or 'Arial'
    sz_pct = int(round(BULLET_STYLE.get('size_pct', 0.7) * 100000))
    items = list(lines) if lines is not None else [text]
    if not items:
        return p
    set_para(p, [(items[0], size, False, color)], line_spacing=ls,
             space_after=(sa if len(items) == 1 else 0))
    pPr = p._p.get_or_add_pPr()
    pPr.set('marL', '137160')
    pPr.set('indent', '-137160')
    for tag in ('buNone', 'buAutoNum', 'buChar', 'buClr', 'buSzPct', 'buFont'):
        for e in pPr.findall(q(tag)):
            pPr.remove(e)
    buClr = etree.Element(q('buClr'))
    c = etree.SubElement(buClr, q('srgbClr'))
    c.set('val', bullet_color)
    buSz = etree.Element(q('buSzPct'))
    buSz.set('val', str(sz_pct))
    buFont = etree.Element(q('buFont'))
    buFont.set('typeface', bullet_font)
    buChar = etree.Element(q('buChar'))
    buChar.set('char', bullet)
    for el in (buClr, buSz, buFont, buChar):
        _pPr_insert(pPr, el)

    prev = p
    for i, ln in enumerate(items[1:]):
        last = (i == len(items) - 2)
        prev = _cont_para_after(prev, ln, size, False, color,
                                PP_ALIGN.LEFT, ls, sa if last else 0)
    return p



def add_round_rect(slide, x, y, w, h, fill=None, line=None, line_w=0.75, adj=3846):
    """圆角卡。adj 3846=卡片 / 11191=细条带（参考稿实测）。"""
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, E(x), E(y), E(w), E(h))
    try:
        sh.adjustments[0] = adj / 100000.0
    except Exception:
        pass
    if fill:
        sh.fill.solid()
        sh.fill.fore_color.rgb = RGBColor.from_string(fill)
    else:
        sh.fill.background()
    if line:
        sh.line.color.rgb = RGBColor.from_string(line)
        sh.line.width = Pt(line_w)
    else:
        sh.line.fill.background()
    _strip_style(sh._element)
    _no_shadow(sh)
    tf = sh.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left = tf.margin_right = E(0.1)
    tf.margin_top = tf.margin_bottom = E(0.03)
    p = tf.paragraphs[0]
    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    return sh


def add_textbox(slide, x, y, w, h, paras, anchor=MSO_ANCHOR.TOP,
                margins=(0, 0, 0, 0), word_wrap=True):
    """paras: [{'runs':[(text,size,bold,color),...], 'align':.., 'ls':.., 'sa':..}, ...]

    窄栏受控断行：段落里给 'lines': [行1, 行2, ...]（每行独立成段），
    可绕开自动换行把词拆断的问题。字号/字重/颜色取该段 'runs' 的第一项。
    纯文本块（无项目符号）用 cont_marL=0 让续行与首行左对齐。
    """
    tb = slide.shapes.add_textbox(E(x), E(y), E(w), E(h))
    tf = tb.text_frame
    tf.word_wrap = word_wrap
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left, tf.margin_top, tf.margin_right, tf.margin_bottom = [E(v) for v in margins]
    tf.vertical_anchor = anchor
    for i, spec in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        if spec.get('lines'):
            r0 = (spec.get('runs') or [('', 10.5, False, BLACK)])[0]
            set_para_multiline(p, spec['lines'], r0[1], r0[2], r0[3],
                               align=spec.get('align', PP_ALIGN.LEFT),
                               ls=spec.get('ls') or 1.14,
                               sa=spec.get('sa', 0),
                               cont_marL=spec.get('cont_marL', 0))
        else:
            set_para(p, spec['runs'], spec.get('align', PP_ALIGN.LEFT),
                     spec.get('ls'), spec.get('sb', 0), spec.get('sa', 0))
    return tb


def add_arrow(slide, x, y, w, h, fill=None, direction='right'):
    """箭头连接件。方向：right / left / up / down。

    箭头是关系表达件，不是装饰；只有确实存在先后或流向时才放。
    颜色默认取当前参考稿的强调色（见 PALETTE），不写死。
    """
    shapes = {'right': MSO_SHAPE.RIGHT_ARROW, 'left': MSO_SHAPE.LEFT_ARROW,
              'up': MSO_SHAPE.UP_ARROW, 'down': MSO_SHAPE.DOWN_ARROW}
    sh = slide.shapes.add_shape(shapes[direction], E(x), E(y), E(w), E(h))
    sh.fill.solid()
    sh.fill.fore_color.rgb = RGBColor.from_string(fill or pal('accent'))
    sh.line.fill.background()
    _strip_style(sh._element)
    _no_shadow(sh)
    sh.text_frame.word_wrap = False
    return sh


def add_right_arrow(slide, x, y, w, h, fill=None):
    """右箭头（连接件）。参考稿实测常用比例 0.26in x 0.17in。"""
    return add_arrow(slide, x, y, w, h, fill, 'right')


def add_strip(slide, x, y, w, h, text, size=12.5, fill=None, color=None, adj=11191):
    """浅色底分区条带，用于「分区导语」。底色/字色默认取当前参考稿调色板。"""
    r = add_round_rect(slide, x, y, w, h, fill=fill or pal('tint'), line=None, adj=adj)
    tf = r.text_frame
    tf.margin_left = E(0.18)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    set_para(tf.paragraphs[0], [(text, size, True, color or pal('accent'))])
    return r


def add_chip(slide, x, y, w, h, text, size=12.5, fill=None, color=None,
             line=None, adj=11191, bold=True):
    """小标签块（节点/产出条/路径标签通用）。底色/字色默认取当前参考稿调色板。"""
    r = add_round_rect(slide, x, y, w, h, fill=fill or pal('tint'), line=line, adj=adj)
    tf = r.text_frame
    tf.margin_left = tf.margin_right = E(0.08)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    set_para(tf.paragraphs[0], [(text, size, bold, color or pal('accent'))], align=PP_ALIGN.CENTER)
    return r


# ================================================================ 参考稿继承与瘦身
def pick_reference_page(prs, prefer=None):
    """自动挑一个「典型正文页」作为参考页，返回 1-based 页号。

    为什么必须有这一步：**真实模板的第一页永远是封面**（超大居中标题、
    通栏、无导语框）。拿第 1 页当参考，会把封面规格当成全稿规格——
    探测出的「导语框」其实是封面主标题（实测某深蓝学术模板：88pt，
    而正文是 11pt），据此建页必然崩版。

    判据（纯结构，不含任何版式预设）：
      1. 按 slide_layout 分组，取**页数最多**的那个版式——正文版式通常占多数，
         封面／目录／章节页各只出现一两次；
      2. 在该版式的页里取**形状数中位数**的一页——避开空页与极端复杂页；
      3. 若该版式只有一页，则退回全稿形状数中位数的一页。

    prefer 指定时直接用该页号（1-based）。
    """
    slides = list(prs.slides)
    if not slides:
        return 1
    if prefer:
        return max(1, min(int(prefer), len(slides)))

    by_layout = {}
    for i, sl in enumerate(slides, 1):
        key = sl.slide_layout.name if sl.slide_layout is not None else ''
        by_layout.setdefault(key, []).append(i)

    main = max(by_layout.values(), key=len)
    if len(main) == 1:
        main = sorted(range(1, len(slides) + 1),
                      key=lambda i: len(slides[i - 1].shapes))
        mid = len(main) // 2
        return main[mid]
    ordered = sorted(main, key=lambda i: len(slides[i - 1].shapes))
    return ordered[len(ordered) // 2]


# 模块级页面骨架规格：参考页的标题/导语/内容区几何与字号档位。
# **单一装载入口**：open_reference() 会自动装载，出页脚本统一从这里取，
# 不再各自手写坐标（那正是同一份 deck 里导语位置漂移的根因）。
LAYOUT = {}


def load_layout(prs, slide):
    """把参考页的骨架规格装载到模块级 LAYOUT，返回它。

    为什么必须有这个入口：此前每张出页脚本各自手写标题/导语的 top/height，
    参数彼此不一致——同一份 deck 里有的页传了 top、有的页漏传，导语因此
    漂移 0.147"，第二行被下方条带裁掉。根因不是某一张页写错，而是
    **没有单一权威源**：每张页各自决定几何。

    装载后出页脚本统一读：
        LAYOUT['title']['top'] / ['height'] / ['size_lead']
        LAYOUT['lead']['top']  / ['height'] / ['size']
        LAYOUT['body']['top']  / ['bottom']
        LAYOUT['scale']['title'|'body'|'label']
    这些值全部来自参考页实测，换任何一份参考 ppt 都跟随其风格。
    """
    lay = {}
    try:
        ts = probe_title_spec(slide)
    except Exception:
        ts = None
    if ts:
        lay['title'] = {
            'left': ts['left'], 'top': ts['top'],
            'width': ts['width'], 'height': ts['height'],
            'size_lead': ts['size_lead'], 'size_sub': ts['size_sub'],
            'has_sub': ts['has_sub'], 'font': ts['font'],
            'color_lead': ts['color_lead'], 'color_sub': ts['color_sub'],
        }
    try:
        ls = probe_lead_spec(slide)
    except Exception:
        ls = None
    if ls:
        lay['lead'] = dict(ls)
    # 内容区上下缘：标题/导语之后，参考页上实际内容的边界
    tops, bots = [], []
    for sh in slide.shapes:
        try:
            if sh.top is None or sh.height is None:
                continue
            t = sh.top / 914400.0
            h = sh.height / 914400.0
        except Exception:
            continue
        if h < 0.02:          # 线、装饰
            continue
        if t < 1.2:           # 标题区
            continue
        tops.append(t)
        bots.append(t + h)
    if tops:
        lay['body'] = {'top': min(tops), 'bottom': max(bots)}
    # 内容区左右缘（版心）。两侧口径**故意不同**，各有理由：
    #   左缘 = 形状 left 的**众数**（对齐线）。不能用最小值——参考稿常有
    #          贴左边缘的装饰或页脚块（实测 left 可到 0.002"），会把版心拉没。
    #   右缘 = 排除满幅装饰条后的**最大** right（内容最外缘）。不能用众数——
    #          某个高频版式的窄内容块会把众数带偏（实测众数是 10.02"）。
    # 注意：此判定需要**多页样本**才有意义；单页参考稿上左缘众数不稳，
    # 此时应显式传参，不要依赖 PAGE_BOUNDS。
    try:
        from collections import Counter
        pw = prs.slide_width / 914400.0
        lcount, rs = Counter(), []
        for sh in slide.shapes:
            try:
                if sh.left is None or sh.width is None:
                    continue
                l = sh.left / 914400.0
                w = sh.width / 914400.0
            except Exception:
                continue
            if w >= pw * 0.95:      # 满幅装饰条，不参与版心判定
                continue
            if w <= 0:              # 零宽（竖线）
                continue
            lcount[round(l, 2)] += 1
            rs.append(l + w)
        if lcount:
            PAGE_BOUNDS['l'] = lcount.most_common(1)[0][0]
            if rs:
                PAGE_BOUNDS['r'] = max(rs)
            lay['body']['left'] = PAGE_BOUNDS['l']
            lay['body']['right'] = PAGE_BOUNDS['r']
    except Exception:
        pass
    try:
        sc = probe_type_scale(slide)
    except Exception:
        sc = None
    if sc:
        lay['scale'] = sc
    LAYOUT.clear()
    LAYOUT.update(lay)
    return LAYOUT


def open_reference(src, keep=1):
    """打开参考稿并收敛到参考页（1-based），清掉正文与孤立关系。

    参考稿通常几百页，逐页手工裁剪是主要耗时点之一。返回 (prs, slide)。
    保留：母版、版式、标题占位、导语占位。

    默认 keep=1：复刻语义明确、行为稳定。参考稿若以封面开篇（真实模板常见），
    应显式传 keep=N 指定要复刻的正文页；也可传 keep=None 让
    pick_reference_page() 自动挑典型正文页。

    打开时会自动装载该参考稿的调色板、字体与项目符号规格到模块级
    `PALETTE` / `BULLET_STYLE`，之后所有造型原语（add_round_rect /
    add_arrow / add_strip …）自动使用参考稿自己的颜色与符号——
    **不预设版式**，换任何风格不同的参考 ppt 都跟随其风格。
    """
    prs = Presentation(src)
    load_palette(prs)
    if keep is None:
        keep = pick_reference_page(prs)
    sldIdLst = prs.slides._sldIdLst
    ids = list(sldIdLst)
    for i, sld in enumerate(ids):
        if i == keep - 1:
            continue
        rId = sld.get('{%s}id' % R)
        prs.part.drop_rel(rId)
        sldIdLst.remove(sld)
    slide = prs.slides[0]
    # 装载页面骨架规格（标题/导语/内容区几何 + 字号档位）到模块级 LAYOUT。
    # 出页脚本统一读 LAYOUT，不再各写各的坐标——这是导语位置漂移的根治点。
    try:
        load_layout(prs, slide)
    except Exception as e:
        print('  [布局] 骨架规格装载失败（%s）——出页时需显式传几何参数' % e)
    _drop_thinkcell(slide)
    return prs, slide


def _drop_thinkcell(slide):
    for sh in list(slide.shapes):
        if 'think-cell' in sh.name:
            sh._element.getparent().remove(sh._element)


# 导语框名称标记（仅用于按名识别，不含任何版式预设）
LEAD_BOX_NAME = '引导语框'

# 标题框名称标记（用于参考稿标题**不是占位符**时，新建页自建标题框）
TITLE_BOX_NAME = '标题框'


def probe_theme(prs):
    """探测参考稿的主题色与字体，返回可直接用作造型的调色板。

    目的：换一份风格完全不同的参考 ppt 时，主强调色/实心卡色/浅底色/
    描边色/正文字体自动跟随其主题，而不是永远用红黑微软雅黑。

    探测顺序：
      1. 主题 accent1/accent2（最权威，代表母版设计色）
      2. 主题的 dk1/lt1（正文黑/白）
      3. 参考页上实际用得最多的彩色与灰色（补主题未定义的）
    返回 dict：accent / accent2 / tint / line / text / font / font_bold
    """
    pal = dict(accent=RED, accent2=RED2, tint=TINT, line=LINEGRY,
               text=BLACK, font=EA, font_bold=EA)
    got_theme = False      # 是否真的从参考稿读到了主题色
    got_font = False       # 是否真的读到了正文字体

    # --- 主题色 ---
    try:
        theme = prs.slide_masters[0].part.part_related_by(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme')
        root = etree.fromstring(theme.blob)
        ns = {'a': A}
        scheme = root.find('.//a:clrScheme', ns)
        if scheme is not None:
            def get(tag):
                el = scheme.find('a:%s' % tag, ns)
                if el is None:
                    return None
                srgb = el.find('a:srgbClr', ns)
                if srgb is not None:
                    return srgb.get('val')
                sysc = el.find('a:sysClr', ns)
                if sysc is not None:
                    return sysc.get('lastClr')
                return None
            a1, a2 = get('accent1'), get('accent2')
            dk1, lt1 = get('dk1'), get('lt1')
            if a1:
                pal['accent'] = a1
                got_theme = True
            if a2:
                pal['accent2'] = a2
            if dk1:
                pal['text'] = dk1
            # 浅底：强调色淡化（5%）
            if a1:
                pal['tint'] = _tint_of(a1, 0.05)
        # 主题字体：只作兜底。中文正文实际用什么字体，以参考页**真实使用**为准
        # （主题声明的 ea 常常是「等线」这类未真正使用的字体）。
    except Exception as e:
        print('  [调色板] 主题色探测失败（%s）——产出页颜色不会跟随参考稿' % e)

    # --- 正文字体：取参考页上真实使用最多的字体（粗体单独探测） ---
    try:
        from collections import Counter
        fc, fcb = Counter(), Counter()
        for slide in prs.slides:
            for sh in slide.shapes:
                if not sh.has_text_frame:
                    continue
                for p in sh.text_frame.paragraphs:
                    for r in p.runs:
                        if r.text.strip() and r.font.name:
                            (fcb if r.font.bold else fc)[r.font.name] += 1
            if sum(fc.values()) + sum(fcb.values()) > 400:
                break
        if fc:
            pal['font'] = fc.most_common(1)[0][0]
            got_font = True
        if fcb:
            pal['font_bold'] = fcb.most_common(1)[0][0]
    except Exception:
        pass

    # --- 描边灰：参考页上最常见的浅灰描边 ---
    # 注意：必须排除彩色描边（强调色描边很常见，会把「描边灰」带偏）。
    try:
        from collections import Counter
        c = Counter()
        accent = pal['accent'].upper()
        for slide in prs.slides:
            for sh in slide.shapes:
                try:
                    xml = etree.tostring(sh._element).decode('utf-8')
                except Exception:
                    continue
                for m in re.finditer(r'<a:ln[^>]*>.*?srgbClr val="([0-9A-Fa-f]{6})"', xml):
                    v = m.group(1).upper()
                    if v in ('FFFFFF', '000000') or v == accent:
                        continue
                    # 只接受中性灰（R≈G≈B）
                    r, g, b = int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
                    if max(r, g, b) - min(r, g, b) <= 12:
                        c[v] += 1
            if sum(c.values()) > 60:
                break
        if c:
            pal['line'] = c.most_common(1)[0][0]
    except Exception:
        pass
    if not got_theme and not got_font:
        print('  [调色板] 未从参考稿探测到主题色与正文字体 —— '
              '产出页将沿用内置红黑雅黑（这是兜底，不是跟随参考稿）')
    return pal


# 模块级当前调色板：open_reference/open_deck 时从参考稿自动装载。
# 造型原语的默认色从这里取，因此换参考稿会自动跟随其风格。
PALETTE = dict(accent=RED, accent2=RED2, tint=TINT, line=LINEGRY,
               text=BLACK, font=EA, font_bold=EA)

# 模块级项目符号规格（字符/字体/大小/颜色），同样从参考稿探测。
# 换一份参考稿，符号形状会跟着变（例如参考稿用 Wingdings 方块，就用方块）。
BULLET_STYLE = dict(char='•', font='Arial', size_pct=70, color=None)


def probe_bullet_style(prs):
    """探测参考稿的项目符号规格：字符 / 字体 / 大小比例 / 颜色。

    项目符号是**段落级样式**的一部分，不同参考稿差异极大（圆点/方块/短横，
    实心/空心，衬线/无衬线）。写死符号等于给参考稿加了版式预设。
    探测顺序：参考页上第一个带 buChar 的段落优先，其次 buAutoNum。
    """
    from collections import Counter
    chars, fonts, pcts, clrs = Counter(), Counter(), Counter(), Counter()
    for slide in prs.slides:
        for sh in slide.shapes:
            if not sh.has_text_frame:
                continue
            for p in sh.text_frame.paragraphs:
                pPr = p._p.find(q('pPr'))
                if pPr is None:
                    continue
                bu = pPr.find(q('buChar'))
                if bu is not None and bu.get('char'):
                    chars[bu.get('char')] += 1
                bf = pPr.find(q('buFont'))
                if bf is not None and bf.get('typeface'):
                    fonts[bf.get('typeface')] += 1
                bs = pPr.find(q('buSzPct'))
                if bs is not None and bs.get('val'):
                    pcts[bs.get('val')] += 1
                bc = pPr.find(q('buClr'))
                if bc is not None:
                    sc = bc.find(q('srgbClr'))
                    if sc is not None and sc.get('val'):
                        clrs[sc.get('val')] += 1
    st = {}
    if chars:
        st['char'] = chars.most_common(1)[0][0]
    if fonts:
        st['font'] = fonts.most_common(1)[0][0]
    if pcts:
        st['size_pct'] = int(pcts.most_common(1)[0][0]) / 100000.0
    if clrs:
        st['color'] = clrs.most_common(1)[0][0]
    return st


def load_palette(prs):
    """把参考稿的调色板装载到模块级 PALETTE，返回它。

    之后 `add_arrow()` / `add_strip()` / `add_chip()` 等造型原语会用
    参考稿自己的强调色与浅底色，而不是写死的红黑。

    **原地更新**而非重新绑定：`from pptx_kit import *` 会把 PALETTE 这个
    dict 的**引用**复制到调用方命名空间。若这里 `PALETTE = new` 重新绑定，
    调用方手里的旧 dict 会永远停在兜底值（红黑微软雅黑），于是出现
    「探测明明成功，print(PALETTE) 却是旧值」的假象。故必须 clear+update。
    """
    new = probe_theme(prs)
    PALETTE.clear()
    PALETTE.update(new)
    # 度量字体跟随参考稿正文字体：否则用雅黑度量宋体/等线排版的稿，
    # 英文与数字宽度会偏 10%+，换行点与实际渲染对不上。
    METRIC_FONT['name'] = new.get('font') or EA
    bs = probe_bullet_style(prs)
    if bs:
        BULLET_STYLE.clear()
        BULLET_STYLE.update(bs)
    return PALETTE


def pal(key):
    """取当前调色板某项（accent / accent2 / tint / line / text / font）。"""
    return PALETTE.get(key)


def _tint_of(hexcolor, ratio):
    """把强调色按 ratio 稀释到白底上，得到浅色底。

    ratio=0.05 → 5% 强调色 + 95% 白，即 AD0101 → FCF4F4。
    公式：result = 255 - (255 - c) * ratio
    （不是 c + (255-c)*ratio —— 那是把颜色变浅 5%，方向相反）
    """
    try:
        r = int(hexcolor[0:2], 16); g = int(hexcolor[2:4], 16); b = int(hexcolor[4:6], 16)
    except Exception:
        return TINT
    r = int(round(255 - (255 - r) * ratio))
    g = int(round(255 - (255 - g) * ratio))
    b = int(round(255 - (255 - b) * ratio))
    return '%02X%02X%02X' % (r, g, b)


def probe_para_style(paragraph):
    """探测段落级样式：缩进、行距、项目符号。

    框的视觉不只由 run 决定——悬挂缩进、150% 行距、Wingdings 方块项目符号
    都写在段落属性（a:pPr）里。只搬 run 会把这些整体丢掉，新建页与继承页
    一眼就不一样。这里把它们客观读出来，供 apply_para_style() 原样写回。
    """
    st = {'marL': None, 'indent': None, 'line_spacing': None,
          'bullet': None, 'bu_color': None, 'bu_font': None, 'bu_none': False,
          'pPr_xml': None}
    pPr = paragraph._p.find(q('pPr'))
    if pPr is None:
        return st
    # 整块 pPr 的原文留档：buChar 的值是**私用区字符**（U+F076，Wingdings 方块），
    # 不是十进制数字串；buFont 还带 panose/charset。重建式转写容易改坏语义，
    # 因此以原文为准（apply_para_style 优先用它）。
    st['pPr_xml'] = etree.tostring(pPr, encoding='unicode')
    if pPr.get('marL'):
        st['marL'] = int(pPr.get('marL'))
    if pPr.get('indent'):
        st['indent'] = int(pPr.get('indent'))
    ln = pPr.find(q('lnSpc'))
    if ln is not None:
        pct = ln.find(q('spcPct'))
        if pct is not None and pct.get('val'):
            st['line_spacing'] = int(pct.get('val')) / 100000.0
    if pPr.find(q('buNone')) is not None:
        st['bu_none'] = True
    bu = pPr.find(q('buChar'))
    if bu is not None:
        st['bullet'] = bu.get('char') or ''
    bf = pPr.find(q('buFont'))
    if bf is not None:
        st['bu_font'] = bf.get('typeface')
    bc = pPr.find(q('buClr'))
    if bc is not None:
        sc = bc.find(q('srgbClr'))
        if sc is not None and sc.get('val'):
            st['bu_color'] = sc.get('val')
    return st


def apply_para_style(paragraph, st):
    """把 probe_para_style() 探测到的段落样式原样写回一个段落。

    优先整块复制 a:pPr 原文——项目符号字符（私用区 U+F076）、buFont 的
    panose/charset、lnSpc 全部一比一保留，且天然满足
    CT_TextParagraphProperties 的子元素顺序（顺序错了 PowerPoint 会报修复）。
    没有原文时，才按结构化字段重建。
    """
    if not st:
        return
    p = paragraph._p
    raw = st.get('pPr_xml')
    if raw:
        new = etree.fromstring(raw.encode('utf-8'))
        old = p.find(q('pPr'))
        if old is not None:
            p.replace(old, new)
        else:
            p.insert(0, new)
        return
    parts = []
    if st.get('line_spacing'):
        parts.append('<a:lnSpc><a:spcPct val="%d"/></a:lnSpc>'
                     % int(round(st['line_spacing'] * 100000)))
    if st.get('bu_color'):
        parts.append('<a:buClr><a:srgbClr val="%s"/></a:buClr>' % st['bu_color'])
    if st.get('bu_font'):
        parts.append('<a:buFont typeface="%s"/>' % st['bu_font'])
    if st.get('bullet'):
        parts.append('<a:buChar char="%s"/>' % st['bullet'])
    elif st.get('bu_none'):
        parts.append('<a:buNone/>')
    if not parts:
        return
    attrs = ''
    if st.get('marL') is not None:
        attrs += ' marL="%d"' % int(st['marL'])
    if st.get('indent') is not None:
        attrs += ' indent="%d"' % int(st['indent'])
    xml = '<a:pPr xmlns:a="%s"%s>%s</a:pPr>' % (A, attrs, ''.join(parts))
    new = etree.fromstring(xml.encode('utf-8'))
    old = p.find(q('pPr'))
    if old is not None:
        p.replace(old, new)
    else:
        p.insert(0, new)


def probe_lead_spec(slide):
    """探测继承页导语框的客观规格，作为新建页的模板。

    **不预设任何版式数值**：位置、宽高、边距、字号、字体、颜色，以及段落级
    样式（悬挂缩进／行距／项目符号）全部从参考页实测得出。换一份风格不同
    的参考 ppt，规格自动跟着变。
    若参考页没有导语框，返回 None（调用方需自行决定导语形态）。
    """
    lb = find_lead_box(slide)
    if lb is None:
        return None
    tf = lb.text_frame
    size, name, color = None, None, None
    for p in tf.paragraphs:
        for r in p.runs:
            if r.text.strip():
                size = r.font.size.pt if r.font.size else None
                name = r.font.name
                try:
                    color = str(r.font.color.rgb)
                except Exception:
                    color = None
                break
        if size:
            break
    return {
        'left': lb.left / 914400.0,
        'top': lb.top / 914400.0,
        'width': lb.width / 914400.0,
        'height': lb.height / 914400.0,
        'margin_left': tf.margin_left / 914400.0,
        'margin_right': tf.margin_right / 914400.0,
        'margin_top': tf.margin_top / 914400.0,
        'margin_bottom': tf.margin_bottom / 914400.0,
        'size': size, 'font': name, 'color': color,
        'para': probe_para_style(tf.paragraphs[0]),
    }


def add_lead_box(slide, spec):
    """给新建页补一个导语框，外观严格照 spec（来自 probe_lead_spec）。

    spec 由参考页探测而来，因此换任何一份参考 ppt 都能跟随其风格。
    """
    sp = slide.shapes.add_textbox(E(spec['left']), E(spec['top']),
                                   E(spec['width']), E(spec['height']))
    sp.name = LEAD_BOX_NAME
    tf = sp.text_frame
    tf.margin_left = E(spec['margin_left'])
    tf.margin_right = E(spec['margin_right'])
    tf.margin_top = E(spec['margin_top'])
    tf.margin_bottom = E(spec['margin_bottom'])
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    style_run(tf.paragraphs[0].add_run(), '', spec['size'] or 14.0,
              False, spec['color'] or BLACK, spec['font'] or EA)
    # 段落级样式（悬挂缩进／行距／项目符号）也要搬，否则新建页与继承页
    # 外观不一致——这些同样是从参考页探测来的，不预设。
    if spec.get('para'):
        apply_para_style(tf.paragraphs[0], spec['para'])
    return sp


def open_deck(src, pages=1, base_page=1):
    """打开参考稿并铺成一个 N 页的干净 deck。

    用于「一份方案多页」的交付形态：参考稿只留 base_page 页作为母版/版式
    来源，其余页用**同一个 layout** 新建，每页补一个按参考页探测出的导语框。
    新建页自带标题占位，视觉体系（灰带、红竖条等）由版式提供，无需重建。

    **不预设版式**：layout 取自 base_page 页自身的版式（不是写死索引），
    导语框规格由 probe_lead_spec 从参考页探测。换任何参考 ppt 都跟随其风格。

    base_page 默认 1（复刻指定页，行为稳定）。参考稿以封面开篇时应显式传
    base_page=N 指定正文页；也可传 base_page=None 交给 pick_reference_page()
    自动挑典型正文页。

    返回 (prs, [slide, ...])，列表长度等于 pages。
    每页都是「空白待填」状态：只有标题占位与一个空导语框。

    注意：单页出页仍用 `open_reference(src, keep=N)`，语义不变。
    """
    if pages < 1:
        raise ValueError('pages 至少为 1')
    prs, first = open_reference(src, keep=base_page)
    # 继承页的导语框改名，与新建页统一（find_lead_box / clear_body 按名识别）
    lb = find_lead_box(first)
    if lb is not None:
        lb.name = LEAD_BOX_NAME
    spec = probe_lead_spec(first)
    # 标题规格：参考稿标题**不是占位符**时，新建页从版式复制不到它，
    # 必须按实测规格自建一个，否则第 2 页起没有标题。
    tspec = probe_title_spec(first)
    need_title_box = bool(tspec) and not tspec['is_placeholder']
    if need_title_box:
        tb = find_title_box(first)
        if tb is not None:
            tb.name = TITLE_BOX_NAME
    # 版式跟随参考页自身，不写死索引
    layout = first.slide_layout
    slides = [first]
    for _ in range(pages - 1):
        ns = prs.slides.add_slide(layout)
        _drop_thinkcell(ns)
        if spec:
            add_lead_box(ns, spec)
        if need_title_box:
            add_title_box(ns, tspec)
        slides.append(ns)
    return prs, slides


def clean_orphan_rels(slide):
    """删掉 slide 级孤立关系（think-cell OLE / 未引用图片）。母版级关系不动。"""
    used = set()
    for el in slide._element.iter():
        for a in ('embed', 'id', 'link'):
            v = el.get('{%s}%s' % (R, a))
            if v:
                used.add(v)
    dropped = []
    for rId, rel in list(slide.part.rels.items()):
        if rId in used:
            continue
        if rel.reltype.endswith('/oleObject') or rel.reltype.endswith('/image'):
            slide.part.drop_rel(rId)
            dropped.append(rId)
    return dropped


def find_placeholders(slide):
    """返回 (title_placeholder, [其它占位])。"""
    title, others = None, []
    for sh in slide.shapes:
        if sh.is_placeholder:
            try:
                if sh.placeholder_format.type == PP_PLACEHOLDER.TITLE:
                    title = sh
                    continue
            except Exception:
                pass
            others.append(sh)
    return title, others


def find_lead_box(slide):
    """找导语文本框。

    三种来源都要覆盖：
      · 新建页补的导语框 —— 名为 LEAD_BOX_NAME（最可靠，优先匹配）；
      · 参考页继承来的导语框 —— 普通文本框，靠几何位置识别；
      · 参考页标题不是占位符的情况 —— 标题框本身必须被排除。

    排除标题的办法不依赖「标题是占位符」这一假设：
    取标题区（页面最上方、与版式标题带同高）里**字号最大的那个文本框**作为标题，
    并把它的位置从候选里剔除。这样标题是占位符或普通文本框都能正确处理。
    """
    # 1) 按名称直接命中（新建页的导语框）
    for sh in slide.shapes:
        if sh.name == LEAD_BOX_NAME:
            return sh

    title_ph, _ = find_placeholders(slide)

    # 2) 定位「标题」：占位符优先；否则取页面最上方区域里字号最大的文本框
    title_box = title_ph
    if title_box is None:
        cands = []
        for sh in slide.shapes:
            if not sh.has_text_frame or not sh.text_frame.text.strip():
                continue
            if sh.top is None:
                continue
            if sh.top > 1.0 * 914400:      # 只看页面最上方 1 英寸内
                continue
            sizes = [r.font.size.pt for p in sh.text_frame.paragraphs
                     for r in p.runs if r.font.size]
            cands.append((max(sizes) if sizes else 0, sh))
        if cands:
            cands.sort(key=lambda x: -x[0])
            title_box = cands[0][1]

    t_bottom = None
    t_size = None
    if title_box is not None and title_box.top is not None:
        t_bottom = title_box.top + (title_box.height or 0)
        tsz = [r.font.size.pt for p in title_box.text_frame.paragraphs
               for r in p.runs if r.font.size]
        t_size = max(tsz) if tsz else None

    # 3) 标题下方最宽的独立文本框
    best = None
    for sh in slide.shapes:
        if title_box is not None and sh.shape_id == title_box.shape_id:
            continue
        if sh.is_placeholder or not sh.has_text_frame:
            continue
        if sh.top is None or sh.width is None or sh.height is None:
            continue
        if t_bottom is not None and sh.top < t_bottom:
            continue
        if not sh.text_frame.text.strip():
            continue
        # 合理性判据：导语是**标题的补充说明**，字号不应大于标题。
        # 封面页的通栏主标题（常 60–90pt）会被这条排除掉，
        # 否则它会被当成导语框，据此建页必然崩版。
        if t_size:
            ssz = [r.font.size.pt for p in sh.text_frame.paragraphs
                   for r in p.runs if r.font.size]
            if ssz and max(ssz) > t_size * 1.2:
                continue
        if best is None or sh.width > best.width:
            best = sh
    return best


def _overlaps(a, b, slack=0.12):
    """两个矩形（英寸元组 L,T,W,H）是否重叠（带 slack 容差）。"""
    al, at, aw, ah = a
    bl, bt, bw, bh = b
    return not (al + aw < bl - slack or bl + bw < al - slack or
                at + ah < bt - slack or bt + bh < at - slack)


def clear_body(slide, keep_names=(), keep_ids=(), keep_decor=True):
    """清空页面主体对象，保留占位与指定对象。

    默认保留：导语框（LEAD_BOX_NAME）、**标题框**、全部占位符。

    标题框必须保留——很多参考稿的标题是版式里的**普通形状**而不是占位符，
    标题又常被命名成「文本框」，一旦按名清掉就再也找不回来
    （实测某学术模板：clear_body 之后 setup_title 直接报「没有找到标题对象」）。

    **删除判据按"有没有内容"划分，而不是按形状名字前缀**。
    按名字前缀（Rectangle/TextBox/文本框）只能清理英文命名的稿子：
    真实模板里形状多叫「图片 6」「组合 90」「矩形: 圆角 73」，
    按名字删会整片漏掉，参考页的图片与图形就叠在新页内容下面。
    现在改为：
      · 含文字 / 含图片 / 是组合 → 内容，删除；
      · 纯色块、线条、箭头等无内容形状 → 判为装饰：
          **与标题框或导语框重叠的保留**（标题带、导语底这类视觉结构件），
          正文区中间的空容器框删除（否则会盖在新页内容上）。
    """
    keep = set(keep_names) | set(keep_ids) | {LEAD_BOX_NAME, TITLE_BOX_NAME}
    # 探测到的标题对象（非占位符情形）也要保住
    t = find_title_box(slide)
    if t is not None and not t.is_placeholder:
        keep.add(t.shape_id)
    # 标题带 / 导语底这类「结构装饰」的范围：与标题框、导语框重叠者保留
    anchors = []
    for box in (t, find_lead_box(slide)):
        if box is None:
            continue
        if box.left is None or box.top is None:
            continue
        anchors.append(((box.left or 0) / 914400.0, (box.top or 0) / 914400.0,
                        (box.width or 0) / 914400.0, (box.height or 0) / 914400.0))
    removed = []
    for sh in list(slide.shapes):
        if sh.name in keep or sh.shape_id in keep:
            continue
        if sh.is_placeholder:
            continue
        has_text = False
        try:
            has_text = bool(sh.has_text_frame and sh.text_frame.text.strip())
        except Exception:
            has_text = False
        has_pic = False
        try:
            has_pic = sh.shape_type == 13 or sh.shape_type == 6   # PICTURE / GROUP
        except Exception:
            has_pic = False
        if keep_decor and not has_text and not has_pic:
            if sh.left is None or sh.top is None:
                continue
            box = ((sh.left or 0) / 914400.0, (sh.top or 0) / 914400.0,
                   (sh.width or 0) / 914400.0, (sh.height or 0) / 914400.0)
            if any(_overlaps(box, a) for a in anchors):
                continue                   # 与标题/导语重叠 → 结构装饰，保留
        sh._element.getparent().remove(sh._element)
        removed.append(sh.name)
    return removed



def _inherited_title_size(shape, run):
    """取 run 从版式/母版继承来的字号（run 本身没有显式 sz 时）。

    读取顺序（先具体后通用）：
      1. 版式里对应占位符的 `lstStyle/lvl1pPr/defRPr/@sz` —— 最贴近实际渲染；
      2. 母版 txStyles 的 titleStyle/lvl1pPr/defRPr/@sz；
      3. None（交调用方回退默认）。
    """
    try:
        slide = shape.part
        layout = None
        try:
            layout = slide.slide_layout
        except Exception:
            layout = None

        # 1) 版式占位符自身的 lstStyle
        #    注意命名空间：lstStyle 在 p:txBody 下（presentationml），
        #    而 lvl1pPr / defRPr 属于 drawingml。用错前缀会静默返回 None。
        if layout is not None:
            try:
                ph_iter = list(layout.placeholders)
            except Exception:
                ph_iter = []
            for phf in ph_iter:
                for path in ('.//' + q('lvl1pPr') + '/' + q('defRPr'),
                             './/' + q('defRPr')):
                    try:
                        dpr = phf._element.find(path)
                    except Exception:
                        dpr = None
                    if dpr is not None and dpr.get('sz'):
                        return int(dpr.get('sz')) / 100.0

        # 2) 母版 txStyles/titleStyle
        master = getattr(layout, 'slide_master', None)
        if master is not None:
            tx = master._element.find(qp('txStyles'))
            if tx is not None:
                tstyle = tx.find(qp('titleStyle'))
                if tstyle is not None:
                    dpr = tstyle.find(q('lvl1pPr') + '/' + q('defRPr'))
                    if dpr is not None and dpr.get('sz'):
                        return int(dpr.get('sz')) / 100.0
    except Exception:
        pass
    return None


def find_title_box(slide):
    """定位参考页的标题对象。

    优先用标题占位符；没有占位符时，退回「页面最上方区域里字号最大的文本框」。
    因此参考稿的标题是占位符或普通文本框，都能处理。

    新建页自建的标题框按名（TITLE_BOX_NAME）优先命中——它比启发式可靠。
    """
    for sh in slide.shapes:
        if sh.name == TITLE_BOX_NAME:
            return sh
    title_ph, _ = find_placeholders(slide)
    if title_ph is not None:
        return title_ph
    cands = []
    for sh in slide.shapes:
        if not sh.has_text_frame or not sh.text_frame.text.strip():
            continue
        if sh.top is None or sh.top > 1.0 * 914400:
            continue
        sizes = [r.font.size.pt for p in sh.text_frame.paragraphs
                 for r in p.runs if r.font.size]
        cands.append((max(sizes) if sizes else 0, sh))
    if not cands:
        return None
    cands.sort(key=lambda x: -x[0])
    return cands[0][1]


def probe_title_spec(slide):
    """探测参考页标题的完整规格：几何 / 字号 / 颜色 / 字体 / 对齐。

    为什么必须有这一步：有些参考稿的标题**不是占位符**，而是版式里的普通形状。
    而新建页（add_slide）只复制占位符、不复制普通形状——于是新建页上根本没有
    标题可填，「换一份参考稿」这条路直接断掉。实测某学术模板即如此：
    标题是普通文本框（36pt），占位符为 None。

    返回 dict：left/top/width/height（英寸）、size_lead/size_sub、
    color_lead/color_sub、font、align、is_placeholder。
    """
    title = find_title_box(slide)
    if title is None:
        return None
    sizes, colors, fonts = [], [], []
    for p in title.text_frame.paragraphs:
        for r in p.runs:
            if not r.text.strip():
                continue
            sz = r.font.size.pt if r.font.size else None
            if sz is None:
                sz = _inherited_title_size(title, r)
            if sz is not None:
                sizes.append(sz)
            fonts.append(r.font.name)
            try:
                colors.append(str(r.font.color.rgb))
            except Exception:
                colors.append(None)
        if len(sizes) >= 2:
            break
    # 字号回退规则（此处曾是**硬过拟合**）：
    #   探测到 0 个字号 -> 才用 DEFAULT_TITLE_SIZES 兜底；
    #   探测到 1 个（参考页标题只有一段，最常见）-> 保留实测值，副标同号；
    #   探测到 2 个以上 -> 取前两个。
    # 旧写法 `if len(sizes) < 2: sizes = DEFAULT_TITLE_SIZES` 等于
    # 「只要参考页标题不是两段，就一律改成内置红黑稿的 (28,20)」——
    # 实测某学术模板标题是单段 36pt，产出页却被改成 28pt 并凭空多出 20pt 副标。
    n_found = len(sizes)
    if n_found == 0:
        sizes = list(DEFAULT_TITLE_SIZES)
    elif n_found == 1:
        sizes = [sizes[0], sizes[0]]
    else:
        sizes = sizes[:2]
    try:
        align = title.text_frame.paragraphs[0].alignment
    except Exception:
        align = None
    return {
        'left': (title.left or 0) / 914400.0,
        'top': (title.top or 0) / 914400.0,
        'width': (title.width or 0) / 914400.0,
        'height': (title.height or 0) / 914400.0,
        'size_lead': sizes[0],
        'size_sub': sizes[1] if len(sizes) > 1 else None,
        'has_sub': n_found >= 2,
        'color_lead': colors[0] if colors and colors[0] else None,
        'color_sub': (colors[1] if len(colors) > 1 and colors[1]
                      else (colors[0] if colors else None)),
        'font': next((f for f in fonts if f), None),
        'align': align,
        'is_placeholder': bool(title.is_placeholder),
    }


def add_title_box(slide, spec):
    """给新建页补一个标题框，外观严格照 spec（来自 probe_title_spec）。

    只在参考稿标题**不是占位符**时才需要——新建页从版式复制不到普通形状。
    spec 由参考页探测而来，因此换任何一份参考 ppt 都能跟随其风格。
    """
    sp = slide.shapes.add_textbox(E(spec['left']), E(spec['top']),
                                   E(spec['width']), E(spec['height']))
    sp.name = TITLE_BOX_NAME
    tf = sp.text_frame
    tf.margin_left = tf.margin_right = E(0)
    tf.margin_top = tf.margin_bottom = E(0)
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    style_run(tf.paragraphs[0].add_run(), '', spec['size_lead'] or 28.0,
              True, spec['color_lead'] or BLACK, spec['font'] or EA)
    if spec.get('align') is not None:
        tf.paragraphs[0].alignment = spec['align']
    return sp


def _layout_title_geom(slide):
    """推算标题的几何（位置/宽/高），依据是版式里的**标题带**，不是占位符框。

    为什么不能直接用占位符：版式里的 title 占位符只是「默认文字框」，
    宽度往往比标题带窄得多（参考稿 9.415" vs 标题带全幅 13.333"）。
    标题真正能用的范围 = 标题带横向跨度 − 左装饰件 − 右边距。

    探测顺序：
      1. 版式里与标题同高、横向跨度最大的非占位形状 = 标题带；
      2. 左侧的窄条（红色竖条之类）= 左装饰件，其右缘决定文字起点；
      3. 标题占位符的高度与上边距 = 文字基线位置。
    版式里找不到标题带时，退回用占位符自身几何。

    返回 dict：left / top / width / height（单位：英寸）
    """
    try:
        layout = slide.slide_layout
        phs = list(layout.placeholders)
    except Exception:
        return None

    title_ph = None
    for phf in phs:
        try:
            if phf.placeholder_format.type == PP_PLACEHOLDER.TITLE:
                title_ph = phf
                break
        except Exception:
            continue

    # 版式里的非占位形状
    deco = []
    try:
        tree = layout._element.find(qp('cSld')).find(qp('spTree'))
        for sh in tree:
            if etree.QName(sh).localname not in ('sp', 'pic', 'graphicFrame', 'cxnSp'):
                continue
            if sh.find('.//' + qp('ph')) is not None:
                continue                       # 占位符不算装饰
            xfrm = sh.find('.//' + q('xfrm'))
            if xfrm is None:
                continue
            off, ext = xfrm.find(q('off')), xfrm.find(q('ext'))
            if off is None or ext is None:
                continue
            L = int(off.get('x')) / 914400.0
            T = int(off.get('y')) / 914400.0
            W = int(ext.get('cx')) / 914400.0
            H = int(ext.get('cy')) / 914400.0
            rot = xfrm.get('rot')
            deco.append({'L': L, 'T': T, 'W': W, 'H': H, 'rot': rot})
    except Exception:
        deco = []

    if not deco or title_ph is None:
        # 退回：占位符自身几何
        if title_ph is None:
            return None
        return {'left': title_ph.left / 914400.0, 'top': title_ph.top / 914400.0,
                'width': title_ph.width / 914400.0, 'height': title_ph.height / 914400.0}

    ph_T = title_ph.top / 914400.0
    ph_H = title_ph.height / 914400.0
    ph_L = title_ph.left / 914400.0

    # 1) 标题带：与标题纵向重叠、横向跨度最大的形状
    band = None
    for d in deco:
        if d['rot']:                      # 旋转件（竖条）不作为带
            continue
        overlap = min(d['T'] + d['H'], ph_T + ph_H) - max(d['T'], ph_T)
        if overlap <= 0:
            continue
        if band is None or d['W'] > band['W']:
            band = d
    if band is None:
        return {'left': ph_L, 'top': ph_T, 'width': title_ph.width / 914400.0,
                'height': ph_H}

    # 2) 左装饰件：标题带左侧、纵向与之重叠、横向窄的形状（红色竖条）
    left_dec = None
    for d in deco:
        if d is band or d['rot']:
            continue
        overlap = min(d['T'] + d['H'], ph_T + ph_H) - max(d['T'], ph_T)
        if overlap <= 0:
            continue
        if d['W'] > band['W'] * 0.25:      # 太宽的不是竖条
            continue
        if d['L'] + d['W'] > band['L'] + band['W'] * 0.5:
            continue
        if left_dec is None or (d['L'] + d['W']) > (left_dec['L'] + left_dec['W']):
            left_dec = d

    text_left = max(ph_L, left_dec['L'] + left_dec['W']) if left_dec else ph_L
    # 右边距：与占位符左内边距对齐到内容左边界
    right = band['L'] + band['W']
    # 内容右边界按版式内标题带的右内缩（取占位符相对带右缘的距离，最小 0.3"）
    width = right - text_left
    if width < ph_L * 0 + 3.0:            # 明显异常则退回占位符宽度
        width = title_ph.width / 914400.0
    return {'left': text_left, 'top': ph_T, 'width': width, 'height': ph_H}


def setup_title(slide, lead, sub=None, lead_size=None, sub_size=None):
    """填标题。

    **几何与字号继承参考页**：标题对象的位置、宽高来自参考页，
    原标题的字号也从继承页探测（章名加粗大号 + 主题小号）。
    因此换一份风格不同的参考 ppt，标题会自动跟随其风格，
    而不是被写死的坐标和字号覆盖。

    仅当参考页标题没有可用字号时，才回退到 DEFAULT_TITLE_SIZES。
    """
    title = find_title_box(slide)
    if title is None:
        raise RuntimeError('参考页没有找到标题对象')
    # 规格来源：**模块级 LAYOUT 优先**（参考页实测，整份 deck 一致）；
    # 没有 LAYOUT 时才探测当前页。
    # 为什么必须这样：继承页上的标题是**参考页的形状**（探测得参考页的字号），
    # 新建页上的标题是**版式占位符**（探测得版式继承的字号）——同一份 deck 里
    # 两者不同（实测继承页 36pt、新建页 28pt），页与页之间字阶就散了。
    # 参考页是唯一权威源。
    spec = None
    _lay = LAYOUT.get('title')
    if _lay:
        spec = dict(_lay)
        spec.setdefault('has_sub', True)
    else:
        spec = probe_title_spec(slide)
    tp = title.text_frame.paragraphs[0]

    # 字号 / 颜色 / 字体全部取自 probe_title_spec（单一权威源）。
    # 注意：参考页标题的 run 可能**没有显式字号**（继承自版式）。此时不能丢弃该
    # run，否则会把副标题的字号误当成主标题字号。取不到显式字号就退回版式默认。
    if lead_size is None:
        lead_size = spec['size_lead']
    if sub_size is None:
        sub_size = spec['size_sub'] or spec['size_lead']
    tcol = spec['color_lead']
    scol = spec['color_sub']
    tfont = spec['font'] or pal('font') or EA

    # 继承来的字号必须验证**放不放得下**。
    # 参考页标题框的高度是给它自己那行**短标题**的；本页标题更长时，
    # 照搬字号就会折行并溢出色带（实测 36pt 单行框装不下两行长标题，
    # 第二行压到了下划线上）。
    # 放不下时按**参考稿字阶**降一档——用的是参考稿自己的档位，
    # 不是写死的比例系数（那正是「小色条」同类的硬套）。
    #
    # ⚠️ 本检查必须在**标题框宽度放宽之后**做：宽度放宽前用参考页的窄框
    # 去量，会把本来就放得下的标题误判成折行，进而错误降档。
    def _mixed_lines(t_lead, t_sub, size_lead, size_sub, avail):
        """主标（粗体）+ 副标（常规）在同一段落里连续排布，共占几行。

        两条必须做对的规矩：
        1. **逐字累加**——主标与副标是同一段里的两个 run，折行点在两者接缝处。
           只拿主标去算行数会严重低估（实测 3.5" 主标被判 1 行，实际加上
           11" 副标后是 2 行）。
        2. **主副标各用自己的字号**——参考页两段标题常常不同号（实测 28+20）。
           用主标字号去量副标会偏宽（实测 32 字副标按 28pt 量得 12.44"，
           按 20pt 量只有 8.89"），把放得下的标题误判成折行而错误降档。
        """
        fb = _font(size_lead, True)
        fr = _font(size_sub or size_lead, False)
        limit = avail * 96
        lines, cur = 1, 0.0
        for ch, f in ((t_lead or '', fb), (t_sub or '', fr)):
            for c in ch:
                w = f.getlength(c)
                if cur + w > limit:
                    lines += 1
                    cur = w
                else:
                    cur += w
        return lines

    def _fits(size_lead, size_sub, t_lead, t_sub):
        try:
            w = (title.width or 0) / 914400.0
            h = (title.height or 0) / 914400.0
            if w <= 0 or h <= 0 or not t_lead:
                return True
            avail = w - 0.2          # 文本框左右内边距（各 0.1"）
            if avail <= 0:
                return True
            lines = _mixed_lines(t_lead, t_sub, size_lead, size_sub, avail)
            return lines * size_lead * LH / 72.0 <= h + 0.005
        except Exception as e:
            print('  [标题] 放得下判定异常（%s）——按放行处理，请目视核对' % e)
            return True

    for r in list(tp.runs):
        r._r.getparent().remove(r._r)
    title.text_frame.auto_size = MSO_AUTO_SIZE.NONE
    title.text_frame.word_wrap = True
    # 几何原则：
    #   位置与高度 = **完全继承参考页原值**（不覆盖）。参考页的位置就是作者
    #   按该参考稿排好的，擅自改动会让抗锯齿错位、渲染与原件不一致。
    #   宽度 = 允许放宽到版式标题带的可用范围（标题带才是权威上限），
    #   但不得窄于参考页原值——避免把长标题挤到换行。
    lg = _layout_title_geom(slide)
    if lg and lg.get('width'):
        try:
            cur_w_in = (title.width or 0) / 914400.0      # EMU -> 英寸（单位必须一致）
            if lg['width'] > cur_w_in:
                title.width = E(lg['width'])
        except Exception:
            pass
    # 放不下就按参考稿字阶降一档（在宽度放宽之后判断）
    if lead_size and not _fits(lead_size, sub_size, lead, sub):
        _sc = (LAYOUT.get('scale') or {}).get('sizes') or {}
        _smaller = [s for s in sorted(_sc.keys(), reverse=True)
                    if s < (lead_size or 0)]
        _h = (title.height or 0) / 914400.0
        _orig = lead_size
        if _smaller:
            lead_size = _smaller[0]
            # 副标与主标同段排布，主标降档时副标必须同步降，否则副标仍是大号，
            # 一样会折行溢出。
            if sub_size and sub_size >= _orig:
                sub_size = lead_size
            print('  [标题] %gpt 放不下（框高 %.2f"）——按参考稿字阶降为 %gpt'
                  % (_orig, _h, lead_size))
        else:
            print('  [标题] %gpt 放不下且参考稿字阶里没有更小档位 —— 请缩短标题文案'
                  % _orig)

    # 副标题段**只在真的传了副标时**才写。
    #   sub=None（没传）-> 只写主标，严格贴合参考页的单段标题结构；
    #   sub='文本'     -> 写两段；字号取参考页的副标档位。参考页若是单段标题
    #                     （没有副标档位），就退回主标同号——**不凭空套一个
    #                     默认档**（那正是「小色条」同类的硬套套路）。
    runs = [(lead, lead_size, True, tcol or BLACK, tfont)]
    if sub is not None and str(sub).strip():
        if sub_size is None:
            sub_size = spec.get('size_sub') or lead_size
        runs.append((sub, sub_size, False, scol or tcol or BLACK, tfont))
    set_para(tp, runs)
    return title


def setup_lead(lead, text, size=None, left=None, top=None, width=None, height=None):
    """填导语段。lead 由 find_lead_box() 取得。

    默认沿用该框自身的几何与原字号（继承页的导语框已带正确规格）；
    传入参数才覆盖。字体与颜色同样继承原框。
    """
    if lead is None:
        raise RuntimeError('导语文本框未找到：先 find_lead_box() 再 clear_body()')
    tf = lead.text_frame
    p = tf.paragraphs[0]

    # 继承原框的字号/字体/颜色与几何。
    # 注意：**空 run 也要看**——新建页的导语框由 add_lead_box() 建，里面是
    # 一个"文字为空但带字号颜色字体"的占位 run。若只认有文字的 run，
    # 新建页就会回落到默认字号与黑色，而继承页是参考页的原样 → 一眼就不一样。
    osize, ofont, ocolor = None, None, None
    for r in p.runs:
        if r.text.strip():
            osize = r.font.size.pt if r.font.size else None
            ofont = r.font.name
            try:
                ocolor = str(r.font.color.rgb)
            except Exception:
                ocolor = None
            break
        if osize is None and r.font.size is not None:
            osize = r.font.size.pt
            ofont = r.font.name
            try:
                ocolor = str(r.font.color.rgb)
            except Exception:
                ocolor = None
    geo = (lead.left, lead.top, lead.width, lead.height)

    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.word_wrap = True
    if left is not None:
        lead.left = E(left)
    if top is not None:
        lead.top = E(top)
    if width is not None:
        lead.width = E(width)
    if height is not None:
        lead.height = E(height)
    if geo[0] is None:                      # 兜底：框没有几何就还回原值
        lead.left, lead.top, lead.width, lead.height = geo
    style_run(p.add_run(), text, size or osize or 14.0, False,
              ocolor or BLACK, ofont or EA)
    return lead


def save_and_report(prs, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    prs.save(out)
    size = os.path.getsize(out) / 1024.0
    print('已保存: %s (%.0f KB)' % (out, size))
    return out


# ================================================================ 渲染与复核链
def _resolve_soffice():
    """定位 LibreOffice 可执行文件。

    顺序：环境变量 `PPT_SOFFICE` → 各平台常见安装路径 → PATH 里的
    soffice / libreoffice。**不写死本机路径**——写死后换台机器（换安装
    目录、换系统、换用户）立刻失效，而失败信息还很难懂。
    """
    import shutil
    cands = []
    env = os.environ.get('PPT_SOFFICE') or os.environ.get('SOFFICE')
    if env:
        cands.append(env)
    for base in (os.environ.get('ProgramFiles'),
                 os.environ.get('ProgramFiles(x86)'),
                 '/Applications', '/usr', '/usr/local', '/opt'):
        if not base:
            continue
        cands.append(os.path.join(base, 'LibreOffice', 'program', 'soffice.exe'))
        cands.append(os.path.join(base, 'libreoffice', 'program', 'soffice'))
    cands.append('/Applications/LibreOffice.app/Contents/MacOS/soffice')
    for name in ('soffice', 'soffice.exe', 'libreoffice', 'libreoffice.exe'):
        w = shutil.which(name)
        if w:
            cands.append(w)
    for c in cands:
        if c and os.path.exists(c):
            return c
    return cands[0] if cands else 'soffice'


SOFFICE = _resolve_soffice()
PY_EXE  = sys.executable             # 运行中的解释器（不写死本机路径）


def file_url(p):
    """Windows 路径 -> file:/// URL。

    坑：LibreOffice 在 Windows 下不接受反斜杠路径，会报
    `source file could not be loaded` 且 exit 1。正斜杠或 file:/// 立刻通。
    """
    p = os.path.abspath(p).replace('\\', '/')
    return 'file:///' + p.lstrip('/')


def render_pdf(pptx, outdir, timeout=600):
    """pptx -> pdf（LibreOffice 无头）。返回 pdf 路径。"""
    if not os.path.exists(SOFFICE):
        raise RuntimeError(
            '找不到 LibreOffice（soffice）。\n'
            '  当前解析到：%s\n'
            '  装 LibreOffice，或设环境变量 PPT_SOFFICE 指向 soffice 可执行文件。'
            % SOFFICE)
    os.makedirs(outdir, exist_ok=True)
    cmd = [SOFFICE, '--headless', '--norestore', '--convert-to', 'pdf',
           '--outdir', file_url(outdir), file_url(pptx)]
    r = subprocess.run(cmd, capture_output=True, text=True, errors='replace', timeout=timeout)
    pdf = os.path.join(outdir, os.path.splitext(os.path.basename(pptx))[0] + '.pdf')
    if not os.path.exists(pdf):
        raise RuntimeError('渲染失败：%s\n%s' % (r.stdout, r.stderr))
    return pdf


def render_png(pdf, out_png, dpi=150, page=0):
    import pymupdf
    d = pymupdf.open(pdf)
    pix = d[page].get_pixmap(dpi=dpi)
    pix.save(out_png)
    return out_png, d.page_count


def crop_regions(png, outdir, dpi=150, regions=None):
    """把整页切成若干分区放大图，便于逐区目视复核。"""
    from PIL import Image
    im = Image.open(png)
    if regions is None:
        h = im.size[1] / dpi
        regions = [('head', 0, min(1.35, h)),
                   ('mid', 1.35, min(4.90, h)),
                   ('lower', 4.90, min(6.60, h)),
                   ('foot', 6.60, h)]
    out = []
    for name, a, b in regions:
        f = os.path.join(outdir, 'crop_%s.png' % name)
        im.crop((0, int(a * dpi), im.size[0], int(b * dpi))).save(f)
        out.append(f)
    return out


def _find_lead_shape(slide):
    """定位页面导语框：标题框下方最近的、通栏宽的文本框。

    判据（不看名字、不看字号档，只看几何与顺序）：
      · 在标题框底边之下；
      · 宽度 ≥ 页宽的 60%（导语是通栏段，页内小卡片不是）；
      · 取其中 top 最小者（离标题最近的那个）。
    这样「标题—导语—条带」的三段式页面里，导语不会被下方的分区条带顶掉。
    """
    tb = find_title_box(slide)
    try:
        pw = slide.part.package.presentation_part.presentation.slide_width / 914400.0
    except Exception:
        pw = 13.333
    t_bottom = None
    if tb is not None and tb.top is not None:
        t_bottom = tb.top / 914400.0 + (tb.height or 0) / 914400.0
    best = None
    for sh in slide.shapes:
        if sh.is_placeholder or not sh.has_text_frame:
            continue
        if sh.top is None or sh.width is None:
            continue
        if not sh.text_frame.text.strip():
            continue
        w = sh.width / 914400.0
        if w < pw * 0.6:
            continue
        t = sh.top / 914400.0
        if t_bottom is not None and t < t_bottom - 0.01:
            continue
        if best is None or t < best[0]:
            best = (t, sh)
    return best[1] if best else None


def lead_clearance_audit(pptx, min_gap=0.05):
    """导语净空审计：导语框与其下方元素是否压线或重叠。

    为什么要有这条：母稿多页时，导语位置若靠"继承参考页原值"，一旦某页
    下方元素位置偏高，导语就会压上去——第二行被裁，肉眼才看得出。
    这里做**纯几何**判定，静态可跑：
      1. 导语框底边 vs 下方最近元素的顶边 → 间距 < min_gap 视为压线；
      2. 导语文字实需高度 vs 框高 → 纵向溢出。
    """
    from pptx import Presentation
    prs = Presentation(pptx)
    issues = []
    pages = []
    for i, sl in enumerate(prs.slides, 1):
        lb = _find_lead_shape(sl)
        if lb is None:
            continue
        l_top = lb.top / 914400.0
        l_h = (lb.height or 0) / 914400.0
        l_w = (lb.width or 0) / 914400.0
        l_bot = l_top + l_h
        # 下方最近的非导语元素
        below = []
        for sh in sl.shapes:
            if sh.shape_id == lb.shape_id or sh.top is None:
                continue
            t = sh.top / 914400.0
            if t < l_bot - 0.30:          # 只看导语底边附近及以下
                continue
            below.append((t, sh.name))
        below.sort()
        gap = None
        if below:
            gap = below[0][0] - l_bot
        # 文字实需高度：按**段内自动换行后的行数**算，不是段落数
        need_h = 0.0
        tf = lb.text_frame
        avail_w = l_w - (tf.margin_left or 0) / 914400.0 - (tf.margin_right or 0) / 914400.0
        for p in tf.paragraphs:
            txt = p.text.strip()
            if not txt:
                continue
            szs = [r.font.size.pt for r in p.runs if r.font.size]
            sz = max(szs) if szs else 14.0
            ls = p.line_spacing if isinstance(p.line_spacing, float) else 1.2
            tw = text_width_in(txt, sz)
            lines = max(1, int(tw / avail_w) + (1 if tw % avail_w else 0))
            need_h += lines * sz * ls / 72.0
        pg = {'page': i, 'top': l_top, 'h': l_h, 'bottom': l_bot,
              'gap': gap, 'need_h': need_h, 'text': lb.text_frame.text.strip()[:26]}
        pages.append(pg)
        if gap is not None and gap < min_gap:
            issues.append({'page': i, 'kind': '压线/重叠',
                           'detail': '导语底边 %.3f"，下方「%s」顶边 %.3f"，间距 %.3f"'
                                     % (l_bot, below[0][1], below[0][0], gap),
                           'gap': gap})
        if need_h > l_h + 0.02:
            issues.append({'page': i, 'kind': '纵向溢出',
                           'detail': '文字需高 %.3f"，框高 %.3f"' % (need_h, l_h),
                           'need_h': need_h, 'box_h': l_h})
    return {'pages': pages, 'issues': issues}


def _para_layout(p, avail_w):
    """段落内多 run 混排 → (行数, 总高英寸)。

    与 setup_title 的 _mixed_lines **同源**：逐字累加，每个 run 用自己的
    字号与粗细度量，行高按**该行内出现的最大字号**算。

    为什么不能「按段内最大字号整体量」：主标 28pt 与副标 20pt 写在同一
    段时，按 28pt 量整段会把一行文字算成两行 —— 实测母稿标题就是这样被
    误报成「需高 0.894"、框高仅 0.356"」的假溢出。

    折行点落在 run 接缝处是保守估计：真实渲染中标题的主副标是分开
    排布的，但按接缝折行只会让行数偏多，不会偏少。
    """
    runs = [r for r in p.runs if (r.text or '')]
    if not runs:
        return 0, 0.0
    segs = []
    for r in runs:
        sz = r.font.size.pt if r.font.size else None
        segs.append((r.text or '', sz, bool(r.font.bold)))
    sizes = [s for (_, s, _) in segs if s]
    max_sz = max(sizes) if sizes else 14.0
    ls = p.line_spacing if isinstance(p.line_spacing, float) else None
    if ls is None:
        try:
            if p.line_spacing is not None:      # Length 对象 → 折成倍数
                ls = p.line_spacing / (max_sz * 12700.0)
        except Exception:
            ls = None
    if not ls or ls <= 0:
        ls = 1.0           # **无显式行距 = 100%**，不是 LH（见下方 RENDER_LH 注释）

    if len(segs) == 1 and segs[0][1]:            # 单 run 快速路径
        t, sz, bold = segs[0]
        lines = n_lines(t, sz, avail_w, bold)
        return lines, lines * sz * ls * RENDER_LH / 72.0

    limit = avail_w * 96
    lines, cur, line_max = 1, 0.0, 0.0
    heights = []
    for t, sz, bold in segs:
        sz = sz or max_sz
        f = _font(sz, bold)
        for ch in t:
            w = f.getlength(ch)
            if cur + w > limit:
                heights.append(line_max * ls * RENDER_LH / 72.0)
                lines += 1
                cur, line_max = 0.0, 0.0
            cur += w
            if sz > line_max:
                line_max = sz
    heights.append(line_max * ls * RENDER_LH / 72.0)
    return lines, sum(heights)


def _visible_fill_or_line(sh):
    """形状是否**看得见**（有实心填充或有可见描边）——即它是不是一个"容器"。"""
    try:
        t = sh.fill.type
        if t is not None and int(t) in (1, 2, 3, 4):   # SOLID/GRADIENT/PATTERNED/PICTURE
            return True
    except Exception:
        pass
    try:
        t = sh.line.fill.type
        if t is not None and int(t) in (1, 2, 3, 4):
            return True
    except Exception:
        pass
    return False


def _container_of(sh, containers, tol=0.03):
    """给一个**纯文本框**找它的视觉容器：外框包住它的、带填充或描边的形状里面积最小者。

    为什么要找容器：卡片里的文字框常常比文字本身高、也可能比卡片矮。
    文字"越过自己的文本框"未必是缺陷——**越过卡片的下边框才是**。
    找不到容器时返回 None（用形状自己的外框当边界）。
    """
    if sh.left is None or sh.top is None:
        return None
    x0 = sh.left / 914400.0
    y0 = sh.top / 914400.0
    x1 = x0 + (sh.width or 0) / 914400.0
    y1 = y0 + (sh.height or 0) / 914400.0
    best = None
    best_area = None
    for c in containers:
        if c is sh or c.left is None or c.top is None:
            continue
        cx0 = c.left / 914400.0
        cy0 = c.top / 914400.0
        cx1 = cx0 + (c.width or 0) / 914400.0
        cy1 = cy0 + (c.height or 0) / 914400.0
        if cx0 - tol <= x0 and cy0 - tol <= y0 and cx1 + tol >= x1 and cy1 + tol >= y1:
            area = (cx1 - cx0) * (cy1 - cy0)
            if best_area is None or area < best_area:
                best, best_area = c, area
    return best


def text_overflow_audit(pptx, ratio=1.0, abs_tol=0.01, min_lines=2):
    """全文本框的**纵向溢出**审计（不限导语）。

    为什么要有这条：审计链原来只查导语的净空与溢出，**正文框查不到**。
    实测一页 4:3 参考稿上，卡片里两行 14pt 文字放进 0.30" 的框 → 文字
    压出框外；18pt 卡片名折行 → 压到下面那行正文 —— 八关全绿，肉眼却
    一眼可见。这类问题正是「静态门禁替代目视」要覆盖的。

    判定（三条同时成立才报）：
      1. 文字**越出视觉容器的外框**（顶/底/居中三种垂直对齐分别推算文字区间）；
         越出量 > abs_tol；
      2. 文字**确实要排成多行**（行数 >= min_lines）；
      3. 框有可见底色/边框，或实需高超出框高一整行以上。

    第 2 条是关键：单行文字比框底高出一点点是**参考稿的原样**（标题
    占位符常态 —— 参考页把 0.456" 的框配 28pt 文字，扣掉上下内边距后
    框高 0.356" < 一行 0.447"），拿它报错全是误报；而多行文字塞进装
    不下那么多行的框，才会真的压字。

    **边界是外框，不是内边距区**：内边距只是留白，文字略微越过内边距不算
    缺陷；真正的裁切/碰撞边界是形状的外框。早期口径拿「内边距区高」当
    阈值，把参考页继承来的导语框（超 0.034" 但仍在框内）误报成溢出。

    **行高按真实渲染折算（RENDER_LH）**：估算式是「字号 × 行距」，而
    LibreOffice 实际渲染的行高比它大 1.20 倍（实测见 RENDER_LH 注释）。
    `_para_layout()` 已直接返回**真实高度**，所以这里比较的是「真实需高 vs 框高」。

    为什么以前会漏：旧口径用「估算需高 > 框高 × 1.12」才报，折算回真实
    渲染等于**只有溢出 34% 以上才抓得到**——真实裁字（0~34%，末行被切一半）
    整片漏过，静态全绿而肉眼可见。**折算必须乘在实需高上，不能加在框高上**。
    """
    from pptx import Presentation
    from pptx.enum.text import MSO_AUTO_SIZE
    from pptx.enum.text import MSO_ANCHOR
    prs = Presentation(pptx)
    issues = []
    checked = skipped = 0
    for i, sl in enumerate(prs.slides, 1):
        containers = [c for c in sl.shapes if _visible_fill_or_line(c)]
        for sh in sl.shapes:
            if not sh.has_text_frame:
                continue
            tf = sh.text_frame
            txt = tf.text.strip()
            if len(txt) < 2:
                continue
            try:
                if tf.auto_size == MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT:
                    skipped += 1
                    continue
            except Exception:
                pass
            try:
                if tf.word_wrap is False:
                    skipped += 1      # 不换行，横向溢出另有判据
                    continue
            except Exception:
                pass
            if sh.height is None or sh.width is None:
                continue
            ml = (tf.margin_left or 0) / 914400.0
            mr = (tf.margin_right or 0) / 914400.0
            mt = (tf.margin_top or 0) / 914400.0
            mb = (tf.margin_bottom or 0) / 914400.0
            avail_w = sh.width / 914400.0 - ml - mr
            avail_h = sh.height / 914400.0 - mt - mb
            if avail_w <= 0.05 or avail_h <= 0.02:
                continue
            need = 0.0
            total_lines = 0
            paras = list(tf.paragraphs)
            for pi, p in enumerate(paras):
                if not p.text.strip():
                    need += 0.06
                    continue
                ln, ph = _para_layout(p, avail_w)
                total_lines += ln
                need += ph
                # **段后距计入需高**（最后一段不计：末尾空隙不产生可见文字）。
                # 项目符号列表 sa=2~4pt × N 段，漏算就是 0.1" 量级的误差，
                # 正好是"末行压出卡片"的那一刀。
                try:
                    sa = p.space_after
                    if sa is not None and pi < len(paras) - 1:
                        need += sa / 914400.0
                except Exception:
                    pass
            checked += 1
            if total_lines < min_lines:
                continue                       # 单行临界：不报（见 docstring）
            # 判据：**文字是否越出视觉容器的外框**。
            #   · 文字形状自己带填充/描边 → 它自己就是容器（文字越过卡片下边框＝缺陷）
            #   · 纯文本框 → 找外层最小的卡片当容器；找不到就用自己的外框
            #   边界是**外框**而不是内边距区：内边距只是留白，文字略微越过内边距不算缺陷。
            sh_top = sh.top / 914400.0
            sh_h = sh.height / 914400.0
            b_top, b_bot = sh_top, sh_top + sh_h
            if not _visible_fill_or_line(sh):
                cont = _container_of(sh, containers)
                if cont is not None:
                    b_top = cont.top / 914400.0
                    b_bot = b_top + (cont.height or 0) / 914400.0
            # 文字实际占据的纵向区间（按垂直对齐推算）
            va = None
            try:
                va = tf.vertical_anchor
            except Exception:
                va = None
            if va == MSO_ANCHOR.BOTTOM:
                t_top = b_bot - mb - need
            elif va == MSO_ANCHOR.MIDDLE:
                t_top = b_top + (b_bot - b_top - need) / 2.0
            else:
                t_top = sh_top + mt
            t_bot = t_top + need
            over = max(t_bot - b_bot, b_top - t_top)
            if over > abs_tol:
                issues.append({'page': i, 'name': sh.name,
                               'need_h': need, 'need_real': need,
                               'box_h': avail_h, 'over': over,
                               'lines': total_lines, 'text': txt[:32]})
    return {'issues': issues, 'checked': checked, 'skipped': skipped}


def print_text_overflow(audit):
    """把 text_overflow_audit 的结果打成可读报告。"""
    if not audit:
        return
    st = audit.get('stats') or audit or {}      # 兼容两种返回结构
    print('    已检文本框 %d 个（跳过自动适应/不换行 %d 个）'
          % (st.get('checked', 0), st.get('skipped', 0)))
    if not audit.get('issues'):
        print('    文本框无纵向溢出 ✓')
        return
    for it in audit['issues']:
        nr = it.get('need_real')
        nr = nr if nr is not None else it['need_h']
        ov = it.get('over')
        ovs = ('，越出外框 %.3f"' % ov) if ov is not None else ''
        print('    !! 第%d页 「%s」实需高 %.3f"（%d 行，含 %.2fx 渲染行高折算）%s：%s'
              % (it['page'], it['name'], nr,
                 it.get('lines', 0), RENDER_LH, ovs, it['text']))


def print_lead_clearance(audit):
    """把 lead_clearance_audit 的结果打成可读报告。"""
    if not audit or not audit.get('pages'):
        print('    无导语框数据')
        return
    for p in audit['pages']:
        g = ('%.3f"' % p['gap']) if p['gap'] is not None else '—'
        print('    第%d页 导语 T=%.3f" H=%.3f" 文字需高=%.3f" 下方间距=%s'
              % (p['page'], p['top'], p['h'], p['need_h'], g))
    if not audit['issues']:
        print('    导语净空正常 ✓')
        return
    for it in audit['issues']:
        print('    !! 第%d页 导语%s：%s' % (it['page'], it['kind'], it['detail']))


def audit_text(pptx, forbidden=(), slide_no=1, slide_part=None):
    """文本层审计：残留词、ASCII 直引号、U+FFFD。

    **定位方式：用 slide part 的 blob，不按文件名取**。两个坑：
      1. 参考稿被裁剪后 slide part 编号不连续（只剩 2 页时可能仍叫
         slide2.xml / slide8.xml），按 'slideN.xml' 里的 N 当页号会审错页；
      2. python-pptx 的 `part.partname` 与 zip 内实际条目名**可能不一致**
         （裁剪过的稿实测：内存报 slide1.xml，包里其实是 slide8.xml），
         按 partname 去 zip 里读会 KeyError。
    故这里直接取 part.blob —— 顺序由 Presentation.slides 保证。
    """
    if slide_part is None:
        from pptx import Presentation
        prs = Presentation(pptx)
        slides = list(prs.slides)
        slide_part = slides[max(1, min(slide_no, len(slides))) - 1].part
    x = slide_part.blob.decode('utf-8', 'replace')
    texts = ''.join(re.findall(r'<a:t>(.*?)</a:t>', x, re.S))
    return {
        'chars': len(texts),
        'forbidden': [w for w in forbidden if w in texts],
        'ascii_quote': '"' in texts,
        'ufffd': texts.count('�'),
        'runs': x.count('<a:t>'),
    }


def size_profile(slide):
    """统计一页里所有**显式字号**的字符分布：{pt: 字符数}。

    字号层级属于参考稿的视觉语言，与配色、字体同级——应该探测跟随，
    不该在工具里写死。这一层是探测与审计的底层。
    """
    prof = {}
    for sh in slide.shapes:
        if not sh.has_text_frame:
            continue
        for p in sh.text_frame.paragraphs:
            for r in p.runs:
                t = (r.text or '').strip()
                if not t or not r.font.size:
                    continue
                pt = round(r.font.size.pt, 1)
                prof[pt] = prof.get(pt, 0) + len(t)
    return prof


def probe_type_scale(slide, top_k=4):
    """从参考页探测字号层级，返回该页的字号谱与推断出的档位。

    返回 {'sizes': {pt: 字符数}, 'title': pt, 'body': pt, 'label': pt, 'max': pt}

    档位判定（全部由实测数据推出，不含任何预设数值）：
      title = 最大字号（页标题）
      body  = 字符数占比最高的字号（正文主档）
      label = 字符数第二高的字号（层内标记），无则取 body
    """
    prof = size_profile(slide)
    if not prof:
        return None
    order = sorted(prof.items(), key=lambda kv: (-kv[1], -kv[0]))
    max_pt = max(prof)
    body = order[0][0]
    label = order[1][0] if len(order) > 1 else body
    return {
        'sizes': dict(sorted(prof.items(), reverse=True)),
        'title': max_pt,
        'body': body,
        'label': label,
        'max': max_pt,
        'top_k': order[:top_k],
    }


def type_scale_audit(pptx, min_share=0.5):
    """多页 deck 的字号层级一致性审计。

    背景：同一份 deck 里，若某页正文用了比其它页更小的字号，静态检查
    全绿、渲染也"看着能过"，但整份放在一起字号体系就散了。这类问题
    只有靠跨页比较才能发现，所以这里做的是**页与页之间**的比较。

    判定规则（不含任何预设数值）：
      1) 统计每个字号出现在多少页上，得到该字号的「页支持率」
      2) 常规档位 C = 支持率 ≥ min_share 的字号（即多数页共有的档位）
      3) 基准 = C 中最小的一档
      4) 某页出现比基准更小、且该字号属少数页特有的档位 → 该页标记为偏小，
         并逐条列出偏小的 run 文本

    为什么用「页支持率」而不是「字符最多的字号」当基准：导语是长句，
    字符数常超过所有正文条目的总和，按字符数取基准会把导语档误当正文档。
    按页投票则直接回答「这几页是不是用了同一套字号」。
    """
    import math
    from pptx import Presentation
    prs = Presentation(pptx)
    pages = []
    for i, sl in enumerate(prs.slides, 1):
        prof = size_profile(sl)
        if prof:
            pages.append({'page': i, 'min': min(prof), 'sizes': prof})
    if not pages:
        return {'pages': [], 'baseline': None, 'issues': []}

    n = len(pages)
    need = max(1, math.ceil(n * min_share))
    support = {}
    for pt in set(pt for p in pages for pt in p['sizes']):
        support[pt] = sum(1 for p in pages if pt in p['sizes'])
    common = sorted(pt for pt, k in support.items() if k >= need)
    if not common:
        return {'pages': pages, 'baseline': None, 'issues': []}
    baseline = common[0]

    issues = []
    for pg in pages:
        lows = [pt for pt in pg['sizes'] if pt < baseline and support[pt] < need]
        if not lows:
            continue
        sl = list(prs.slides)[pg['page'] - 1]
        small = []
        for sh in sl.shapes:
            if not sh.has_text_frame:
                continue
            for p in sh.text_frame.paragraphs:
                for r in p.runs:
                    t = (r.text or '').strip()
                    if t and r.font.size and round(r.font.size.pt, 1) in lows:
                        small.append({'pt': round(r.font.size.pt, 1),
                                      'text': t[:30], 'shape': sh.name})
        issues.append({'page': pg['page'], 'min': min(lows),
                       'items': small[:12], 'count': len(small)})
    return {
        'pages': pages,
        'baseline': baseline,
        'support': support,
        'common': common,
        'issues': issues,
    }


def print_type_scale(audit):
    """把 type_scale_audit 的结果打成可读报告。"""
    if not audit or not audit.get('pages'):
        print('    无字号数据')
        return
    print('    多数页共有档位 = %s pt（基准 %gpt）'
          % (','.join('%g' % c for c in audit.get('common', [])), audit['baseline']))
    for p in audit['pages']:
        sizes = ' '.join('%gpt×%d' % (k, v) for k, v in
                         sorted(p['sizes'].items(), reverse=True))
        print('    第%d页 最小=%gpt | %s' % (p['page'], p['min'], sizes))
    if not audit['issues']:
        print('    字号层级一致 ✓')
        return
    for it in audit['issues']:
        print('    !! 第%d页 字号偏小（%gpt < 基准 %gpt），共 %d 处：'
              % (it['page'], it['min'], audit['baseline'], it['count']))
        for s in it['items']:
            print('         %gpt  %s' % (s['pt'], s['text']))


def measure_text_bands(png, dpi=150, y0=0.0, y1=None, x0=0.0, x1=None,
                       threshold=140, gap=3):
    """像素字带测量：量出渲染图里文字所在的行区间（客观验收用）。

    用途：把「这段文字是不是折成了两行」「行距是否正常」「有没有叠印」
    从肉眼判断变成可回归的数字。取灰度 < threshold 的暗像素行，合并间距
    小于 gap 像素的相邻段，每段就是一行字。

    返回 [(y_start_inch, y_end_inch), ...]。
    典型用法：量标题带（y<1.05"）有几段 —— 1 段 = 单行，2 段 = 折行了。
    """
    import numpy as np
    from PIL import Image
    im = Image.open(png).convert('L')
    a = np.asarray(im)
    h_px, w_px = a.shape
    y0p = max(0, int(round(y0 * dpi)))
    y1p = min(h_px, int(round((y1 if y1 is not None else h_px / dpi) * dpi)))
    x0p = max(0, int(round(x0 * dpi)))
    x1p = min(w_px, int(round((x1 if x1 is not None else w_px / dpi) * dpi)))
    band = a[y0p:y1p, x0p:x1p]
    if band.size == 0:
        return []
    dark = (band < threshold).sum(axis=1)
    segs, start = [], None
    for i, v in enumerate(dark > 0):
        if v and start is None:
            start = i
        elif not v and start is not None:
            segs.append([start, i - 1])
            start = None
    if start is not None:
        segs.append([start, len(dark) - 1])
    merged = []
    for s, e in segs:
        if merged and s - merged[-1][1] <= gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [((s + y0p) / dpi, (e + 1 + y0p) / dpi) for s, e in merged]


def pack_size(pptx):
    z = zipfile.ZipFile(pptx)
    return len(z.namelist()), os.path.getsize(pptx) / 1024.0


# ================================================================ 构件语汇
# 参考稿自己用哪些形状比例——只继承配色与字号还不够，形状比例用错，
# 一眼就是"通用 PPT 套路"（如卡片左侧贴一根实心色条），不是参考稿的语言。

def _shape_geo(sh):
    """返回 (left, top, width, height)，单位英寸；取不到返回 None。"""
    try:
        return (sh.left / 914400.0, sh.top / 914400.0,
                sh.width / 914400.0, sh.height / 914400.0)
    except Exception:
        return None


def _shape_solid(sh):
    """形状是否实心填充；是则返回 'RRGGBB'，否则 None。"""
    try:
        f = sh.fill
        if f.type is not None and int(f.type) == 1:
            return str(f.fore_color.rgb)
    except Exception:
        pass
    return None


def ratio_bucket(r):
    """按宽高比给形状归类（构件语汇的分类口径）。"""
    if r > 4:
        return '扁横条>4:1'
    if r > 1.6:
        return '横块1.6-4:1'
    if r >= 0.625:
        return '近方0.6-1.6:1'
    if r > 0.25:
        return '竖块0.25-0.6:1'
    return '极窄竖条<0.25:1'


def is_narrow_bar(w, h):
    """**窄色条**判定：宽 0.035"~0.12"、高 >=0.25" 的实心条。

    为什么单独拎出来：这类形状是「卡片左侧贴一条彩色竖条」类通用 PPT 套路
    的载体。参考稿正文区几乎不用（实测全稿仅个位数），发丝级分隔线
    （宽 <=0.03"）则是参考稿自己在用的合法语言，两者必须分开判。
    """
    return 0.035 <= w <= 0.12 and h >= 0.25


def probe_part_vocab(prs, body_top=None):
    """量出参考稿的**构件语汇**：正文区实心块的宽高比分档 + 常用尺寸。

    出页前先跑它，才知道哪些形状比例是参考稿自己的语言、哪些是外来套路。

    body_top：正文区起点（英寸）。默认按**页高比例 20%** 计算，而不是写死 1.5"
    ——竖版或更矮的页面，写死的 1.5" 会把大半个页面排除在统计之外。
    """
    from collections import Counter
    if body_top is None:
        try:
            body_top = (prs.slide_height / 914400.0) * 0.20
        except Exception:
            body_top = 1.5
    buckets = Counter()
    dims = Counter()
    bar_total = 0
    bar_per_page = []
    for s in prs.slides:
        page_bars = 0
        for sh in s.shapes:
            g = _shape_geo(sh)
            if not g:
                continue
            _l, t, w, h = g
            if t < body_top:
                continue
            if _shape_solid(sh) is None:
                continue
            buckets[ratio_bucket(w / max(h, 0.001))] += 1
            dims[(round(w, 2), round(h, 2))] += 1
            if is_narrow_bar(w, h):
                page_bars += 1
        bar_total += page_bars
        bar_per_page.append(page_bars)
    total = sum(buckets.values())
    return dict(total=total, buckets=dict(buckets),
                # 样本过小说明语汇不可靠（常见于只对**单页**探测的情形）。
                # 构件语汇是**全稿**统计量，必须对完整参考稿跑。
                sample_small=(total < 20),
                top_dims=[('%sx%s"' % k, v) for k, v in dims.most_common(20)],
                extreme_ratio=(buckets.get('极窄竖条<0.25:1', 0) / total) if total else 0.0,
                narrow_bar_total=bar_total,
                narrow_bar_max_per_page=(max(bar_per_page) if bar_per_page else 0))


def vocab_check(pptx, vocab=None, body_top=1.5):
    """检查产出页的构件比例是否落在参考稿语汇内。

    判定口径（按宽度分两级，不一刀切）：
      · 发丝级（宽 <=0.03"）：分隔线，参考稿自己在用 → 不判违规；
      · 窄条级（0.035"~0.12"）：色块套路载体 —— 若参考稿单页最多用 0~2 根，
        产出页出现即判语汇外；参考稿自己大量在用，则按单页密度上限比。
    """
    from pptx import Presentation
    prs = Presentation(pptx)
    page_buckets = {}
    offenders = []
    page_bar_count = {}
    for i, s in enumerate(prs.slides):
        pb = {}
        bars = 0
        for sh in s.shapes:
            g = _shape_geo(sh)
            if not g:
                continue
            l, t, w, h = g
            if _shape_solid(sh) is None:
                continue
            b = ratio_bucket(w / max(h, 0.001))
            pb[b] = pb.get(b, 0) + 1
            if is_narrow_bar(w, h):
                bars += 1
                offenders.append(dict(page=i + 1, l=round(l, 2), t=round(t, 2),
                                      w=round(w, 3), h=round(h, 3),
                                      fill=_shape_solid(sh)))
        page_buckets[i + 1] = pb
        page_bar_count[i + 1] = bars
    if vocab is None:
        vocab = {}
    ref_max = vocab.get('narrow_bar_max_per_page', 0)
    if ref_max <= 2:
        off = offenders
    else:
        off = []
        for pno, cnt in page_bar_count.items():
            if cnt > ref_max:
                off += [o for o in offenders if o['page'] == pno]
    return dict(page_buckets=page_buckets, offenders=offenders,
                page_bar_count=page_bar_count,
                ref_narrow_bar_max=ref_max,
                off_vocab=off)
