import { describe, expect, test } from 'bun:test';
import {
  decodeFramePayload,
  decodePtyBytes,
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

  test('decodes valid pty bytes from base64 payload', () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const frame = encodePtyBytes('c1', bytes);
    expect(decodePtyBytes(frame)).toEqual(bytes);
  });

  test('rejects malformed pty base64 payloads', () => {
    expect(() =>
      decodePtyBytes({
        v: 1,
        type: 'pty-out',
        channelId: 'c1',
        data: 'not base64??',
      }),
    ).toThrow(/invalid base64/);
  });

  test('rejects open frames missing required fields', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, type: 'open' }));
    expect(() => decodeFramePayload(payload)).toThrow(/invalid stdio frame/);
  });

  test('rejects unknown frame types', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, type: 'bogus' }));
    expect(() => decodeFramePayload(payload)).toThrow(/invalid stdio frame/);
  });

  test('rejects channel frames with wrong field types', () => {
    const payload = Buffer.from(
      JSON.stringify({ v: 1, type: 'resize', channelId: 'c1', cols: '80', rows: 24 }),
    );
    expect(() => decodeFramePayload(payload)).toThrow(/invalid stdio frame/);
  });

  test('canonicalizes hello frames by removing extra fields', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, type: 'hello', channelId: 'smuggled' }));
    expect(decodeFramePayload(payload)).toEqual({ v: 1, type: 'hello' });
  });

  test('canonicalizes channel frames by removing extra fields', () => {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        type: 'open',
        channelId: 'c1',
        session: 'main',
        cols: 80,
        rows: 24,
        unexpected: true,
      }),
    );
    expect(decodeFramePayload(payload)).toEqual({
      v: 1,
      type: 'open',
      channelId: 'c1',
      session: 'main',
      cols: 80,
      rows: 24,
    });
  });

  test('oversized frame throws before allocation grows unbounded', () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 8 });
    const encoded = encodeFrame({ v: 1, type: 'hello' });
    expect(() => decoder.push(encoded)).toThrow(/frame too large/);
  });
});
