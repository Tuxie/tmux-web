/**
 * Tests that the terminal regains keyboard focus after the settings menu is closed,
 * regardless of how it was closed or what the user did inside it.
 */
import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

/** Press a key and confirm it reached the terminal via WebSocket within 2 s. */
async function expectTerminalFocused(page: import('@playwright/test').Page, key = 'z'): Promise<void> {
  await page.evaluate(() => { (window as any).__wsSent = []; });
  await page.keyboard.press(key);
  await page.waitForFunction(
    (k) => (window as any).__wsSent.includes(k),
    key,
    { timeout: 2000 },
  );
}

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  // Reveal the topbar so the menu button is clickable
  await page.mouse.move(640, 10);
});

test('terminal focused after closing menu via button toggle', async ({ page }) => {
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();

  await page.click('#btn-menu'); // close
  await expect(page.locator('#menu-dropdown')).toBeHidden();

  await expectTerminalFocused(page);
});

test('terminal focused after closing menu by clicking outside', async ({ page }) => {
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();

  // Click in the terminal area, away from the menu
  await page.mouse.click(400, 400);
  await expect(page.locator('#menu-dropdown')).toBeHidden();

  await expectTerminalFocused(page);
});

test('terminal focused after interacting with font-size input then closing menu', async ({ page }) => {
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();

  // Interact with the font-size number input (focus stays there with our fix)
  await page.click('#inp-fontsize');
  await page.fill('#inp-fontsize', '18');

  // Close by clicking the button
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeHidden();

  // Blurring the number input fires 'change'; wait for the socket to settle
  // before checking that focus returned to the terminal.
  await waitForWsOpen(page);
  await expectTerminalFocused(page);
});

test('terminal focused after interacting with font picker then closing menu', async ({ page }) => {
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();

  await page.click('#inp-font-bundled');
  await page.keyboard.press('ArrowDown');

  // Close by clicking outside
  await page.mouse.click(400, 400);
  await expect(page.locator('#menu-dropdown')).toBeHidden();

  // Wait for any follow-up settings work to settle before checking focus.
  await waitForWsOpen(page);
  await expectTerminalFocused(page);
});

test('terminal focused after toggling autohide checkbox', async ({ page }) => {
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();

  await page.click('#chk-autohide');

  await page.click('#btn-menu'); // close
  await expect(page.locator('#menu-dropdown')).toBeHidden();

  await expectTerminalFocused(page);
});
