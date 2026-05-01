/**
 * End-to-end: tmux copy-mode keyboard shortcuts → browser clipboard,
 * and tmux paste-buffer → vim.
 *
 * Uses the shared tests/tmux.conf (set-clipboard external, mouse on,
 * mode-keys vi).
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
  startServer, killServer, createIsolatedTmux, hasTmux,
} from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');

const PORT_BASE = 4144;

function port(ti: TestInfo) { return PORT_BASE + ti.parallelIndex; }

async function termReady(page: Page) {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 12000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 12000 });
}

// ---------------------------------------------------------------------------
// Test 1 — tmux copy-mode copy → browser clipboard
// ---------------------------------------------------------------------------

test('tmux copy-mode keyboard copy lands in browser clipboard', async ({ page }, ti) => {
  const p = port(ti);
  const iso = createIsolatedTmux('tw-copy-mode-clip');
  let srv: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    // Shell that prints a known word
    iso.tmux(['new-session', '-d', '-s', 'copytest', 'echo COPY_MODE_WORD && exec cat']);
    await new Promise(r => setTimeout(r, 800));

    srv = await startServer('bun', [
      'src/server/index.ts', '--listen', `127.0.0.1:${p}`,
      '--no-auth', '--no-tls', '--tmux', iso.wrapperPath,
    ]);

    await page.addInitScript(() => {
      (window as any).__cw = [] as string[];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t: string) => { (window as any).__cw.push(t); return Promise.resolve(); } },
        configurable: true, writable: true,
      });
    });

    await page.goto(`http://127.0.0.1:${p}/copytest`);
    await termReady(page);
    await page.waitForTimeout(800);

    // ---- tmux copy-mode: enter, navigate, select, copy ----
    iso.tmux(['copy-mode', '-t', 'copytest:1']);
    // g = top of history (copy-mode-vi). Text is on the first line.
    iso.tmux(['send-keys', '-t', 'copytest:1', 'g']);
    // v = begin-selection, e = next-word-end (copy-mode-vi bindings from tmux.conf)
    iso.tmux(['send-keys', '-t', 'copytest:1', 'v', 'e']);
    // y = copy-selection-and-cancel (exits copy mode, stores in paste buffer)
    iso.tmux(['send-keys', '-t', 'copytest:1', 'y']);

    // Wait for OSC 52 → tmux → tmux-web → browser
    await page.waitForFunction(
      (exp: string) => ((window as any).__cw as string[]).some((w: string) => w.trim() === exp),
      'COPY_MODE_WORD', { timeout: 5000 },
    );

    const writes = await page.evaluate(() => (window as any).__cw);
    expect(writes.some((w: string) => w.trim() === 'COPY_MODE_WORD')).toBe(true);
  } finally {
    if (srv) killServer(srv);
    iso.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test 2 — copy-mode text → tmux buffer → paste into vim
// ---------------------------------------------------------------------------

test('copy-mode text matches what vim displays after paste', async ({ page }, ti) => {
  const p = port(ti) + 1;
  const iso = createIsolatedTmux('tw-copy-mode-vim');
  let srv: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    iso.tmux(['new-session', '-d', '-s', 'copyvim', 'echo COPY_PASTE_VIM && exec cat']);
    await new Promise(r => setTimeout(r, 800));

    srv = await startServer('bun', [
      'src/server/index.ts', '--listen', `127.0.0.1:${p}`,
      '--no-auth', '--no-tls', '--tmux', iso.wrapperPath,
    ]);

    await page.addInitScript(() => {
      (window as any).__cw = [] as string[];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t: string) => { (window as any).__cw.push(t); return Promise.resolve(); } },
        configurable: true, writable: true,
      });
    });

    await page.goto(`http://127.0.0.1:${p}/copyvim`);
    await termReady(page);
    await page.waitForTimeout(800);

    // Copy in tmux copy-mode
    iso.tmux(['copy-mode', '-t', 'copyvim:1']);
    iso.tmux(['send-keys', '-t', 'copyvim:1', 'g']);
    iso.tmux(['send-keys', '-t', 'copyvim:1', 'v', 'e']);
    iso.tmux(['send-keys', '-t', 'copyvim:1', 'y']);

    await page.waitForFunction(
      (exp: string) => ((window as any).__cw as string[]).some((w: string) => w.trim() === exp),
      'COPY_PASTE_VIM', { timeout: 5000 },
    );

    const clipped = (await page.evaluate(() => (window as any).__cw)) as string[];
    const clipText = clipped.find((w: string) => w.trim() === 'COPY_PASTE_VIM')!;

    // ---- Verify tmux paste buffer holds the same text ----
    const bufText = iso.tmux(['show-buffer']).replace(/\n$/, '');
    expect(bufText).toBe('COPY_PASTE_VIM');

    // ---- Start vim and paste buffer content ----
    iso.tmux(['send-keys', '-t', 'copyvim:1', 'v', 'i', 'm', ' ', '-', 'u', ' ', 'N', 'O', 'N', 'E', ' ', '-', 'c', ' ', '\'', 's', 'e', 't', ' ', 'm', 'o', 'u', 's', 'e', '=', '\'', 'Enter']);
    await page.waitForTimeout(1000);

    // Enter insert mode
    iso.tmux(['send-keys', '-t', 'copyvim:1', 'i']);
    await page.waitForTimeout(200);

    // Paste tmux buffer into vim (sends buffer content as keystrokes)
    iso.tmux(['paste-buffer', '-t', 'copyvim:1']);
    await page.waitForTimeout(800);

    // Read terminal: vim should show the pasted text
    const screen = await page.evaluate(() => {
      const t = (window as any).__adapter?.term;
      if (!t) return '';
      const lines: string[] = [];
      for (let i = 0; i < t.rows; i++)
        lines.push(t.buffer.active.getLine(i)?.translateToString(true) ?? '');
      return lines.join('\n');
    });

    // Verify the pasted text appears in the terminal (vim insert mode)
    expect(screen).toContain('COPY_PASTE_VIM');

    // Identity: browser clipboard text === what vim displays
    expect(clipText.trim()).toBe('COPY_PASTE_VIM');
  } finally {
    if (srv) killServer(srv);
    iso.cleanup();
  }
});
