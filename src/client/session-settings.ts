import {
  DEFAULT_BACKGROUND_HUE,
  DEFAULT_BACKGROUND_SATURATION,
  DEFAULT_BACKGROUND_BRIGHTEST,
  DEFAULT_BACKGROUND_DARKEST,
  DEFAULT_THEME_HUE,
  DEFAULT_THEME_SAT,
  DEFAULT_THEME_LTN,
  DEFAULT_THEME_CONTRAST,
  DEFAULT_DEPTH,
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
  themeContrast: number;         // -100..+100, gradient spread (0 = 1x, +50 = 2x, +100 = 3x)
  depth: number;                 // 0..100, bevel opacity (0 = flat, 100 = opaque B/W)
  topbarAutohide: boolean;
  scrollbarAutohide: boolean;
}

/** Clamp helpers matching the HTML slider `min`/`max` attributes.
 *  Paired number inputs can still receive out-of-range values (the
 *  slider handle is DOM-clamped, the number input is not), so every
 *  commit path goes through the helper corresponding to its field. */
export function clampFontSize(v: number): number {
  if (!Number.isFinite(v)) return 18;
  return Math.max(8, Math.min(30, v));
}
export function clampSpacing(v: number): number {
  if (!Number.isFinite(v)) return 0.85;
  return Math.max(0.5, Math.min(2, v));
}
export function clampPercent0to100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  theme: 'Default',
  colours: 'Gruvbox Dark',
  fontFamily: 'IosevkaTerm Compact',
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
  depth: DEFAULT_DEPTH,
  topbarAutohide: false,
  scrollbarAutohide: false,
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
  depth?: number;
  backgroundHue?: number;
  backgroundSaturation?: number;
  backgroundBrightest?: number;
  backgroundDarkest?: number;
  topbarAutohide?: boolean;
  scrollbarAutohide?: boolean;
}

export interface LoadOpts {
  defaults: SessionSettings;
  themeDefaults?: ThemeDefaults;
}

interface SessionsCache {
  lastActive?: string;
  sessions: Record<string, SessionSettings>;
  knownServers: string[];
}

let cache: SessionsCache = { sessions: {}, knownServers: [] };

function isValidRemoteHostAlias(host: string): boolean {
  return host.length > 0 && host.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host);
}

export function sessionSettingsKey(name: string, remoteHost?: string | null): string {
  return remoteHost && isValidRemoteHostAlias(remoteHost) ? `/r/${remoteHost}/${name}` : name;
}

function isRemoteSessionSettingsKey(name: string): boolean {
  return name.startsWith('/r/');
}

/** Fetch the persisted settings map from the server. Call once on startup.
 *  Failures (non-ok response or network error) are recorded through
 *  `boot-errors.ts` so `main()` can surface a single combined toast
 *  instead of silently starting with empty settings. */
export async function initSessionStore(): Promise<void> {
  const { recordBootError } = await import('./boot-errors.js');
  try {
    const res = await fetch('/api/session-settings');
    if (!res.ok) {
      recordBootError('settings', `HTTP ${res.status}`);
      return;
    }
    const cfg = await res.json();
    if (cfg && typeof cfg === 'object' && cfg.sessions) {
      cache = {
        lastActive: typeof cfg.lastActive === 'string' ? cfg.lastActive : undefined,
        sessions: cfg.sessions,
        knownServers: cache.knownServers,
      };
    }
    const settingsRes = await fetch('/api/settings');
    if (settingsRes.ok) {
      const settings = await settingsRes.json();
      if (settings && typeof settings === 'object' && Array.isArray(settings.knownServers)) {
        cache.knownServers = settings.knownServers.filter((host: unknown): host is string => (
          typeof host === 'string' && isValidRemoteHostAlias(host)
        ));
      }
    }
  } catch (err) {
    recordBootError('settings', err);
  }
}

