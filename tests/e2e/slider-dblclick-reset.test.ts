/**
 * Double-click-to-reset behaviour for settings-menu sliders.
 *
 * Every slider in the settings menu responds to a double-click on
 * either the range track or the paired number input by resetting to
 * its theme-scoped default. The slider's value is persisted via the
 * same change path as a manual edit so the session store sees the new
 * (default) value.
 *
 * Default resolution per slider (see `attachDoubleClickReset` in
 * `src/client/ui/topbar.ts`):
 *   - font size / spacing / BG Opacity / TUI BG / TUI FG Opacity →
 *     the active theme's corresponding `default*` field, falling back
 *     to DEFAULT_SESSION_SETTINGS when the theme doesn't declare one.
 *   - BG Hue / Saturation / Brightest / Darkest, Theme Hue, FG
 *     Contrast / Bias → their respective DEFAULT_* constants (no
 *     per-theme knob today).
 */
import { test, expect, type Page } from '@playwright/test';
import { mockSessionStore, type SessionStoreMock } from './helpers.js';
import { FX } from './fixture-themes.js';

test.beforeEach(async ({ page }) => {
  await mockSessionStore(page);
});

async function readyMenu(page: Page): Promise<void> {
  await page.waitForSelector('#terminal canvas, #terminal .xterm-screen');
  await page.click('#btn-menu');
  await page.waitForSelector('#sld-theme-hue', { state: 'visible' });
  // Disable autohide so the menu stays open through several tweaks.
  await page.evaluate(() => {
    const cb = document.getElementById('chk-autohide') as HTMLInputElement;
    if (cb && cb.checked) cb.click();
  });
}

async function waitForStored(store: SessionStoreMock, name: string, predicate: (s: any) => boolean): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const s = store.get().sessions[name];
    if (s && predicate(s)) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Session '${name}' never matched predicate — stored=${JSON.stringify(store.get().sessions[name])}`);
}

test('double-click on a theme-global slider (Theme Hue) resets to DEFAULT_THEME_HUE', async ({ page }) => {
  const store = await mockSessionStore(page);
  await page.goto('/');
  await readyMenu(page);

  await page.fill('#inp-theme-hue', '60');
  await page.dispatchEvent('#inp-theme-hue', 'change');
  await waitForStored(store, 'main', s => s.themeHue === 60);

  await page.locator('#sld-theme-hue').dblclick();

  await expect(page.locator('#inp-theme-hue')).toHaveValue('222');
  await waitForStored(store, 'main', s => s.themeHue === 222);
});

test('double-click on a theme-scoped slider (TUI BG Opacity) resets to the active theme default', async ({ page }) => {
  // The alt fixture theme declares defaultTuiBgOpacity: 70. Make the
  // active session use that theme so the expected default is 70, not
  // the baseline 100.
  const store = await mockSessionStore(page, {
    sessions: {
      main: {
        theme: FX.themes.alt,
        colours: FX.colours.c,
        fontFamily: FX.fonts.secondary,
        fontSize: FX.altDefaultFontSize,
        spacing: FX.altDefaultSpacing,
        opacity: FX.altDefaultOpacity,
        tuiBgOpacity: 25,                       // far from the theme default
        tuiFgOpacity: FX.altDefaultTuiFgOpacity,
      },
    },
  });
  await page.goto('/');
  await readyMenu(page);
  await expect(page.locator('#inp-tui-bg-opacity')).toHaveValue('25');

  await page.locator('#inp-tui-bg-opacity').dblclick();

  await expect(page.locator('#inp-tui-bg-opacity')).toHaveValue(String(FX.altDefaultTuiBgOpacity));
  await waitForStored(store, 'main', s => s.tuiBgOpacity === FX.altDefaultTuiBgOpacity);
});

test('double-click on the number input (FG Contrast) resets to 0', async ({ page }) => {
  const store = await mockSessionStore(page);
  await page.goto('/');
  await readyMenu(page);

  await page.fill('#inp-fg-contrast-strength', '80');
  await page.dispatchEvent('#inp-fg-contrast-strength', 'change');
  await waitForStored(store, 'main', s => s.fgContrastStrength === 80);

  await page.locator('#inp-fg-contrast-strength').dblclick();

  await expect(page.locator('#inp-fg-contrast-strength')).toHaveValue('0');
  await waitForStored(store, 'main', s => s.fgContrastStrength === 0);
});

test('double-click on BG Hue resets to 183', async ({ page }) => {
  const store = await mockSessionStore(page);
  await page.goto('/');
  await readyMenu(page);

  await page.fill('#inp-background-hue', '45');
  await page.dispatchEvent('#inp-background-hue', 'change');
  await waitForStored(store, 'main', s => s.backgroundHue === 45);

  await page.locator('#sld-background-hue').dblclick();

  await expect(page.locator('#inp-background-hue')).toHaveValue('183');
  await waitForStored(store, 'main', s => s.backgroundHue === 183);
});
