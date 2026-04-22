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

/** Subpixel AA toggle, stored per font family. Smooth vector fonts
 *  (Iosevka, etc.) benefit from xterm's `allowTransparency: false`
 *  atlas rasterisation — canvas-2D uses LCD subpixel AA against the
 *  opaque atlas backdrop, giving crisp edges. Bitmap fonts (the Amiga
 *  pack) don't have AA edges at all; the opaque-atlas trick only
 *  costs them halo-correctness (atlas halo bg ≠ actual visible bg →
 *  fringing) without any benefit. This pref lets the user (or a
 *  known-bitmap default below) opt out of the subpixel-AA path per
 *  font.
 *
 *  LocalStorage key: `tmux-web-subpixel-aa:<fontFamily>`. Absent key
 *  → fall through to `BITMAP_FONT_DEFAULT_OFF` → default true. */
const SUBPIXEL_AA_KEY_PREFIX = 'tmux-web-subpixel-aa:';

const BITMAP_FONT_DEFAULT_OFF: ReadonlySet<string> = new Set([
  'Topaz8 Amiga1200 Nerd Font',
  'MicroKnight Nerd Font',
  'mOsOul Nerd Font',
]);

export function getFontSubpixelAA(fontFamily: string): boolean {
  try {
    const raw = localStorage.getItem(SUBPIXEL_AA_KEY_PREFIX + fontFamily);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {}
  return !BITMAP_FONT_DEFAULT_OFF.has(fontFamily);
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
