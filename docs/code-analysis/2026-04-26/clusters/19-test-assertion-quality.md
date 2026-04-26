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

# Cluster 19 — test-assertion-quality

## TL;DR

- **Goal:** Replace `expect(true).toBe(true)` tautologies and weak `toBeDefined()` assertions with concrete observables; fix one mock-float pattern flagged as fragile.
- **Impact:** Tests that pass for the right reason. Today, three tests use tautologies after sleeps where a regression would still pass; a half-dozen `toBeDefined` calls assert presence when the surrounding test already captured the expected value.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium (highest in cluster)
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Test · Depends on: none · Autonomy: needs-decision

## Files touched

- `tests/unit/server/ws-handle-connection.test.ts` (1 finding, 2 sites)
- `tests/unit/client/ui/clipboard.test.ts` (1 finding)
- `tests/unit/server/api-session-settings.test.ts`, `tests/unit/server/sessions-store.test.ts`, `tests/unit/client/session-settings.test.ts` (1 finding, multiple sites)
- `tests/unit/server/ws-handle-connection.test.ts:769` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 3
- autofix-ready: 1 · needs-decision: 3

## Findings

- **Two `expect(true).toBe(true)` tautologies in WS connection test** — Lines 246 and 259 of `tests/unit/server/ws-handle-connection.test.ts` end with `expect(true).toBe(true)` after a 1500ms / 50ms `setTimeout` sleep. The "ws closed during resolvePolicy" test (line 212–247) sleeps 80ms + 1500ms then asserts a tautology — there is no observable for the prompt-emission guard branch beyond "did not throw," and the comment admits "No specific observable from outside." A bug introduced into `replyToRead`/guard path that throws asynchronously would still pass because the catch in fake-tmux harness or unhandled rejection wouldn't fail the test. The `ws abrupt close` (line 249–260) variant is similarly a no-throw smoke test.
  - Location: `tests/unit/server/ws-handle-connection.test.ts:246`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:259`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `assertion-quality`
  - Notes: For T2 the genuine fix is to pick a real observable (e.g. capture `process.stderr.write` for the debug-log `prompt suppressed (ws closed)` line, or assert a counter on the close-handler). At minimum, `expect(true).toBe(true)` should become `expect(o.ws.readyState).toBe(WebSocket.CLOSED)` so the harness state is tied to a reading.
  - Raised by: Test

- **Tautological `expect(true).toBe(true)` after `swallows writeText rejection`** — `tests/unit/client/ui/clipboard.test.ts:51` calls `handleClipboard(btoa('x'))` whose internal `navigator.clipboard.writeText` is set to throw, then asserts `expect(true).toBe(true)`. The intent (no unhandled rejection) is reasonable but the assertion proves nothing — a regression where `handleClipboard` re-throws asynchronously would still pass.
  - Location: `tests/unit/client/ui/clipboard.test.ts:51`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `assertion-quality`
  - Fix: Replace the tautology with an unhandled-rejection capture: install a `process.on('unhandledRejection', …)` (or `addEventListener('unhandledrejection', …)`) before the call, await a microtask, and assert no rejection was raised. Alternative: capture the `console.warn` silencer buffer via `consoleCaptured('warn')` from the silence-console preload and assert exactly one entry with the rejection message (matching the production fallback).
  - Raised by: Test

- **`expect(...).toBeDefined()` over `toEqual`/`toMatchObject` weakens several positive assertions** — Concrete sites where the test merely confirms presence of a returned object without asserting fields: `api-session-settings.test.ts:80` (`expect(cfg.sessions.a).toBeDefined()` after a merge — should assert `cfg.sessions.a.colours === SAMPLE.colours`). `sessions-store.test.ts:59,109,133,146` likewise. `pty.test.ts:110-113` asserts every required env var is defined but not its value (the next line of the file already exhaustively checks values, so this group is redundant rather than weak — file as a duplicate). `client/protocol.test.ts:43` asserts `result.terminalData` is defined when an exact comparison is feasible.
  - Location: `tests/unit/server/api-session-settings.test.ts:80`
  - Location: `tests/unit/server/sessions-store.test.ts:59`
  - Location: `tests/unit/client/session-settings.test.ts:73,128,194,280`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `assertion-quality`
  - Fix: Replace `expect(x).toBeDefined()` with `expect(x).toMatchObject({ field: expected })` for the field the test was actually verifying. Most call sites already capture the expected value in the surrounding code.
  - Raised by: Test

- **TEST-12 / CONC-6: floating promise `tmuxControl.run(args)` leaks under `runInSession`** — `tests/unit/server/ws-handle-connection.test.ts:769` defines `tmuxControl.runInSession` that returns `tmuxControl.run(args)` from a closure. The closure references `tmuxControl` before its full literal completes (`const tmuxControl: TmuxControl = { … runInSession: async (session, args) => { … return tmuxControl.run(args); } }`). The mock works in practice because the closure is only invoked after the literal completes, but a similar pattern was the source of bug 2/3/4 in the very same file (cluster `switchSession` race) where mock `attachSession` floats. None of these mocks attach `.catch()` handlers, and a real production bug that introduced a synchronous throw in the harness would surface as an unhandled rejection in test output rather than a typed failure.
  - Location: `tests/unit/server/ws-handle-connection.test.ts:769`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `assertion-quality`
  - Notes: Real harness-level pattern fix is to require `try/catch` around all mock async fns that delegate to other mocks. T2 acceptable to file but probably not worth a fix unless the harness grows further.
  - Raised by: Test

## Suggested session approach

Subagent-driven for the autofix-ready findings (`toBeDefined` → `toMatchObject` sweep, tautology replacement in `clipboard.test.ts`); the WS-test tautologies need a maintainer interview to pick the observable. Verify with `make test-unit`. The mock-float pattern is filed for awareness only — fix only if the harness grows further.
