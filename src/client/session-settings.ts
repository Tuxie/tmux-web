import {
  DEFAULT_BACKGROUND_HUE,
  DEFAULT_BACKGROUND_SATURATION,
  DEFAULT_BACKGROUND_BRIGHTNESS,
} from './background-hue.js';

export interface SessionSettings {
  theme: string;
  colours: string;
  fontFamily: string;
  fontSize: number;
  spacing: number;
  opacity: number; // 0..100
  tuiOpacity: number; // 0..100
  backgroundHue: number; // 0..360
  backgroundSaturation: number; // 0..100
  backgroundBrightness: number; // 0..100
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  theme: 'Default',
  colours: 'Gruvbox Dark',
  fontFamily: 'Iosevka Nerd Font Mono',
  fontSize: 18,
  spacing: 0.85,
  opacity: 0,
  tuiOpacity: 100,
  backgroundHue: DEFAULT_BACKGROUND_HUE,
  backgroundSaturation: DEFAULT_BACKGROUND_SATURATION,
  backgroundBrightness: DEFAULT_BACKGROUND_BRIGHTNESS,
};

export interface ThemeDefaults {
  colours?: string;
  fontFamily?: string;
  fontSize?: number;
  spacing?: number;
  opacity?: number;
  tuiOpacity?: number;
}

export interface LoadOpts {
  defaults: SessionSettings;
  themeDefaults?: ThemeDefaults;
}

interface SessionsCache {
  lastActive?: string;
  sessions: Record<string, SessionSettings>;
}

let cache: SessionsCache = { sessions: {} };

/** Fetch the persisted settings map from the server. Call once on startup. */
export async function initSessionStore(): Promise<void> {
  try {
    const res = await fetch('/api/session-settings');
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg && typeof cfg === 'object' && cfg.sessions) {
      cache = {
        lastActive: typeof cfg.lastActive === 'string' ? cfg.lastActive : undefined,
        sessions: cfg.sessions,
      };
    }
  } catch {}
}

function persist(patch: { lastActive?: string; sessions?: Record<string, SessionSettings> }): void {
  void fetch('/api/session-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

export function loadSessionSettings(name: string, live: SessionSettings | null, opts: LoadOpts): SessionSettings {
  const stored = cache.sessions[name];
  if (stored) return { ...opts.defaults, ...stored };
  if (live) return { ...opts.defaults, ...live };
  const overlay: Partial<SessionSettings> = {};
  const td = opts.themeDefaults ?? {};
  if (td.colours) overlay.colours = td.colours;
  if (td.fontFamily) overlay.fontFamily = td.fontFamily;
  if (td.fontSize !== undefined) overlay.fontSize = td.fontSize;
  if (td.spacing !== undefined) overlay.spacing = td.spacing;
  if (td.opacity !== undefined) overlay.opacity = td.opacity;
  if (td.tuiOpacity !== undefined) overlay.tuiOpacity = td.tuiOpacity;
  return { ...opts.defaults, ...overlay };
}

export function saveSessionSettings(name: string, s: SessionSettings): void {
  cache.sessions[name] = { ...s };
  persist({ sessions: { [name]: { ...s } } });
}

export async function deleteSessionSettings(name: string): Promise<void> {
  delete cache.sessions[name];
  if (cache.lastActive === name) cache.lastActive = undefined;
  try {
    await fetch('/api/session-settings?name=' + encodeURIComponent(name), { method: 'DELETE' });
  } catch {}
}

/** Returns the names of all sessions persisted in the server-side store. */
export function getStoredSessionNames(): string[] {
  return Object.keys(cache.sessions);
}

/** Returns stored settings from the last-active session (for new-session inheritance). */
export function getLiveSessionSettings(currentName: string): SessionSettings | null {
  const last = cache.lastActive;
  if (!last || last === currentName) return null;
  return cache.sessions[last] ?? null;
}

/** Record which session is currently active. */
export function setLastActiveSession(name: string): void {
  if (cache.lastActive === name) return;
  cache.lastActive = name;
  persist({ lastActive: name });
}

export function applyThemeDefaults(s: SessionSettings, td: ThemeDefaults): SessionSettings {
  return {
    ...s,
    colours: td.colours ?? s.colours,
    fontFamily: td.fontFamily ?? s.fontFamily,
    fontSize: td.fontSize ?? s.fontSize,
    spacing: td.spacing ?? s.spacing,
    opacity: td.opacity ?? s.opacity,
    tuiOpacity: td.tuiOpacity ?? s.tuiOpacity,
  };
}

/** Test/internal: reset the in-memory cache. */
export function _resetSessionStore(initial?: SessionsCache): void {
  cache = initial ?? { sessions: {} };
}
