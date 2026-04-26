import { test, expect } from '@playwright/test';
import { injectWsSpy, mockApis, waitForWsOpen } from './helpers.js';

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
}

async function sendProbeThroughPty(page: import('@playwright/test').Page, probe: string): Promise<void> {
  // Test mode uses `cat` as the PTY child. The trailing newline flushes
  // canonical input so cat echoes the probe back to xterm.js for parsing.
  await page.evaluate((seq) => {
    (window as any).__wsInstance.send(seq + '\n');
  }, probe);
}

test('xterm.js answers Secondary DA probes on the input WebSocket path', async ({ page }) => {
  await boot(page);

  await sendProbeThroughPty(page, '\x1b[>c');

  await page.waitForFunction(
    () => (window as any).__wsSent.includes('\x1b[>0;276;0c'),
    { timeout: 5000 },
  );
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain('\x1b[>0;276;0c');
});

test('xterm.js answers XTVERSION probes on the input WebSocket path', async ({ page }) => {
  await boot(page);

  await sendProbeThroughPty(page, '\x1b[>q');

  await page.waitForFunction(
    () => (window as any).__wsSent.some((m: string) =>
      m.startsWith('\x1bP>|xterm.js(') && m.endsWith('\x1b\\')),
    { timeout: 5000 },
  );
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain('\x1bP>|xterm.js(6.0.0)\x1b\\');
});
