import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

async function injectFullscreenStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__fullscreenCalls = [];
    let _isFull = false;
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => (_isFull ? document.documentElement : null),
      configurable: true,
    });
    document.exitFullscreen = async () => {
      (window as any).__fullscreenCalls.push('exit');
      _isFull = false;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    // document.documentElement is null at addInitScript time; defer to DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.requestFullscreen = async () => {
        (window as any).__fullscreenCalls.push('request');
        _isFull = true;
        document.dispatchEvent(new Event('fullscreenchange'));
      };
    });
  });
}

test.beforeEach(async ({ page }) => {
  await injectFullscreenStub(page);
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.mouse.move(640, 10);
});

test('opening menu and checking Fullscreen calls requestFullscreen', async ({ page }) => {
  await page.mouse.move(640, 10);
  await page.click('#btn-menu');
  await page.click('#chk-fullscreen');
  const calls: string[] = await page.evaluate(() => (window as any).__fullscreenCalls);
  expect(calls).toContain('request');
  const checked = await page.locator('#chk-fullscreen').isChecked();
  expect(checked).toBe(true);
});

test('unchecking Fullscreen calls exitFullscreen', async ({ page }) => {
  await page.mouse.move(640, 10);
  // Open menu and enter fullscreen
  await page.click('#btn-menu');
  await page.click('#chk-fullscreen');
  await expect(page.locator('#chk-fullscreen')).toBeChecked();
  // Close dropdown, reopen it, then exit fullscreen
  await page.mouse.move(640, 10);
  await page.click('#btn-menu'); // closes dropdown
  await page.click('#btn-menu'); // reopens dropdown
  await page.click('#chk-fullscreen');
  const calls: string[] = await page.evaluate(() => (window as any).__fullscreenCalls);
  expect(calls).toContain('exit');
  const checked = await page.locator('#chk-fullscreen').isChecked();
  expect(checked).toBe(false);
});
