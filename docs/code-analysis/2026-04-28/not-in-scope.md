# Out of scope / filtered out

This file records what the analysis intentionally did **not** produce, so the user can see the shape of what was excluded rather than mistaking silence for clean.

## Analysts skipped

- **Database Analyst:** Scout flag `database: absent` — in-memory `sessions-store.ts` only; no SQL/NoSQL dependency.
- **Coverage & Profiling Analyst:** skipped per user directive at Step 0 (`skip coverage`). Project does have coverage tracking infrastructure (`bun run coverage:check`, `scripts/check-coverage.ts`); the static-pass items (COV-1..COV-6, PROF-1..PROF-2) were not analysed this run.

## Findings filtered during right-sizing (synthesis §3)

- **Tier-mismatch, dropped:** 0
- **Tier-mismatch, fix rewritten to fit tier:** 0
- **Below profile threshold (project=T1):** 0 — analysts already filtered at source per the T1 rule and emitted `[-] N/A — below profile threshold (project=T1)` in the checklist instead of filing a finding.
- **Stylistic restatement:** 0
- **Rule-restatement (already in project instructions / docs):** 0
- **Borderline drops (analyst self-flagged borderline / clean-with-record):** 4 — Frontend `connection.ts:74` (reconnect null-onclose, analyst filed for record then noted clean); Frontend `bun-build.ts:71` (regex-replace pattern, analyst filed for record then noted clean); Frontend `colours.ts:27` (parseRgbString, legitimate use); Frontend `topbar.ts:1282` (correct `void` usage, dup of cluster-01 finding).
- **Documented-decision (security):** 6 — Security analyst noted these as informational and dropped (OSC 52 BLAKE3 TOCTOU per AGENTS.md:339-353; drop-paste cross-session per http.ts:546-551; constant-time-compare length leak per Local-first table; readBodyCapped 500 ms cancel race; tmpdir theme materialisation perms; tmux send-keys argv length; isSafeTmuxName argv injection coverage; TLS cert generation).

## Deferred this run

Findings the analysts raised as real but intentionally punted this run (status `[~] deferred`). Each entry names its tracking location.

- **`tsconfig.tooling.json` excludes `tests/**`** — `tsconfig.tooling.json:40` — reason: ~62 type errors surface when `tests/**` is included; cleanup is a Large session by the gate-widening rule. Tracking: [`docs/ideas/ts-test-typecheck.md`](../../ideas/ts-test-typecheck.md) (created 2026-04-26). Cluster 11 is `Status: deferred` to avoid duplicate scheduling.

## Structural exclusions (never examined statically)

- Runtime profiling / load testing
- Production telemetry and actual error rates
- External service reliability (Homebrew tap, GitHub Actions runner availability)
- Anything requiring credential access or network calls
- The vendored `vendor/xterm.js` submodule's internal correctness (Scout treats this as supply-chain trust boundary; Security analyst notes the build-time `experimentalDecorators` patch but does not audit upstream xterm.js itself).

## Tier-rule skipped checklist items

The following items have min-tier > T1 and were not flipped on by counter-evidence; they emit `[-] N/A — below profile threshold (project=T1)` across the report:

- **PERF-1, PERF-2, PERF-5** (T2): caching/memoization, bundle-size optimisation, cancellation propagation through long-running work.
- **ERR-1, ERR-2** (T2), **ERR-3** (T3), **ERR-4** (T2): retry/backoff, idempotency, circuit breaker, frontend error boundary.
- **CONC-3, CONC-4, CONC-5** (T2): unbounded fan-out, cancellation propagation, deadlock-prone lock ordering.
- **OBS-1, OBS-2** (T3), **OBS-3, OBS-4** (T2): metrics, distributed tracing, /health endpoint, telemetry schema drift.
- **LOG-3, LOG-4, LOG-7** (T2): INFO at lifecycle, DEBUG per-item, phrasing consistency.
- **TYPE-2** (T2): public API typed `unknown`/`any`.
- **API-1, API-2, API-3** (T2): breaking-change versioning, OpenAPI drift, response-shape consistency.
- **DEP-4** (T2): hand-rolled where a maintained package fits.
- **NAM-5** (T2): API/endpoint naming convention. (One T1-relevant Low finding — `currentSession` derivation duplicated three sites — was still filed under cluster 10 even though the formal rule is T2; the duplication is a T1 maintenance concern.)
- **A11Y-4, A11Y-6, A11Y-8, A11Y-10, UX-2** (T2): landmark/heading structure, ARIA misuse, prefers-reduced-motion, touch target ≥24×24, keyboard-shortcut consistency. (One T2 finding — invalid `aria-haspopup="true"` value — was still filed under cluster 03 since it is mechanical and ships with the surrounding T1 work.)
- **I18N-1..I18N-3**: `[-] N/A — no i18n intent` (Scout flag).
- **SEO-1..SEO-3**: `[-] N/A — auth-gated UI, no crawlable surface` (Scout sub-flag).
- **DB-1..DB-5, MIG-1..MIG-5**: `[-] N/A — database: absent` (Scout flag).
- **TEST-4** (T2): missing E2E for user-visible flow.
- **TEST-8, TEST-9** (T2): concurrency-unsafe test suite, slow-test tagging.
- **STYLE-3, STYLE-6, STYLE-9, STYLE-11** (T2): spaghetti inheritance, breakpoint inconsistency, CSS-in-JS recreation, cascade ordering brittleness.
- **CI-1, CI-2, CI-3** (T2), **CI-4** (T3): joint with Tooling. CI-1/2/3 verified clean by Security regardless (above the formal threshold but observed in the analysis).
- **TOOL-5, TOOL-6, TOOL-7** (T2): over-simplified tooling, CI/CD inefficiency, workflow errors.
- **BUILD-1, BUILD-3** (T2): lockfile presence, toolchain pin. (Counter-evidence noted: `.bun-version` is pinned, `bun.lock` is committed; the absence at T1 would be addressable but the existing infrastructure already covers the BUILD-2/4 lens.)
- **GIT-1, GIT-2** (T2): LICENSE presence (verified clean — ISC), large-binary tracking.
- **CONT-1..CONT-4**: `[-] N/A — container: absent`.
- **IAC-1..IAC-3**: `[-] N/A — iac: absent`.
- **MONO-1, MONO-2**: `[-] N/A — monorepo: absent`.
- **DEAD-1** (T2): feature flag still referenced after decision.
- **DOC-4, DOC-5** (T2): ambiguous doc, restructure-for-LLM-consumption.
- **PROF-1, PROF-2** (T2): performance bench targets, stale bench artifacts.
- **FE-6, FE-9, FE-17, FE-20** (T2): mixed styling systems, overlapping UI libs, lazy media, server-only APIs in client bundle.
- **STYLE-3, STYLE-6, STYLE-9, STYLE-11** (T2): listed above.
- **UX-1** (T2): inconsistent UI look & feel.
- **PERF-2 styling slice** (T2): listed above.
