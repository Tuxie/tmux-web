import {
  DEFAULT_BACKGROUND_HUE,
  DEFAULT_BACKGROUND_SATURATION,
  DEFAULT_BACKGROUND_BRIGHTEST,
  DEFAULT_BACKGROUND_DARKEST,
  DEFAULT_THEME_HUE,
  DEFAULT_THEME_SAT,
  DEFAULT_THEME_LTN,
  DEFAULT_THEME_CONTRAST,
} from './background-hue.js';
import {
  DEFAULT_FG_CONTRAST_STRENGTH,
  DEFAULT_FG_CONTRAST_BIAS,
} from './fg-contrast.js';
import { DEFAULT_TUI_SATURATION } from './tui-saturation.js';

export interface SessionSettings {
  theme: string;
  colours: string;
  fontFamily: string;
  fontSize: number;
  spacing: number;
  opacity: number;      // 0..100, BG Opacity of #page
  tuiBgOpacity: number; // 0..100, TUI BG Opacity — ansi bg rect alpha
  tuiFgOpacity: number; // 0..100, TUI FG Opacity — glyph fg blended toward cell bg
  backgroundHue: number; // 0..360
  backgroundSaturation: number; // -100..+100, delta from theme base saturation
  backgroundBrightest: number; // 0..100, HSL L at gradient's brightest stop
  backgroundDarkest: number;   // 0..100, HSL L at gradient's darkest stop
  fgContrastStrength: number;  // -100..+100, OKLab-L contrast strength
  fgContrastBias: number;      // -100..+100, cutoff offset from bg luminance
  tuiSaturation: number;       // -100..+100, OKLab chroma scale for FG + BG
  themeHue: number;            // 0..360, --tw-theme-hue GUI chrome hue
  themeSat: number;              // 0..100, --tw-theme-sat GUI chrome saturation
  themeLtn: number;              // 0..100, --tw-theme-ltn GUI chrome lightness
  themeContrast: number;         // -100..+100, bevel/gradient spread (0 = 1x, +50 = 2x, +100 = 3x)
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  theme: 'Default',
  colours: 'Gruvbox Dark',
  fontFamily: 'Iosevka Nerd Font Mono',
  fontSize: 18,
  spacing: 0.85,
  opacity: 0,
  tuiBgOpacity: 100,
  tuiFgOpacity: 100,
  backgroundHue: DEFAULT_BACKGROUND_HUE,
  backgroundSaturation: DEFAULT_BACKGROUND_SATURATION,
  backgroundBrightest: DEFAULT_BACKGROUND_BRIGHTEST,
  backgroundDarkest: DEFAULT_BACKGROUND_DARKEST,
  fgContrastStrength: DEFAULT_FG_CONTRAST_STRENGTH,
  fgContrastBias: DEFAULT_FG_CONTRAST_BIAS,
  tuiSaturation: DEFAULT_TUI_SATURATION,
  themeHue: DEFAULT_THEME_HUE,
  themeSat: DEFAULT_THEME_SAT,
  themeLtn: DEFAULT_THEME_LTN,
  themeContrast: DEFAULT_THEME_CONTRAST,
};

export interface ThemeDefaults {
  colours?: string;
  fontFamily?: string;
  fontSize?: number;
  spacing?: number;
  opacity?: number;
  tuiBgOpacity?: number;
  tuiFgOpacity?: number;
  fgContrastStrength?: number;
  fgContrastBias?: number;
  tuiSaturation?: number;
  themeHue?: number;
  themeSat?: number;
  themeLtn?: number;
  themeContrast?: number;
  backgroundHue?: number;
  backgroundSaturation?: number;
  backgroundBrightest?: number;
  backgroundDarkest?: number;
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
  if (td.tuiBgOpacity !== undefined) overlay.tuiBgOpacity = td.tuiBgOpacity;
  if (td.tuiFgOpacity !== undefined) overlay.tuiFgOpacity = td.tuiFgOpacity;
  if (td.fgContrastStrength !== undefined) overlay.fgContrastStrength = td.fgContrastStrength;
  if (td.fgContrastBias !== undefined) overlay.fgContrastBias = td.fgContrastBias;
  if (td.tuiSaturation !== undefined) overlay.tuiSaturation = td.tuiSaturation;
  if (td.themeHue !== undefined) overlay.themeHue = td.themeHue;
  if (td.themeSat !== undefined) overlay.themeSat = td.themeSat;
  if (td.themeLtn !== undefined) overlay.themeLtn = td.themeLtn;
  if (td.themeContrast !== undefined) overlay.themeContrast = td.themeContrast;
  if (td.backgroundHue !== undefined) overlay.backgroundHue = td.backgroundHue;
  if (td.backgroundSaturation !== undefined) overlay.backgroundSaturation = td.backgroundSaturation;
  if (td.backgroundBrightest !== undefined) overlay.backgroundBrightest = td.backgroundBrightest;
  if (td.backgroundDarkest !== undefined) overlay.backgroundDarkest = td.backgroundDarkest;
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
    tuiBgOpacity: td.tuiBgOpacity ?? s.tuiBgOpacity,
    tuiFgOpacity: td.tuiFgOpacity ?? s.tuiFgOpacity,
    fgContrastStrength: td.fgContrastStrength ?? s.fgContrastStrength,
    fgContrastBias: td.fgContrastBias ?? s.fgContrastBias,
    tuiSaturation: td.tuiSaturation ?? s.tuiSaturation,
    themeHue: td.themeHue ?? s.themeHue,
    themeSat: td.themeSat ?? s.themeSat,
    themeLtn: td.themeLtn ?? s.themeLtn,
    themeContrast: td.themeContrast ?? s.themeContrast,
    backgroundHue: td.backgroundHue ?? s.backgroundHue,
    backgroundSaturation: td.backgroundSaturation ?? s.backgroundSaturation,
    backgroundBrightest: td.backgroundBrightest ?? s.backgroundBrightest,
    backgroundDarkest: td.backgroundDarkest ?? s.backgroundDarkest,
  };
}

/** Test/internal: reset the in-memory cache. */
export function _resetSessionStore(initial?: SessionsCache): void {
  cache = initial ?? { sessions: {} };
}
