import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export interface DropStorage {
  /** Absolute path of the root dir shared by all sessions. */
  root: string;
  /** Maximum drops kept per session before the oldest are unlinked. */
  maxFilesPerSession: number;
  /** Drops older than this (ms) are opportunistically unlinked on each write. */
  ttlMs: number;
  /** If true, spawn `inotifywait` per drop to unlink the file shortly
   *  after its first reader closes it. Falls back to TTL-only when the
   *  binary is missing. */
  autoUnlinkOnClose: boolean;
  /** Optional global byte cap across every drop currently on disk under
   *  `root`. A new drop that would push the total above this is rejected
   *  with `DropQuotaExceededError` rather than silently evicting older
   *  drops — eviction is the ring-buffer's job (`maxFilesPerSession`).
   *  The cap exists so an authenticated client can't fill
   *  `/run/user/<uid>` by spamming distinct upload requests faster than
   *  the inotify-driven unlink pipeline reclaims them. Omit (or set to
   *  ≤ 0) to disable; `defaultDropStorage` populates a generous 4 GiB
   *  default. See cluster 03 (docs/code-analysis/2026-04-26) for the
   *  calibration. */
  maxRootBytes?: number;
}

/** Thrown by `writeDrop` when accepting the drop would push the global
 *  byte usage above `storage.maxRootBytes`. The HTTP handler maps this
 *  to a 413 (Payload Too Large), matching the existing per-upload cap
 *  rejection shape. */
export class DropQuotaExceededError extends Error {
  readonly currentBytes: number;
  readonly attemptedBytes: number;
  readonly capBytes: number;
  constructor(currentBytes: number, attemptedBytes: number, capBytes: number) {
    super(`drop quota exceeded: ${currentBytes} + ${attemptedBytes} > ${capBytes}`);
    this.name = 'DropQuotaExceededError';
    this.currentBytes = currentBytes;
    this.attemptedBytes = attemptedBytes;
    this.capBytes = capBytes;
  }
}

export interface DropRootOptions {
  override?: string;
  xdgRuntimeDir?: string;
  tmpDir?: string;
  uid?: number;
  isUsableDir?: (dir: string) => boolean;
}

