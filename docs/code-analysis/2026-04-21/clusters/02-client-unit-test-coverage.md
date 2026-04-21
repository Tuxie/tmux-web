---
Status: resolved
Resolved-in: 99de150, 3fd4dd7, d72dd41
---

> **Resolution (2026-04-21):** Four of the five untested client
> modules now have real unit coverage (toast, connection, drops-panel,
> dropdown — see `tests/unit/client/{,ui/}*.test.ts`). `topbar.ts`
> keeps a public-surface test file plus a `scripts/check-coverage.ts`
> EXCLUDES entry pointing at
> `docs/ideas/topbar-full-coverage-harness.md` for the remaining
> ~150-case slider-table harness. `xterm.ts` stays excluded with a
> pointer to `docs/ideas/webgl-mock-harness-for-xterm-adapter.md` per
> the maintainer's decision (WebGL mock is a separate idea, not
> undertaken in this session). The two Low findings
> (`clampFgContrastStrength`, `/api/exit`) are now tested.


# Cluster 02 — client-unit-test-coverage

## TL;DR

- **Goal:** The five client UI modules currently absent from lcov become instrumented, the xterm.ts adapter hits 90%+ function coverage, and the permanent `EXCLUDES` entry in `check-coverage.ts` goes away.
- **Impact:** Roughly 2,062 + 672 = 2,734 lines of the core client currently have no unit-test coverage at all. A bug in the session-menu, drops panel, WS reconnect, or toast system cannot be caught by the test suite before it ships.
- **Size:** Large (full day+, possibly multiple sessions if WebGL mocking is attempted)
- **Depends on:** cluster 01 (enabling the gate first makes the numerical progress visible in CI)
- **Severity:** High

## Header

> Session size: Large · Analysts: Coverage & Profiling, Test · Depends on: cluster 01-ci-coverage-gate

## Files touched

- `src/client/ui/topbar.ts` (1,223 lines, 0% lcov)
- `src/client/ui/dropdown.ts` (552 lines, 0% lcov)
- `src/client/ui/drops-panel.ts` (172 lines, 0% lcov)
- `src/client/connection.ts` (69 lines, 0% lcov)
- `src/client/ui/toast.ts` (46 lines, 0% lcov)
- `src/client/adapters/xterm.ts` (672 lines, 61% funcs / 72% lines)
- `src/client/fg-contrast.ts:38` (`clampFgContrastStrength` untested)
- `src/server/http.ts:556,562` (`/api/terminal-versions`, `POST /api/exit` untested paths)

## Severity & autonomy

- Critical: 0 · High: 2 · Medium: 0 · Low: 2
- autofix-ready: 2 · needs-decision: 2 · needs-spec: 0

## Findings

