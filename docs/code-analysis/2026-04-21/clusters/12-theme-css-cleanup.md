---
Status: resolved
Resolved-in: 7623231
---

> **Resolution (2026-04-21):** Per maintainer direction, both findings
> closed with concrete fixes:
>
> 1. Slider CSS structure hoisted to `src/client/base.css`, with each
>    theme driving only the material via `--tw-slider-*` CSS custom
>    properties on `#menu-dropdown`. Amiga inherits the base defaults
>    outright (zero overrides); Scene sets five variables instead of
>    duplicating a 55-line pseudo-element block.
> 2. One-time sweep to add `tw-` prefix to every bare project-owned
>    class (`menu-row`, `menu-section`, `drops-row`, `win-tab`, and the
>    13 others in the same family). IDs stay bare per existing
>    convention. CLAUDE.md gains a "Class naming" rule so future code
>    doesn't reintroduce the mix.


# Cluster 12 — theme-css-cleanup

## TL;DR

- **Goal:** Dedupe the slider CSS currently repeated in both theme packs, and pick one CSS class-naming convention to apply going forward.
- **Impact:** Both findings are Low — theme CSS duplication is the expected trade-off for the current self-contained-theme model, and the naming inconsistency does not break anything at runtime. Bundle as a deliberate decision rather than a bug-fix cluster.
- **Size:** Medium (half-day; mostly deciding, not editing)
- **Depends on:** none
- **Severity:** Low

## Header

> Session size: Medium · Analysts: Frontend · Depends on: none

## Files touched

- `themes/amiga/amiga.css` (slider duplication)
- `themes/amiga/scene.css` (slider duplication)
- `src/client/base.css` (baseline slider structure; class-naming audit)
- `src/client/ui/topbar.ts`, `src/client/ui/dropdown.ts` (class-naming audit)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 2
- autofix-ready: 0 · needs-decision: 2 · needs-spec: 0

## Findings

- **`#menu-dropdown` slider rules duplicated across all three theme CSS files** — `base.css` defines the default slider track/thumb rules. Both `amiga.css` and `scene.css` fully redefine `#menu-dropdown input[type="range"]` with `::-webkit-slider-runnable-track`, `::-moz-range-track`, `::-moz-range-progress`, `::-webkit-slider-thumb`, `::-moz-range-thumb`, and `:active` pseudo-classes — ~50 lines each, structurally identical with only colour values and height changed. A future slider addition requires editing three files.
  - Location: `themes/amiga/amiga.css:505-560` · `themes/amiga/scene.css:534-589`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `theme-css-cleanup`
  - Raised by: Frontend Analyst
  - Notes: Acceptable at T2 as the expected trade-off for self-contained-theme CSS. The cleaner direction is to move shared slider structure (track height, thumb shape, pseudo-element selectors) to `base.css` with CSS custom properties for colour, and have themes set only the custom properties. But this also changes the "every theme ships a complete CSS file" contract — worth discussing before doing.

- **Inconsistent CSS class-naming convention** — `base.css` and theme files use a `tw-` prefix for component classes (`tw-dropdown`, `tw-toast`, `tw-clip-prompt-*`, `tw-drop-overlay`) but bare names for IDs (`#topbar`, `#terminal`, `#menu-dropdown`). Dynamically-created class names in `topbar.ts` use bare classes (`menu-row`, `menu-section`, `drops-row`, `win-tab`) while others use `tw-dd-*`. Functional, but makes distinguishing project classes from browser defaults harder at a glance.
  - Location: `src/client/base.css` · `src/client/ui/topbar.ts` · `src/client/ui/dropdown.ts`
  - Severity: Low · Confidence: Verified · Effort: Large · Autonomy: needs-decision
  - Cluster hint: `theme-css-cleanup`
  - Raised by: Frontend Analyst
  - Notes: At T2 with two themes and one maintainer, this is acceptable. Renaming would break E2E tests and theme CSS simultaneously. The honest options are: (a) document the mixed convention in CLAUDE.md as intentional (IDs are bare, dynamic classes get `tw-` when they're components, static classes stay bare when they're structural); (b) do a one-time sweep to add `tw-` to the bare dynamic classes; (c) accept both and leave a rule for new code only. Option (a) or (c) fits T2 better than a repo-wide rename.

## Suggested session approach

Decision-heavy, not implementation-heavy. Run as a short brainstorm: is the slider-CSS duplication a problem worth solving now, or does it only bite when a new slider is added? (Deferring until the next slider addition is defensible.) For class naming, pick one of the three options above and either add a CLAUDE.md rule or do the sweep. Most likely outcome: defer both and mark the cluster `deferred` with the naming-convention decision captured in CLAUDE.md.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `chore(cluster 12-theme-css-cleanup, 2026-04-21): ...` or mark the cluster `deferred` if decided.
2. No `Depends-on:` chain.
