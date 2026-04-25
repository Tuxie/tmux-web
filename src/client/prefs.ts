/** Subpixel AA toggle, stored per font family. Default on for every
 *  font: canvas-2D's LCD subpixel AA path noticeably improves even
 *  bitmap fonts at non-native sizes, and at native sizes there are
 *  no AA edges to degrade either way. Users who prefer the
 *  transparent-atlas path for a specific font (e.g. to chase halo
 *  fringing at extreme Contrast/Bias) can opt out via the Subpixel
 *  AA checkbox; the choice persists here, keyed by font family.
 *
 *  LocalStorage key: `tmux-web-subpixel-aa:<fontFamily>`. */
const SUBPIXEL_AA_KEY_PREFIX = 'tmux-web-subpixel-aa:';

export function getFontSubpixelAA(fontFamily: string): boolean {
  try {
    const raw = localStorage.getItem(SUBPIXEL_AA_KEY_PREFIX + fontFamily);
    if (raw === '0') return false;
  } catch {}
  return true;
}

export function setFontSubpixelAA(fontFamily: string, value: boolean): void {
  try {
    localStorage.setItem(SUBPIXEL_AA_KEY_PREFIX + fontFamily, value ? '1' : '0');
  } catch {}
}

const SHOW_WINDOW_TABS_KEY = 'tmux-web-show-window-tabs';

/** Default: true (classic one-button-per-window tab strip). */
export function getShowWindowTabs(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_WINDOW_TABS_KEY);
    if (raw === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export function setShowWindowTabs(value: boolean): void {
  try {
    localStorage.setItem(SHOW_WINDOW_TABS_KEY, value ? '1' : '0');
  } catch {}
}
