import { homedir } from 'os';
import type { TerminalBackend } from '../shared/types.js';

export interface PtyCommand {
  file: string;
  args: string[];
}

export interface PtyCommandOptions {
  testMode: boolean;
  session: string;
  tmuxConfPath: string;
}

export function sanitizeSession(raw: string): string {
  const decoded = decodeURIComponent(raw || 'main');
  const cleaned = decoded
    .replace(/[^a-zA-Z0-9_\-./]/g, '')
    .replace(/\.{2,}/g, '')
    .replace(/^\/+|\/+$/g, '');
  return cleaned || 'main';
}

export function buildPtyCommand(opts: PtyCommandOptions): PtyCommand {
  if (opts.testMode) {
    return { file: 'cat', args: [] };
  }
  const session = sanitizeSession(opts.session);
  return {
    file: 'tmux',
    args: ['-f', opts.tmuxConfPath, 'new-session', '-A', '-s', session],
  };
}

export function buildPtyEnv(terminal: TerminalBackend): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.LANG;
  delete env.LANGUAGE;
  delete env.EDITOR;
  delete env.VISUAL;
  env.TERM = terminal === 'ghostty' ? 'ghostty' : 'xterm-256color';
  env.TERM_PROGRAM = terminal === 'ghostty' ? 'ghostty' : 'xterm';
  env.COLORTERM = 'truecolor';
  env.LC_ALL = 'C.UTF-8';
  return env;
}

export interface SpawnPtyOptions {
  command: PtyCommand;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  terminal: TerminalBackend;
}

export interface BunPty {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: () => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export function spawnPty(opts: SpawnPtyOptions): BunPty {
  let onDataCallback: (data: string) => void = () => {};
  let onExitCallback: () => void = () => {};
  const decoder = new TextDecoder('utf8');

  const proc = Bun.spawn([opts.command.file, ...opts.command.args], {
    env: opts.env as any,
    cwd: homedir(),
    terminal: {
      cols: opts.cols,
      rows: opts.rows,
      data(terminal, data) {
        onDataCallback(decoder.decode(data, { stream: true }));
      },
    },
  });

  proc.exited.then(() => {
    onExitCallback();
  });

  return {
    onData: (cb: (data: string) => void) => {
      onDataCallback = cb;
    },
    onExit: (cb: () => void) => {
      onExitCallback = cb;
    },
    write: (data: string) => {
      if (proc.terminal) {
        proc.terminal.write(data);
      }
    },
    resize: (cols: number, rows: number) => {
      if (proc.terminal) {
        proc.terminal.resize(cols, rows);
      }
    },
    kill: () => {
      proc.kill();
    },
  };
}
