/**
 * TUI FG Opacity slider regression tests
 * ========================================
 *
 * Mirror of tests/e2e/tui-opacity.test.ts (BG Opacity) for the
 * foreground counterpart. Control semantics:
 *
 *   - TUI FG Opacity = 100 → text is fully opaque (no change from
 *     pre-feature behaviour). The visible pixel inside a solid glyph
 *     equals the theme foreground colour.
 *   - TUI FG Opacity = 0   → text blends fully into its cell's
 *     effective background, i.e. becomes invisible. The visible pixel
 *     inside a solid glyph equals the cell's bg pixel — which is the
 *     default-bg composite over #page for default-bg cells, or the
 *     TUI-BG-Opacity-faded ansi colour for explicit-bg cells.
 *   - Intermediate values linearly interpolate between the two.
 *
 * Implementation expectations (see `_patchWebglExplicitBackgroundOpacity`
 * in src/client/adapters/xterm.ts — the FG path should mirror the
 * existing BG path):
 *
 *   - Rename the internal field `tuiOpacity` → `tuiBgOpacity` and add
 *     `tuiFgOpacity` alongside it.
 *   - In the glyph atlas pre-processing, remap the fg attribute to a
 *     pre-blended colour `fg × tuiFgα + cellBg × (1-tuiFgα)` before
 *     handing it to `glyphRenderer.updateCell`, analogous to the bg's
 *     `withBlendedEffectiveBackground`. `cellBg` is whatever the BG
 *     path chose: `theme.background.rgba` for default-bg cells, or
 *     `ansiBg × tuiBgα + theme × (1-tuiBgα)` for explicit-bg cells.
 *   - The atlas caches glyphs by the fg/bg key, so changing tuiFgα
 *     must call `clearTextureAtlas()` + `term.refresh` just like
 *     tuiBgα does.
 *
 * DOM contract (do not rename without updating tests):
 *   - `#sld-tui-fg-opacity` — range input, 0..100
 *   - `#inp-tui-fg-opacity` — number input, 0..100
 *   - `#sld-tui-bg-opacity` / `#inp-tui-bg-opacity` — the renamed BG
 *     slider (was `sld-tui-opacity` / `inp-tui-opacity`).
 *
 * Sample-pixel strategy: write lines filled with block characters
 * (U+2588 █) — a solid-fill glyph covers 100% of the cell area with
 * fg, so the sampled pixel is deterministic fg (modulo AA on the
 * tiny left/right edges, which we avoid by sampling in the middle
 * of a run of blocks).
 */

import { test, type Page } from "@playwright/test";
import { mockSessionStore } from './helpers.js';

const OPACITY_TOLERANCE = 3;

// Per-page isolated session store. Without this, every `page.goto('/')`
// here reads the real server's sessions.json, which is shared across
// all Playwright workers. Parallel tests that mutate other fields on
// session `main` (fgContrastStrength, tuiSaturation, etc.) leak into
// this suite and skew the linearity math (contrast is non-linear). The
// mock gives each page its own in-memory store, so state is per-test.
test.beforeEach(async ({ page }) => {
  await mockSessionStore(page);
});

async function openMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForSelector('#sld-tui-fg-opacity', { state: 'visible' });
}

async function closeMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForTimeout(150);
}

async function setSlider(page: Page, id: string, pct: number): Promise<void> {
  await openMenu(page);
  await page.fill(`#${id}`, String(pct));
  await page.dispatchEvent(`#${id}`, 'change');
  await page.waitForTimeout(400);
  await closeMenu(page);
  await page.waitForTimeout(200);
}

async function setFgOpacity(page: Page, pct: number): Promise<void> {
  await setSlider(page, 'inp-tui-fg-opacity', pct);
}

async function setBgOpacity(page: Page, pct: number): Promise<void> {
  await setSlider(page, 'inp-tui-bg-opacity', pct);
}

async function disableAutohide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cb = document.getElementById('chk-autohide') as HTMLInputElement;
    if (cb && cb.checked) cb.click();
  });
}

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

