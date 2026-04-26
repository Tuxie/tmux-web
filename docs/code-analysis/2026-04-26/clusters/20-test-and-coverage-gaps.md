---
Status: closed
Autonomy: needs-decision
Resolved-in: d792a49 (F4/F5 docs-only deferrals) + beae34d (F1/F2/F3 re-attempt landed; coverage:check now exits 0; lcov-presence check live; src/desktop/index.ts no longer silently invisible to the gate)
Depends-on: 06-ci-and-release-improvements
informally-unblocks:
Pre-conditions:
- scripts/check-coverage.ts: gate currently fails on `prepare-electrobun-bundle.ts: lines 79.3% < 80%` — the gate-blind-spot fix below will fail-loud on this until the coverage gap is closed (or override lowered)
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 20 — test-and-coverage-gaps

## TL;DR

- **Goal:** Close coverage-gate blind spots — the gate currently fails one file (`prepare-electrobun-bundle.ts`), is structurally blind to files no test imports (`src/desktop/index.ts`), and the empty `tests/unit/build/` directory next to a load-bearing `bun-build.ts` is an attractive nuisance.
- **Impact:** The gate becomes a true safety net rather than a checklist exercise. Today, the gate iterates lcov records but never reconciles against `git ls-files src/`, so files no test ever imports drop off the gate's radar entirely.
- **Size:** Medium (half-day).
- **Depends on:** Cluster 06 (typecheck widening surfaces test-side issues that may need fixing first; the gate-widening here adds a similar dynamic).
- **Severity:** Medium
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Test, Coverage · Depends on: cluster 06 · Autonomy: needs-decision

## Files touched

- `scripts/prepare-electrobun-bundle.ts` (subject of failing gate)
- `scripts/check-coverage.ts` (gate logic — reconcile against git ls-files)
- `src/desktop/index.ts` (uncovered)
- `tests/unit/build/` (empty)
- `tests/unit/desktop/main.test.ts` (proposed)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 4 · Low: 2
- autofix-ready: 1 · needs-decision: 4 · needs-spec: 1

## Findings

- **`scripts/prepare-electrobun-bundle.ts` failed coverage gate (79.3% lines vs. 80% override)** — The dynamic coverage run (`bun run coverage:check`) exited 1 because `prepare-electrobun-bundle.ts` measured 79.3% line coverage, just below the explicit 80% per-file override added in `scripts/check-coverage.ts:52`. The uncovered branch is `prepareMacosBundle()` (the `if (process.env.ELECTROBUN_OS === 'macos')` arm) — `tests/unit/scripts/prepare-electrobun-bundle.test.ts` covers `resolveMacosAppRoot` but not the macOS-conditional install path.
  - Location: `scripts/prepare-electrobun-bundle.ts:26-41`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `coverage-gate-failure`
  - Notes: The gate currently fails for solo-maintainer runs. Two reasonable paths: (a) add a macOS-mocked test that fakes `process.env.ELECTROBUN_OS = 'macos'` plus stubbed `fs.cpSync`/`fs.chmodSync` to drive `prepareMacosBundle`; (b) lower the override floor from 80 to 79 (already a one-off override). Verified via direct run; output captured `scripts/prepare-electrobun-bundle.ts: lines 79.3% < 80%`.
  - Raised by: Coverage

- **`src/desktop/index.ts` has zero coverage and is silently invisible to the gate** — The desktop wrapper main (113 lines, glues `startTmuxWebServer` + `openTmuxTermWindow` + signal handling) is never imported by any test, so lcov emits no `SF:` record for it, the per-file thresholds in `scripts/check-coverage.ts` never fire, and the Linux coverage gate (`bun run coverage:check` in `release.yml:132-134`) treats absence as success. The file is also not in the explicit `EXCLUDES` set — so the exclusion is by accident, not by decision. This contradicts the v1.9.0 desktop-beta intent documented in `scripts/check-coverage.ts:39-43` ("Keep them in-scope with explicit lower per-file floors instead of excluding the files entirely") for `src/desktop/*`.
  - Location: `src/desktop/index.ts:1-117`, `scripts/check-coverage.ts:11-23`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `coverage-blind-spot`
  - Notes: Verified by diffing `git ls-files src/` against `^SF:` records in `coverage/lcov.info` — only `src/desktop/index.ts`, `src/client/index.ts`, `src/client/adapters/types.ts`, and `src/shared/types.ts` are absent (the latter three are pure type/bootstrap, but `desktop/index.ts` runs real signal-routing and shutdown logic). Two reasonable directions: (a) add a `tests/unit/desktop/main.test.ts` that imports the module and exercises `main()` with stubbed `BrowserWindow`/`Screen`/`startTmuxWebServer`; (b) add `src/desktop/index.ts` to `EXCLUDES` with a tracking pointer (matching how `src/client/adapters/xterm.ts` and `src/client/ui/topbar.ts` are documented in `docs/ideas/`). Either is valid, but the silent absence is itself the bug — gate must be visible.
  - Raised by: Coverage

