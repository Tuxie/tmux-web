import { describe, test } from 'bun:test';
import fc from 'fast-check';
import { ControlParser, parseNotification } from '../../src/server/tmux-control.ts';

/** ControlParser invariants:
 *   - NEVER throws on any byte stream (the parser sits on a high-volume
 *     bytestream from local tmux; a regression that crashes it crashes
 *     the whole control client).
 *   - Holds across split-push boundaries: the same total bytes pushed
 *     in any chunking can't crash.
 *   - parseNotification() never throws on any line input either —
 *     ControlParser delegates to it for every `%`-prefixed line outside
 *     an envelope.
 *
 * Trust boundary: bytes come from the local tmux process, not a remote
 * peer, so this is a defense-in-depth fuzz rather than a security-sensitive
 * one. Filed at Low severity in cluster
 * docs/code-analysis/2026-04-26/clusters/21-test-organisation.md (FUZZ-1).
 */

const noopCallbacks = {
  onBegin: () => {},
  onResponse: () => {},
  onError: () => {},
  onNotification: () => {},
};

describe('ControlParser — robustness', () => {
  test('never throws on arbitrary byte streams', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const p = new ControlParser(noopCallbacks);
        p.push(s);
      }),
      { numRuns: 1000 },
    );
  });

  test('never throws when the same bytes arrive in arbitrary chunks', () => {
    fc.assert(
      fc.property(
        fc.string(),
        // Up to 8 chunk boundaries cover the realistic split shapes
        // (tmux normally line-buffers but socket boundaries can split
        // anywhere).
        fc.array(fc.nat(), { maxLength: 8 }),
        (s, splitsRaw) => {
          const p = new ControlParser(noopCallbacks);
          // Convert splitsRaw into in-range, sorted, unique offsets.
          const offsets = Array.from(
            new Set(splitsRaw.map((n) => (s.length === 0 ? 0 : n % (s.length + 1)))),
          ).sort((a, b) => a - b);
          let prev = 0;
          for (const o of offsets) {
            p.push(s.slice(prev, o));
            prev = o;
          }
          p.push(s.slice(prev));
        },
      ),
      { numRuns: 500 },
    );
  });

  test('never throws on synthetic envelope-shaped bytes', () => {
    // Build inputs that look like real control-mode framing so the
    // envelope branch (line 68-86 in tmux-control.ts) gets exercised
    // beyond what fc.string() is likely to stumble into.
    const envelopeArb = fc.tuple(
      fc.nat(),
      fc.nat(),
      fc.nat(),
      fc.array(fc.string({ minLength: 0, maxLength: 30 }), { maxLength: 5 }),
      fc.constantFrom('%end', '%error'),
    ).map(([ts, cmdnum, flags, lines, closer]) => {
      const body = lines.join('\n');
      return `%begin ${ts} ${cmdnum} ${flags}\n${body}\n${closer} ${ts} ${cmdnum} ${flags}\n`;
    });

    fc.assert(
      fc.property(fc.array(envelopeArb, { maxLength: 5 }), (envelopes) => {
        const p = new ControlParser(noopCallbacks);
        p.push(envelopes.join(''));
      }),
      { numRuns: 300 },
    );
  });

  test('parseNotification never throws on any line', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseNotification(s);
      }),
      { numRuns: 1000 },
    );
  });
});
