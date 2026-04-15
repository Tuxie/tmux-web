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

    return true;
  } catch {
    return true;
  }
}

export function setTopbarAutohide(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {}
}
