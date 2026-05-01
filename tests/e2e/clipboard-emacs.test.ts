/**
 * End-to-end: Emacs clipboard through real tmux.
 *
 * Emacs doesn't load xterm.el for tmux-256color automatically.
 * A tiny init.el registers one command:
 *   C-c o  — copy region to browser clipboard via tmux DCS passthrough
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

function hasEmacs(): boolean {
  try { execFileSync('emacs', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
test.skip(!hasEmacs(), 'Emacs not available');
test.setTimeout(60_000);

const PORT_BASE = 41460;
function port(ti: TestInfo) { return PORT_BASE + ti.parallelIndex * 10; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function showBufferWithTimeout(socketPath: string): string {
  return execFileSync('tmux', ['-S', socketPath, 'show-buffer'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1000,
  });
}

async function termReady(page: Page) {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 12000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 12000 });
}

async function installClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__cw = [] as string[];
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (t: string) => { (window as any).__cw.push(t); return Promise.resolve(); },
      },
      configurable: true,
      writable: true,
    });
  });
}

// ---------------------------------------------------------------------------
// Emacs init.el that uses tmux as the clipboard bridge
// ---------------------------------------------------------------------------

const EMACS_INIT = `
(setq inhibit-startup-screen t)
(setq select-enable-clipboard t)

;; Emacs in -nw mode under tmux-256color does not load xterm.el
;; automatically, so we force it and register the setSelection capability.
(unless (display-graphic-p)
  (condition-case nil
      (progn
        (require 'xterm)
        (add-to-list 'xterm-extra-capabilities 'setSelection)
        (terminal-init-xterm))
    (error nil)))

;; --- copy: browser clipboard via tmux DCS passthrough OSC 52 ---
(defun osc52-copy ()
  (interactive)
  (let* ((text (buffer-substring-no-properties
                (region-beginning) (region-end)))
         (payload (base64-encode-string
                   (encode-coding-string text 'utf-8 t)
                   t)))
    (send-string-to-terminal
     (concat "\\ePtmux;\\e\\e]52;c;" payload "\\a\\e\\\\"))))

(global-set-key (kbd "C-c o") 'osc52-copy)
(unless noninteractive
  (insert "TMUX_WEB_EMACS_READY\n"))
`;

// ---------------------------------------------------------------------------
// Test 1 — Emacs copy → browser clipboard
// ---------------------------------------------------------------------------

test('Emacs clipboard command copies region to browser clipboard', async ({ page }, ti) => {
  const p = port(ti);
  const iso = createIsolatedTmux('tw-emacs-copy');
  let srv: Awaited<ReturnType<typeof startServer>> | undefined;
  let initDir: string | undefined;

  try {
    initDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-emacs-init-'));
    const initPath = path.join(initDir, 'init.el');
    const gatePath = path.join(initDir, 'go');
    fs.writeFileSync(initPath, EMACS_INIT);

    const evalCopy = [
      '(with-temp-buffer',
      '  (insert "EMACS_COPY")',
      '  (push-mark (point-min) t t)',
      '  (goto-char (point-max))',
      '  (osc52-copy))',
    ].join(' ');
    const batchCommand = `TERM=xterm-256color emacs --batch -q -l ${shellSingleQuote(initPath)} --eval ${shellSingleQuote(evalCopy)}`;
    const gatedCommand = `while [ ! -e ${shellSingleQuote(gatePath)} ]; do sleep 0.05; done; ${batchCommand}; sleep 60`;
    iso.tmux(['new-session', '-d', '-s', 'emacs', `bash --noprofile --norc -c ${shellSingleQuote(gatedCommand)}`]);
    await new Promise(r => setTimeout(r, 500));

    srv = await startServer('bun', [
      'src/server/index.ts', '--listen', `127.0.0.1:${p}`,
      '--no-auth', '--no-tls', '--tmux', iso.wrapperPath,
      '--tmux-conf', iso.tmuxConfPath,
    ]);

    await installClipboard(page);

    await page.goto(`http://127.0.0.1:${p}/emacs`);
    await termReady(page);
    expect(iso.tmux(['show-options', '-s', '-g', 'set-clipboard']).trim())
      .toBe('set-clipboard external');

    fs.writeFileSync(gatePath, '');

    // Assert browser clipboard CONTAINS our text (buffer has scratch-intro too)
    await page.waitForFunction(
      (exp: string) => ((window as any).__cw as string[]).some((w: string) => w.includes(exp)),
      'EMACS_COPY', { timeout: 12000 },
    );
    const writes: string[] = await page.evaluate(() => (window as any).__cw);
    expect(writes.some((w: string) => w.includes('EMACS_COPY'))).toBe(true);
    await expect.poll(() => {
      try { return showBufferWithTimeout(iso.socketPath); }
      catch { return ''; }
    }, { timeout: 5000 })
      .toContain('EMACS_COPY');
  } finally {
    if (srv) killServer(srv);
    iso.cleanup();
    if (initDir) try { fs.rmSync(initDir, { recursive: true, force: true }); } catch {}
  }
});
