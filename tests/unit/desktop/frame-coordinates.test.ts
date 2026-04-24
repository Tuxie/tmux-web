import { describe, expect, test } from 'bun:test';
import { toNativeWindowFrame } from '../../../src/desktop/frame-coordinates.js';
import type { Display } from '../../../src/desktop/display-workarea.js';

describe('desktop frame coordinate conversion', () => {
  const primary: Display = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 25, width: 1440, height: 875 },
    scaleFactor: 1,
    isPrimary: true,
  };
  const secondary: Display = {
    id: 2,
    bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1440, y: 40, width: 1920, height: 1040 },
    scaleFactor: 1,
    isPrimary: false,
  };

  test('converts a top-left frame into native bottom-left coordinates across all displays', () => {
    const nativeFrame = toNativeWindowFrame(
      { x: 1440, y: 40, width: 1920, height: 1040 },
      [primary, secondary],
    );

    expect(nativeFrame).toEqual({ x: 1440, y: 0, width: 1920, height: 1040 });
  });

  test('returns the input frame unchanged when no displays are available', () => {
    const nativeFrame = toNativeWindowFrame(
      { x: 10, y: 20, width: 300, height: 200 },
      [],
    );

    expect(nativeFrame).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });
});
