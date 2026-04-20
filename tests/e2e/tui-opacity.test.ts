/**
 * TUI Opacity slider regression tests
 * ====================================
 *
 * These tests lock in the behaviour added in `fix(opacity): ...` commits
 * on 2026-04-19. They target the WebGL patch in
 * `src/client/adapters/xterm.ts` → `_patchWebglExplicitBackgroundOpacity`,
 * which rewrites vendor xterm.js's RectangleRenderer output so that any
 * background rectangle fades linearly with the TUI Opacity slider and
 * composites correctly against the real `#page` + body backdrop
 * (including gradients / images that CSS compositing handles but
 * `composeTheme` can't see via `getComputedStyle(body).backgroundColor`).
 *
 * If a future xterm.js upgrade breaks these tests, here's where to look:
 *
 *   vendor/xterm.js/addons/addon-webgl/src/RectangleRenderer.ts
 *     - `updateBackgrounds(model)` — decides which cells get a rect.
 *       Patched via a pre/post wrap in xterm.ts that captures `model`
 *       (for the cursor-carve-out) and zeroes the viewport rect at
 *       offset 0 of `_vertices.attributes` so default-bg cells leave
 *       the canvas transparent.
 *     - `_updateRectangle(vertices, offset, fg, bg, startX, endX, y)` —
 *       per-rect write. Patched to premultiply RGB by `tuiα` and set
 *       alpha = `tuiα`, so the fragment shader writes the premultiplied
 *       tuple the canvas compositor expects (canvas is created with
 *       `premultipliedAlpha: true`).
 *     - `renderBackgrounds()` — gl draw call. Patched to (a) call
 *       `gl.clear(COLOR_BUFFER_BIT)` at frame start (preserveDrawingBuffer
 *       is false but the spec only guarantees a clear *after* compositor
 *       read, not between in-task draws — cursor blinks would otherwise
 *       accumulate into a `1-(1-α)^n` curve), (b) switch blend func to
 *       `ONE × ONE_MINUS_SRC_ALPHA` for the rect pass, (c) restore
 *       `SRC_ALPHA × ONE_MINUS_SRC_ALPHA` before the glyph pass.
 *
 *   vendor/xterm.js/addons/addon-webgl/src/GlyphRenderer.ts
 *     - Constructor enables `gl.BLEND` once. If upstream moves that
 *       enable into `render()` or removes it, our rect-pass blend swap
 *       still works (we only touch blendFunc, not the enable state).
 *
 *   vendor/xterm.js/addons/addon-webgl/src/WebglRenderer.ts
 *     - Constructor creates the canvas with `{ antialias: false, depth:
 *       false, preserveDrawingBuffer }`. WebGL default is alpha:true,
 *       premultipliedAlpha:true — our entire approach relies on those
 *       defaults. If upstream switches to `alpha:false`, the canvas
 *       becomes opaque and none of this compositing trick works; adapt
 *       by reverting to `composeTheme`'s body pre-blend only.
 *
 * If `_updateRectangle` signature changes (new/reordered params), the
 * premultiplication hook in xterm.ts also needs adjusting; `offset + 7`
 * is the alpha slot and offsets `+4/+5/+6` are R/G/B per
 * `_addRectangle`'s layout.
 *
 * If `updateBackgrounds` starts building its own vertex buffer from
 * scratch each call (instead of writing over the persistent
 * `_vertices.attributes`), the viewport-zeroing post-hook needs to run
 * *after* the new buffer is populated — check whether `this._vertices`
 * still references the same array after `origUpdateBackgrounds`.
 *
 * Fade linearity formula (for debugging failures):
 *   visible = ansi_rgb × tuiα + page_visible × (1 - tuiα)
 * where `page_visible` is the colour you'd see at a default-bg cell
 * (i.e. canvas transparent → CSS composites #page over body). At
 * tuiα=1 the visible pixel equals the ansi colour exactly; at tuiα=0
 * it equals `page_visible`. Any measured curve that isn't linear means
 * the premul + blend-func + clear triplet isn't all in effect — sample
 * `rectangleRenderer._vertices.attributes[offset .. offset+7]` at a
 * known rect and check it matches `(r×α, g×α, b×α, α)`.
 */

