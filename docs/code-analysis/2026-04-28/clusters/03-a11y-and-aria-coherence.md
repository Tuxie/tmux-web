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

# Cluster 03 — a11y-and-aria-coherence

## TL;DR

- **Goal:** Close keyboard-and-AT gaps in the topbar/menu/modal surface (button names, Escape on settings, label association, native-select duplicate, toast live region).
- **Impact:** A keyboard-only or screen-reader user can navigate the auth-gated settings UI without losing orientation; closes the most-impactful keyboard navigation break (settings menu cannot be dismissed with Escape).
- **Size:** Medium (half-day).
- **Depends on:** none.
- **Severity:** Medium (4 findings); Low (6 findings).
- **Autonomy (cluster level):** needs-decision — multiple findings have ≥2 reasonable fix shapes (label vs aria-label, focus-return target).

## Header

> Session size: Medium · Analysts: Accessibility, Styling · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/client/index.html` (1)
- `src/client/ui/topbar.ts` (3)
- `src/client/ui/dropdown.ts` (2)
- `src/client/ui/drops-panel.ts` (1)
- `src/client/ui/clipboard-prompt.ts` (1)
- `src/client/ui/confirm-modal.ts` (1)
- `src/client/ui/toast.ts` (1)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 4 · Low: 6
- autofix-ready: 5 · needs-decision: 5 · needs-spec: 0

## Findings

- **`#btn-session-plus` has no accessible name** — Button's only child is `<span aria-hidden="true">`; the visible `+` glyph comes from a CSS `::before` pseudo on the span (not the button) and is not exposed to AT. No `aria-label` or `title`. Screen readers announce "unlabeled button".
  - Location: `src/client/index.html:40`
  - Location: `themes/default/default.css:89`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `button-names`
  - Fix: Add `aria-label="New session"` to the `<button>` at `index.html:40`.
  - Raised by: Accessibility Analyst
  - Notes: In `tmux-term` desktop context this button closes the desktop window. The browser-context `aria-label="New session"` is correct and an improvement over nothing; the desktop-context override (if any) belongs in the desktop wrapper's DOM patch.

- **Native `<select>` elements remain in tab order after custom-dropdown replacement** — `Dropdown.fromSelect()` moves three native `<select>`s off-screen via `.tw-dd-hidden-select` (absolute, left:-9999px, opacity:0) but does not add `aria-hidden` or `tabindex="-1"`. Keyboard users tabbing the settings menu reach the invisible `<select>`s plus the visible custom dropdown; AT announces both.
  - Location: `src/client/ui/dropdown.ts:391`
  - Location: `src/client/base.css:450`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `hidden-select-duplicate`
  - Fix: In `Dropdown.fromSelect()`, after line 391, add `select.setAttribute('aria-hidden', 'true')` and `select.tabIndex = -1`. (CSS off-screen + ARIA hide + tabindex are all three needed.)
  - Raised by: Accessibility Analyst

- **Settings menu (`#menu-dropdown`) cannot be dismissed with Escape** — `setupMenu` registers no `keydown` Escape handler; menu closes only on outside pointer click. A keyboard user who opens the menu via Space/Enter on `#btn-menu` and tabs in has no Escape path.
  - Location: `src/client/ui/topbar.ts:460`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `menu-keyboard`
  - Fix: In `setupMenu()`, add a document-level capture-phase `keydown` listener registered alongside the existing `onMenuPointerDown`; on `ev.key === 'Escape'` and `!dropdown.hidden`, call `this.setConfigMenuOpen(false); this.opts.focus();`. Push the remover to `this.disposers`.
  - Raised by: Accessibility Analyst

- **Settings panel `#menu-dropdown` lacks ARIA role; trigger uses invalid `aria-haspopup="true"`** — `#menu-dropdown` is a settings form with sliders/checkboxes/`<select>`/buttons — not a menu of selectable items. The trigger sets `aria-haspopup="true"`, which is unknown to many AT implementations. Custom dropdowns correctly use `aria-haspopup="listbox"`.
  - Location: `src/client/ui/topbar.ts:428`
  - Location: `src/client/index.html:52`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `menu-keyboard`
  - Fix: Change `menuBtn.setAttribute('aria-haspopup', 'true')` to `menuBtn.setAttribute('aria-haspopup', 'dialog')` and add `role="dialog"` + `aria-label="Settings"` on `#menu-dropdown`.
  - Raised by: Accessibility Analyst, Styling Analyst

