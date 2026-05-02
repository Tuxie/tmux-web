import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpHandler } from '../../../../src/server/http.ts';
import { createWsHandlers, type WsData } from '../../../../src/server/ws.ts';
import { createNullTmuxControl, type TmuxControl } from '../../../../src/server/tmux-control.ts';
import { execFileAsync } from '../../../../src/server/exec.ts';
import { serveWithResolvedPort } from '../../../../src/server/listen-port.ts';
import type { DropStorage } from '../../../../src/server/file-drop.ts';
import type { ServerConfig } from '../../../../src/shared/types.ts';

export const TRUE_BIN = process.platform === 'darwin' ? '/usr/bin/true' : '/bin/true';

/** Build a fake TmuxControl that dispatches `run()` calls through
 *  execFileAsync against the given binary. Good enough for tests that
 *  use the fake-tmux shell-script harness: the command path (display-
 *  message, list-windows, rename-session, send-keys -H …) is exercised,
 *  but notification subscriptions are no-ops (tests don't rely on %-
 *  events inside the unit harness). */
export function tmuxControlFromBin(tmuxBin: string): TmuxControl {
  return {
    attachSession: async () => {},
    detachSession: () => {},
    run: async (args) => {
      const { stdout } = await execFileAsync(tmuxBin, args);
      return stdout;
    },
    on: () => () => {},
    hasSession: () => false,
    close: async () => {},
  };
}

export interface Harness {
  url: string;
  wsUrl: string;
  close: () => Promise<void>;
  tmpDir: string;
  config: ServerConfig;
}

export interface HarnessOpts {
  configOverrides?: Partial<ServerConfig>;
  tmuxBin?: string;
  allowedOrigins?: ServerConfig['allowedOrigins'];
  allowedIps?: Set<string>;
  auth?: ServerConfig['auth'];
  testMode?: boolean;
  /** Optional override. Defaults to a bin-backed TmuxControl when
   *  `tmuxBin` is set and `testMode` is false (so `getForegroundProcess`
   *  / `send-keys -H` paths reach the fake binary), else the null impl. */
  tmuxControl?: TmuxControl;
  remoteAgentManager?: any;
}

export async function startTestServer(opts: HarnessOpts = {}): Promise<Harness> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'tw-srv-'));
  const sessionsStorePath = join(tmpDir, 'sessions.json');
  writeFileSync(sessionsStorePath, JSON.stringify({ version: 1, sessions: {} }));
  const tmuxConfPath = join(tmpDir, 'tmux.conf');
  writeFileSync(tmuxConfPath, '');
  const dropRoot = join(tmpDir, 'drops');
  mkdirSync(dropRoot, { recursive: true, mode: 0o700 });

  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 0,
    allowedIps: opts.allowedIps ?? new Set(['127.0.0.1', '::1']),
    allowedOrigins: opts.allowedOrigins ?? [],
    tls: false,
    testMode: opts.testMode ?? true,
    debug: false,
    tmuxBin: opts.tmuxBin ?? TRUE_BIN,
    tmuxConf: tmuxConfPath,
    auth: opts.auth ?? { enabled: false },
    ...opts.configOverrides,
  };

  const dropStorage: DropStorage = {
    root: dropRoot,
    maxFilesPerSession: 20,
    ttlMs: 60_000,
    autoUnlinkOnClose: false,
    // Generous; tests don't exercise the global quota path here.
    maxRootBytes: 4 * 1024 * 1024 * 1024,
  };

  const tmuxControl = opts.tmuxControl
    ?? (!config.testMode && opts.tmuxBin
      ? tmuxControlFromBin(opts.tmuxBin)
      : createNullTmuxControl());

  const handler = await createHttpHandler({
    config,
    htmlTemplate: '<html></html>',
    distDir: tmpDir,
    themesUserDir: tmpDir,
    themesBundledDir: tmpDir,
    projectRoot: tmpDir,
    isCompiled: false,
    sessionsStorePath,
    dropStorage,
    tmuxControl,
  });

  const ws = createWsHandlers({
    config,
    tmuxConfPath,
    sessionsStorePath,
    tmuxControl,
    remoteAgentManager: opts.remoteAgentManager,
  });

  const fetch: Parameters<typeof Bun.serve<WsData, never>>[0]['fetch'] = (req, srv) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/ws') || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const rejected = ws.upgrade(req, srv);
      if (rejected) return rejected;
      return undefined;
    }
    return handler(req, srv);
  };

  const server = await serveWithResolvedPort<WsData, never>('127.0.0.1', 0, listenPort => ({
    hostname: '127.0.0.1',
    port: listenPort,
    fetch,
    websocket: ws.websocket,
  }));

  config.port = server.port;
  const url = `http://127.0.0.1:${server.port}`;

  return {
    url,
    wsUrl: url.replace(/^http/, 'ws'),
    tmpDir,
    config,
    close: async () => {
      ws.close();
      await server.stop(true);
    },
  };
}
