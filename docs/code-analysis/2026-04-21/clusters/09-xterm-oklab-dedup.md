---
Status: resolved
Resolved-in: ef84379
---

# Cluster 09 — xterm-oklab-dedup

## TL;DR

- **Goal:** Extract the OKLab colour-space helpers from `fg-contrast.ts` and `tui-saturation.ts` into a single `src/client/oklab.ts` module; delete a dead `@deprecated` alias; delete a dead field on `ThemeInfo`.
- **Impact:** Single source of truth for the hot OKLab math; reduces the risk that a future tweak to the sRGB↔OKLab constants lands in only one module. Knocks off three mechanical cleanups at once.
- **Size:** Small (<2h)
- **Depends on:** none (unblocks cluster 02 if the OKLab closures end up tested in isolation as part of xterm.ts coverage work)
- **Severity:** Medium

## Header

> Session size: Small · Analysts: Frontend · Depends on: none · Unblocks: cluster 02-client-unit-test-coverage (xterm.ts closure testability)

## Files touched

- `src/client/fg-contrast.ts` (OKLab math, dead alias)
- `src/client/tui-saturation.ts` (OKLab math)
- `src/client/theme.ts` (dead field)
- `src/client/oklab.ts` (new — extracted helper)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 2
- autofix-ready: 2 · needs-decision: 1 · needs-spec: 0

## Findings

- **Full OKLab colour math duplicated verbatim between `fg-contrast.ts` and `tui-saturation.ts`** — `srgbToLinear`, `linearToSrgb`, `srgbByteToOklab`, and `oklabToSrgbByte` are copy-pasted identically across both modules (~60 lines total). Both modules are already imported together from `xterm.ts`, so a shared `src/client/oklab.ts` helper has zero new bundling overhead. A future constant adjustment must be made in two places today.
  - Location: `src/client/fg-contrast.ts:48-89` · `src/client/tui-saturation.ts:25-65`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `xterm-adapter-patches`
  - Fix: Create `src/client/oklab.ts` exporting `srgbToLinear`, `linearToSrgb`, `srgbByteToOklab`, `oklabToSrgbByte`, and `rgbToOklabL`; import from both `fg-contrast.ts` and `tui-saturation.ts`; delete the duplicated bodies in both call sites.
  - Raised by: Frontend Analyst

- **`@deprecated pushFgLightness` alias exported but no live callers** — `fg-contrast.ts:143-144` exports `pushFgLightness` as a deprecated alias for `pushLightness`. Project-wide grep finds zero references outside the defining file.
  - Location: `src/client/fg-contrast.ts:143`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `xterm-adapter-patches`
  - Fix: Delete lines 143-144.
  - Raised by: Frontend Analyst

- **`ThemeInfo.defaultTuiOpacity` field declared in type but never referenced by production code** — `src/client/theme.ts:10` declares `defaultTuiOpacity?: number` on `ThemeInfo`. No production call site in `index.ts` or `topbar.ts` reads this field; both use `defaultTuiBgOpacity` and `defaultTuiFgOpacity` (the split fields introduced in v1.6.0). `defaultTuiOpacity` is only referenced in an E2E fixture.
  - Location: `src/client/theme.ts:10`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `xterm-adapter-patches`
  - Raised by: Frontend Analyst
  - Notes: Before removing, confirm the E2E fixture using `defaultTuiOpacity` is itself a dead codepath (i.e., not validating live theme JSONs). If the fixture is live, either fix the fixture or keep the field with a comment explaining why.

## Suggested session approach

Mechanical — dispatch. Do the OKLab extraction first, verify `bun test` still passes, then the alias delete, then the field decision. The extraction is also setup for cluster 02's xterm.ts coverage work — if the OKLab closures live in their own module they can be unit-tested in isolation without a WebGL mock.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `refactor(cluster 09-xterm-oklab-dedup, 2026-04-21): extract shared OKLab helper; remove dead alias and field`.
2. Note if the field decision ends up deferring to the E2E fixture outcome.
3. No `Depends-on:` chain, but if the session doing cluster 02 later extends this (e.g., adds unit tests against the new `oklab.ts`), cross-reference it.
