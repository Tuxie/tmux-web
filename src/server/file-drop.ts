import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';

export interface DropStorage {
  /** Absolute path of the root dir shared by all sessions. */
  root: string;
  /** Maximum files kept per session dir before the oldest are unlinked. */
  maxFilesPerSession: number;
  /** Drops older than this (ms) are opportunistically unlinked on each write. */
  ttlMs: number;
  /** If true, spawn `inotifywait` per drop to unlink the file the moment
   *  its first reader closes it. Falls back to TTL-only when the binary
   *  is missing. */
  autoUnlinkOnClose: boolean;
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
  return {
    root: base,
    maxFilesPerSession: 20,
    ttlMs: 10 * 60 * 1000,
    autoUnlinkOnClose: hasInotifywait(),
  };
}

let _inotifywaitProbed: boolean | null = null;
/** One-shot feature probe. Inotify-tools isn't guaranteed everywhere; on
 *  macOS / BSD / broken installs we quietly fall back to TTL-only. */
export function hasInotifywait(): boolean {
  if (_inotifywaitProbed !== null) return _inotifywaitProbed;
  try {
    const res = Bun.spawnSync(['inotifywait', '--help'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    _inotifywaitProbed = res.exitCode === 0;
  } catch {
    _inotifywaitProbed = false;
  }
  return _inotifywaitProbed;
}

/** Reset the inotifywait probe cache. Only used by tests. */
export function _resetInotifyProbe(): void {
  _inotifywaitProbed = null;
}

/** Active auto-unlink watchers so we can kill them on session cleanup
 *  and server exit without leaking child processes. Keyed by absolute
 *  file path. */
const activeWatchers = new Map<string, ChildProcess>();

/** Spawn `inotifywait` on `absolutePath`, unlinking the file (and clearing
 *  the watcher entry) when any close event fires. Returns immediately.
 *  If inotifywait isn't available or spawn fails, the file simply survives
 *  until the TTL sweep picks it up. */
function armAutoUnlink(absolutePath: string): void {
  if (activeWatchers.has(absolutePath)) return;
  try {
    // -q quiet (no header), no -m → one-shot; exits on first matching
    // event. close_write covers readers that opened the file read-write
    // (rare, but vim-style workflows do); close_nowrite covers the common
    // case where a tool opens the file read-only.
    const child = spawn('inotifywait', [
      '-q', '-e', 'close_write,close_nowrite', absolutePath,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    activeWatchers.set(absolutePath, child);
    const finish = () => {
      activeWatchers.delete(absolutePath);
      try { fs.unlinkSync(absolutePath); } catch { /* already gone */ }
    };
    child.on('exit', finish);
    child.on('error', () => {
      // spawn failed (rare post-probe). Fall back to TTL — don't unlink.
      activeWatchers.delete(absolutePath);
    });
  } catch {
    /* spawn threw synchronously — TTL handles it */
  }
}

/** Kill every active watcher (fire-and-forget). Their `exit` handlers
 *  will also unlink the corresponding files, which is fine: the session
 *  is going away anyway. */
function stopAllWatchers(): void {
  for (const [, child] of activeWatchers) {
    try { child.kill('SIGTERM'); } catch { /* best-effort */ }
  }
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

  // Arm the close-watch AFTER our own fd is closed so our write's
  // IN_CLOSE_WRITE can't trigger an immediate unlink. The reader's open
  // happens after we return, so inotifywait catches its close events.
  if (storage.autoUnlinkOnClose) {
    armAutoUnlink(absolutePath);
  }

  return { absolutePath, filename: safe, size: data.byteLength };
}

/** List currently-persisted drops under a session dir (newest first).
 *  Used by the settings panel to show the user what's still on disk. */
export function listDrops(storage: DropStorage, session: string): Array<{
  filename: string;
  absolutePath: string;
  size: number;
  mtime: string; // ISO 8601
}> {
  const dir = path.join(storage.root, session);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir)
    .map(name => {
      const p = path.join(dir, name);
      try {
        const stat = fs.statSync(p);
        return {
          filename: name,
          absolutePath: p,
          size: stat.size,
          mtime: new Date(stat.mtimeMs).toISOString(),
          sortKey: stat.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is { filename: string; absolutePath: string; size: number; mtime: string; sortKey: number } => x !== null)
    .sort((a, b) => b.sortKey - a.sortKey);
  return entries.map(({ sortKey: _sortKey, ...rest }) => rest);
}

/** Unlink a single drop (and stop its watcher, if any). Returns true on
 *  successful unlink, false if the file wasn't present. Rejects paths
 *  that escape the session dir — purely defensive; the HTTP layer
 *  validates filename separately. */
export function deleteDrop(storage: DropStorage, session: string, filename: string): boolean {
  const dir = path.join(storage.root, session);
  const target = path.join(dir, filename);
  // Require the resolved path to remain inside the session dir.
  if (!target.startsWith(dir + path.sep)) return false;
  const watcher = activeWatchers.get(target);
  if (watcher) {
    activeWatchers.delete(target);
    try { watcher.kill('SIGTERM'); } catch { /* best-effort */ }
  }
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Remove a session's drop dir entirely (e.g. on WS disconnect). */
export function cleanupSession(storage: DropStorage, session: string): void {
  const dir = path.join(storage.root, session);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Remove every session dir under the storage root. Call once on server
 *  shutdown to avoid leaving drops around across restarts. Also stops
 *  any pending auto-unlink watchers. */
export function cleanupAll(storage: DropStorage): void {
  stopAllWatchers();
  try { fs.rmSync(storage.root, { recursive: true, force: true }); } catch { /* ignore */ }
}
