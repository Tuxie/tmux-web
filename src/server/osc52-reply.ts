import { execFile as rawExecFile } from 'child_process';
import { promisify } from 'util';
import { buildOsc52Response } from './protocol.js';

const defaultExecFile = promisify(rawExecFile);

/** Function signature compatible with promisified child_process.execFile.
 *  Injected in tests so we can assert the exact tmux invocation. */
export type ExecFileAsync = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface DeliverOpts {
  tmuxBin: string;
  /** tmux target for `send-keys -t` (session name, window/pane target, etc.). */
  target: string;
  selection: string;
  base64: string;
  /** Fallback for callers not running under tmux (test mode). Receives the
   *  raw OSC 52 byte string directly — e.g. ptyProcess.write. */
  directWrite?: (bytes: string) => void;
  /** Only set in tests. Defaults to child_process.execFile (promisified). */
  execFileAsync?: ExecFileAsync;
}

/** Deliver an OSC 52 response to the foreground process inside a tmux pane.
 *
 *  Bytes CAN'T just be written to the tmux-client PTY: tmux's input parser
 *  would treat an OSC 52 WRITE arriving on its client-keyboard channel as
 *  an outer-terminal reply and drop it when no matching query is pending
 *  (which is always, because the original query went through DCS
 *  passthrough that bypassed tmux). Injecting via `tmux send-keys -H` puts
 *  the bytes directly onto the target pane's stdin, which is what the
 *  application reading `/dev/tty` actually sees. */
export async function deliverOsc52Reply(opts: DeliverOpts): Promise<void> {
  const bytes = buildOsc52Response(opts.selection, opts.base64);
  if (opts.directWrite) {
    opts.directWrite(bytes);
    return;
  }
  const exec = opts.execFileAsync ?? defaultExecFile;
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes.charCodeAt(i).toString(16).padStart(2, '0'));
  }
  await exec(opts.tmuxBin, ['send-keys', '-H', '-t', opts.target, ...hex]);
}