- **Coverage gate doesn't warn on missing-from-lcov files** — `scripts/check-coverage.ts:99-110` iterates `parseLcov()` output and checks each record against `EXCLUDES` + thresholds, but never reconciles against the actual `src/` tree, so any file no test ever imports drops off the gate's radar entirely (the `src/desktop/index.ts` finding above is one consequence). For a T2 project that ships a desktop beta plus a server plus a client and gates on per-file floors, this is a blind spot at exactly the layer the floor is meant to enforce.
  - Location: `scripts/check-coverage.ts:88-110`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `coverage-blind-spot`
  - Fix: After the per-record loop, `git ls-files src/` (or `fs.readdirSync` walk) and assert every `.ts` file (excluding declaration files and the explicit `EXCLUDES` set) appears in `files`; otherwise push to `failures` with `${path}: not exercised by any test`. Place check before the global aggregate so it fails alongside per-file floor breaches.
  - Notes: Verified — run found `src/desktop/index.ts` missing from lcov but not flagged by the gate.
  - Raised by: Coverage

- **`src/server/index.ts` at 26.5% line coverage despite being the CLI/bootstrap entry point** — `src/server/index.ts` (484 lines, including `startServer()`, `--reset` flow, `runServerCleanup`, embedded-asset/runtime-dir resolution, dangerous-origin warnings, password scrubbing) reports 112/422 lines covered. The whole file is in `EXCLUDES` (`scripts/check-coverage.ts:12`) as "bootstrap / generated / IO-shell wrappers", but a substantial chunk is parseable pure logic (the `parseConfig`, `parseListenAddr`, `resolveRuntimeBaseDir`, `runServerCleanup` exports already have tests). The remaining ~310 lines of `startServer()` body have no static-analysis-resistant glue and are reachable via the existing harness style.
  - Location: `src/server/index.ts:190-484`
  - Severity: Low · Confidence: Verified · Effort: Large · Autonomy: needs-spec
  - Cluster hint: `coverage-broad-exclude`
  - Notes: Right-sizing: T2 solo-maintainer with documented "follow-up"-style ideas docs already in `docs/ideas/`. A new `docs/ideas/server-index-coverage.md` plus pulling 2-3 of the easier sub-flows (the `--reset` POST + the password-scrub argv loop + the `tmux -V` probe) into directly-tested helpers is the right scope, not a wholesale gate widening (which would surface ~310 lines of cleanup work). Tracking ticket needed before this becomes actionable.
  - Raised by: Coverage

- **TEST-1: `tests/unit/build/` is empty — no test exercises `bun-build.ts`** — The directory `tests/unit/build/` exists (`ls` returns no entries) but `bun-build.ts` itself (the load-bearing client bundler that AGENTS.md warns "has silently regressed at least five times") has no unit test. The only protection is `scripts/verify-vendor-xterm.ts` running post-compile in CI. A regression that bundles the npm `@xterm/xterm@6.0.0` instead of the vendor submodule would only fail at the end of the release workflow, not during fast unit feedback.
  - Location: `tests/unit/build/`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `release-pipeline-coverage`
  - Notes: At minimum a unit test could assert `bun-build.ts` exports the expected module shape, that it throws on missing `vendor/xterm.js`, and that the sentinel `tmux-web: vendor xterm.js rev <SHA>` is appended to the output. The empty directory is itself an attractive nuisance — a developer adding new build-related unit tests will find no convention to follow.
  - Raised by: Test

## Suggested session approach

Brainstorming session — multiple needs-decision findings with ≥2 reasonable shapes. Resolve in order:

1. **Coverage gate failure** (hard-stop today). Decide: add macOS-mocked test for `prepareMacosBundle` (preferred — exercises the code) or lower override to 79 (one-line patch). The first option is less reversible later.
2. **Coverage gate blind-spot fix** is autofix-ready and lands the missing-from-lcov check. Note: lighting up this check will flag `src/desktop/index.ts` immediately (Pre-condition handled in frontmatter); pair with the desktop test (or EXCLUDES addition) to keep the gate green in the same commit.
3. **`tests/unit/build/` population** is its own session — design an interesting unit test for `bun-build.ts` that exercises the vendor-xterm sentinel and the `verify-vendor-xterm.ts` round-trip.
4. **`src/server/index.ts` coverage** is needs-spec — defer and write `docs/ideas/server-index-coverage.md` to track.

Cluster 06's typecheck widening produces a similar "ballpark surfaced errors before flipping the gate" obligation (see frontmatter `Pre-conditions:`). If 06 lands first, the test-side typecheck pass may surface fixes that affect this cluster's test work.
