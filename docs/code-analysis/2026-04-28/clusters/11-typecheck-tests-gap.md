---
Status: deferred
Autonomy: needs-decision
Resolved-in: deferred → docs/ideas/ts-test-typecheck.md
Deferred-reason: A separate tracking doc (`docs/ideas/ts-test-typecheck.md`, created 2026-04-26) names ~62 surfaced errors when `tests/**` is included in `tsconfig.tooling.json`. The cluster needs a scheduled cleanup pass against the surfaced errors before the include can flip green; per `analyst-ground-rules.md` "Gate-widening findings must ballpark the surfaced-error count", `Surfaced-errors > 20` forces `Effort: Large` and prevents `autofix-ready`.
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 11 — typecheck-tests-gap

## TL;DR

- **Goal:** Extend `tsc --noEmit` typecheck to `tests/**` so type drift in test fakes is caught in CI.
- **Impact:** Stale mock shapes that pass `bun test` (Bun erases types pre-run) get caught at typecheck time. Today they accumulate silently.
- **Size:** Large (full day+) — driven by the cleanup cost of ~62 surfaced errors, not the one-line config edit.
- **Depends on:** none.
- **Severity:** Low.
- **Autonomy (cluster level):** needs-decision (cleanup decisions are per-error: fix in place vs suppress vs delete).

## Header

> Session size: Large · Analysts: Tooling · Depends on: none · Autonomy: needs-decision (deferred)

## Files touched

- `tsconfig.tooling.json` (1 line)
- `tests/unit/client/xterm-adapter.test.ts` (~18 errors per `docs/ideas/ts-test-typecheck.md`)
- `tests/**` other (~44 remaining errors)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 1
- autofix-ready: 0 · needs-decision: 1 · needs-spec: 0

## Findings

- **`tsconfig.tooling.json` excludes `tests/**`, leaving type drift in test fakes undetected by `make typecheck`** — Four tsconfigs cover `src/**`, `scripts/**`, `bun-build.ts`, and `playwright.config.ts` but explicitly exclude `tests/`. `bun test` erases types pre-run, so a stale mock shape still passes tests. Tracking doc `docs/ideas/ts-test-typecheck.md` (2026-04-26) ballparked ~62 errors when `tests/**` is included, primarily in `tests/unit/client/xterm-adapter.test.ts` (~18 errors).
  - Location: `tsconfig.tooling.json:40`
  - Severity: Low · Confidence: Verified · Effort: Large · Autonomy: needs-decision
  - Cluster hint: `typecheck-coverage`
  - Surfaced-errors: ~62 (per `docs/ideas/ts-test-typecheck.md`; not re-run at analysis time since `bun tsc` is forbidden — fix coordinator must re-ballpark before proceeding)
  - Raised by: Tooling Analyst
  - Notes: Per `analyst-ground-rules.md` "Gate-widening findings must ballpark the surfaced-error count", `Surfaced-errors > 20` forces `Effort: Large` and prevents `autofix-ready`. The cleanup decisions (fix vs suppress vs delete each error) are per-error, not mechanical. Tracking doc is the canonical reference for the in-flight cleanup; this cluster file exists as the formal pass anchor and is `Status: deferred` to avoid duplicate scheduling.

## Suggested session approach

Open `docs/ideas/ts-test-typecheck.md` and continue from there. The first sub-cluster (~18 errors in `tests/unit/client/xterm-adapter.test.ts`) is the natural starting point. Once those clear, re-ballpark the remaining error count; decide whether to land it as one Large session or split into two smaller sessions per test directory. The one-line `tsconfig.tooling.json` flip is the last commit, not the first — the surfaced errors must be cleaned first to avoid landing red.
