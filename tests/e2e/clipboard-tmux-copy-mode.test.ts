/**
 * End-to-end: tmux copy-mode keyboard shortcuts → browser clipboard,
 * and tmux paste-buffer → vim.
 *
 * Uses the bundled tmux.conf via the isolated e2e wrapper (set-clipboard
 * must match the project default, mouse on,
 * mode-keys vi).
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
  startServer, killServer, createIsolatedTmux, hasTmux,
} from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');
test.setTimeout(30_000);

const PORT_BASE = 41440;

function port(ti: TestInfo, offset = 0) { return PORT_BASE + ti.parallelIndex * 10 + offset; }

async function termReady(page: Page) {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 12000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 12000 });
}

async function termContains(page: Page, needle: string, timeout = 8000): Promise<void> {
  await page.waitForFunction((expected: string) => {
    const t = (window as any).__adapter?.term;
    if (!t) return false;
    for (let i = 0; i < t.rows; i++) {
      if (t.buffer.active.getLine(i)?.translateToString(true)?.includes(expected)) return true;
    }
    return false;
  }, needle, { timeout });
}

// ---------------------------------------------------------------------------
// Test — copy-mode text → browser clipboard + tmux buffer → paste into vim
// ---------------------------------------------------------------------------

test('copy-mode text reaches browser clipboard, tmux buffer, and vim paste', async ({ page }, ti) => {
  const p = port(ti, 1);
  const iso = createIsolatedTmux('tw-copy-mode-vim');
  let srv: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    iso.tmux(['new-session', '-d', '-s', 'copyvim', 'echo COPY_PASTE_VIM && exec cat']);
    await new Promise(r => setTimeout(r, 800));

    srv = await startServer('bun', [
      'src/server/index.ts', '--listen', `127.0.0.1:${p}`,
      '--no-auth', '--no-tls', '--tmux', iso.wrapperPath,
      '--tmux-conf', iso.tmuxConfPath,
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
    await termContains(page, 'COPY_PASTE_VIM');
    expect(iso.tmux(['show-options', '-s', '-g', 'set-clipboard']).trim())
      .toBe('set-clipboard external');

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
