import { describe, it, expect } from 'vitest';
import { buildCsiU, getModifierCode } from '../../../../src/client/ui/keyboard.js';

describe('getModifierCode', () => {
  it('returns 2 for Shift only', () => {
    expect(getModifierCode({ shiftKey: true, altKey: false, ctrlKey: false, metaKey: false })).toBe(2);
  });
  it('returns 4 for Shift+Alt', () => {
    expect(getModifierCode({ shiftKey: true, altKey: true, ctrlKey: false, metaKey: false })).toBe(4);
  });
  it('returns 5 for Ctrl only', () => {
    expect(getModifierCode({ shiftKey: false, altKey: false, ctrlKey: true, metaKey: false })).toBe(5);
  });
  it('returns 1 when no modifiers', () => {
    expect(getModifierCode({ shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })).toBe(1);
  });
});

describe('buildCsiU', () => {
  it('builds Shift+Enter sequence', () => {
    expect(buildCsiU(13, 2)).toBe('\x1b[13;2u');
  });
  it('builds Shift+Tab sequence', () => {
    expect(buildCsiU(9, 2)).toBe('\x1b[9;2u');
  });
  it('builds Ctrl+Backspace sequence', () => {
    expect(buildCsiU(127, 5)).toBe('\x1b[127;5u');
  });
  it('builds Shift+Escape sequence', () => {
    expect(buildCsiU(27, 2)).toBe('\x1b[27;2u');
  });
});
