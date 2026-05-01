---
Status: open
Autonomy: needs-decision
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 02 — test-sleep-poll-cleanup

## TL;DR

- **Goal:** Replace fixed sleeps in unit/integration tests with explicit completion signals (event resolves, fake timers, exported retry constants) where they exist; for genuinely event-less paths, document the necessity and replace magic literals with imported production constants.
- **Impact:** Removes asymmetric flake risk under CI load; future production-timer changes auto-propagate to test wait budgets via shared named constants instead of going stale silently.
- **Size:** Medium (half-day).
- **Depends on:** none.
- **Severity:** Low.
- **Autonomy (cluster level):** needs-decision — most findings have ≥2 reasonable fix shapes (event-based vs constant-export vs accept-the-sleep-with-doc).

## Header

> Session size: Medium · Analysts: Test · Depends on: none · Autonomy: needs-decision

## Files touched

- `tests/unit/server/pty-integration.test.ts` (2 sites)
- `tests/unit/server/ws-integration.test.ts` (6 sites)
- `tests/unit/server/ws-handle-connection.test.ts` (4 sites)
- `tests/unit/server/http-branches.test.ts` (2 sites)
- `tests/unit/server/file-drop.test.ts` (2 sites)
- `tests/unit/server/hash-cached.test.ts` (1 site)
- `tests/unit/server/_harness/fake-tmux.ts` (1 site)
- `src/server/ws.ts` (incidental — for constant exports)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 8
- autofix-ready: 0 · needs-decision: 8 · needs-spec: 0

## Findings

- **`pty-integration.test.ts`: write-then-sleep instead of event-driven `onData`** — Lines 14 and 37 use `await new Promise(r => setTimeout(r, 80))` and `setTimeout(150)` to wait for PTY echo / short-shell exit. The PTY `onData` and `onExit` callbacks are registered on the same object — proper completion signals exist.
  - Location: `tests/unit/server/pty-integration.test.ts:14`
  - Location: `tests/unit/server/pty-integration.test.ts:37`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-sleep-poll`
  - Raised by: Test Analyst
  - Notes: For line 14, resolve a promise from inside `onData` once `chunks.join('').includes('hello')`. For line 37 (default no-op closures, `onExit` never fires), accept the bounded sleep but document the absence of a completion signal.

- **`ws-integration.test.ts`: six fire-and-forget assertions with bounded sleeps** — Six tests send a WS message then sleep 20–30 ms before asserting "no crash". The server processes the message without observable output, so no completion signal exists from the server side in test mode. `waitForMsg` in the same suite shows the proper pattern for cases that do produce output. Sleeps are 20–30 ms — shorter than the 50+ ms minimum used in the larger `ws-handle-connection.test.ts` harness for the same wait class.
  - Location: `tests/unit/server/ws-integration.test.ts:58`
  - Location: `tests/unit/server/ws-integration.test.ts:75`
  - Location: `tests/unit/server/ws-integration.test.ts:83`
  - Location: `tests/unit/server/ws-integration.test.ts:91`
  - Location: `tests/unit/server/ws-integration.test.ts:99`
  - Location: `tests/unit/server/ws-integration.test.ts:107`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-sleep-poll`
  - Raised by: Test Analyst
  - Notes: Calibration pass — bring all six sleeps up to the harness floor (50 ms minimum), or instrument production code with a test-only echo/sentinel so these branches gain a completion signal.

- **`ws-handle-connection.test.ts:177,323` — 300 ms negative-assertion sleeps without a verified lower bound** — Both tests sleep 300 ms before asserting an event did NOT happen (OSC 52 read with unresolvable foreground; deny path). The 300 ms ceiling is reasonable, but the tests do not first wait for the trigger arrival, so a slow CI host could let the trigger fire after the assertion window.
  - Location: `tests/unit/server/ws-handle-connection.test.ts:177`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:323`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-sleep-poll`
  - Raised by: Test Analyst
  - Notes: Add a `waitFor` that the fake-tmux trigger has been processed by the server (via existing observable signal) before starting the 300 ms negative window. Tightens the lower bound without changing production code.

