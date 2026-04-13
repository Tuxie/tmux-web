/**
 * Smoke tests verifying that the production `./tmux-web` binary starts each
 * terminal backend and renders text.  Tests are skipped when the binary has
 * not been built yet — run `make tmux-web` (or just `make`) first.
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer, writeToTerminal } from './helpers.js';

const BINARY = './tmux-web';
const BINARY_EXISTS = existsSync(BINARY);

// Ports chosen to avoid conflicts with the default (4023) and dev tests (4040-4042)
const PORT = { ghostty: 4043, xterm: 4044, 'xterm-dev': 4046 };

function startBinaryServer(terminal: string, port: number): Promise<ChildProcess> {
  return startServer(
    BINARY,
    ['--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
    30_000, // compiled binary cold-start can be slower than bun run src/server/index.ts
  );
}

// ---------------------------------------------------------------------------
// ghostty
// ---------------------------------------------------------------------------
test.describe('binary: ghostty', () => {
  test.skip(!BINARY_EXISTS, 'binary not built — run: make tmux-web');

  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT.ghostty}`;

  test.beforeAll(async () => { server = await startBinaryServer('ghostty', PORT.ghostty); });
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

    const canvas = page.locator('#terminal canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    await writeToTerminal(page, 'hello binary ghostty\r\n');
    await expect(canvas).toBeVisible();

    const resize = await page.evaluate(() => {
      const sent: string[] = (window as any).__wsSent;
      return sent.map(m => { try { return JSON.parse(m); } catch { return null; } })
                 .find((m: any) => m?.type === 'resize');
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
test.describe('binary: xterm', () => {
  test.skip(!BINARY_EXISTS, 'binary not built — run: make tmux-web');

  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT.xterm}`;

  test.beforeAll(async () => { server = await startBinaryServer('xterm', PORT.xterm); });
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

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    await writeToTerminal(page, 'hello binary xterm\r\n');
    await expect(page.locator('#terminal .xterm-rows')).toContainText('hello binary xterm', { timeout: 5_000 });
  });

  test('text rows start at top-left of #terminal with no phantom elements above', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await writeToTerminal(page, 'top-left binary xterm\r\n');

    const rows = page.locator('#terminal .xterm-rows');
    await expect(rows).toContainText('top-left binary xterm', { timeout: 5_000 });

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
// xterm-dev (vendor HEAD or npm fallback depending on build-time vendor state)
// ---------------------------------------------------------------------------
test.describe('binary: xterm-dev', () => {
  test.skip(!BINARY_EXISTS, 'binary not built — run: make tmux-web');

  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT['xterm-dev']}`;

  test.beforeAll(async () => { server = await startBinaryServer('xterm-dev', PORT['xterm-dev']); });
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

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10_000 });

    await writeToTerminal(page, 'hello binary xterm-dev\r\n');
    await expect(page.locator('#terminal .xterm-rows')).toContainText('hello binary xterm-dev', { timeout: 5_000 });
  });

  test('text rows start at top-left of #terminal with no phantom elements above', async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await writeToTerminal(page, 'top-left binary xterm-dev\r\n');

    const rows = page.locator('#terminal .xterm-rows');
    await expect(rows).toContainText('top-left binary xterm-dev', { timeout: 5_000 });

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
