import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen, sendFromServer } from './helpers.js';

async function injectClipboardSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__clipboardWrites = [];
    // navigator.clipboard requires a secure context (HTTPS); stub it so the
    // frontend's writeText call is captured rather than silently swallowed.
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          (window as any).__clipboardWrites.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
      writable: true,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await injectClipboardSpy(page);
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
});

test('OSC 52 in PTY stream triggers server-side interception and clipboard write (integration)', async ({ page }) => {
  // Send an OSC 52 sequence over WebSocket. The server writes it to cat's stdin.
  // cat echoes it back on stdout. The server's PTY onData handler intercepts the
  // OSC 52 regex match, sends \x00TT:{"clipboard":"..."} to the browser, and
  // strips the sequence from the data forwarded to the terminal.
  //
  // The trailing \n flushes cat's canonical-mode line buffer so the data is
  // delivered to cat's stdout (and echoed back) without waiting for more input.
  //
  // btoa('world') === 'd29ybGQ='
  await page.evaluate(() => {
    (window as any).__wsInstance.send('\x1b]52;c;d29ybGQ=\x07\n');
  });
  await page.waitForFunction(() => (window as any).__clipboardWrites.length > 0, { timeout: 5000 });
  const writes: string[] = await page.evaluate(() => (window as any).__clipboardWrites);
  expect(writes).toContain('world');
});
