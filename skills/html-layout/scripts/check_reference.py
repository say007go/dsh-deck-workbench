"""Check that reference evidence was recorded before building. This checks evidence, not layout."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path


def filled(value):
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return bool(value) and all(filled(v) if not isinstance(v, dict) else bool(v) for v in value)
    if isinstance(value, dict):
        return bool(value)
    return False


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--choice', required=True, help='reference-choice.json recorded after viewing full-size pages')
    p.add_argument('--candidates', help='Optional candidates.json returned by find_reference.py')
    p.add_argument('--reference', help='Optional reference-library root used to verify page images exist')
    p.add_argument('--creative', action='store_true', help='User explicitly asked for creative/design exploration')
    a = p.parse_args()
    try:
        data = json.loads(Path(a.choice).read_text(encoding='utf-8-sig'))
    except Exception as exc:
        print(json.dumps({'ok': False, 'errors': [f'Cannot read {a.choice}: {exc}']}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    errors = []
    warnings = []
    selected = data.get('selected_pages')
    if not isinstance(selected, list) or not selected:
        errors.append('selected_pages must be a non-empty list of page numbers')
        selected = []
    pages = []
    for value in selected:
        if type(value) is not int or value < 1:
            errors.append(f'selected_pages contains a non-page number: {value!r}')
        else:
            pages.append(value)
    if a.candidates:
        try:
            candidate_data = json.loads(Path(a.candidates).read_text(encoding='utf-8-sig'))
            candidate_pages = {row.get('page') for row in candidate_data.get('candidates', [])}
            for page in pages:
                if page not in candidate_pages:
                    warnings.append(f'page {page} is not in candidates.json; confirm it came from a manual library-map lookup')
        except Exception as exc:
            errors.append(f'Cannot read candidates: {exc}')
    if a.reference:
        root = Path(a.reference)
        for page in pages:
            if not (root / 'assets' / 'pages' / f'{page:03d}.webp').is_file():
                errors.append(f'missing full-size reference image: assets/pages/{page:03d}.webp')
    for key in ('content_relationships', 'observations', 'borrow', 'reject'):
        if not filled(data.get(key)):
            errors.append(f'{key} must record concrete evidence, not a generic claim')
    if a.creative:
        alternatives = data.get('alternatives')
        if not isinstance(alternatives, list) or not alternatives:
            errors.append('creative request: record at least one genuinely different direction considered; no fixed count is required')
        else:
            for i, item in enumerate(alternatives):
                if not isinstance(item, dict) or not filled(item.get('direction')) or not filled(item.get('why_rejected')):
                    errors.append(f'alternatives[{i}] needs direction and why_rejected')
    if not data.get('design_intent'):
        warnings.append('design_intent is empty; state what the content needs before naming a structure')
    result = {'ok': not errors, 'errors': errors, 'warnings': warnings,
              'selected_pages': pages,
              'limits': 'Checks recorded evidence, page existence, and creative exploration only. It does not prescribe or validate any layout.'}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
