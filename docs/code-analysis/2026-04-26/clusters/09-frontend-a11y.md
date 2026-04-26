---
Status: open
Autonomy: autofix-ready
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 09 — frontend-a11y

## TL;DR

- **Goal:** Three a11y fixes covering form-control labelling, modal focus trap, and dynamic button defaults.
- **Impact:** Real screen-reader regression closure on the auth-gated UI: form-control values are announced without their label, modal Tab leaks focus back to the page below, and dynamic buttons inherit `type="submit"` semantics.
- **Size:** Small (<2h).
- **Depends on:** none
- **Severity:** Medium (highest in cluster)
- **Autonomy (cluster level):** autofix-ready

## Header

> Session size: Small · Analysts: Frontend · Depends on: none · Autonomy: autofix-ready

## Files touched

- `src/client/index.html` (1 finding)
- `src/client/ui/topbar.ts` (1 finding, partial)
- `src/client/ui/drops-panel.ts` (1 finding, partial)
- `src/client/ui/clipboard-prompt.ts` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 2
- autofix-ready: 2 · needs-decision: 1

## Findings

- **Settings-menu sliders/selects/number inputs lack programmatic label association** — The settings menu renders every form control under a sibling `<span class="tw-menu-label">…</span>` instead of a real `<label for="…">` (or wrapping the control in a `<label>`). Screen readers therefore announce only the control's own role/value when focus lands on it, not the visible label. The HTML has 17 sliders, 4 number inputs, and 3 selects in this shape; only the four checkbox rows (`chk-autohide`, `chk-scrollbar-autohide`, `chk-fullscreen`, `chk-subpixel-aa`) wrap their input in `<label>`. The 2026-04-21 audit's A11Y-1 cluster gave the dropdowns ARIA roles/keyboard nav but did not fix this orphan-label issue. Affects the entire user-facing settings surface (theme/colour selection, every slider).
  - Location: `src/client/index.html:71-171` (every `tw-menu-row-static` block)
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `a11y-labels`
  - Fix: Convert each `<span class="tw-menu-label">…</span>` to `<label class="tw-menu-label" for="<input-id>">…</label>`. The double-id pattern (e.g. `sld-theme-hue` + `inp-theme-hue` for paired range/number) means picking the number input as the labelled-for target preserves the slider's keyboard semantics; or label both with `aria-labelledby` pointing at one shared `<span id>` if the visible markup must stay neutral.
  - Raised by: Frontend

- **Dynamically-created `<button>` elements default to `type="submit"` and can submit ambient forms** — In `src/client/ui/topbar.ts` and `src/client/ui/drops-panel.ts`, several `document.createElement('button')` calls create buttons without setting `.type = 'button'`. Most are appended outside any `<form>`, but the missing default is fragile: if a future feature ever wraps the menu in a form (or these buttons are mounted inside a host page that does), each click will submit. The session-delete button at topbar.ts:218 explicitly sets `del.type = 'button'`; the others are inconsistent.
  - Location: `src/client/ui/topbar.ts:1016` (compact window-menu trigger button)
  - Location: `src/client/ui/topbar.ts:1061` (`tw-win-tab` window buttons rebuilt on every push)
  - Location: `src/client/ui/drops-panel.ts:61` (per-row revoke button)
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dom-defaults`
  - Fix: Add `btn.type = 'button';` (and `wrap.type = 'button';` / `revoke.type = 'button';`) immediately after each `document.createElement('button')` call.
  - Raised by: Frontend

- **`clipboard-prompt.ts` modal traps Escape via `document.addEventListener('keydown', onKey, true)` but doesn't trap Tab — focus can leave the modal** — Per WCAG 2.1.2, modal dialogs should trap focus. The clipboard prompt focuses `alwaysBtn` on open and listens for Escape, but Tab/Shift+Tab from any of the three buttons is unhandled — focus walks back to the page (terminal, settings menu, etc.) underneath. For sighted users this is a minor annoyance; for screen-reader users this means the announced "modal" leaks context. Per A11Y-1 / A11Y-2 scope.
  - Location: `src/client/ui/clipboard-prompt.ts:79-95`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `a11y-modal-focus`
  - Notes: The modal also lacks `role="dialog"` and `aria-modal="true"` on `.tw-clip-prompt-card`. Combined fix-shape: add ARIA + Tab trap. T2 fix-size is a few lines.
  - Raised by: Frontend

## Suggested session approach

Subagent-driven for the two autofix-ready findings (form-label conversion + button-type defaults); pair the modal-focus-trap finding with a quick maintainer choice on whether to also add `role="dialog"` + `aria-modal="true"` simultaneously (recommended; same edit). Verify with the existing e2e a11y coverage in `tests/e2e/menu-*.spec.ts` plus a manual NVDA/VoiceOver pass on the settings menu.