import { test, expect, type Page } from "@playwright/test";

const OPACITY_TOLERANCE = 3;

async function openMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForSelector('#sld-tui-bg-opacity', { state: 'visible' });
}

async function closeMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForTimeout(150);
}

async function setTuiOpacity(page: Page, pct: number): Promise<void> {
  await openMenu(page);
  await page.fill('#inp-tui-bg-opacity', String(pct));
  await page.dispatchEvent('#inp-tui-bg-opacity', 'change');
  // Give the adapter a frame to rebuild rect attrs + re-render.
  await page.waitForTimeout(400);
  await closeMenu(page);
  await page.waitForTimeout(200);
}

/**
 * Disable the toolbar auto-hide so opening the menu repeatedly between
 * screenshots doesn't race against the hide timer. Without this, the
 * menu closes unexpectedly and `fill()` times out on a hidden input.
 */
async function disableAutohide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cb = document.getElementById('chk-autohide') as HTMLInputElement;
    if (cb && cb.checked) cb.click();
  });
}

/**
 * Waits for the WebGL adapter to be ready. Tests that care about exact
 * pixels need the canvas present *and* at least one render tick
 * complete; `__adapter` being defined is the marker our code sets
 * after init.
 */
async function readyAdapter(page: Page): Promise<void> {
  await page.waitForSelector("#terminal canvas");
  await page.waitForFunction(() => !!(window as any).__adapter);
  await page.waitForTimeout(400);
}

async function writeLines(page: Page, lines: string[]): Promise<void> {
  await page.evaluate((seq) => {
    const adapter = (window as any).__adapter;
    adapter.write('\x1b[2J\x1b[H');
    for (const line of seq) adapter.write(line + '\r\n');
  }, lines);
  await page.waitForTimeout(300);
}

/**
 * Sample an on-screen pixel through a Playwright screenshot. We don't
 * use `gl.readPixels` because `preserveDrawingBuffer: false` clears the
 * buffer before JS can read it; the screenshot pipeline captures the
 * compositor's final output which is what we actually care about.
 */
async function samplePixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: 3, height: 3 } });
  // pngjs is a transitive dep of playwright and has no @types package.
  // @ts-expect-error — loose import for a test helper.
  const { PNG } = (await import('pngjs')) as { PNG: any };
  const img = PNG.sync.read(buf);
  // Center pixel of the 3×3 crop.
  const i = (1 * img.width + 1) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
}

/**
 * Assert that a single channel at `α=0.5` lies within
 * TOLERANCE of the linear target `0.5 × full + 0.5 × base`. Because the
 * compositor stacks canvas → #page (rgba) → body, and both canvas + page
 * pre-multiply alpha, small rounding errors are expected; anything > 3
 * means the premul/blend/clear pipeline regressed.
 */
function assertLinearMidpoint(
  channel: string,
  observed: number,
  full: number,
  base: number,
  label: string,
): void {
  const expected = (full + base) / 2;
  const diff = Math.abs(observed - expected);
  if (diff > OPACITY_TOLERANCE) {
    throw new Error(
      `TUI Opacity linearity regression in ${label} (channel ${channel}):\n` +
      `  observed=${observed}, linear-target=${expected.toFixed(1)} (full=${full}, base=${base}), diff=${diff}\n` +
      `  Expected visible = 0.5 × ${full} + 0.5 × ${base} = ${expected.toFixed(1)} ± ${OPACITY_TOLERANCE}.\n` +
      `  Likely causes: (a) premul dropped in _updateRectangle patch, (b) blend func not switched to\n` +
      `  ONE × ONE_MINUS_SRC_ALPHA for the rect pass, (c) framebuffer not cleared per frame so cursor\n` +
      `  blinks accumulate into a 1-(1-α)^n curve, (d) viewport rect (vertices.attributes[0..7]) not\n` +
      `  zeroed so default-bg cells add page colour on top of themselves.\n` +
      `  Sample vertex attrs for the failing rect via the debugger:\n` +
      `    adapter.term._core._renderService._renderer.value._rectangleRenderer.value._vertices.attributes\n` +
      `  Expected tuple at offset N: (r×α, g×α, b×α, α). See header comment in this file.`
    );
  }
}

