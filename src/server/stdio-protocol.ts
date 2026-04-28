export const STDIO_PROTOCOL_VERSION = 1;
export const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export type StdioFrame =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'hello-ok'; agentVersion: string }
  | { v: 1; type: 'host-error'; code: string; message: string }
  | { v: 1; type: 'shutdown' }
  | { v: 1; type: 'list-sessions'; requestId: string }
  | { v: 1; type: 'sessions'; requestId: string; sessions: Array<{ id: string; name: string; windows?: number }> }
  | { v: 1; type: 'sessions-error'; requestId: string; code: string; message: string }
  | { v: 1; type: 'open'; channelId: string; session: string; cols: number; rows: number }
  | { v: 1; type: 'open-ok'; channelId: string; session: string }
  | { v: 1; type: 'pty-in' | 'pty-out'; channelId: string; data: string }
  | { v: 1; type: 'resize'; channelId: string; cols: number; rows: number }
  | { v: 1; type: 'client-msg'; channelId: string; data: string }
  | { v: 1; type: 'server-msg'; channelId: string; data: unknown }
  | { v: 1; type: 'close'; channelId: string; reason?: string }
  | { v: 1; type: 'channel-error'; channelId: string; code: string; message: string };

export function encodeFrame(frame: StdioFrame): Buffer {
  const payload = Buffer.from(JSON.stringify(frame), 'utf8');
  const out = Buffer.allocUnsafe(4 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

export function decodeFramePayload(payload: Buffer): StdioFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new Error('invalid stdio frame');
  }

  if (!isRecord(parsed) || parsed.v !== STDIO_PROTOCOL_VERSION || typeof parsed.type !== 'string') {
    throw new Error('invalid stdio frame');
  }

  const frame = canonicalizeFrame(parsed);
  if (!frame) {
    throw new Error('invalid stdio frame');
  }

  return frame;
}

export function encodePtyBytes(
  channelId: string,
  bytes: Buffer | Uint8Array,
  type: 'pty-in' | 'pty-out' = 'pty-out',
): StdioFrame {
  return { v: STDIO_PROTOCOL_VERSION, type, channelId, data: Buffer.from(bytes).toString('base64') };
}

export function decodePtyBytes(frame: Extract<StdioFrame, { type: 'pty-in' | 'pty-out' }>): Buffer {
  if (!isValidBase64(frame.data)) {
    throw new Error('invalid base64');
  }
  return Buffer.from(frame.data, 'base64');
}

export class FrameDecoder {
  private buf = Buffer.alloc(0);
  private maxFrameBytes: number;

  constructor(opts: { maxFrameBytes?: number } = {}) {
    this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  push(chunk: Buffer | Uint8Array): StdioFrame[] {
    this.buf = Buffer.concat([this.buf, Buffer.from(chunk)]);
    const frames: StdioFrame[] = [];

    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > this.maxFrameBytes) {
        throw new Error(`frame too large: ${len}`);
      }
      if (this.buf.length < 4 + len) {
        break;
      }

      const payload = this.buf.subarray(4, 4 + len);
      frames.push(decodeFramePayload(payload));
      this.buf = this.buf.subarray(4 + len);
    }

    return frames;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isValidBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length % 4 !== 0) {
    return false;
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function hasOwn(frame: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(frame, key);
}

function stringValue(frame: Record<string, unknown>, key: string): string | null {
  const value = frame[key];
  return typeof value === 'string' ? value : null;
}

function positiveIntegerValue(frame: Record<string, unknown>, key: string): number | null {
  const value = frame[key];
  return isPositiveInteger(value) ? value : null;
}

function channelIdValue(frame: Record<string, unknown>): string | null {
  return stringValue(frame, 'channelId');
}

function sessionsValue(value: unknown): Array<{ id: string; name: string; windows?: number }> | null {
  if (!Array.isArray(value)) return null;
  const out: Array<{ id: string; name: string; windows?: number }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const id = stringValue(entry, 'id');
    const name = stringValue(entry, 'name');
    if (id === null || name === null) return null;
    const windows = entry.windows;
    if (windows !== undefined && (!Number.isInteger(windows) || windows < 0)) return null;
    const session: { id: string; name: string; windows?: number } = { id, name };
    if (typeof windows === 'number') session.windows = windows;
    out.push(session);
  }
  return out;
}

