import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';

export interface DropStorage {
  /** Absolute path of the root dir shared by all sessions. */
  root: string;
  /** Maximum drops kept per session before the oldest are unlinked. */
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

/** Active auto-unlink watchers keyed by the drop's subdir so purge and
 *  server-exit can kill them. */
const activeWatchers = new Map<string, ChildProcess>();

/** Pub/sub for drop list mutations. The WS layer subscribes and pushes
 *  a `{dropsChanged: session}` TT message to clients on the matching
 *  session — replaces any client-side polling. */
export type DropsChangeListener = (event: { session: string }) => void;
const listeners = new Set<DropsChangeListener>();

export function onDropsChange(cb: DropsChangeListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emitChange(session: string): void {
  for (const cb of listeners) {
    try { cb({ session }); } catch { /* isolate one bad listener */ }
  }
}

/** Spawn `inotifywait` on the drop's file; when any close event fires,
 *  unlink the file and rmdir the parent drop-dir. Returns immediately.
 *  If inotifywait is unavailable or spawn fails, the drop survives
 *  until the TTL sweep picks it up. */
function armAutoUnlink(session: string, dropDir: string, filePath: string): void {
  if (activeWatchers.has(dropDir)) return;
  try {
    // -q quiet, no -m → one-shot; exits on first matching event.
    // close_write covers RW opens (rare), close_nowrite covers the
    // common read-only consumer path (cat, cp, image viewers, etc.).
    const child = spawn('inotifywait', [
      '-q', '-e', 'close_write,close_nowrite', filePath,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    activeWatchers.set(dropDir, child);
    const finish = () => {
      activeWatchers.delete(dropDir);
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
      try { fs.rmdirSync(dropDir); } catch { /* not empty / already gone */ }
      emitChange(session);
    };
    child.on('exit', finish);
    child.on('error', () => { activeWatchers.delete(dropDir); });
  } catch {
    /* spawn threw synchronously — TTL handles it */
  }
}

function stopAllWatchers(): void {
  for (const [, child] of activeWatchers) {
    try { child.kill('SIGTERM'); } catch { /* best-effort */ }
  }
}

/** Drop sanitisation. `name` is the filename the browser supplied; we
 *  strip anything path-like, collapse control chars, cap length, and
 *  rescue empty / dot / dot-dot results to a stable "file" placeholder.
 *  The original name is preserved as-is otherwise (so spaces, unicode,
 *  etc. come through unchanged). */
export function sanitiseFilename(name: string): string {
  let out = (name ?? '')
    .replace(/[\/\\\x00]/g, '')
    .replace(/[\x01-\x1f\x7f]/g, '_')
    .trim();
  if (out === '' || out === '.' || out === '..') out = 'file';
  if (out.length > 200) out = out.slice(-200);
  return out;
}

/** Drop-id generator. `<base36 timestamp>-<8 hex nonce>`. Sortable by
 *  time; collision-free. Used as the subdir name for each drop. */
function newDropId(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function sessionDir(storage: DropStorage, session: string): string {
  const dir = path.join(storage.root, session);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Sweep the session root: any drop subdir whose mtime is older than the
 *  TTL is rm-rf'd. Then if more than maxFilesPerSession drops remain,
 *  the oldest are rm-rf'd until we're under the cap. Emits once per
 *  session if anything was removed. */
function sweepSession(storage: DropStorage, session: string, sessionRoot: string): void {
  let entries: Array<{ id: string; dir: string; mtime: number }>;
  try {
    entries = fs.readdirSync(sessionRoot).map(id => {
      const p = path.join(sessionRoot, id);
      const stat = fs.statSync(p);
      return { id, dir: p, mtime: stat.mtimeMs };
    });
  } catch { return; }

  const now = Date.now();
  const fresh: typeof entries = [];
  let removed = 0;
  for (const e of entries) {
    if (now - e.mtime > storage.ttlMs) {
      rmDrop(e.dir);
      removed++;
    } else {
      fresh.push(e);
    }
  }
  if (fresh.length > storage.maxFilesPerSession) {
    fresh.sort((a, b) => a.mtime - b.mtime); // oldest first
    const excess = fresh.length - storage.maxFilesPerSession;
    for (let i = 0; i < excess; i++) {
      rmDrop(fresh[i]!.dir);
      removed++;
    }
  }
  if (removed > 0) emitChange(session);
}

function rmDrop(dropDir: string): void {
  try { fs.rmSync(dropDir, { recursive: true, force: true }); } catch { /* ignore */ }
  const watcher = activeWatchers.get(dropDir);
  if (watcher) {
    activeWatchers.delete(dropDir);
    try { watcher.kill('SIGTERM'); } catch { /* best-effort */ }
  }
}

export interface WriteDropResult {
  /** The drop's stable id (subdir name). */
  dropId: string;
  /** Absolute path of the written file — what gets pasted into the pane. */
  absolutePath: string;
  /** Sanitised original filename (no directory prefix). */
  filename: string;
  /** Bytes written. */
  size: number;
}

/** Persist a dropped file under `<session>/<dropId>/<originalName>`.
 *  The per-drop subdir keeps the original filename intact so commands
 *  like `cp (path) ~/Downloads/` produce a file with the user's
 *  expected name. Runs opportunistic sweep on every drop so the
 *  session root stays bounded. */
export function writeDrop(
  storage: DropStorage,
  session: string,
  rawName: string,
  data: Uint8Array | Buffer,
): WriteDropResult {
  const sroot = sessionDir(storage, session);
  sweepSession(storage, session, sroot);

  const filename = sanitiseFilename(rawName);
  const dropId = newDropId();
  const dropDir = path.join(sroot, dropId);
  fs.mkdirSync(dropDir, { mode: 0o700 });
  const absolutePath = path.join(dropDir, filename);

  const fd = fs.openSync(absolutePath, 'wx', 0o600);
  try {
    fs.writeSync(fd, data as any);
  } finally {
    fs.closeSync(fd);
  }

  if (storage.autoUnlinkOnClose) {
    armAutoUnlink(session, dropDir, absolutePath);
  }

  emitChange(session);
  return { dropId, absolutePath, filename, size: data.byteLength };
}

export interface ListedDrop {
  dropId: string;
  filename: string;
  absolutePath: string;
  size: number;
  mtime: string; // ISO 8601
}

/** List current drops for a session, newest-first. Each drop is a
 *  subdir containing a single file; we report the inner file's name,
 *  size, and mtime but key actions (revoke, etc.) on the subdir id. */
export function listDrops(storage: DropStorage, session: string): ListedDrop[] {
  const sroot = path.join(storage.root, session);
  if (!fs.existsSync(sroot)) return [];
  const entries: Array<ListedDrop & { sortKey: number }> = [];
  for (const id of fs.readdirSync(sroot)) {
    const dir = path.join(sroot, id);
    let stat: fs.Stats;
    try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let inner: string[];
    try { inner = fs.readdirSync(dir); } catch { continue; }
    if (inner.length !== 1) continue; // pathological; skip
    const filename = inner[0]!;
    const absolutePath = path.join(dir, filename);
    let fstat: fs.Stats;
    try { fstat = fs.statSync(absolutePath); } catch { continue; }
    entries.push({
      dropId: id,
      filename,
      absolutePath,
      size: fstat.size,
      mtime: new Date(fstat.mtimeMs).toISOString(),
      sortKey: fstat.mtimeMs,
    });
  }
  entries.sort((a, b) => b.sortKey - a.sortKey);
  return entries.map(({ sortKey: _s, ...rest }) => rest);
}

/** Remove a drop by id (rm -rf its subdir). Returns true if the subdir
 *  existed. Rejects ids that contain path separators or resolve outside
 *  the session root. */
export function deleteDrop(storage: DropStorage, session: string, dropId: string): boolean {
  if (typeof dropId !== 'string' || dropId === '' || dropId.includes('/') || dropId.includes('\\')) {
    return false;
  }
  const sroot = path.join(storage.root, session);
  const target = path.join(sroot, dropId);
  if (!target.startsWith(sroot + path.sep)) return false;
  if (!fs.existsSync(target)) return false;
  rmDrop(target);
  emitChange(session);
  return true;
}

/** Remove a session's drop dir entirely (e.g. on WS disconnect). */
export function cleanupSession(storage: DropStorage, session: string): void {
  const dir = path.join(storage.root, session);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  emitChange(session);
}

/** Remove every session dir under the storage root. Call once on server
 *  shutdown to avoid leaving drops around across restarts. Also stops
 *  any pending auto-unlink watchers. */
export function cleanupAll(storage: DropStorage): void {
  stopAllWatchers();
  try { fs.rmSync(storage.root, { recursive: true, force: true }); } catch { /* ignore */ }
}
