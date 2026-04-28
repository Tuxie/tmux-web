import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { injectWsSpy, mockApis, waitForWsOpen, startServer, killServer, createIsolatedTmux, hasTmux } from './helpers.js';

const REAL_TMUX_PORTS = {
  da: 6120,
  xtversion: 6121,
} as const;

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
}

async function sendProbeThroughPty(page: import('@playwright/test').Page, probe: string): Promise<void> {
  // Test mode uses `cat` as the PTY child. The trailing newline flushes
  // canonical input so cat echoes the probe back to xterm.js for parsing.
  await page.evaluate((seq) => {
    (window as any).__wsInstance.send(seq + '\n');
  }, probe);
}

async function terminalBufferText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const term = (window as any).__adapter?.term;
    const buffer = term?.buffer?.active;
    if (!buffer) return '';
    const lines: string[] = [];
    for (let y = 0; y < buffer.length; y++) {
      lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  });
}

test('xterm.js answers Secondary DA probes on the input WebSocket path', async ({ page }) => {
  await boot(page);

  await sendProbeThroughPty(page, '\x1b[>c');

  await page.waitForFunction(
    () => (window as any).__wsSent.includes('\x1b[>0;276;0c'),
    { timeout: 5000 },
  );
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain('\x1b[>0;276;0c');
  await expect.poll(() => terminalBufferText(page), { timeout: 1000 }).not.toContain('0;276;0c');
});

test('xterm.js answers XTVERSION probes on the input WebSocket path', async ({ page }) => {
  await boot(page);

  await sendProbeThroughPty(page, '\x1b[>q');

  await page.waitForFunction(
    () => (window as any).__wsSent.some((m: string) =>
      m.startsWith('\x1bP>|xterm.js(') && m.endsWith('\x1b\\')),
    { timeout: 5000 },
  );
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain('\x1bP>|xterm.js(6.0.0)\x1b\\');
  await expect.poll(() => terminalBufferText(page), { timeout: 1000 }).not.toContain('>|xterm.js(');
});

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function writeProbeReaderScript(dir: string): string {
  const scriptPath = path.join(dir, 'read-terminal-identity-reply.sh');
  fs.writeFileSync(scriptPath, `#!/usr/bin/env bash
set -u

kind="$1"
out="$2"
count="$3"

case "$kind" in
  da) probe=$'\\033[>c' ;;
  xtversion) probe=$'\\033[>q' ;;
  *) exit 64 ;;
esac

: > "$out"
old="$(stty -g 2>/dev/null || true)"
cleanup() {
  if [ -n "$old" ]; then stty "$old" 2>/dev/null || true; fi
}
trap cleanup EXIT

stty raw -echo min 0 time 50 2>/dev/null || true
printf '%s' "$probe"

i=0
while [ "$i" -lt "$count" ]; do
  if IFS= read -r -s -n 1 -t 5 ch; then
    printf '%s' "$ch" >> "$out"
    i=$((i + 1))
  else
    break
  fi
done
`, { mode: 0o755 });
  return scriptPath;
}

async function expectProbeReplyFromRealTmux(
  page: import('@playwright/test').Page,
  kind: keyof typeof REAL_TMUX_PORTS,
  expected: (isolatedTmux: ReturnType<typeof createIsolatedTmux>) => string,
): Promise<void> {
  test.skip(!hasTmux(), 'tmux not available');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), `tw-real-tmux-identity-${kind}-`));
  const scriptPath = writeProbeReaderScript(root);
  const outputPath = path.join(root, `${kind}.reply`);
  const isolatedTmux = createIsolatedTmux(`tw-real-tmux-identity-${kind}`);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    isolatedTmux.tmux(['new-session', '-d', '-s', 'main']);
    const paneId = isolatedTmux.tmux(['display-message', '-p', '-t', 'main', '#{pane_id}']).trim();
    const expectedReply = expected(isolatedTmux);

    server = await startServer('bun', [
      'src/server/index.ts',
      '--listen', `127.0.0.1:${REAL_TMUX_PORTS[kind]}`,
      '--no-auth', '--no-tls',
      '--tmux', isolatedTmux.wrapperPath,
    ]);

    await page.goto(`http://127.0.0.1:${REAL_TMUX_PORTS[kind]}/main`);
    await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 10000 });

    const command = [
      shellSingleQuote(scriptPath),
      kind,
      shellSingleQuote(outputPath),
      String(expectedReply.length),
    ].join(' ');
    isolatedTmux.tmux(['send-keys', '-t', paneId, 'C-u', command, 'C-m']);

    await expect.poll(() => {
      if (!fs.existsSync(outputPath)) return '';
      return fs.readFileSync(outputPath, 'utf8');
    }, { timeout: 8000 }).toBe(expectedReply);
  } finally {
    if (server) killServer(server);
    isolatedTmux.cleanup();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

test('real isolated tmux pane receives tmux Secondary DA reply', async ({ page }) => {
  await expectProbeReplyFromRealTmux(page, 'da', () => '\x1b[>84;0;0c');
});

test('real isolated tmux pane receives tmux XTVERSION reply', async ({ page }) => {
  await expectProbeReplyFromRealTmux(page, 'xtversion', isolatedTmux =>
    `\x1bP>|${isolatedTmux.tmux(['-V']).trim()}\x1b\\`);
});