function canonicalizeFrame(frame: Record<string, unknown>): StdioFrame | null {
  switch (frame.type) {
    case 'hello':
      return { v: STDIO_PROTOCOL_VERSION, type: 'hello' };
    case 'shutdown':
      return { v: STDIO_PROTOCOL_VERSION, type: 'shutdown' };
    case 'hello-ok': {
      const agentVersion = stringValue(frame, 'agentVersion');
      if (agentVersion === null) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'hello-ok', agentVersion };
    }
    case 'host-error': {
      const code = stringValue(frame, 'code');
      const message = stringValue(frame, 'message');
      if (code === null || message === null) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'host-error', code, message };
    }
    case 'list-sessions': {
      const requestId = stringValue(frame, 'requestId');
      if (requestId === null) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'list-sessions', requestId };
    }
    case 'sessions': {
      const requestId = stringValue(frame, 'requestId');
      const sessions = sessionsValue(frame.sessions);
      if (requestId === null || sessions === null) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'sessions', requestId, sessions };
    }
    case 'sessions-error': {
      const requestId = stringValue(frame, 'requestId');
      const code = stringValue(frame, 'code');
      const message = stringValue(frame, 'message');
      if (requestId === null || code === null || message === null) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'sessions-error', requestId, code, message };
    }
    case 'open': {
      const channelId = channelIdValue(frame);
      const session = stringValue(frame, 'session');
      const cols = positiveIntegerValue(frame, 'cols');
      const rows = positiveIntegerValue(frame, 'rows');
      if (channelId === null || session === null || cols === null || rows === null) {
        return null;
      }
      return {
        v: STDIO_PROTOCOL_VERSION,
        type: 'open',
        channelId,
        session,
        cols,
        rows,
      };
    }
    case 'open-ok': {
      const channelId = channelIdValue(frame);
      const session = stringValue(frame, 'session');
      if (channelId === null || session === null) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'open-ok', channelId, session };
    }
    case 'pty-in':
    case 'pty-out': {
      const channelId = channelIdValue(frame);
      if (channelId === null || !isValidBase64(frame.data)) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: frame.type, channelId, data: frame.data };
    }
    case 'resize': {
      const channelId = channelIdValue(frame);
      const cols = positiveIntegerValue(frame, 'cols');
      const rows = positiveIntegerValue(frame, 'rows');
      if (channelId === null || cols === null || rows === null) return null;
      return {
        v: STDIO_PROTOCOL_VERSION,
        type: 'resize',
        channelId,
        cols,
        rows,
      };
    }
    case 'client-msg': {
      const channelId = channelIdValue(frame);
      const data = stringValue(frame, 'data');
      if (channelId === null || data === null) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'client-msg', channelId, data };
    }
    case 'server-msg': {
      const channelId = channelIdValue(frame);
      if (channelId === null || !hasOwn(frame, 'data')) return null;
      return { v: STDIO_PROTOCOL_VERSION, type: 'server-msg', channelId, data: frame.data };
    }
    case 'close': {
      const channelId = channelIdValue(frame);
      const reason = stringValue(frame, 'reason');
      if (channelId === null || (hasOwn(frame, 'reason') && reason === null)) return null;
      if (reason !== null) {
        return { v: STDIO_PROTOCOL_VERSION, type: 'close', channelId, reason };
      }
      return { v: STDIO_PROTOCOL_VERSION, type: 'close', channelId };
    }
    case 'channel-error': {
      const channelId = channelIdValue(frame);
      const code = stringValue(frame, 'code');
      const message = stringValue(frame, 'message');
      if (channelId === null || code === null || message === null) return null;
      return {
        v: STDIO_PROTOCOL_VERSION,
        type: 'channel-error',
        channelId,
        code,
        message,
      };
    }
    default:
      return null;
  }
}
