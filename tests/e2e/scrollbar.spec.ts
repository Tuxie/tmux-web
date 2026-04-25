import { test, expect, type Page } from '@playwright/test';
import { startServer, killServer, createIsolatedTmux, hasTmux } from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');

const PORT = 4120;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForTerminal(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 10000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10000 });
}

async function wheelOverTerminal(page: Page, deltaY: number): Promise<void> {
  const box = await page.locator('#terminal').boundingBox();
  if (!box) throw new Error('#terminal has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
}

test('wheel over terminal scrolls tmux copy-mode and updates scroll position', async ({ page }) => {
  const isolatedTmux = createIsolatedTmux('tw-scrollbar-e2e');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    isolatedTmux.tmux([
      'new-session',
      '-d',
      '-s',
      'scroll',
      "for i in $(seq 1 240); do printf 'scrollback-%03d\\n' \"$i\"; done; exec cat",
    ]);

    await expect.poll(() => {
      const raw = isolatedTmux.tmux(['display-message', '-p', '-t', 'scroll:0.0', '#{history_size}']).trim();
      return Number(raw);
    }, {
      timeout: 3000,
      message: 'tmux pane should have scrollback before attaching the browser',
    }).toBeGreaterThan(50);

    server = await startServer('bun', [
      'src/server/index.ts',
      '--listen', `127.0.0.1:${PORT}`,
      '--no-auth', '--no-tls',
      '--tmux', isolatedTmux.wrapperPath,
    ]);

    await page.goto(`${BASE}/scroll`);
    await waitForTerminal(page);
    await expect.poll(async () => {
      return await page.locator('#tmux-scrollbar').evaluate(el => !el.classList.contains('unavailable'));
    }, {
      timeout: 5000,
      message: 'scrollbar should become available for a normal tmux pane with history',
    }).toBe(true);

    await wheelOverTerminal(page, -180);

    await expect.poll(() => {
      return isolatedTmux
        .tmux(['display-message', '-p', '-t', 'scroll:0.0', '#{pane_in_mode}:#{scroll_position}'])
        .trim();
    }, {
      timeout: 5000,
      message: 'terminal wheel-up should enter copy-mode and move into scrollback',
    }).toMatch(/^1:[1-9]\d*$/);
  } finally {
    if (server) killServer(server);
    isolatedTmux.cleanup();
  }
});

test('alternate screen marks tmux scrollbar unavailable', async ({ page }) => {
  const isolatedTmux = createIsolatedTmux('tw-scrollbar-alt-e2e');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    isolatedTmux.tmux([
      'new-session',
      '-d',
      '-s',
      'alt',
      "printf '\\033[?1049halternate-screen\\n'; exec cat",
    ]);

    await expect.poll(() => {
      return isolatedTmux
        .tmux(['display-message', '-p', '-t', 'alt:0.0', '#{alternate_on}'])
        .trim();
    }, {
      timeout: 3000,
      message: 'tmux pane should enter alternate screen before attaching the browser',
    }).toBe('1');

    server = await startServer('bun', [
      'src/server/index.ts',
      '--listen', `127.0.0.1:${PORT}`,
      '--no-auth', '--no-tls',
      '--tmux', isolatedTmux.wrapperPath,
    ]);

    await page.goto(`${BASE}/alt`);
    await waitForTerminal(page);

    await expect.poll(async () => {
      return await page.locator('#tmux-scrollbar').evaluate(el => el.classList.contains('unavailable'));
    }, {
      timeout: 5000,
      message: 'alternate screen should make the tmux scrollbar unavailable',
    }).toBe(true);
  } finally {
    if (server) killServer(server);
    isolatedTmux.cleanup();
  }
});
