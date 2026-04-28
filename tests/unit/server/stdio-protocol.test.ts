import { describe, expect, test } from 'bun:test';
import {
  decodeFramePayload,
  encodeFrame,
  encodePtyBytes,
  FrameDecoder,
  type StdioFrame,
} from '../../../src/server/stdio-protocol.js';

describe('stdio protocol framing', () => {
  test('encodes one JSON frame with uint32_be length prefix', () => {
    const frame: StdioFrame = { v: 1, type: 'hello' };
    const encoded = encodeFrame(frame);
    expect(encoded.readUInt32BE(0)).toBe(encoded.length - 4);
    expect(decodeFramePayload(encoded.subarray(4))).toEqual(frame);
  });

  test('decoder handles partial reads', () => {
    const decoder = new FrameDecoder();
    const encoded = encodeFrame({ v: 1, type: 'hello' });
    expect(decoder.push(encoded.subarray(0, 2))).toEqual([]);
    expect(decoder.push(encoded.subarray(2))).toEqual([{ v: 1, type: 'hello' }]);
  });

  test('decoder handles multiple frames in one chunk', () => {
    const decoder = new FrameDecoder();
    const chunk = Buffer.concat([
      encodeFrame({ v: 1, type: 'hello' }),
      encodeFrame({ v: 1, type: 'hello-ok', agentVersion: '1.10.4' }),
    ]);
    expect(decoder.push(chunk)).toEqual([
      { v: 1, type: 'hello' },
      { v: 1, type: 'hello-ok', agentVersion: '1.10.4' },
    ]);
  });

  test('pty bytes round trip through base64 payload', () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const frame = encodePtyBytes('c1', bytes);
    expect(frame).toEqual({
      v: 1,
      type: 'pty-out',
      channelId: 'c1',
      data: 'AAEC/w==',
    });
  });

  test('oversized frame throws before allocation grows unbounded', () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 8 });
    const encoded = encodeFrame({ v: 1, type: 'hello' });
    expect(() => decoder.push(encoded)).toThrow(/frame too large/);
  });
});
