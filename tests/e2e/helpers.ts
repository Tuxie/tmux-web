import type { Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';

const helpersDir = path.dirname(fileURLToPath(import.meta.url));
const bundledThemesFixtureDir = path.resolve(helpersDir, '../fixtures/themes-bundled');

export interface IsolatedTmux {
  socketPath: string;
  wrapperPath: string;
  tmuxConfPath: string;
  tmux(args: string[]): string;
  cleanup(): void;
}

export function hasTmux(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const e2eDefaultTmuxConf = path.resolve(helpersDir, '../../tmux.conf');

/** Create a copy of the production tmux.conf with all `source-file` lines
 *  removed, so test-runner user overrides don't leak into the isolated
 *  server.  Also switches `set-clipboard` from `external` to `on` because
 *  Emacs' `send-string-to-terminal` only triggers tmux OSC-52 capture
 *  under `on` mode.  Returns the path to the sanitised temp file. */
function sanitisedTmuxConf(originalPath: string, destDir: string): string | null {
  if (!fs.existsSync(originalPath)) return null;
  const raw = fs.readFileSync(originalPath, 'utf-8');
  const stripped = raw.split('\n')
    .filter(line => !line.trimStart().startsWith('source-file'))
    .map(line => line === 'set -s set-clipboard external'
      ? 'set -s set-clipboard on'
      : line)
    .join('\n');
  const dest = path.join(destDir, 'tmux.conf');
  fs.writeFileSync(dest, stripped);
  return dest;
}

export function createIsolatedTmux(
  prefix: string,
  sessions: string[] = [],
  _opts?: { tmuxConf?: string },
): IsolatedTmux {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const socketPath = path.join(root, 'sock');
  const wrapperPath = path.join(root, 'tmux');

  const originalConf = _opts?.tmuxConf ?? e2eDefaultTmuxConf;
  const confPath = sanitisedTmuxConf(originalConf, root) ?? originalConf;
  const confArgs = fs.existsSync(confPath) ? ['-f', confPath] : [];

  fs.writeFileSync(
    wrapperPath,
    `#!/usr/bin/env bash\nexec tmux -S '${shellSingleQuote(socketPath)}' "$@"\n`,
    { mode: 0o755 },
  );

  const tmux = (args: string[]) => {
    // The config is loaded once via the wrapper script (-f baked in) or
    // the seeding new-session above.  Don't re-load it on subsequent
    // new-session calls — it would overwrite any server-option set calls
    // the test made between sessions.
    return execFileSync('tmux', ['-S', socketPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  };

  if (sessions.length === 0) {
    // Seed session so the server starts before callers issue set commands.
    // sleep infinity, not cat — cat sees /dev/null in a detached pane.
    // Explicit -f here because tmux() no longer adds it (avoids overriding
    // server options set between sessions).
    tmux([...confArgs, 'new-session', '-d', '-s', '_tw_e2e_place', 'sleep', 'infinity']);
  } else {
    for (const session of sessions) {
      tmux([...confArgs, 'new-session', '-d', '-s', session, 'cat']);
    }
  }

  return {
    socketPath,
    wrapperPath,
    tmux,
    /** Path to the sanitised tmux.conf so startServer can pass it as
     *  `--tmux-conf` and prevent production config from overriding
     *  server options (e.g. set-clipboard) during PTY attach. */
    tmuxConfPath: confPath,
    cleanup: () => {
      try {
        tmux(['kill-server']);
      } catch (err) {
        // Don't swallow silently: a leaked tmux server can leave a stale UNIX
        // socket at <root>/sock that survives until the OS reaps /tmp.
        // Logging makes the leak debuggable when CI hosts accumulate
        // `mkdtemp`-prefixed dirs. Helpers run under the Playwright test
        // runner (not the bunfig silencer preload), so console.warn lands
        // on the e2e reporter's stderr where it belongs.
        console.warn(`[e2e] kill-server failed (already gone?): ${err}`);
      }
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

function assertE2eTmuxIsolation(cmd: string, args: string[]): void {
  if (cmd !== 'bun') return;
  if (!args.includes('src/server/index.ts')) return;
  if (args.includes('--test')) return;
  if (args.some((arg) => arg.startsWith('--test='))) return;
  if (args.includes('--tmux')) return;
  if (args.some((arg) => arg.startsWith('--tmux='))) return;
  throw new Error('non-test-mode e2e servers must pass --tmux with an isolated tmux -S wrapper');
}

/**
 * Start a server process and resolve when it reports "listening".
 * Uses detached:true so killServer() can reap the entire process group
 * (important for bun which may spawn child processes).
 *
 * Always points the server's per-session settings store at a fresh tmp file
 * so test runs never read or write the developer's real
 * ~/.config/tmux-web/sessions.json.
 */
export function startServer(cmd: string, args: string[], timeoutMs = 60_000): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    assertE2eTmuxIsolation(cmd, args);
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-store-'));
    const dropsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-drops-'));
    const env = {
      ...process.env,
      TMUX_WEB_SESSIONS_FILE: path.join(storeDir, 'sessions.json'),
      // Match playwright.config.ts: isolate tests from the real bundled
      // theme pack so renaming a real theme doesn't break tests that
      // just happen to boot the server.
      TMUX_WEB_BUNDLED_THEMES_DIR: bundledThemesFixtureDir,
      // Keep file-drop uploads out of $XDG_RUNTIME_DIR/tmux-web/drop so
      // the developer's live tmux-web instance doesn't surface test
      // uploads in its drops panel.
      TMUX_WEB_DROP_ROOT: dropsDir,
    };
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env });
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        resolve(proc);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', reject);
    setTimeout(() => reject(new Error(`server failed to start: ${cmd} ${args.join(' ')}`)), timeoutMs);
  });
}

/** Kill a server process group cleanly. Safe to call when proc is undefined. */
export function killServer(proc: ChildProcess | undefined): void {
  if (!proc?.pid) return;
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
}

/** Inject raw terminal data into the page as if received from the server. */
export async function writeToTerminal(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => (window as any).__mockWsReceive(t), text);
}

/**
 * Stateful in-memory mock of /api/session-settings, mirroring the server's
 * GET / PUT contract:
 *  - GET returns the current config.
 *  - PUT merges `lastActive` and per-session entries into the config.
 *
 * Persistence is per-page so tests can both verify "what the client tried to
 * save" and exercise reload-style flows without touching the real disk.
 */
export interface SessionSettingsRecord {
  theme: string;
  colours: string;
  fontFamily: string;
  fontSize: number;
  spacing: number;
  opacity: number;
  tuiBgOpacity?: number;
  tuiFgOpacity?: number;
  tuiSaturation?: number;
  backgroundHue?: number;
}
export interface SessionStoreState {
  version: 1;
  lastActive?: string;
  sessions: Record<string, SessionSettingsRecord>;
}
export interface SessionStoreMock {
  get(): SessionStoreState;
  set(state: Partial<SessionStoreState>): void;
}

export async function mockSessionStore(
  page: Page,
  initial?: Partial<SessionStoreState>,
): Promise<SessionStoreMock> {
  const state: SessionStoreState = {
    version: 1,
    sessions: {},
    ...(initial ?? {}),
    sessions: { ...(initial?.sessions ?? {}) },
  };
  await page.route('**/api/session-settings*', async route => {
    const req = route.request();
    if (req.method() === 'PUT') {
      try {
        const patch = JSON.parse(req.postData() ?? '{}') as Partial<SessionStoreState>;
        if (typeof patch.lastActive === 'string') state.lastActive = patch.lastActive;
        if (patch.sessions && typeof patch.sessions === 'object') {
          for (const [k, v] of Object.entries(patch.sessions)) state.sessions[k] = v;
        }
      } catch { /* malformed body — ignore, like the real server */ }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (req.method() === 'DELETE') {
      const u = new URL(req.url());
      const name = u.searchParams.get('name');
      if (name) {
        delete state.sessions[name];
        if (state.lastActive === name) state.lastActive = undefined;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });
  return {
    get: () => ({ ...state, sessions: { ...state.sessions } }),
    set: (s) => {
      if (s.lastActive !== undefined) state.lastActive = s.lastActive;
      if (s.sessions) Object.assign(state.sessions, s.sessions);
    },
  };
}

/**
 * Mock /api/sessions, /api/windows, and /api/session-settings via page.route().
 * The session-settings mock is a stateful store (mirrors the server's GET/PUT
 * contract) so tests don't pollute each other through the shared real server.
 * Call before page.goto(). Tests that want to seed or inspect the store should
 * call mockSessionStore() directly to capture the returned handle.
 */
export async function mockApis(page: Page, sessions: string[], windows: object[]): Promise<void> {
  // Server format is `[{id, name}]`; synthesise positional ids from the
  // input-order string array so tests can keep passing names.
  const sessionPayload = sessions.map((name, i) => ({ id: String(i), name }));
  await page.route('**/api/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessionPayload) })
  );
  await page.route('**/api/windows**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(windows) })
  );
  await mockSessionStore(page);
}

/**
 * Install a WebSocket spy before page load via addInitScript.
 *
 * Installs:
 *   window.__wsSent        — array of all outgoing WS messages (strings)
 *   window.__wsInstance    — the live WebSocket object (set on construction)
 *   window.__mockWsReceive — call with a string to inject a fake incoming message
 *
 * The real WebSocket connection is preserved — this is a spy, not a stub.
 * Call before page.goto().
 */
export async function injectWsSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__wsSent = [];
    (window as any).__wsInstance = null;
    const OrigWS = window.WebSocket;
    class SpyWS extends OrigWS {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        (window as any).__wsInstance = this;
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        (window as any).__wsSent.push(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBufferView));
        return super.send(data as string);
      }
    }
    window.WebSocket = SpyWS as any;
    (window as any).__mockWsReceive = (data: string) => {
      if ((window as any).__wsInstance?.onmessage) {
        (window as any).__wsInstance.onmessage({ data });
      }
    };
  });
}

/**
 * Wait until the WebSocket connection is open.
 * The frontend sends a resize JSON message immediately in ws.onopen — we poll for it.
 */
export async function waitForWsOpen(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__wsSent.some((m: string) => typeof m === 'string' && m.startsWith('{"type":"resize"')),
    { timeout: 10000 }
  );
}

/**
 * Inject a server-push message into the page's ws.onmessage handler.
 * Simulates the server sending \x00TT:<json>.
 * Call after waitForWsOpen().
 */
export async function sendFromServer(page: Page, payload: object): Promise<void> {
  await page.evaluate(
    (json) => (window as any).__mockWsReceive('\x00TT:' + JSON.stringify(json)),
    payload
  );
}
