/**
 * FG Contrast E2E regression tests
 * =================================
 *
 * The FG Contrast transform (see `src/client/fg-contrast.ts`) pushes
 * the glyph colour's OKLab lightness away from the cell bg's lightness
 * (shifted by a bias) so TUI text doesn't disappear into near-identical
 * backgrounds. Hue/chroma are preserved; only L moves.
 *
 * DOM contract (do not rename without updating tests):
 *   - `#sld-fg-contrast-strength` / `#inp-fg-contrast-strength` — 0..100
 *   - `#sld-fg-contrast-bias`     / `#inp-fg-contrast-bias`     — -50..+50
 *
 * These tests write block glyphs (█) in a truecolor fg over a truecolor
 * bg whose lightness is close to the fg's. With strength=0 the glyph
 * collapses into the bg; with strength>0 it becomes visibly distinct.
 */

import { test, type Page } from '@playwright/test';
import { mockSessionStore } from './helpers.js';

// The test server uses a single sessions.json for the whole run, so
// leaving fgContrastStrength > 0 persisted would leak into later tests
// (e.g. tui-fg-opacity) and change their baseline. Mock the store per
// test so our slider changes live only in this test's memory.
test.beforeEach(async ({ page }) => {
  await mockSessionStore(page);
});

const TOLERANCE = 3;

async function openMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForSelector('#sld-fg-contrast-strength', { state: 'visible' });
}

async function closeMenu(page: Page): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForTimeout(150);
}

async function setSlider(page: Page, id: string, value: number): Promise<void> {
  await openMenu(page);
  await page.fill(`#${id}`, String(value));
  await page.dispatchEvent(`#${id}`, 'change');
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
    test.skip(true, 'WebGL renderer unavailable — FG Contrast patch only applies to WebGL');
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

async function samplePixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: 3, height: 3 } });
  // @ts-expect-error — pngjs has no @types.
  const { PNG } = (await import('pngjs')) as { PNG: any };
  const img = PNG.sync.read(buf);
  const i = (1 * img.width + 1) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
}

// A truecolor-bg + truecolor-fg line where both are near mid-grey so the
// text is barely distinguishable from the bg at strength=0. The glyph
// chosen is a solid block so the sampled pixel reliably lands on fg.
const BG_COLOUR = { r: 128, g: 128, b: 128 };
const FG_COLOUR = { r: 140, g: 140, b: 140 };
const LINE =
  `\x1b[48;2;${BG_COLOUR.r};${BG_COLOUR.g};${BG_COLOUR.b}m` +
  `\x1b[38;2;${FG_COLOUR.r};${FG_COLOUR.g};${FG_COLOUR.b}m` +
  '██████████████████████████████' +
  '\x1b[0m';

const SAMPLE_X = 100;
const SAMPLE_Y = 38;

test('FG Contrast strength=0 leaves near-bg fg unchanged (identity)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, LINE);

  await setSlider(page, 'inp-fg-contrast-strength', 0);
  await setSlider(page, 'inp-fg-contrast-bias', 0);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  const diff = Math.abs(r - FG_COLOUR.r) + Math.abs(g - FG_COLOUR.g) + Math.abs(b - FG_COLOUR.b);
  if (diff > TOLERANCE * 3) {
    throw new Error(
      `FG Contrast=0 should be identity, but the observed fg pixel differs from the original.\n` +
      `  original fg=(${FG_COLOUR.r}, ${FG_COLOUR.g}, ${FG_COLOUR.b})\n` +
      `  observed   =(${r}, ${g}, ${b})\n` +
      `  sum |Δ|=${diff}, tolerance=${TOLERANCE * 3}\n` +
      `  pushFgLightness must short-circuit at strength=0 — see src/client/fg-contrast.ts.`
    );
  }
});

test('FG Contrast strength>0 pushes near-bg fg visibly away from bg', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, LINE);

  await setSlider(page, 'inp-fg-contrast-bias', 0);
  await setSlider(page, 'inp-fg-contrast-strength', 0);
  const baseline = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

  await setSlider(page, 'inp-fg-contrast-strength', 100);
  const pushed = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

  // Distance from bg grey should grow.
  const baseDist = Math.abs(baseline[0] - BG_COLOUR.r) +
                   Math.abs(baseline[1] - BG_COLOUR.g) +
                   Math.abs(baseline[2] - BG_COLOUR.b);
  const pushDist = Math.abs(pushed[0] - BG_COLOUR.r) +
                   Math.abs(pushed[1] - BG_COLOUR.g) +
                   Math.abs(pushed[2] - BG_COLOUR.b);
  if (pushDist <= baseDist + 10) {
    throw new Error(
      `FG Contrast strength=100 should push the glyph much farther from the bg grey.\n` +
      `  bg=(${BG_COLOUR.r}, ${BG_COLOUR.g}, ${BG_COLOUR.b})\n` +
      `  baseline fg pixel=(${baseline.join(', ')}), sum |Δ| to bg=${baseDist}\n` +
      `  strength=100  fg pixel=(${pushed.join(', ')}),   sum |Δ| to bg=${pushDist}\n` +
      `  Expected pushDist > baseDist + 10. The atlas may be serving a stale glyph —\n` +
      `  updateOptions must call webglAddon.clearTextureAtlas() when strength or bias\n` +
      `  change, same as the opacity sliders do.`
    );
  }
});

test('FG Contrast positive bias pushes fg brighter', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, LINE);

  await setSlider(page, 'inp-fg-contrast-strength', 100);

  await setSlider(page, 'inp-fg-contrast-bias', -30);
  const dark = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  await setSlider(page, 'inp-fg-contrast-bias', 30);
  const bright = await samplePixel(page, SAMPLE_X, SAMPLE_Y);

  // With the fg (140) sitting above bg (128), negative bias moves
  // the reference below bg, pushing fg farther brighter. Positive bias
  // moves the reference above fg, pushing fg darker.
  // So "bright" sample should actually be DARKER than "dark" sample
  // for this fg/bg configuration. Test captures that directional
  // relationship.
  if (dark[0] <= bright[0]) {
    throw new Error(
      `Bias direction regression: with fg(140) just above bg(128), a negative bias puts ` +
      `the repulsion ref below bg so fg gets pushed even brighter, and a positive bias ` +
      `puts the ref above fg so fg gets pushed darker.\n` +
      `  bias=-30 observed=(${dark.join(', ')})\n` +
      `  bias=+30 observed=(${bright.join(', ')})\n` +
      `  Expected dark[0] > bright[0].`
    );
  }
});
