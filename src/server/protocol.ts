import { TT_PREFIX } from '../shared/constants.js';
import type { ServerMessage } from '../shared/types.js';

export interface ProcessResult {
  /** PTY data with OSC 52 sequences stripped (OSC title sequences preserved). */
  output: string;
  /** Out-of-band messages to send to the client. */
  messages: ServerMessage[];
  /** Whether an OSC title change was detected. */
  titleChanged: boolean;
  /** Session name extracted from the latest OSC title, if any. */
  detectedSession: string | null;
  /** Raw title text from the latest OSC title, if any. */
  detectedTitle: string | null;
  /** OSC 52 read requests seen in this chunk — one entry per request. The
   *  WS layer resolves each via the per-session policy (allow / deny /
   *  prompt), then either supplies the clipboard content back to the PTY
   *  or drops the request. Selection field (pc) is kept for future per-
   *  selection policy; today we only implement `c`. */
  readRequests: Array<{ selection: string }>;
}

const OSC_TITLE_RE = /\x1b\]([02]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
const OSC_52_WRITE_RE = /\x1b\]52;[^;]*;([A-Za-z0-9+/=]+)(?:\x07|\x1b\\)/g;
const OSC_52_READ_RE = /\x1b\]52;([^;]*);\?(?:\x07|\x1b\\)/g;
const TMUX_PASSTHROUGH_OSC_52_RE = /\x1bPtmux;\x1b(?:\x1b)?\]52;([^;]*);([A-Za-z0-9+/=]+|\?)(?:\x07|\x1b\\)\x1b\\/g;
const XTERM_SECONDARY_DA_REPLY_RE = /\x1b\[>0;276;0c/g;
const XTERM_VERSION_REPLY_RE = /\x1bP>\|xterm\.js\([^)]*\)\x1b\\/g;
const ECHOCTL_XTERM_SECONDARY_DA_REPLY_RE = /\^\[\[>0;276;0c/g;
const ECHOCTL_XTERM_VERSION_REPLY_RE = /\^\[P>\|xterm\.js\([^)]*\)\^\[\\/g;

/** Maximum byte length of an OSC 52 write payload (base64 string length).
 *  Matches the 1 MiB cap on the read path in ws.ts. */
const MAX_OSC52_WRITE_BYTES = 1 * 1024 * 1024;

/** Only the last N OSC 52 write frames in a single PTY chunk are forwarded
 *  to the WS client — prior writes are superseded on the browser side
 *  anyway (each one overwrites the clipboard), so a rogue TUI can't flood
 *  the socket with an unbounded burst. */
const MAX_OSC52_WRITES_PER_CHUNK = 8;

// Single timestamp: the OSC52 too-large warn-rate-limit only ever had one
// key. Kept as a bare number (not a Map) to make that explicit and avoid
// the unbounded-growth shape if a future caller mistakenly passed a
// dynamic key.
let _osc52LastWarnAt = 0;

function warnTooLargeOsc52Write(length: number): void {
  const now = Date.now();
  if (now - _osc52LastWarnAt < 60_000) return;
  _osc52LastWarnAt = now;
  console.error(
    `tmux-web: OSC 52 write payload too large (${length} bytes > ${MAX_OSC52_WRITE_BYTES}); dropping`,
  );
}

export function processData(data: string, _currentSession: string): ProcessResult {
  const messages: ServerMessage[] = [];
  let titleChanged = false;
  let detectedSession: string | null = null;
  let detectedTitle: string | null = null;
  const readRequests: Array<{ selection: string }> = [];

  let match: RegExpExecArray | null;
  TMUX_PASSTHROUGH_OSC_52_RE.lastIndex = 0;
  const passthroughWrites: string[] = [];
  while ((match = TMUX_PASSTHROUGH_OSC_52_RE.exec(data)) !== null) {
    const selection = match[1] || 'c';
    const payload = match[2];
    if (payload === '?') {
      readRequests.push({ selection });
      continue;
    }
    if (!payload) continue;
    if (payload.length > MAX_OSC52_WRITE_BYTES) {
      warnTooLargeOsc52Write(payload.length);
      continue;
    }
    passthroughWrites.push(payload);
  }
  for (const b64 of passthroughWrites.slice(-MAX_OSC52_WRITES_PER_CHUNK)) {
    messages.push({ clipboard: b64 });
  }

  TMUX_PASSTHROUGH_OSC_52_RE.lastIndex = 0;
  const dataWithoutPassthrough = data.replace(TMUX_PASSTHROUGH_OSC_52_RE, '');

  OSC_TITLE_RE.lastIndex = 0;
  while ((match = OSC_TITLE_RE.exec(dataWithoutPassthrough)) !== null) {
    const title = match[2];
    titleChanged = true;
    detectedTitle = title;
    const sessionName = title.split(':')[0];
    if (sessionName) {
      detectedSession = sessionName;
    }
  }

  OSC_52_WRITE_RE.lastIndex = 0;
  const writes: string[] = [];
  while ((match = OSC_52_WRITE_RE.exec(dataWithoutPassthrough)) !== null) {
    const b64 = match[1];
    if (!b64) continue;
    if (b64.length > MAX_OSC52_WRITE_BYTES) {
      warnTooLargeOsc52Write(b64.length);
      continue;
    }
    writes.push(b64);
  }
  for (const b64 of writes.slice(-MAX_OSC52_WRITES_PER_CHUNK)) {
    messages.push({ clipboard: b64 });
  }

  OSC_52_READ_RE.lastIndex = 0;
  while ((match = OSC_52_READ_RE.exec(dataWithoutPassthrough)) !== null) {
    readRequests.push({ selection: match[1] || 'c' });
  }

  OSC_52_WRITE_RE.lastIndex = 0;
  OSC_52_READ_RE.lastIndex = 0;
  const output = dataWithoutPassthrough
    .replace(OSC_52_WRITE_RE, '')
    .replace(OSC_52_READ_RE, '')
    .replace(XTERM_SECONDARY_DA_REPLY_RE, '')
    .replace(XTERM_VERSION_REPLY_RE, '')
    .replace(ECHOCTL_XTERM_SECONDARY_DA_REPLY_RE, '')
    .replace(ECHOCTL_XTERM_VERSION_REPLY_RE, '');

  return { output, messages, titleChanged, detectedSession, detectedTitle, readRequests };
}

export function frameTTMessage(msg: ServerMessage): string {
  return TT_PREFIX + JSON.stringify(msg);
}

/** Build the OSC 52 response an app expects after issuing `OSC 52;c;?`.
 *  Format: `ESC ] 52 ; <sel> ; <base64> BEL`. Empty base64 is a valid
 *  "clipboard is empty / access denied" reply. */
export function buildOsc52Response(selection: string, base64: string): string {
  return `\x1b]52;${selection};${base64}\x07`;
}
