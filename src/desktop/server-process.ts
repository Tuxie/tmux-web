import type { Subprocess } from 'bun';
import type { DesktopCredentials } from './auth.js';

export interface TmuxWebLaunchOptions {
  executable: string;
  credentials: DesktopCredentials;
  executableArgs?: string[];
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface TmuxWebLaunch {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface ListeningEndpoint {
  host: string;
  port: number;
  origin: string;
}

export function buildTmuxWebLaunch(opts: TmuxWebLaunchOptions): TmuxWebLaunch {
  return {
    cmd: opts.executable,
    args: [
      ...(opts.executableArgs ?? []),
      '--listen',
      '127.0.0.1:0',
      '--no-tls',
      ...(opts.extraArgs ?? []),
    ],
    env: {
      ...(opts.env ?? process.env),
      TMUX_WEB_USERNAME: opts.credentials.username,
      TMUX_WEB_PASSWORD: opts.credentials.password,
    },
  };
}

export function parseTmuxWebListeningLine(line: string): ListeningEndpoint | null {
  const match = line.match(/^tmux-web listening on (http:\/\/127\.0\.0\.1:(\d+))$/);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: '127.0.0.1', port, origin: match[1]! };
}

export interface StartedTmuxWebServer {
  process: Subprocess<'pipe', 'pipe', 'pipe'>;
  endpoint: ListeningEndpoint;
  close: () => Promise<void>;
}

export interface StartTmuxWebServerOptions extends TmuxWebLaunchOptions {
  startupTimeoutMs?: number;
}

function terminateProcess(proc: Subprocess<'pipe', 'pipe', 'pipe'>): void {
  try {
    proc.kill('SIGTERM');
  } catch {
    try {
      proc.kill();
    } catch {}
  }
}

export async function startTmuxWebServer(
  opts: StartTmuxWebServerOptions,
): Promise<StartedTmuxWebServer> {
  const launch = buildTmuxWebLaunch(opts);
  const proc = Bun.spawn({
    cmd: [launch.cmd, ...launch.args],
    env: launch.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const decoder = new TextDecoder();
  const timeoutMs = opts.startupTimeoutMs ?? 10_000;
  let buffer = '';

  const endpoint = await new Promise<ListeningEndpoint>((resolve, reject) => {
    const timer = setTimeout(() => {
      terminateProcess(proc);
      reject(new Error(`tmux-web did not report readiness within ${timeoutMs}ms`));
    }, timeoutMs);

    const fail = (err: unknown) => {
      clearTimeout(timer);
      terminateProcess(proc);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    void proc.exited.then((code) => {
      fail(new Error(`tmux-web exited before readiness with status ${code}`));
    });

    void (async () => {
      const reader = proc.stdout.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const parsed = parseTmuxWebListeningLine(line);
            if (parsed) {
              clearTimeout(timer);
              resolve(parsed);
              return;
            }
          }
        }
        fail(new Error('tmux-web stdout closed before readiness'));
      } catch (err) {
        fail(err);
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }
    })();
  });

  return {
    process: proc,
    endpoint,
    close: async () => {
      terminateProcess(proc);
      try {
        await proc.exited;
      } catch {}
    },
  };
}
