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

# Cluster 04 — css-housekeeping

## TL;DR

- **Goal:** Drop dead/duplicate CSS markers and centralise the topbar height token so structural changes touch one declaration, not eighteen.
- **Impact:** Future topbar-height adjustments (HiDPI, larger-font theme pack) become one-line changes; the `:root` block stops misleading editors with same-value duplicates; one vestigial `<div>` stops surviving in the HTML.
- **Size:** Small (<2h).
- **Depends on:** none.
- **Severity:** Low.
- **Autonomy (cluster level):** needs-decision — the magic-number consolidation requires choosing how to express derived offsets (`calc()` vs theme-specific override) and how the `@import base.css` self-sufficiency rule should be documented.

## Header

> Session size: Small · Analysts: Styling · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/client/base.css` (3 sites)
- `themes/amiga/amiga-common.css` (2 sites)
- `themes/default/default.css` (1 site)
- `src/client/index.html` (1 site)
- `src/client/ui/scrollbar.ts` (1 site)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 5
- autofix-ready: 2 · needs-decision: 3 · needs-spec: 0

## Findings

- **Same-value duplicate custom-property declarations in `base.css`** — `--tw-ui-font` declared twice (lines 37 + 566); `--tw-scrollbar-topbar-offset: 28px` declared twice (lines 79 + 579). Both pairs carry identical values. The architecture (structural defaults + theme-layer overrides) is intentional but these two specific properties carry no delta — the duplicates mislead future editors into thinking the theme layer differs.
  - Location: `src/client/base.css:566`
  - Location: `src/client/base.css:579`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `css-variable-hygiene`
  - Fix: Remove the two duplicate declarations from the second `:root` block at lines 566 and 579. The other override entries in the same block (`--tw-gadget-bg`, scrollbar-inset overrides) genuinely differ from the structural defaults and must be kept.
  - Raised by: Styling Analyst

- **Dead `#tb-left` div in `index.html`** — `<div id="tb-left"></div>` is the first child of `#topbar`; no CSS rule across the styling scope targets `#tb-left`, no TypeScript file references it. Vestigial markup from an earlier layout.
  - Location: `src/client/index.html:38`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dead-markup`
  - Fix: Delete `<div id="tb-left"></div>` from `index.html:38`.
  - Raised by: Styling Analyst

- **`.tw-scrollbar-pinned` class is toggled in JS but has no CSS rule** — `scrollbar.ts:109` calls `opts.root.classList.toggle('tw-scrollbar-pinned', !autohide)`; `index.html:178` renders the class. No CSS rule visually differentiates pinned from autohide. The class is a state marker readable by JS only — and no JS reads it either.
  - Location: `src/client/ui/scrollbar.ts:109`
  - Location: `src/client/index.html:178`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `dead-markup`
  - Raised by: Styling Analyst
  - Notes: Decision: document as a CSS hook in `base.css` with an explanatory comment (if future themes are expected to differentiate), or remove from initial HTML and the JS toggle (if no differentiation is planned). Pick once.

- **`28px` topbar-height magic number across 18+ sites** — `28px` literal appears 8 times in `src/client/base.css`, 8 in `themes/amiga/amiga-common.css`, 2 in `themes/default/default.css`. Derived offsets (`top: 31px` in base for default 3 px frame; `top: 29px` in Amiga for 1 px frame) are manually computed.
  - Location: `src/client/base.css:79`
  - Location: `src/client/base.css:599`
  - Location: `src/client/base.css:827`
  - Location: `src/client/base.css:865`
  - Location: `themes/amiga/amiga-common.css:101`
  - Location: `themes/amiga/amiga-common.css:167`
  - Location: `themes/default/default.css:82`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `magic-numbers`
  - Raised by: Styling Analyst
  - Notes: Decision: (a) introduce `--tw-topbar-height: 28px` and replace literals with `var(--tw-topbar-height)`; derived offsets become `calc(var(--tw-topbar-height) + 3px)` in default and `calc(var(--tw-topbar-height) + 1px)` in Amiga. (b) Express each theme's frame offset as a separate variable (`--tw-frame-thickness`) so the `+ 3px`/`+ 1px` literals also disappear. Option (b) is cleaner; option (a) is the minimum change.

- **`base.css` double-loaded via `@import` in every non-Default theme** — `themes/amiga/amiga-common.css:9` `@import url('/dist/client/base.css')` even though `base.css` is already a permanent `<link>` in `index.html`. `themes/default/default.css:13` does the same and explicitly documents it as intentional for standalone self-sufficiency. The Amiga comment does not acknowledge the trade-off.
  - Location: `themes/amiga/amiga-common.css:9`
  - Location: `themes/default/default.css:13`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `stylesheet-load-order`
  - Raised by: Styling Analyst
  - Notes: Decision options — (a) accept the trade-off and add a comment to `amiga-common.css` matching `default.css`'s rationale (status quo, lowest cost); (b) remove `@import` from both and document the required HTML link order (saves a parse but breaks theme-preview pane if such a feature lands later). Option (a) ships now; option (b) requires a design call on whether theme files must be self-sufficient.

## Suggested session approach

Two of the five findings are autofix-ready (delete the duplicate custom-property declarations; delete `#tb-left`) — ship those first as a quick PR. The other three benefit from a 5-minute brainstorm: pick one option for `.tw-scrollbar-pinned` (likely "remove" given it's load-bearing for nothing today), one option for the topbar-height token (recommend (a) — introduce `--tw-topbar-height` and use `calc()` for derived offsets; the per-theme frame-thickness variable is over-engineering for two themes), and one option for the `@import base.css` choice (likely (a) — add the comment, keep the self-sufficiency). Single commit covering all five.
