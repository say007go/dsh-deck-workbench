# -*- coding: utf-8 -*-
"""
audit —— 一条命令跑完出页复核链

    python audit.py --pptx <成品.pptx> [--forbid 词1,词2] [--outdir 复核目录]

依次完成：
    1. 包完整性   zip testzip / 条目数 / 体积
    2. 文本层审计  残留词、ASCII 直引号、U+FFFD、文本节点数
    3. 字号层级   跨页比较字号档位，找出某页偏小
    4. 导语净空   压线 / 重叠 / 纵向溢出（纯几何判定）
    5. 文本溢出   全文本框纵向溢出（正文框不再靠肉眼查）
    6. 渲染       pptx -> pdf（LibreOffice 无头）-> png（150dpi）
    7. 分区裁切   整页切 4 张放大图，供逐区目视
    8. 构件语汇   产出页的形状比例是否落在参考稿语汇内（窄色条越界即报）

用法约定：
    · forbidden 词表由调用方按本次内容依据传入，工具不内置任何项目词表。
    · 渲染失败会明确报错，不会静默产出空图。
"""
import argparse, io, os, re, sys, zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx_kit import (render_pdf, render_png, crop_regions, audit_text, pack_size,
                     type_scale_audit, print_type_scale,
                     lead_clearance_audit, print_lead_clearance,
                     text_overflow_audit, print_text_overflow,
                     probe_part_vocab, vocab_check)
from reference_root import resolve as resolve_reference

DEFAULT_FORBID = []      # 不内置；由调用方按本次内容依据传入


