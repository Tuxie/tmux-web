/**
 * End-to-end clipboard matrix for tmux-web, real tmux, Neovim
 * `clipboard=unnamedplus`, and the browser/OS clipboard bridge.
 *
 * All rows use createIsolatedTmux(), which loads the project tmux.conf with
 * only source-file lines stripped. All Neovim rows use the single NVIM_INIT
 * constant below. No row mutates tmux or Neovim settings for a special case.
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

function hasNvim(): boolean {
  try {
    execFileSync('nvim', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test.skip(!hasNvim(), 'Neovim not available');

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
vim.o.mouse = ''
vim.o.swapfile = false
vim.o.shortmess = vim.o.shortmess .. 'I'
`;

interface NvimInit {
  dir: string;
  path: string;
}

function writeNvimInit(): NvimInit {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-clip-matrix-nvim-'));
  const initPath = path.join(dir, 'init.lua');
  fs.writeFileSync(initPath, NVIM_INIT);
  return { dir, path: initPath };
}

async function termReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 12_000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 12_000 });
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

function startNvimSession(iso: IsolatedTmux, session: string, initPath: string): void {
  iso.tmux([
    'new-session',
    '-d',
    '-s',
    session,
    `nvim --clean --cmd ${shellSingleQuote(`luafile ${initPath}`)}`,
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

async function launchNvimInExistingSession(
  iso: IsolatedTmux,
  target: string,
  initPath: string,
): Promise<void> {
  iso.tmux(['send-keys', '-t', target, `nvim --clean --cmd ${shellSingleQuote(`luafile ${initPath}`)}`, 'Enter']);
  await waitForPaneCommand(iso, target, 'nvim');
}

async function nvimInsertLine(iso: IsolatedTmux, target: string, text: string): Promise<void> {
  sendKeys(iso, target, ['i']);
  sendLiteral(iso, target, text);
  sendKeys(iso, target, ['Escape']);
  await waitForPaneSettled();
}

async function nvimVisualYankLine(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['0', 'v', '$', 'y']);
  await waitForPaneSettled();
}

async function nvimNormalPaste(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['p']);
  await waitForPaneSettled();
}

async function nvimInsertModeTmuxPaste(iso: IsolatedTmux, target: string): Promise<void> {
  sendKeys(iso, target, ['i']);
  iso.tmux(['paste-buffer', '-t', target]);
  await waitForPaneSettled();
  sendKeys(iso, target, ['Escape']);
  await waitForPaneSettled();
}

async function writeNvimBuffer(
  iso: IsolatedTmux,
  target: string,
  outputPath: string,
): Promise<void> {
  sendKeys(iso, target, ['Escape', ':']);
  sendLiteral(iso, target, `silent! write! ${outputPath}`);
  sendKeys(iso, target, ['Enter']);
  await waitForPaneSettled();
}

async function expectNvimBufferContains(
  iso: IsolatedTmux,
  target: string,
  outputPath: string,
  expected: string,
): Promise<void> {
  await writeNvimBuffer(iso, target, outputPath);
  await expect.poll(() => {
    try {
      return fs.readFileSync(outputPath, 'utf8');
    } catch {
      return '';
    }
  }, { timeout: 5_000 }).toContain(expected);
}

async function copyFromTmuxCopyMode(
  iso: IsolatedTmux,
  target: string,
  text: string,
): Promise<void> {
  startCatSession(iso, target, text);
  await waitForPaneSettled();
  iso.tmux(['copy-mode', '-t', `${target}:1`]);
  iso.tmux(['send-keys', '-t', `${target}:1`, '-X', 'history-top']);
  iso.tmux(['send-keys', '-t', `${target}:1`, '-X', 'start-of-line']);
  iso.tmux(['send-keys', '-t', `${target}:1`, '-X', 'begin-selection']);
  iso.tmux(['send-keys', '-t', `${target}:1`, '-X', 'end-of-line']);
  iso.tmux(['send-keys', '-t', `${target}:1`, '-X', 'copy-selection-and-cancel']);
  await waitForPaneSettled();
  expect(showBufferOrEmpty(iso).trim()).toBe(text);
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

async function copyFromNvim(
  iso: IsolatedTmux,
  target: string,
  text: string,
): Promise<void> {
  await nvimInsertLine(iso, target, text);
  await nvimVisualYankLine(iso, target);
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

test('via tmux-web: copy in OS, paste in nvim with p', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-os-nvim');
  const init = writeNvimInit();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const out = path.join(init.dir, 'out.txt');
  try {
    startNvimSession(iso, 'main', init.path);
    await waitForPaneSettled();
    server = await connectTmuxWeb(page, iso, testInfo, 'main', 0, 'OS_TO_NVIM_P');
    await mirrorOsClipboardToTmuxBuffer(page, iso, 'OS_TO_NVIM_P');
    await nvimNormalPaste(iso, 'main');
    await expectNvimBufferContains(iso, 'main', out, 'OS_TO_NVIM_P');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
    fs.rmSync(init.dir, { recursive: true, force: true });
  }
});

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

test('via tmux-web: copy in OS, paste in nvim with browser paste', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-os-browser-nvim');
  const init = writeNvimInit();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const out = path.join(init.dir, 'out.txt');
  try {
    startNvimSession(iso, 'main', init.path);
    await waitForPaneSettled();
    server = await connectTmuxWeb(page, iso, testInfo, 'main', 2, 'OS_BROWSER_TO_NVIM');
    await waitForPaneCommand(iso, 'main', 'nvim');
    sendKeys(iso, 'main', ['i']);
    await browserPasteText(page, 'OS_BROWSER_TO_NVIM');
    await waitForPaneSettled();
    sendKeys(iso, 'main', ['Escape']);
    await expectNvimBufferContains(iso, 'main', out, 'OS_BROWSER_TO_NVIM');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
    fs.rmSync(init.dir, { recursive: true, force: true });
  }
});

test('via tmux-web: copy in tmux copy-mode, paste in OS', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-copy-os');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    startCatSession(iso, 'main', 'TMUX_COPY_TO_OS');
    server = await connectTmuxWeb(page, iso, testInfo, 'main', 3);
    await copyCurrentPaneLineWithTmuxCopyMode(iso, 'main:1', 'TMUX_COPY_TO_OS');
    await expectOsClipboard(page, 'TMUX_COPY_TO_OS');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
  }
});

test('via tmux-web: copy in nvim with visual select and y, paste in OS', async ({ page }, testInfo) => {
  const iso = createIsolatedTmux('tw-clip-nvim-os');
  const init = writeNvimInit();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    startNvimSession(iso, 'main', init.path);
    await waitForPaneSettled();
    server = await connectTmuxWeb(page, iso, testInfo, 'main', 4);
    await copyFromNvim(iso, 'main', 'NVIM_COPY_TO_OS');
    await expectOsClipboard(page, 'NVIM_COPY_TO_OS');
  } finally {
    if (server) killServer(server);
    iso.cleanup();
    fs.rmSync(init.dir, { recursive: true, force: true });
  }
});

for (const mode of ['tmux-web pty', 'direct tmux'] as const) {
  const modeOffset = mode === 'tmux-web pty' ? 10 : 40;

  test(`${mode}: copy in tmux copy-mode, paste in nvim with p`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-copy-nvim`);
    const init = writeNvimInit();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const out = path.join(init.dir, 'out.txt');
    try {
      startShellSessionWithText(iso, 'source', 'TMUX_COPY_TO_NVIM');
      server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset);
      await copyCurrentPaneLineWithTmuxCopyMode(iso, 'source:1', 'TMUX_COPY_TO_NVIM');
      await launchNvimInExistingSession(iso, 'source', init.path);
      await nvimNormalPaste(iso, 'source');
      await expectNvimBufferContains(iso, 'source', out, 'TMUX_COPY_TO_NVIM');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
      fs.rmSync(init.dir, { recursive: true, force: true });
    }
  });

  test(`${mode}: copy in tmux copy-mode, paste in the same tmux session with paste-buffer`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-copy-same`);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      startCatSession(iso, 'main', 'TMUX_COPY_SAME_TMUX');
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
      startCatSession(iso, 'source', 'TMUX_COPY_OTHER_TMUX');
      startCatSession(iso, 'target');
      server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 2);
      await copyCurrentPaneLineWithTmuxCopyMode(iso, 'source:1', 'TMUX_COPY_OTHER_TMUX');
      await pasteTmuxBufferIntoCatAndExpect(iso, 'target', 'TMUX_COPY_OTHER_TMUX');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
    }
  });

  test(`${mode}: copy in tmux copy-mode, paste in nvim in another tmux session with p`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-copy-other-nvim`);
    const init = writeNvimInit();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const out = path.join(init.dir, 'out.txt');
    try {
      startCatSession(iso, 'source', 'TMUX_COPY_OTHER_NVIM');
      startNvimSession(iso, 'target', init.path);
      await waitForPaneSettled();
      server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 3);
      await copyCurrentPaneLineWithTmuxCopyMode(iso, 'source:1', 'TMUX_COPY_OTHER_NVIM');
      await nvimNormalPaste(iso, 'target');
      await expectNvimBufferContains(iso, 'target', out, 'TMUX_COPY_OTHER_NVIM');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
      fs.rmSync(init.dir, { recursive: true, force: true });
    }
  });

  test(`${mode}: copy in nvim with visual select and y, paste in same nvim with p`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-nvim-same`);
    const init = writeNvimInit();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const out = path.join(init.dir, 'out.txt');
    try {
      startNvimSession(iso, 'main', init.path);
      await waitForPaneSettled();
      server = await maybeConnect(mode, page, iso, testInfo, 'main', modeOffset + 4);
      await copyFromNvim(iso, 'main', 'NVIM_COPY_SAME_P');
      await nvimNormalPaste(iso, 'main');
      await expectNvimBufferContains(iso, 'main', out, 'NVIM_COPY_SAME_P');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
      fs.rmSync(init.dir, { recursive: true, force: true });
    }
  });

  test(`${mode}: copy in nvim with visual select and y, paste in same nvim using tmux paste-buffer`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-nvim-tmux`);
    const init = writeNvimInit();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const out = path.join(init.dir, 'out.txt');
    try {
      startNvimSession(iso, 'main', init.path);
      await waitForPaneSettled();
      server = await maybeConnect(mode, page, iso, testInfo, 'main', modeOffset + 5);
      await copyFromNvim(iso, 'main', 'NVIM_COPY_SAME_TMUX');
      await nvimInsertModeTmuxPaste(iso, 'main');
      await expectNvimBufferContains(iso, 'main', out, 'NVIM_COPY_SAME_TMUX');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
      fs.rmSync(init.dir, { recursive: true, force: true });
    }
  });

  test(`${mode}: copy in nvim with visual select and y, paste in relaunched nvim with p in the same tmux session`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-nvim-relaunch`);
    const init = writeNvimInit();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const out = path.join(init.dir, 'out.txt');
    try {
      if (mode === 'direct tmux') {
        startShellSession(iso, 'main');
        await waitForPaneSettled();
        await launchNvimInExistingSession(iso, 'main', init.path);
      } else {
        startNvimSession(iso, 'main', init.path);
        await waitForPaneSettled();
      }
      server = await maybeConnect(mode, page, iso, testInfo, 'main', modeOffset + 6);
      await copyFromNvim(iso, 'main', 'NVIM_COPY_RELAUNCH_P');
      sendKeys(iso, 'main', ['Escape', ':', 'q', '!', 'Enter']);
      await waitForPaneSettled();
      if (mode === 'direct tmux') {
        await launchNvimInExistingSession(iso, 'main', init.path);
      } else {
        iso.tmux(['respawn-pane', '-k', '-t', 'main:1', `nvim --clean --cmd ${shellSingleQuote(`luafile ${init.path}`)}`]);
        await waitForPaneCommand(iso, 'main', 'nvim');
      }
      await nvimNormalPaste(iso, 'main');
      await expectNvimBufferContains(iso, 'main', out, 'NVIM_COPY_RELAUNCH_P');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
      fs.rmSync(init.dir, { recursive: true, force: true });
    }
  });

  test(`${mode}: copy in nvim with visual select and y, paste in a different tmux session with paste-buffer`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-nvim-other`);
    const init = writeNvimInit();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      startNvimSession(iso, 'source', init.path);
      startCatSession(iso, 'target');
      await waitForPaneSettled();
      server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 7);
      await copyFromNvim(iso, 'source', 'NVIM_COPY_OTHER_TMUX');
      await pasteTmuxBufferIntoCatAndExpect(iso, 'target', 'NVIM_COPY_OTHER_TMUX');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
      fs.rmSync(init.dir, { recursive: true, force: true });
    }
  });

  test(`${mode}: copy in nvim with visual select and y, paste in nvim in a different tmux session using paste-buffer`, async ({ page }, testInfo) => {
    const iso = createIsolatedTmux(`tw-clip-${mode === 'tmux-web pty' ? 'web' : 'direct'}-nvim-other-nvim`);
    const init = writeNvimInit();
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    const out = path.join(init.dir, 'out.txt');
    try {
      startNvimSession(iso, 'source', init.path);
      startNvimSession(iso, 'target', init.path);
      await waitForPaneSettled();
      server = await maybeConnect(mode, page, iso, testInfo, 'source', modeOffset + 8);
      await copyFromNvim(iso, 'source', 'NVIM_COPY_OTHER_NVIM');
      await nvimInsertModeTmuxPaste(iso, 'target');
      await expectNvimBufferContains(iso, 'target', out, 'NVIM_COPY_OTHER_NVIM');
    } finally {
      if (server) killServer(server);
      iso.cleanup();
      fs.rmSync(init.dir, { recursive: true, force: true });
    }
  });
}
