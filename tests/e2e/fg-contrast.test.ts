/**
 * FG Contrast E2E regression tests (new two-sided semantics).
 *
 * Slider ranges:
 *   #inp-fg-contrast-strength   −100 … +100   (default 0)
 *   #inp-fg-contrast-bias          0 … 100    (default 50, i.e. mid)
 *
 * Behaviour (see `src/client/fg-contrast.ts` for the math):
 *   strength = 0    → identity; bias is ignored.
 *   strength = -100 → every glyph collapses to the bias lightness.
 *                     Bias 0 → black, 100 → white, 50 → mid-grey.
 *   strength = +100 → hard threshold at the bias: below → black,
 *                     above → white. Bias selects the cutoff point.
 *   intermediate    → smooth interpolation (see unit tests).
 *
 * These e2e tests drive the sliders through the UI and sample the
 * rendered block-glyph pixel to verify the end-to-end path
 * (slider → session settings → adapter → atlas → pixel).
 */

import { test, type Page } from '@playwright/test';
import { mockSessionStore } from './helpers.js';

const TOLERANCE = 3;

test.beforeEach(async ({ page }) => {
  await mockSessionStore(page);
});

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

/** A row of block glyphs painted in an explicit truecolour fg. The
 *  contrast transform reshapes OKLab L but preserves chroma; picking
 *  a fully-grey fg (R=G=B) means "push to white" lands byte-exact on
 *  (255,255,255) without the fixture theme's pinkish tint messing up
 *  the assertion. */
function greyBlockLine(grey: number): string {
  return `\x1b[38;2;${grey};${grey};${grey}m${'█'.repeat(30)}\x1b[0m`;
}

async function samplePixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const buf = await page.screenshot({ clip: { x: Math.max(0, x - 1), y: Math.max(0, y - 1), width: 3, height: 3 } });
  // @ts-expect-error — pngjs has no @types.
  const { PNG } = (await import('pngjs')) as { PNG: any };
  const img = PNG.sync.read(buf);
  const i = (1 * img.width + 1) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
}

// Solid block glyphs on default bg so the sampled pixel reliably
// captures the transformed fg colour.
const SAMPLE_X = 100;
const SAMPLE_Y = 38;

test('FG Contrast strength=0 leaves fg at its original truecolor value (identity)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-strength', 0);

  const observed = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  for (const ch of [0, 1, 2] as const) {
    if (Math.abs(observed[ch] - 180) > TOLERANCE) {
      throw new Error(
        `FG Contrast=0 should be identity. observed=(${observed.join(', ')}), ` +
        `expected≈(180, 180, 180). pushFgLightness must short-circuit at strength=0 — ` +
        `see src/client/fg-contrast.ts.`
      );
    }
  }
});

test('FG Contrast strength=+100 with bias=50 drives text to pure white (theme fg is bright)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-bias', 50);
  await setSlider(page, 'inp-fg-contrast-strength', 100);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  // The fixture theme foreground is near-white (OKLab L ≫ 0.5), so at
  // strength=+100 / bias=50 the glyph should snap to pure white.
  if (r < 250 || g < 250 || b < 250) {
    throw new Error(
      `FG Contrast=+100 with bias=50 should push a bright theme fg to pure white (255,255,255).\n` +
      `  observed=(${r}, ${g}, ${b})\n` +
      `  This suggests the hard-threshold branch of pushFgLightness isn't firing at t=+1, or the\n` +
      `  adapter still gates on strength > 0 (should be strength !== 0).`
    );
  }
});

test('FG Contrast strength=+100 bias moves the black/white threshold', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180)); // grey 180 → OKLab L ≈ 0.73
  await setSlider(page, 'inp-fg-contrast-strength', 100);

  // Bias 50 (L=0.5) — the fg's L=0.73 is above → white.
  await setSlider(page, 'inp-fg-contrast-bias', 50);
  const below = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (below[0] < 250 || below[1] < 250 || below[2] < 250) {
    throw new Error(
      `Bias=50 is below the fg's L (~0.73); expected white (255,255,255).\n` +
      `  observed=(${below.join(', ')})`
    );
  }

  // Bias 90 (L=0.9) — the fg's L=0.73 is below → black.
  await setSlider(page, 'inp-fg-contrast-bias', 90);
  const above = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (above[0] > 5 || above[1] > 5 || above[2] > 5) {
    throw new Error(
      `Bias=90 is above the fg's L (~0.73); expected black (0,0,0).\n` +
      `  observed=(${above.join(', ')})\n` +
      `  The bias direction might be inverted, or the slider value isn't reaching pushFgLightness.`
    );
  }
});

test('FG Contrast strength=-100 with bias=0 collapses fg to black', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-bias', 0);
  await setSlider(page, 'inp-fg-contrast-strength', -100);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (r > 5 || g > 5 || b > 5) {
    throw new Error(
      `FG Contrast=-100 with bias=0 should collapse every fg to black.\n` +
      `  observed=(${r}, ${g}, ${b})\n` +
      `  The negative branch of pushFgLightness should lerp L toward bias=0 at full magnitude.\n` +
      `  Also make sure the slider's min="-100" HTML attr is in place — without it some browsers clamp.`
    );
  }
});

test('FG Contrast strength=-100 with bias=100 collapses fg to white', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-bias', 100);
  await setSlider(page, 'inp-fg-contrast-strength', -100);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (r < 250 || g < 250 || b < 250) {
    throw new Error(
      `FG Contrast=-100 with bias=100 should collapse every fg to white.\n` +
      `  observed=(${r}, ${g}, ${b})`
    );
  }
});
