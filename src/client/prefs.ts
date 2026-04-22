const KEY = 'tmux-web-topbar-autohide';
const LEGACY_SETTINGS_COOKIE = 'tmux-web-settings';

function readLegacyTopbarAutohideCookie(): boolean | null {
  try {
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookies = decodedCookie.split(';');
    const name = LEGACY_SETTINGS_COOKIE + '=';

    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      if (!trimmed.startsWith(name)) {
        continue;
      }

      const payload = trimmed.substring(name.length);
      const parsed = JSON.parse(payload) as { topbarAutohide?: unknown };
      return typeof parsed.topbarAutohide === 'boolean' ? parsed.topbarAutohide : null;
    }
  } catch {}

  return null;
}

export function getTopbarAutohide(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === '1') {
      return true;
    }
    if (raw === '0') {
      return false;
    }

    const legacyValue = readLegacyTopbarAutohideCookie();
    if (legacyValue !== null) {
      localStorage.setItem(KEY, legacyValue ? '1' : '0');
      return legacyValue;
    }

    return false;
  } catch {
    return false;
  }
}

export function setTopbarAutohide(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {}
}

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
