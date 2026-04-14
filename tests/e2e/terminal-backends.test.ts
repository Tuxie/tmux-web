/**
 * Smoke tests verifying that each terminal backend (ghostty, xterm, xterm-dev)
 * starts successfully and renders text sent from the server.
 *
 * Each describe block spins up its own server instance on a dedicated port so
 * the tests are independent of the shared playwright.config.ts webServer.
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer, writeToTerminal } from './helpers.js';

// Ports chosen to avoid conflicts with the default test server (4023)
const PORT = { ghostty: 4040, xterm: 4041, 'xterm-dev': 4042 };

function startDevServer(terminal: string, port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
  );
}

// ---------------------------------------------------------------------------
// ghostty
// ---------------------------------------------------------------------------
test.describe('terminal backend: ghostty', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT.ghostty}`;

  test.beforeAll(async () => { server = await startDevServer('ghostty', PORT.ghostty); });
  test.afterAll(() => killServer(server));

  test('receives keyboard input immediately on load', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await page.evaluate(() => { (window as any).__wsSent = []; });

    await page.keyboard.press('a');

    await page.waitForFunction(
      () => (window as any).__wsSent.includes('a'),
      { timeout: 3000 },
    );
  });

  test('starts and renders text', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    // ghostty-web renders via WebGL — verify a canvas is present and sized
    const canvas = page.locator('#terminal canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // Write text and confirm the terminal did not crash (canvas still visible,
    // resize params still valid — inspecting WebGL pixel data is not practical)
    await writeToTerminal(page, 'hello ghostty\r\n');
    await expect(canvas).toBeVisible();

    const resize = await page.evaluate(() => {
      const sent: string[] = (window as any).__wsSent;
      return sent.map(m => { try { return JSON.parse(m); } catch { return null; } })
                 .find(m => m?.type === 'resize');
    });
    expect(resize).toBeTruthy();
    expect(resize.cols).toBeGreaterThan(0);
    expect(resize.rows).toBeGreaterThan(0);
  });

  test('canvas starts at top-left of #terminal with no phantom elements above it', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    const canvas = page.locator('#terminal canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const termBox = await page.locator('#terminal').boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox!.y).toBeGreaterThanOrEqual(termBox!.y);
    expect(canvasBox!.y - termBox!.y).toBeLessThan(10);
    expect(canvasBox!.x).toBeGreaterThanOrEqual(termBox!.x);
    expect(canvasBox!.x - termBox!.x).toBeLessThan(15);
  });

  test('no browser scrollbar in terminal area', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    const canvas = page.locator('#terminal canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    // ghostty renders to canvas — check #terminal container has no scrollbar
    const scrollbarWidth = await page.evaluate(() => {
      const el = document.getElementById('terminal')!;
      return el.offsetWidth - el.clientWidth;
    });
    expect(scrollbarWidth).toBe(0);
  });

  test('no scrollbar after overflow content when topbar is pinned from page load', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('topbar-autohide', 'false'));
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    const canvas = page.locator('#terminal canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const lines = Array.from({ length: 80 }, (_, i) => `overflow ${i + 1}`).join('\r\n') + '\r\n';
    await writeToTerminal(page, lines);

    const scrollbarWidth = await page.evaluate(() => {
      const el = document.getElementById('terminal')!;
      return el.offsetWidth - el.clientWidth;
    });
    expect(scrollbarWidth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// xterm (npm release)
// ---------------------------------------------------------------------------
test.describe('terminal backend: xterm', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT.xterm}`;

  test.beforeAll(async () => { server = await startDevServer('xterm', PORT.xterm); });
  test.afterAll(() => killServer(server));

  test('receives keyboard input immediately on load', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await page.evaluate(() => { (window as any).__wsSent = []; });

    await page.keyboard.press('a');

    await page.waitForFunction(
      () => (window as any).__wsSent.includes('a'),
      { timeout: 3000 },
    );
  });

  test('starts and renders text', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    // xterm uses the DOM renderer — .xterm element must be present
    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    // Inject text from the server side and verify it appears in the row elements
    await writeToTerminal(page, 'hello xterm\r\n');
    await expect(page.locator('#terminal .xterm-rows')).toContainText('hello xterm', { timeout: 5_000 });
  });

  test('text rows start at top-left of #terminal with no phantom elements above', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await writeToTerminal(page, 'top-left xterm\r\n');

    const rows = page.locator('#terminal .xterm-rows');
    await expect(rows).toContainText('top-left xterm', { timeout: 5_000 });

    const termBox = await page.locator('#terminal').boundingBox();
    const rowsBox = await rows.boundingBox();
    expect(rowsBox!.y).toBeGreaterThanOrEqual(termBox!.y);
    expect(rowsBox!.y - termBox!.y).toBeLessThan(10);
    expect(rowsBox!.x).toBeGreaterThanOrEqual(termBox!.x);
    expect(rowsBox!.x - termBox!.x).toBeLessThan(15);
  });

  test('no browser scrollbar in terminal area', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    // .xterm-viewport has overflow-y:scroll by default; verify no scrollbar track
    const scrollbarWidth = await page.evaluate(() => {
      const viewport = document.querySelector('.xterm .xterm-viewport') as HTMLElement;
      return viewport ? viewport.offsetWidth - viewport.clientWidth : 0;
    });
    expect(scrollbarWidth).toBe(0);
  });

  test('no scrollbar after overflow content when topbar is pinned from page load', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('topbar-autohide', 'false'));
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    const lines = Array.from({ length: 80 }, (_, i) => `overflow ${i + 1}`).join('\r\n') + '\r\n';
    await writeToTerminal(page, lines);

    const scrollbarWidth = await page.evaluate(() => {
      const viewport = document.querySelector('.xterm .xterm-viewport') as HTMLElement;
      return viewport ? viewport.offsetWidth - viewport.clientWidth : 0;
    });
    expect(scrollbarWidth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// xterm-dev (vendor HEAD build, falls back to npm xterm if make vendor not run)
// ---------------------------------------------------------------------------
test.describe('terminal backend: xterm-dev', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT['xterm-dev']}`;

  test.beforeAll(async () => { server = await startDevServer('xterm-dev', PORT['xterm-dev']); });
  test.afterAll(() => killServer(server));

  test('receives keyboard input immediately on load', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await page.evaluate(() => { (window as any).__wsSent = []; });

    await page.keyboard.press('a');

    await page.waitForFunction(
      () => (window as any).__wsSent.includes('a'),
      { timeout: 3000 },
    );
  });

  test('starts and renders text', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    // xterm-dev uses the DOM renderer (vendor or npm fallback)
    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    await writeToTerminal(page, 'hello xterm-dev\r\n');
    await expect(page.locator('#terminal .xterm-rows')).toContainText('hello xterm-dev', { timeout: 5_000 });
  });

  test('text rows start at top-left of #terminal with no phantom elements above', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await writeToTerminal(page, 'top-left xterm-dev\r\n');

    const rows = page.locator('#terminal .xterm-rows');
    await expect(rows).toContainText('top-left xterm-dev', { timeout: 5_000 });

    const termBox = await page.locator('#terminal').boundingBox();
    const rowsBox = await rows.boundingBox();
    expect(rowsBox!.y).toBeGreaterThanOrEqual(termBox!.y);
    expect(rowsBox!.y - termBox!.y).toBeLessThan(10);
    expect(rowsBox!.x).toBeGreaterThanOrEqual(termBox!.x);
    expect(rowsBox!.x - termBox!.x).toBeLessThan(15);
  });

  test('no browser scrollbar in terminal area', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    const scrollbarWidth = await page.evaluate(() => {
      const viewport = document.querySelector('.xterm .xterm-viewport') as HTMLElement;
      return viewport ? viewport.offsetWidth - viewport.clientWidth : 0;
    });
    expect(scrollbarWidth).toBe(0);
  });

  test('no scrollbar after overflow content when topbar is pinned from page load', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('topbar-autohide', 'false'));
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    const lines = Array.from({ length: 80 }, (_, i) => `overflow ${i + 1}`).join('\r\n') + '\r\n';
    await writeToTerminal(page, lines);

    const scrollbarWidth = await page.evaluate(() => {
      const viewport = document.querySelector('.xterm .xterm-viewport') as HTMLElement;
      return viewport ? viewport.offsetWidth - viewport.clientWidth : 0;
    });
    expect(scrollbarWidth).toBe(0);
  });
});
