import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { parseForegroundFromProc } from '../../src/server/foreground-process.ts';

/** parseForegroundFromProc invariants:
 *   - NEVER throws on any input string
 *   - Returns either null or a positive finite integer (tpgid)
 *   - `comm` field (which may contain spaces and parens) does not
 *     break the anchor on the last ')'
 */

describe('parseForegroundFromProc — robustness', () => {
  test('never throws on arbitrary /proc/*/stat-ish strings', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      parseForegroundFromProc(raw);
    }), { numRuns: 1000 });
  });

  test('returns null or a positive integer', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      const r = parseForegroundFromProc(raw);
      if (r === null) return;
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(0);
      expect(Number.isInteger(r)).toBe(true);
    }), { numRuns: 1000 });
  });

  test('parses canonical shape (comm in parens, whitespace-split tail)', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 2 ** 30 }), // tpgid
      fc.integer({ min: 1, max: 100_000 }), // pid
      fc.integer({ min: 1, max: 100_000 }), // ppid
      (tpgid, pid, ppid) => {
        // Real shape: pid (comm) state ppid pgrp session tty_nr tpgid ...
        const stat = `${pid} (bash) S ${ppid} ${ppid} ${ppid} 0 ${tpgid} 4000`;
        expect(parseForegroundFromProc(stat)).toBe(tpgid);
      },
    ), { numRuns: 200 });
  });

  test('adversarial comm with spaces and embedded parens still resolves', () => {
    const stat = `1234 (weird (process) name) S 1 1 1 0 42 0`;
    expect(parseForegroundFromProc(stat)).toBe(42);
  });

  test('missing `)` returns null without throwing', () => {
    expect(parseForegroundFromProc('no parens at all here')).toBe(null);
  });

  test('non-numeric tpgid returns null', () => {
    const stat = `1 (a) S 1 1 1 0 notanumber 0`;
    expect(parseForegroundFromProc(stat)).toBe(null);
  });

  test('zero or negative tpgid returns null', () => {
    expect(parseForegroundFromProc('1 (a) S 1 1 1 0 0 0')).toBe(null);
    expect(parseForegroundFromProc('1 (a) S 1 1 1 0 -5 0')).toBe(null);
  });
});