- **Five client modules are entirely absent from the coverage report (instrumented only because no test imports them)** — `topbar.ts`, `dropdown.ts`, `drops-panel.ts`, `connection.ts`, `toast.ts` — 2,062 lines total — never appear in `coverage/lcov.info`. The reason is that no file under `tests/unit/client/` imports any of them, so Bun's instrumentation never sees them. The project's JSDOM harness at `tests/unit/client/_dom.ts` already supports the kind of DOM surface these modules interact with.
  - Location: `src/client/ui/topbar.ts`, `src/client/ui/dropdown.ts`, `src/client/ui/drops-panel.ts`, `src/client/connection.ts`, `src/client/ui/toast.ts`
  - Severity: High · Confidence: Verified · Effort: Large · Autonomy: needs-decision
  - Cluster hint: `coverage-gaps`
  - Raised by: Coverage & Profiling Analyst (COV-1a), Test Analyst (TEST-3 ×3 — subsumed; Coverage's verified lcov evidence is authoritative)
  - Notes: The cheapest path is JSDOM-backed unit tests; E2E already covers some of these indirectly but leaves the unit gap. A decision is needed on scope: write deep assertions covering all observable behavior, or start with shallow import-and-construct tests that raise coverage numbers while real assertions come later. Either is defensible at T2. `topbar.ts` at 1,223 lines is the single largest module — if time is limited, prioritize the five modules in roughly this order: `toast.ts` (trivial, 46 lines), `connection.ts` (small, 69 lines, already has one E2E but no unit), `dropdown.ts` (the UI primitive underneath every custom picker in the settings menu), `drops-panel.ts`, `topbar.ts` (largest, most interaction surface).

- **`src/client/adapters/xterm.ts` at 61% funcs / 72% lines — below the 90%/95% per-file thresholds, and permanently excluded from the gate** — The uncovered ranges (lines 25-30, 100-101, 141-164, 256-274, 336-350, 365-393, 533-546, 574-588) split into three groups: (1) WebGL renderer monkey-patches (`_patchWebglExplicitBackgroundOpacity`, `_patchWebglAtlasFilter`, `_patchWebglLineHeightOverflow`) — need a stubbed WebGL context to exercise; (2) constructor + lifecycle methods (`fit`, `focus`, `metrics`, `dispose`) at 574-588 — straightforwardly testable with the existing JSDOM+fake-xterm harness already used in `tests/unit/client/adapters/xterm.test.ts`; (3) inner pixel-math loops inside `_patchWebglExplicitBackgroundOpacity` at 336-393 — contain the hot OKLab closures (see cluster 09 for the math-dedup story; see cluster 16 for the bench-missing story).
  - Location: `src/client/adapters/xterm.ts`
  - Severity: High · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `coverage-gaps`
  - Depends-on: cluster 09-xterm-oklab-dedup (extracting the OKLab helper makes the closures testable in isolation before the WebGL mock story is solved)
  - Raised by: Coverage & Profiling Analyst (COV-1b)

- **`clampFgContrastStrength` has no test coverage; symmetric counterpart `clampFgContrastBias` is tested** — Lines 35-39 in `src/client/fg-contrast.ts` export the first clamp function. `tests/unit/client/fg-contrast.test.ts` has a describe block for `clampFgContrastBias` but nothing for `clampFgContrastStrength`. Grep confirms no test file references `clampFgContrastStrength` or `DEFAULT_FG_CONTRAST_STRENGTH`.
  - Location: `src/client/fg-contrast.ts:38`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `coverage-gaps`
  - Fix: Add three test cases to `tests/unit/client/fg-contrast.test.ts` mirroring the existing `clampFgContrastBias` describe block: valid in-range value, out-of-range clamping, NaN → default fallback.
  - Raised by: Coverage & Profiling Analyst (COV-2)

- **`GET /api/terminal-versions` and `POST /api/exit` HTTP routes have no unit-test exercise** — Lines 543-544 (DELETE error path in `/api/sessions/:name`), 556-567 (`terminal-versions` handler), and 144 (`restart`/`quit` timer path) are in the uncovered set of `src/server/http.ts`. `src/server/http.ts` is otherwise at 96.88% lines / 92% funcs — the file is healthy overall; these are discrete per-route gaps.
  - Location: `src/server/http.ts:556`, `src/server/http.ts:562`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `coverage-gaps`
  - Raised by: Coverage & Profiling Analyst (COV-2b)

## Suggested session approach

Large-scope. Do cluster 01 first so the gate makes progress visible in CI. Then split into sub-sessions: (a) write import-only unit tests for `toast.ts`, `connection.ts`, `drops-panel.ts` to get them into lcov — this alone closes ~80% of the untested-file tally; (b) tackle `dropdown.ts` and `topbar.ts` with real assertions (these have enough logic to deserve it — but this pair alone can span a full day); (c) decide the `xterm.ts` plan: extract the OKLab closures (cluster 09) so they test in isolation, then write lifecycle-method tests against JSDOM, and file a follow-on cluster for the WebGL-mock work rather than block this cluster on it. The two Low findings (`clampFgContrastStrength`, the two HTTP routes) are 15-minute fixes — bundle them into whichever sub-session has spare capacity.

## Commit-message guidance

When the fix for this cluster lands, the commit message (or PR body) should:

1. Name the cluster slug and date on the first line — e.g., `test(cluster 02-client-unit-test-coverage, 2026-04-21): add unit tests for topbar/dropdown/connection`.
2. If the fix touched code outside the cluster to unblock a verification gate, add an **`Incidental fixes`** section listing each extra file with a one-line reason.
3. If the fix also resolved a finding from another cluster (e.g., the OKLab extract from cluster 09 landed as part of the xterm.ts testability work), name that cluster.
