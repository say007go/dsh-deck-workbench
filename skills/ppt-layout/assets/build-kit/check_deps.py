# -*- coding: utf-8 -*-
"""依赖体检：一条命令看清「这套工具需要什么、缺了会怎样」。

    python check_deps.py

设计原则：
  · **只报告，不安装**——装包是使用者的决定，且会污染环境；
  · 区分**必需**与**可选**：可选缺失只影响某个功能，不影响出片；
  · 缺依赖时给出**具体修法**（装什么 / 设什么环境变量），不是一句"ModuleNotFoundError"。
"""
from __future__ import print_function
import ast
import io
import os
import re
import sys

KIT = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(os.path.dirname(KIT))

from reference_root import resolve as resolve_reference

# 写死的本机路径：盘符开头的 Windows 路径，或 Program Files 目录。
# 负向断言的作用：
#   (?<![A-Za-z0-9_/])  排除 URL 里的 "p://"（http/https/file 都不会命中）
#                       同时排除 file:/// 盘符路径这种**推荐用法**
#   [\\/]                盘符后必须跟反斜杠或正斜杠，单独的盘符单词不算
# 排除集里不含空格：路径本身可以含空格，
# 截断反而看不清指向哪里；以引号/逗号/括号等自然终止。
_WIN_PATH_RE = re.compile(r'(?<![A-Za-z0-9_/])[A-Za-z]:[\\/][^"\'`,;)\]}]*')
_PROG_RE = re.compile(r'(?<![A-Za-z0-9_/])Program Files[\\/][^"\'`,;)\]}]*')


def _iter_paths(text):
    """文本里所有写死的本机路径片段。"""
    out = []
    for line in text.splitlines():          # 逐行：否定字符类会吃掉换行
        for rx in (_WIN_PATH_RE, _PROG_RE):
            for m in rx.finditer(line):
                s = m.group(0).rstrip('.,;:')
                if s and s not in out:
                    out.append(s)
    return out


def _docstring_nodes(tree):
    """模块/类/函数的 docstring 节点 id —— 这些是**解释性文字**，不是可执行路径。

    例如 pptx_kit 里写着「不写死 `C:\\Windows\\Fonts`」，那是反例说明，
    不是真的在用这个路径，不该报警。
    """
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                             ast.AsyncFunctionDef)):
            body = getattr(node, 'body', None)
            if body and isinstance(body[0], ast.Expr) \
                    and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                out.add(id(body[0].value))
    return out


def _scan_py(path, rel):
    try:
        src = io.open(path, encoding='utf-8').read()
        tree = ast.parse(src)
    except Exception:
        return []
    docs = _docstring_nodes(tree)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) in docs:
                continue
            for s in _iter_paths(node.value):
                out.append((rel, node.lineno, s))
    return out


def _scan_md(path, rel):
    """Markdown 只检查**代码围栏内**的内容。

    围栏内的命令/示例是会被照抄执行的 → 写死路径必须报；
    围栏外的散文是在**讲**这件事（例如坑表里举反例）→ 不该报警。
    """
    try:
        lines = io.open(path, encoding='utf-8').read().splitlines()
    except Exception:
        return []
    out = []
    in_fence = False
    for i, ln in enumerate(lines, 1):
        if ln.strip().startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            for s in _iter_paths(ln):
                out.append((rel, i, s))
    return out


def scan_hardcoded_paths(root):
    """扫描整个技能包里写死的本机路径。返回 [(相对路径, 行号, 片段)]。"""
    hits = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('__pycache__', '.git')]
        for fn in sorted(filenames):
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root).replace('\\', '/')
            if fn.endswith('.py'):
                hits += _scan_py(p, rel)
            elif fn.endswith('.md'):
                hits += _scan_md(p, rel)
    return hits


def _ok(msg):
    print('  [OK]   %s' % msg)


def _miss(msg, fix):
    print('  [缺失] %s' % msg)
    print('         → %s' % fix)


def _opt(msg, note):
    print('  [可选] %s' % msg)
    print('         → %s' % note)