function isUsableRuntimeDir(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveDropRoot(opts: DropRootOptions = {}): string {
  if (opts.override) return opts.override;

  const uid = opts.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
  const tmpBase = opts.tmpDir ?? os.tmpdir();
  const xdgRuntimeDir = opts.xdgRuntimeDir ?? process.env.XDG_RUNTIME_DIR;
  const isUsableDir = opts.isUsableDir ?? isUsableRuntimeDir;

  return xdgRuntimeDir && isUsableDir(xdgRuntimeDir)
    ? path.join(xdgRuntimeDir, 'tmux-web', 'drop')
    : path.join(tmpBase, `tmux-web-drop-${uid}`);
}

/** 4 GiB global ceiling on the drop root: per-upload cap (50 MiB in
 *  http.ts) × ring-buffer size (20) × four-session breathing room. The
 *  ring-buffer + TTL evict in steady-state, but a burst of distinct
 *  upload requests can still race the inotify-driven unlink; the global
 *  cap is the backstop. Pickable per-storage so tests can pin a small
 *  number. See cluster 03 (docs/code-analysis/2026-04-26). */
const DEFAULT_MAX_ROOT_BYTES = 4 * 1024 * 1024 * 1024;

/** Build a default per-user drop storage under $XDG_RUNTIME_DIR when set
 *  (Linux: /run/user/<uid>/tmux-web/drop), otherwise under os.tmpdir()
 *  scoped by uid to keep multi-user hosts from colliding. Mode 0700.
 *
 *  TMUX_WEB_DROP_ROOT hard-overrides the computed base; tests set this
 *  so uploads never land in the developer's real XDG_RUNTIME_DIR
 *  (where the running dev server would pick them up on its next drop
 *  refresh). */
export function defaultDropStorage(): DropStorage {
  const base = resolveDropRoot({ override: process.env.TMUX_WEB_DROP_ROOT });
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const storage: DropStorage = {
    root: base,
    maxFilesPerSession: 20,
    ttlMs: 10 * 60 * 1000,
    autoUnlinkOnClose: hasInotifywait(),
    maxRootBytes: DEFAULT_MAX_ROOT_BYTES,
  };
  startPeriodicSweep(storage);
  return storage;
}

/** Active periodic sweeps keyed by storage object. Tracked so the same
 *  storage isn't double-armed and so test cleanup can stop the timer
 *  via `cleanupAll`. */
const activeSweepIntervals = new Map<DropStorage, ReturnType<typeof setInterval>>();

/** Arm a periodic sweep at `ttlMs / 2` so stale drops are reclaimed
 *  proactively rather than only on the next `writeDrop`. The interval
 *  is `unref()`d so it does not keep the event loop alive past
 *  `server.stop()` / process exit. Idempotent: re-arming the same
 *  storage is a no-op. */
export function startPeriodicSweep(storage: DropStorage): void {
  if (activeSweepIntervals.has(storage)) return;
  if (storage.ttlMs <= 0) return;
  const intervalMs = Math.max(1, Math.floor(storage.ttlMs / 2));
  const timer = setInterval(() => {
    try { sweepRoot(storage); } catch { /* best-effort */ }
  }, intervalMs);
  // Don't block `server.stop()` / process exit on a future sweep tick.
  if (typeof timer.unref === 'function') timer.unref();
  activeSweepIntervals.set(storage, timer);
}

/** Stop the periodic sweep for `storage`. Called from `cleanupAll`;
 *  exported so tests can stop sweeps they explicitly armed. */
export function stopPeriodicSweep(storage: DropStorage): void {
  const timer = activeSweepIntervals.get(storage);
  if (!timer) return;
  clearInterval(timer);
  activeSweepIntervals.delete(storage);
}

let _inotifywaitProbed: boolean | null = null;
/** Probe deps — extracted into an interface so tests can inject a fake
 *  spawnSync (verifying the 2 s timeout shape) and a fake platform
 *  string (verifying the non-Linux short-circuit) without monkey-patching
 *  globals. Production callers rely on the defaults. */
export interface InotifyProbeDeps {
  spawnSync?: (cmd: string[], opts: { stdio: ['ignore', 'ignore', 'ignore']; timeout: number }) => { exitCode: number | null };
  platform?: NodeJS.Platform;
}

/** One-shot feature probe. Inotify-tools isn't guaranteed everywhere; on
 *  macOS / BSD / broken installs we quietly fall back to TTL-only.
 *
 *  Note: inotifywait prints its help text and exits 1 (not 0), which is
 *  the tool's convention. We treat any "it ran without the kernel / OS
 *  rejecting the executable" as success — a failed spawn raises
 *  ENOENT/EACCES and lands us in the catch.
 *
 *  Skipped entirely on non-Linux platforms — inotifywait is Linux-only,
 *  so the spawn cost is wasted and any incidentally-installed binary
 *  would not actually deliver close events the kernel doesn't emit.
 *
 *  Bounded by a 2 s timeout on the spawn (Bun 1.3+ `timeout` option) so
 *  a wedged `inotifywait` (e.g. an aging container with broken /proc)
 *  cannot hang server startup. The timeout is best-effort — if Bun's
 *  `timeout` semantics on a wedged child don't actually fire, the
 *  fallback is the same 'spawn failed' branch. Cluster 15 / F2 —
 *  docs/code-analysis/2026-04-26. */
export function hasInotifywait(deps?: InotifyProbeDeps): boolean {
  if (_inotifywaitProbed !== null) return _inotifywaitProbed;
  const platform = deps?.platform ?? process.platform;
  if (platform !== 'linux') {
    _inotifywaitProbed = false;
    return _inotifywaitProbed;
  }
  const spawn = deps?.spawnSync ?? ((cmd, opts) => Bun.spawnSync(cmd, opts) as { exitCode: number | null });
  try {
    const res = spawn(['inotifywait', '--help'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 2000,
    });
    _inotifywaitProbed = res.exitCode !== null;
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
interface WatcherProcess {
  exited: Promise<unknown>;
  kill(signal?: number | NodeJS.Signals): unknown;
}
interface ActiveWatcher {
  child: WatcherProcess;
  settled: Promise<void>;
}
type WatcherSpawn = (filePath: string) => WatcherProcess;
let watcherSpawn: WatcherSpawn = (filePath) => Bun.spawn([
  'inotifywait', '-q', '-e', 'close_write,close_nowrite', filePath,
], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });

export function _setAutoUnlinkSpawnForTest(spawnFn: WatcherSpawn | undefined): void {
  watcherSpawn = spawnFn ?? ((filePath) => Bun.spawn([
    'inotifywait', '-q', '-e', 'close_write,close_nowrite', filePath,
  ], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }));
}

const activeWatchers = new Map<string, ActiveWatcher>();
const pendingAutoUnlinks = new Map<string, ReturnType<typeof setTimeout>>();

export const AUTO_UNLINK_GRACE_MS = 2000;

/** Pub/sub for drop list mutations. The WS layer subscribes and pushes
 *  a `dropsChanged` TT message to every connected client — drops are a
 *  per-user pool now (not partitioned by tmux session), so any change
 *  is relevant to anyone watching. */
export type DropsChangeListener = () => void;
const listeners = new Set<DropsChangeListener>();

export function onDropsChange(cb: DropsChangeListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emitChange(): void {
  for (const cb of listeners) {
    try { cb(); } catch { /* isolate one bad listener */ }
  }
}

function clearPendingAutoUnlink(dropDir: string): void {
  const pending = pendingAutoUnlinks.get(dropDir);
  if (!pending) return;
  pendingAutoUnlinks.delete(dropDir);
  clearTimeout(pending);
}

function scheduleAutoUnlink(dropDir: string, filePath: string): void {
  if (pendingAutoUnlinks.has(dropDir)) return;
  const timer = setTimeout(() => {
    pendingAutoUnlinks.delete(dropDir);
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    try { fs.rmdirSync(dropDir); } catch { /* not empty / already gone */ }
    emitChange();
  }, AUTO_UNLINK_GRACE_MS);
  pendingAutoUnlinks.set(dropDir, timer);
}

/** Spawn `inotifywait` on the drop's file; when any close event fires,
 *  wait briefly before unlinking the file and rmdir-ing the parent drop-dir.
 *  Returns immediately.
 *  If inotifywait is unavailable or spawn fails, the drop survives
 *  until the TTL sweep picks it up. */
function armAutoUnlink(dropDir: string, filePath: string): void {
  if (activeWatchers.has(dropDir)) return;
  try {
    const child = watcherSpawn(filePath);
    let resolveSettled!: () => void;
    const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
    activeWatchers.set(dropDir, { child, settled });
    const finish = () => {
      if (activeWatchers.get(dropDir)?.child === child) {
        activeWatchers.delete(dropDir);
        scheduleAutoUnlink(dropDir, filePath);
      }
      resolveSettled();
    };
    void child.exited.then(finish, () => {
      if (activeWatchers.get(dropDir)?.child === child) activeWatchers.delete(dropDir);
      resolveSettled();
    });
  } catch {
    /* spawn threw synchronously — TTL handles it */
  }
}

function stopAllWatchers(): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const [dropDir, watcher] of activeWatchers) {
    activeWatchers.delete(dropDir);
    pending.push(watcher.settled);
    try { watcher.child.kill('SIGTERM'); } catch { /* best-effort */ }
  }
  for (const dropDir of Array.from(pendingAutoUnlinks.keys())) {
    clearPendingAutoUnlink(dropDir);
  }
  return Promise.allSettled(pending).then(() => undefined);
}

