import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

function cmdOk(bin: string, arg: string): boolean {
  const proc = Bun.spawnSync([bin, arg], { stdout: 'ignore', stderr: 'ignore' });
  return proc.exitCode === 0;
}

function hasTmux(): boolean {
  return cmdOk('tmux', '-V');
}

function hasVim(): boolean {
  return cmdOk('vim', '--version');
}

// ---------------------------------------------------------------------------
// Minimal vimrc that emits OSC 52 on every yank
// ---------------------------------------------------------------------------

// Vim `system('base64 -w0', @0)` encodes the yanked register to base64 and
// strips trailing newlines.  `writefile(…, '/dev/tty', 'b')` writes the
// raw OSC 52 sequence to the controlling terminal so tmux can intercept it.
const VIMRC = [
  'set nocompatible',
  'set encoding=utf-8',
  'set clipboard=',
  '',
  'function! s:Osc52Yank() abort',
  "  let l:b64 = substitute(system('base64 -w0', @0), '\\n\\+$', '', '')",
  '  if empty(l:b64) | return | endif',
  '  let l:osc52 = "\\e]52;c;" . l:b64 . "\\x07"',
  "  call writefile([l:osc52], '/dev/tty', 'b')",
  'endfunction',
  '',
  'augroup Osc52YankGroup',
  '  autocmd!',
  '  autocmd TextYankPost * call s:Osc52Yank()',
  'augroup END',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Test tmux.conf — keep the paste buffer so `show-buffer` can verify
// ---------------------------------------------------------------------------

const TMUX_CONF = [
  'set -s set-clipboard on',
  "set -as terminal-overrides ',*:SetClipboard=on'",
  'set -g allow-passthrough on',
  'set -s extended-keys on',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tmux(socketPath: string, args: string[]): string {
  const proc = Bun.spawnSync({
    cmd: ['tmux', '-S', socketPath, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (proc.exitCode !== 0) {
    const err = proc.stderr?.toString().trim() ?? '';
    throw new Error(`tmux ${args.join(' ')} → exit ${proc.exitCode}: ${err}`);
  }
  return proc.stdout?.toString() ?? '';
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe('vim OSC 52 → tmux paste buffer', () => {
  const skip = !(hasTmux() && hasVim());

  let root: string;
  let socket: string;
  let vimrcPath: string;

  beforeAll(() => {
    if (skip) return;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-osc52-vim-'));
    socket = path.join(root, 'sock');

    // Write config files
    fs.writeFileSync(path.join(root, 'tmux.conf'), TMUX_CONF);
    vimrcPath = path.join(root, 'vimrc');
    fs.writeFileSync(vimrcPath, VIMRC);

    // Start isolated tmux server
    const proc = Bun.spawnSync({
      cmd: [
        'tmux', '-S', socket,
        '-f', path.join(root, 'tmux.conf'),
        'new-session', '-d', '-s', 'test',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (proc.exitCode !== 0) {
      throw new Error(`tmux server start failed: ${proc.stderr?.toString()}`);
    }
  });

  afterAll(() => {
    if (skip) return;
    try { tmux(socket, ['kill-server']); } catch { /* already gone */ }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  test.skipIf(skip)(
    'visual-select yank (v y) lands in tmux paste buffer',
    async () => {
      // Start vim with our test-only config
      tmux(socket, ['send-keys', '-t', 'test', `vim -u ${vimrcPath}`, 'Enter']);
      await Bun.sleep(600);

      // Insert "hello" → i hello Escape
      tmux(socket, ['send-keys', '-t', 'test', 'i', 'h', 'e', 'l', 'l', 'o', 'Escape']);
      await Bun.sleep(200);

      // Select entire line and yank → 0 v $ y
      tmux(socket, ['send-keys', '-t', 'test', '0', 'v', '$', 'y']);
      await Bun.sleep(400);

      // Verify: tmux paste buffer must contain "hello"
      const buffer = tmux(socket, ['show-buffer']).replace(/\n$/, '');
      expect(buffer).toBe('hello');

      // Quit vim → Escape : q ! Enter
      tmux(socket, ['send-keys', '-t', 'test', 'Escape', ':', 'q', '!', 'Enter']);
      await Bun.sleep(300);
    },
  );

  test.skipIf(skip)(
    'explicit clipboard register (+) yank also lands in tmux paste buffer',
    async () => {
      tmux(socket, ['send-keys', '-t', 'test', `vim -u ${vimrcPath}`, 'Enter']);
      await Bun.sleep(600);

      // Insert "world"
      tmux(socket, ['send-keys', '-t', 'test', 'i', 'w', 'o', 'r', 'l', 'd', 'Escape']);
      await Bun.sleep(200);

      // Yank into + register: "+yy (selects current line)
      tmux(socket, ['send-keys', '-t', 'test', '"', '+', 'y', 'y']);
      await Bun.sleep(400);

      const buffer = tmux(socket, ['show-buffer']).replace(/\n$/, '');
      expect(buffer).toBe('world');

      tmux(socket, ['send-keys', '-t', 'test', 'Escape', ':', 'q', '!', 'Enter']);
      await Bun.sleep(300);
    },
  );
});
