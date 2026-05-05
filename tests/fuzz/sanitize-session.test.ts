import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { sanitizeSession } from '../../src/server/pty.ts';

/** sanitizeSession's contract:
 *   - output only contains [A-Za-z0-9_\-./ ] (space is allowed since v1.10.0)
 *   - output never contains `..`
 *   - output never starts or ends with `/`
 *   - output defaults to "main" when the cleaned input would be empty
 *   - NEVER throws
 */
describe('sanitizeSession — invariants hold for any Unicode input', () => {
  test('output charset is [A-Za-z0-9_\\-./ ]', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      const out = sanitizeSession(raw);
      expect(/^[A-Za-z0-9_\-./ ]*$/.test(out)).toBe(true);
    }), { numRuns: 500 });
  });

  test('output never contains `..`', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      expect(sanitizeSession(raw).includes('..')).toBe(false);
    }), { numRuns: 500 });
  });

  test('output never starts or ends with `/`', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      const out = sanitizeSession(raw);
      expect(out.startsWith('/')).toBe(false);
      expect(out.endsWith('/')).toBe(false);
    }), { numRuns: 500 });
  });

  test('output defaults to "main" when cleaned input is empty', () => {
    fc.assert(fc.property(
      // Strings that reduce to empty after cleaning: only specials.
      fc.stringMatching(/^[^A-Za-z0-9_\-./ ]*$/),
      (raw) => {
        expect(sanitizeSession(raw)).toBe('main');
      },
    ), { numRuns: 200 });
  });

  test('does not throw on any input', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      sanitizeSession(raw);
    }), { numRuns: 1000 });
  });

  test('decodes percent-encoded input before cleaning', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }).map(s => encodeURIComponent(s)),
      (encoded) => {
        // Just assert no throw + invariants.
        const out = sanitizeSession(encoded);
        expect(/^[A-Za-z0-9_\-./ ]*$/.test(out)).toBe(true);
      },
    ), { numRuns: 200 });
  });
});
