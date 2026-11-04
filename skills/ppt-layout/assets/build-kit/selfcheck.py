# -*- coding: utf-8 -*-
"""
selfcheck —— 技能包完整性自检

    python assets/build-kit/selfcheck.py [--reference <参考稿.pptx>]

改完 build-kit 之后先跑这个，再跑业务脚本。它检查的是**工程完整性**，
不检查页面好不好看（那是 audit.py + 目视的职责）。

检查项：
    1. 语法      全部 .py 能被 ast.parse 解析（补丁写坏源码是真实发生过的事）
    2. 导入      全部 .py 能真正 import（转义残留会让函数被吞进 docstring）
    3. 文件闭合  SKILL.md / README.md 里提到的文件都真实存在
    4. 文档-实现  SKILL.md 里提到的工具函数都真实存在
    5. 探测链路  打开参考稿 → 探测调色板/标题/导语/字阶/构件语汇，能跑通
    6. 常量口径  关键常量与探测口径的一致性（如标题字号回退规则）

退出码：0 = 全过；1 = 有失败项。
"""
import argparse, ast, io, os, re, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(os.path.dirname(HERE))
KIT = HERE

# Bundled skill: local reference files may intentionally be absent. The shared
# reference library is a valid target for file-closure checks.
if KIT not in sys.path:
    sys.path.insert(0, KIT)
try:
    from reference_root import resolve as _resolve_reference
    SHARED_REFERENCE = _resolve_reference(
        None,
        ('assets/reference.pptx', 'references/page-signature.jsonl'),
        SKILL,
    )
except Exception:
    SHARED_REFERENCE = None


def _exists_or_shared(rel):
    if os.path.exists(os.path.join(SKILL, rel)):
        return True
    if SHARED_REFERENCE:
        shared = os.path.join(str(SHARED_REFERENCE), *rel.split('/'))
        return os.path.exists(shared)
    return False

from reference_root import resolve as resolve_reference

fails = []
warns = []


def ok(msg):
    print('  OK   %s' % msg)


def bad(msg):
    fails.append(msg)
    print('  !!   %s' % msg)


def warn(msg):
    warns.append(msg)
    print('  --   %s' % msg)


def py_files():
    out = []
    for d, _, fs in os.walk(SKILL):
        for f in fs:
            if f.endswith('.py'):
                out.append(os.path.join(d, f))
    return sorted(out)


def check_syntax():
    print('>>> [1/7] 语法')
    for p in py_files():
        rel = os.path.relpath(p, SKILL).replace('\\', '/')
        try:
            ast.parse(io.open(p, encoding='utf-8').read())
            ok(rel)
        except SyntaxError as e:
            bad('%s 语法错误：%s (line %s)' % (rel, e.msg, e.lineno))


def check_import():
    print('>>> [2/7] 导入')
    for p in py_files():
        rel = os.path.relpath(p, SKILL).replace('\\', '/')
        if os.path.basename(p) == 'selfcheck.py':
            ok(rel + '（自检脚本自身跳过）')
            continue
        r = subprocess_run([sys.executable, p, '--help'])
        if r is None:
            bad('%s 无法运行' % rel)
        else:
            ok(rel)


def subprocess_run(cmd):
    import subprocess
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=60)
        return p.returncode
    except Exception as e:
        print('       %s' % e)
        return None


