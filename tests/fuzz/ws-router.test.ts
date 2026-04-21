import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { routeClientMessage } from '../../src/server/ws-router.ts';

/** routeClientMessage's contract for any string payload:
 *   - NEVER throws
 *   - Returns an array of WsActions
 *   - Non-JSON (not starting with `{`) becomes exactly one `pty-write`
 *   - Malformed JSON also degrades gracefully to pty-write
 *   - Typed messages (resize/window/session/colour-variant/etc.)
 *     produce 1 action; unknown `type` values produce [] or pty-write
 */

const emptyState = () => ({
  pendingReads: new Map<string, { exePath: string | null }>(),
});

describe('routeClientMessage — robustness', () => {
  test('never throws on arbitrary strings', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      routeClientMessage(raw, emptyState());
    }), { numRuns: 1000 });
  });

  test('always returns an array', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      const actions = routeClientMessage(raw, emptyState());
      expect(Array.isArray(actions)).toBe(true);
    }), { numRuns: 500 });
  });

  test('non-brace-prefix payloads pass through as pty-write', () => {
    fc.assert(fc.property(
      fc.string().filter(s => !s.startsWith('{')),
      (raw) => {
        const actions = routeClientMessage(raw, emptyState());
        expect(actions).toEqual([{ type: 'pty-write', data: raw }]);
      },
    ), { numRuns: 500 });
  });

  test('malformed JSON degrades to pty-write', () => {
    fc.assert(fc.property(
      // Starts with `{` but is not valid JSON.
      fc.string().map(s => '{' + s.replace(/[{}]/g, '')),
      (raw) => {
        const actions = routeClientMessage(raw, emptyState());
        expect(actions.length).toBeGreaterThanOrEqual(0);
        for (const a of actions) expect(typeof a.type).toBe('string');
      },
    ), { numRuns: 500 });
  });

  test('valid resize messages route to exactly one pty-resize', () => {
    fc.assert(fc.property(
      fc.record({
        type: fc.constant('resize'),
        cols: fc.integer({ min: 1, max: 500 }),
        rows: fc.integer({ min: 1, max: 200 }),
      }),
      (msg) => {
        const actions = routeClientMessage(JSON.stringify(msg), emptyState());
        expect(actions).toEqual([{ type: 'pty-resize', cols: msg.cols, rows: msg.rows }]);
      },
    ), { numRuns: 200 });
  });

  test('unknown `type` fields route to nothing or an empty array', () => {
    fc.assert(fc.property(
      fc.record({
        type: fc.string({ minLength: 1 }).filter(s =>
          ![ 'resize', 'window', 'session', 'colour-variant',
             'clipboard-decision', 'clipboard-read-reply' ].includes(s)),
      }),
      (msg) => {
        const actions = routeClientMessage(JSON.stringify(msg), emptyState());
        // Unknown type → either [] or degraded to pty-write.
        for (const a of actions) {
          expect(['pty-write']).toContain(a.type);
        }
      },
    ), { numRuns: 300 });
  });
});
