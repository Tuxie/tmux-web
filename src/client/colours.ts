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

/**
 * Returns the rgba() colour string for the #terminal element's background-color.
 * The terminal div sits between the body (which shows the wallpaper / theme background)
 * and the xterm viewport (which is kept fully transparent). Controlling the opacity of
 * this element fades the theme colour in over the body background.
 */
export function composeBgColor(theme: ITheme, opacityPct: number): string {
  const bg = theme.background ?? '#000000';
  const { r, g, b } = hexToRgb(bg);
  const alpha = Math.max(0, Math.min(100, opacityPct)) / 100;
  const alphaStr = alpha === 0 ? '0' : alpha === 1 ? '1' : String(alpha);
  return `rgba(${r},${g},${b},${alphaStr})`;
}

/**
 * Returns the xterm ITheme with a transparent background so the #terminal element
 * background-color (set via composeBgColor) shows through.
 */
export function composeTheme(theme: ITheme): ITheme {
  return { ...theme, background: 'transparent' };
}

export async function fetchColours(): Promise<Array<{ name: string; variant?: string; theme: ITheme }>> {
  const res = await fetch('/api/colours');
  if (!res.ok) return [];
  return res.json();
}
