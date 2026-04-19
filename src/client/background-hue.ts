export const DEFAULT_BACKGROUND_HUE = 183;
export const DEFAULT_BACKGROUND_SATURATION = 80;
export const DEFAULT_BACKGROUND_BRIGHTNESS = 8;

export function clampBackgroundHue(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_HUE;
  return Math.max(0, Math.min(360, Math.round(value)));
}

export function clampBackgroundSaturation(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_SATURATION;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampBackgroundBrightness(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_BRIGHTNESS;
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

export function applyBackgroundBrightness(
  brightness: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-background-brightness", String(clampBackgroundBrightness(brightness)));
}
