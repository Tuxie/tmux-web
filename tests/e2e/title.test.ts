/**
 * Topbar title (#tb-title) display tests.
 *
 * Title flows from the server's TT `title` message (containing tmux's raw
 * #{pane_title}). xterm.js's onTitleChange is intentionally NOT wired —
 * tmux emits set-titles output (`session:window_name`) in the PTY stream
 * which is its sanitized form (non-printables collapse to `_`). Letting
 * both sources race produced flicker; we keep only the server-driven one.
 */
import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen, sendFromServer, writeToTerminal } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
});

test('OSC title in the PTY stream does not update #tb-title (regression: no xterm onTitleChange)', async ({ page }) => {
  // Set a known title via the server-driven path first.
  await sendFromServer(page, { title: '\u2733 raw' });
  await expect(page.locator('#tb-title')).toHaveText('\u2733 raw');

  // Now inject an OSC 2 title sequence directly into the terminal — this
  // is exactly what tmux's set-titles emits (sanitized form, with the
  // session prefix). If we still subscribed to xterm's onTitleChange,
  // the topbar would briefly flip to the sanitized string.
  await writeToTerminal(page, '\x1b]2;main:_ raw\x07');
  // Give xterm a beat to parse — and confirm the topbar did NOT change.
  await page.waitForTimeout(200);
  await expect(page.locator('#tb-title')).toHaveText('\u2733 raw');
});
