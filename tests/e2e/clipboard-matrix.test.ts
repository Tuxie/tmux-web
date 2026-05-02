/**
 * End-to-end clipboard matrix for tmux-web, real tmux, Emacs/Helix/Vim/Neovim
 * `clipboard=unnamedplus`, and the browser/OS clipboard bridge.
 *
 * All rows use createIsolatedTmux(), which loads the project tmux.conf with
 * only source-file lines stripped. Each editor uses one shared init file for
 * every row. No row mutates tmux or editor settings for a special case.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createIsolatedTmux,
  hasTmux,
  killServer,
  startServer,
  type IsolatedTmux,
} from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');
test.setTimeout(60_000);

function hasCommand(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const PORT_BASE = 6122;

function port(testInfo: TestInfo, offset: number): number {
  return PORT_BASE + testInfo.parallelIndex * 100 + offset;
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const NVIM_INIT = `
vim.g.clipboard = {
  name = 'tmux-web-e2e',
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
vim.o.mouse = 'a'
vim.o.swapfile = false
vim.o.shortmess = vim.o.shortmess .. 'I'
`;

const VIM_INIT = `
set nocompatible
set clipboard=unnamedplus
set mouse=a
set noswapfile
set shortmess+=I

let g:tmux_web_clipboard_cache = ''

function! TmuxWebClipboardAvailable() abort
  return v:true
endfunction

function! TmuxWebClipboardCopy(reg, type, lines) abort
  let l:text = join(a:lines, "\\n")
  if a:type ==# 'V'
    let l:text .= "\\n"
  endif
  let g:tmux_web_clipboard_cache = l:text
  if exists('$TMUX') && executable('tmux')
    call system(['tmux', 'load-buffer', '-w', '-'], l:text)
  endif
endfunction

function! TmuxWebClipboardPaste(reg) abort
  if exists('$TMUX') && executable('tmux')
    let l:text = system(['tmux', 'save-buffer', '-'])
    if !v:shell_error
      return ['v', split(l:text, "\\n", 1)]
    endif
  endif
  return ['v', split(g:tmux_web_clipboard_cache, "\\n", 1)]
endfunction

let v:clipproviders['tmux-web'] = {
      \\ 'available': function('TmuxWebClipboardAvailable'),
      \\ 'copy': {
      \\   '+': function('TmuxWebClipboardCopy'),
      \\   '*': function('TmuxWebClipboardCopy'),
      \\ },
      \\ 'paste': {
      \\   '+': function('TmuxWebClipboardPaste'),
      \\   '*': function('TmuxWebClipboardPaste'),
      \\ },
      \\ }
set clipmethod^=tmux-web
`;

const EMACS_INIT = `
(setq inhibit-startup-screen t)
(setq make-backup-files nil)
(setq auto-save-default nil)
(setq select-enable-clipboard t)
(setq tmux-web-clipboard-cache "")

(defun tmux-web-copy (text)
  (setq tmux-web-clipboard-cache text)
  (when (and (getenv "TMUX") (executable-find "tmux"))
    (let ((process-connection-type nil))
      (with-temp-buffer
        (insert text)
        (call-process-region (point-min) (point-max)
                             "tmux" nil nil nil
                             "load-buffer" "-w" "-")))))

(defun tmux-web-paste ()
  (if (and (getenv "TMUX") (executable-find "tmux"))
      (with-temp-buffer
        (let ((status (call-process "tmux" nil t nil "save-buffer" "-")))
          (if (eq status 0)
              (buffer-string)
            tmux-web-clipboard-cache)))
    tmux-web-clipboard-cache))

(setq interprogram-cut-function #'tmux-web-copy)
(setq interprogram-paste-function #'tmux-web-paste)
`;

const HELIX_CONFIG = `
[editor]
default-yank-register = "+"
mouse = true
path-completion = false

[editor.clipboard-provider.custom]
yank = { command = "sh", args = ["-c", "if [ -n \\"$TMUX\\" ] && tmux save-buffer - 2>/dev/null; then :; else cat '__CACHE__' 2>/dev/null || true; fi"] }
paste = { command = "sh", args = ["-c", "cat > '__CACHE__'; if [ -n \\"$TMUX\\" ]; then tmux load-buffer -w '__CACHE__' >/dev/null 2>&1 || true; fi"] }
primary-yank = { command = "sh", args = ["-c", "if [ -n \\"$TMUX\\" ] && tmux save-buffer - 2>/dev/null; then :; else cat '__CACHE__' 2>/dev/null || true; fi"] }
primary-paste = { command = "sh", args = ["-c", "cat > '__CACHE__'; if [ -n \\"$TMUX\\" ]; then tmux load-buffer -w '__CACHE__' >/dev/null 2>&1 || true; fi"] }
`;

interface Editor {
  kind: 'nvim' | 'vim' | 'emacs' | 'helix';
  label: string;
  command: string;
  commandName: string;
  initPrefix: string;
  initFilename: string;
  initContent: string;
  launchCommand(initPath: string): string;
  outsideCopyPaste(initPath: string, outputPath: string, text: string): void | Promise<void>;
  insertLine(iso: IsolatedTmux, target: string, text: string): Promise<void>;
  visualYankLine(iso: IsolatedTmux, target: string): Promise<void>;
  normalPaste(iso: IsolatedTmux, target: string): Promise<void>;
  pasteTmuxBuffer(iso: IsolatedTmux, target: string): Promise<void>;
  writeBuffer(iso: IsolatedTmux, target: string, outputPath: string): Promise<void>;
  quit(iso: IsolatedTmux, target: string): Promise<void>;
}

interface EditorInit {
  dir: string;
  path: string;
}

const EDITORS: Editor[] = [
  {
    kind: 'nvim',
    label: 'nvim',
    command: 'nvim',
    commandName: 'nvim',
    initPrefix: 'tw-clip-matrix-nvim-',
    initFilename: 'init.lua',
    initContent: NVIM_INIT,
    launchCommand: (initPath) => `nvim --clean --cmd ${shellSingleQuote(`luafile ${initPath}`)}`,
    outsideCopyPaste: runNvimOutsideTmuxCopyPaste,
    insertLine: vimLikeInsertLine,
    visualYankLine: vimLikeVisualYankLine,
    normalPaste: vimLikeNormalPaste,
    pasteTmuxBuffer: vimLikeInsertModeTmuxPaste,
    writeBuffer: vimLikeWriteBuffer,
    quit: vimLikeQuit,
  },
  {
    kind: 'vim',
    label: 'vim',
    command: 'vim',
    commandName: 'vim',
    initPrefix: 'tw-clip-matrix-vim-',
    initFilename: 'init.vim',
    initContent: VIM_INIT,
    launchCommand: (initPath) => `vim --clean -Nu ${shellSingleQuote(initPath)} -n`,
    outsideCopyPaste: runVimOutsideTmuxCopyPaste,
    insertLine: vimLikeInsertLine,
    visualYankLine: vimLikeVisualYankLine,
    normalPaste: vimLikeNormalPaste,
    pasteTmuxBuffer: vimLikeInsertModeTmuxPaste,
    writeBuffer: vimLikeWriteBuffer,
    quit: vimLikeQuit,
  },
  {
    kind: 'emacs',
    label: 'emacs',
    command: 'emacs',
    commandName: 'emacs',
    initPrefix: 'tw-clip-matrix-emacs-',
    initFilename: 'init.el',
    initContent: EMACS_INIT,
    launchCommand: (initPath) => `emacs -nw -q -l ${shellSingleQuote(initPath)}`,
    outsideCopyPaste: runEmacsOutsideTmuxCopyPaste,
    insertLine: emacsInsertLine,
    visualYankLine: emacsVisualYankLine,
    normalPaste: emacsNormalPaste,
    pasteTmuxBuffer: emacsPasteTmuxBuffer,
    writeBuffer: emacsWriteBuffer,
    quit: emacsQuit,
  },
  {
    kind: 'helix',
    label: 'helix',
    command: 'hx',
    commandName: 'hx',
    initPrefix: 'tw-clip-matrix-helix-',
    initFilename: 'config.toml',
    initContent: HELIX_CONFIG,
    launchCommand: (initPath) => {
      const dir = path.dirname(initPath);
      return `cd ${shellSingleQuote(dir)} && hx --config ${shellSingleQuote(initPath)} --log ${shellSingleQuote(path.join(dir, 'helix.log'))}`;
    },
    outsideCopyPaste: runHelixOutsideTmuxCopyPaste,
    insertLine: helixInsertLine,
    visualYankLine: helixVisualYankLine,
    normalPaste: helixNormalPaste,
    pasteTmuxBuffer: helixPasteTmuxBuffer,
    writeBuffer: helixWriteBuffer,
    quit: helixQuit,
  },
];

function writeEditorInit(editor: Editor): EditorInit {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), editor.initPrefix));
  const initPath = path.join(dir, editor.initFilename);
  fs.writeFileSync(initPath, editor.initContent.replaceAll('__CACHE__', path.join(dir, 'clipboard.txt')));
  return { dir, path: initPath };
}

function runNvimOutsideTmuxCopyPaste(initPath: string, outputPath: string, text: string): void {
  const script = [
    `vim.api.nvim_buf_set_lines(0, 0, -1, false, { ${JSON.stringify(text)} })`,
    'vim.api.nvim_win_set_cursor(0, { 1, 0 })',
    "vim.cmd('normal! 0v$y')",
    "vim.cmd('normal! Gp')",
    `vim.cmd(${JSON.stringify(`silent! write! ${outputPath}`)})`,
    "vim.cmd('quitall!')",
  ].join('; ');
  execFileSync('nvim', [
    '--headless',
    '--clean',
    '--cmd',
    `luafile ${initPath}`,
    '--cmd',
    `lua ${script}`,
  ], {
    env: { ...process.env, TMUX: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runVimOutsideTmuxCopyPaste(initPath: string, outputPath: string, text: string): void {
  execFileSync('vim', [
    '--clean',
    '--not-a-term',
    '-Nu',
    initPath,
    '-n',
    '-es',
    '+set nomore',
    `+call setline(1, ${JSON.stringify(text)})`,
    '+normal! 0v$y',
    '+normal! Gp',
    `+silent! write! ${outputPath}`,
    '+qa!',
  ], {
    env: { ...process.env, TMUX: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runEmacsOutsideTmuxCopyPaste(initPath: string, outputPath: string, text: string): void {
  const script = [
    '(with-temp-buffer',
    `  (insert ${JSON.stringify(text)})`,
    '  (kill-ring-save (point-min) (point-max))',
    '  (goto-char (point-max))',
    '  (yank)',
    `  (write-region (point-min) (point-max) ${JSON.stringify(outputPath)} nil (quote silent)))`,
  ].join('\n');
  execFileSync('emacs', [
    '--batch',
    '-q',
    '-l',
    initPath,
    '--eval',
    script,
  ], {
    env: { ...process.env, TMUX: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function runHelixOutsideTmuxCopyPaste(initPath: string, outputPath: string, text: string): Promise<void> {
  const runDir = path.dirname(outputPath);
  const cachePath = path.join(path.dirname(initPath), 'clipboard.txt');
  const inputPath = path.join(runDir, 'outside-helix-input.txt');
  fs.writeFileSync(inputPath, '');
  const command = `cd ${shellSingleQuote(runDir)} && hx --config ${shellSingleQuote(initPath)} --log ${shellSingleQuote(path.join(runDir, 'helix.log'))} ${shellSingleQuote(path.basename(inputPath))}`;
  const proc = spawn('script', ['-qfec', command, '/dev/null'], {
    stdio: ['pipe', 'pipe', 'ignore'],
    detached: true,
    env: { ...process.env, TMUX: '' },
  });
  installTerminalQueryResponses(proc);
  try {
    await waitForProcessSettled();
    await sendProcessKeys(proc, ['i']);
    sendProcessLiteral(proc, text);
    await sendProcessKeys(proc, ['Escape', 'x', 'y', 'p', '%', 'y']);
    await waitForPaneSettled();
    const yankedBuffer = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : '';
    const occurrences = yankedBuffer.split(text).length - 1;
    if (occurrences < 2) {
      throw new Error(`Helix outside-tmux paste did not duplicate yanked text; clipboard contained ${JSON.stringify(yankedBuffer)}`);
    }
    fs.writeFileSync(outputPath, yankedBuffer);
  } finally {
    try { proc.kill('SIGTERM'); } catch { /* already exited */ }
  }
}