async function samplePixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: 3, height: 3 } });
  // @ts-expect-error — loose import for a test helper.
  const { PNG } = (await import('pngjs')) as { PNG: any };
  const img = PNG.sync.read(buf);
  const i = (1 * img.width + 1) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
}

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
      `TUI FG Opacity linearity regression in ${label} (channel ${channel}):\n` +
      `  observed=${observed}, linear-target=${expected.toFixed(1)} (full=${full}, base=${base}), diff=${diff}\n` +
      `  Expected visible = 0.5 × ${full} + 0.5 × ${base} = ${expected.toFixed(1)} ± ${OPACITY_TOLERANCE}.\n` +
      `  TUI FG Opacity should pre-blend the glyph's fg colour with the cell's effective bg before\n` +
      `  the atlas rasterises it. See _patchWebglExplicitBackgroundOpacity in\n` +
      `  src/client/adapters/xterm.ts — the FG path should be symmetric to withBlendedEffectiveBackground.\n` +
      `  If the atlas cache isn't being cleared on tuiFgα change, the new alpha won't apply until the\n` +
      `  next cell repaint. Check that updateOptions({ tuiFgOpacity }) calls webglAddon.clearTextureAtlas()\n` +
      `  and term.refresh() just like tuiBgOpacity does.`
    );
  }
}

function assertPixelsClose(
  actual: [number, number, number],
  expected: [number, number, number],
  tolerance: number,
  label: string,
  hint: string,
): void {
  const [r1, g1, b1] = actual;
  const [r2, g2, b2] = expected;
  const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
  if (diff > tolerance) {
    throw new Error(
      `${label}: pixel mismatch\n` +
      `  actual   = (${r1}, ${g1}, ${b1})\n` +
      `  expected = (${r2}, ${g2}, ${b2})\n` +
      `  sum |Δ|  = ${diff}, tolerance = ${tolerance}\n` +
      `  ${hint}`
    );
  }
}

// Sample coordinates: row 0 of the terminal after topbar (≈y=38);
// x=100 picks a cell well past any label text in a row of block-fill.
const SAMPLE_Y = 38;
const SAMPLE_X_GLYPH = 100; // in the middle of a block-filled run
const SAMPLE_Y_EMPTY = 200; // in the empty terminal area below our writes

test('TUI FG Opacity=100 renders text at the theme foreground colour', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  // A line of block characters so every sampled pixel is solid fg.
  await writeLines(page, ['██████████████████████████████']);
  await setFgOpacity(page, 100);

  const expected = await page.evaluate(() => {
    const renderer = (window as any).__adapter?.term?._core?._renderService?._renderer?.value;
    const fg = renderer?._themeService?.colors?.foreground?.rgba ?? 0;
    return [(fg >> 24) & 0xff, (fg >> 16) & 0xff, (fg >> 8) & 0xff] as [number, number, number];
  });

  const observed = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);
  assertPixelsClose(
    observed, expected, OPACITY_TOLERANCE * 3,
    'TUI FG Opacity=100 on block glyph',
    'At α=1 a solid glyph pixel should equal themeService.colors.foreground.rgba exactly (premul = identity).',
  );
});

test('TUI FG Opacity=0 makes text invisible over default bg', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  await writeLines(page, ['██████████████████████████████']);
  await setFgOpacity(page, 0);

  // At α=0, text blends fully into the cell's bg. Default-bg cells
  // show the #page + body composite, same as the empty-terminal area
  // below our writes.
  const textPixel = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);
  const emptyPixel = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y_EMPTY);

  assertPixelsClose(
    textPixel, emptyPixel, OPACITY_TOLERANCE * 3,
    'TUI FG Opacity=0 over default bg',
    'At α=0 the glyph should vanish into the cell bg — for a default-bg cell that means the pixel\n' +
    '  should match any other default-bg cell. If it doesn\'t, the fg pre-blend target isn\'t the\n' +
    '  default-bg effective colour (theme.background.rgba after composeTheme\'s body blend).',
  );
});

