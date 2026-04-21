# Docs Consistency Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

The codebase docs are notably fresh — the prior 2026-04-17 analysis identified nine doc-drift issues and all nine appear to have been resolved. Three new drift items introduced by v1.6.0 and v1.6.1 are the main findings: the DOM contract in CLAUDE.md was not extended when ~14 new slider IDs were added, the keyboard handler description was not updated when Shift+Enter and Ctrl+Enter intercepts were re-introduced, and the theme-switch semantics paragraph was not revised when `applyThemeDefaults` grew from 4 fields to 15. The README CLI table also missed the `--reset` flag that shipped in v1.6.1. All findings are Small-effort, autofix-ready edits; none involve architectural ambiguity.

## Findings (by cluster)

**→ cluster 08-claude-md-refresh**
- Keyboard handler scope understated in CLAUDE.md §3 — Medium / Verified
- Theme-switch semantics paragraph incomplete and misuses "unconditionally" — Medium / Verified
- DOM contract missing ~14 load-bearing IDs + session menu button description conflates two elements — Medium / Verified
- Misplaced "Post-compile verification" comment in `release.yml` — Low / Verified
- Grammar fragments in CLAUDE.md (lines 157, 223) — Low / Verified
- README CLI options table missing `--reset`, `--themes-dir`, `-d`/`--debug` — Low / Verified

## Checklist (owned items)

- DOC-1 [x] (1 finding) — misplaced comment in `release.yml` → cluster 08
- DOC-2 [x] (2 findings) — keyboard handler scope, theme-switch semantics + field list → cluster 08
- DOC-3 [x] (1 finding) — README CLI table missing flags → cluster 08
- DOC-4 [x] — subsumed into the DOM contract + session-menu description finding (DOC-2, cluster 08)
- DOC-5 [x] clean — no standalone finding; concrete rephrases included inline in DOC-2 fixes
- META-1 [-] N/A — drafted at synthesis (see `../meta.md`)
- NAM-8 [x] (1 finding) — two grammatical fragments in CLAUDE.md lines 157 and 223 → cluster 08
- GIT-1 [x] clean — LICENSE present (MIT)
- DEAD-3 [x] clean — no TODO/FIXME found in `src/` older than 12 months (by `git blame`)