def main():
    print('=' * 70)
    print('依赖体检：%s' % SKILL)
    print('=' * 70)

    # ---- 解释器 ----
    print('\n【解释器】')
    if sys.version_info < (3, 7):
        _miss('Python %s 过旧' % sys.version.split()[0],
              '需要 Python 3.7+（推荐 3.10+）')
    else:
        _ok('Python %s（%s）' % (sys.version.split()[0], sys.executable))

    # ---- 第三方包 ----
    print('\n【Python 包】')
    for mod, pkg, why, fix in (
            ('pptx', 'python-pptx', '读写 pptx（全部出页与审计都靠它）',
             'pip install python-pptx'),
            ('lxml', 'lxml', '解析/改写 pptx 内部 XML',
             'pip install lxml（python-pptx 会自动带上）'),
            ('PIL', 'Pillow', '字体度量（算文字宽度、折行、溢出）',
             'pip install Pillow'),
            ('pymupdf', 'pymupdf', 'PDF→PNG 渲染与分区裁切（审计第 6、7 关）',
             'pip install pymupdf'),
    ):
        try:
            m = __import__(mod)
            ver = getattr(m, '__version__', '')
            _ok('%s%s — %s' % (pkg, (' ' + str(ver)) if ver else '', why))
        except Exception:
            _miss('%s — %s' % (pkg, why), fix)
    try:
        import numpy  # noqa: F401
        _ok('numpy — 仅 `measure_text_bands()` 像素字带测量需要')
    except Exception:
        _opt('numpy — 仅 `measure_text_bands()` 像素字带测量需要',
             'pip install numpy（不装则该函数不可用，其余不受影响）')

    # ---- LibreOffice ----
    print('\n【外部程序】')
    sys.path.insert(0, KIT)
    try:
        from pptx_kit import SOFFICE
    except Exception as e:
        SOFFICE = ''
        print('  [跳过] 无法导入 pptx_kit（%s）' % e)
    if SOFFICE and os.path.exists(SOFFICE):
        _ok('LibreOffice — %s（pptx→pdf，审计第 6 关）' % SOFFICE)
    else:
        _miss('LibreOffice（soffice）— pptx→pdf，审计第 6 关无法执行',
              '安装 LibreOffice，或设环境变量 PPT_SOFFICE 指向 soffice 可执行文件'
              '（当前解析到：%s）' % (SOFFICE or '未解析到'))

    # ---- 字体 ----
    print('\n【字体】')
    font_dirs = []
    cjk = None
    try:
        from pptx_kit import _FONT_DIRS, _pick_cjk_font, _resolve_font_file
        font_dirs = list(_FONT_DIRS)
        cjk = _pick_cjk_font()
    except Exception as e:
        print('  [跳过] 无法导入 pptx_kit（%s）' % e)
    if font_dirs:
        _ok('字体目录 %d 个：%s' % (len(font_dirs), ' ｜ '.join(font_dirs[:3])))
    else:
        _miss('未探测到任何字体目录',
              '装系统中文字体，或设环境变量 PPT_FONT_DIR 指向字体目录')
    if cjk:
        _ok('度量字体可用：%s' % cjk)
    else:
        _miss('找不到可用的中文字体（度量宽度会失败）',
              '装微软雅黑 / 思源黑体 / Noto CJK 之一，或设 PPT_FONT_DIR')
    # 参考稿自己的字体：能定位到就用，定位不到会回落并告警
    try:
        from pptx_kit import METRIC_FONT
        p = _resolve_font_file(METRIC_FONT.get('name'), False)
        if p:
            _ok('参考稿度量字体：%s' % p)
        else:
            _opt('参考稿字体 %r 无对应文件' % METRIC_FONT.get('name'),
                 '会回落本机中文字体度量，宽度可能偏差（换行点对不上）')
    except Exception:
        pass

    # ---- 参考稿 ----
    print('\n【参考稿】')
    # 参考稿是**可选资产**：优先解析共享参考库，找不到时回退技能内副本。
    root = resolve_reference(None, ('assets/reference.pptx',), SKILL)
    ref = os.path.join(str(root), 'assets', 'reference.pptx') if root else ''
    if ref and os.path.exists(ref):
        _ok('参考稿：%s' % ref)
    else:
        _ok('本技能不带参考稿（按设计）— 用用户提供的参考稿出页')

    # ---- 可移植性自检 ----
    print('\n【可移植性】')
    hits = scan_hardcoded_paths(SKILL)
    if hits:
        _miss('包内有 %d 处写死的本机路径（换台机器会失效）' % len(hits),
              '改成「先探测再调用」：环境变量 → 各平台常见目录 → PATH。'
              '每处下面列出了文件与行号')
        for f, ln, txt in hits:
            print('         → %s:%d  %s' % (f, ln, txt))
    else:
        _ok('无写死的本机路径（LibreOffice／字体目录均为先探测再调用）')

    print('\n结论：以上缺失项按提示处理即可；未列出的都是 Python 标准库。')


if __name__ == '__main__':
    main()