function installTerminalQueryResponses(proc: ChildProcess): void {
  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('binary');
    if (text.includes('\x1b[c')) proc.stdin?.write('\x1b[?62;4c');
    if (text.includes('\x1b[>c')) proc.stdin?.write('\x1b[>0;276;0c');
    if (text.includes('\x1b[?u')) proc.stdin?.write('\x1b[?0u');
  });
}

async function waitForProcessSettled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 1_500));
}

function sendProcessLiteral(proc: ChildProcess, text: string): void {
  proc.stdin?.write(text);
}

async function sendProcessKeys(proc: ChildProcess, keys: string[]): Promise<void> {
  for (const key of keys) {
    if (key === 'Escape') proc.stdin?.write('\x1b');
    else if (key === 'Enter') proc.stdin?.write('\r');
    else proc.stdin?.write(key);
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

async function termReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 12_000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 12_000 });
}

async function waitForTerminalText(
  page: Page,
  substring: string,
  timeout = 8_000,
): Promise<void> {
  await page.waitForFunction((needle: string) => {
    const term = (window as any).__adapter?.term;
    if (!term) return false;
    for (let i = 0; i < term.rows; i++) {
      const line = term.buffer.active.getLine(i);
      if (line?.translateToString(true)?.includes(needle)) return true;
    }
    return false;
  }, substring, { timeout });
}

