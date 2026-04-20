/**
 * Contrast E2E regression tests.
 *
 * Slider ranges:
 *   #inp-fg-contrast-strength   −100 … +100   (default 0)
 *   #inp-fg-contrast-bias       -100 … +100   (default 0 = bg luminance)
 *
 * Behaviour (see `src/client/fg-contrast.ts` for the math):
 *   strength = 0    → identity; bias + bgL are ignored.
 *   strength = -100 → every colour collapses to the cutoff lightness.
 *                     Bias +100 → white, -100 → black, 0 → bg luminance.
 *                     (positive bias = "towards brighter" in both modes)
 *   strength = +100 → hard threshold at cutoff: below → black,
 *                     above → white.
 *   intermediate    → exclusion gap (see unit tests).
 *
 * Both FG and explicit cell BG colours are affected.
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
    test.skip(true, 'WebGL renderer unavailable — Contrast patch only applies to WebGL');
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

const SAMPLE_X = 100;
const SAMPLE_Y = 38;

test('Contrast strength=0 leaves fg at its original truecolor value (identity)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-strength', 0);

  const observed = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  for (const ch of [0, 1, 2] as const) {
    if (Math.abs(observed[ch] - 180) > TOLERANCE) {
      throw new Error(
        `Contrast=0 should be identity. observed=(${observed.join(', ')}), ` +
        `expected≈(180, 180, 180). pushLightness must short-circuit at strength=0.`
      );
    }
  }
});

test('Contrast strength=+100 with bias=-100 ("towards darker") drives all text to black', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-bias', -100);
  await setSlider(page, 'inp-fg-contrast-strength', 100);

  // bias=-100 → cutoff=1.0. Everything is below cutoff → black.
  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (r > 5 || g > 5 || b > 5) {
    throw new Error(
      `Contrast=+100 with bias=-100 → cutoff=1.0; all fg below cutoff → black.\n` +
      `  observed=(${r}, ${g}, ${b})`
    );
  }
});

test('Contrast strength=+100 bias=0 uses bg luminance as hard cutoff', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  // Grey 180 → OKLab L ≈ 0.73, well above any dark-theme bg → white.
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-bias', 0);
  await setSlider(page, 'inp-fg-contrast-strength', 100);

  const bright = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (bright[0] < 250 || bright[1] < 250 || bright[2] < 250) {
    throw new Error(
      `Bias=0 → cutoff=bgL (dark). Grey 180 (L≈0.73) above cutoff → white.\n` +
      `  observed=(${bright.join(', ')})`
    );
  }
});

test('Contrast strength=-100 with bias=+100 ("towards brighter") collapses fg to white', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-bias', 100);
  await setSlider(page, 'inp-fg-contrast-strength', -100);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (r < 250 || g < 250 || b < 250) {
    throw new Error(
      `Contrast=-100 with bias=+100 → cutoff=1; collapse to white.\n` +
      `  observed=(${r}, ${g}, ${b})`
    );
  }
});

test('Contrast strength=-100 with bias=-100 ("towards darker") collapses fg to black', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-bias', -100);
  await setSlider(page, 'inp-fg-contrast-strength', -100);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (r > 5 || g > 5 || b > 5) {
    throw new Error(
      `Contrast=-100 with bias=-100 → cutoff=0; collapse to black.\n` +
      `  observed=(${r}, ${g}, ${b})`
    );
  }
});