def main():
    ap = argparse.ArgumentParser(description='出页复核链')
    ap.add_argument('--pptx', required=True, help='成品 pptx 路径')
    ap.add_argument('--forbid', default='', help='逗号分隔的残留词表（可空）')
    ap.add_argument('--outdir', default='', help='复核产物目录，默认 <pptx 同级>_audit')
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--slide', type=int, default=1, help='只审第几页（默认 1）')
    ap.add_argument('--reference', default='',
                    help='参考稿 pptx 路径（用于构件语汇比对；默认取 skill 内置参考稿）')
    ap.add_argument('--all', action='store_true',
                    help='审整份 deck：逐页做文本审计、渲染与分区裁切')
    args = ap.parse_args()

    pptx = os.path.abspath(args.pptx)
    outdir = os.path.abspath(args.outdir) if args.outdir else \
        os.path.join(os.path.dirname(pptx), os.path.splitext(os.path.basename(pptx))[0] + '_audit')
    os.makedirs(outdir, exist_ok=True)
    forbid = [w.strip() for w in args.forbid.split(',') if w.strip()] or DEFAULT_FORBID

    print('>>> [1/8] 包完整性')
    entries, kb = pack_size(pptx)
    z = zipfile.ZipFile(pptx)
    zok = z.testzip() is None
    names = z.namelist()
    orphan = [n for n in names if 'embeddings' in n or n.startswith('ppt/media/')]
    print('    zip=%s | 条目=%d | 体积=%.0f KB | 嵌入/媒体=%s'
          % ('OK' if zok else 'BAD', entries, kb, orphan or '无'))

    # 要审哪些页：--all 审整份 deck，否则只审 --slide 指定页。
    # **页序必须取自 Presentation.slides 的真实顺序**，不能用 slideN.xml 里的 N：
    # 参考稿被裁剪后 slide part 的编号不连续（删到只剩 2 页时可能仍叫
    # slide2.xml / slide8.xml），按 N 取会审错页，渲染时更会 IndexError。
    from pptx import Presentation
    _prs = Presentation(pptx)
    order = [(i + 1, s.part) for i, s in enumerate(_prs.slides)]
    if args.all:
        targets = order
    else:
        idx = max(1, min(args.slide, len(order)))
        targets = [order[idx - 1]]

    bad = []
    if not zok:
        bad.append('zip 损坏')

    print('>>> [2/8] 文本层审计')
    for n, pn in targets:
        a = audit_text(pptx, forbid, slide_part=pn)
        print('    第%d页 残留词=%s | ASCII直引号=%s | U+FFFD=%d | 文本节点=%d | 字符=%d'
              % (n, a['forbidden'] or '无', '有!!' if a['ascii_quote'] else '无',
                 a['ufffd'], a['runs'], a['chars']))
        if a['forbidden']:
            bad.append('第%d页残留词 %s' % (n, a['forbidden']))
        if a['ascii_quote']:
            bad.append('第%d页 ASCII 直引号' % n)
        if a['ufffd']:
            bad.append('第%d页 U+FFFD %d' % (n, a['ufffd']))

    print('>>> [3/8] 字号层级一致性（跨页比较）')
    scale = type_scale_audit(pptx)
    print_type_scale(scale)
    if scale.get('issues'):
        bad.append('字号层级不一致: 第%s页偏小'
                   % '、'.join(str(i['page']) for i in scale['issues']))

    print('>>> [4/8] 导语净空（压线/重叠/纵向溢出）')
    lead = lead_clearance_audit(pptx)
    print_lead_clearance(lead)
    for it in lead.get('issues', []):
        bad.append('第%d页导语%s' % (it['page'], it['kind']))

    print('>>> [5/8] 文本框纵向溢出')
    ovf = text_overflow_audit(pptx)
    print_text_overflow(ovf)
    for it in ovf.get('issues', []):
        bad.append('第%d页文本框溢出(%.2f">%.2f")' % (it['page'], it['need_h'], it['box_h']))

    print('>>> [6/8] 渲染')
    pdf = render_pdf(pptx, outdir)
    png = os.path.join(outdir, 'audit.png')
    _, pages = render_png(pdf, png, dpi=args.dpi, page=targets[0][0] - 1)
    print('    %s (%d 页)' % (os.path.basename(png), pages))

    print('>>> [7/8] 分区裁切')
    for n, pn in targets:
        if len(targets) > 1:
            page_png = os.path.join(outdir, 'audit_p%d.png' % n)
            render_png(pdf, page_png, dpi=args.dpi, page=n - 1)
            sub = os.path.join(outdir, 'p%d' % n)
            os.makedirs(sub, exist_ok=True)
            files = crop_regions(page_png, sub, dpi=args.dpi)
            print('    第%d页 -> %s' % (n, page_png))
            for f in files:
                print('     ', f)
        else:
            for f in crop_regions(png, outdir, dpi=args.dpi):
                print('   ', f)
    print('>>> [8/8] 构件语汇一致性（形状比例是否落在参考稿语汇内）')
    # 参考稿解析：**三段优先级**，并全程记录来源（第 8 关的判据完全依赖
    # 这份稿，用错稿 = 用错判据，所以必须可追溯）。
    ref = os.path.abspath(args.reference) if args.reference else ''
    ref_src = '--reference 指定' if args.reference else ''
    if not ref:
        skill = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        root = resolve_reference(None, ('assets/reference.pptx',), skill)
        builtin = os.path.join(str(root), 'assets', 'reference.pptx') if root else ''
        if builtin and os.path.exists(builtin):
            ref = os.path.abspath(builtin)
            ref_src = '共享参考库'
    if not ref:
        # 本 skill 不一定自带参考稿。找不到时到成品同级目录找一份名字含
        # reference 的 pptx；多个候选全部列出，让人能核对用的是哪一份。
        base = os.path.dirname(pptx)
        cands = []
        for d in (base, os.path.dirname(base)):
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if fn.lower().endswith('.pptx') and 'reference' in fn.lower():
                    cands.append(os.path.join(d, fn))
        if cands:
            ref = os.path.abspath(cands[0])
            ref_src = '成品同级目录自动找到'
            if len(cands) > 1:
                print('    -- 同级目录有 %d 份候选参考稿，本次用：%s'
                      % (len(cands), os.path.basename(ref)))
                for c in cands[1:]:
                    print('       另有：%s' % os.path.basename(c))
    vocab_skipped = False
    if os.path.exists(ref):
        from pptx import Presentation as _Pres
        print('    参考稿（%s）：%s' % (ref_src, ref))
        try:
            _rp, _op = _Pres(ref), _Pres(pptx)
            if (_rp.slide_width != _op.slide_width
                    or _rp.slide_height != _op.slide_height):
                print('    !! 参考稿与产出页**页面尺寸不同**（%.2fx%.2f vs %.2fx%.2f）'
                      '—— 构件比例语汇的判据不成立，本次结果仅作参考'
                      % (_rp.slide_width / 914400.0, _rp.slide_height / 914400.0,
                         _op.slide_width / 914400.0, _op.slide_height / 914400.0))
        except Exception:
            pass
        vocab = probe_part_vocab(_Pres(ref))
        print('    参考稿构件语汇: %s' % ' | '.join(
            '%s=%d' % (k, v) for k, v in vocab['buckets'].items()))
        if vocab.get('sample_small'):
            print('    -- 语汇样本仅 %d 块（偏小）：判定会**偏严**（可能误伤参考稿'
                  '自己也在用的构件），仅作参考，不作硬拦截依据'
                  % vocab.get('total', 0))
        vc = vocab_check(pptx, vocab)
        print('    参考稿窄色条单页最多 %d 根 | 产出页各页 %s'
              % (vc['ref_narrow_bar_max'],
                 ' '.join('p%d=%d' % (k, v) for k, v in sorted(vc['page_bar_count'].items()))))
        for o in vc['off_vocab']:
            print('    !! 第%d页 语汇外构件: 窄色条 %sx%s" @(%s,%s) 色=%s'
                  % (o['page'], o['w'], o['h'], o['l'], o['t'], o['fill']))
        if vc['off_vocab']:
            print('    构件语汇越界 %d 处 !!' % len(vc['off_vocab']))
            for o in vc['off_vocab']:
                bad.append('第%d页语汇外构件(窄色条)' % o['page'])
        else:
            print('    构件语汇一致 ✓')
    else:
        vocab_skipped = True
        print('    !! 未找到参考稿 —— 构件语汇关卡**未执行**')
        print('       后果：检测不出「参考稿里没有的构件」（如卡片旁的小竖条）。')
        print('       请用 --reference <参考稿.pptx> 指定本次出页所依据的参考稿。')

    if not bad and vocab_skipped:
        print('\n结论: 全部通过（**构件语汇关卡未执行** —— 未提供参考稿）')
    else:
        print('\n结论: %s' % ('全部通过' if not bad else '需处理 -> ' + '；'.join(bad)))
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
