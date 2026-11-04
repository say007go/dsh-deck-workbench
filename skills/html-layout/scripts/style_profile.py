"""Print visual style tokens from <reference>/style.json. Tokens only; never a layout template."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
from reference_root import resolve as resolve_reference

DEFAULT = {
    'schemaVersion': 1,
    'name': 'fallback house tokens',
    'canvas': {'width': 1920, 'height': 1080, 'aspect': '16:9'},
    'palette': {
        'background': '#FFFFFF', 'ink': '#161616', 'body': '#242424', 'muted': '#8C8C8C',
        'accent': '#AD0101', 'accent2': '#C00000', 'tint': '#FBF3F3', 'line': '#E4E4E4',
    },
    'fonts': {
        'family': 'MiSans, Microsoft YaHei, Noto Sans SC',
        'heading': 'MiSans Demibold, MiSans Semibold, MiSans, Microsoft YaHei',
        'body': 'MiSans, Microsoft YaHei, Noto Sans SC',
    },
    'type_scale': {'title': 46, 'lead': 24, 'body': 24, 'table_body': 22, 'label': 16, 'source': 15},
    'density': 'high',
    'imagery': 'none-unless-requested',
    'bullet': {'char': 'square', 'color': '#AD0101'},
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', help='Shared reference-library root; defaults to DECK_REFERENCE_ROOT or the plugin config')
    parser.add_argument('--css', action='store_true', help='Print CSS custom properties instead of JSON')
    args = parser.parse_args()
    root = resolve_reference(args.reference, ('assets/pages',))
    if root is None:
        print('未找到参考库：请设置 DECK_REFERENCE_ROOT、reference.json，或传 --reference <dir>', file=sys.stderr)
        raise SystemExit(2)
    style = DEFAULT
    used_default = True
    path = root / 'style.json'
    if path.is_file():
        try:
            style = json.loads(path.read_text(encoding='utf-8-sig'))
            used_default = False
        except Exception as exc:
            print(f'style.json 无法读取，使用回退 tokens：{exc}', file=sys.stderr)
    if args.css:
        palette = style.get('palette', {})
        for key, value in palette.items():
            print(f'--slide-{key}: {value};')
        for key, value in style.get('type_scale', {}).items():
            print(f'--slide-{key.replace("_", "-")}: {value}px;')
    else:
        print(json.dumps({'style': style, 'source': str(path), 'used_default': used_default, 'limits': 'Tokens only; no columns, coordinates, or layout prescription.'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