/**
 * Plain terminal: type an ANSI-bg coloured line, and verify the visible
 * pixel behind it fades linearly from the ansi colour (α=1) to the
 * page-visible colour (α=0), with the midpoint (α=0.5) landing at the
 * linear average. Runs for P16, P256, and truecolor variants so a
 * regression in any one code path (`resolveAttrRgba` for each CM) is
 * caught distinctly.
 */
for (const variant of [
  { label: 'ANSI P16 blue (CSI 44)', seq: '\x1b[44m' },
  { label: 'ANSI P16 bright-black (CSI 100)', seq: '\x1b[100m' },
  { label: 'ANSI P256 grey 238 (CSI 48;5;238)', seq: '\x1b[48;5;238m' },
  { label: 'truecolor (CSI 48;2;200;80;50)', seq: '\x1b[48;2;200;80;50m' },
]) {
  test(`TUI Opacity fades ${variant.label} linearly`, async ({ page }) => {
    await page.goto('/');
    await readyAdapter(page);
    await disableAutohide(page);

    // A row of 20 cells of coloured bg, text label at the start so we
    // know it's the right row. Sample *past* the text to hit empty
    // cells where the glyph layer contributes nothing and the visible
    // pixel is pure rect-bg + page compositing.
    const line = `${variant.seq}X                   \x1b[0m`;
    await writeLines(page, [line]);

    // Screenshot coordinates are in CSS px. The terminal row 0 sits
    // just below the 32px topbar. x=150 is well past any text in the
    // label above (roughly col 16+ at 9px mono cells), so we're on a
    // space cell — its atlas entry is cleared to (0,0,0,0) and does
    // not contribute to the sampled pixel. Row y≈38 picks the middle
    // of line 0.
    const SAMPLE_X = 150;
    const SAMPLE_Y = 38;

    await setTuiOpacity(page, 100);
    const [rFull, gFull, bFull] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

    await setTuiOpacity(page, 0);
    const [rBase, gBase, bBase] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

    // Sanity: at α=0 the rect must *completely* disappear (fb=(0,0,0,0),
    // canvas fully transparent, CSS composite = page over body). A
    // non-trivial delta from a known default-bg pixel on the same row
    // would mean the rect wasn't neutered at α=0.
    const [rDefault, gDefault, bDefault] = await samplePixel(page, SAMPLE_X, 120);
    for (const [ch, a, b] of [['R', rBase, rDefault], ['G', gBase, gDefault], ['B', bBase, bDefault]] as const) {
      if (Math.abs(a - b) > OPACITY_TOLERANCE) {
        throw new Error(
          `TUI Opacity=0 regression on ${variant.label} channel ${ch}:\n` +
          `  coloured-bg cell at α=0 = ${a}, default-bg reference cell = ${b} (diff=${Math.abs(a - b)}).\n` +
          `  At α=0 the rect should write (0,0,0,0) under ONE × ONE_MINUS_SRC_ALPHA blend and leave\n` +
          `  the canvas transparent at that cell, so it composites identically to a default cell.\n` +
          `  If they differ, either the premultiplication in _updateRectangle is missing (attrs[4..6]\n` +
          `  not multiplied by α) or the viewport rect (offset 0) is leaking colour.`
        );
      }
    }

    await setTuiOpacity(page, 50);
    const [rMid, gMid, bMid] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

    assertLinearMidpoint('R', rMid, rFull, rBase, variant.label);
    assertLinearMidpoint('G', gMid, gFull, gBase, variant.label);
    assertLinearMidpoint('B', bMid, bFull, bBase, variant.label);

    expect({ rFull, rBase, rMid }).toBeDefined();
  });
}

/**
 * Inverse + default-fg rects (CSI 7m without explicit colour) render at
 * `theme.foreground.rgba`. They're used by Codex, fzf previews, etc.
 * as "boxed highlight" regions. Regression: if the shouldApply gate
 * adds back a `CM_DEFAULT`-reject, these stop fading.
 */
