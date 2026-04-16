import fs from 'fs';
import path from 'path';

export interface StoredSessionSettings {
  theme: string;
  colours: string;
  fontFamily: string;
  fontSize: number;
  spacing: number;
  opacity: number;
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
