import { buildOsc52Response } from './protocol.js';
import { sendBytesToPane, type ExecFileAsync } from './tmux-inject.js';

export type { ExecFileAsync };

export interface DeliverOpts {
  tmuxBin: string;
  target: string;
  selection: string;
  base64: string;
  /** Fallback for callers not running under tmux (test mode). Receives the
   *  raw OSC 52 byte string directly — e.g. ptyProcess.write. */
  directWrite?: (bytes: string) => void;
  /** Only set in tests. */
  execFileAsync?: ExecFileAsync;
}

/** Deliver an OSC 52 response to the foreground process inside a tmux pane.
 *
 *  Bytes CAN'T just be written to the tmux-client PTY: tmux's input parser
 *  would treat an OSC 52 WRITE arriving on its client-keyboard channel as
 *  an outer-terminal reply and drop it when no matching query is pending
 *  (which is always, because the original query went through DCS
 *  passthrough that bypassed tmux). Inject via `sendBytesToPane` so the
 *  reply lands on the target pane's stdin directly. */
export async function deliverOsc52Reply(opts: DeliverOpts): Promise<void> {
  const bytes = buildOsc52Response(opts.selection, opts.base64);
  if (opts.directWrite) {
    opts.directWrite(bytes);
    return;
  }
  await sendBytesToPane({
    tmuxBin: opts.tmuxBin,
    target: opts.target,
    bytes,
    execFileAsync: opts.execFileAsync,
  });
}
