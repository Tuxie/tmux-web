/**
 * Verify that font and line height preferences are remembered per source/font.
 *
 * - Last selected bundled font is restored when switching back to bundled source
 * - Last typed custom font is restored when switching back to custom source
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
    await page.addInitScript(() => {
      const settings = {
        fontSource: 'bundled',
        fontFamily: 'Iosevka Nerd Font Mono',
        fontSize: 18,
        lineHeight: 1.125
      };
      document.cookie = `tmux-web-settings=${encodeURIComponent(JSON.stringify(settings))}; path=/;`;
      localStorage.clear();
    });
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('bundled font selection is remembered when switching sources', async ({ page }) => {
    await openMenu(page);

    // Get a non-default bundled font
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Select a different bundled font
    await page.selectOption('#inp-font-bundled', otherFont);
    await page.locator('#inp-font-bundled').dispatchEvent('change');

    // Wait for the commit to save settings
    await page.waitForFunction(
      (font) => {
        const name = 'tmux-web-settings=';
        const decodedCookie = decodeURIComponent(document.cookie);
        const cookies = decodedCookie.split(';');
        for (const cookie of cookies) {
          const trimmed = cookie.trim();
          if (trimmed.startsWith(name)) {
            try {
              const settings = JSON.parse(trimmed.substring(name.length));
              return settings.lastFontPerSource?.bundled === font;
            } catch {
              return false;
            }
          }
        }
        return false;
      },
      otherFont,
      { timeout: 5000 }
    );

    // Switch to custom source
    await page.selectOption('#inp-fontsource', 'custom');

    // Wait for input to be visible after source change
    await expect(page.locator('#inp-font')).toBeVisible();

    await page.fill('#inp-font', 'monospace');
    await page.press('#inp-font', 'Enter'); // trigger change

    // Wait for custom font to be saved
    await page.waitForFunction(
      () => {
        const name = 'tmux-web-settings=';
        const decodedCookie = decodeURIComponent(document.cookie);
        const cookies = decodedCookie.split(';');
        for (const cookie of cookies) {
          const trimmed = cookie.trim();
          if (trimmed.startsWith(name)) {
            try {
              const settings = JSON.parse(trimmed.substring(name.length));
              return settings.fontSource === 'custom' && settings.fontFamily === 'monospace';
            } catch {
              return false;
            }
          }
        }
        return false;
      },
      { timeout: 5000 }
    );

    // Switch back to bundled — the previously selected font should be restored
    await page.selectOption('#inp-fontsource', 'bundled');

    // Wait for the font value to be restored
    await expect(page.locator('#inp-font-bundled')).toHaveValue(otherFont);
  });

  test('custom font text is remembered when switching sources', async ({ page }) => {
    const customFontName = 'My Custom Font';

    await openMenu(page);
    await page.selectOption('#inp-fontsource', 'custom');
    await expect(page.locator('#inp-font')).toBeVisible();

    await page.fill('#inp-font', customFontName);
    await page.press('#inp-font', 'Enter');

    // Wait for custom font to be saved
    await page.waitForFunction(
      (font) => {
        const name = 'tmux-web-settings=';
        const decodedCookie = decodeURIComponent(document.cookie);
        const cookies = decodedCookie.split(';');
        for (const cookie of cookies) {
          const trimmed = cookie.trim();
          if (trimmed.startsWith(name)) {
            try {
              const settings = JSON.parse(trimmed.substring(name.length));
              return settings.fontSource === 'custom' && settings.fontFamily === font;
            } catch {
              return false;
            }
          }
        }
        return false;
      },
      customFontName,
      { timeout: 5000 }
    );

    // Switch to bundled
    await page.selectOption('#inp-fontsource', 'bundled');
    await page.waitForTimeout(100);

    // Switch back to custom — the font name should be restored
    await page.selectOption('#inp-fontsource', 'custom');
    await expect(page.locator('#inp-font')).toHaveValue(customFontName);
  });

  test('line height is remembered per bundled font', async ({ page }) => {
    await openMenu(page);

    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Select default bundled font, set line height to 1.5
    await page.fill('#inp-lineheight', '1.5');
    await page.locator('#inp-lineheight').dispatchEvent('change');
    await page.waitForTimeout(100);

    // Switch to different bundled font
    await page.selectOption('#inp-font-bundled', otherFont);
    await page.waitForTimeout(100);
    // Set line height to 0.9 for this font
    await page.fill('#inp-lineheight', '0.9');
    await page.locator('#inp-lineheight').dispatchEvent('change');
    await page.waitForTimeout(100);

    // Switch back to default font — line height should return to 1.5
    await page.selectOption('#inp-font-bundled', 'Iosevka Nerd Font Mono');

    // Wait for line height to be restored
    await page.waitForFunction(
      () => {
        const value = parseFloat((document.getElementById('inp-lineheight') as HTMLInputElement)?.value || '0');
        return Math.abs(value - 1.5) < 0.1;
      },
      { timeout: 5000 }
    );

    const lineHeight = await page.inputValue('#inp-lineheight');
    expect(parseFloat(lineHeight)).toBeCloseTo(1.5, 1);
  });

  test('persists across page reload', async ({ page }) => {
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

    // Close menu before reload to avoid sessionStorage handling
    await page.click('#btn-menu');

    // Reload the page
    await page.reload();
    await waitForWsOpen(page);
    await waitForFontList(page);

    // Verify the font and line height are restored
    await openMenu(page);
    await expect(page.locator('#inp-font-bundled')).toHaveValue(otherFont);
    const lineHeight = await page.inputValue('#inp-lineheight');
    expect(parseFloat(lineHeight)).toBeCloseTo(0.85, 1);
  });
});
