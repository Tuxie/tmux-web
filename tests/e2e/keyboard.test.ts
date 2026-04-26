import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  // Focus the terminal before sending keyboard events.
  await page.click('#terminal');
  // Clear messages accumulated during setup (resize + initial state sync)
  await page.evaluate(() => { (window as any).__wsSent = []; });
});

// Push Kitty keyboard flag 1 (DISAMBIGUATE_ESCAPE_CODES) as an application
// would via `CSI > 1 u`. With xterm's vtExtensions.kittyKeyboard enabled,
// modified special keys should then report as CSI-u.
async function optInKittyKeyboard(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const adapter: any = (window as any).__adapter;
    adapter.write('\x1b[>1u');
  });
  // Yield so xterm's input handler processes the CSI sequence before we
  // start pressing keys. xterm.write queues data and flushes asynchronously
  // with no documented "parser-drained" event the test can poll for, so a
  // bounded sleep is the only signal available.
  await page.waitForTimeout(50);
}

test('Shift+Enter reports CSI-u (Kitty protocol) once app opts in', async ({ page }) => {
  await optInKittyKeyboard(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
  await page.keyboard.press('Shift+Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.join('')).toContain('\x1b[13;2u');
});

test('Shift+Tab reports CSI-u (Kitty protocol) once app opts in', async ({ page }) => {
  await optInKittyKeyboard(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
  await page.keyboard.press('Shift+Tab');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.join('')).toContain('\x1b[9;2u');
});

test('plain Tab passes through as raw \\t (xterm onData → ws.send)', async ({ page }) => {
  await page.keyboard.press('Tab');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(m => m === '\t')).toBe(true);
});

test('Shift+Tab without opt-in falls back to legacy CSI Z', async ({ page }) => {
  await page.keyboard.press('Shift+Tab');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.join('')).toContain('\x1b[Z');
});
