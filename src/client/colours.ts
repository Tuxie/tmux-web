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

/** Parse an `rgb(r, g, b)` or `rgba(r, g, b, a)` CSS colour string. Returns
 *  null for anything else (e.g. "transparent", images, gradients). */
function parseRgbString(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) return null;
  const a = m[4] !== undefined ? parseFloat(m[4]!) : 1;
  return { r: parseInt(m[1]!, 10), g: parseInt(m[2]!, 10), b: parseInt(m[3]!, 10), a };
}

/** Compose xterm's default cell background so the WebGL atlas rasterises
 *  glyph halos against the same colour the user actually sees behind the
 *  terminal:
 *
 *    composite = bodyBg × (1 - α) + themeBg × α
 *
 *  With allowTransparency: false the atlas fills the tmpCanvas with this
 *  opaque colour, canvas-2d subpixel AA kicks in, and clearColor strips
 *  the bg pixels back to alpha 0. The halo pixels that remain are
 *  pre-blended against the correct backdrop, so no coloured fringing
 *  appears over body-colour regions (opacity < 100).
 *
 *  The RectangleRenderer skips cells with default bg (bg === 0), so our
 *  opacity slider on #page keeps its single-layer alpha for the terminal
 *  area while cells with explicit SGR backgrounds still render opaque at
 *  their own colours. The alpha we write on the returned rgba string is
 *  always 0. xterm forces it back to 1 for the atlas (via
 *  `color.opaque`) but uses only the RGB, which is what we want. */
export function composeTheme(
  theme: ITheme,
  opacityPct: number,
  bodyBg?: string,
): ITheme {
  const bg = theme.background ?? '#000000';
  const themeRgb = hexToRgb(bg);
  const a = Math.max(0, Math.min(100, opacityPct)) / 100;
  const body = bodyBg ? parseRgbString(bodyBg) : null;
  const useBody = body && body.a > 0 && a < 1;
  const r = useBody ? Math.round(themeRgb.r * a + body.r * (1 - a)) : themeRgb.r;
  const g = useBody ? Math.round(themeRgb.g * a + body.g * (1 - a)) : themeRgb.g;
  const b = useBody ? Math.round(themeRgb.b * a + body.b * (1 - a)) : themeRgb.b;
  return { ...theme, background: `rgba(${r},${g},${b},0)` };
}

export async function fetchColours(): Promise<Array<{ name: string; variant?: string; theme: ITheme }>> {
  const res = await fetch('/api/colours');
  if (!res.ok) return [];
  return res.json();
}
