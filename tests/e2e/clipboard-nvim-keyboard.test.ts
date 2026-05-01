/**
 * End-to-end: keyboard-driven clipboard through Neovim in real tmux.
 *
 *  1. Yank: visual-select (v) + y in Neovim  →  tmux load-buffer -w →
 *     tmux paste buffer + tmux-web → browser clipboard.
 *
 *  2. Paste: browser clipboard mirror → tmux paste buffer →
 *     Neovim p reads the tmux-backed + register.
 *
 *  The isolated init.lua intentionally uses one editor config for both
 *  directions: copy through tmux so yanks are usable in other panes, paste
 *  from tmux so browser/OS clipboard mirroring is visible to normal p.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
  startServer, killServer, createIsolatedTmux, hasTmux,
} from './helpers.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test.skip(!hasTmux(), 'tmux not available');

function hasNvim(): boolean {
  try { execFileSync('nvim', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
test.skip(!hasNvim(), 'Neovim not available');

const PORT_BASE = 41420;
function port(ti: TestInfo, offset = 0) { return PORT_BASE + ti.parallelIndex * 10 + offset; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function termReady(page: Page) {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 12000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 12000 });
}

async function termContains(page: Page, needle: string, ms = 8000): Promise<void> {
  await page.waitForFunction((n: string) => {
    const t = (window as any).__adapter?.term;
    if (!t) return false;
    for (let i = 0; i < t.rows; i++) {
      const ln = t.buffer.active.getLine(i);
      if (ln?.translateToString(true)?.includes(n)) return true;
    }
    return false;
  }, needle, { timeout: ms });
}

async function installClipboard(page: Page, readText = ''): Promise<void> {
  await page.addInitScript((initialReadText: string) => {
    (window as any).__c = [] as string[];
    (window as any).__cr = initialReadText;
    (window as any).__readCount = 0;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (t: string) => { (window as any).__c.push(t); return Promise.resolve(); },
        readText: () => {
          (window as any).__readCount += 1;
          return Promise.resolve((window as any).__cr);
        },
      },
      configurable: true,
      writable: true,
    });
  }, readText);
}

const NVIM_INIT = `
vim.g.clipboard = {
  name = 'tmux-web-test',
  copy = {
    ['+'] = { 'tmux', 'load-buffer', '-w', '-' },
    ['*'] = { 'tmux', 'load-buffer', '-w', '-' },
  },
  paste = {
    ['+'] = { 'tmux', 'save-buffer', '-' },
    ['*'] = { 'tmux', 'save-buffer', '-' },
  },
}
vim.o.clipboard = 'unnamedplus'
vim.o.mouse = ''
`;

function writeNvimInit(): { dir: string; path: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-nvim-init-'));
  const initPath = path.join(dir, 'init.lua');
  fs.writeFileSync(initPath, NVIM_INIT);
  return { dir, path: initPath };
}

// ---------------------------------------------------------------------------
// Test 1 — Yank: Neovim → browser clipboard
// ---------------------------------------------------------------------------

test('Neovim keyboard yank lands in browser clipboard', async ({ page }, ti) => {
  const p = port(ti);
  const iso = createIsolatedTmux('tw-nv-yank3');
  let srv: Awaited<ReturnType<typeof startServer>> | undefined;
  const init = writeNvimInit();
  try {
    iso.tmux(['new-session', '-d', '-s', 'yank', `nvim --clean --cmd 'luafile ${init.path}'`]);
    await new Promise(r => setTimeout(r, 1200));

    srv = await startServer('bun', [
      'src/server/index.ts', '--listen', `127.0.0.1:${p}`,
      '--no-auth', '--no-tls', '--tmux', iso.wrapperPath,
      '--tmux-conf', iso.tmuxConfPath,
    ]);

    await installClipboard(page);

    await page.goto(`http://127.0.0.1:${p}/yank`);
    await termReady(page);
    await page.waitForTimeout(800);
    expect(iso.tmux(['show-options', '-s', '-g', 'set-clipboard']).trim())
      .toBe('set-clipboard external');

    // Type line and yank
    iso.tmux(['send-keys', '-t', 'yank', 'i', 'N', 'V', 'I', 'M', '_', 'Y', 'N', 'K', 'Escape']);
    await page.waitForTimeout(400);
    iso.tmux(['send-keys', '-t', 'yank', 'y', 'y']);

    // Wait for OSC 52 → tmux → tmux-web → browser clipboard
    await page.waitForFunction((exp: string) =>
      ((window as any).__c as string[]).some((w: string) => w.trim() === exp),
      'NVIM_YNK', { timeout: 5000 },
    );

    const clips = await page.evaluate(() => (window as any).__c);
    expect(clips.some((w: string) => w.trim() === 'NVIM_YNK')).toBe(true);
    expect(iso.tmux(['show-buffer']).trim()).toBe('NVIM_YNK');
  } finally {
    if (srv) killServer(srv);
    iso.cleanup();
    try { fs.rmSync(init.dir, { recursive: true, force: true }); } catch {}
  }
});

// ---------------------------------------------------------------------------
// Test 2 — Paste: browser clipboard → delivered to Neovim pane
// ---------------------------------------------------------------------------

test('tmux-web delivers browser clipboard content into Neovim pane', async ({ page }, ti) => {
  const p = port(ti, 1);
  const iso = createIsolatedTmux('tw-nv-paste3');
  const PASTE = 'FROM_CLIP_PASTE';
  let srv: Awaited<ReturnType<typeof startServer>> | undefined;
  const init = writeNvimInit();
  try {
    iso.tmux(['new-session', '-d', '-s', 'paste', `nvim --clean --cmd 'luafile ${init.path}'`]);
    await new Promise(r => setTimeout(r, 1200));

    srv = await startServer('bun', [
      'src/server/index.ts', '--listen', `127.0.0.1:${p}`,
      '--no-auth', '--no-tls', '--tmux', iso.wrapperPath,
      '--tmux-conf', iso.tmuxConfPath,
    ]);

    await installClipboard(page, PASTE);

    await page.goto(`http://127.0.0.1:${p}/paste`);
    await termReady(page);
    await page.waitForTimeout(800);
    expect(iso.tmux(['show-options', '-s', '-g', 'set-clipboard']).trim())
      .toBe('set-clipboard external');

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => (window as any).__readCount > 0, { timeout: 5000 });
    iso.tmux(['send-keys', '-t', 'paste', 'p']);
    await termContains(page, PASTE, 8000);
  } finally {
    if (srv) killServer(srv);
    iso.cleanup();
    try { fs.rmSync(init.dir, { recursive: true, force: true }); } catch {}
  }
});
