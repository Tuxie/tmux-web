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

1. **Pure-helper carve-outs**: lift any leaf function in `xterm.ts`
   that doesn't read from `gl` (e.g. cell-bg resolution given an
   `IBufferLine`-shaped fixture, foreground blending math) into its
   own file — `oklab.ts` is the precedent. Test those directly.
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

(1) is small; we already did one round of it in cluster 09. (2) is
the bulk of the work — probably one focused session to write and one
more to harden when xterm.js is updated. (3) is a pattern that scales
once (2) exists.

## Why we're not doing this now

A real WebGL stub takes a day or two of careful work and the safety
gain is limited as long as the e2e suite catches the visible
regressions (every cluster fix during the 2026-04-21 analysis was
caught by either unit tests or the existing `tests/e2e/theming.spec.ts`).
The pragmatic alternative for now: extract more pure leaves a la
`oklab.ts` whenever cluster 09-style refactors come up, and let the
EXCLUDES entry stay with a pointer back to this idea file.

## Pointers

- `scripts/check-coverage.ts:11-17` — current EXCLUDES set
- `src/client/adapters/xterm.ts:175` — `_patchWebglExplicitBackgroundOpacity`
- `src/client/oklab.ts` — the carve-out shape we'd extend
- `tests/unit/client/_dom.ts` — JSDOM wiring used by other client tests
- `docs/code-analysis/2026-04-21/clusters/02-client-unit-test-coverage.md`
  — the cluster that surfaced this gap
