import { describe, expect, test } from 'bun:test';
import { workAreaForFrame, type Display } from '../../../src/desktop/display-workarea.js';

describe('desktop display work area selection', () => {
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
    workArea: { x: 1440, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
    isPrimary: false,
  };

  test('chooses the display with the largest overlap with the current window frame', () => {
    const workArea = workAreaForFrame(
      { x: 1500, y: 100, width: 900, height: 600 },
      [primary, secondary],
      primary.workArea,
    );

    expect(workArea).toEqual({ x: 1440, y: 40, width: 1920, height: 1040 });
  });

  test('falls back to nearest display center when there is no overlap', () => {
    const workArea = workAreaForFrame(
      { x: 3800, y: 100, width: 500, height: 500 },
      [primary, secondary],
      primary.workArea,
    );

    expect(workArea).toEqual({ x: 1440, y: 40, width: 1920, height: 1040 });
  });

  test('falls back to the primary work area when no displays are available', () => {
    const workArea = workAreaForFrame(
      { x: 1500, y: 100, width: 900, height: 600 },
      [],
      primary.workArea,
    );

    expect(workArea).toEqual(primary.workArea);
  });

  test('keeps global workArea coordinates when the chosen display already reports global positioning', () => {
    const workArea = workAreaForFrame(
      { x: 1500, y: 100, width: 900, height: 600 },
      [primary, secondary],
      primary.workArea,
    );

    expect(workArea).toEqual({ x: 1440, y: 40, width: 1920, height: 1040 });
  });

  test('converts monitor-local workArea coordinates into global coordinates for secondary displays', () => {
    const localSecondary: Display = {
      ...secondary,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    };

    const workArea = workAreaForFrame(
      { x: 1500, y: 100, width: 900, height: 600 },
      [primary, localSecondary],
      primary.workArea,
    );

    expect(workArea).toEqual({ x: 1440, y: 40, width: 1920, height: 1040 });
  });

  test('chooses the vertically flipped monitor-local workArea when it better matches the current window position', () => {
    const localSecondary: Display = {
      ...secondary,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    };

    const workArea = workAreaForFrame(
      { x: 1500, y: 60, width: 900, height: 600 },
      [primary, localSecondary],
      primary.workArea,
    );

    expect(workArea).toEqual({ x: 1440, y: 40, width: 1920, height: 1040 });
  });

  test('uses the monitor-top anchored y from the logged macOS secondary display geometry', () => {
    const macPrimary: Display = {
      id: 3,
      bounds: { x: 0, y: 0, width: 3840, height: 2160 },
      workArea: { x: 0, y: 30, width: 3840, height: 2130 },
      scaleFactor: 1,
      isPrimary: true,
    };
    const macSecondary: Display = {
      id: 1,
      bounds: { x: -1800, y: 386, width: 1800, height: 1169 },
      workArea: { x: -1800, y: 425, width: 1800, height: 1130 },
      scaleFactor: 2,
      isPrimary: false,
    };

    const workArea = workAreaForFrame(
      { x: -1230, y: -486, width: 1200, height: 760 },
      [macPrimary, macSecondary],
      macPrimary.workArea,
    );

    expect(workArea).toEqual({ x: -1800, y: 386, width: 1800, height: 1130 });
  });
});
