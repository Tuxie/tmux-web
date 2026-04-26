import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { extractTTMessages } from '../../src/client/protocol.ts';
import { TT_PREFIX } from '../../src/shared/constants.ts';

/** extractTTMessages invariants:
 *   - NEVER throws on any byte stream (server can push arbitrary PTY
 *     output + TT messages in any interleaving)
 *   - `terminalData` is a string; `messages` is an array
 *   - Every emitted `messages[i]` is JSON-shaped (object); malformed
 *     JSON doesn't leak a string or throw
 *   - Pass-through preservation: data with NO `\x00TT:` marker round-
 *     trips verbatim into `terminalData`
 */

describe('extractTTMessages — robustness', () => {
  test('never throws on arbitrary byte streams', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      extractTTMessages(s);
    }), { numRuns: 1000 });
  });

  test('returns a well-shaped result on any input', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const r = extractTTMessages(s);
      expect(typeof r.terminalData).toBe('string');
      expect(Array.isArray(r.messages)).toBe(true);
      for (const m of r.messages) {
        expect(m === null || typeof m === 'object').toBe(true);
      }
    }), { numRuns: 500 });
  });

  test('data with no TT marker round-trips verbatim', () => {
    fc.assert(fc.property(
      fc.string().filter(s => !s.includes(TT_PREFIX)),
      (s) => {
        const r = extractTTMessages(s);
        expect(r.terminalData).toBe(s);
        expect(r.messages).toEqual([]);
      },
    ), { numRuns: 500 });
  });

  test('well-formed TT messages round-trip their JSON payload', () => {
    fc.assert(fc.property(
      fc.record({
        prefix: fc.string().filter(s => !s.includes(TT_PREFIX)),
        payload: fc.record({
          clipboard: fc.option(fc.string()),
          session: fc.option(fc.string()),
        }),
        suffix: fc.string().filter(s => !s.includes(TT_PREFIX)),
      }),
      ({ prefix, payload, suffix }) => {
        const data = prefix + TT_PREFIX + JSON.stringify(payload) + suffix;
        const r = extractTTMessages(data);
        expect(r.messages).toHaveLength(1);
        expect(r.messages[0]).toEqual(payload);
        expect(r.terminalData).toBe(prefix + suffix);
      },
    ), { numRuns: 200 });
  });

  test('malformed JSON inside a TT frame does not throw, and is skipped', () => {
    // TT marker followed by a `{` that never closes.
    const data = 'x' + TT_PREFIX + '{ "broken"';
    const r = extractTTMessages(data);
    // The unclosed brace preserves the prefix + partial JSON in terminalData
    // rather than emitting a garbage message.
    expect(r.messages).toEqual([]);
  });

  test('adjacent TT frames both parse', () => {
    const data = TT_PREFIX + '{"session":"a"}' + TT_PREFIX + '{"session":"b"}';
    const r = extractTTMessages(data);
    expect(r.messages).toHaveLength(2);
    expect((r.messages[0] as any).session).toBe('a');
    expect((r.messages[1] as any).session).toBe('b');
    expect(r.terminalData).toBe('');
  });

  test('N concatenated TT frames all parse in order', () => {
    // Property strengthening of the "adjacent TT frames" fixture: the
    // existing round-trip test (line 45-63) filters TT_PREFIX out of
    // the prefix/suffix so adversarial prefixes can't introduce a
    // second marker. This complementary property fuzzes 0-5 concatenated
    // frames per random input to exercise the parser's framing loop on
    // every shape the production pipeline can emit (see DET in cluster
    // 21-test-organisation).
    const payloadArb = fc.record({
      clipboard: fc.option(fc.string()),
      session: fc.option(fc.string()),
    });
    fc.assert(
      fc.property(
        fc.array(payloadArb, { minLength: 0, maxLength: 5 }),
        (payloads) => {
          const data = payloads.map((p) => TT_PREFIX + JSON.stringify(p)).join('');
          const r = extractTTMessages(data);
          expect(r.messages).toHaveLength(payloads.length);
          for (let i = 0; i < payloads.length; i++) {
            expect(r.messages[i]).toEqual(payloads[i]);
          }
          expect(r.terminalData).toBe('');
        },
      ),
      { numRuns: 200 },
    );
  });
});
