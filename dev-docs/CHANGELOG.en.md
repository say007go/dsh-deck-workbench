# Changelog

> English release notes for 0.1.52 onward. The Chinese changelog in [CHANGELOG.md](CHANGELOG.md) is the
> primary record and also carries the detailed 0.1.30–0.1.51 history; the appendix below is a summary.
> The version number lives in `package.json`, the top of `README.md`, and the top of `HANDOFF.md` — bump all three together.

## 0.1.57 — 2026-11-07

Tests for the reference-library rollback paths, plus a fix for a destructive rename bug.

### Fixed

- Renaming a library to the name it already had pushed it to `name-2` and moved the folder. The uniqueness check counted the library's own directory as taken. Target paths now exclude the library's own root, so renaming to the current name is a no-op (`lib/references.js`).

### Tests

- `test/reference-guards.test.js`, 12 cases: a failed pointer write rolls `activeId` back; a failed rename moves the directory back to its old name; deletion refuses the active library, the references root itself, a library outside the root, and an unknown id; rename refuses libraries outside the root, no-ops on the current name, and appends a suffix on collision without touching the existing directory; `ensureRegistry` clears a stale pointer, promotes the first library when there is no active id, and registers an out-of-root library as legacy without moving it; `libraryStatus` treats a missing index as unusable and trusts the manifest page count; the library list puts the active one first; `sanitizeLibraryName` handles `.`, truncation and trailing dots.
- Test count 40 → 52.

## 0.1.56 — 2026-11-07

Unit tests for the client's pure functions. Still no build step.

### Maintainability

- `client/client.js` now exposes `exports.__internals` — `endpoint`, `fileUrl`, `formatTime`, `statusText`, `statusColor`, `diffLines` and the three `build*Prompt` helpers — for `node --test`. The host only reads `apply` and `inject`.
- `test/client.test.js` loads the client as a plain script through `vm` with a minimal React stub; 14 cases cover URL joining and escaping, time and status text, diff additions/deletions and the large-input fallback, artifact paths and skill names for all three targets, `custom` policy honouring only its own note, unknown policies falling back to the default preset, content-skill substitution and the missing-skill warning, plus builtin mode and the content requirement.
- Test count 26 → 40.

## 0.1.55 — 2026-11-07

Interface styles folded into tokens, without introducing a build step.

### Interface

- 41 `fontSize` literals and 30 raw colour values in `client/client.js` replaced with `TYPE.*` and named colour roles; a grep for raw values now returns nothing.
- Colour roles completed: `DANGER`, `SUCCESS`, `WARN`, `INFO`, `ON_ACCENT`, `CANVAS`, `TOAST_BG`, `GRADIENT`. The `done` state colour `#2e7d32` merged into `SUCCESS #2f8f5b` to match DESIGN.md.
- `TYPE` gained `small 12`, `hero 15` and `title 16`, so the main interface no longer uses sizes outside the scale.
- DESIGN.md expanded from "settings dialog spec" to "interface design spec" and now covers the workbench itself, with a note on the zero-raw-value check.

## 0.1.54 — 2026-11-07

Disk reads now match how often a human actually looks at the screen.

### Performance

- Page metadata is cached by `mtimeMs + size`; the list and detail views no longer re-read full text just to compute a hash, and `readPage` stops reading the page and its history twice.
- Each project lists its artifact directories once per request; missing candidates are no longer stat-ed one by one; page summaries run eight at a time.
- Client polling only runs while the window is visible (list every 10s, detail every 8s) and catches up immediately on return; detail polling guards against re-entry.
- File responses carry `ETag` and answer `304`, so reopening a preview image or PDF no longer resends the whole payload.
- New `npm run bench`: on a 900-file fixture, `listProjects` 127ms → 19ms and `loadProject` 31ms → 4.6ms.

## 0.1.53 — 2026-11-07

### Reliability

- The history scanner compares `mtime + size` first and skips files that did not change; projects and pages that disappeared are dropped from the in-memory cache, so the two-second poll no longer grows linearly with the number of projects.
- Unexpected errors no longer leak exception text into the browser: the response is `服务内部错误（8-character id）` and the same id prefixes the host log entry. `handle()` is exported so tests can call it directly.
- New projects no longer create an empty `exports/` directory (also removed from SPEC).
- Test count 16 → 25: `test/history-watch.test.js` (scanner short-circuit) and `test/routes.test.js` (health, settings, empty project list, cross-site 403, redacted 500, 404), giving HTTP routes regression coverage for the first time.

## 0.1.52 — 2026-11-07

### Security and correctness

- Copy approval is derived rather than stored: `workbench/pages.json` no longer keeps `copyStatus`, and `pageSummary` computes it from `approvedHash === currentHash` (falling back to comparing version numbers when no hash exists). Editing a page returns it to draft; restoring the approved text makes it approved again.
- Artifact HTML responses add `content-security-policy: sandbox allow-scripts` and `x-content-type-options: nosniff`, so agent-authored pages no longer share the control API's same-origin privileges.
- Default prompts live only in `lib/settings.js`; `GET/POST /api/settings` returns `defaults` and the client drops its local copies in favour of a `SERVER_DEFAULTS` cache.
- Removed the dead `skills.pptx/html/image` settings; only `skills.content` remains.
- PPTX→PDF/PNG conversions are deduplicated by `pptx.path`: concurrent requests share one promise instead of deleting each other's output and failing with "no output file".
- Test count 11 → 16: new `test/approval.test.js` (approval state machine) and `test/http.test.js` (HTML response headers).
- `dev-docs/` is version-controlled again; `.npmignore` and `package.json` `files` are the only things keeping it out of the npm package.

---

## Appendix — 0.1.30–0.1.51 (summary)

The Chinese appendix in [CHANGELOG.md](CHANGELOG.md) has the full record; in short, the plugin went through six stages:

- **A — reference library externalised.** The shared reference deck moved out of the skill folders into a standalone library (`_reference`, later `references/<name>`), with byte-for-byte migration checks. Skills resolve it via `--reference`, `DECK_REFERENCE_ROOT`, or the active-library pointer, falling back to a bundled copy.
- **B — `slide-layout` split.** One skill became `html-layout` (HTML only) and `image-layout` (imagegen only); both produce the same retrieval results and prompts as before. Retrieval evidence files and an export report were added to the pipeline.
- **C — settings and capability detection (0.1.33–0.1.34).** Settings API grew reference status and `image_generate` detection; the client gained the settings tab. Image generation is never pre-disabled: a missing tool simply fails at generation time.
- **D — reference library builder.** Any PPTX becomes PDF → 1920×1080 WebP pages plus index, corpus, page index, signatures, manifest, style profile and library map. `primary_family` / `relations` are marked `builder_auto` and still need human or agent review.
- **E — layout skills bundled (0.1.35).** The three layout skills moved into the plugin and are registered in memory at startup; only the optional content skill remains configurable.
- **F — settings redesign (0.1.36).** Settings became three tabs (prompts / reference library / other), with upload → background build → progress polling, plus validation and rebuild with annotation reuse.

0.1.37–0.1.51 then added `builtAt`, reference validation, `--reuse-annotations`, multi-library switching (single active library, Chinese directory names, rename/delete, legacy migration), and a full settings-dialog redesign with a left section nav and a fixed footer.