- **`ws-handle-connection.test.ts:1174` — 650 ms sleep for production 500 ms retry timer** — Spans a 500 ms `setTimeout` retry in `applyColourVariant`. If the production retry delay changes, this assertion becomes vacuous (catch branch may not have run yet when test passes). The 500 ms constant is a magic literal in `ws.ts` rather than an exported named constant.
  - Location: `tests/unit/server/ws-handle-connection.test.ts:1174`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-sleep-poll`
  - Raised by: Test Analyst
  - Fix: Export `COLOUR_VARIANT_RETRY_MS = 500` from `src/server/ws.ts`; in the test, use `await Bun.sleep(COLOUR_VARIANT_RETRY_MS + 150)`.

- **`ws-handle-connection.test.ts:556` — 350 ms sleep covers the `[0,25,75,150,300]` startup retry budget** — Comment correctly cites the production budget but the budget is hard-coded. Future schedule changes pass tests with incomplete coverage.
  - Location: `tests/unit/server/ws-handle-connection.test.ts:556`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-sleep-poll`
  - Raised by: Test Analyst
  - Fix: Export `STARTUP_WINDOW_RETRY_BUDGET_MS = 300` (or the schedule array) from `src/server/ws.ts`; assert against the named constant.

- **`http-branches.test.ts:912,938` — 110 ms sleep for production 100 ms exit timer (10 ms margin)** — Tight margin; insufficient on a heavily loaded CI host. `tests/unit/server/api-exit-lifecycle.test.ts` already tests the same path correctly (awaits `exitFired` directly).
  - Location: `tests/unit/server/http-branches.test.ts:912`
  - Location: `tests/unit/server/http-branches.test.ts:938`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-sleep-poll`
  - Raised by: Test Analyst
  - Notes: Two options: (a) replace the sleep with `await exitFired` per `api-exit-lifecycle.test.ts`; (b) delete these two tests as redundant with `api-exit-lifecycle.test.ts`. Option (b) is the cleaner choice — the dedicated lifecycle file post-dates `http-branches.test.ts` and supersedes its coverage.

- **`file-drop.test.ts:435,536` — `armAutoUnlink` and `startPeriodicSweep` use sequential sleeps for inotify timing** — Up to five sequential `setTimeout(50–250)` calls plus a busy-wait (lines 435–443, 456, 465, 536). Inotify is a kernel event, not a JS observable; polling is justified. The complaint is the hardcoded `+ 2500` margin at line 441 — this should derive from `AUTO_UNLINK_GRACE_MS` to avoid silent breakage.
  - Location: `tests/unit/server/file-drop.test.ts:435`
  - Location: `tests/unit/server/file-drop.test.ts:536`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-sleep-poll`
  - Raised by: Test Analyst

- **`hash-cached.test.ts:50` — 20 ms sleep for filesystem mtime resolution** — Test relies on wall-clock mtime advancing between writes. Filesystems with coarser mtime (HFS+ at 1 s, `relatime`-mounted ext4) could skip the increment; the test would silently pass even on a stale-cache hit.
  - Location: `tests/unit/server/hash-cached.test.ts:50`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `test-determinism`
  - Raised by: Test Analyst
  - Notes: Use `fs.utimesSync(path, mtime + 1ms)` explicitly rather than relying on wall-clock advancement. The production code is Linux-only (ext4 ms-resolution), so the practical risk is theoretical at T1; the fix is a one-liner.

- **`fake-tmux.ts:83` — `sleep 0.15` shell trigger introduces wall-clock dep** — `(sleep 0.15; cat "${dir}/trigger") &` delays PTY trigger injection. Under heavy CI load the 150 ms shell sleep can exceed the test's narrow assertion window.
  - Location: `tests/unit/server/_harness/fake-tmux.ts:83`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `test-determinism`
  - Raised by: Test Analyst
  - Notes: Alternative is a sentinel-file write the server emits after attaching, but requires production-code changes. For T1 the current approach is acceptable; the OSC 52 tests carry 8 s `waitForMsg` ceilings on the assertion side that already absorb most jitter.

## Suggested session approach

This is mostly a refactor session, not a brainstorm. Start by exporting the timing constants from `src/server/ws.ts` (covers two findings cleanly). Then for `ws-integration.test.ts` decide one floor (50 ms is the existing harness floor) and apply it to all six sites in one pass. For `pty-integration.test.ts:14` rewrite the sleep to event-based; line 37 keep + comment. For `http-branches.test.ts` either delete both tests or migrate to the `api-exit-lifecycle.test.ts` pattern — recommend delete since the dedicated test already covers the path. The remaining findings (file-drop, hash-cached, fake-tmux) are small mechanical fixes that ship in the same commit. Single PR, six-file diff.
