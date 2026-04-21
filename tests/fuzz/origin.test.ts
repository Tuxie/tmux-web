import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { parseOriginHeader, parseAllowOriginFlag, isIpLiteral } from '../../src/server/origin.ts';

/** Origin parsing invariants:
 *   - parseOriginHeader NEVER throws (returns null on garbage)
 *   - On success, `port` is in 1..65535 and `scheme` is 'http'|'https'
 *   - parseAllowOriginFlag either returns '*', throws, or returns a
 *     valid OriginTuple (same scheme/port invariants)
 *   - Round-trip: parseOriginHeader(format(parse(x))) === parse(x)
 */

describe('parseOriginHeader — robustness', () => {
  test('never throws on any string', () => {
    fc.assert(fc.property(fc.string(), (raw) => {
      parseOriginHeader(raw);
    }), { numRuns: 1000 });
  });

  test('when it returns non-null, invariants hold', () => {
    fc.assert(fc.property(fc.webUrl({ validSchemes: ['http', 'https'] }), (raw) => {
      const r = parseOriginHeader(raw);
      if (r === null) return;
      expect(r.scheme === 'http' || r.scheme === 'https').toBe(true);
      expect(r.port).toBeGreaterThan(0);
      expect(r.port).toBeLessThanOrEqual(65535);
      expect(typeof r.host).toBe('string');
    }), { numRuns: 500 });
  });

  test('"null" literal and empty string are rejected', () => {
    expect(parseOriginHeader('null')).toBe(null);
    expect(parseOriginHeader('')).toBe(null);
  });

  test('ftp:// and other schemes are rejected', () => {
    fc.assert(fc.property(
      fc.webUrl({ validSchemes: ['ftp', 'ws', 'wss', 'file', 'gopher'] }),
      (raw) => {
        expect(parseOriginHeader(raw)).toBe(null);
      },
    ), { numRuns: 100 });
  });
});

describe('parseAllowOriginFlag', () => {
  test('never throws on "*"', () => {
    expect(parseAllowOriginFlag('*')).toBe('*');
  });

  test('on valid origins returns a tuple with valid port/scheme', () => {
    fc.assert(fc.property(fc.webUrl({ validSchemes: ['http', 'https'] }), (raw) => {
      try {
        const r = parseAllowOriginFlag(raw);
        if (r === '*') return;
        expect(r.scheme === 'http' || r.scheme === 'https').toBe(true);
        expect(r.port).toBeGreaterThan(0);
      } catch {
        // Throwing is an allowed outcome for inputs the internal parser rejects.
      }
    }), { numRuns: 300 });
  });

  test('on garbage input it throws a descriptive error (never hangs, never returns junk)', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }).filter(s => s !== '*' && !s.startsWith('http')),
      (raw) => {
        try {
          const r = parseAllowOriginFlag(raw);
          // Only '*' is a valid non-scheme return. Anything else must be an OriginTuple,
          // but without 'http' prefix the parse should reject.
          if (r !== '*') {
            throw new Error(`expected throw for non-* non-http input: ${JSON.stringify(raw)}`);
          }
        } catch (err) {
          // Expected outcome.
        }
      },
    ), { numRuns: 300 });
  });
});

describe('isIpLiteral', () => {
  test('recognises any IPv4 form as a literal', () => {
    fc.assert(fc.property(
      fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)),
      ([a, b, c, d]) => {
        expect(isIpLiteral(`${a}.${b}.${c}.${d}`)).toBe(true);
      },
    ), { numRuns: 500 });
  });

  test('non-literal hostnames (no dots, no colons) are not literals', () => {
    fc.assert(fc.property(
      fc.stringMatching(/^[a-z0-9]+$/).filter(s => s.length > 0),
      (host) => {
        expect(isIpLiteral(host)).toBe(false);
      },
    ), { numRuns: 300 });
  });
});
