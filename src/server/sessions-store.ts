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
  themeHue?: number;
  backgroundHue?: number;
  backgroundSaturation?: number;
  backgroundBrightest?: number;
  backgroundDarkest?: number;
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

export function applyPatch(filePath: string, patch: SessionsConfigPatch): SessionsConfig {
  const current = loadConfig(filePath);
  const next = mergeConfig(current, patch);
  saveConfig(filePath, next);
  return next;
}

export function deleteSession(filePath: string, name: string): SessionsConfig {
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
}
