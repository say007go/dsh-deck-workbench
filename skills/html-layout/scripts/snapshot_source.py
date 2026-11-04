"""Copy an approved page file byte-for-byte to source.txt; never retype or normalize."""
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--page', required=True, help='Approved content/pages/Pxx.md')
    p.add_argument('--out', help='Write the exact bytes to this source.txt')
    p.add_argument('--verify', help='Compare this existing source.txt with the page file')
    p.add_argument('--force', action='store_true', help='Overwrite an existing output')
    a = p.parse_args()
    page = Path(a.page).resolve()
    data = page.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if a.verify:
        target = Path(a.verify).resolve()
        actual = target.read_bytes() if target.is_file() else b''
        ok = actual == data
        result = {'ok': ok, 'page': str(page), 'source': str(target), 'sha256': digest,
                  'source_sha256': hashlib.sha256(actual).hexdigest(), 'bytes': len(data)}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(0 if ok else 1)
    if not a.out:
        p.error('provide --out or --verify')
    target = Path(a.out).resolve()
    if target.exists() and not a.force:
        p.error(f'output exists: {target}; use --force only after confirming it is the right snapshot')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    print(json.dumps({'ok': True, 'page': str(page), 'source': str(target), 'bytes': len(data), 'sha256': digest},
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    main()
