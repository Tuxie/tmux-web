---
Status: closed
Autonomy: needs-decision
Resolved-in: 3fc0c49b2b6b6fa6d57edb4738ed9186734767b6
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 18 — test-flaky-sleeps

## TL;DR

- **Goal:** Replace ~17 raw `setTimeout` waits in `ws-handle-connection.test.ts` and four e2e specs with event-driven or poll-with-condition completion signals, where signals exist.
- **Impact:** Reduces test-time flake risk under CI load; recovers ~2-3 seconds per `bun test` run from sleeps that bound nothing observable; makes test intent explicit (each remaining sleep documents why no signal exists).
- **Size:** Large (full day; 9 distinct call-site groups, each requires a per-case decision).
- **Depends on:** none
- **Severity:** Medium
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Large · Analysts: Test · Depends on: none · Autonomy: needs-decision

## Files touched

- `tests/unit/server/ws-handle-connection.test.ts` (multiple findings)
- `tests/e2e/control-mode-window-size.spec.ts`
- `tests/e2e/control-mode-notifications.spec.ts`
- `tests/e2e/title.test.ts`
- `tests/e2e/keyboard.test.ts`
- `tests/e2e/menu-session-switch-content.spec.ts`

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 2 · Low: 1
- autofix-ready: 1 · needs-decision: 2 · needs-spec: 0

## Findings

- **Wall-clock sleeps as completion signals (CONC-7 / TEST-11) in `ws-handle-connection`** — At least 17 raw `setTimeout` waits are used as synchronisation primitives in the WS integration test (e.g. `setTimeout(r, 100)`, `300`, `350`, `400`, `650`, `1500`). Several have a real completion signal available: `setTimeout(r, 30)` after `attached.includes('main')` could be replaced with the next `waitForMsg` for the post-attach frame; `setTimeout(r, 30)` at line 1281 ("let the catch block in switchSession run") could observe `detached`/`attached` arrays directly; `setTimeout(r, 1500)` at line 245 is bounding the BLAKE3 hash of a 100MB binary with no observable. The fuzz sleep at line 245 makes `make test-unit` 1.5s slower per run.
  - Location: `tests/unit/server/ws-handle-connection.test.ts:208`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:240`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:245`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:493`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:506`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:1015`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:1190`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:1281`
  - Severity: Medium · Confidence: Verified · Effort: Large · Autonomy: needs-decision
  - Cluster hint: `flaky-sleeps`
  - Notes: Several sleeps are genuinely unavoidable (e.g. tmux `%session-renamed` IPC has no JS-observable). Each call site needs a per-case decision: keep + comment why no signal exists, or replace with the existing `waitFor`/`waitForMsg` helpers already defined in the same file. The 650ms sleep at line 1015 is bounding the production code's 500ms `setTimeout` retry — fix in production by surfacing the retry as an event the test can `waitFor`, or by parameterising the retry delay.
  - Raised by: Test

- **Wall-clock sleeps in e2e tests (TEST-11)** — `control-mode-window-size.spec.ts:20` waits 500ms after page load for "attach + refresh-client a beat" before reading `tmux display-message #{window_width}x#{window_height}`. There is no completion signal: a slower CI worker may read the size before the resize message round-trips and the test will report a phantom regression. `control-mode-notifications.spec.ts:30` waits 250ms for "the control client to attach" before counting `events`. `title.test.ts:31` waits 200ms then asserts the topbar did NOT change — a true negative-assertion sleep, but the duration is hardcoded.
  - Location: `tests/e2e/control-mode-window-size.spec.ts:20`
  - Location: `tests/e2e/control-mode-notifications.spec.ts:30`
  - Location: `tests/e2e/title.test.ts:31`
  - Location: `tests/e2e/keyboard.test.ts:25`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `flaky-sleeps`
  - Notes: For `control-mode-window-size` the right signal is `expect.poll(() => isolatedTmux.tmux(['display-message', '-p', '#{window_width}']))` already used elsewhere — converting the 500ms sleep to a poll fixes the flake risk. For `control-mode-notifications` the test could subscribe to the `framereceived` event and `expect.poll` the `events.length` counter instead of `events.length` after a fixed delay.
  - Raised by: Test

- **Misleading e2e sanity check: `await page.waitForTimeout(SETTLE_AFTER_COMPLETED_SWITCH_MS)` between every iteration** — `tests/e2e/menu-session-switch-content.spec.ts:96` does `await page.waitForTimeout(SETTLE_AFTER_COMPLETED_SWITCH_MS)` (200ms) between every iteration of the menu-switch loop. Each switch already polls `waitForDisplayedSession` to confirm the target marker is present and the stale ones are gone — the additional 200ms is a defensive sleep with no signal, paying ~4s per full run for no observable gain.
  - Location: `tests/e2e/menu-session-switch-content.spec.ts:96`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `flaky-sleeps`
  - Fix: Drop the `await page.waitForTimeout(SETTLE_AFTER_COMPLETED_SWITCH_MS)` and the `SETTLE_AFTER_COMPLETED_SWITCH_MS` constant; the prior `waitForDisplayedSession(target)` poll already proves the switch is observable in the buffer. If a regression surfaces from the removal it would be the `staleMarkers` poll failing, and that is the right place to add a longer timeout — not a blanket sleep.
  - Raised by: Test

## Suggested session approach

Per-case decision pass — open `ws-handle-connection.test.ts` and walk each `setTimeout` site, deciding either (a) replace with `waitFor`/`waitForMsg`/`expect.poll`/event observer, or (b) keep with a one-line comment naming why no signal exists ("tmux IPC has no JS-observable for %session-renamed delivery"). The 1500ms sleep at line 245 (BLAKE3 hash of 100MB binary) can be reduced or replaced with a smaller-binary fixture — file size doesn't matter for the test's invariant.

Apply the e2e poll-replacements (`control-mode-window-size`, `control-mode-notifications`) as a separate commit; they have clear `expect.poll` shapes already documented in the analyst's note. Apply the `menu-session-switch-content` settle-time removal as the autofix-ready piece in the same commit set.

Per cluster 15 (backend-low-cleanup), the production `http.ts:620 setTimeout(() => process.exit, 100)` shares this pattern; consider fixing both in coordinated commits since the test side relies on production lifecycle observability.
