# Out of scope / filtered out

This file records what the analysis intentionally did **not** produce, so the user can see the shape of what was excluded rather than mistaking silence for clean.

## Analysts skipped

- **Database Analyst** — no SQL, ORM, or migration files in the repo. Per-session state persists as a single JSON file (`~/.config/tmux-web/sessions.json`) via atomic `.part`→rename; this is covered by the Backend Analyst's DEP-4 / ERR-2 sampling, not by DB/MIG items.

## Findings filtered during right-sizing (synthesis §3)

- Tier-mismatch, dropped: **~2** — e.g., proposals for distributed tracing / Prometheus metrics on a T2 self-hosted tool (dropped at Backend source per tier filter; no OBS-1/OBS-2 findings emitted).
- Tier-mismatch, fix rewritten to fit tier: **0** — analysts filtered at source.
- Below profile threshold (project=T2): see the many `[-] N/A — below profile threshold (project=T2)` lines in `checklist.md`. The bulk of these are T1-only items (EFF, deep-comment rules, naming conventions) that the analysts judged not worth flagging in this repo.
- Stylistic restatement: **~4** — minor wording / formatting preferences that did not survive right-sizing (kept in analyst scratch only).
- Rule-restatement (already in CLAUDE.md / docs): **~2** — e.g., the xterm vendor strategy is explicitly documented as load-bearing; analysts refrained from flagging the tsconfig patching or the sentinel-append in `bun-build.ts` as bugs.

## Structural exclusions (never examined statically)

- Runtime profiling / load testing — the skill forbids running the project.
- Production telemetry and actual error rates — no such telemetry exists in the repo.
- External service reliability (tmux itself, openssl on the host) — treated as environment.
- Anything requiring credential access or network calls.
- Contents of `vendor/xterm.js` submodule — treated as a pinned upstream artifact per CLAUDE.md.

## Tier-rule skipped checklist items

Items below profile threshold T2 that the analysts explicitly emitted as `[-] N/A`:

- **T3 items** (min-tier above project): ERR-3, OBS-1, OBS-2, SEO-3, CI-4, IAC-3.
- **T1 comment/naming/structure items not flagged**: EFF-1..3, QUAL-1..4, QUAL-5a, QUAL-5c, QUAL-6..8, ERR-5, CONC-1, PERF-3, NAM-1..4, NAM-6..7, COM-1..3, DEP-1..3, DEP-5..6, DEP-8, FE-2..3, FE-9..15, I18N-*, SEO-* — each surveyed and judged to not carry meaningful signal at the project's complexity.

## Applicability-skipped items

- **CONT-*** — no Dockerfile / Containerfile present.
- **IAC-*** — no terraform / k8s / helm / pulumi present.
- **MONO-*** — single-app layout; vendor/xterm.js submodule does not constitute a workspace.
- **DB-* / MIG-*** — no database. Session store JSON file does not trigger DB items.
- **I18N-*** — no i18n framework, locale directory, or bidi CSS.
