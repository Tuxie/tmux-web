export const DEFAULT_BACKGROUND_HUE = 183;
/**
 * BG Saturation is now a delta from the theme's baseline (same
 * semantics as the Terminal Saturation slider): -100 = greyscale,
 * 0 = use the theme's natural saturation, +100 = double it (clamped
 * at 100% in HSL). The effective CSS percent is computed in
 * `applyBackgroundSaturation` as `BASE × (1 + delta/100)`.
 */
export const DEFAULT_BACKGROUND_SATURATION = 0;
/** Baseline HSL saturation percent the BG Saturation slider's delta
 *  scales against. Matches scene.css's pre-slider fallback (80%). */
export const BASE_BACKGROUND_SATURATION_PCT = 80;
/** HSL lightness (%) of the gradient's brightest stop (center in scene.css). */
export const DEFAULT_BACKGROUND_BRIGHTEST = 10;
/** HSL lightness (%) of the gradient's darkest stop (outer edge in scene.css). */
export const DEFAULT_BACKGROUND_DARKEST = 5;
/** Hue used by themes for GUI chrome (toolbars, menus, bevels, borders)
 *  via `hsl(var(--tw-theme-hue) S% L%)`. 222 matches Amiga Scene 2000's
 *  existing Workbench blue so the slider's default renders identically
 *  to the pre-feature theme. */
export const DEFAULT_THEME_HUE = 222;

export function clampBackgroundHue(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_HUE;
  return Math.max(0, Math.min(360, Math.round(value)));
}

export function clampThemeHue(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THEME_HUE;
  return Math.max(0, Math.min(360, Math.round(value)));
}

export function clampBackgroundSaturation(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_SATURATION;
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function clampBackgroundBrightest(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_BRIGHTEST;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampBackgroundDarkest(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_DARKEST;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function applyBackgroundHue(
  hue: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-background-hue", String(clampBackgroundHue(hue)));
}

export function applyThemeHue(
  hue: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-theme-hue", String(clampThemeHue(hue)));
}

/**
 * Scale the theme's baseline gradient saturation by `1 + delta/100`.
 * Writes the final percent (not the raw delta) into
 * `--tw-background-saturation` so themes can keep using
 * `hsl(H calc(var(--tw-background-saturation) * 1%) L%)` unchanged.
 */
export function applyBackgroundSaturation(
  saturationDelta: number,
  root: HTMLElement = document.documentElement,
): void {
  const delta = clampBackgroundSaturation(saturationDelta);
  const factor = 1 + delta / 100;
  const effective = Math.max(0, Math.min(100, Math.round(BASE_BACKGROUND_SATURATION_PCT * factor)));
  root.style.setProperty("--tw-background-saturation", String(effective));
}

export function applyBackgroundBrightest(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-background-brightest", String(clampBackgroundBrightest(value)));
}

export function applyBackgroundDarkest(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-background-darkest", String(clampBackgroundDarkest(value)));
}

export const DEFAULT_THEME_SAT = 0;
export const DEFAULT_THEME_LTN = 15;
export const DEFAULT_THEME_CONTRAST = 0;

export function clampThemeSat(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THEME_SAT;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampThemeLtn(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THEME_LTN;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampThemeContrast(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THEME_CONTRAST;
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function applyThemeSat(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-theme-sat", clampThemeSat(value) + "%");
}

export function applyThemeLtn(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-theme-ltn", clampThemeLtn(value) + "%");
}

export function applyThemeContrast(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  const v = clampThemeContrast(value);
  const factor = v < 0 ? (v + 100) / 100 : 1 + 2 * v / 100;
  root.style.setProperty("--tw-theme-contrast", String(factor));
}

export const DEFAULT_DEPTH = 20;

export function clampDepth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DEPTH;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function applyDepth(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  const clamped = clampDepth(value);
  root.style.setProperty("--tw-depth", String(clamped / 100));
}
