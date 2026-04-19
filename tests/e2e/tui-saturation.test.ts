/**
 * TUI Saturation E2E regression tests.
 *
 * Drives the `#inp-tui-saturation` slider (range -100 .. +100, default 0)
 * through the settings menu and samples rendered pixels to verify the
 * full pipeline:
 *
 *   slider → session settings → adapter → atlas/rect → pixel
 *
 * Math lives in `src/client/tui-saturation.ts` (`adjustSaturation`).
 * FG path hook: `src/client/adapters/xterm.ts` → `blendFgTowardCellBg`
 * BG path hook: same file → `_updateRectangle` (rect attrs before
 * tuiBgAlpha premultiply).
 *
 * Semantics: at -100 chroma collapses to 0 (any colour → grey of equal
 * OKLab lightness). At 0 the transform is identity. At +100 chroma is
 * doubled (and sRGB-clamped — easy to run off the gamut, so we don't
 * assert byte-exact positive-boost targets here).
 *
 * If these tests break, check the order of operations in the adapter:
 * the BG path must saturate *before* premultiplying by `tuiBgAlpha`,
 * and the FG path must saturate *after* `pushFgLightness` and *before*
 * the alpha lerp toward `cellBgRgb` — otherwise at tuiFgOpacity < 1 or
 * fgContrastStrength ≠ 0 the glyph edge colour won't match the rect's
 * saturated colour.
 */

import { test, type Page } from '@playwright/test';
import { mockSessionStore } from './helpers.js';

const TOLERANCE = 4;

test.beforeEach(async ({ page }) => {
  await mockSessionStore(page);
});

async function openMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForSelector('#sld-tui-saturation', { state: 'visible' });
}

async function closeMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForTimeout(150);
}

async function setSaturation(page: Page, value: number): Promise<void> {
  await openMenu(page);
  await page.fill('#inp-tui-saturation', String(value));
  await page.dispatchEvent('#inp-tui-saturation', 'change');
  await page.waitForTimeout(400);
  await closeMenu(page);
  await page.waitForTimeout(200);
}

async function disableAutohide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cb = document.getElementById('chk-autohide') as HTMLInputElement;
    if (cb && cb.checked) cb.click();
  });
}

async function readyAdapter(page: Page): Promise<void> {
  await page.waitForSelector('#terminal canvas');
  await page.waitForFunction(() => !!(window as any).__adapter);
  const hasWebgl = await page.evaluate(() => !!(window as any).__adapter?.webglAddon);
  if (!hasWebgl) {
    test.skip(true, 'WebGL renderer unavailable — TUI Saturation patch only applies to WebGL');
  }
  await page.waitForTimeout(400);
}

async function writeLine(page: Page, line: string): Promise<void> {
  await page.evaluate((s) => {
    (window as any).__adapter.write('\x1b[2J\x1b[H');
    (window as any).__adapter.write(s + '\r\n');
  }, line);
  await page.waitForTimeout(300);
}

/** A row of filled block glyphs painted in an explicit truecolour fg. */
function fgBlockLine(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m${'█'.repeat(30)}\x1b[0m`;
}

/** A row of spaces painted with an explicit truecolour bg (so the
 *  rect renderer has a rectangle to rasterise). */
function bgBlockLine(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m${' '.repeat(30)}\x1b[0m`;
}

async function samplePixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: 3, height: 3 } });
  // @ts-expect-error — pngjs has no @types.
  const { PNG } = (await import('pngjs')) as { PNG: any };
  const img = PNG.sync.read(buf);
  const i = (1 * img.width + 1) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
}

const SAMPLE_X = 100;
const SAMPLE_Y = 38;

test('TUI Saturation=0 leaves a saturated fg at its original colour (identity)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  // Pure-ish red — if identity is broken we'll see it lose chroma.
  await writeLine(page, fgBlockLine(220, 40, 40));
  await setSaturation(page, 0);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (Math.abs(r - 220) > TOLERANCE || Math.abs(g - 40) > TOLERANCE || Math.abs(b - 40) > TOLERANCE) {
    throw new Error(
      `TUI Saturation=0 should leave the glyph's fg at (220,40,40) identity.\n` +
      `  observed=(${r}, ${g}, ${b})\n` +
      `  adjustSaturation must short-circuit at pct=0 — see src/client/tui-saturation.ts.`
    );
  }
});

test('TUI Saturation=-100 collapses a saturated fg to a grey (R≈G≈B)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, fgBlockLine(220, 40, 40));
  await setSaturation(page, -100);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (Math.abs(r - g) > TOLERANCE || Math.abs(g - b) > TOLERANCE || Math.abs(r - b) > TOLERANCE) {
    throw new Error(
      `TUI Saturation=-100 should collapse every fg to a pure grey (R==G==B within ${TOLERANCE}).\n` +
      `  observed=(${r}, ${g}, ${b})\n` +
      `  Check that blendFgTowardCellBg in xterm.ts saturates the fg after pushFgLightness, and\n` +
      `  that the atlas is invalidated on change (updateOptions → clearTextureAtlas + refresh).`
    );
  }
  // And the grey must sit at a mid-brightness — not clipped to black or white.
  if (r < 40 || r > 210) {
    throw new Error(
      `TUI Saturation=-100 must preserve OKLab lightness; expected a mid-grey for (220,40,40).\n` +
      `  observed=(${r}, ${g}, ${b}); if one channel is near 0 or 255 the chroma scale probably\n` +
      `  isn't running in OKLab (maybe HSL instead?) or the sRGB→linear conversion is missing.`
    );
  }
});

test('TUI Saturation=-100 collapses an explicit bg rect to a grey', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, bgBlockLine(220, 40, 40));
  await setSaturation(page, -100);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (Math.abs(r - g) > TOLERANCE || Math.abs(g - b) > TOLERANCE || Math.abs(r - b) > TOLERANCE) {
    throw new Error(
      `TUI Saturation=-100 should collapse every explicit cell bg to a pure grey (R==G==B within ${TOLERANCE}).\n` +
      `  observed=(${r}, ${g}, ${b})\n` +
      `  Check that _updateRectangle in xterm.ts saturates the rect attrs before the tuiBgAlpha\n` +
      `  premultiply. If only FG collapses but BG stays red, the BG path is missing the transform.`
    );
  }
});
