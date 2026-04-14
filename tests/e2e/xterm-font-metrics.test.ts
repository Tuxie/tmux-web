/**
 * Verify that xterm-dev properly handles font changes by reloading the page.
 *
 * xterm-dev (DOM renderer) requires a page reload to properly recalculate character metrics
 * after a font change, because its metric calculation doesn't update when fonts change in-place.
 *
 * This test suite verifies that:
 * 1. Font changes trigger a page reload
 * 2. After reload, metrics are valid and the new font is applied
 * 3. Multiple consecutive font changes work correctly
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer } from './helpers.js';

const PORT_XTERM_DEV = 4080;

function startBackendServer(terminal: string, port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
  );
}

async function getXtermMetrics(page: import('@playwright/test').Page): Promise<{ cellWidth: number; cellHeight: number; cols: number; rows: number }> {
  // For xterm-dev, font changes cause a reload, so the adapter is fresh after font change
  await page.waitForFunction(() => (window as any).__adapter !== undefined, { timeout: 10000 });
  return page.evaluate(() => {
    const adapter = (window as any).__adapter;
    return {
      cellWidth: adapter.metrics.width,
      cellHeight: adapter.metrics.height,
      cols: adapter.cols,
      rows: adapter.rows,
    };
  });
}

async function changeFontAndWaitForReload(page: import('@playwright/test').Page, fontName: string): Promise<void> {
  let navigationDetected = false;
  page.on('framenavigated', () => {
    navigationDetected = true;
  });

  // Change the font select and dispatch change event
  await page.evaluate((font) => {
    const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
    sel.value = font;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, fontName);

  // Wait for reload
  await page.waitForTimeout(500);
  expect(navigationDetected).toBe(true);

  // Re-apply setup after reload
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await waitForWsOpen(page);
}

test.describe('xterm-dev font changes', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT_XTERM_DEV}`;

  test.beforeAll(async () => { server = await startBackendServer('xterm-dev', PORT_XTERM_DEV); });
  test.afterAll(() => killServer(server));

  test('font change triggers page reload', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    const metricsBefore = await getXtermMetrics(page);
    expect(metricsBefore.cellWidth).toBeGreaterThan(0);

    // Open menu to populate font list
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );

    // Get a different font
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Change font and wait for reload
    await changeFontAndWaitForReload(page, otherFont);

    // Verify metrics are still valid after reload
    const metricsAfter = await getXtermMetrics(page);
    expect(metricsAfter.cellWidth).toBeGreaterThan(0);
    expect(metricsAfter.cellHeight).toBeGreaterThan(0);

    // Verify the new font is in settings
    const settings = await page.evaluate(() =>
      (() => {
        const name = 'tmux-web-settings=';
        const decodedCookie = decodeURIComponent(document.cookie);
        const cookies = decodedCookie.split(';');
        for (const cookie of cookies) {
          const trimmed = cookie.trim();
          if (trimmed.startsWith(name)) {
            try {
              return JSON.parse(trimmed.substring(name.length));
            } catch {}
          }
        }
        return {};
      })()
    );
    expect(settings.fontFamily).toBe(otherFont);
  });

  test('text renders correctly after font change', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    // Get a different font
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });

    // Change font
    await changeFontAndWaitForReload(page, otherFont);

    // Send test text
    const longLine = 'A'.repeat(50) + '\r\n';
    await page.evaluate((line) => (window as any).__mockWsReceive(line), longLine);

    // Verify text appears
    await expect(page.locator('#terminal .xterm-rows')).toContainText('AAAA', { timeout: 5000 });
  });

  test('multiple consecutive font changes work', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    // Open menu to populate font list
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );

    // Get two different fonts
    const fonts = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options)
        .filter(o => !o.value.includes('Iosevka Nerd Font Mono'))
        .slice(0, 2)
        .map(o => o.value);
    });
    expect(fonts.length).toBeGreaterThanOrEqual(2);

    // Change to first font
    await changeFontAndWaitForReload(page, fonts[0]);
    const metrics1 = await getXtermMetrics(page);
    expect(metrics1.cellWidth).toBeGreaterThan(0);

    // Change to second font
    await changeFontAndWaitForReload(page, fonts[1]);
    const metrics2 = await getXtermMetrics(page);
    expect(metrics2.cellWidth).toBeGreaterThan(0);

    // Verify final font setting
    const settings = await page.evaluate(() =>
      (() => {
        const name = 'tmux-web-settings=';
        const decodedCookie = decodeURIComponent(document.cookie);
        const cookies = decodedCookie.split(';');
        for (const cookie of cookies) {
          const trimmed = cookie.trim();
          if (trimmed.startsWith(name)) {
            try {
              return JSON.parse(trimmed.substring(name.length));
            } catch {}
          }
        }
        return {};
      })()
    );
    expect(settings.fontFamily).toBe(fonts[1]);
  });
});
