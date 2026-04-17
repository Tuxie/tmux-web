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

export function processData(data: string, _currentSession: string): ProcessResult {
  const messages: ServerMessage[] = [];
  let titleChanged = false;
  let detectedSession: string | null = null;
  let detectedTitle: string | null = null;
  const readRequests: Array<{ selection: string }> = [];

  let match: RegExpExecArray | null;
  OSC_TITLE_RE.lastIndex = 0;
  while ((match = OSC_TITLE_RE.exec(data)) !== null) {
    const title = match[2];
    titleChanged = true;
    detectedTitle = title;
    const sessionName = title.split(':')[0];
    if (sessionName) {
      detectedSession = sessionName;
    }
  }

  OSC_52_WRITE_RE.lastIndex = 0;
  while ((match = OSC_52_WRITE_RE.exec(data)) !== null) {
    const b64 = match[1];
    if (b64) messages.push({ clipboard: b64 });
  }

  OSC_52_READ_RE.lastIndex = 0;
  while ((match = OSC_52_READ_RE.exec(data)) !== null) {
    readRequests.push({ selection: match[1] || 'c' });
  }

  OSC_52_WRITE_RE.lastIndex = 0;
  OSC_52_READ_RE.lastIndex = 0;
  const output = data
    .replace(OSC_52_WRITE_RE, '')
    .replace(OSC_52_READ_RE, '');

  if (titleChanged && detectedSession) {
    messages.push({ session: detectedSession });
  }

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
