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
import { mockApis, mockSessionStore, injectWsSpy, waitForWsOpen, startServer, killServer, openSettingsMenu, type SessionStoreMock } from './helpers.js';
import { FX, fixtureSessionSettings } from './fixture-themes.js';

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

async function getXtermFontFamily(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => (window as any).__adapter?.term?.options?.fontFamily ?? '');
}

function readSessionSettings(store: SessionStoreMock, session = 'main'): Record<string, unknown> {
  return (store.get().sessions[session] ?? {}) as unknown as Record<string, unknown>;
}

async function getOtherBundledFont(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate((primary) => {
    const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
    return Array.from(sel.options).find(o => !o.value.includes(primary))?.value ?? '';
  }, FX.fonts.primary);
}

async function openMenuAndChangeFont(
  page: import('@playwright/test').Page,
  store: SessionStoreMock,
  newFont: string,
): Promise<void> {
  await openSettingsMenu(page);

  // Wait for font list to populate
  await page.waitForFunction(
    () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
    { timeout: 5000 },
  );

  await page.selectOption('#inp-font-bundled', newFont);
  await page.locator('#inp-font-bundled').dispatchEvent('change');

  // Wait for the change to propagate to the persisted store (mocked).
  for (let i = 0; i < 100; i++) {
    if (store.get().sessions['main']?.fontFamily === newFont) break;
    await new Promise(r => setTimeout(r, 50));
  }

  // Topbar autohides 1s after mouse leaves the top region — re-reveal it
  // before clicking the menu button to close the panel.
  await page.mouse.move(640, 10);
  await page.waitForFunction(
    () => !document.getElementById('topbar')?.classList.contains('hidden'),
    { timeout: 5000 },
  );
  await page.click('#btn-menu'); // close menu
}

test.describe('font change rendering: xterm', () => {
  let server: ChildProcess;
  let store: SessionStoreMock;
  const base = `http://127.0.0.1:${PORT_XTERM}`;

  test.beforeAll(async () => { server = await startXtermServer(PORT_XTERM); });
  test.afterAll(() => killServer(server));

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await injectWsSpy(page);
    store = await mockSessionStore(page, {
      sessions: {
        main: fixtureSessionSettings({ spacing: 1.125 }),
      },
    });
    await page.route('**/api/sessions', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '0', name: 'main' }]) }));
    await page.route('**/api/windows**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
      { timeout: 5000 },
    );
    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10000 });
  });

  test('font change updates xterm options and persisted settings without reloading', async ({ page }) => {
    await page.waitForFunction(
      (font) => document.fonts.check(`18px "${font}"`),
      FX.fonts.primary,
      { timeout: 5000 },
    );
    expect(await getXtermFontFamily(page)).toContain(FX.fonts.primary);

    const otherFont = await getOtherBundledFont(page);
    expect(otherFont).toBeTruthy();

    const metricsBefore = await getAdapterMetrics(page);
    const navigationCountBefore = await page.evaluate(() => performance.getEntriesByType('navigation').length);

    await openMenuAndChangeFont(page, store, otherFont);

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

    const settings = readSessionSettings(store);
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

    await openMenuAndChangeFont(page, store, otherFont);
    await page.waitForFunction(
      (font) => ((window as any).__adapter?.term?.options?.fontFamily ?? '').includes(font),
      otherFont,
      { timeout: 5000 },
    );

    await page.evaluate(() => { (window as any).__mockWsReceive('font change render\r\n'); });

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 5000 });
    // The WebGL renderer draws glyphs to a canvas, so `.xterm-rows` stays
    // empty even when text is present. Assert via the terminal buffer
    // instead — works for both DOM and WebGL renderers.
    await page.waitForFunction(() => {
      const term = (window as any).__adapter?.term;
      const buf = term?.buffer?.active;
      if (!buf) return false;
      for (let y = 0; y < term.rows; y++) {
        const line = buf.getLine(y)?.translateToString(true) ?? '';
        if (line.includes('font change render')) return true;
      }
      return false;
    }, null, { timeout: 5000 });
  });
});
