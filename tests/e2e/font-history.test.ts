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

async function getSettings(page: import('@playwright/test').Page): Promise<Record<string, any>> {
  return page.evaluate(() => {
    const name = 'tmux-web-settings=';
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookies = decodedCookie.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith(name)) {
        try {
          return JSON.parse(trimmed.substring(name.length));
        } catch {
          return {};
        }
      }
    }
    return {};
  });
}

test.describe('font and line height memory', () => {
  test.beforeEach(async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('bundled font selection is remembered when switching sources', async ({ page }) => {
    // Keep mouse hovering topbar to prevent autohide from closing the menu
    await page.mouse.move(640, 10);

    // Open menu first to populate font list
    await openMenu(page);

    // Wait for fonts to load
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );

    // Get a non-default bundled font
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('mOsOul'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Select a different bundled font
    await page.selectOption('#inp-font-bundled', otherFont);
    // Manually trigger change event in case selectOption doesn't
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
    await page.waitForFunction(
      () => !(document.getElementById('inp-font') as HTMLInputElement).hidden,
      { timeout: 5000 }
    );

    await page.fill('#inp-font', 'monospace');
    // Blur the input to trigger change event
    await page.press('#inp-font', 'Tab');

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
    await page.waitForFunction(
      (font) => {
        const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
        return sel.value === font;
      },
      otherFont,
      { timeout: 5000 }
    );

    const selectedFont = await page.inputValue('#inp-font-bundled');
    expect(selectedFont).toBe(otherFont);
  });

  test('custom font text is remembered when switching sources', async ({ page }) => {
    await page.mouse.move(640, 10);
    const customFontName = 'My Custom Font';

    // Open menu and switch to custom source
    await openMenu(page);
    await page.selectOption('#inp-fontsource', 'custom');

    // Wait for input to be visible after source change
    await page.waitForFunction(
      () => !(document.getElementById('inp-font') as HTMLInputElement).hidden,
      { timeout: 5000 }
    );

    await page.fill('#inp-font', customFontName);
    // Blur the input to trigger change event
    await page.press('#inp-font', 'Tab');

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

    // Wait for bundled to be set
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
              return settings.fontSource === 'bundled';
            } catch {
              return false;
            }
          }
        }
        return false;
      },
      { timeout: 5000 }
    );

    // Switch back to custom — the font name should be restored
    await page.selectOption('#inp-fontsource', 'custom');

    // Wait for the input to have the correct value
    await page.waitForFunction(
      (font) => {
        const inp = document.getElementById('inp-font') as HTMLInputElement;
        return inp.value === font;
      },
      customFontName,
      { timeout: 5000 }
    );

    const restoredFont = await page.inputValue('#inp-font');
    expect(restoredFont).toBe(customFontName);
  });

  test('line height is remembered per bundled font', async ({ page }) => {
    await page.mouse.move(640, 10);

    // Open menu first to populate font list
    await openMenu(page);

    // Wait for fonts to load
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );

    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('mOsOul'))?.value ?? '';
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
    await page.selectOption('#inp-font-bundled', 'mOsOul Nerd Font');

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
    await page.mouse.move(640, 10);
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('mOsOul'))?.value ?? '';
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
    await page.mouse.move(640, 10);
    await openMenu(page);
    const selectedFont = await page.inputValue('#inp-font-bundled');
    const lineHeight = await page.inputValue('#inp-lineheight');
    expect(selectedFont).toBe(otherFont);
    expect(parseFloat(lineHeight)).toBeCloseTo(0.85, 1);
  });
});
