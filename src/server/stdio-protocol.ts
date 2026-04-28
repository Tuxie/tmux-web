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
  const parsed = JSON.parse(payload.toString('utf8'));
  if (!parsed || parsed.v !== STDIO_PROTOCOL_VERSION || typeof parsed.type !== 'string') {
    throw new Error('invalid stdio frame');
  }
  return parsed as StdioFrame;
}

export function encodePtyBytes(
  channelId: string,
  bytes: Buffer | Uint8Array,
  type: 'pty-in' | 'pty-out' = 'pty-out',
): StdioFrame {
  return { v: STDIO_PROTOCOL_VERSION, type, channelId, data: Buffer.from(bytes).toString('base64') };
}

export function decodePtyBytes(frame: Extract<StdioFrame, { type: 'pty-in' | 'pty-out' }>): Buffer {
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
