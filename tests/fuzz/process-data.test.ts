import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { processData } from '../../src/server/protocol.ts';

/** processData's invariants for ANY PTY stream:
 *   - NEVER throws
 *   - `output` never contains an OSC 52 sequence (they're always stripped)
 *   - `messages.filter(m => m.clipboard)` length ≤ 8 per chunk
 *     (cluster 04's burst cap)
 *   - `readRequests` is always an array
 */

const OSC52_WRITE_RE = /\x1b\]52;[^;]*;[A-Za-z0-9+/=]+(?:\x07|\x1b\\)/;
const OSC52_READ_RE = /\x1b\]52;[^;]*;\?(?:\x07|\x1b\\)/;

describe('processData — stripping and caps', () => {
  test('does not throw on arbitrary byte streams', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      processData(s, 'main');
    }), { numRuns: 500 });
  });

  test('output never contains an OSC 52 write', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const { output } = processData(s, 'main');
      expect(OSC52_WRITE_RE.test(output)).toBe(false);
    }), { numRuns: 500 });
  });

  test('output never contains an OSC 52 read request', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const { output } = processData(s, 'main');
      expect(OSC52_READ_RE.test(output)).toBe(false);
    }), { numRuns: 500 });
  });

  test('clipboard frames per chunk are capped at 8', () => {
    // Generate 1..30 OSC 52 write frames concatenated.
    fc.assert(fc.property(
      fc.array(
        fc.constantFrom(
          '\x1b]52;c;aGVsbG8=\x07',
          '\x1b]52;c;d29ybGQ=\x07',
          '\x1b]52;c;Zm9v\x07',
        ),
        { minLength: 1, maxLength: 30 },
      ),
      (frames) => {
        const { messages } = processData(frames.join(''), 'main');
        const clips = messages.filter((m: any) => 'clipboard' in m);
        expect(clips.length).toBeLessThanOrEqual(8);
      },
    ), { numRuns: 200 });
  });

  test('readRequests is always an array', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const { readRequests } = processData(s, 'main');
      expect(Array.isArray(readRequests)).toBe(true);
    }), { numRuns: 300 });
  });

  test('oversized OSC 52 write (>1 MiB base64) is dropped silently', () => {
    // 2 MiB of 'A' — over the cap; processData should drop without throwing
    // or emitting a clipboard message.
    const huge = '\x1b]52;c;' + 'A'.repeat(2 * 1024 * 1024) + '\x07';
    const origErr = console.error;
    console.error = () => {};
    try {
      const { output, messages } = processData(huge, 'main');
      const clips = messages.filter((m: any) => 'clipboard' in m);
      expect(clips.length).toBe(0);
      expect(OSC52_WRITE_RE.test(output)).toBe(false);
    } finally {
      console.error = origErr;
    }
  });
});
