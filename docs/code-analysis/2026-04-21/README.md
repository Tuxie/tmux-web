# Codebase Analysis — 2026-04-21

> **Heavy token usage.** Before kicking off a brainstorming session from any cluster here, confirm that weekly quota has spare headroom — follow-up sessions can easily spend as much as this analysis did.

## Project tier: **T2**

Single maintainer (Per Wigren), 448 commits in the last 90 days, multi-job GitHub Actions release workflow with cross-platform build matrix (linux-x64, linux-arm64, darwin-x64, darwin-arm64), MIT LICENSE, actively maintained CHANGELOG.md, regular releases (v1.6.3 on 2026-04-21). No production deploy artifacts (no Dockerfile / k8s / terraform / helm). Serious OSS solo high-velocity — not T3 enterprise, not T1 hobbyist. Every finding below was filtered through this tier; items above T2 (ERR-3 circuit breaker, OBS-1 metrics, OBS-2 distributed tracing, CI-4 self-hosted-runner posture) are marked N/A.

## Run metadata

- Repo: `/src/tmux-web`
- Git head: `e14aca1` on branch `main`
- Working tree at analysis time: **clean**
- Analysts dispatched: Backend (Sonnet), Frontend (Sonnet), Test (Sonnet), Security (Opus), Tooling (Sonnet), Docs (Sonnet), Coverage & Profiling (Sonnet, dynamic pass with user consent)
- Analysts skipped: Database — `absent` applicability flag (no DB, no migrations, no ORM; session settings persist to a single `~/.config/tmux-web/sessions.json` file)
- Scope overrides: none
- Re-dispatch passes: none (2 clusters qualified for Executive Summary instead of the usual 3–5; cause is real scarcity of High/Critical severity — the repo is well-maintained — not analyst under-analysis)
- Step 3.5 execution consent: **granted** — ran `bun test --coverage` once (587 tests, 0 failures)
- Right-sizing filter: 0 tier-mismatch dropped, 0 fix-rewritten, 0 below-threshold, 2 stylistic (inline-style carve-outs on justified dynamic writes), 2 rule-restatement (docs-already-cover-it) — 4 total; see `not-in-scope.md` for breakdown.
- Analyst health: all outputs within expected ranges. One soft flag — Tooling Analyst `Dropped at source` (7) exceeded reported findings (6); walked the breakdown and all 7 drops were legitimate clean verdicts (TOOL-1 single-toolchain, CI-1 SHA-pinned actions, etc.), not borderline over-filtering.
- Report directory: `docs/code-analysis/2026-04-21/`
- Scout map: `.scratch/codebase-map.md`

## Tech stack (excerpt)