def check_files():
    print('>>> [3/7] 文件闭合')
    docs = [os.path.join(SKILL, 'SKILL.md'), os.path.join(SKILL, 'README.md')]
    for d in docs:
        if not os.path.exists(d):
            continue
        s = io.open(d, encoding='utf-8').read()
        # 提取 markdown 链接与反引号里的相对路径
        cands = set(re.findall(r'\]\(([^)#][^)]*)\)', s))
        cands |= set(re.findall(r'`((?:assets|references)/[A-Za-z0-9_./\-]+)`', s))
        for c in sorted(cands):
            if c.startswith(('http', '#')) or '*' in c:
                continue
            tgt = os.path.join(SKILL, c)
            if not _exists_or_shared(c):
                bad('%s 引用了不存在的文件：%s' % (os.path.basename(d), c))
    # (2) **实现**里的硬引用：os.path.join(SKILL, 'a', 'b') 必须真实存在。
    #     文档写对了、代码却指向不存在的文件 = 运行时才炸的悬空引用。
    #     本文件自身跳过：它的正则示例里就写着 os.path.join(SKILL, 'a', 'b')。
    me = os.path.abspath(__file__)
    for py in py_files():
        if os.path.abspath(py) == me:
            continue
        s = io.open(py, encoding='utf-8').read()
        for m in re.finditer(r"os\.path\.join\(SKILL,([^)]*)\)", s):
            parts = re.findall(r"'([^']+)'", m.group(1))
            if not parts:
                continue
            rel = os.path.join(*parts)
            if not _exists_or_shared(rel):
                bad('%s 引用了不存在的文件：%s' % (os.path.basename(py), rel))
    # (2b) 资产清单（asset-manifest.json）里的相对路径
    for meta in ('asset-manifest.json',):
        mp = os.path.join(SKILL, meta)
        if not os.path.exists(mp):
            continue
        ms = io.open(mp, encoding='utf-8').read()
        for rel in set(re.findall(r'["\']?\.?/?((?:assets|references)/[A-Za-z0-9_./\-]+)',
                                  ms)):
            if not _exists_or_shared(rel):
                bad('%s 引用了不存在的文件：%s' % (meta, rel))

    # (3) 孤儿资产：assets/ 与 references/ 下的文件，在**整个 skill 的文本**
    #     （md / py / json / yaml）里都没被提到 —— 索引里列着但路由无指向，
    #     等于不存在。
    corpus = ''
    for r, _, fs in os.walk(SKILL):
        if any(part in ('.git', '__pycache__') for part in r.split(os.sep)):
            continue
        for fn in fs:
            if not fn.lower().endswith(('.md', '.py', '.json', '.yaml', '.yml', '.txt')):
                continue
            try:
                corpus += io.open(os.path.join(r, fn), encoding='utf-8').read()
            except Exception:
                pass
    for sub in ('assets', 'references'):
        root_dir = os.path.join(SKILL, sub)
        if not os.path.isdir(root_dir):
            continue
        for r, _, fs in os.walk(root_dir):
            if '__pycache__' in r.split(os.sep):
                continue
            for fn in fs:
                if fn.startswith('.') or fn.endswith('.pyc'):
                    continue
                rel = os.path.relpath(os.path.join(r, fn), SKILL).replace('\\', '/')
                if rel in corpus or fn in corpus:
                    continue
                warn('孤儿资产 %s —— 整个 skill 里没有任何地方引用它' % rel)
    ok('文件引用检查完成')


def check_api():
    print('>>> [4/7] 文档-实现闭合')
    sk = os.path.join(SKILL, 'SKILL.md')
    if not os.path.exists(sk):
        return
    s = io.open(sk, encoding='utf-8').read()
    names = set(re.findall(r'`([a-z_][a-z0-9_]*)\(\)`', s))
    names |= set(re.findall(r'`([a-z_][a-z0-9_]*)\(', s))
    src = io.open(os.path.join(KIT, 'pptx_kit.py'), encoding='utf-8').read()
    tree = ast.parse(src)
    defined = set()
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.ClassDef)):
            defined.add(n.name)
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    defined.add(t.id)
    for nm in sorted(names):
        if nm in defined:
            continue
        # 允许是工具脚本的参数名或外部命令
        if nm in ('python', 'print', 'open', 'len', 'int', 'str'):
            continue
        if os.path.exists(os.path.join(KIT, nm + '.py')):
            continue
        warn('SKILL.md 提到 %s()，但 pptx_kit.py 里没有同名定义' % nm)
    ok('API 闭合检查完成')


