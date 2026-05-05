import { homedir } from 'os';

export interface PtyCommand {
  file: string;
  args: string[];
}

export interface PtyCommandOptions {
  testMode: boolean;
  session: string;
  tmuxConfPath: string;
  tmuxBin: string;
}

export function sanitizeSession(raw: string): string {
  // `decodeURIComponent` throws on malformed percent-escapes (a lone `%`,
  // or `%` followed by non-hex). We promise callers a sanitized string
  // and never a throw, so fall back to the raw input if decoding fails;
  // the charset filter below strips any stray `%` anyway.
  let decoded: string;
  try { decoded = decodeURIComponent(raw || 'main'); }
  catch { decoded = raw || 'main'; }
  const cleaned = decoded
    .replace(/[^a-zA-Z0-9_\-.\ /]/g, '')
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
    file: opts.tmuxBin,
    args: ['-f', opts.tmuxConfPath, 'new-session', '-A', '-s', session],
  };
}

export function buildPtyEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  // LANG / LANGUAGE are stripped because we force LC_ALL=C.UTF-8 below
  // (and in `index.ts` for the parent process). Letting LANG through
  // alongside LC_ALL=C.UTF-8 produces inconsistent locale behaviour for
  // tmux's display-message — see index.ts comment block.
  delete env.LANG;
  delete env.LANGUAGE;
  // EDITOR / VISUAL pass through untouched. They were stripped wholesale
  // when the Bun-native server was first written, but `git log -p
  // src/server/pty.ts` surfaces no rationale — the strip arrived in the
  // bulk Bun conversion (commit b4039da, 2026-04-13) with no comment.
  // Stripping them broke the user-expected `:!vim file` flow inside
  // shells running under tmux-web (where the user's `$EDITOR=nvim`
  // would silently disappear and whatever the pane shell rc-file set
  // — possibly nothing — won the race). Cluster 15 / F4 —
  // docs/code-analysis/2026-04-26.
  env.TERM = 'xterm-256color';
  env.TERM_PROGRAM = 'xterm';
  env.COLORTERM = 'truecolor';
  env.LC_ALL = 'C.UTF-8';
  return env;
}

export interface SpawnPtyOptions {
  command: PtyCommand;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
}

export interface BunPty {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: () => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  /** Non-null when the PTY failed to spawn (Bun.spawn threw synchronously
   *  — e.g. the tmux binary was deleted between the `-V` probe and now).
   *  Consumers should detect this and emit a `{ ptyExit: true,
   *  exitCode: -1, exitReason }` to the WS, then close the WS. The
   *  returned BunPty's methods are all safe no-ops in this state.
   *  Cluster 15 / F5 — docs/code-analysis/2026-04-26. */
  spawnError?: Error;
}

export function spawnPty(opts: SpawnPtyOptions): BunPty {
  let onDataCallback: (data: string) => void = () => {};
  let onExitCallback: () => void = () => {};
  const decoder = new TextDecoder('utf-8');

  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let spawnError: Error | undefined;
  try {
    proc = Bun.spawn([opts.command.file, ...opts.command.args], {
      env: opts.env as any,
      cwd: homedir(),
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        data(_terminal: unknown, data: Uint8Array) {
          onDataCallback(decoder.decode(data, { stream: true }));
        },
      },
    });
  } catch (err) {
    spawnError = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(`[warn] spawnPty failed: ${spawnError.message}\n`);
  }

  if (proc === null) {
    // Spawn-error shape: every method is a safe no-op, pid is 0, and the
    // consumer (ws.ts handleOpen) keys off `spawnError` to surface the
    // failure to the WS client and close the WS cleanly.
    return {
      pid: 0,
      spawnError,
      onData: (cb) => { onDataCallback = cb; },
      onExit: (cb) => { onExitCallback = cb; },
      write: () => { /* no PTY to write to */ },
      resize: () => { /* no PTY to resize */ },
      kill: () => { /* nothing to kill */ },
    };
  }

  proc.exited.then(() => {
    onExitCallback();
    try { proc!.terminal?.close(); } catch { /* best-effort */ }
  });

  return {
    pid: proc.pid,
    onData: (cb: (data: string) => void) => {
      onDataCallback = cb;
    },
    onExit: (cb: () => void) => {
      onExitCallback = cb;
    },
    write: (data: string) => {
      if (proc!.terminal) {
        try { proc!.terminal.write(data); } catch { /* PTY closed mid-write */ }
      }
    },
    resize: (cols: number, rows: number) => {
      if (proc!.terminal) {
        try { proc!.terminal.resize(cols, rows); } catch { /* PTY closed */ }
      }
    },
    kill: () => {
      proc!.kill();
      // Close the PTY master FD too. Without this, a child that exited
      // before we got here (e.g. tmux failing to start) leaves the FD
      // ref'd and blocks `Bun.serve.stop()` from returning.
      try { proc!.terminal?.close(); } catch { /* best-effort */ }
    },
  };
}
