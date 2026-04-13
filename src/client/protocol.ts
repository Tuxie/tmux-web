import { TT_PREFIX } from '../shared/constants.js';
import type { ServerMessage } from '../shared/types.js';

export interface ExtractResult {
  terminalData: string;
  messages: ServerMessage[];
}

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

    for (let i = jsonStart; i < data.length; i++) {
      const ch = data[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) { jsonEnd = i + 1; break; }
      }
    }

    if (depth === 0 && jsonEnd > jsonStart) {
      try {
        messages.push(JSON.parse(data.slice(jsonStart, jsonEnd)) as ServerMessage);
      } catch { /* skip malformed */ }
      pos = jsonEnd;
    } else {
      terminalData += data.slice(ttIdx, ttIdx + TT_PREFIX.length);
      pos = jsonStart;
    }
  }
  return { terminalData, messages };
}
