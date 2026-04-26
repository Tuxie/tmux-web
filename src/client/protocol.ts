import { TT_PREFIX } from '../shared/constants.js';
import type { ServerMessage } from '../shared/types.js';

export interface ExtractResult {
  terminalData: string;
  messages: ServerMessage[];
}

/** Defence-in-depth bounds on the TT JSON parser. The server-side
 *  framing already caps clipboard payloads at 1 MiB and OSC 52 frames
 *  per chunk (CHANGELOG 1.7.0), so a well-behaved producer never gets
 *  near these. They exist so a bug or compromise in a producer can't
 *  trick the client into walking 50 MB of nested braces character by
 *  character. Mismatches abort with a `console.warn` and fall through
 *  to the malformed-prefix fallback. */
const TT_MAX_DEPTH = 64;
const TT_MAX_LENGTH = 1024 * 1024;

export function extractTTMessages(data: string): ExtractResult {
  const messages: ServerMessage[] = [];
  let terminalData = '';
  let pos = 0;

  while (pos < data.length) {
    const ttIdx = data.indexOf(TT_PREFIX, pos);
    if (ttIdx === -1) {
      terminalData += data.slice(pos);
      break;
    }
    if (ttIdx > pos) {
      terminalData += data.slice(pos, ttIdx);
    }
    const jsonStart = ttIdx + TT_PREFIX.length;
    let depth = 0;
    let jsonEnd = jsonStart;
    let inString = false;
    let escaped = false;
    let aborted = false;

    for (let i = jsonStart; i < data.length; i++) {
      // Bound the linear walk independently of brace balance so a
      // misbehaving producer that emits `\x00TT:{{{...` without a
      // closing `}` can't make us scan the whole buffer.
      if (i - jsonStart > TT_MAX_LENGTH) {
        console.warn('TT message exceeded length bound, aborting parse');
        aborted = true;
        break;
      }
      const ch = data[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') {
        depth++;
        if (depth > TT_MAX_DEPTH) {
          console.warn('TT message exceeded depth bound, aborting parse');
          aborted = true;
          break;
        }
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) { jsonEnd = i + 1; break; }
      }
    }

    if (!aborted && depth === 0 && jsonEnd > jsonStart) {
      try {
        messages.push(JSON.parse(data.slice(jsonStart, jsonEnd)) as ServerMessage);
      } catch { /* skip malformed */ }
      pos = jsonEnd;
    } else {
      // Re-emit the four-byte `\x00TT:` prefix into the terminal stream
      // and advance past it. This is intentional rather than a silent
      // skip: WebSocket text frames are message-aligned by the spec, so
      // a partial / unbalanced JSON inside one frame indicates a
      // producer bug, not a chunk-boundary issue. Letting the prefix
      // surface as visible glyphs (`\x00` is rendered innocuously by
      // xterm; the `TT:` text is plain ASCII) makes the bug visible
      // instead of letting data silently disappear. The next iteration
      // resumes at `jsonStart`, so any well-formed message later in the
      // buffer is still extracted.
      terminalData += data.slice(ttIdx, ttIdx + TT_PREFIX.length);
      pos = jsonStart;
    }
  }
  return { terminalData, messages };
}