/** PUT debounce: a slider drag fires up to one input event per pixel
 *  (e.g. Hue 0→360 ≈ 360 events). Coalescing on a 300 ms idle window
 *  collapses that to a single PUT once the drag settles, while still
 *  feeling instant for one-off edits. The merge is latest-wins on the
 *  client side — every `persist({sessions:{name:s}})` call carries the
 *  *full* current `s`, so dropping intermediate writes can't reorder or
 *  half-apply. The `lastActive` patch is structurally separate from
 *  `sessions`, so we merge them into one pending object rather than
 *  letting the latest call clobber whichever key the previous one
 *  set. */
const PERSIST_DEBOUNCE_MS = 300;
let pendingPatch: { lastActive?: string; sessions?: Record<string, SessionSettings> } | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function flushNow(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const patch = pendingPatch;
  if (!patch) return;
  pendingPatch = null;
  void fetch('/api/session-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

function persist(patch: { lastActive?: string; sessions?: Record<string, SessionSettings> }): void {
  if (!pendingPatch) {
    pendingPatch = {};
  }
  if (patch.lastActive !== undefined) {
    pendingPatch.lastActive = patch.lastActive;
  }
  if (patch.sessions) {
    pendingPatch.sessions = { ...(pendingPatch.sessions ?? {}), ...patch.sessions };
  }
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushNow, PERSIST_DEBOUNCE_MS);
}

/** Flush any pending debounced PUT immediately. Wire from `beforeunload`
 *  so a tab close mid-drag doesn't lose the last 300 ms of edits. Safe
 *  to call when nothing is pending (no-op). */
export function flushPersist(): void {
  flushNow();
}

/** Test/internal: cancel any in-flight debounce timer and drop the
 *  pending patch without firing it. Lets unit tests swap fetch impls
 *  between cases without leaking a queued PUT into the next test. */
export function _resetPersistDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingPatch = null;
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
  if (td.depth !== undefined) overlay.depth = td.depth;
  if (td.backgroundHue !== undefined) overlay.backgroundHue = td.backgroundHue;
  if (td.backgroundSaturation !== undefined) overlay.backgroundSaturation = td.backgroundSaturation;
  if (td.backgroundBrightest !== undefined) overlay.backgroundBrightest = td.backgroundBrightest;
  if (td.backgroundDarkest !== undefined) overlay.backgroundDarkest = td.backgroundDarkest;
  if (td.topbarAutohide !== undefined) overlay.topbarAutohide = td.topbarAutohide;
  if (td.scrollbarAutohide !== undefined) overlay.scrollbarAutohide = td.scrollbarAutohide;
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
  return Object.keys(cache.sessions).filter(name => !isRemoteSessionSettingsKey(name));
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

export function getKnownRemoteServers(): string[] {
  return cache.knownServers.slice();
}

export function recordKnownRemoteServer(host: string): void {
  if (!isValidRemoteHostAlias(host)) return;
  if (cache.knownServers.includes(host)) return;
  cache.knownServers = [...cache.knownServers, host];
  void fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ knownServers: [host] }),
  }).catch(() => {});
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
    depth: td.depth ?? s.depth,
    backgroundHue: td.backgroundHue ?? s.backgroundHue,
    backgroundSaturation: td.backgroundSaturation ?? s.backgroundSaturation,
    backgroundBrightest: td.backgroundBrightest ?? s.backgroundBrightest,
    backgroundDarkest: td.backgroundDarkest ?? s.backgroundDarkest,
    topbarAutohide: td.topbarAutohide ?? s.topbarAutohide,
    scrollbarAutohide: td.scrollbarAutohide ?? s.scrollbarAutohide,
  };
}

/** Test/internal: reset the in-memory cache. */
export function _resetSessionStore(initial?: SessionsCache): void {
  cache = initial ?? { sessions: {}, knownServers: [] };
  if (!cache.knownServers) cache.knownServers = [];
}
