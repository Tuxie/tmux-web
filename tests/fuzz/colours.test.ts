import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { normalize, alacrittyTomlToITheme } from '../../src/server/colours.ts';

/** colours.ts eats user-supplied theme TOML. Invariants:
 *   - `normalize(unknown)` never throws; returns a `#xxxxxx` hex string
 *     or undefined
 *   - `alacrittyTomlToITheme(string)` either throws with a known error
 *     or returns an object whose every value is a valid `#xxxxxx` hex
 *   - No output field is empty / non-string / contains ESC sequences
 */

describe('normalize — hex colour coercion', () => {
  test('never throws on any input type', () => {
    fc.assert(fc.property(
      fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)),
      (v) => { normalize(v); },
    ), { numRuns: 500 });
  });

  // fast-check 4.x removed fc.hexaString; build a 6-hex arbitrary from
  // a bounded integer instead — identical distribution, one line.
  const hex6 = fc.integer({ min: 0, max: 0xffffff })
    .map((n) => n.toString(16).padStart(6, '0'));

  test('valid #RRGGBB inputs pass through normalised to lowercase', () => {
    fc.assert(fc.property(hex6, (hex) => {
      expect(normalize('#' + hex)).toBe('#' + hex.toLowerCase());
    }), { numRuns: 500 });
  });

  test('0xRRGGBB inputs are accepted and normalised', () => {
    fc.assert(fc.property(hex6, (hex) => {
      expect(normalize('0x' + hex)).toBe('#' + hex.toLowerCase());
    }), { numRuns: 300 });
  });

  test('anything without a recognised prefix returns undefined', () => {
    fc.assert(fc.property(
      fc.string().filter(s => !s.startsWith('#') && !s.startsWith('0x') && !s.startsWith('0X')),
      (raw) => {
        expect(normalize(raw)).toBe(undefined);
      },
    ), { numRuns: 300 });
  });
});

describe('alacrittyTomlToITheme — adversarial TOML input', () => {
  test('either throws or returns an object with only valid hex string values', () => {
    fc.assert(fc.property(fc.string(), (src) => {
      let theme: any;
      try { theme = alacrittyTomlToITheme(src); }
      catch { return; }
      expect(typeof theme).toBe('object');
      for (const v of Object.values(theme)) {
        expect(typeof v).toBe('string');
        expect(/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v as string)).toBe(true);
      }
    }), { numRuns: 500 });
  });

  test('missing [colors.primary] throws a descriptive error', () => {
    const noPrimary = '[colors.normal]\nblack = "#000000"\n';
    expect(() => alacrittyTomlToITheme(noPrimary)).toThrow(/primary/);
  });

  test('well-formed minimal theme produces a valid ITheme', () => {
    const toml = `
[colors.primary]
foreground = "#ffffff"
background = "#000000"
`;
    const t = alacrittyTomlToITheme(toml);
    expect(t.foreground).toBe('#ffffff');
    expect(t.background).toBe('#000000');
  });
});