- **Text inputs in session/window menus have no programmatic label** — `buildMenuInputRow` and `showContextMenu` build a `<div>` with `<span class="tw-menu-label">` followed by `<input type="text">`. The span is not a `<label>` element and has no `id`, so there is no `for=` or `aria-labelledby` association. "Name:", "New session:", "New window:" inputs announce without a label.
  - Location: `src/client/ui/topbar.ts:218`
  - Location: `src/client/ui/dropdown.ts:211`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `button-names`
  - Raised by: Accessibility Analyst
  - Notes: Decision: (a) change `createElement('span')` to `createElement('label')` and set `label.htmlFor = input.id`; or (b) `input.setAttribute('aria-label', opts.label)`. Option (b) is the simpler change. Pick once and apply to both call sites consistently.

- **Drop-rows in the panel are not keyboard-accessible** — `.tw-drops-row` are plain `<div>`s with `click` listeners only; no `role`, no `tabindex`, no `keydown`. Keyboard users cannot invoke the re-paste action; the sibling revoke `<button>` works but the primary action is mouse-only.
  - Location: `src/client/ui/drops-panel.ts:43`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `button-names`
  - Fix: Add `row.setAttribute('role', 'button')`, `row.tabIndex = 0`, and a `keydown` listener that calls the same paste logic when `ev.key === 'Enter' || ev.key === ' '`.
  - Raised by: Accessibility Analyst

- **Toast notifications have no ARIA live region** — `.tw-toast-stack` container has no `aria-live`. Screen readers not actively watching DOM miss "Not connected — paste ignored", "Upload failed", "Purged N drops".
  - Location: `src/client/ui/toast.ts:6`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `live-regions`
  - Fix: Add `el.setAttribute('aria-live', 'polite')` and `el.setAttribute('aria-atomic', 'false')` to the container. Error-variant toasts: separate container with `role="alert"` / `aria-live="assertive"`, or set `role="alert"` per toast when `opts.variant === 'error'`.
  - Raised by: Accessibility Analyst

- **Modals do not return focus to the triggering element on close** — Both `showClipboardPrompt` and `showConfirmModal` call `backdrop.remove()` and resolve without `focus()`-ing the prior `document.activeElement`. After close, focus lands on `document.body`; xterm refocus happens only on the next keydown via `onDocKeydown`.
  - Location: `src/client/ui/clipboard-prompt.ts:70`
  - Location: `src/client/ui/confirm-modal.ts:81`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `modal-focus`
  - Raised by: Accessibility Analyst
  - Notes: Decision: (a) call `adapter.focus()` inside `finish()` (requires plumbing the focus callback through); (b) add a `returnFocus` parameter to the modal API. Either works for this terminal-centric app.

- **Range slider `aria-label` text diverges from paired `<label for=>` text on number inputs** — Visible `<label>` text (e.g. "Top") is associated with the `<input type="number">` via `for=`, not with the `<input type="range">`. Range gets `aria-label` instead, sometimes more descriptive (e.g. "Background top"). Sighted users see one label; AT users hear two different ones for the same conceptual slider.
  - Location: `src/client/index.html:116`
  - Location: `src/client/index.html:121`
  - Location: `src/client/index.html:106`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `label-mismatch`
  - Raised by: Accessibility Analyst
  - Notes: Two fix shapes — align the `aria-label` text with the visible `<label>` (loses descriptive context); or expand the visible `<label>` text and keep `aria-label` matched. Choose once for the seventeen slider/number-input pairs.

- **Color-only signal partially mitigated on session status dots** — Session status dots use color (green/grey) for running/stopped. `base.css:426` adds a hollow-vs-filled shape cue for stopped sessions. `topbar.ts:303` adds `role="img"` + `aria-label`. Net: AT users get text; colour-blind users get shape on stopped only. Running is still colour-only.
  - Location: `src/client/base.css:426`
  - Location: `src/client/ui/topbar.ts:303`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `palette-and-contrast`
  - Raised by: Accessibility Analyst (joint with Styling under A11Y-3)
  - Notes: Existing mitigation is sufficient at T1. Polish option: distinct shapes (square for stopped, circle for running) or text inside the dot. AT path is fully covered by `aria-label`.

## Suggested session approach

Open the cluster as one PR. Start with the autofix-ready items (`#btn-session-plus` aria-label, settings menu Escape handler, hidden-select aria-hidden + tabindex, drop-row keyboard, toast live region) — these ship in ~30 minutes and cover the most-impactful keyboard breaks. Then bring up the two needs-decision items (text-input labelling, modal focus return) in a short brainstorm; pick the simpler shape for each (likely `aria-label` for inputs, `adapter.focus()` for modals) and apply consistently. The slider label mismatch is a polish item; defer to a separate PR if scope creeps.
