import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, killServer } from './helpers.js';

/** Boot a standalone tmux server on a scratch socket for this test,
 *  so we never touch the developer's real tmux session state. */
function bootTmux(): { sock: string; tmux: (args: string[]) => string } {
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-ctl-e2e-'));
  const sock = path.join(sockDir, 'sock');
  const tmux = (args: string[]) =>
    execFileSync('tmux', ['-S', sock, ...args], { encoding: 'utf8' });
  tmux(['new-session', '-d', '-s', 'e2e-main', 'cat']);
  return { sock, tmux };
}

const hasTmux = (() => {
  try {
    execFileSync('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
})();

test.skip(!hasTmux, 'tmux not available');

test('rename-session emits \\x00TT:session push to attached WS', async ({ page }) => {
  const { sock, tmux } = bootTmux();
  // Our server needs to attach to the same tmux socket. tmux-web uses
  // `tmux` bare unless --tmux is given; stub a wrapper that fixes -S.
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tmux-wrap-'));
  const wrapper = path.join(wrapperDir, 'tmux');
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec tmux -S ${sock} "$@"\n`, { mode: 0o755 });

  const server = await startServer('bun', [
    'src/server/index.ts',
    '--listen', '127.0.0.1:4117',
    '--no-auth', '--no-tls',
    '--tmux', wrapper,
  ]);
  try {
    const events: string[] = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', (ev) => {
        const payload =
          typeof ev.payload === 'string'
            ? ev.payload
            : ev.payload.toString('utf8');
        if (payload.startsWith('\x00TT:')) events.push(payload);
      });
    });
    await page.goto('http://127.0.0.1:4117/e2e-main');
    await page.waitForLoadState('networkidle');

    // Give the control client a beat to attach.
    await new Promise<void>((r) => setTimeout(r, 250));
    const before = events.length;

    // Rename the session from outside tmux-web. tmux fires
    // %session-renamed → primary forwards → ws broadcast.
    tmux(['rename-session', '-t', 'e2e-main', 'e2e-renamed']);

    // Expect at least one new \x00TT:session payload within 1500ms
    // (bumped from 500ms for slow CI machines).
    await expect
      .poll(() => events.length > before, { timeout: 1500 })
      .toBe(true);
    const msg = events[events.length - 1]!;
    expect(msg).toMatch(/^\x00TT:.*"session"/);
  } finally {
    killServer(server);
    try {
      tmux(['kill-server']);
    } catch {
      /* already gone */
    }
  }
});
