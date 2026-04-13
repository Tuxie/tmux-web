import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test('WebSocket reconnect sends resize message on reopen', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);

  // Close the WebSocket to trigger reconnect
  await page.evaluate(() => {
    (window as any).__wsInstance.close();
  });

  // Wait for reconnect — should get at least 2 resize messages (initial + reconnect)
  await page.waitForFunction(
    () => (window as any).__wsSent.filter((m: string) => m.startsWith('{"type":"resize"')).length >= 2,
    { timeout: 10000 }
  );

  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  const resizes = sent.filter(m => m.startsWith('{"type":"resize"'));
  expect(resizes.length).toBeGreaterThanOrEqual(2);

  const msg = JSON.parse(resizes.at(-1)!);
  expect(msg.type).toBe('resize');
  expect(msg.cols).toBeGreaterThan(0);
  expect(msg.rows).toBeGreaterThan(0);
});
