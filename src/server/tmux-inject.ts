import { execFile as rawExecFile } from 'child_process';
import { promisify } from 'util';

const defaultExecFile = promisify(rawExecFile);

export type ExecFileAsync = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface SendBytesOpts {
  tmuxBin: string;
  /** tmux `-t` target (session, session:window, pane id …). */
  target: string;
  /** Raw byte string (one char = one byte). */
  bytes: string;
  /** Injectable for tests; defaults to promisified child_process.execFile. */
  execFileAsync?: ExecFileAsync;
}

/** Inject raw bytes into the active pane of a tmux target via
 *  `send-keys -H <hex bytes>`. `-H` bypasses tmux's key-binding parser
 *  and writes the bytes literally to the pane's stdin — which is how
 *  OSC 52 replies, bracketed-paste delivery of file-drop paths, and any
 *  other "pretend the user typed this" flow reach the app reading
 *  /dev/tty, regardless of what tmux thinks those bytes mean. */
export async function sendBytesToPane(opts: SendBytesOpts): Promise<void> {
  const exec = opts.execFileAsync ?? defaultExecFile;
  const hex: string[] = [];
  for (let i = 0; i < opts.bytes.length; i++) {
    hex.push(opts.bytes.charCodeAt(i).toString(16).padStart(2, '0'));
  }
  await exec(opts.tmuxBin, ['send-keys', '-H', '-t', opts.target, ...hex]);
}
