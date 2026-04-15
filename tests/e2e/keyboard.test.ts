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

test('Shift+Enter sends CSI-u \\x1b[13;2u', async ({ page }) => {
  await page.keyboard.press('Shift+Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain('\x1b[13;2u');
});

test('Shift+Tab sends CSI-u \\x1b[9;2u', async ({ page }) => {
  await page.keyboard.press('Shift+Tab');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain('\x1b[9;2u');
});

test('plain Tab passes through as raw \\t (xterm onData → ws.send)', async ({ page }) => {
  await page.keyboard.press('Tab');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  // xterm should forward the unmodified Tab byte through onData.
  expect(sent.some(m => m === '\t')).toBe(true);
});
