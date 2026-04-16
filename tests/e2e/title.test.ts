/**
 * Topbar title (#tb-title) display tests.
 *
 * Title flows from the server's TT `title` message (containing tmux's raw
 * #{pane_title}). xterm.js's onTitleChange is intentionally NOT wired —
 * tmux emits set-titles output (`session:window_name`) in the PTY stream
 * which is its sanitised form (non-printables collapse to `_`). Letting
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

test('TT title message renders raw unicode in #tb-title', async ({ page }) => {
  const raw = '\u2733 Compact lessons learned documentation'; // ✳ U+2733
  await sendFromServer(page, { title: raw });
  await expect(page.locator('#tb-title')).toHaveText(raw);
});

test('TT title preserves emoji and box-drawing characters', async ({ page }) => {
  const raw = '\u25C7  Ready (Fotona) \u2728'; // ◇ … ✨
  await sendFromServer(page, { title: raw });
  await expect(page.locator('#tb-title')).toHaveText(raw);
});

test('a later TT title fully replaces the earlier one (no leftover chars)', async ({ page }) => {
  await sendFromServer(page, { title: 'first long title' });
  await expect(page.locator('#tb-title')).toHaveText('first long title');
  await sendFromServer(page, { title: 'short' });
  await expect(page.locator('#tb-title')).toHaveText('short');
});

test('a "session:..."-shaped pane title is shown verbatim (no prefix stripping)', async ({ page }) => {
  // pane_title from the server is raw — even if it happens to start with
  // a session-name-shaped prefix, we should not strip anything.
  await sendFromServer(page, { title: 'main:literal pane title' });
  await expect(page.locator('#tb-title')).toHaveText('main:literal pane title');
});

test('OSC title in the PTY stream does not update #tb-title (regression: no xterm onTitleChange)', async ({ page }) => {
  // Set a known title via the server-driven path first.
  await sendFromServer(page, { title: '\u2733 raw' });
  await expect(page.locator('#tb-title')).toHaveText('\u2733 raw');

  // Now inject an OSC 2 title sequence directly into the terminal — this
  // is exactly what tmux's set-titles emits (sanitised form, with the
  // session prefix). If we still subscribed to xterm's onTitleChange,
  // the topbar would briefly flip to the sanitised string.
  await writeToTerminal(page, '\x1b]2;main:_ raw\x07');
  // Give xterm a beat to parse — and confirm the topbar did NOT change.
  await page.waitForTimeout(200);
  await expect(page.locator('#tb-title')).toHaveText('\u2733 raw');
});
