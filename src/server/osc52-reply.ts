import { buildOsc52Response } from './protocol.js';
import { sendBytesToPane } from './tmux-inject.js';
import type { RunCmd } from './tmux-control.js';

export interface DeliverOpts {
  run: RunCmd;
  target: string;
  selection: string;
  base64: string;
  /** Fallback for callers not running under tmux (test mode). Receives
   *  the raw OSC 52 byte string directly — e.g. ptyProcess.write. */
  directWrite?: (bytes: string) => void;
}

export async function deliverOsc52Reply(opts: DeliverOpts): Promise<void> {
  const bytes = buildOsc52Response(opts.selection, opts.base64);
  if (opts.directWrite) { opts.directWrite(bytes); return; }
  await sendBytesToPane({ run: opts.run, target: opts.target, bytes });
}
