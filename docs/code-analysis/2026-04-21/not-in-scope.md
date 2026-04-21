# Out of scope / filtered out

This file records what the analysis intentionally did **not** produce, so the user can see the shape of what was excluded rather than mistaking silence for clean.

## Analysts skipped

- **Database Analyst**: no database surface in this project. `absent` flag from Structure Scout (no schema, no migrations, no ORM, no query-builder). Session settings persist to a single `~/.config/tmux-web/sessions.json` file with atomic `.part` → rename writes — flat-file, not database.

## Findings filtered during right-sizing (synthesis §3)

- Tier-mismatch, dropped: **0** — no findings called for T3 infra / process that a T2 solo repo cannot adopt; analysts right-sized at source.
- Tier-mismatch, fix rewritten to fit tier: **0**
- Below profile threshold (project=T2): **0** — analysts correctly marked ERR-3 (circuit breaker, T3), OBS-1 (metrics, T3), OBS-2 (distributed tracing, T3), CI-4 (self-hosted runner, T3) as `[-] N/A — below profile threshold (project=T2)` rather than emitting findings; nothing had to be dropped from the finding set.
- Stylistic restatement: **2**
  - `FE-1-B` — Inline position styles on `dropdown.ts:172,532` for `position:fixed` context-menu placement. The values are unavoidably dynamic viewport-relative values; CLAUDE.md's "genuinely dynamic value" carve-out applies. The analyst flagged for "documentation completeness" only.
  - `FE-1-C` — Inline styles on a transient DOM probe `<span>` in `index.ts:131` used to resolve a CSS colour value to its canonical `rgb()` form. Deliberate scratch element; never enters visible layout. Same carve-out applies.
- Rule-restatement (already in CLAUDE.md / docs): **2**
  - **Security finding on `--reset` path disabling TLS verification for self-signed cert** (`src/server/index.ts:200`) — target is the local bind, cert is self-signed by design; CLAUDE.md and the `--help` output both document this intent. The analyst flagged only for completeness.
  - **TYPE-1 pervasive `any` in `xterm.ts` for vendored internals** — documented intentional escape hatch; CLAUDE.md's vendor-xterm section establishes the pattern. Not actionable without typing the vendored internals, which is a separate (out-of-tier) project.

**Total filtered: 4.** At a T2 project under active development, this low filter rate is expected — analysts should right-size at source, and they mostly did. If this rate had been near zero, it would signal under-filtering; near double-digit, over-filtering.

## Deferred this run

_No items deferred this run._ (Every finding with a concrete location landed in a cluster; nothing was intentionally punted.)

## Structural exclusions (never examined statically)

- Runtime profiling / load testing (except the single bench absence flagged as PROF-1 in cluster 16).
- Production telemetry and actual error rates (no telemetry surface in this project).
- External service reliability (no third-party deps at runtime — standalone static binary).
- Anything requiring credential access or network calls. The Security Analyst did not attempt HTTPS handshake probing, fuzzing of live endpoints, or any network traffic.
- Code under `vendor/xterm.js/` — vendored submodule explicitly marked as upstream code by CLAUDE.md; analysis ends at the repo's edge on that module.

## Tier-rule skipped checklist items

- `ERR-3` (circuit breaker): min-tier T3, project T2 → `[-] N/A — below profile threshold (project=T2)`. No evidence of intent to adopt.
- `OBS-1` (metrics for SLO): min-tier T3, project T2 → `[-] N/A`. No deploy artifact suggests SLO-relevant traffic.
- `OBS-2` (distributed tracing): min-tier T3, project T2 → `[-] N/A`.
- `CI-4` (self-hosted runner posture): min-tier T3, project T2 → `[-] N/A`. All jobs use GitHub-hosted runners.
- `I18N-1..3` (i18n): no i18n intent (no `locales/` dir, no i18n framework, no bidi CSS, UI strings hardcoded in English) → `[-] N/A — no i18n intent`.
- `SEO-1..3` (SEO metadata): `web-facing-ui` is present by scope but the UI is auth-gated (HTTP Basic + IP allowlist) with no crawlable value → `[-] N/A — auth-gated terminal, no crawlable surface`.
- `CONT-1..4` (container security): no Dockerfile / Containerfile / OCI build → `[-] N/A — no container`.
- `IAC-1..3` (infrastructure as code): no terraform / k8s / helm / pulumi / cloudformation → `[-] N/A — no IaC`.
- `MONO-1, MONO-2` (monorepo boundary violations): single-workspace project → `[-] N/A — not monorepo`.
- `API-2` (OpenAPI drift): no OpenAPI spec in repo → `[-] N/A — no OpenAPI spec`.
