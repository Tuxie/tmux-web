---
Status: resolved
Resolved-in: ce38d29, PENDING
---

> **Resolution (2026-04-21):** All four findings closed. The initial
> commit (`ce38d29`) landed the tautological-assertion fix, the
> `_resetRecentOriginRejects` reset hook (+ `beforeEach`), and the
> live-dir comment on `bundled-themes.test.ts`. Follow-up commit below
> completes the maintainer's decision on the last item: merge
> `pty-argv.test.ts` into `pty.test.ts` (remove the sibling file,
> preserve every distinct case, deduplicate overlapping
> `sanitizeSession` / `buildPtyCommand` ones).


# Cluster 14 — test-quality-fixes

## TL;DR

- **Goal:** Fix the one tautological assertion in the test suite, decide the path for the cross-test `recentOriginRejects` module-state leak, resolve the coupling where `bundled-themes.test.ts` reads the live `themes/` directory, and deduplicate the PTY tests.
- **Impact:** The tautological assertion is the only case in the repo where a test body does not match what its name claims to test. The others are hygiene/determinism items.
- **Size:** Small (<2h)
- **Depends on:** none
- **Severity:** Medium

## Header

> Session size: Small · Analysts: Test · Depends on: none

## Files touched

- `tests/unit/server/origin.test.ts` (tautological assertion; module-state leak)
- `tests/unit/server/bundled-themes.test.ts` (live-dir coupling)
- `tests/unit/server/pty.test.ts`, `tests/unit/server/pty-argv.test.ts` (duplication)
- `src/server/origin.ts` (potential reset export, if chosen for DET-4)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 3
- autofix-ready: 1 · needs-decision: 3 · needs-spec: 0

## Findings

- **`logOriginReject` test final assertion is tautological — `expect(typeof called).toBe('number')`** — The test at `tests/unit/server/origin.test.ts:207` asserts `typeof` of any numeric variable, which always evaluates to `'number'` and passes regardless of the behaviour it claims to verify. The function's actual contract (eviction fires when the 256-cap is exceeded; rate-limiting suppresses repeat logs within 60 s) goes entirely unverified. After the test's setup loop fills 300 entries, the first `logOriginReject` call adds h300 and evicts h0 (oldest); a second call for h0 should log (`called === 1`) because h0's timestamp is gone.
  - Location: `tests/unit/server/origin.test.ts:207`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `test-name-accuracy`
  - Fix: Replace `expect(typeof called).toBe('number')` with `expect(called).toBe(1)`.
  - Raised by: Test Analyst

- **`recentOriginRejects` module-level `Map` leaks across sibling tests in the same file** — `recentOriginRejects` (at `src/server/origin.ts:95`) is a module-level singleton. The `logOriginReject` test fills it with 300 entries; the module does not expose a reset function, so any future test in the same file that calls `logOriginReject` would inherit stale rate-limit state. Currently only one test exercises `logOriginReject`, so impact is contained.
  - Location: `tests/unit/server/origin.test.ts:184` · `src/server/origin.ts:95`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `test-determinism`
  - Raised by: Test Analyst
  - Notes: Two options: (a) export `_resetOriginRejects()` from `origin.ts` (matching the existing `_resetInotifyProbe` pattern in `file-drop.ts`) and call it in `beforeEach`; (b) accept the singleton as-is and add a comment in the test file warning future authors not to add a second `logOriginReject` test without a reset hook.

- **`bundled-themes.test.ts` reads from the real `./themes/` directory** — `tests/unit/server/bundled-themes.test.ts:5` resolves `path.resolve(import.meta.dir, "../../../themes")` to read the live bundled themes. If a theme variant is renamed, this test fails even though the change is intentional and all other tests (which use the `tests/fixtures/themes-bundled` fixture) still pass.
  - Location: `tests/unit/server/bundled-themes.test.ts:5`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `test-determinism`
  - Raised by: Test Analyst
  - Notes: Deliberate trade-off — the test is a snapshot of live bundled themes, intended to catch accidental breakage. Options: (a) leave as-is and add a comment noting "this test intentionally reads live themes; expect to update it when renaming theme variants"; (b) promote the snapshot to a fixture under `tests/fixtures/themes-bundled` and refresh it manually; (c) split the test into a static "file layout" check against the live dir and an assertion check against a fixture.

- **`pty.test.ts` and `pty-argv.test.ts` duplicate `sanitizeSession` and `buildPtyCommand` assertions** — Both files test `sanitizeSession` (strips dangerous chars, collapses dots, defaults to "main") and `buildPtyCommand` (tmuxBin path, session sanitization). Several cases are near-identical — e.g., both test that `sanitizeSession('foo;rm...')` removes semicolons; both test that empty session defaults to "main".
  - Location: `tests/unit/server/pty.test.ts` · `tests/unit/server/pty-argv.test.ts`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `test-redundancy`
  - Raised by: Test Analyst
  - Notes: The overlap is not harmful (both pass, no setup cost), but maintaining them separately expands the update surface when `sanitizeSession` behaviour changes. Merge into one file or rename the second file to make it clear it's the argv-specific extension.

## Suggested session approach

Mechanical for the tautological assertion (one-line change); short brainstorm for the three needs-decision items — they all relate to determinism or isolation philosophy and benefit from shared context. The `logOriginReject` leak and the `bundled-themes.test.ts` coupling are both "accept a documented limitation or engineer around it" calls — pick one approach and apply consistently.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `test(cluster 14-test-quality-fixes, 2026-04-21): fix tautological logOriginReject assertion + resolve state-leak concerns`.
2. Note specifically that the tautological assertion is the headline — the rest is cleanup.
3. No `Depends-on:` chain.
