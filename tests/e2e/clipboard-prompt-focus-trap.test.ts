/**
 * Verifies that the clipboard-read consent modal traps Tab/Shift+Tab focus
 * among its three buttons (Deny / Allow once / Allow always) instead of
 * letting focus escape to the page underneath, and that Escape still
 * cancels the prompt.
 *
 * Cluster 09 (frontend-a11y), finding F3.
 */
import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, sendFromServer, waitForWsOpen } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
});

/** Open the clipboard-read consent prompt via a server push and wait for it. */
async function openPrompt(page: import('@playwright/test').Page): Promise<void> {
  await sendFromServer(page, {
    clipboardPrompt: {
      reqId: 'test-1',
      exePath: '/usr/bin/cat',
      commandName: 'cat',
    },
  });
  await expect(page.locator('.tw-clip-prompt-card')).toBeVisible();
}

/** Read the id/text of the currently-focused element. */
async function focusedText(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.textContent ?? null);
}

test('modal card carries dialog ARIA attributes', async ({ page }) => {
  await openPrompt(page);
  const card = page.locator('.tw-clip-prompt-card');
  await expect(card).toHaveAttribute('role', 'dialog');
  await expect(card).toHaveAttribute('aria-modal', 'true');
});

test('initial focus is on Allow always; Tab from last cycles to first', async ({ page }) => {
  await openPrompt(page);
  // Initial focus is on "Allow always" (the last button).
  expect(await focusedText(page)).toBe('Allow always');
  // Tab from the last button cycles back to the first ("Deny").
  await page.keyboard.press('Tab');
  expect(await focusedText(page)).toBe('Deny');
});

test('Shift+Tab from first button cycles to last', async ({ page }) => {
  await openPrompt(page);
  // Move focus to the first button via the existing forward-cycle behaviour.
  await page.keyboard.press('Tab'); // alwaysBtn → denyBtn
  expect(await focusedText(page)).toBe('Deny');
  // Shift+Tab from "Deny" cycles to "Allow always".
  await page.keyboard.press('Shift+Tab');
  expect(await focusedText(page)).toBe('Allow always');
});

test('Tab walks forward through the three buttons in order', async ({ page }) => {
  await openPrompt(page);
  // Forward order: alwaysBtn (initial) → denyBtn → onceBtn → alwaysBtn
  expect(await focusedText(page)).toBe('Allow always');
  await page.keyboard.press('Tab');
  expect(await focusedText(page)).toBe('Deny');
  await page.keyboard.press('Tab');
  expect(await focusedText(page)).toBe('Allow once');
  await page.keyboard.press('Tab');
  expect(await focusedText(page)).toBe('Allow always');
});

test('Escape still cancels the prompt', async ({ page }) => {
  await openPrompt(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tw-clip-prompt-card')).toHaveCount(0);
});
