import type { RunCmd } from './tmux-control.js';

export type { RunCmd };

export interface SendBytesOpts {
  run: RunCmd;
  /** tmux `-t` target (session, session:window, pane id …). */
  target: string;
  /** Raw byte string (one char = one byte). */
  bytes: string;
}

/** Inject raw bytes into the active pane of a tmux target via
 *  `send-keys -H <hex bytes>`. See the design spec §4.5 for why
 *  this goes through control mode now. */
export async function sendBytesToPane(opts: SendBytesOpts): Promise<void> {
  const hex: string[] = [];
  for (let i = 0; i < opts.bytes.length; i++) {
    hex.push(opts.bytes.charCodeAt(i).toString(16).padStart(2, '0'));
  }
  await opts.run(['send-keys', '-H', '-t', opts.target, ...hex]);
}
