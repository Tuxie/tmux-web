# Docs — analyst-native output

> Preserved for traceability. For fix work use the clusters under `../clusters/`.

## Summary

CLAUDE.md is largely accurate but has three verified drift points against live code: the protocol table omits the `title` message key, the window-tab click description incorrectly names a keystroke rather than the WS action that is actually sent, and the theme-switch semantics section names `lineHeight`/`defaultLineHeight` where the code uses `spacing`/`defaultSpacing`. README drift is minor — the tmux.conf sourcing snippet is stale (2 of 6 paths shown), the DOM contract lists a non-existent `#btn-fullscreen` ID, and the LICENSE hedge is outdated. No findings warrant more than a one-line targeted fix at T2.

## Findings

- **CLAUDE.md protocol table missing `title` key** — `CLAUDE.md:187-193` · Medium/Verified · Cluster hint: `protocol-drift` · → see cluster 04-doc-drift
- **CLAUDE.md window-tab click misdescribed as `Ctrl-S <index>` keystroke** — `CLAUDE.md:265` · Medium/Verified · Cluster hint: `protocol-drift` · → see cluster 04-doc-drift
- **CLAUDE.md theme-switch semantics names wrong field (lineHeight vs spacing)** — `CLAUDE.md:181` · Medium/Verified · Cluster hint: `schema-drift` · → see cluster 04-doc-drift
- **CLAUDE.md CLI Options table is incomplete (6 missing flags)** — `CLAUDE.md:98-108` · Low/Verified · Cluster hint: `cli-drift` · → see cluster 04-doc-drift
- **README tmux.conf sourcing section shows 2 of 6 paths** — `README.md:97-104` · Medium/Verified · Cluster hint: `readme-drift` · → see cluster 04-doc-drift
- **`#btn-fullscreen` DOM ID listed in CLAUDE.md but does not exist in HTML** — `CLAUDE.md:290` · Medium/Verified · Cluster hint: `dom-contract-drift` · → see cluster 04-doc-drift
- **README LICENSE section hedges unnecessarily** — `README.md:143` · Low/Verified · Cluster hint: `readme-drift` · → see cluster 04-doc-drift
- **Superpowers plan describes localStorage; implementation shipped server-side** — `docs/superpowers/plans/2026-04-15-colours-and-ghostty-removal.md:7,20` · Low/Verified · Cluster hint: `stale-plan` · → see cluster 04-doc-drift
- **"Backends no forward" grammar error in CLAUDE.md** — `CLAUDE.md:207` · Low/Verified · Cluster hint: `typo` · → see cluster 04-doc-drift

## Checklist (owned items)

- `DOC-1 [x] clean — sampled; no inline comments contradicting the code they sit above`
- `DOC-2 [x] CLAUDE.md:181,187-193,207,265,290 — protocol table, window-click, schema, DOM contract all drift → cluster 04`
- `DOC-3 [x] README.md:97-104,143 — tmux.conf sourcing + LICENSE hedge stale → cluster 04`
- `DOC-4 [x] clean — documentation is clear and well-organised`
- `DOC-5 [-] N/A — no restructure needed`
- `META-1 [-] drafted in synthesis — see meta.md`
- `NAM-8 [x] CLAUDE.md:207 — grammar error → cluster 04`
- `GIT-1 [x] clean — MIT LICENSE present and tracked`
- `DEAD-3 [x] clean — no TODO/FIXME older than ~12 months by blame`
