import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export interface DropStorage {
  /** Absolute path of the root dir shared by all sessions. */
  root: string;
  /** Maximum files kept per session dir before the oldest are unlinked. */
  maxFilesPerSession: number;
  /** Drops older than this (ms) are opportunistically unlinked on each write. */
  ttlMs: number;
}

/** Build a default per-user drop storage under $XDG_RUNTIME_DIR when set
 *  (Linux: /run/user/<uid>/tmux-web/drop), otherwise under os.tmpdir()
 *  scoped by uid to keep multi-user hosts from colliding. Mode 0700. */
export function defaultDropStorage(): DropStorage {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const xdg = process.env.XDG_RUNTIME_DIR;
  const base = xdg && fs.existsSync(xdg)
    ? path.join(xdg, 'tmux-web', 'drop')
    : path.join(os.tmpdir(), `tmux-web-drop-${uid}`);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  return { root: base, maxFilesPerSession: 20, ttlMs: 10 * 60 * 1000 };
}

/** Drop sanitisation. `name` is the filename the browser supplied; we
 *  strip anything path-like, trim to a sane length, and prefix a
 *  timestamp + random nonce so collisions are impossible within a
 *  session dir (and ordering is mtime-stable enough for the ring
 *  buffer sweep). */
export function sanitiseFilename(name: string): string {
  // Strip directory separators and NULs. Keep dots (people drop hidden
  // files deliberately). Collapse control chars to underscore.
  let out = (name ?? '')
    .replace(/[\/\\\x00]/g, '')
    .replace(/[\x01-\x1f\x7f]/g, '_')
    .trim();
  // Never let the whole thing reduce to '.' or '..' which some tools
  // interpret as the current / parent dir.
  if (out === '' || out === '.' || out === '..') out = 'file';
  // Cap length — filesystems allow 255, be conservative.
  if (out.length > 200) out = out.slice(-200);
  return out;
}

function sessionDir(storage: DropStorage, session: string): string {
  const dir = path.join(storage.root, session);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Sweep the session dir: unlink anything older than ttlMs, then if more
 *  than maxFilesPerSession files remain, unlink the oldest by mtime. */
function sweepSession(storage: DropStorage, dir: string): void {
  let entries: Array<{ name: string; path: string; mtime: number }>;
  try {
    entries = fs.readdirSync(dir).map(name => {
      const p = path.join(dir, name);
      const stat = fs.statSync(p);
      return { name, path: p, mtime: stat.mtimeMs };
    });
  } catch { return; }

  const now = Date.now();
  const fresh: typeof entries = [];
  for (const e of entries) {
    if (now - e.mtime > storage.ttlMs) {
      try { fs.unlinkSync(e.path); } catch { /* best-effort */ }
    } else {
      fresh.push(e);
    }
  }
  if (fresh.length <= storage.maxFilesPerSession) return;
  fresh.sort((a, b) => a.mtime - b.mtime); // oldest first
  const excess = fresh.length - storage.maxFilesPerSession;
  for (let i = 0; i < excess; i++) {
    try { fs.unlinkSync(fresh[i]!.path); } catch { /* best-effort */ }
  }
}

export interface WriteDropResult {
  /** Absolute path of the written file — what gets injected into the pane. */
  absolutePath: string;
  /** Sanitised filename (no directory prefix). Useful for UI toasts. */
  filename: string;
  /** Bytes written. */
  size: number;
}

/** Persist a dropped file under the session dir, returning the path the
 *  caller should paste into the terminal. Runs opportunistic sweep on
 *  every drop so the dir stays bounded. */
export function writeDrop(
  storage: DropStorage,
  session: string,
  rawName: string,
  data: Uint8Array | Buffer,
): WriteDropResult {
  const dir = sessionDir(storage, session);
  sweepSession(storage, dir);

  const safe = sanitiseFilename(rawName);
  const ts = Date.now().toString(36);
  const nonce = crypto.randomBytes(4).toString('hex');
  const filename = `${ts}-${nonce}-${safe}`;
  const absolutePath = path.join(dir, filename);

  // Write-exclusive so a pathological collision (same ts+nonce, astronomically
  // unlikely) fails loudly rather than clobbering a prior drop.
  const fd = fs.openSync(absolutePath, 'wx', 0o600);
  try {
    fs.writeSync(fd, data as any);
  } finally {
    fs.closeSync(fd);
  }

  return { absolutePath, filename: safe, size: data.byteLength };
}

/** Remove a session's drop dir entirely (e.g. on WS disconnect). */
export function cleanupSession(storage: DropStorage, session: string): void {
  const dir = path.join(storage.root, session);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Remove every session dir under the storage root. Call once on server
 *  shutdown to avoid leaving drops around across restarts. */
export function cleanupAll(storage: DropStorage): void {
  try { fs.rmSync(storage.root, { recursive: true, force: true }); } catch { /* ignore */ }
}
