# Agent guide — dsh-deck-workbench

This repository is a DSH host plugin with a hand-written browser client and three bundled layout skills.

## Read order

1. `README.md` — public overview, install, settings, usage, directory layout.
2. If `dev-docs/HANDOFF.md` exists locally, read it before editing. `dev-docs/` is development material: it is excluded by `.gitignore` and `.npmignore`, and is not part of the public package. If it is absent (public clone), rely on the README and source and ask the maintainer for missing decisions.
3. For design details, read `dev-docs/SPEC.md`; for equivalence and release checks, read `dev-docs/AUDIT.md`.

## Hard boundaries

- Never add a content skill, `reference.pptx`, `_reference/`, or generated page images to this repository or package.
- Keep the three bundled layout skills (`ppt-layout`, `html-layout`, `image-layout`) independent of the content skill name.
- Do not add local absolute paths. System tools are resolved through environment variables and `PATH`.
- Keep `content/pages/Pxx.md` as the content/layout contract.
- `npm pack` must not include `dev-docs/`, `_reference/`, `reference.pptx`, `page-content/`, or Python caches.

## Useful checks

```bash
node --check client/client.js
node --check lib/index.js
python skills/ppt-layout/assets/build-kit/selfcheck.py
python skills/html-layout/scripts/validate_library.py --reference <reference-root>
npm pack --dry-run --json
```

The project-level test harnesses are local development artifacts and are not shipped in this repository.
