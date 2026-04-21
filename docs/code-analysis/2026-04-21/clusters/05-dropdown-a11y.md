---
Status: resolved
Resolved-in: da06aa8
---

> **Resolution (2026-04-21) — keyboard contract:**
> ArrowDown/ArrowUp move the active option with wrap at both ends;
> Enter / Space selects; Escape closes. No Home/End, no type-ahead
> (keeps the sessions-dropdown's "New session:" text input clear of
> keystroke ambiguity). Focus stays on the trigger; the active option
> is tracked via `aria-activedescendant`. Listbox semantics apply to
> all five dropdowns (theme / colours / font / sessions / windows).
> Status-dot accessible name uses "Running" / "Not running".


# Cluster 05 — dropdown-a11y

## TL;DR

- **Goal:** The custom dropdown widget used by the Theme / Colours / Font / Sessions / Windows pickers gets `role="listbox"` + `role="option"` + arrow-key navigation, and the session-status dots carry an accessible label beyond colour.
- **Impact:** Keyboard-only users and screen-reader users can currently open the settings menu but cannot navigate the dropdowns within it. Terminal apps skew keyboard-heavy — this is a material usability gap for the tool's likely audience.
- **Size:** Medium (half-day)
- **Depends on:** none
- **Severity:** Medium

## Header

> Session size: Medium · Analysts: Frontend · Depends on: none

## Files touched

- `src/client/ui/dropdown.ts` (2 findings)
- `src/client/ui/topbar.ts` (1 finding — session/window items + status dots)
- `src/client/base.css` (existing border ring for stopped dot already addresses WCAG 1.4.1; aria-label addition layers on top)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 2 · Low: 1
- autofix-ready: 1 · needs-decision: 0 · needs-spec: 2

## Findings

- **Custom dropdown items are `<div>` without `role="option"`; the listbox container has no `role="listbox"`** — `Dropdown` sets `aria-haspopup="listbox"` on the trigger at `dropdown.ts:307`, implying the popup is an ARIA listbox. The generated menu container and `<div>` item elements carry no `role` attributes — screen readers do not enumerate them as options. The same shape holds for the session and window item lists rendered by `topbar.ts:187-225`.
  - Location: `src/client/ui/dropdown.ts:74-107`, `src/client/ui/topbar.ts:187-225`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-spec
  - Cluster hint: `dropdown-a11y`
  - Raised by: Frontend Analyst
  - Notes: Minimum fix: add `role="listbox"` on the menu container and `role="option"` + `tabindex="-1"` on items, with `aria-selected` toggled per active item. Full fix also handles `aria-activedescendant` on the container so screen readers announce the "focused" option without actually moving DOM focus.

- **No keyboard operability for custom dropdown items** — The outer settings menu (`#menu-dropdown`) is toggled by a keyboard-reachable button, but the custom dropdown items inside the menu (`tw-dropdown-item` divs) have no `tabindex` and no `keydown` handler. Keyboard users can Tab through the menu's `<input>` elements but cannot navigate the Theme / Colours / Font dropdowns by arrow key, nor select with Enter/Space.
  - Location: `src/client/ui/dropdown.ts:81-107`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-spec
  - Cluster hint: `dropdown-a11y`
  - Raised by: Frontend Analyst
  - Notes: The ARIA listbox pattern (<https://www.w3.org/WAI/ARIA/apg/patterns/listbox/>) defines the expected keyboard contract: ArrowUp/ArrowDown move focus within the list, Home/End jump to first/last, Enter/Space selects, Escape closes, typing starts a first-letter search. Implementing the minimum subset (ArrowUp/Down + Enter + Escape) covers the common case.

- **Session status dots carry colour-only meaning without a text alternative exposed to AT** — `tw-dd-session-status` circles use only fill colour (green/red) to signal running vs stopped. `base.css:241-242` adds a hollow-border variant for the stopped dot, satisfying WCAG 1.4.1 for low-vision users visually. The `title` attribute is set on the element at `topbar.ts:216-218`, but `title` is not reliably exposed as an accessible name across screen readers. For assistive-tech users, the dot currently has no accessible name at all.
  - Location: `src/client/ui/topbar.ts:216-218`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dropdown-a11y`
  - Fix: Add `aria-label="Running"` / `aria-label="Not running"` (or `"Attached"` / `"Detached"`, per project vocabulary) to the dot `<span>` in addition to the existing `title`.
  - Raised by: Frontend Analyst

## Suggested session approach

Needs design decisions, not just mechanical fixes — start as a short brainstorm. Key questions to resolve up front: (1) do session-menu and setting-menu dropdowns share the same keyboard model (probably yes), (2) should the arrow keys also wrap around at the ends, (3) how does the first-letter type-ahead interact with the Sessions dropdown's "New session:" text input at the bottom (probably disabled there). Once the keyboard contract is written down as a 5-line spec in the cluster fixup PR, the implementation is a few-hour extension of `Dropdown` plus a parallel update in `topbar.ts` for the session/window item list. The status-dot aria-label is a one-liner and can ride along.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `feat(cluster 05-dropdown-a11y, 2026-04-21): add listbox/option semantics and arrow-key nav to custom dropdowns`.
2. If the fix required touching the E2E DOM contract in CLAUDE.md (likely, since `role` attributes may affect the existing `#inp-*-dd` selectors), call it out.
3. No `Depends-on:` chain.
