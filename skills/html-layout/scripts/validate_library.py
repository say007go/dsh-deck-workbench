"""Verify the installed slim reference package without changing it."""
import argparse, hashlib, json, sys
from pathlib import Path
from PIL import Image, ImageStat
from reference_root import resolve as resolve_reference


def validate(root):
    errors = []
    manifest = json.loads((root / 'references/library-manifest.json').read_text(encoding='utf-8'))
    rows = [json.loads(x) for x in (root / 'references/index.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
    corpus = [json.loads(x) for x in (root / 'references/corpus.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
    expected = set(range(1, manifest['page_count'] + 1))
    for name, data in [('index', rows), ('corpus', corpus)]:
        if len(data) != len(expected) or {r['page'] for r in data} != expected:
            errors.append(name + ' has missing or duplicate pages')

    pptx = root / 'assets/reference.pptx'
    digest = hashlib.sha256(pptx.read_bytes()).hexdigest() if pptx.is_file() else None
    if digest and digest != manifest['source_sha256']:
        errors.append('Original reference hash mismatch')

    for row in rows:
        n = row['page']
        detail = root / 'references/pages' / f'{n:03d}.json'
        if not detail.is_file():
            errors.append(f'Missing detail {n}')
        else:
            rec = json.loads(detail.read_text(encoding='utf-8'))
            if rec['page'] != n or rec.get('layout_note') != row.get('layout_note'):
                errors.append(f'Detail/index inconsistency {n}')
        if not row.get('layout_note') or row.get('annotation_basis') != 'agent_visual_contact_sheet_review':
            errors.append(f'Unreviewed layout {n}')
        checks = [('image', (1920, 1080), True)]
        if row.get('thumbnail') and (root / row['thumbnail']).is_file():
            checks.append(('thumbnail', (640, 360), False))
        for key, size, required in checks:
            path = root / row[key]
            if not path.is_file():
                if required:
                    errors.append(f'Missing {key} {n}')
                continue
            if path.suffix.lower() != '.webp':
                errors.append(f'Unexpected {key} encoding {n}: {path.suffix}')
            with Image.open(path) as im:
                if im.size != size:
                    errors.append(f'Wrong {key} dimensions {n}')
                if max(ImageStat.Stat(im.convert('RGB')).stddev) < 3:
                    errors.append(f'Blank {key} {n}')

    contact_dir = root / 'assets/contacts'
    contact_width = manifest.get('asset_encoding', {}).get('contact_sheets', {}).get('width')
    if contact_dir.is_dir():
        for ref in sorted({row['contact_sheet'] for row in rows if row.get('contact_sheet')}):
            path = root / ref
            if not path.is_file():
                errors.append(f'Missing contact sheet {ref}')
                continue
            if path.suffix.lower() != '.webp':
                errors.append(f'Unexpected contact sheet encoding: {path.suffix}')
            if contact_width:
                with Image.open(path) as im:
                    if im.width != contact_width:
                        errors.append(f'Wrong contact sheet width: {ref}')

        if len(list(contact_dir.glob('*.webp'))) != manifest['contact_sheet_count']:
            errors.append('Contact sheet count mismatch')
    if manifest.get('asset_encoding', {}).get('format') != 'webp':
        errors.append('Slim pack asset_encoding is not webp')

    return {
        'ok': not errors, 'errors': errors, 'pages': len(rows),
        'source_sha256': digest, 'pptx_bundled': bool(digest),
        'full_page_images': len(list((root / 'assets/pages').glob('*.webp'))),
        'contact_sheets': manifest['contact_sheet_count'],
        'primary_families': len(manifest['primary_family_counts']),
        'scope': 'File integrity, annotation coverage, slim-pack encoding and raster sanity; '
                 'not full-size typography QA of all source pages.',
    }


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', help='Shared reference-library root; defaults to DECK_REFERENCE_ROOT or the plugin config')
    args = parser.parse_args()
    root = resolve_reference(args.reference, ('references/library-manifest.json', 'assets/pages'))
    if root is None:
        print('未找到参考库：请设置 DECK_REFERENCE_ROOT、reference.json，或传 --reference <dir>', file=sys.stderr)
        raise SystemExit(2)
    report = validate(root)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['ok'] else 1)
