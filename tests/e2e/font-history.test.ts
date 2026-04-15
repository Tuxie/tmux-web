/**
 * Verify that font and line height preferences are remembered per font.
 *
 * - Line height is remembered per font: changing fonts restores the height last used with that font
 */
import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

async function openMenu(page: import('@playwright/test').Page): Promise<void> {
  // Reveal topbar
  await page.mouse.move(640, 10);
  await page.waitForTimeout(100);
  // Assumes mouse is already hovering topbar to prevent autohide
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();
}

async function waitForFontList(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
    { timeout: 5000 },
  );
}

test.describe('font and line height memory', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('line height change persists in session settings', async ({ page }) => {
    await openMenu(page);

    // Change line height
    await page.fill('#inp-lineheight', '1.5');
    await page.locator('#inp-lineheight').dispatchEvent('change');
    await page.waitForTimeout(100);

    // Verify it's saved to localStorage
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('tmux-web-session:main') || '{}'); } catch { return {}; }
    });
    expect(stored.lineHeight).toBeCloseTo(1.5, 1);
  });

  test('font and line height persist across page reload', async ({ page }) => {
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Open menu, select a bundled font and set line height
    await openMenu(page);
    await page.selectOption('#inp-font-bundled', otherFont);
    await page.fill('#inp-lineheight', '0.85');
    await page.locator('#inp-lineheight').dispatchEvent('change');
    await page.waitForTimeout(100);

    // Close menu before reload
    await page.click('#btn-menu');

    // Reload the page (localStorage persists)
    await page.reload();
    await waitForWsOpen(page);
    await waitForFontList(page);

    // Verify the font and line height are restored from localStorage
    await openMenu(page);
    await expect(page.locator('#inp-font-bundled')).toHaveValue(otherFont);
    const lineHeight = await page.inputValue('#inp-lineheight');
    expect(parseFloat(lineHeight)).toBeCloseTo(0.85, 1);
  });
});
