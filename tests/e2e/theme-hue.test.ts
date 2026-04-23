/**
 * Theme Hue slider — e2e behaviour.
 *
 * The slider writes `--tw-theme-hue` on `:root` so themes that use
 * `hsl(var(--tw-theme-hue) <s>% <l>%)` for their GUI-chrome colours
 * (e.g. Amiga Scene 2000's toolbar / menu / bevel palette) rotate
 * without any re-layout. The test uses a test-only probe element with
 * `hsl(var(--tw-theme-hue) 50% 50%)` so it's independent of whichever
 * fixture theme happens to be in use.
 *
 * DOM contract:
 *   - `#sld-theme-hue` / `#inp-theme-hue`  — range 0..360.
 *   - `:root` var `--tw-theme-hue`         — the hue integer.
 */

import { test, type Page } from '@playwright/test';
import { mockSessionStore } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await mockSessionStore(page);
});

async function readyAdapter(page: Page): Promise<void> {
  await page.waitForSelector('#terminal canvas, #terminal .xterm-screen');
  await page.waitForFunction(() => !!(window as any).__adapter);
  await page.waitForTimeout(200);
}

async function setSlider(page: Page, id: string, value: number): Promise<void> {
  await page.click('#btn-menu');
  await page.waitForSelector(`#${id}`, { state: 'visible' });
  await page.fill(`#${id}`, String(value));
  await page.dispatchEvent(`#${id}`, 'change');
  await page.waitForTimeout(200);
  await page.click('#btn-menu');
  await page.waitForTimeout(150);
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    let probe = document.getElementById('test-theme-hue-probe');
    if (!probe) {
      probe = document.createElement('div');
      probe.id = 'test-theme-hue-probe';
      probe.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px;background:hsl(var(--tw-theme-hue, 222) 50% 50%);';
      document.body.appendChild(probe);
    }
  });
}

async function probeRgb(page: Page): Promise<[number, number, number]> {
  return await page.evaluate(() => {
    const probe = document.getElementById('test-theme-hue-probe')!;
    const s = getComputedStyle(probe).backgroundColor;
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return [parseInt(m![1]!, 10), parseInt(m![2]!, 10), parseInt(m![3]!, 10)] as [number, number, number];
  });
}

test('default Theme Hue leaves Scene chrome at 222 (Amiga workbench blue)', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await installProbe(page);

  // At the default hue=222 our probe (hsl(222 50% 50%)) resolves to a
  // predictable blue-dominant rgb. If someone accidentally ships a
  // different default, this catches it.
  const [r, g, b] = await probeRgb(page);
  // Blue must dominate by a clear margin at hue 222.
  if (b <= g + 10 || b <= r + 30) {
    throw new Error(
      `At the default Theme Hue, the probe (hsl(var(--tw-theme-hue) 50% 50%)) should resolve to a ` +
      `clear Amiga workbench blue (blue channel dominant).\n` +
      `  observed rgb = (${r}, ${g}, ${b})\n` +
      `  Default is supposed to be 222 so this exactly matches the Scene theme's prior look.\n` +
      `  Check DEFAULT_THEME_HUE in src/client/background-hue.ts.`
    );
  }
});

test('Theme Hue slider rotates the --tw-theme-hue var and propagates to hsl() consumers', async ({ page }) => {
  await page.goto('/');
  await readyAdapter(page);
  await installProbe(page);

  const defaultRgb = await probeRgb(page);

  // Rotate toward green-ish (hue 120) — the probe's bg should become
  // green-dominant.
  await setSlider(page, 'inp-theme-hue', 120);
  const greenRgb = await probeRgb(page);

  if (greenRgb[0] === defaultRgb[0] && greenRgb[1] === defaultRgb[1] && greenRgb[2] === defaultRgb[2]) {
    throw new Error(
      `Moving the Theme Hue slider should change the probe's rendered colour. The slider ` +
      `either isn't writing --tw-theme-hue on :root, or the CSS probe isn't recomputing.\n` +
      `  default=${defaultRgb.join(',')}, after slider=120=${greenRgb.join(',')}\n` +
      `  Verify applyThemeHue() runs inside onSettingsChange in src/client/index.ts and that ` +
      `the HTML slider id is #inp-theme-hue.`
    );
  }
  if (greenRgb[1] <= greenRgb[0] || greenRgb[1] <= greenRgb[2]) {
    throw new Error(
      `At Theme Hue=120 the probe's green channel should dominate; got rgb=${greenRgb.join(',')}. ` +
      `Check that the slider value is clamped/written as-is (not inverted or scaled) to ` +
      `--tw-theme-hue.`
    );
  }

  // Rotate toward red-ish (hue 0).
  await setSlider(page, 'inp-theme-hue', 0);
  const redRgb = await probeRgb(page);
  if (redRgb[0] <= redRgb[1] || redRgb[0] <= redRgb[2]) {
    throw new Error(
      `At Theme Hue=0 the probe's red channel should dominate; got rgb=${redRgb.join(',')}.`
    );
  }
});