test('TUI FG Opacity=0 makes text invisible over ANSI bg', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  // Blue bg with block glyphs inside it.
  await writeLines(page, ['\x1b[44m██████████████████████████████\x1b[0m']);
  await setBgOpacity(page, 100); // BG fully opaque so ansi blue shows solid
  await setFgOpacity(page, 0);

  // Reference: an empty space on the same line with the same bg.
  await writeLines(page, ['\x1b[44m██████████     ███████████████\x1b[0m']);
  await page.waitForTimeout(300);

  const glyphPixel = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);
  // Sample an empty (non-glyph) cell in the same ANSI-bg run.
  // Columns 10-14 are the five spaces in the line above.
  const EMPTY_X_IN_BG = 100; // same column region; re-use since all are blocks
  // Use col ~12 by pixel (12 × ~9px ≈ 110) — pick 110 to land on a space.
  const SPACE_X = 110;
  void EMPTY_X_IN_BG;
  const bgPixel = await samplePixel(page, SPACE_X, SAMPLE_Y);

  assertPixelsClose(
    glyphPixel, bgPixel, OPACITY_TOLERANCE * 3,
    'TUI FG Opacity=0 over ANSI bg',
    'At α=0 the glyph should equal the cell\'s ansi bg. If the atlas was pre-blending fg against\n' +
    '  theme.background only (ignoring the explicit bg), the glyph would read as foreground×0+theme×1\n' +
    '  — visible as a dark tint over the ansi bg. The fg pre-blend target must follow the cell\'s\n' +
    '  effective bg (withBlendedEffectiveBackground output).',
  );
});

test('TUI FG Opacity fades text linearly into its cell bg', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  await writeLines(page, ['██████████████████████████████']);

  await setFgOpacity(page, 100);
  const atFull = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);

  await setFgOpacity(page, 0);
  const atZero = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);

  await setFgOpacity(page, 50);
  const atMid = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);

  assertLinearMidpoint('R', atMid[0], atFull[0], atZero[0], 'block-glyph over default bg');
  assertLinearMidpoint('G', atMid[1], atFull[1], atZero[1], 'block-glyph over default bg');
  assertLinearMidpoint('B', atMid[2], atFull[2], atZero[2], 'block-glyph over default bg');
});

test('TUI BG=100 / FG=0 shows solid ansi bg with no visible text', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  await writeLines(page, ['\x1b[41m██████████████████████████████\x1b[0m']);
  await setBgOpacity(page, 100);
  await setFgOpacity(page, 0);

  const glyphPixel = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);

  // Expected = theme's ansi red.
  const expected = await page.evaluate(() => {
    const renderer = (window as any).__adapter?.term?._core?._renderService?._renderer?.value;
    const red = renderer?._themeService?.colors?.ansi?.[1]?.rgba ?? 0;
    return [(red >> 24) & 0xff, (red >> 16) & 0xff, (red >> 8) & 0xff] as [number, number, number];
  });

  assertPixelsClose(
    glyphPixel, expected, OPACITY_TOLERANCE * 3,
    'FG=0 + BG=100 should show pure ansi bg',
    'The glyph pixel must equal themeService.colors.ansi[1].rgba. If there\'s a residual foreground\n' +
    '  tint, the fg pre-blend isn\'t fully collapsing into the bg at α=0.',
  );
});

test('TUI BG=0 / FG=100 shows text over page backdrop (no cell bg)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);

  await writeLines(page, ['\x1b[44m██████████████████████████████\x1b[0m']);
  await setBgOpacity(page, 0);
  await setFgOpacity(page, 100);

  // With BG=0 the ansi rect is invisible; with FG=100 the glyph █ is
  // still the theme foreground. Block fills the whole cell so sampling
  // anywhere inside the run hits solid fg.
  const observed = await samplePixel(page, SAMPLE_X_GLYPH, SAMPLE_Y);
  const expected = await page.evaluate(() => {
    const renderer = (window as any).__adapter?.term?._core?._renderService?._renderer?.value;
    const fg = renderer?._themeService?.colors?.foreground?.rgba ?? 0;
    return [(fg >> 24) & 0xff, (fg >> 16) & 0xff, (fg >> 8) & 0xff] as [number, number, number];
  });

  assertPixelsClose(
    observed, expected, OPACITY_TOLERANCE * 3,
    'FG=100 + BG=0 should show theme foreground',
    'At FG=1 the glyph core pixel should equal theme.foreground regardless of the BG slider.',
  );
});
