"""Resolve the shared reference-library root for ppt-layout.

Order:
1. explicit --reference
2. DECK_REFERENCE_ROOT
3. ~/.dsh/storages/deck-workbench/reference.json ({"root": "..."})
4. the skill directory (legacy fallback)
"""
from __future__ import annotations

import json
import os
from pathlib import Path

CONFIG = Path.home() / '.dsh' / 'storages' / 'deck-workbench' / 'reference.json'


def candidates(explicit=None, fallback=None):
    if explicit:
        yield Path(explicit).expanduser()
    env = os.environ.get('DECK_REFERENCE_ROOT')
    if env:
        yield Path(env).expanduser()
    try:
        data = json.loads(CONFIG.read_text(encoding='utf-8'))
        root = data.get('root')
        if root:
            yield Path(root).expanduser()
    except Exception:
        pass
    if fallback:
        yield Path(fallback)


def resolve(explicit=None, required=('assets/reference.pptx',), fallback=None):
    for root in candidates(explicit, fallback):
        try:
            if all((root / rel).exists() for rel in required):
                return root
        except OSError:
            continue
    return None