test('TUI Opacity fades inverse + default-fg rects (Codex/fzf pattern)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  await writeLines(page, ['\x1b[7mINVERSE            \x1b[0m']);

  const SAMPLE_X = 150;
  const SAMPLE_Y = 38;

  await setTuiOpacity(page, 100);
  const full = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  await setTuiOpacity(page, 0);
  const base = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

  const fullIsHighContrast = Math.abs(full[0] - base[0]) + Math.abs(full[1] - base[1]) + Math.abs(full[2] - base[2]);
  if (fullIsHighContrast < 30) {
    throw new Error(
      `Inverse+default rect at α=1 is indistinguishable from page bg — the rect isn't being drawn,\n` +
      `or CellColorResolver/RectangleRenderer changed how INVERSE+CM_DEFAULT is rasterised.\n` +
      `Check that RectangleRenderer._updateRectangle's INVERSE branch still picks theme.foreground.rgba\n` +
      `when (fg & CM_MASK) === CM_DEFAULT.\n` +
      `  α=1 pixel=${full.join(',')}, α=0 pixel=${base.join(',')}`
    );
  }

  await setTuiOpacity(page, 50);
  const mid = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  assertLinearMidpoint('R', mid[0], full[0], base[0], 'inverse+default-fg');
  assertLinearMidpoint('G', mid[1], full[1], base[1], 'inverse+default-fg');
  assertLinearMidpoint('B', mid[2], full[2], base[2], 'inverse+default-fg');
});

/**
 * At α=0 a coloured bg rect must be completely invisible — *not* faded
 * to the pre-blended theme.bg colour. This catches the earlier broken
 * fix that blended toward `composeTheme`'s output instead of dropping
 * the canvas pixel's alpha. The test injects a loud solid body colour
 * that is very different from the theme so "faded to theme.bg" vs
 * "faded to body" is a 100+ unit RGB difference.
 */
test('TUI Opacity=0 shows body backdrop, not pre-blended theme bg', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  // Inject a body background very different from the Nord theme
  // (rgb(46,52,64)). Hot magenta is nowhere near the theme so a regression
  // where we blend into theme.bg instead of the compositor's body will
  // show up as a > 80 RGB delta from expected.
  await page.evaluate(() => {
    document.body.style.background = 'rgb(255, 0, 200)';
    document.body.style.backgroundImage = 'none';
  });

  await writeLines(page, ['\x1b[44mX                   \x1b[0m']);

  await setTuiOpacity(page, 0);

  const SAMPLE_X = 150;
  const SAMPLE_Y = 38;
  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

  // Expected: #page at rgba(46,52,64, bg_opacity) over body rgb(255,0,200).
  // With bg_opacity defaulting to 100 (from DEFAULT_SESSION_SETTINGS),
  // the page fully covers the body and the visible pixel is ≈ theme.bg.
  // With lower bg_opacity the body bleeds through. We don't assume
  // which bg_opacity is configured — we just check the ansi bg has
  // *disappeared* by comparing to a default-bg cell on another row.
  const [rRef, gRef, bRef] = await samplePixel(page, SAMPLE_X, 120);

  const diff = Math.abs(r - rRef) + Math.abs(g - gRef) + Math.abs(b - bRef);
  if (diff > OPACITY_TOLERANCE * 3) {
    throw new Error(
      `TUI Opacity=0 didn't make the ansi bg cell match a default-bg cell.\n` +
      `  ansi-bg-at-α=0 pixel = (${r}, ${g}, ${b})\n` +
      `  default-bg reference = (${rRef}, ${gRef}, ${bRef})\n` +
      `  sum |Δ| = ${diff}, expected ≤ ${OPACITY_TOLERANCE * 3}\n` +
      `  This usually means _updateRectangle is producing RGB based on composeTheme's pre-blended\n` +
      `  theme.bg instead of premultiplying the ansi RGB by α=0 (which would zero both RGB and\n` +
      `  alpha, making the canvas transparent and letting CSS composite #page over body naturally).\n` +
      `  Inspect the vertex attrs at the offending rect — all four of offset+4..+7 should be 0.`
    );
  }
});

/**
 * The viewport rect (`_vertices.attributes[0..7]`) must be zeroed after
 * each `updateBackgrounds`, otherwise under the premul blend func the
 * viewport's theme-bg RGB adds on top of default-bg cells and they
 * appear brighter than pure page+body. This test samples a default-bg
 * area and compares against a known CSS #page composite value to
 * detect that bug.
 */
