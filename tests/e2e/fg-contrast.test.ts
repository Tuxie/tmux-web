/**
 * Contrast + Bias E2E regression tests.
 *
 * Slider ranges:
 *   #inp-fg-contrast-strength   −100 … +100   (default 0)
 *   #inp-fg-contrast-bias       -100 … +100   (default 0)
 *
 * Behaviour (see `src/client/fg-contrast.ts` for the math):
 *   Strength controls gap/pull around bgL (the background luminance).
 *   Bias is an independent output shift: +100 → white, -100 → black.
 *   Both compose: contrast runs first, then bias shifts the result.
 *   Bias works even at strength=0.
 *
 * Both FG and explicit cell BG colours are affected.
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

test('Contrast strength=0 bias=0 leaves fg at its original value (identity)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(180));
  await setSlider(page, 'inp-fg-contrast-strength', 0);
  await setSlider(page, 'inp-fg-contrast-bias', 0);

  const observed = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  for (const ch of [0, 1, 2] as const) {
    if (Math.abs(observed[ch] - 180) > TOLERANCE) {
      throw new Error(
        `Contrast=0 Bias=0 should be identity. observed=(${observed.join(', ')}), ` +
        `expected≈(180, 180, 180).`
      );
    }
  }
});

test('Bias=+100 always produces white regardless of strength', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(80));
  await setSlider(page, 'inp-fg-contrast-bias', 100);
  await setSlider(page, 'inp-fg-contrast-strength', 0);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (r < 250 || g < 250 || b < 250) {
    throw new Error(
      `Bias=+100 at strength=0 should produce white.\n` +
      `  observed=(${r}, ${g}, ${b})`
    );
  }
});

test('Bias=-100 always produces black regardless of strength', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
  await writeLine(page, greyBlockLine(200));
  await setSlider(page, 'inp-fg-contrast-bias', -100);
  await setSlider(page, 'inp-fg-contrast-strength', 0);

  const [r, g, b] = await samplePixel(page, SAMPLE_X, SAMPLE_Y);
  if (r > 5 || g > 5 || b > 5) {
    throw new Error(
      `Bias=-100 at strength=0 should produce black.\n` +
      `  observed=(${r}, ${g}, ${b})`
    );
  }
});

test('Contrast strength=+100 bias=0 uses bg luminance as hard cutoff', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await disableAutohide(page);
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
