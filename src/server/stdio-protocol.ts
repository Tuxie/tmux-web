export const STDIO_PROTOCOL_VERSION = 1;
export const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export type StdioFrame =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'hello-ok'; agentVersion: string }
  | { v: 1; type: 'host-error'; code: string; message: string }
  | { v: 1; type: 'shutdown' }
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

  if (!isValidFrame(parsed)) {
    throw new Error('invalid stdio frame');
  }

  return parsed;
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

function hasString(frame: Record<string, unknown>, key: string): boolean {
  return typeof frame[key] === 'string';
}

function hasPositiveInteger(frame: Record<string, unknown>, key: string): boolean {
  return isPositiveInteger(frame[key]);
}

function hasOwn(frame: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(frame, key);
}

function hasChannelId(frame: Record<string, unknown>): boolean {
  return hasString(frame, 'channelId');
}

function isValidFrame(frame: Record<string, unknown>): frame is StdioFrame {
  switch (frame.type) {
    case 'hello':
    case 'shutdown':
      return true;
    case 'hello-ok':
      return hasString(frame, 'agentVersion');
    case 'host-error':
      return hasString(frame, 'code') && hasString(frame, 'message');
    case 'open':
      return (
        hasChannelId(frame) &&
        hasString(frame, 'session') &&
        hasPositiveInteger(frame, 'cols') &&
        hasPositiveInteger(frame, 'rows')
      );
    case 'open-ok':
      return hasChannelId(frame) && hasString(frame, 'session');
    case 'pty-in':
    case 'pty-out':
      return hasChannelId(frame) && isValidBase64(frame.data);
    case 'resize':
      return hasChannelId(frame) && hasPositiveInteger(frame, 'cols') && hasPositiveInteger(frame, 'rows');
    case 'client-msg':
      return hasChannelId(frame) && hasString(frame, 'data');
    case 'server-msg':
      return hasChannelId(frame) && hasOwn(frame, 'data');
    case 'close':
      return hasChannelId(frame) && (!hasOwn(frame, 'reason') || hasString(frame, 'reason'));
    case 'channel-error':
      return hasChannelId(frame) && hasString(frame, 'code') && hasString(frame, 'message');
    default:
      return false;
  }
}