async function mouseSelectTerminalText(page: Page, text: string): Promise<void> {
  const coords = await page.evaluate((needle: string) => {
    const term = (window as any).__adapter?.term;
    if (!term) throw new Error('terminal adapter not found');

    let row = -1;
    let column = -1;
    for (let i = 0; i < term.rows; i++) {
      const line = term.buffer.active.getLine(i)?.translateToString(true) ?? '';
      column = line.indexOf(needle);
      if (column !== -1) {
        row = i;
        break;
      }
    }
    if (row === -1 || column === -1) throw new Error(`terminal text not found: ${needle}`);

    const dims = term._core._renderService.dimensions;
    const cellWidth = dims.css.cell.width;
    const cellHeight = dims.css.cell.height;
    const canvas: HTMLElement | null = document.querySelector('#terminal canvas');
    if (!canvas) throw new Error('xterm canvas not found');
    const rect = canvas.getBoundingClientRect();

    return {
      startX: rect.left + (column + 0.5) * cellWidth,
      startY: rect.top + (row + 0.5) * cellHeight,
      endX: rect.left + (column + needle.length - 0.5) * cellWidth,
      endY: rect.top + (row + 0.5) * cellHeight,
    };
  }, text);

  await page.mouse.move(coords.startX, coords.startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    const fraction = i / 10;
    await page.mouse.move(
      coords.startX + (coords.endX - coords.startX) * fraction,
      coords.startY + (coords.endY - coords.startY) * fraction,
    );
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
}

async function mouseCopyTerminalText(
  page: Page,
  iso: IsolatedTmux,
  text: string,
): Promise<void> {
  await waitForTerminalText(page, text);
  await mouseSelectTerminalText(page, text);
  await expect.poll(() => showBufferOrEmpty(iso).trim(), { timeout: 5_000 }).toBe(text);
}

async function waitForTmuxWebPtyClient(iso: IsolatedTmux, session: string): Promise<void> {
  await expect.poll(() => iso.tmux([
    'list-clients',
    '-F',
    '#{client_session} #{client_control_mode}',
  ]), { timeout: 8_000 }).toContain(`${session} 0`);
}

async function installClipboard(page: Page, initialText = ''): Promise<void> {
  await page.addInitScript((text: string) => {
    (window as any).__clipboardWrites = [] as string[];
    (window as any).__clipboardReadCount = 0;
    (window as any).__clipboardText = text;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (value: string) => {
          (window as any).__clipboardText = value;
          (window as any).__clipboardWrites.push(value);
          return Promise.resolve();
        },
        readText: () => {
          (window as any).__clipboardReadCount += 1;
          return Promise.resolve((window as any).__clipboardText);
        },
      },
      configurable: true,
      writable: true,
    });
  }, initialText);
}

