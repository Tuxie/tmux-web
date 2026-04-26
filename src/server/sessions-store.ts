import fs from 'fs';
import path from 'path';

/** Per-binary clipboard grant. Absent entry means "prompt user". */
export interface ClipboardGrant {
  allow: boolean;
  /** ISO 8601 timestamp, or null for never-expires. */
  expiresAt: string | null;
  /** ISO 8601 timestamp when the grant was stored. */
  grantedAt: string;
}

/** Policy for one absolute executable path. Keys at the clipboard level are
 *  the absolute paths themselves. */
export interface ClipboardPolicyEntry {
  /** BLAKE3 hex digest of the binary at the time the grant was made. null
   *  means path-only match (accept whatever binary lives there today). When
   *  non-null the resolver re-hashes on read and falls back to prompt on
   *  mismatch, so a binary swap implicitly revokes the grant. */
  blake3: string | null;
  read?: ClipboardGrant;
  write?: ClipboardGrant;
}

export interface StoredSessionSettings {
  theme: string;
  colours: string;
  fontFamily: string;
  fontSize: number;
  spacing: number;
  opacity: number;
  tuiBgOpacity?: number;
  tuiFgOpacity?: number;
  fgContrastStrength?: number;
  fgContrastBias?: number;
  tuiSaturation?: number;
  themeHue?: number;
  backgroundHue?: number;
  backgroundSaturation?: number;
  backgroundBrightest?: number;
  backgroundDarkest?: number;
  topbarAutohide?: boolean;
  scrollbarAutohide?: boolean;
  /** OSC 52 per-binary policy. Keyed by absolute exe path. */
  clipboard?: Record<string, ClipboardPolicyEntry>;
}

export interface SessionsConfig {
  version: 1;
  lastActive?: string;
  sessions: Record<string, StoredSessionSettings>;
}

export interface SessionsConfigPatch {
  lastActive?: string;
  sessions?: Record<string, StoredSessionSettings>;
}

export function emptyConfig(): SessionsConfig {
  return { version: 1, sessions: {} };
}

// Drop entries whose key is obviously garbage (e.g. "[object HTMLSpanElement]"
// from a client-side coercion bug, or empty / whitespace-only keys). tmux
// session names can't contain `:` or `.`; rejecting `[` defensively also
// catches any future "[object Foo]" coercion.
function isValidSessionName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.length === 0) return false;
  if (name.trim().length === 0) return false;
  if (name.startsWith('[object ')) return false;
  return true;
}

function sanitiseSessions(input: unknown): Record<string, StoredSessionSettings> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, StoredSessionSettings> = {};
  for (const [k, v] of Object.entries(input as Record<string, StoredSessionSettings>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (isValidSessionName(k)) out[k] = v;
  }
  return out;
}

export function loadConfig(filePath: string): SessionsConfig {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions) return emptyConfig();
    return {
      version: 1,
      lastActive: typeof parsed.lastActive === 'string' && isValidSessionName(parsed.lastActive)
        ? parsed.lastActive
        : undefined,
      sessions: sanitiseSessions(parsed.sessions),
    };
  } catch {
    return emptyConfig();
  }
}

export function mergeConfig(current: SessionsConfig, patch: SessionsConfigPatch): SessionsConfig {
  const patchSessions = sanitiseSessions(patch.sessions);
  const patchLastActive = patch.lastActive !== undefined && isValidSessionName(patch.lastActive)
    ? patch.lastActive
    : undefined;
  return {
    version: 1,
    lastActive: patchLastActive ?? current.lastActive,
    sessions: { ...current.sessions, ...patchSessions },
  };
}

export function saveConfig(filePath: string, config: SessionsConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.part';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, filePath);
}

/** Per-file write chain — serialises read-modify-write of sessions.json
 *  so two concurrent updates can't read the same baseline and overwrite
 *  each other's fields. The chain is keyed by `filePath` so independent
 *  test stores don't share a queue.
 *
 *  Why this is needed: T2 single-user app, but the client can fire
 *  parallel `PUT /api/session-settings` requests (e.g. theme switch
 *  while the opacity slider is dragging) and the read-modify-write
 *  inside applyPatch is genuinely racy. Same shape extends to
 *  `recordGrant` in clipboard-policy.ts — see that file's note on
 *  serialisation. Cluster 15 / F6 — docs/code-analysis/2026-04-26. */
const writeChains = new Map<string, Promise<unknown>>();

export function serialiseFileWrite<T>(filePath: string, work: () => T | Promise<T>): Promise<T> {
  const prev = writeChains.get(filePath) ?? Promise.resolve();
  // Run after `prev` settles regardless of outcome — one failed write
  // must not poison subsequent writes for the same file.
  const next: Promise<T> = prev.then(() => work(), () => work());
  // Track the new tail so the next caller chains onto it. Clear the
  // entry after settle so the Map can't grow without bound across the
  // process lifetime. Use a swallowed-rejection chain for the bookkeeping
  // so the "is this entry still current?" cleanup never surfaces as an
  // unhandled rejection — the caller's await on `next` is the only path
  // that should observe the rejection.
  writeChains.set(filePath, next);
  next.then(
    () => { if (writeChains.get(filePath) === next) writeChains.delete(filePath); },
    () => { if (writeChains.get(filePath) === next) writeChains.delete(filePath); },
  );
  return next;
}

export function applyPatch(filePath: string, patch: SessionsConfigPatch): Promise<SessionsConfig> {
  return serialiseFileWrite(filePath, () => {
    const current = loadConfig(filePath);
    const next = mergeConfig(current, patch);
    saveConfig(filePath, next);
    return next;
  });
}

export function deleteSession(filePath: string, name: string): Promise<SessionsConfig> {
  return serialiseFileWrite(filePath, () => {
    const current = loadConfig(filePath);
    if (!(name in current.sessions)) return current;
    const { [name]: _removed, ...rest } = current.sessions;
    const next: SessionsConfig = {
      version: 1,
      lastActive: current.lastActive === name ? undefined : current.lastActive,
      sessions: rest,
    };
    saveConfig(filePath, next);
    return next;
  });
}
