import type { Subprocess } from 'bun';
import type { DesktopCredentials } from './auth.js';

type TmuxWebProcess = Subprocess<'ignore', 'pipe', 'pipe'>;

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

const ALLOWED_VALUE_EXTRA_ARGS = new Set(['--tmux', '--tmux-conf', '--themes-dir']);
const ALLOWED_BOOLEAN_EXTRA_ARGS = new Set(['--debug', '-d']);
const BUN_SERVER_SCRIPT_ARG = 'src/server/index.ts';

function executableBasename(executable: string): string {
  return executable.split(/[\\/]/).pop() ?? executable;
}

function validateExecutableArgs(executable: string, executableArgs: string[]): void {
  if (executableArgs.length === 0) return;

  if (
    executableBasename(executable) === 'bun' &&
    executableArgs.length === 1 &&
    executableArgs[0] === BUN_SERVER_SCRIPT_ARG
  ) {
    return;
  }

  throw new Error('tmux-web desktop executable args are not allowed');
}

function validateExtraArgs(extraArgs: string[]): void {
  for (let i = 0; i < extraArgs.length; i += 1) {
    const arg = extraArgs[i]!;
    if (ALLOWED_BOOLEAN_EXTRA_ARGS.has(arg)) continue;

    const equalsIndex = arg.indexOf('=');
    if (equalsIndex > 0) {
      const flag = arg.slice(0, equalsIndex);
      const value = arg.slice(equalsIndex + 1);
      if (ALLOWED_VALUE_EXTRA_ARGS.has(flag) && value.length > 0) continue;
      throw new Error(`tmux-web desktop extra arg is not allowed: ${flag}`);
    }

    if (ALLOWED_VALUE_EXTRA_ARGS.has(arg)) {
      const value = extraArgs[i + 1];
      if (value && !value.startsWith('-')) {
        i += 1;
        continue;
      }
    }

    throw new Error(`tmux-web desktop extra arg is not allowed: ${arg}`);
  }
}

export function buildTmuxWebLaunch(opts: TmuxWebLaunchOptions): TmuxWebLaunch {
  const executableArgs = opts.executableArgs ?? [];
  const extraArgs = opts.extraArgs ?? [];
  validateExecutableArgs(opts.executable, executableArgs);
  validateExtraArgs(extraArgs);

  return {
    cmd: opts.executable,
    args: [
      ...executableArgs,
      '--listen',
      '127.0.0.1:0',
      '--no-tls',
      ...extraArgs,
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
  process: TmuxWebProcess;
  endpoint: ListeningEndpoint;
  close: () => Promise<void>;
}

export interface StartTmuxWebServerOptions extends TmuxWebLaunchOptions {
  startupTimeoutMs?: number;
  closeGraceMs?: number;
}

const OUTPUT_TAIL_LIMIT = 8192;

function appendBoundedTail(tail: string, text: string): string {
  const next = tail + text;
  return next.length > OUTPUT_TAIL_LIMIT ? next.slice(-OUTPUT_TAIL_LIMIT) : next;
}

function formatOutputTail(name: string, tail: string): string {
  const trimmed = tail.trimEnd();
  return trimmed ? `; ${name}: ${trimmed}` : '';
}

function terminateProcess(
  proc: TmuxWebProcess,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
): void {
  try {
    proc.kill(signal);
  } catch {
    if (signal !== 'SIGKILL') {
      try {
        proc.kill();
      } catch {}
    }
  }
}

async function waitForExitWithKill(
  proc: TmuxWebProcess,
  graceMs: number,
): Promise<void> {
  terminateProcess(proc, 'SIGTERM');
  const exited = proc.exited.then(() => undefined, () => undefined);
  const graceExpired = Bun.sleep(graceMs).then(() => 'timeout' as const);
  if ((await Promise.race([exited, graceExpired])) === 'timeout') {
    terminateProcess(proc, 'SIGKILL');
    await exited;
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

  const timeoutMs = opts.startupTimeoutMs ?? 10_000;
  const closeGraceMs = opts.closeGraceMs ?? 500;
  let buffer = '';
  let stdoutTail = '';
  let stderrTail = '';
  let settled = false;

  const endpoint = await new Promise<ListeningEndpoint>((resolve, reject) => {
    const rejectAfterCleanup = async (err: unknown, cleanupChild: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (cleanupChild) {
        await waitForExitWithKill(proc, closeGraceMs);
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const timer = setTimeout(() => {
      void rejectAfterCleanup(
        new Error(
          `tmux-web did not report readiness within ${timeoutMs}ms${formatOutputTail('stdout', stdoutTail)}${formatOutputTail('stderr', stderrTail)}`,
        ),
        true,
      );
    }, timeoutMs);

    const fail = (err: unknown) => {
      void rejectAfterCleanup(err, true);
    };

    const ready = (endpoint: ListeningEndpoint) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(endpoint);
    };

    void proc.exited.then((code) => {
      void rejectAfterCleanup(
        new Error(
          `tmux-web exited before readiness with status ${code}${formatOutputTail('stdout', stdoutTail)}${formatOutputTail('stderr', stderrTail)}`,
        ),
        false,
      );
    });

    void (async (stream: ReadableStream<Uint8Array>) => {
      const stdoutDecoder = new TextDecoder();
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = stdoutDecoder.decode(value, { stream: true });
          stdoutTail = appendBoundedTail(stdoutTail, text);
          if (settled) continue;
          buffer += text;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const parsed = parseTmuxWebListeningLine(line);
            if (parsed) {
              ready(parsed);
              break;
            }
          }
        }
        if (!settled) {
          const code = await proc.exited;
          void rejectAfterCleanup(
            new Error(
              `tmux-web exited before readiness with status ${code}${formatOutputTail('stdout', stdoutTail)}${formatOutputTail('stderr', stderrTail)}`,
            ),
            false,
          );
        }
      } catch (err) {
        fail(err);
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }
    })(proc.stdout);

    void (async (stream: ReadableStream<Uint8Array>) => {
      const stderrDecoder = new TextDecoder();
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderrTail = appendBoundedTail(
            stderrTail,
            stderrDecoder.decode(value, { stream: true }),
          );
        }
      } catch (err) {
        fail(err);
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }
    })(proc.stderr);
  });

  return {
    process: proc,
    endpoint,
    close: async () => {
      await waitForExitWithKill(proc, closeGraceMs);
    },
  };
}
