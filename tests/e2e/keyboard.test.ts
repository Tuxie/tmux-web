import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  // Focus the terminal canvas (ghostty-web renders a focusable canvas inside #terminal)
  await page.evaluate(() => {
    const canvas = document.querySelector('#terminal canvas');
    if (canvas) { (canvas as HTMLElement).tabIndex = 0; (canvas as HTMLElement).focus(); }
  });
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

test('plain Tab passes through as raw \\t (ghostty-web term.onData → ws.send)', async ({ page }) => {
  await page.keyboard.press('Tab');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  // ghostty-web processes the unmodified Tab and calls term.onData('\t') → ws.send('\t')
  // If this test fails, ghostty-web may require isTrusted=true for keyboard input — skip with test.skip()
  expect(sent.some(m => m === '\t')).toBe(true);
});
