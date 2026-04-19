/**
 * Theme Hue clamp/apply helpers.
 *
 * `--tw-theme-hue` on :root lets themes parametrise their GUI-chrome
 * colours via `hsl(var(--tw-theme-hue) <s>% <l>%)`. Default = 222 so
 * the Amiga Scene 2000 theme's workbench blue is unchanged; the slider
 * rotates the whole chrome (toolbars, menus, bevels, borders) but not
 * the terminal colours.
 */
import { describe, test, expect } from 'bun:test';

describe('theme-hue helpers', () => {
  test('DEFAULT_THEME_HUE is 222 (Amiga Scene workbench blue)', async () => {
    const { DEFAULT_THEME_HUE } = await import('../../../src/client/background-hue.js');
    expect(DEFAULT_THEME_HUE).toBe(222);
  });

  test('clampThemeHue wraps any finite input to the 0..360 range', async () => {
    const { clampThemeHue, DEFAULT_THEME_HUE } = await import('../../../src/client/background-hue.js');
    expect(clampThemeHue(0)).toBe(0);
    expect(clampThemeHue(360)).toBe(360);
    expect(clampThemeHue(180.4)).toBe(180);
    expect(clampThemeHue(-10)).toBe(0);
    expect(clampThemeHue(999)).toBe(360);
    expect(clampThemeHue(NaN)).toBe(DEFAULT_THEME_HUE);
  });

  test('applyThemeHue sets --tw-theme-hue on the given element', async () => {
    const { applyThemeHue } = await import('../../../src/client/background-hue.js');
    const root = {
      style: {
        _set: {} as Record<string, string>,
        setProperty(name: string, value: string) { this._set[name] = value; },
      },
    };
    applyThemeHue(140, root as any);
    expect(root.style._set['--tw-theme-hue']).toBe('140');
  });
});
