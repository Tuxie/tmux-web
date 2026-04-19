export const DEFAULT_BACKGROUND_HUE = 183;
export const DEFAULT_BACKGROUND_SATURATION = 80;
/** HSL lightness (%) of the gradient's brightest stop (center in scene.css). */
export const DEFAULT_BACKGROUND_BRIGHTEST = 10;
/** HSL lightness (%) of the gradient's darkest stop (outer edge in scene.css). */
export const DEFAULT_BACKGROUND_DARKEST = 5;

export function clampBackgroundHue(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_HUE;
  return Math.max(0, Math.min(360, Math.round(value)));
}

export function clampBackgroundSaturation(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_SATURATION;
  return Math.max(0, Math.min(100, Math.round(value)));
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

export function applyBackgroundSaturation(
  saturation: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-background-saturation", String(clampBackgroundSaturation(saturation)));
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
