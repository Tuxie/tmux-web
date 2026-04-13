import { describe, it, expect } from 'vitest';
import { getSgrCoords, buildSgrSequence } from '../../../../src/client/ui/mouse.js';

describe('getSgrCoords', () => {
  const metrics = { width: 10, height: 20 };
  const rect = { left: 100, top: 50 } as DOMRect;

  it('computes column and row from pixel position', () => {
    expect(getSgrCoords(150, 90, metrics, rect)).toEqual({ col: 6, row: 3 });
  });
  it('clamps to minimum of 1', () => {
    expect(getSgrCoords(100, 50, metrics, rect)).toEqual({ col: 1, row: 1 });
  });
  it('handles fractional positions', () => {
    expect(getSgrCoords(105, 55, metrics, rect).col).toBe(1);
  });
  it('handles clicks deep in the terminal', () => {
    expect(getSgrCoords(300, 250, metrics, rect)).toEqual({ col: 21, row: 11 });
  });
});

describe('buildSgrSequence', () => {
  it('builds press sequence', () => {
    expect(buildSgrSequence(0, 5, 3, false)).toBe('\x1b[<0;5;3M');
  });
  it('builds release sequence', () => {
    expect(buildSgrSequence(0, 5, 3, true)).toBe('\x1b[<0;5;3m');
  });
  it('builds right-click press', () => {
    expect(buildSgrSequence(2, 10, 1, false)).toBe('\x1b[<2;10;1M');
  });
  it('builds motion sequence (button + 32)', () => {
    expect(buildSgrSequence(32, 5, 3, false)).toBe('\x1b[<32;5;3M');
  });
  it('builds wheel-up sequence', () => {
    expect(buildSgrSequence(64, 5, 3, false)).toBe('\x1b[<64;5;3M');
  });
  it('builds wheel-down sequence', () => {
    expect(buildSgrSequence(65, 5, 3, false)).toBe('\x1b[<65;5;3M');
  });
});
