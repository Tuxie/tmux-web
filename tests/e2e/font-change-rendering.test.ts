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

const PORT_XTERM = 4071;

function startXtermServer(port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
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

async function readSessionSettings(page: import('@playwright/test').Page, session = 'main'): Promise<Record<string, unknown>> {
  return page.evaluate((s) => {
    try {
      return JSON.parse(localStorage.getItem(`tmux-web-session:${s}`) || '{}');
    } catch { return {}; }
  }, session);
}

async function getOtherBundledFont(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
    return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
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

  // Wait for the change to propagate to localStorage
  await page.waitForFunction(
    (font) => {
      try {
        const s = JSON.parse(localStorage.getItem('tmux-web-session:main') || '{}');
        return s.fontFamily === font;
      } catch { return false; }
    },
    newFont,
    { timeout: 5000 },
  );

  await page.click('#btn-menu'); // close menu
}

test.describe('font change rendering: xterm', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT_XTERM}`;

  test.beforeAll(async () => { server = await startXtermServer(PORT_XTERM); });
  test.afterAll(() => killServer(server));

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      localStorage.clear();
      const settings = {
        theme: 'Default',
        colours: 'Gruvbox Dark',
        fontFamily: 'Iosevka Nerd Font Mono',
        fontSize: 18,
        spacing: 1.125,
        opacity: 0,
      };
      localStorage.setItem('tmux-web-session:main', JSON.stringify(settings));
    });
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );
    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10000 });
  });

  test('font change updates xterm options and persisted settings without reloading', async ({ page }) => {
    const otherFont = await getOtherBundledFont(page);
    expect(otherFont).toBeTruthy();

    const metricsBefore = await getAdapterMetrics(page);
    const navigationCountBefore = await page.evaluate(() => performance.getEntriesByType('navigation').length);

    await openMenuAndChangeFont(page, otherFont);

    await page.waitForFunction(
      (font) => document.fonts.check(`18px "${font}"`),
      otherFont,
      { timeout: 5000 },
    );
    await page.waitForFunction(
      (font) => ((window as any).__adapter?.term?.options?.fontFamily ?? '').includes(font),
      otherFont,
      { timeout: 5000 },
    );

    const settings = await readSessionSettings(page);
    const metricsAfter = await getAdapterMetrics(page);
    const navigationCountAfter = await page.evaluate(() => performance.getEntriesByType('navigation').length);

    expect(settings.fontFamily).toBe(otherFont);
    expect(navigationCountAfter).toBe(navigationCountBefore);
    expect(metricsAfter.width).toBeGreaterThan(0);
    expect(metricsAfter.height).toBeGreaterThan(0);
    expect(metricsAfter.cols).toBeGreaterThan(0);
    expect(metricsAfter.rows).toBeGreaterThan(0);
    expect(
      metricsAfter.width !== metricsBefore.width ||
      metricsAfter.height !== metricsBefore.height ||
      metricsAfter.cols !== metricsBefore.cols ||
      metricsAfter.rows !== metricsBefore.rows,
    ).toBe(true);
  });

  test('xterm remains rendered and usable after font change', async ({ page }) => {
    const otherFont = await getOtherBundledFont(page);
    expect(otherFont).toBeTruthy();

    await openMenuAndChangeFont(page, otherFont);
    await page.waitForFunction(
      (font) => ((window as any).__adapter?.term?.options?.fontFamily ?? '').includes(font),
      otherFont,
      { timeout: 5000 },
    );

    await page.evaluate(() => { (window as any).__mockWsReceive('font change render\r\n'); });

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#terminal .xterm-rows')).toContainText('font change render', { timeout: 5000 });
  });
});