def check_probe(ref):
    print('>>> [5/7] 探测链路')
    if not ref or not os.path.exists(ref):
        warn('未提供参考稿，跳过（本技能可能不自带参考稿）')
        return
    sys.path.insert(0, KIT)
    try:
        from pptx_kit import (open_reference, load_palette, probe_title_spec,
                             probe_lead_spec, probe_type_scale, probe_part_vocab,
                             LAYOUT, PAGE_BOUNDS, PALETTE, METRIC_FONT)
    except Exception as e:
        bad('pptx_kit 导入失败：%s' % e)
        return
    try:
        prs, slide = open_reference(ref, keep=None)
    except Exception as e:
        bad('打开参考稿失败：%s' % e)
        return
    load_palette(prs)
    ok('调色板：accent=%s font=%s' % (PALETTE.get('accent'), PALETTE.get('font')))
    ts = probe_title_spec(slide)
    if ts:
        ok('标题：size_lead=%s size_sub=%s has_sub=%s'
           % (ts['size_lead'], ts['size_sub'], ts.get('has_sub')))
        # 口径检查：单段标题时 size_sub 不应是「另一个默认档」
        if ts.get('has_sub') is False and ts['size_sub'] not in (None, ts['size_lead']):
            bad('标题口径异常：has_sub=False 但 size_sub=%s != size_lead=%s'
                % (ts['size_sub'], ts['size_lead']))
    else:
        warn('未探测到标题')
    ls = probe_lead_spec(slide)
    ok('导语：T=%s H=%s size=%s' % (ls.get('top'), ls.get('height'), ls.get('size')) if ls else '未探测到导语')
    sc = probe_type_scale(slide)
    ok('字阶：title=%s body=%s label=%s' % (sc.get('title'), sc.get('body'), sc.get('label')) if sc else '未探测到字阶')
    # 构件语汇是**全稿**统计量：必须对完整参考稿跑。裁剪后的单页样本不足，
    # 会得到空语汇（实测 0 档），从而让第 7 关形同虚设。
    try:
        from pptx import Presentation as _Pres
        vc = probe_part_vocab(_Pres(ref))
        ok('构件语汇（完整稿 %d 块）：%s' % (vc.get('total', 0),
           ' | '.join('%s=%d' % (k, n) for k, n in vc.get('buckets', {}).items())))
        if vc.get('sample_small'):
            warn('构件语汇样本偏小（%d 块），语汇判定不可靠' % vc.get('total', 0))
    except Exception as e:
        bad('构件语汇探测失败：%s' % e)
    if not LAYOUT:
        warn('LAYOUT 为空 —— open_reference() 未装载骨架规格')
    else:
        ok('LAYOUT 已装载：%s' % ', '.join(sorted(LAYOUT.keys())))
    ok('PAGE_BOUNDS：%.3f ~ %.3f（左缘取对齐线众数，**单页样本不稳**，多页参考稿才准）' % (PAGE_BOUNDS['l'], PAGE_BOUNDS['r']))
    ok('度量字体：%s' % METRIC_FONT.get('name'))


def check_constants():
    print('>>> [6/7] 常量口径')
    sys.path.insert(0, KIT)
    import pptx_kit as K
    # 关键探测项不应有「整组回退」式的硬编码
    src = io.open(os.path.join(KIT, 'pptx_kit.py'), encoding='utf-8').read()
    # 注释里会引用旧写法举例，必须先剥离注释行再判定
    code_only = '\n'.join(l for l in src.splitlines()
                           if not l.lstrip().startswith('#'))
    if 'len(sizes) < 2' in code_only:
        bad('pptx_kit 里仍有「len(sizes) < 2 就整组回退默认字号」的旧逻辑')
    else:
        ok('标题字号回退口径正确（只有探测不到才兜底）')
    if 'DEFAULT_TITLE_SIZES' in src:
        ok('DEFAULT_TITLE_SIZES 保留为最后兜底')
    for name in ('PALETTE', 'BULLET_STYLE', 'LAYOUT', 'PAGE_BOUNDS', 'METRIC_FONT'):
        if not hasattr(K, name):
            bad('缺少模块级容器 %s' % name)
    ok('模块级容器齐备')



