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

# Cluster 12 — frontend-topbar-teardown

## TL;DR

- **Goal:** Bring the Topbar's lifecycle into the project's `__twDispose` teardown contract, plus close two small Topbar-state edge cases.
- **Impact:** The Topbar registers five document-level event listeners that are not part of the `__twDispose` chain; multi-mount harnesses (e2e, future window-reuse) leak handlers across mounts. CHANGELOG points at `docs/ideas/topbar-full-coverage-harness.md` as the deferred tracking location.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Frontend · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/client/ui/topbar.ts` (3 findings)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 2
- autofix-ready: 1 · needs-decision: 1 · needs-spec: 1

## Findings

- **Topbar global event listeners have no teardown path** — `setupSessionMenu` and `setupAutoHide` register `document.addEventListener('mousemove', …)` and `document.addEventListener('mouseup', …)` (and `pointerdown` and `fullscreenchange`) directly without storing the handler refs or wiring them into the `__twDispose` chain. `Connection`, `mouse.ts`, `keyboard.ts`, `file-drop.ts`, `dropdown.ts` all expose proper teardowns; `topbar.ts` does not. The 2026-04-21 cluster 10 work added `__twDispose` so multi-mount harnesses can clean up, but the topbar listeners silently leak across mounts and across e2e tests that recreate the page state. CLAUDE.md cites a `topbar-full-coverage-harness` doc as deferred.
  - Location: `src/client/ui/topbar.ts:346` (mousemove for titlebar drag)
  - Location: `src/client/ui/topbar.ts:354` (mouseup for titlebar drag)
  - Location: `src/client/ui/topbar.ts:417` (pointerdown for menu close)
  - Location: `src/client/ui/topbar.ts:438` (fullscreenchange)
  - Location: `src/client/ui/topbar.ts:833` (mousemove for autohide reveal)
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `topbar-teardown`
  - Notes: tracked indirectly in `docs/ideas/topbar-full-coverage-harness.md`. Decision needed because the orchestrator chose to expose `__twDispose` but the topbar was not retro-fitted; the fix shape (return a dispose array from `Topbar.init`, accept it from `main()`) is straightforward but cuts across the class API.
  - Raised by: Frontend

- **`#tb-title` mousedown handler stops `pendingTitleDrag` reset on right-click + drag** — `setupSessionMenu` only sets `pendingTitleDrag` on `ev.button === 0`, but the `mouseup` handler at line 354 unconditionally clears it: `pendingTitleDrag = null;`. Inverted: a non-left-button mousedown leaves `pendingTitleDrag === null` (good), but if the user middle-clicks in `tb-title` between a left-mousedown and left-mouseup, the middle's mouseup clears the pending drag and a subsequent move past the threshold no longer notifies the host. Edge-case but worth noting because the symptom is silent (drag-to-restore doesn't fire) and the fix is one line.
  - Location: `src/client/ui/topbar.ts:342-356`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `topbar-titlebar-drag`
  - Fix: In the mouseup handler, gate the clear: `if (ev.button === 0) pendingTitleDrag = null;` (matches mousedown's filter).
  - Raised by: Frontend

- **`Topbar` constructor depends on `getLiveSettings` callback that never resolves on cold start** — `getLiveSettings: () => SessionSettings | null` returns `null` during the boot path before settings load completes. `getSettings()` inside `setupSettingsInputs` calls `loadSessionSettings(name, live, …)` which falls through to defaults — fine. But `commitAutohide` at line 810 calls `loadSessionSettings(this.currentSession, this.opts.getLiveSettings(), ...)` — the `live` here is `null` on cold start, so the autohide checkbox click before settings load would commit defaults overwriting whatever the user had. Likely unreachable in practice (settings load before topbar.init resolves), but the path exists.
  - Location: `src/client/ui/topbar.ts:810-819`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-spec
  - Cluster hint: `topbar-init-order`
  - Notes: Boot order via `main()` awaits `initSessionStore` before constructing Topbar (index.ts:73), so the user can't physically interact with the autohide checkbox before live settings exist. Listed defensively.
  - Raised by: Frontend

## Suggested session approach

Brainstorming pass on the teardown contract — the fix is a class API change (return a dispose array from `Topbar.init`; thread through `main()`). Apply the titlebar-drag one-liner in the same commit. The init-order finding is documentation-only at minimum; if the maintainer wants belt-and-braces, add a guard in `commitAutohide` that early-returns on `null` live settings.

The deferred `docs/ideas/topbar-full-coverage-harness.md` is the natural target for the Resolved-in commit message reference.
