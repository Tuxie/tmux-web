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

# Cluster 13 — frontend-ui-quality

## TL;DR

- **Goal:** Six small UI quality items: slider reset clamp, type-cast density in topbar id-lookup, low-info boot toast, native confirm() destructive dialogs, drag-overlay state, drops-row event ordering.
- **Impact:** Removes a few "papercut" bugs and inconsistencies — slider reset can land an unclamped value into sessions.json from a malformed theme JSON; native `confirm()` is unthemable and behaves badly under the desktop wrapper.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Low (all six)
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Frontend · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/client/ui/topbar.ts` (3 findings)
- `src/client/ui/dropdown.ts` (1 finding — see also cluster 17)
- `src/client/index.ts` (1 finding)
- `src/client/ui/file-drop.ts` (1 finding)
- `src/client/ui/drops-panel.ts` (1 finding — verification only)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 6
- autofix-ready: 1 · needs-decision: 5 · needs-spec: 0

## Findings

- **Slider double-click reset commits without first re-clamping the resolved default** — In `topbar.ts:621-625`, `reset()` resolves `getDefault()` and writes it back without running `sp.clamp(...)`. Theme JSON values are user-controlled (theme packs in `--themes-dir`); a malformed `defaultThemeContrast: -200` would be saved as-is into `sessions.json` even though every other commit path is clamped. Server-side `themes.ts` does its own validation, but the client does not.
  - Location: `src/client/ui/topbar.ts:621-625`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `slider-clamp-consistency`
  - Fix: `const def = sp.clamp(sp.getDefault());` (replace the bare `sp.getDefault()` call).
  - Raised by: Frontend

- **Type assertion overload in topbar's `setupSettingsInputs` (54 explicit casts)** — Twenty-something `document.getElementById('…') as HTMLInputElement` casts in a single function (`setupSettingsInputs`, lines 446-485) and similar density elsewhere. This compiles but every cast loses type safety: a typo in the id, or a stale id after an HTML refactor, becomes a runtime null-deref instead of a compile-time error. Pattern repeats in the 17-row `sliders: SliderSpec[]` table — each row mentions the slider/input pair but the lookup is by string id only.
  - Location: `src/client/ui/topbar.ts:446-485`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `topbar-id-lookup`
  - Notes: Fix shape options: (a) generate a typed id-map module from `index.html` ids at build time (over-engineered for T2); (b) wrap with a tiny `el<T>(id)` helper that throws if missing — reduces bytes and surfaces the missing-id case earlier. (b) is the sized-right T2 fix; (a) is too much process.
  - Raised by: Frontend

- **Boot-error toast message lists labels but no actionable hint** — Toast at `index.ts:87-90` says "Failed to load some UI data (themes, fonts) — settings menu may be incomplete." User can't act on that without devtools. The console.warn entries (per `boot-errors.ts:26-27`) carry the actual error, but they're invisible to a non-developer end-user. T2 desktop wrapper (Electrobun) hides devtools by default. Reasonable as-is for a T2 OSS tool — but the toast is low-info.
  - Location: `src/client/index.ts:84-91`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `boot-errors-ui`
  - Notes: T2 acceptable; flagged for completeness. Fix shape: include the first error detail truncated to ~60 chars in the toast.
  - Raised by: Frontend

- **Native `confirm()` dialogs for destructive tmux actions block focus return to terminal** — `topbar.ts:290` (kill session) and `:977` (close window) use native `window.confirm()`. The block-and-return blocks the JS thread, which the inline comment justifies as "destructive tmux actions are infrequent and a custom modal would duplicate the clipboard-prompt code path for marginal UX gain." But `clipboard-prompt.ts` is already a real custom modal — extending it to handle "kill session" / "close window" is pure reuse, not duplication. Native `confirm()` also can't be themed (Amiga / Scene 2000 themes look out of place when it appears) and behaves badly on the Electrobun desktop wrapper (some webviews suppress it entirely, in which case the action goes through unconfirmed).
  - Location: `src/client/ui/topbar.ts:288-291` (kill session)
  - Location: `src/client/ui/topbar.ts:975-978` (close window)
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `confirm-dialog-modal`
  - Notes: 2026-04-17 audit's UX-1 explicitly considered and rejected this; cited inline at both locations. Re-flagging only because the desktop-wrapper case (silent passthrough on suppressed `confirm`) was added after that decision and changes the calculus. T2 acceptable as-is if desktop suppression is verified safe.
  - Raised by: Frontend

- **`installFileDropHandler`'s `depth` counter can desync with native dragenter/dragleave bubble order** — The depth counter increments on dragenter and decrements on dragleave. Native drag events bubble: a child element's enter+leave through nested DOM nodes can leave depth at +N while only one drag is in flight. Browsers vary in how they fire these. If the user drags out of the terminal, depth may not reach 0, leaving the overlay visible until the next drop. Mitigation: any drop event resets depth to 0. So the failure mode is "overlay stays visible until next drop" — recoverable, not stuck.
  - Location: `src/client/ui/file-drop.ts:65-89`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `drag-overlay-state`
  - Notes: Fix shape: switch to `dragenter` on `terminal` only and `dragleave` only when `e.target === terminal`. Deferred — at T2 the visible-stuck-overlay symptom is rare enough that the cure could be worse.
  - Raised by: Frontend

- **`drops-panel.ts` row-click re-paste handler triggers when revoke-button child is clicked outside the existing `stopPropagation` window** — Per CHANGELOG 1.7.0 "Dropdown click re-paste no longer runs on revoke" was fixed via `stopPropagation()` on the revoke path. The fix as written is correct for the click path; flagging because if the await branch threw before reaching `ev.stopPropagation()` (it doesn't — `stopPropagation` is called first) the row click would re-fire. Defensive: read confirms stopPropagation is line 69, before the try. No bug.
  - Location: `src/client/ui/drops-panel.ts:69`
  - Severity: Low · Confidence: Speculative · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `drops-row-events`
  - Notes: After re-reading: stopPropagation is the very first call in the handler. Closing this finding as no-op verification — verified-in-place.
  - Raised by: Frontend

## Suggested session approach

Brainstorming pass on the four needs-decision findings (topbar-id-lookup helper shape, boot-errors-ui toast detail, confirm-dialog-modal extend-clipboard-prompt vs. accept-as-is, drag-overlay-state fix vs. accept). Apply the slider reset clamp one-liner inline. The drops-row-events finding is documentation-only — no code change needed; if confidence-bumping matters, add a one-line comment confirming the synchronous-stopPropagation invariant.
