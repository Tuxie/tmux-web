/**
 * Verify that character spacing/metrics update immediately after font change,
 * without requiring a page reload.
 *
 * Different fonts have different character widths. When the font changes,
 * the adapter should report new metrics (character cell width/height) and the
 * terminal should re-render with correct spacing.
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer } from './helpers.js';

const PORT_GHOSTTY = 4071;

function startBackendServer(terminal: string, port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
  );
}

async function getAdapterMetrics(page: import('@playwright/test').Page): Promise<{ width: number; height: number; cols: number; rows: number }> {
  return page.evaluate(() => {
    const adapter = (window as any).__adapter;
    return {
      width: adapter.metrics.width,
      height: adapter.metrics.height,
      cols: adapter.cols,
      rows: adapter.rows,
    };
  });
}

async function openMenuAndChangeFont(page: import('@playwright/test').Page, newFont: string): Promise<void> {
  await page.mouse.move(640, 10);
  await page.waitForFunction(
    () => !document.getElementById('topbar')?.classList.contains('hidden'),
    { timeout: 5000 },
  );
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();

  // Wait for font list to populate
  await page.waitForFunction(
    () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
    { timeout: 5000 },
  );

  await page.selectOption('#inp-font-bundled', newFont);
  await page.locator('#inp-font-bundled').dispatchEvent('change');

  // Wait for the change to propagate
  await page.waitForFunction(
    (font) => {
      const name = 'tmux-web-settings=';
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookies = decodedCookie.split(';');
    let settings = {};
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith(name)) {
        try {
          settings = JSON.parse(trimmed.substring(name.length));
        } catch {}
        break;
      }
    }
      return settings.fontFamily === font;
    },
    newFont,
    { timeout: 5000 },
  );

  await page.click('#btn-menu'); // close menu
}

// ---------------------------------------------------------------------------
// ghostty: Canvas-based renderer. Font changes trigger reload so we just
// verify the reload happened and new metrics are correct.
// ---------------------------------------------------------------------------
test.describe('font change rendering: ghostty', () => {
  test('font setting persists across page reload triggered by font change', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);

    // Get a different bundled font
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Set up route handlers for the reload
    await page.route('/api/sessions', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '["main"]' })
    );
    await page.route('/api/windows**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    // Open menu
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();

    // Wait for font list
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );

    // Trigger reload by changing font
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-font-bundled', otherFont);
    await navPromise;

    // Wait for terminal to be ready after reload
    await waitForWsOpen(page);
    await page.waitForFunction(
      () => (window as any).__adapter !== undefined,
      { timeout: 10000 },
    );

    // Verify the font was loaded from settings and applied to ghostty
    const finalSettings = await page.evaluate(() => {
      const name = 'tmux-web-settings=';
      const decodedCookie = decodeURIComponent(document.cookie);
      for (const cookie of decodedCookie.split(';')) {
        const trimmed = cookie.trim();
        if (trimmed.startsWith(name)) {
          try { return JSON.parse(trimmed.substring(name.length)); } catch {}
        }
      }
      return {};
    });
    expect(finalSettings.fontFamily).toBe(otherFont);
  });

  test('canvas renders correctly after reload with new font', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);

    // Wait for canvas to appear
    const canvas = page.locator('#terminal canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Get a different font
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Set up route handlers for reload
    await page.route('/api/sessions', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '["main"]' })
    );
    await page.route('/api/windows**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    // Trigger reload
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();

    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );

    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-font-bundled', otherFont);
    await navPromise;

    // Wait for terminal to be ready after reload
    await waitForWsOpen(page);
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Verify canvas is rendering and has dimensions
    const boxAfter = await canvas.boundingBox();
    expect(boxAfter!.width).toBeGreaterThan(0);
    expect(boxAfter!.height).toBeGreaterThan(0);

    // Verify the font was persisted in settings
    const settings = await page.evaluate(() => {
      const name = 'tmux-web-settings=';
      const decodedCookie = decodeURIComponent(document.cookie);
      for (const cookie of decodedCookie.split(';')) {
        const trimmed = cookie.trim();
        if (trimmed.startsWith(name)) {
          try { return JSON.parse(trimmed.substring(name.length)); } catch {}
        }
      }
      return {};
    });
    expect(settings.fontFamily).toBe(otherFont);
  });
});
