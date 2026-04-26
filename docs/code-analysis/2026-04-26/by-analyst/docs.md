# Docs Consistency Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

Top-level instruction docs (`AGENTS.md`, `README.md`) are largely current — the Scout's "fresh on all three signals" verdict is correct for the bulk of both files — but the rapid post-2026-04-21 churn (CLAUDE.md→AGENTS.md rename on 2026-04-23, embedded-tmux feature shipped in v1.8.0 then removed in `67cf30e` on 2026-04-26, tmux-scrollbar landed 2026-04-25 post-tag, `tmux-term` desktop wrapper added in v1.9.0) has left a handful of small-but-load-bearing drifts: two stale `CLAUDE.md` references in README, a misdescribed `#btn-session-plus`, missing `tmux-term` / `src/desktop/` coverage in AGENTS.md, an empty `## Unreleased` despite two real changes, and a duplicate CHANGELOG heading. None are architectural; all are mechanical edits totaling roughly 30 lines of doc churn. T2 sizing: legitimate findings, no enterprise process advice. The `docs/superpowers/plans/` housekeeping item is a genuinely lower-priority papercut.

## Findings

(Findings have been merged into clusters; cluster files carry the verbatim bodies.)

- **README still references the deleted `CLAUDE.md`** — `README.md:181,194` — Severity Medium, Confidence Verified · → see cluster 08-docs-drift
- **`#btn-session-plus` documented as "currently unwired" but is now wired to desktop window close** — `AGENTS.md:316,362` — Severity Medium, Confidence Verified · → see cluster 08-docs-drift
- **`tmux-term` desktop wrapper exists in README but is invisible from `AGENTS.md`** — `AGENTS.md:71-100` — Severity Medium, Confidence Verified · → see cluster 08-docs-drift
- **CHANGELOG `## Unreleased` is empty though there is real shipped post-1.9.0 work** — `CHANGELOG.md:3` — Severity Medium, Confidence Verified · → see cluster 08-docs-drift
- **Duplicate `## 1.5.1 — 2026-04-18` heading in CHANGELOG** — `CHANGELOG.md:259,261` — Severity Low, Confidence Verified · → see cluster 08-docs-drift
- **README understates the number of built-in themes** — `README.md:25` — Severity Low, Confidence Verified · → see cluster 08-docs-drift
- **`package.json` description claims "multiple terminal backends" — only one exists** — `package.json:7` — Severity Low, Confidence Verified · → see cluster 08-docs-drift
- **`docs/superpowers/plans/` retains two subtly-mis-dated 2025-* plan files** — `docs/superpowers/plans/2025-*.md` — Severity Low, Confidence Plausible · → see cluster 08-docs-drift

## Checklist (owned items)

- DOC-1 [x] inline comment vs. code — `tests/fuzz/README.md:18` covered in cluster 08-docs-drift.
- DOC-2 [x] `AGENTS.md` symbol drift — `AGENTS.md:316,362,71-100` — see cluster 08-docs-drift.
- DOC-3 [x] README/docs vs code — `README.md:181,194,25` — see cluster 08-docs-drift.
- DOC-4 [x] clean — sampled all top-level meta files plus 6 `docs/superpowers/specs/*-design.md` and 8 plans; no genuinely ambiguous wording.
- DOC-5 [x] AGENTS.md restructure for new contributors — covered under DOC-2 (`tmux-term` invisibility).
- META-1 [x] CHANGELOG `Unreleased` empty + duplicate `1.5.1` heading; see cluster 08-docs-drift. META rule drafted in `meta.md`.
- NAM-8 [x] clean — sampled docs and inline comments; no naming drift; British spelling consistent throughout.
- GIT-1 [x] LICENSE present — `LICENSE:1` MIT, matches `package.json:6` and README:198 link.
- DEAD-3 [x] clean — `git ls-files | xargs grep -E "TODO:|FIXME:|XXX:|HACK:"` zero matches; the single `XXXX:YYYY` substring in `src/server/origin.ts:126` is hex-form documentation, not TODO.