/** Drop sanitization. `name` is the filename the browser supplied; we
 *  strip anything path-like, collapse control chars, cap length, and
 *  rescue empty / dot / dot-dot results to a stable "file" placeholder.
 *  The original name is preserved as-is otherwise (so spaces, unicode,
 *  etc. come through unchanged). */
export function sanitizeFilename(name: string): string {
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

/** Sum the on-disk byte size of every drop file currently under
 *  `storage.root`. Returns 0 if the root is missing. Best-effort:
 *  drop subdirs that race a delete are skipped silently. */
export function currentRootBytes(storage: DropStorage): number {
  let total = 0;
  let entries: string[];
  try { entries = fs.readdirSync(storage.root); }
  catch { return 0; }
  for (const id of entries) {
    const dir = path.join(storage.root, id);
    let inner: string[];
    try { inner = fs.readdirSync(dir); }
    catch { continue; }
    for (const name of inner) {
      try {
        const stat = fs.statSync(path.join(dir, name));
        if (stat.isFile()) total += stat.size;
      } catch { /* raced delete — skip */ }
    }
  }
  return total;
}

/** Sweep the storage root: any drop subdir whose mtime is older than the
 *  TTL is rm-rf'd. Then if more than maxFilesPerSession drops remain,
 *  the oldest are rm-rf'd until we're under the cap. Emits once if
 *  anything was removed. */
function sweepRoot(storage: DropStorage): void {
  let entries: Array<{ id: string; dir: string; mtime: number }>;
  try {
    entries = fs.readdirSync(storage.root).map(id => {
      const p = path.join(storage.root, id);
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
  if (removed > 0) emitChange();
}

function rmDrop(dropDir: string): void {
  clearPendingAutoUnlink(dropDir);
  try { fs.rmSync(dropDir, { recursive: true, force: true }); } catch { /* ignore */ }
  const watcher = activeWatchers.get(dropDir);
  if (watcher) {
    activeWatchers.delete(dropDir);
    try { watcher.child.kill('SIGTERM'); } catch { /* best-effort */ }
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

/** Persist a dropped file under `<root>/<dropId>/<originalName>`. The
 *  per-drop subdir keeps the original filename intact so commands like
 *  `cp (path) ~/Downloads/` produce a file with the user's expected
 *  name. Runs an opportunistic sweep on every drop so the root stays
 *  bounded. */
export function writeDrop(
  storage: DropStorage,
  rawName: string,
  data: Uint8Array | Buffer,
): WriteDropResult {
  fs.mkdirSync(storage.root, { recursive: true, mode: 0o700 });
  sweepRoot(storage);

  // Enforce the global byte cap *after* the sweep so a fresh upload
  // following a TTL-driven eviction can succeed. The check is on the
  // post-sweep total so the cap reflects what's actually on disk, not
  // a stale snapshot. Quota math uses byteLength so Buffer + Uint8Array
  // both report the wire size.
  if (typeof storage.maxRootBytes === 'number' && storage.maxRootBytes > 0) {
    const current = currentRootBytes(storage);
    const incoming = data.byteLength;
    if (current + incoming > storage.maxRootBytes) {
      throw new DropQuotaExceededError(current, incoming, storage.maxRootBytes);
    }
  }

  const filename = sanitizeFilename(rawName);
  const dropId = newDropId();
  const dropDir = path.join(storage.root, dropId);
  fs.mkdirSync(dropDir, { mode: 0o700 });
  const absolutePath = path.join(dropDir, filename);

  const fd = fs.openSync(absolutePath, 'wx', 0o600);
  try {
    // safe: data is Uint8Array | Buffer; fs.writeSync accepts both but overload resolution picks the string overload without the cast
    fs.writeSync(fd, data as any);
  } finally {
    fs.closeSync(fd);
  }

  if (storage.autoUnlinkOnClose) {
    armAutoUnlink(dropDir, absolutePath);
  }

  emitChange();
  return { dropId, absolutePath, filename, size: data.byteLength };
}

export interface ListedDrop {
  dropId: string;
  filename: string;
  absolutePath: string;
  size: number;
  mtime: string; // ISO 8601
}

/** List all current drops, newest-first. Each drop is a subdir
 *  containing a single file; we report the inner file's name, size,
 *  and mtime but key actions (revoke, etc.) on the subdir id. */
export function listDrops(storage: DropStorage): ListedDrop[] {
  if (!fs.existsSync(storage.root)) return [];
  const entries: Array<ListedDrop & { sortKey: number }> = [];
  for (const id of fs.readdirSync(storage.root)) {
    const dir = path.join(storage.root, id);
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
 *  the storage root. */
export function deleteDrop(storage: DropStorage, dropId: string): boolean {
  if (typeof dropId !== 'string' || dropId === '' || dropId.includes('/') || dropId.includes('\\')) {
    return false;
  }
  const target = path.join(storage.root, dropId);
  if (!target.startsWith(storage.root + path.sep)) return false;
  if (!fs.existsSync(target)) return false;
  rmDrop(target);
  emitChange();
  return true;
}

/** Remove every drop under the storage root. Call once on server
 *  shutdown to avoid leaving drops around across restarts. Also stops
 *  any pending auto-unlink watchers and the periodic sweep timer. */
export async function cleanupAll(storage: DropStorage): Promise<void> {
  stopPeriodicSweep(storage);
  const stopped = stopAllWatchers();
  try { fs.rmSync(storage.root, { recursive: true, force: true }); } catch { /* ignore */ }
  await stopped;
}
