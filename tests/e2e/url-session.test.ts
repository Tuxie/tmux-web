import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen, sendFromServer } from './helpers.js';

test('URL path becomes session name in WebSocket URL', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['myproject'], []);
  await page.goto('/myproject');
  await waitForWsOpen(page);
  expect(new URL(page.url()).pathname).toBe('/myproject');
});

test('session change from server updates URL via history.replaceState', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'other'], []);
  await page.goto('/main');
  await waitForWsOpen(page);

  await sendFromServer(page, { session: 'other' });

  await page.waitForFunction(
    () => window.location.pathname === '/other',
    { timeout: 3000 }
  );
  expect(new URL(page.url()).pathname).toBe('/other');
});
