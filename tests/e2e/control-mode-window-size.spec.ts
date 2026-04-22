import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, killServer } from './helpers.js';

const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true; } catch { return false; } })();
test.skip(!hasTmux, 'tmux not available');

test('attached control client does not shrink session below display size', async ({ page }) => {
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-ctl-size-'));
  const sock = path.join(sockDir, 'sock');
  const tmux = (args: string[]) => execFileSync('tmux', ['-S', sock, ...args], { encoding: 'utf8' });
  tmux(['new-session', '-d', '-s', 'sz', 'cat']);

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-sz-wrap-'));
  const wrapper = path.join(wrapperDir, 'tmux');
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec tmux -S ${sock} "$@"\n`, { mode: 0o755 });

  const server = await startServer('bun', [
    'src/server/index.ts',
    '--listen', '127.0.0.1:4118',
    '--no-auth', '--no-tls',
    '--tmux', wrapper,
  ]);
  try {
    await page.setViewportSize({ width: 2400, height: 1200 });
    await page.goto('http://127.0.0.1:4118/sz');
    await page.waitForLoadState('networkidle');
    // Give attach + refresh-client a beat.
    await new Promise(r => setTimeout(r, 500));

    const size = tmux(['display-message', '-p', '-t', 'sz', '#{window_width}x#{window_height}']).trim();
    const [w, h] = size.split('x').map(Number);
    // The display client should drive the size. Confirm it's not the
    // control-client default (80x24) and not the old smallest-wins
    // collapse to 80.
    expect(w!).toBeGreaterThan(80);
    expect(h!).toBeGreaterThan(24);
  } finally {
    killServer(server);
    try { tmux(['kill-server']); } catch {}
  }
});