test('default-bg cells leave the canvas transparent (viewport rect zeroed)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);

  // Default-bg area sampling: somewhere in the terminal that has no text.
  const [r, g, b] = await samplePixel(page, 400, 400);

  // We can compute the expected page-over-body colour by reading the
  // computed CSS values. If the viewport rect leaks theme colour, the
  // sampled pixel will be offset from this expected value by the
  // viewport RGB × (1 - α) ≈ theme.bg's full magnitude.
  const expected = await page.evaluate(() => {
    const pageBg = getComputedStyle(document.getElementById('page')!).backgroundColor;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const parse = (s: string): [number, number, number, number] => {
      const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
      if (!m) return [0, 0, 0, 1];
      return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10), m[4] !== undefined ? parseFloat(m[4]!) : 1];
    };
    const [pr, pg, pb, pa] = parse(pageBg);
    const [br, bg, bb] = parse(bodyBg);
    return {
      r: Math.round(pr * pa + br * (1 - pa)),
      g: Math.round(pg * pa + bg * (1 - pa)),
      b: Math.round(pb * pa + bb * (1 - pa)),
    };
  });

  const delta = Math.abs(r - expected.r) + Math.abs(g - expected.g) + Math.abs(b - expected.b);
  if (delta > OPACITY_TOLERANCE * 3) {
    throw new Error(
      `Default-bg area doesn't match the expected #page+body composite.\n` +
      `  sampled pixel = (${r}, ${g}, ${b})\n` +
      `  expected      = (${expected.r}, ${expected.g}, ${expected.b})\n` +
      `  sum |Δ| = ${delta}\n` +
      `  Most likely the viewport rect (vertex buffer offset 0..7) isn't being zeroed out after\n` +
      `  orig updateBackgrounds(). Under ONE × ONE_MINUS_SRC_ALPHA with a non-zero RGB + α=0 viewport\n` +
      `  rect, the rect writes (theme.bg, 0) to every pixel, which CSS premul-composites as\n` +
      `  theme.bg + page × 1 = theme.bg + page. Zero out attrs[4..7] in the updateBackgrounds\n` +
      `  post-hook (see src/client/adapters/xterm.ts).`
    );
  }
});

/**
 * TUI Opacity=100 must restore the ansi colour exactly — if the α=1
 * code path drifts off by more than rounding, some step is forcing
 * a blend it shouldn't (e.g. composeTheme's pre-blend being applied
 * unconditionally).
 */
test('TUI Opacity=100 renders ansi bg at its exact theme colour', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  await writeLines(page, ['\x1b[44mX                   \x1b[0m']);
  await setTuiOpacity(page, 100);

  // Read the actual ansi.blue resolved colour from xterm's theme service —
  // this is what the WebGL rect shader will emit at α=1. Depending on
  // the active theme and colour scheme this may not be plain `0,0,255`.
  const expected = await page.evaluate(() => {
    const renderer = (window as any).__adapter?.term?._core?._renderService?._renderer?.value;
    const blue = renderer?._themeService?.colors?.ansi?.[4]?.rgba ?? 0;
    return {
      r: (blue >> 24) & 0xff,
      g: (blue >> 16) & 0xff,
      b: (blue >> 8) & 0xff,
    };
  });

  const [r, g, b] = await samplePixel(page, 150, 38);

  const delta = Math.abs(r - expected.r) + Math.abs(g - expected.g) + Math.abs(b - expected.b);
  if (delta > OPACITY_TOLERANCE * 3) {
    throw new Error(
      `TUI Opacity=100 on ansi blue didn't produce the theme's ansi.blue colour.\n` +
      `  sampled=(${r}, ${g}, ${b})\n` +
      `  expected=(${expected.r}, ${expected.g}, ${expected.b}) from themeService.colors.ansi[4]\n` +
      `  sum |Δ|=${delta}\n` +
      `  At α=1 the premul reduces to identity (r×1, g×1, b×1, 1) and the canvas compositor\n` +
      `  writes RGB directly (page × (1-1) = 0). A drift here means either the shader isn't\n` +
      `  seeing (rgb, 1) — check _updateRectangle patch — or xterm is rendering via the DOM/canvas\n` +
      `  fallback instead of WebGL (check window.__adapter.webglAddon).`
    );
  }
});