async function connectTmuxWeb(
  page: Page,
  iso: IsolatedTmux,
  testInfo: TestInfo,
  session: string,
  offset: number,
  osClipboard = '',
): Promise<Awaited<ReturnType<typeof startServer>>> {
  const p = port(testInfo, offset);
  await installClipboard(page, osClipboard);
  const server = await startServer('bun', [
    'src/server/index.ts',
    '--listen',
    `127.0.0.1:${p}`,
    '--no-auth',
    '--no-tls',
    '--tmux',
    iso.wrapperPath,
    '--tmux-conf',
    iso.tmuxConfPath,
  ]);
  await page.goto(`http://127.0.0.1:${p}/${session}`);
  await termReady(page);
  await waitForTmuxWebPtyClient(iso, session);
  await waitForPaneSettled();
  expect(iso.tmux(['show-options', '-s', '-g', 'set-clipboard']).trim())
    .toBe('set-clipboard external');
  return server;
}

async function expectOsClipboard(page: Page, expected: string): Promise<void> {
  await page.waitForFunction((value: string) =>
    ((window as any).__clipboardWrites as string[]).some((entry: string) => entry.trim() === value),
  expected, { timeout: 8_000 });
  const writes = await page.evaluate(() => (window as any).__clipboardWrites as string[]);
  expect(writes.some(entry => entry.trim() === expected)).toBe(true);
}

async function mirrorOsClipboardToTmuxBuffer(
  page: Page,
  iso: IsolatedTmux,
  expected: string,
): Promise<void> {
  const priorReadCount = await page.evaluate(() => (window as any).__clipboardReadCount as number);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction((count: number) => (window as any).__clipboardReadCount > count, priorReadCount, { timeout: 5_000 });
  await expect.poll(() => showBufferOrEmpty(iso), { timeout: 5_000 }).toBe(expected);
}

async function browserPasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((value: string) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, text);
}

async function waitForPaneSettled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 800));
}

async function waitForPaneCommand(
  iso: IsolatedTmux,
  target: string,
  command: string,
): Promise<void> {
  await expect.poll(() => iso.tmux(['display-message', '-p', '-t', target, '#{pane_current_command}']).trim(), {
    timeout: 8_000,
  }).toBe(command);
}

function sendLiteral(iso: IsolatedTmux, target: string, text: string): void {
  iso.tmux(['send-keys', '-t', target, '-l', text]);
}

function sendKeys(iso: IsolatedTmux, target: string, keys: string[]): void {
  iso.tmux(['send-keys', '-t', target, ...keys]);
}

function showBufferOrEmpty(iso: IsolatedTmux): string {
  try {
    return iso.tmux(['show-buffer']).replace(/\n$/, '');
  } catch {
    return '';
  }
}

function startCatSession(iso: IsolatedTmux, session: string, text?: string): void {
  const cmd = text
    ? `printf '%s\\n' ${shellSingleQuote(text)}; exec cat`
    : 'cat';
  iso.tmux(['new-session', '-d', '-s', session, cmd]);
}

function startEditorSession(iso: IsolatedTmux, editor: Editor, session: string, initPath: string): void {
  iso.tmux([
    'new-session',
    '-d',
    '-s',
    session,
    editor.launchCommand(initPath),
  ]);
}

function startShellSession(iso: IsolatedTmux, session: string): void {
  iso.tmux(['new-session', '-d', '-s', session, 'bash', '--noprofile', '--norc']);
}

function startShellSessionWithText(iso: IsolatedTmux, session: string, text: string): void {
  iso.tmux([
    'new-session',
    '-d',
    '-s',
    session,
    `printf '%s\\n' ${shellSingleQuote(text)}; exec bash --noprofile --norc`,
  ]);
}

async function launchEditorInExistingSession(
  iso: IsolatedTmux,
  editor: Editor,
  target: string,
  initPath: string,
): Promise<void> {
  iso.tmux(['send-keys', '-t', target, editor.launchCommand(initPath), 'Enter']);
  await waitForPaneCommand(iso, target, editor.commandName);
}

async function vimLikeInsertLine(iso: IsolatedTmux, target: string, text: string): Promise<void> {
  sendKeys(iso, target, ['i']);
  sendLiteral(iso, target, text);
  sendKeys(iso, target, ['Escape']);
  await waitForPaneSettled();
}

