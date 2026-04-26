import {
  loadConfig,
  mergeConfig,
  saveConfig,
  serialiseFileWrite,
  type ClipboardGrant,
  type ClipboardPolicyEntry,
  type StoredSessionSettings,
} from './sessions-store.js';
import { hashFile, hashFileCached } from './hash.js';

export type Action = 'read' | 'write';
export type Decision = 'allow' | 'deny' | 'prompt';

/** Resolve the policy for (session, exePath, action) against the stored
 *  config. Returns 'prompt' when:
 *   - no entry exists, or
 *   - the entry's grant for this action is missing, or
 *   - the grant has expired, or
 *   - a blake3 pin exists and the current file hash doesn't match.
 *  Hash verification is skipped when entry.blake3 is null (path-only trust). */
export async function resolvePolicy(
  filePath: string,
  session: string,
  exePath: string,
  action: Action,
): Promise<Decision> {
  const cfg = loadConfig(filePath);
  const entry = cfg.sessions[session]?.clipboard?.[exePath];
  if (!entry) return 'prompt';
  const grant = entry[action];
  if (!grant) return 'prompt';
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return 'prompt';
  if (entry.blake3) {
    // hashFileCached is mtime-keyed — a binary swap necessarily changes
    // mtime, so a swapped binary will re-hash and the policy will fall
    // through to 'prompt'. Repeat reads against the same unchanged
    // binary skip the BLAKE3 walk entirely. Cluster 15 / F8 —
    // docs/code-analysis/2026-04-26.
    let current: string;
    try {
      current = await hashFileCached(exePath);
    } catch {
      return 'prompt';
    }
    if (current !== entry.blake3) return 'prompt';
  }
  return grant.allow ? 'allow' : 'deny';
}

export interface RecordGrantOptions {
  filePath: string;
  session: string;
  exePath: string;
  action: Action;
  allow: boolean;
  /** null = never expire. Caller converts relative durations to absolute
   *  ISO 8601 timestamps. */
  expiresAt: string | null;
  /** When true, the current exe is hashed and pinned into the entry so a
   *  binary swap revokes the grant. When false, the pin is left as null
   *  (weaker — any binary at the path is accepted). */
  pinHash: boolean;
}

export async function recordGrant(opts: RecordGrantOptions): Promise<void> {
  const now = new Date().toISOString();
  // Hash up-front, OUTSIDE the serialisation queue, so one slow hash
  // (large binary) doesn't block other writers. Cluster 15 / F6 —
  // docs/code-analysis/2026-04-26.
  let freshBlake3: string | null = null;
  if (opts.pinHash) {
    try { freshBlake3 = await hashFile(opts.exePath); } catch { freshBlake3 = null; }
  }
  const grant: ClipboardGrant = {
    allow: opts.allow,
    expiresAt: opts.expiresAt,
    grantedAt: now,
  };

  // Read-modify-write inside the per-file mutex. This protects against a
  // concurrent applyPatch (theme switch / opacity drag) overwriting the
  // grant we're recording, AND against a concurrent recordGrant for a
  // different exePath dropping our entry. Cluster 15 / F6.
  await serialiseFileWrite(opts.filePath, () => {
    const cfg = loadConfig(opts.filePath);
    const existingSession: StoredSessionSettings | undefined = cfg.sessions[opts.session];
    if (!existingSession) {
      // Can't create a session from thin air — a clipboard grant without the
      // rest of SessionSettings would leave an incomplete row. Skip silently;
      // saveSessionSettings runs on every settings change so the session will
      // exist in practice before any grant is recorded.
      return;
    }
    const existingClipboard = existingSession.clipboard ?? {};
    const existingEntry: ClipboardPolicyEntry | undefined = existingClipboard[opts.exePath];

    const nextEntry: ClipboardPolicyEntry = {
      // Keep existing hash pin if caller didn't re-pin (pinHash=false); this
      // avoids accidentally weakening a previously-pinned grant.
      blake3: opts.pinHash ? freshBlake3 : (existingEntry?.blake3 ?? null),
      read:  existingEntry?.read,
      write: existingEntry?.write,
      [opts.action]: grant,
    };

    const nextClipboard: Record<string, ClipboardPolicyEntry> = {
      ...existingClipboard,
      [opts.exePath]: nextEntry,
    };

    const next = mergeConfig(cfg, {
      sessions: {
        [opts.session]: { ...existingSession, clipboard: nextClipboard },
      },
    });
    saveConfig(opts.filePath, next);
  });
}
