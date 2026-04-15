export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  lineHeightPerFont?: {
    [fontName: string]: number;
  };
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontFamily: 'Iosevka Nerd Font Mono',
  fontSize: 18,
  lineHeight: 0.85,
};

const COOKIE_NAME = 'tmux-web-settings';

interface AllSettings extends TerminalSettings {
  topbarAutohide?: boolean;
  terminal?: string;
  theme?: string;
  themeFontTouched?: Record<string, boolean>;
}

function getCookie(): AllSettings {
  const name = COOKIE_NAME + '=';
  const decodedCookie = decodeURIComponent(document.cookie);
  const cookies = decodedCookie.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(name)) {
      try {
        return JSON.parse(trimmed.substring(name.length));
      } catch {
        return {};
      }
    }
  }
  return {};
}

function setCookie(value: AllSettings): void {
  // Set cookie with 1 year expiration
  const date = new Date();
  date.setTime(date.getTime() + 365 * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + date.toUTCString();
  document.cookie = COOKIE_NAME + '=' + encodeURIComponent(JSON.stringify(value)) + '; ' + expires + '; path=/';
}

const SS_KEY = 'tmux-web-settings';

export function loadSettings(): TerminalSettings {
  // sessionStorage persists across page.reload() but not across new page loads.
  // This lets user-applied settings survive ghostty's location.reload() even
  // when a test's addInitScript has already overwritten the cookie.
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (raw) {
      const ss = JSON.parse(raw) as AllSettings;
      // Restore the cookie so other callers (getTopbarAutohide etc.) see the
      // correct values even after the cookie was overwritten by init scripts.
      const all = getCookie();
      setCookie({ ...all, ...ss });
      return { ...DEFAULT_SETTINGS, ...ss };
    }
  } catch {}
  const all = getCookie();
  return { ...DEFAULT_SETTINGS, ...all };
}

export function saveSettings(s: TerminalSettings): void {
  const all = getCookie();
  const merged = { ...all, ...s };
  setCookie(merged);
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(merged)); } catch {}
}

export function getTopbarAutohide(): boolean {
  const all = getCookie();
  return all.topbarAutohide !== false;
}

export function setTopbarAutohide(value: boolean): void {
  const all = getCookie();
  setCookie({ ...all, topbarAutohide: value });
}

export function getTerminalBackend(): string | null {
  const all = getCookie();
  return all.terminal || null;
}

export function setTerminalBackend(value: string): void {
  const all = getCookie();
  setCookie({ ...all, terminal: value });
}

export function getActiveThemeName(): string {
  return getCookie().theme || 'Default';
}

export function setActiveThemeName(name: string): void {
  const all = getCookie();
  setCookie({ ...all, theme: name });
}

export function isThemeFontTouched(theme: string): boolean {
  return !!getCookie().themeFontTouched?.[theme];
}

export function markThemeFontTouched(theme: string): void {
  const all = getCookie();
  const map = { ...(all.themeFontTouched ?? {}), [theme]: true };
  setCookie({ ...all, themeFontTouched: map });
}