async function vimLikeVisualYankLine(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['0', 'v', '$', 'y']);
  await waitForPaneSettled();
}

async function vimLikeNormalPaste(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['p']);
  await waitForPaneSettled();
}

async function vimLikeInsertModeTmuxPaste(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['i']);
  iso.tmux(['paste-buffer', '-t', target]);
  await waitForPaneSettled();
  sendKeys(iso, target, ['Escape']);
  await waitForPaneSettled();
}

async function vimLikeWriteBuffer(
  iso: IsolatedTmux,
  target: string,
  outputPath: string,
): Promise<void> {
  sendKeys(iso, target, ['Escape', ':']);
  sendLiteral(iso, target, `silent! write! ${outputPath}`);
  sendKeys(iso, target, ['Enter']);
  await waitForPaneSettled();
}

async function vimLikeQuit(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['Escape', ':', 'q', '!', 'Enter']);
  await waitForPaneSettled();
}

async function emacsInsertLine(iso: IsolatedTmux, target: string, text: string): Promise<void> {
  sendLiteral(iso, target, text);
  await waitForPaneSettled();
}

async function emacsVisualYankLine(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['C-a', 'C-Space', 'C-e', 'M-w']);
  await waitForPaneSettled();
}

async function emacsNormalPaste(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['C-y']);
  await waitForPaneSettled();
}

async function emacsPasteTmuxBuffer(iso: IsolatedTmux, target: string): Promise<void> {
  iso.tmux(['paste-buffer', '-t', target]);
  await waitForPaneSettled();
}

async function emacsWriteBuffer(iso: IsolatedTmux, target: string, outputPath: string): Promise<void> {
  sendKeys(iso, target, ['C-x', 'C-w']);
  sendLiteral(iso, target, outputPath);
  sendKeys(iso, target, ['Enter']);
  await waitForPaneSettled();
}

async function emacsQuit(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['C-x', 'C-c']);
  await waitForPaneSettled();
}

async function helixInsertLine(iso: IsolatedTmux, target: string, text: string): Promise<void> {
  sendKeys(iso, target, ['i']);
  sendLiteral(iso, target, text);
  sendKeys(iso, target, ['Escape']);
  await waitForPaneSettled();
}

async function helixVisualYankLine(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['x', 'y']);
  await waitForPaneSettled();
}

async function helixNormalPaste(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['p']);
  await waitForPaneSettled();
}

async function helixPasteTmuxBuffer(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['i']);
  iso.tmux(['paste-buffer', '-t', target]);
  await waitForPaneSettled();
  sendKeys(iso, target, ['Escape']);
  await waitForPaneSettled();
}

async function helixWriteBuffer(iso: IsolatedTmux, target: string, outputPath: string): Promise<void> {
  const panePath = iso.tmux(['display-message', '-p', '-t', target, '#{pane_current_path}']).trim();
  const filename = path.basename(outputPath);
  const paneOutputPath = path.join(panePath, filename);
  sendKeys(iso, target, [':']);
  sendLiteral(iso, target, `write ${filename}`);
  sendKeys(iso, target, ['Enter']);
  await waitForPaneSettled();
  if (paneOutputPath !== outputPath && fs.existsSync(paneOutputPath)) {
    fs.copyFileSync(paneOutputPath, outputPath);
  }
}

async function helixQuit(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, [':']);
  sendLiteral(iso, target, 'quit!');
  sendKeys(iso, target, ['Enter']);
  await waitForPaneSettled();
}

async function expectEditorBufferContains(
  iso: IsolatedTmux,
  target: string,
  outputPath: string,
  expected: string,
): Promise<void> {
  const command = iso.tmux(['display-message', '-p', '-t', target, '#{pane_current_command}']).trim();
  const editor = EDITORS.find(candidate => candidate.commandName === command);
  if (!editor) throw new Error(`Unknown editor command ${command}`);
  await editor.writeBuffer(iso, target, outputPath);
  await expect.poll(() => {
    try {
      return fs.readFileSync(outputPath, 'utf8');
    } catch {
      return '';
    }
  }, { timeout: 5_000 }).toContain(expected);
}

async function copyCurrentPaneLineWithTmuxCopyMode(
  iso: IsolatedTmux,
  target: string,
  expected: string,
): Promise<void> {
  iso.tmux(['copy-mode', '-t', target]);
  iso.tmux(['send-keys', '-t', target, '-X', 'history-top']);
  iso.tmux(['send-keys', '-t', target, '-X', 'start-of-line']);
  iso.tmux(['send-keys', '-t', target, '-X', 'begin-selection']);
  iso.tmux(['send-keys', '-t', target, '-X', 'end-of-line']);
  iso.tmux(['send-keys', '-t', target, '-X', 'copy-selection-and-cancel']);
  await expect.poll(() => showBufferOrEmpty(iso).trim(), { timeout: 5_000 }).toBe(expected);
}

async function copyFromEditor(
  iso: IsolatedTmux,
  target: string,
  text: string,
): Promise<void> {
  const command = iso.tmux(['display-message', '-p', '-t', target, '#{pane_current_command}']).trim();
  const editor = EDITORS.find(candidate => candidate.commandName === command);
  if (!editor) throw new Error(`Unknown editor command ${command}`);
  await editor.insertLine(iso, target, text);
  await editor.visualYankLine(iso, target);
  await expect.poll(() => showBufferOrEmpty(iso).trim(), { timeout: 5_000 }).toBe(text);
}

