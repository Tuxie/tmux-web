import type { ITheme } from '../shared/types.js';

export type { ITheme };

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace(/^#/, '');
  const six = s.length >= 6 ? s.slice(0, 6) : s.padStart(6, '0');
  return {
    r: parseInt(six.slice(0, 2), 16),
    g: parseInt(six.slice(2, 4), 16),
    b: parseInt(six.slice(4, 6), 16),
  };
}

/** rgba() string for #terminal's background-color, controlled by the opacity slider. */
export function composeBgColor(theme: ITheme, opacityPct: number): string {
  const bg = theme.background ?? '#000000';
  const { r, g, b } = hexToRgb(bg);
  const alpha = Math.max(0, Math.min(100, opacityPct)) / 100;
  const alphaStr = alpha === 0 ? '0' : alpha === 1 ? '1' : String(alpha);
  return `rgba(${r},${g},${b},${alphaStr})`;
}

/** Make xterm's default cell background fully transparent. The opacity
 *  slider is applied by composeBgColor on #page instead — this keeps the
 *  terminal area and its surround at identical alpha at every slider
 *  position. Applying alpha on BOTH layers double-composites and produces
 *  a visibly darker terminal region at intermediate opacities.
 *
 *  The RGB is kept (from theme.background) so xterm's contrast math,
 *  inverse-video, and dim-text calculations still reference the theme's
 *  "default" colour even though the alpha is zero. Cells with explicit
 *  non-default bg (from SGR 40-47 / 100-107) still render opaque, which
 *  matches the see-through-terminal UX of Alacritty and Kitty. */
export function composeTheme(theme: ITheme, _opacityPct: number): ITheme {
  const bg = theme.background ?? '#000000';
  const { r, g, b } = hexToRgb(bg);
  return { ...theme, background: `rgba(${r},${g},${b},0)` };
}

export async function fetchColours(): Promise<Array<{ name: string; variant?: string; theme: ITheme }>> {
  const res = await fetch('/api/colours');
  if (!res.ok) return [];
  return res.json();
}
