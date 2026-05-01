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

# Cluster 01 — async-fire-and-forget

## TL;DR

- **Goal:** Wrap fire-and-forget async calls in `void` and surface their errors so silent rejection on PTY/topbar/font-load paths can no longer hide bugs.
- **Impact:** A throw inside any of these async chains today disappears silently; this cluster makes such throws visible (toast, log, or recoverable handler) so the WS state and user-visible UI cannot drift from the server's state because of an unobserved failure.
- **Size:** Small (<2h).
- **Depends on:** none.
- **Severity:** Medium (Backend WS state divergence on PTY title/read handler throw); rest Low.
- **Autonomy (cluster level):** needs-decision (3 of 5 are autofix-ready; 2 need a UX/error-surfacing decision — what to do when the rejection lands).

## Header

> Session size: Small · Analysts: Backend, Frontend · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/ws.ts` (1 finding, 2 sites)
- `src/client/ui/topbar.ts` (3 sites of one finding)
- `src/client/index.ts` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 4
- autofix-ready: 3 · needs-decision: 2 · needs-spec: 0

## Findings

- **Fire-and-forget `handleTitleChange` and `handleReadRequest` on the PTY hot path** — `void handleTitleChange(ws, ...)` and `void handleReadRequest(ws, ...)` in the PTY `onData` callback are fire-and-forget. If either throws after partial state mutation (subscriptions torn down, session not yet switched), the WS is left inconsistent with no recovery path.
  - Location: `src/server/ws.ts:339`
  - Location: `src/server/ws.ts:348`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-void-cast`
  - Raised by: Backend Analyst
  - Notes: Decision: error-handling shape — log + telemetry counter, log + clientLog round-trip, or catch + best-effort state rollback. Pick one consistently for every WS handler entry point.

- **`onSettingsChange` async return silently dropped on three topbar callsites** — `TopbarOptions.onSettingsChange` is typed `(s: SessionSettings) => void | Promise<void>` and the callback in `src/client/index.ts` is async (awaits `applyTheme`, mutates adapter options). Three call sites in `topbar.ts` invoke it without `void` cast or `await`. The fourth callsite (line 1282) correctly uses `void`. Any rejection from the async chain is silently swallowed.
  - Location: `src/client/ui/topbar.ts:622`
  - Location: `src/client/ui/topbar.ts:758`
  - Location: `src/client/ui/topbar.ts:892`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `async-void-cast`
  - Fix: Add `void` before each of the three callsites: `void this.opts.onSettingsChange?.(updated);`.
  - Raised by: Frontend Analyst
  - Notes: Enshrined-test check — `tests/` mocks accept the call but do not assert on the return; no enshrined-test conflict.

- **`document.fonts.load` promise floats without surfacing the error reason** — After a font change that does not require reload, `document.fonts.load(...)` is chained with `.then(() => adapter.fit()).catch(() => adapter.fit())`. The error branch correctly calls `adapter.fit()` (so the terminal does not freeze), but swallows the error reason. Production deployments see the wrong font with no hint why.
  - Location: `src/client/index.ts:284`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `async-void-cast`
  - Raised by: Frontend Analyst
  - Notes: Decision: silent recovery is correct UX (terminal does not freeze) but invisible failures hurt diagnosis. A `console.warn(err)` is the lightest fix. Aligning with the cluster-wide error-surfacing decision is preferable to a one-off.

## Suggested session approach

Decide once for the run: when an async fire-and-forget rejects, what surfaces? Pick one of (a) `console.warn` only, (b) `clientLog` round-trip to the server, (c) toast for user-visible failures. Apply that decision uniformly to all three callsites — three of these (the topbar `void` adds) are mechanical and ship as autofix; the two that need a real error handler (PTY hot path + font load) ship in the same commit so the rule arrives all at once. Subagent dispatch is fine for the autofix portion; the PTY-handler error decision benefits from a 5-minute brainstorm before code.
