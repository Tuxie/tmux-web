# WebGL mock harness for the xterm.ts adapter

## What we want

A test harness that lets `src/client/adapters/xterm.ts` be exercised
end-to-end in a unit test — including the per-frame WebGL rectangle /
glyph patches in `_patchWebglExplicitBackgroundOpacity` and the cell-
level colour transforms wired around `pushLightness` / `adjustSaturation`
— so the file can leave the EXCLUDES set in `scripts/check-coverage.ts`
and pull its own weight against the project's 95% line / 90% function
gates.

Today the adapter is at 61% func / 72% line, and it's the largest
application module under `src/client/`. The whole-file exclusion in
`scripts/check-coverage.ts:13-15` is the only blanket exclusion in the
gate that doesn't match the "bootstrap / generated / IO-shell wrapper"
rule the comment claims.

## Why the naive approach fails

JSDOM (which `tests/unit/client/_dom.ts` already wires up for the
other client tests) implements no `WebGL2RenderingContext`. The xterm
WebGL renderer constructs `gl.createTexture`, `gl.createBuffer`,
`gl.uniform2f`, etc. inside its own constructor and asserts the calls
return non-null. A bare JSDOM environment can't even instantiate the
addon.

Headless Chrome / Playwright give a real WebGL context but cost
multiple seconds per spin-up, which doesn't fit the per-test budget of
the unit suite (Bun runs all 597 unit tests in ~10 s today). It also
duplicates the e2e suite's job.

## Sketch of the harness

Three layers, smallest first:

1. **Pure-helper carve-outs** — **LANDED**. Cluster 09 extracted the
   OKLab math to `src/client/oklab.ts`. A follow-up session hoisted
   the per-cell attribute / colour-resolution pipeline to
   `src/client/adapters/xterm-cell-math.ts`:
     - `effectiveBackgroundAttr(fg, bg)`
     - `resolveAttrRgba(attr, defaultRgba, ansi)`
     - `blendRgbaOverDefaultBackground(rgba, baseRgba, α)`
     - `resolveCellBgRgb(fg, bg, theme, tuiBgAlpha)`
     - `blendFgTowardCellBg(origFgAttr, cellBgRgb, fgDefault, state, ansi)`
     - `withBlendedEffectiveBackground(fg, bg, theme, state)`
   `xterm.ts` now keeps only two tiny snapshot lambdas (`themeSnapshot`,
   `stateSnapshot`) that bundle live `renderer._themeService` and
   adapter-settings state into `XtermCellTheme` / `XtermCellState` bags
   for each call. The cell-math module is at 95%+ line coverage under
   `tests/unit/client/adapters/xterm-cell-math.test.ts` — 28 cases
   covering every branch (CM_DEFAULT / P16 / P256 / RGB × inverse ×
   alpha / contrast / saturation).
2. **A `WebGL2RenderingContext` stub** that records every method
   call and returns the smallest non-null token each call expects. The
   stub doesn't render anything; its job is to let the addon boot
   without throwing, so we can assert that our patcher monkey-patches
   the right methods, in the right order, with arguments derived
   from the right session settings.
3. **A snapshot-style test** of the patched `_updateRectangle`
   closure: feed it a fixed `IBufferLine`, capture the recorded
   `gl.uniform4f(…)` calls, assert the colour bytes are what we
   expect for the input cell + current `tuiBgOpacity` /
   `fgContrastStrength` / `tuiSaturation` settings.

(2) is the remaining bulk of the work — probably one focused session
to write and one more to harden when xterm.js is updated. (3) is a
pattern that scales once (2) exists. Now that Layer 1 is in place,
(3) is already partly covered at the unit level — any future (3)
test would be exercising the patcher glue, not the math.

## Why we're not doing Layer 2 now

A real WebGL stub takes a day or two of careful work and the safety
gain is limited as long as the e2e suite catches the visible
regressions (every cluster fix during the 2026-04-21 analysis was
caught by either unit tests or the existing `tests/e2e/theming.spec.ts`).
With Layer 1 landed, the untested residue in `xterm.ts` is mostly:
- `_patchWebglLineHeightOverflow` (metrics plumbing)
- `_patchWebglAtlasFilter` (texture filter mode)
- The actual monkey-patching glue around `rectangleRenderer` /
  `glyphRenderer` (what it decides to wrap, in what order)

None of those are pixel-math bugs — they're integration-wiring bugs
that a WebGL stub (Layer 2) or e2e snapshot would catch equally well.

## Pointers

- `scripts/check-coverage.ts` — `EXCLUDES` set (xterm.ts still excluded)
- `src/client/adapters/xterm.ts` — `_patchWebglExplicitBackgroundOpacity`
- `src/client/adapters/xterm-cell-math.ts` — **Layer 1 output**; pure
  cell-math with its own unit tests
- `src/client/oklab.ts` — the original carve-out pattern (cluster 09)
- `tests/unit/client/_dom.ts` — JSDOM wiring used by other client tests
- `tests/unit/client/adapters/xterm-cell-math.test.ts` — Layer 1 tests
- `docs/code-analysis/2026-04-21/clusters/02-client-unit-test-coverage.md`
  — the cluster that surfaced this gap
