import { BrowserWindow, Screen } from 'electrobun/bun';
import fs from 'node:fs';
import path from 'node:path';
import { buildAuthenticatedUrl, generateDesktopCredentials } from './auth.js';
import {
  createCloseOnce,
  startTmuxWebServer,
} from './server-process.js';
import { desktopExtraArgs } from './tmux-path.js';
import { openTmuxTermWindow } from './window.js';
import { installTmuxTermHostMessages } from './window-host-messages.js';

function logDesktop(message: string): void {
  console.error(`[tmux-term] ${message}`);
}

function logTmuxWebOutput(stream: 'stdout' | 'stderr', text: string): void {
  const prefix = stream === 'stdout' ? '[tmux-web stdout] ' : '[tmux-web stderr] ';
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) process.stderr.write(`${prefix}${line}\n`);
  }
}

function resolveTmuxWebExecutable(): string {
  if (process.env.TMUX_TERM_TMUX_WEB) return process.env.TMUX_TERM_TMUX_WEB;
  const besideRuntime = path.join(path.dirname(process.execPath), 'tmux-web');
  if (fs.existsSync(besideRuntime)) return besideRuntime;
  return path.resolve(import.meta.dir, '..', 'tmux-web');
}

async function main(): Promise<void> {
  const credentials = generateDesktopCredentials();
  const executable = resolveTmuxWebExecutable();
  const extraArgs = desktopExtraArgs();
  logDesktop(`starting tmux-web: ${executable}`);
  logDesktop(`tmux-web args: ${extraArgs.join(' ') || '(none)'}`);
  const server = await startTmuxWebServer({
    executable,
    credentials,
    extraArgs,
    onOutput: logTmuxWebOutput,
  });
  logDesktop(`tmux-web ready: ${server.endpoint.origin}`);
  const closeServer = createCloseOnce(server.close);
  let intentionalShutdown = false;
  let closingAfterServerExit = false;

  const shutdown = () => {
    intentionalShutdown = true;
    void closeServer().finally(() => process.exit(0));
  };

  try {
    const url = buildAuthenticatedUrl({
      host: server.endpoint.host,
      port: server.endpoint.port,
      credentials,
    });

    logDesktop(`opening window: ${server.endpoint.origin}`);
    const win = openTmuxTermWindow(BrowserWindow, url);
    installTmuxTermHostMessages(win, () => Screen.getPrimaryDisplay().workArea);
    logDesktop('window opened');

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
  } catch (err) {
    await closeServer();
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