TypeScript throughout. Server on Bun (v1.3.12 pinned via `.bun-version`) using Node-compat `http`/`https` stdlib + `ws@^8.20.0` + Bun-native `spawn` for PTY. Client uses xterm.js 6.0.0 vendored from git submodule at `vendor/xterm.js` (deliberate, load-bearing; CLAUDE.md's first major section marks this non-negotiable). WebGL renderer only — no DOM-renderer fallback. Bun native test runner for unit (`tests/unit/`, 52 files) + Playwright for e2e (`tests/e2e/`, 33 files). Build via `bun-build.ts` + `bun build --compile` to a single static binary. No database, no container, no IaC.

Entry points:
- `src/server/index.ts` — CLI parse + server bootstrap
- `src/server/http.ts:346` — `createHttpHandler`
- `src/server/ws.ts:386` — `createWsServer`
- `src/client/index.ts:47` — client `main()`
- `bun-build.ts` + `scripts/generate-assets.ts` — build pipeline

Full map at `.scratch/codebase-map.md`.

## Index

- [Executive summary](./executive-summary.md) — top 2 clusters (High-severity coverage gaps)
- [Themes](./themes.md) — cross-cutting patterns
- **Clusters** (ordered by recommended fix sequence; regenerate with `scripts/render-status.sh <report-dir>` after flipping any cluster's `Status:`):

<!-- cluster-index:start -->
- [Cluster 01 — ci-coverage-gate](./clusters/01-ci-coverage-gate.md) — Run `coverage:check` in release CI and narrow the xterm.ts exclusion · **open**
- [Cluster 02 — client-unit-test-coverage](./clusters/02-client-unit-test-coverage.md) — Cover the five untested client UI modules + xterm adapter shortfall · **open**
- [Cluster 03 — server-http-cleanup](./clusters/03-server-http-cleanup.md) — Fix window-name parsing + method-guard read-only endpoints + cache static lookups · **open**
- [Cluster 04 — pty-and-tmux-exec-safety](./clusters/04-pty-and-tmux-exec-safety.md) — Timeout sendBytesToPane, `--`-terminate tmux rename args, cap OSC 52 write-frame count · **open**
- [Cluster 05 — dropdown-a11y](./clusters/05-dropdown-a11y.md) — Wire `role="listbox"`/`role="option"` + arrow-key navigation + status-dot aria-labels · **open**
- [Cluster 06 — post-auth-data-handling](./clusters/06-post-auth-data-handling.md) — Tighten clipboard consent (TOCTOU + unvalidated PUT) and drop-path disclosure · **open**
- [Cluster 07 — server-auth-consistency](./clusters/07-server-auth-consistency.md) — Real constant-time compare + consolidate LOCALHOST_IPS · **open**
- [Cluster 08 — claude-md-refresh](./clusters/08-claude-md-refresh.md) — Fix drifted CLAUDE.md sections from v1.6.0 (keyboard, theme-switch, DOM contract, grammar) and README CLI flags · **open**
- [Cluster 09 — xterm-oklab-dedup](./clusters/09-xterm-oklab-dedup.md) — Extract shared OKLab helper; delete dead aliases and fields · **open**
- [Cluster 10 — client-robustness-cleanup](./clusters/10-client-robustness-cleanup.md) — Boot-fetch error surfacing, ws.onerror logging, page.style CSS var, observer cleanup, type-safety · **open**
- [Cluster 11 — topbar-ergonomics](./clusters/11-topbar-ergonomics.md) — Decide #btn-session-plus fate, reduce per-slider listener duplication, consistent clamping, clearer labels · **open**
- [Cluster 12 — theme-css-cleanup](./clusters/12-theme-css-cleanup.md) — Dedupe slider CSS across theme files; pick a single class-naming convention · **open**
- [Cluster 13 — ci-workflow-hygiene](./clusters/13-ci-workflow-hygiene.md) — E2E in CI, kill duplicate Homebrew bump race, decide fate of committed assets-embedded.ts, minor Makefile/package.json polish · **open**
- [Cluster 14 — test-quality-fixes](./clusters/14-test-quality-fixes.md) — Fix tautological assertion, cross-test state leak, live-dir coupling, PTY test duplication · **open**
- [Cluster 15 — fuzz-gaps](./clusters/15-fuzz-gaps.md) — Add property tests for security-sensitive parsers (OSC52/TT, origin, session-name, filename, TOML) · **open**
- [Cluster 16 — bench-and-stale-artifacts](./clusters/16-bench-and-stale-artifacts.md) — Add a repeatable bench for the WebGL OKLab math hot path; clean stale coverage tmp files · **open**
<!-- cluster-index:end -->
- **By analyst** (for traceability, not for reading end-to-end):
  - [backend](./by-analyst/backend.md) · [frontend](./by-analyst/frontend.md) · [database](./by-analyst/database.md) · [tests](./by-analyst/tests.md) · [security](./by-analyst/security.md) · [tooling](./by-analyst/tooling.md) · [docs](./by-analyst/docs.md) · [coverage-profiling](./by-analyst/coverage-profiling.md)
- [Checklist](./checklist.md)
- [META-1 draft rules](./meta.md)
- [Out of scope](./not-in-scope.md)

## How to use this report

1. Read the executive summary.
2. Pick one cluster. Open its file. Start a brainstorming session against that cluster alone — do not try to bundle clusters.
3. When a cluster is resolved, flip `Status:` inside the cluster file and set `Resolved-in:` to the merging commit SHA. Then run `scripts/render-status.sh` (from the skill package) to regenerate the index block above. **Do not edit the index by hand** — it will drift.

## Pre-release verification checklist

This repo has both CI config (`.github/workflows/release.yml`, `.github/workflows/bump-homebrew-tap.yml`) and a local CI-equivalent runner (documented in CLAUDE.md as `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest`; Makefile targets `test`, `test-unit`, `test-e2e`, `typecheck`). Before tagging a release:

- [ ] Run `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest` on a throwaway branch. Catches workflow-level typos and regressions in the vendor-xterm.js verification step before they fail the real push.
- [ ] Verify the commit(s) resolving closed clusters (see index above) are all on the release branch.
- [ ] Confirm no cluster still `in-progress` is a release blocker.
- [ ] Confirm `not-in-scope.md` "Deferred this run" entries are either still deferred-on-purpose or have tracking tickets.
