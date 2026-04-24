import { BrowserWindow } from 'electrobun/bun';
import { buildAuthenticatedUrl, generateDesktopCredentials } from './auth.js';
import {
  createCloseOnce,
  startTmuxWebServer,
} from './server-process.js';

function resolveTmuxWebExecutable(): string {
  return process.env.TMUX_TERM_TMUX_WEB ?? './tmux-web';
}

function desktopExtraArgs(): string[] {
  const args: string[] = [];
  if (process.env.TMUX_TERM_TMUX_BIN) {
    args.push('--tmux', process.env.TMUX_TERM_TMUX_BIN);
  }
  if (process.env.TMUX_TERM_THEMES_DIR) {
    args.push('--themes-dir', process.env.TMUX_TERM_THEMES_DIR);
  }
  return args;
}

async function main(): Promise<void> {
  const credentials = generateDesktopCredentials();
  const server = await startTmuxWebServer({
    executable: resolveTmuxWebExecutable(),
    credentials,
    extraArgs: desktopExtraArgs(),
  });
  const closeServer = createCloseOnce(server.close);
  let intentionalShutdown = false;
  let closingAfterServerExit = false;

  const shutdown = () => {
    intentionalShutdown = true;
    void closeServer().finally(() => process.exit(0));
  };

  const url = buildAuthenticatedUrl({
    host: server.endpoint.host,
    port: server.endpoint.port,
    credentials,
  });

  const win = new BrowserWindow({
    title: 'tmux-term',
    url,
    partition: `tmux-term-${process.pid}`,
    frame: {
      width: 1200,
      height: 760,
    },
  });

  win.on('close', () => {
    if (closingAfterServerExit) return;
    shutdown();
  });

  void server.process.exited.then((code) => {
    if (intentionalShutdown) return;
    closingAfterServerExit = true;
    try { win.close(); } catch {}
    process.exit(code === 0 ? 0 : 1);
  });

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      shutdown();
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
