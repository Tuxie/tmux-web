/**
 * Verify the xterm-only terminal surface after backend selection removal.
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer } from './helpers.js';

async function openMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.mouse.move(640, 10);
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();
}

test.describe('terminal surface: xterm only', () => {
  test.beforeEach(async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);
  });

  test('page loads xterm without a terminal query parameter', async ({ page }) => {
    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain('?terminal=');
  });

  test('/api/terminal-versions reports xterm only', async ({ page }) => {
    const response = await page.request.get('/api/terminal-versions');
    expect(response.ok()).toBe(true);

    const versions = await response.json();
    expect(Object.keys(versions)).toEqual(['xterm']);
    expect(versions.xterm).toMatch(/^xterm\.js /);
  });
});

test.describe('terminal surface: real server defaults', () => {
  let server: ChildProcess;
  const PORT = 4100;
  const base = `http://127.0.0.1:${PORT}`;

  test.beforeAll(async () => {
    server = await startServer(
      'bun',
      ['src/server/index.ts', '--test', `--listen=127.0.0.1:${PORT}`, '--no-auth', '--no-tls'],
    );
  });

  test.afterAll(() => killServer(server));

  test('real server renders xterm by default with no backend-selection UI', async ({ page }) => {
    await injectWsSpy(page);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);

    await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toBe(`${base}/main`);

    await openMenu(page);
    await expect(page.locator('#inp-terminal')).toHaveCount(0);
  });
});
