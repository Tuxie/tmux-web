export interface SessionSettings {
  theme: string;
  colours: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  opacity: number; // 0..100
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  theme: 'Default',
  colours: 'Gruvbox Dark',
  fontFamily: 'Iosevka Nerd Font Mono',
  fontSize: 18,
  lineHeight: 0.85,
  opacity: 0,
};

const prefix = 'tmux-web-session:';
const LAST_SESSION_KEY = 'tmux-web-last-session';

export interface ThemeDefaults {
  colours?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
}

export interface LoadOpts {
  defaults: SessionSettings;
  themeDefaults?: ThemeDefaults;
}

export function loadSessionSettings(name: string, live: SessionSettings | null, opts: LoadOpts): SessionSettings {
  try {
    const raw = localStorage.getItem(prefix + name);
    if (raw) return { ...opts.defaults, ...JSON.parse(raw) };
  } catch {}
  if (live) return { ...live };
  const overlay: Partial<SessionSettings> = {};
  const td = opts.themeDefaults ?? {};
  if (td.colours) overlay.colours = td.colours;
  if (td.fontFamily) overlay.fontFamily = td.fontFamily;
  if (td.fontSize !== undefined) overlay.fontSize = td.fontSize;
  if (td.lineHeight !== undefined) overlay.lineHeight = td.lineHeight;
  return { ...opts.defaults, ...overlay };
}

export function saveSessionSettings(name: string, s: SessionSettings): void {
  try { localStorage.setItem(prefix + name, JSON.stringify(s)); } catch {}
}

/** Returns stored settings from the last-active session (for new-session inheritance). */
export function getLiveSessionSettings(currentName: string): SessionSettings | null {
  try {
    const last = localStorage.getItem(LAST_SESSION_KEY);
    if (!last || last === currentName) return null;
    const raw = localStorage.getItem(prefix + last);
    if (!raw) return null;
    return JSON.parse(raw) as SessionSettings;
  } catch {
    return null;
  }
}

/** Record which session is currently active (call on page load). */
export function setLastActiveSession(name: string): void {
  try { localStorage.setItem(LAST_SESSION_KEY, name); } catch {}
}

export function applyThemeDefaults(s: SessionSettings, td: ThemeDefaults): SessionSettings {
  return {
    ...s,
    colours: td.colours ?? s.colours,
    fontFamily: td.fontFamily ?? s.fontFamily,
    fontSize: td.fontSize ?? s.fontSize,
    lineHeight: td.lineHeight ?? s.lineHeight,
  };
}
