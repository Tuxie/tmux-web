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

/** Apply the opacity slider to the theme background so the WebGL renderer
 *  (and DOM/canvas, via allowTransparency) draws cell backgrounds at the
 *  requested alpha. Without this, the terminal area stays fully opaque
 *  while only the surrounding #page region gets the alpha from
 *  composeBgColor — giving opacity only "between the terminal and the border". */
export function composeTheme(theme: ITheme, opacityPct: number): ITheme {
  const bg = theme.background ?? '#000000';
  const { r, g, b } = hexToRgb(bg);
  const alpha = Math.max(0, Math.min(100, opacityPct)) / 100;
  const alphaStr = alpha === 0 ? '0' : alpha === 1 ? '1' : String(alpha);
  return { ...theme, background: `rgba(${r},${g},${b},${alphaStr})` };
}

export async function fetchColours(): Promise<Array<{ name: string; variant?: string; theme: ITheme }>> {
  const res = await fetch('/api/colours');
  if (!res.ok) return [];
  return res.json();
}