def check_gate():
    """第 7 项：溢出门禁**自己**是否有效。

    一个只会说「没发现问题」的门禁等于没有门禁。这里造 5 个已知形态的
    文本框，验证判据同时满足：
      · 真实多行溢出 -> 必须报；
      · **轻度溢出（17%）** -> 必须报（旧口径会漏，锁死灵敏度）；
      · 装得下的框   -> 不能报；
      · 参考稿原样的单行标题（0.456" 框配 28pt 文字）-> 不能报。
    判据一旦被改坏（例如把「多行」条件去掉导致母稿误报，或把容差调回
    宽松口径导致轻度溢出漏报），本项立刻失败。
    """
    print('>>> [7/7] 门禁有效性自证')
    sys.path.insert(0, KIT)
    import tempfile
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.enum.text import MSO_AUTO_SIZE
    from pptx_kit import text_overflow_audit

    LONG = '这是一段用于验证纵向溢出判据的正文内容，长度足以在给定框宽内折成两行显示。'

    def mkbox(sl, name, w, h, runs):
        tb = sl.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(w), Inches(h))
        tb.name = name
        tf = tb.text_frame
        tf.word_wrap = True
        tf.auto_size = MSO_AUTO_SIZE.NONE      # 关掉自动适应，否则框会自己长高
        p = tf.paragraphs[0]
        for text, size, bold in runs:
            r = p.add_run()
            r.text = text
            r.font.size = Pt(size)
            r.font.bold = bold

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    mkbox(sl, 'BAD_两行塞进小框', 3.0, 0.30, [(LONG, 14, False)])
    mkbox(sl, 'BAD_窄框标题折行', 1.2, 0.35, [('纵向溢出验证标题', 18, True)])
    # **轻度溢出**：14pt 两行放进 0.50" 的框 → 可用高 0.40"，真实需高
    # 2×14×1.20/72 = 0.467"，即溢出 **17%**。旧口径（估算 1.15 + 框高×1.12
    # 容差）判为不报，等效真实溢出 34% 以下全不报——真实裁字恰恰在这个
    # 区间，末行被切一半。这条用例是门禁灵敏度的锁：谁把容差调回宽松
    # 口径，自检立刻失败。
    MID = '这是一段用于验证轻度溢出的正文，两行即可容纳。'
    mkbox(sl, 'BAD_轻度溢出17%', 3.0, 0.50, [(MID, 14, False)])
    mkbox(sl, 'GOOD_装得下的框', 3.0, 0.85, [(LONG, 14, False)])
    mkbox(sl, 'GOOD_母稿式单行标题', 12.726, 0.456,
          [('需求理解：', 28, True),
           ('不是管理知识不足，而是从业务骨干到团队负责人的角色转换尚未完成', 20, False)])
    tmp = os.path.join(tempfile.gettempdir(), 'wb_gate_probe.pptx')
    prs.save(tmp)
    try:
        res = text_overflow_audit(tmp)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass
    names = [it['name'] for it in res.get('issues', [])]
    expect_bad = ['BAD_两行塞进小框', 'BAD_窄框标题折行', 'BAD_轻度溢出17%']
    expect_good = ['GOOD_装得下的框', 'GOOD_母稿式单行标题']
    missed = [n for n in expect_bad if n not in names]
    falsep = [n for n in expect_good if n in names]
    if missed:
        bad('溢出门禁漏报真溢出：%s' % '、'.join(missed))
    if falsep:
        bad('溢出门禁误报：%s' % '、'.join(falsep))
    if not missed and not falsep:
        ok('溢出门禁有效（3 真溢出全报含轻度 / 2 好例不报，已检 %d 框）' % res.get('checked', 0))


def main():
    ap = argparse.ArgumentParser(description='技能包完整性自检')
    ap.add_argument('--reference', default='', help='参考稿路径（用于探测链路检查）')
    args = ap.parse_args()

    ref = args.reference
    if not ref:
        # 参考稿是**可选资产**：优先共享参考库，找不到时回退技能内副本。
        root = resolve_reference(None, ('assets/reference.pptx',), SKILL)
        cand = os.path.join(str(root), 'assets', 'reference.pptx') if root else ''
        if cand and os.path.exists(cand):
            ref = cand

    print('技能目录：%s\n' % SKILL)
    check_syntax()
    check_import()
    check_files()
    check_api()
    check_probe(ref)
    check_constants()
    check_gate()

    print()
    if fails:
        print('结论：%d 项失败' % len(fails))
        for f in fails:
            print('  - %s' % f)
        return 1
    print('结论：全部通过%s' % ('（%d 项提示）' % len(warns) if warns else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
