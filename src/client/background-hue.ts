export const DEFAULT_BACKGROUND_HUE = 183;

export function clampBackgroundHue(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_HUE;
  return Math.max(0, Math.min(360, Math.round(value)));
}

export function applyBackgroundHue(
  hue: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-background-hue", String(clampBackgroundHue(hue)));
}
