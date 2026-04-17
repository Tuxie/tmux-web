# Cluster 08 — css-theming

> **Goal:** Enforce the `base.css` (structural) / `themes/*` (look-and-feel) split so themes don't have to fight the cascade with `!important`.
>
> Session size: Small · Analysts: Frontend · Depends on: none

## Files touched

- `src/client/base.css` (2 findings)
- `themes/default/default.css`, `themes/amiga/amiga.css` (1 shared duplication)
- `themes/amiga/amiga.css` (1 `!important`)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 3
- autofix-ready: 1 · needs-decision: 2 · needs-spec: 0

## Findings

- **`base.css` contains hardcoded dark-theme colours in UI primitives** — `.menu-input-select`, `.menu-input-number`, `.tw-toast`, `.tw-clip-prompt-card`, `.tw-clip-prompt-btn-*` carry fixed dark palette hex values (`#262626`, `#1e1e1e`, `#5a2a2a`). These belong structurally in `base.css` but the palette is dark-hardcoded, forcing themes to re-declare the entire block to reskin. The Amiga theme currently invisibly inherits the default dark palette for toasts and the clipboard-prompt modal.
  - Location: `src/client/base.css:32-122`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `css-theming`
  - Raised by: Frontend
  - Notes: Options: (a) define CSS custom properties (`--tw-surface-bg`, `--tw-surface-border`) in `base.css` and override per theme; (b) move the colour-carrying declarations out of `base.css` entirely into each theme. (a) is lighter-touch.

- **`.tw-dd-hidden-select` rule duplicated verbatim in both theme CSS files** — Structural rule (visually hides the wrapped `<select>`) appears identically in `themes/default/default.css:45-52` and `themes/amiga/amiga.css:256-263`. Any future theme must copy it again or native selects will appear.
  - Location: `themes/default/default.css:45`, `themes/amiga/amiga.css:256`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `css-theming`
  - Raised by: Frontend
  - Fix: Move the `.tw-dd-hidden-select` ruleset to `src/client/base.css` and delete both theme copies.

- **`amiga.css` uses `!important` on `input { accent-color }` and `#menu-footer:hover`** — Only `!important` uses in theme CSS outside the `.tw-dd-hidden-select` block. The root cause is `base.css:16` (`#menu-dropdown input[type="range"] { accent-color: #aaa }`) — a high-specificity themed colour in `base.css` that themes have to fight.
  - Location: `themes/amiga/amiga.css:422`, `themes/amiga/amiga.css:424`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `css-theming`
  - Raised by: Frontend
  - Notes: Remove `accent-color` from the `base.css:16` rule (it's look-and-feel); let each theme declare its own accent colour without `!important`.

## Suggested session approach

This is really one design choice — whether to introduce CSS custom properties for the shared surface palette or move the look-and-feel lines out of `base.css` — followed by mechanical edits. Do the duplication fix first (smallest win), then decide on the palette strategy, then clean up the two `!important` sites.