async function pasteTmuxBufferIntoCatAndExpect(
  iso: IsolatedTmux,
  target: string,
  expected: string,
): Promise<void> {
  iso.tmux(['paste-buffer', '-t', target]);
  await expect.poll(() => iso.tmux(['capture-pane', '-p', '-t', target]), { timeout: 5_000 })
    .toContain(expected);
}

type Mode = 'tmux-web pty' | 'direct tmux';

function startExternalTmuxClient(iso: IsolatedTmux, session: string): ChildProcess {
  const command = `tmux -S ${shellSingleQuote(iso.socketPath)} attach-session -t ${shellSingleQuote(session)}`;
  return spawn('script', ['-qfec', command, '/dev/null'], {
    stdio: 'ignore',
    detached: true,
  });
}

async function maybeConnect(
  mode: Mode,
  page: Page,
  iso: IsolatedTmux,
  testInfo: TestInfo,
  session: string,
  offset: number,
): Promise<ChildProcess | undefined> {
  if (mode === 'direct tmux') {
    const client = startExternalTmuxClient(iso, session);
    await waitForPaneSettled();
    return client;
  }
  return connectTmuxWeb(page, iso, testInfo, session, offset);
}

for (const editor of EDITORS) {
  test.describe(`${editor.label} clipboard matrix`, () => {
    test.skip(!hasCommand(editor.command), `${editor.label} not available`);

    const editorPortOffset = editor.kind === 'nvim' ? 0 : editor.kind === 'vim' ? 50 : editor.kind === 'emacs' ? 100 : 150;
    const editorText = (suffix: string) => `${editor.kind.toUpperCase()}_${suffix}`;

    test(`via tmux-web: copy in OS, paste in ${editor.label} with p`, async ({ page }, testInfo) => {
      const iso = createIsolatedTmux(`tw-clip-os-${editor.kind}`);
      const init = writeEditorInit(editor);
      let server: Awaited<ReturnType<typeof startServer>> | undefined;
      const out = path.join(init.dir, 'out.txt');
      try {
        startEditorSession(iso, editor, 'main', init.path);
        await waitForPaneSettled();
        server = await connectTmuxWeb(page, iso, testInfo, 'main', editorPortOffset, editorText('OS_TO_EDITOR_P'));
        await mirrorOsClipboardToTmuxBuffer(page, iso, editorText('OS_TO_EDITOR_P'));
        await editor.normalPaste(iso, 'main');
        await expectEditorBufferContains(iso, 'main', out, editorText('OS_TO_EDITOR_P'));
      } finally {
        if (server) killServer(server);
        iso.cleanup();
        fs.rmSync(init.dir, { recursive: true, force: true });
      }
    });

    test(`via tmux-web: copy in OS, paste in ${editor.label} with browser paste`, async ({ page }, testInfo) => {
      const iso = createIsolatedTmux(`tw-clip-os-browser-${editor.kind}`);
      const init = writeEditorInit(editor);
      let server: Awaited<ReturnType<typeof startServer>> | undefined;
      const out = path.join(init.dir, 'out.txt');
      try {
        startEditorSession(iso, editor, 'main', init.path);
        await waitForPaneSettled();
        server = await connectTmuxWeb(page, iso, testInfo, 'main', editorPortOffset + 2, editorText('OS_BROWSER_TO_EDITOR'));
        await waitForPaneCommand(iso, 'main', editor.commandName);
        if (editor.kind !== 'emacs') sendKeys(iso, 'main', ['i']);
        await browserPasteText(page, editorText('OS_BROWSER_TO_EDITOR'));
        await waitForPaneSettled();
        if (editor.kind !== 'emacs') sendKeys(iso, 'main', ['Escape']);
        await expectEditorBufferContains(iso, 'main', out, editorText('OS_BROWSER_TO_EDITOR'));
      } finally {
        if (server) killServer(server);
        iso.cleanup();
        fs.rmSync(init.dir, { recursive: true, force: true });
      }
    });

    test(`via tmux-web: copy in ${editor.label} with visual select and y, paste in OS`, async ({ page }, testInfo) => {
      const iso = createIsolatedTmux(`tw-clip-${editor.kind}-os`);
      const init = writeEditorInit(editor);
      let server: Awaited<ReturnType<typeof startServer>> | undefined;
      try {
        startEditorSession(iso, editor, 'main', init.path);
        await waitForPaneSettled();
        server = await connectTmuxWeb(page, iso, testInfo, 'main', editorPortOffset + 4);
        await copyFromEditor(iso, 'main', editorText('COPY_TO_OS'));
        await expectOsClipboard(page, editorText('COPY_TO_OS'));
      } finally {
        if (server) killServer(server);
        iso.cleanup();
        fs.rmSync(init.dir, { recursive: true, force: true });
      }
    });

    test(`outside tmux: copy in ${editor.label} with visual select and y, paste in same ${editor.label} with p`, async () => {
      const init = writeEditorInit(editor);
      const out = path.join(init.dir, `outside-${editor.kind}.txt`);
      const text = editorText('OUTSIDE_TMUX_COPY');
      try {
        await editor.outsideCopyPaste(init.path, out, text);
        await expect.poll(() => {
          try {
            return fs.readFileSync(out, 'utf8');
          } catch {
            return '';
          }
        }, { timeout: 5_000 }).toContain(text);
      } finally {
        fs.rmSync(init.dir, { recursive: true, force: true });
      }
    });

    for (const mode of ['tmux-web pty', 'direct tmux'] as const) {
      const modeOffset = (mode === 'tmux-web pty' ? 10 : 40) + editorPortOffset;

      test(`${mode}: copy in tmux copy-mode, paste in ${editor.label} with p`, async ({ page }, testInfo) => {
        const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-copy-${editor.kind}`);
        const init = writeEditorInit(editor);
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        const out = path.join(init.dir, 'out.txt');
        try {
          startShellSessionWithText(iso, 'source', editorText('TMUX_COPY_TO_EDITOR'));
          server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset);
          await copyCurrentPaneLineWithTmuxCopyMode(iso, 'source:1', editorText('TMUX_COPY_TO_EDITOR'));
          await launchEditorInExistingSession(iso, editor, 'source', init.path);
          await editor.normalPaste(iso, 'source');
          await expectEditorBufferContains(iso, 'source', out, editorText('TMUX_COPY_TO_EDITOR'));
        } finally {
          if (server) killServer(server);
          iso.cleanup();
          fs.rmSync(init.dir, { recursive: true, force: true });
        }
      });

      test(`${mode}: copy in tmux copy-mode, paste in ${editor.label} in another tmux session with p`, async ({ page }, testInfo) => {
        const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-copy-other-${editor.kind}`);
        const init = writeEditorInit(editor);
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        const out = path.join(init.dir, 'out.txt');
        try {
          startShellSessionWithText(iso, 'source', editorText('TMUX_COPY_OTHER_EDITOR'));
          startEditorSession(iso, editor, 'target', init.path);
          await waitForPaneSettled();
          server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 3);
          await copyCurrentPaneLineWithTmuxCopyMode(iso, 'source:1', editorText('TMUX_COPY_OTHER_EDITOR'));
          await editor.normalPaste(iso, 'target');
          await expectEditorBufferContains(iso, 'target', out, editorText('TMUX_COPY_OTHER_EDITOR'));
        } finally {
          if (server) killServer(server);
          iso.cleanup();
          fs.rmSync(init.dir, { recursive: true, force: true });
        }
      });

      test(`${mode}: copy in ${editor.label} with visual select and y, paste in same ${editor.label} with p`, async ({ page }, testInfo) => {
        const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-${editor.kind}-same`);
        const init = writeEditorInit(editor);
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        const out = path.join(init.dir, 'out.txt');
        try {
          startEditorSession(iso, editor, 'main', init.path);
          await waitForPaneSettled();
          server = await maybeConnect(mode, page, iso, testInfo, 'main', modeOffset + 4);
          await copyFromEditor(iso, 'main', editorText('COPY_SAME_P'));
          await editor.normalPaste(iso, 'main');
          await expectEditorBufferContains(iso, 'main', out, editorText('COPY_SAME_P'));
        } finally {
          if (server) killServer(server);
          iso.cleanup();
          fs.rmSync(init.dir, { recursive: true, force: true });
        }
      });

      test(`${mode}: copy in ${editor.label} with visual select and y, paste in same ${editor.label} using tmux paste-buffer`, async ({ page }, testInfo) => {
        const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-${editor.kind}-tmux`);
        const init = writeEditorInit(editor);
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        const out = path.join(init.dir, 'out.txt');
        try {
          startEditorSession(iso, editor, 'main', init.path);
          await waitForPaneSettled();
          server = await maybeConnect(mode, page, iso, testInfo, 'main', modeOffset + 5);
          await copyFromEditor(iso, 'main', editorText('COPY_SAME_TMUX'));
          await editor.pasteTmuxBuffer(iso, 'main');
          await expectEditorBufferContains(iso, 'main', out, editorText('COPY_SAME_TMUX'));
        } finally {
          if (server) killServer(server);
          iso.cleanup();
          fs.rmSync(init.dir, { recursive: true, force: true });
        }
      });

      test(`${mode}: copy in ${editor.label} with visual select and y, paste in relaunched ${editor.label} with p in the same tmux session`, async ({ page }, testInfo) => {
        const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-${editor.kind}-relaunch`);
        const init = writeEditorInit(editor);
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        const out = path.join(init.dir, 'out.txt');
        try {
          startShellSession(iso, 'main');
          await waitForPaneSettled();
          await launchEditorInExistingSession(iso, editor, 'main', init.path);
          server = await maybeConnect(mode, page, iso, testInfo, 'main', modeOffset + 6);
          await copyFromEditor(iso, 'main', editorText('COPY_RELAUNCH_P'));
          await editor.quit(iso, 'main');
          await launchEditorInExistingSession(iso, editor, 'main', init.path);
          await editor.normalPaste(iso, 'main');
          await expectEditorBufferContains(iso, 'main', out, editorText('COPY_RELAUNCH_P'));
        } finally {
          if (server) killServer(server);
          iso.cleanup();
          fs.rmSync(init.dir, { recursive: true, force: true });
        }
      });

      test(`${mode}: copy in ${editor.label} with visual select and y, paste in a different tmux session with paste-buffer`, async ({ page }, testInfo) => {
        const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-${editor.kind}-other`);
        const init = writeEditorInit(editor);
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        try {
          startEditorSession(iso, editor, 'source', init.path);
          startCatSession(iso, 'target');
          await waitForPaneSettled();
          server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 7);
          await copyFromEditor(iso, 'source', editorText('COPY_OTHER_TMUX'));
          await pasteTmuxBufferIntoCatAndExpect(iso, 'target', editorText('COPY_OTHER_TMUX'));
        } finally {
          if (server) killServer(server);
          iso.cleanup();
          fs.rmSync(init.dir, { recursive: true, force: true });
        }
      });

      test(`${mode}: copy in ${editor.label} with visual select and y, paste in ${editor.label} in a different tmux session using paste-buffer`, async ({ page }, testInfo) => {
        const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-${editor.kind}-other-${editor.kind}`);
        const init = writeEditorInit(editor);
        let server: Awaited<ReturnType<typeof startServer>> | undefined;
        const out = path.join(init.dir, 'out.txt');
        try {
          startEditorSession(iso, editor, 'source', init.path);
          startEditorSession(iso, editor, 'target', init.path);
          await waitForPaneSettled();
          server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 8);
          await copyFromEditor(iso, 'source', editorText('COPY_OTHER_EDITOR'));
          await editor.pasteTmuxBuffer(iso, 'target');
          await expectEditorBufferContains(iso, 'target', out, editorText('COPY_OTHER_EDITOR'));
        } finally {
          if (server) killServer(server);
          iso.cleanup();
          fs.rmSync(init.dir, { recursive: true, force: true });
        }
      });
    }
  });
}

test('via tmux-web: copy in OS, paste with tmux paste-buffer', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-os-tmux');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    startCatSession(iso, 'main');
    server = await connectTmuxWeb(page, iso, testInfo, 'main', 1, 'OS_TO_TMUX_PASTE');
    await mirrorOsClipboardToTmuxBuffer(page, iso, 'OS_TO_TMUX_PASTE');
    await pasteTmuxBufferIntoCatAndExpect(iso, 'main', 'OS_TO_TMUX_PASTE');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
  }
});

test('via tmux-web: copy in tmux copy-mode, paste in OS', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-copy-os');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    startShellSessionWithText(iso, 'main', 'TMUX_COPY_TO_OS');
    server = await connectTmuxWeb(page, iso, testInfo, 'main', 3);
    await copyCurrentPaneLineWithTmuxCopyMode(iso, 'main:1', 'TMUX_COPY_TO_OS');
    await expectOsClipboard(page, 'TMUX_COPY_TO_OS');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
  }
});

test('via tmux-web: mouse-select pane text in tmux copy-mode, paste in OS', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-mouse-copy-os');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    startShellSessionWithText(iso, 'main', 'TMUX_MOUSE_TO_OS');
    server = await connectTmuxWeb(page, iso, testInfo, 'main', 5);
    await mouseCopyTerminalText(page, iso, 'TMUX_MOUSE_TO_OS');
    await expectOsClipboard(page, 'TMUX_MOUSE_TO_OS');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
  }
});

test('via tmux-web: mouse-select pane text in tmux copy-mode, paste in tmux', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-mouse-copy-tmux');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    startShellSessionWithText(iso, 'source', 'TMUX_MOUSE_TO_TMUX');
    startCatSession(iso, 'target');
    server = await connectTmuxWeb(page, iso, testInfo, 'source', 7);
    await mouseCopyTerminalText(page, iso, 'TMUX_MOUSE_TO_TMUX');
    await pasteTmuxBufferIntoCatAndExpect(iso, 'target', 'TMUX_MOUSE_TO_TMUX');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
  }
});

for (const mode of ['tmux-web pty', 'direct tmux'] as const) {
  const modeOffset = mode === 'tmux-web pty' ? 10 : 40;

  test(`${mode}: copy in tmux copy-mode, paste in the same tmux session with paste-buffer`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-copy-same`);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      startShellSessionWithText(iso, 'main', 'TMUX_COPY_SAME_TMUX');
      server = await maybeConnect(mode, page, iso, testInfo, 'main', modeOffset + 1);
      await copyCurrentPaneLineWithTmuxCopyMode(iso, 'main:1', 'TMUX_COPY_SAME_TMUX');
      await pasteTmuxBufferIntoCatAndExpect(iso, 'main', 'TMUX_COPY_SAME_TMUX');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
    }
  });

  test(`${mode}: copy in tmux copy-mode, paste in another tmux session with paste-buffer`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-copy-other`);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      startShellSessionWithText(iso, 'source', 'TMUX_COPY_OTHER_TMUX');
      startCatSession(iso, 'target');
      server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 2);
      await copyCurrentPaneLineWithTmuxCopyMode(iso, 'source:1', 'TMUX_COPY_OTHER_TMUX');
      await pasteTmuxBufferIntoCatAndExpect(iso, 'target', 'TMUX_COPY_OTHER_TMUX');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
    }
  });
}
