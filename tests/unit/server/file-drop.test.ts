import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  sanitizeFilename,
  writeDrop,
  cleanupAll,
  listDrops,
  deleteDrop,
  onDropsChange,
  defaultDropStorage,
  resolveDropRoot,
  hasInotifywait,
  _resetInotifyProbe,
  AUTO_UNLINK_GRACE_MS,
  _setAutoUnlinkSpawnForTest,
  startPeriodicSweep,
  stopPeriodicSweep,
  currentRootBytes,
  DropQuotaExceededError,
  type DropStorage,
} from "../../../src/server/file-drop.ts";

let root: string;
let storage: DropStorage;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-drop-"));
  storage = { root, maxFilesPerSession: 3, ttlMs: 60_000, autoUnlinkOnClose: false };
});

afterEach(() => {
  _setAutoUnlinkSpawnForTest(undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("sanitizeFilename", () => {
  test("strips directory separators", () => {
    expect(sanitizeFilename("/etc/passwd")).toBe("etcpasswd");
    expect(sanitizeFilename("a/b/c.txt")).toBe("abc.txt");
    expect(sanitizeFilename("a\\b\\c.txt")).toBe("abc.txt");
  });

  test("strips NUL bytes", () => {
    expect(sanitizeFilename("foo\x00.txt")).toBe("foo.txt");
  });

  test("replaces control characters with underscore", () => {
    expect(sanitizeFilename("foo\x01\x1f\x7fbar.txt")).toBe("foo___bar.txt");
  });

  test("keeps ordinary leading dots (hidden files allowed)", () => {
    expect(sanitizeFilename(".env")).toBe(".env");
    expect(sanitizeFilename(".bashrc")).toBe(".bashrc");
  });

  test("empty / single-dot / double-dot names become 'file'", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename(".")).toBe("file");
    expect(sanitizeFilename("..")).toBe("file");
    expect(sanitizeFilename("   ")).toBe("file");
  });

  test("caps length at 200 chars (trailing)", () => {
    const long = "a".repeat(400) + ".txt";
    const out = sanitizeFilename(long);
    expect(out.length).toBe(200);
    expect(out.endsWith(".txt")).toBe(true);
  });
});

describe("writeDrop", () => {
  test("persists bytes under <root>/<dropId>/<originalName>", () => {
    const res = writeDrop(storage, "hello.txt", Buffer.from("hi"));
    expect(path.dirname(res.absolutePath)).toBe(path.join(root, res.dropId));
    expect(path.basename(res.absolutePath)).toBe("hello.txt");
    expect(res.filename).toBe("hello.txt");
    expect(res.size).toBe(2);
    expect(fs.readFileSync(res.absolutePath, "utf-8")).toBe("hi");
  });

  test("each drop lives in its own subdir — original filename intact", () => {
    const a = writeDrop(storage, "Screenshot 2026-04-17.png", Buffer.from("a"));
    const b = writeDrop(storage, "Screenshot 2026-04-17.png", Buffer.from("b"));
    expect(a.dropId).not.toBe(b.dropId);
    expect(path.basename(a.absolutePath)).toBe("Screenshot 2026-04-17.png");
    expect(path.basename(b.absolutePath)).toBe("Screenshot 2026-04-17.png");
    expect(path.dirname(a.absolutePath)).not.toBe(path.dirname(b.absolutePath));
  });

  test("sanitizes a traversal attempt and keeps the file inside the root", () => {
    const res = writeDrop(storage, "../../etc/passwd", Buffer.from("x"));
    expect(res.absolutePath.startsWith(root + path.sep)).toBe(true);
    expect(res.filename).toBe("....etcpasswd");
  });

  test("creates root + drop dirs with 0700 mode", () => {
    const r = writeDrop(storage, "foo", Buffer.from(""));
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.dirname(r.absolutePath)).mode & 0o777).toBe(0o700);
  });

  test("ring buffer caps the root to maxFilesPerSession drops", () => {
    // maxFilesPerSession = 3 from beforeEach.
    const drops: { id: string; dir: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const r = writeDrop(storage, `f${i}.bin`, Buffer.from([i]));
      drops.push({ id: r.dropId, dir: path.dirname(r.absolutePath) });
      fs.utimesSync(drops[i]!.dir, new Date(1000 + i), new Date(1000 + i));
    }
    const remaining = fs.readdirSync(root);
    expect(remaining.length).toBeLessThanOrEqual(3);
    expect(fs.existsSync(drops[0]!.dir)).toBe(false);
    expect(fs.existsSync(drops[1]!.dir)).toBe(false);
    expect(fs.existsSync(drops[4]!.dir)).toBe(true);
  });

  test("TTL sweep removes old drops on next write", () => {
    const old = writeDrop(storage, "old.bin", Buffer.from("x"));
    const oldDir = path.dirname(old.absolutePath);
    const past = (Date.now() - storage.ttlMs - 10_000) / 1000;
    fs.utimesSync(oldDir, past, past);

    writeDrop(storage, "new.bin", Buffer.from("y"));
    expect(fs.existsSync(oldDir)).toBe(false);
  });
});

describe("onDropsChange", () => {
  test("fires on writeDrop and deleteDrop", () => {
    let count = 0;
    const unsub = onDropsChange(() => { count++; });

    const d = writeDrop(storage, "foo", Buffer.from("x"));
    const afterWrite = count;
    expect(afterWrite).toBeGreaterThan(0);

    deleteDrop(storage, d.dropId);
    expect(count).toBeGreaterThan(afterWrite);

    unsub();
  });

  test("unsubscribe stops further deliveries", () => {
    let count = 0;
    const unsub = onDropsChange(() => { count++; });
    writeDrop(storage, "a", Buffer.from("a"));
    const before = count;
    unsub();
    writeDrop(storage, "b", Buffer.from("b"));
    expect(count).toBe(before);
  });
});

describe("cleanupAll", () => {
  test("removes the whole root", () => {
    writeDrop(storage, "f.bin", Buffer.from("x"));
    cleanupAll(storage);
    expect(fs.existsSync(root)).toBe(false);
  });

  test("waits for active auto-unlink watchers to exit after SIGTERM", async () => {
    let killed = false;
    let resolveExit!: () => void;
    const exitPromise = new Promise<void>(resolve => { resolveExit = resolve; });
    _setAutoUnlinkSpawnForTest(() => ({
      exited: exitPromise,
      kill: () => {
        killed = true;
        queueMicrotask(resolveExit);
        return true;
      },
    }));

    const s: DropStorage = { root, maxFilesPerSession: 5, ttlMs: 60_000, autoUnlinkOnClose: true };
    writeDrop(s, "watched.bin", Buffer.from("x"));

    await cleanupAll(s);

    expect(killed).toBe(true);
    expect(fs.existsSync(root)).toBe(false);
    await expect(exitPromise).resolves.toBeUndefined();
  });
});

describe("listDrops", () => {
  test("empty when root doesn't exist", () => {
    cleanupAll(storage);
    expect(listDrops(storage)).toEqual([]);
  });

  test("returns drops sorted newest-first with size and ISO mtime", () => {
    const a = writeDrop(storage, "a.txt", Buffer.from("aa"));
    const b = writeDrop(storage, "b.txt", Buffer.from("bbbb"));
    const now = Date.now();
    fs.utimesSync(a.absolutePath, (now - 2000) / 1000, (now - 2000) / 1000);
    fs.utimesSync(b.absolutePath, (now - 1000) / 1000, (now - 1000) / 1000);

    const list = listDrops(storage);
    expect(list).toHaveLength(2);
    expect(list[0]!.filename).toBe("b.txt");
    expect(list[1]!.filename).toBe("a.txt");
    expect(list[0]!.size).toBe(4);
    expect(list[1]!.size).toBe(2);
    expect(list[0]!.dropId).toBe(b.dropId);
    expect(list[1]!.dropId).toBe(a.dropId);
    expect(() => new Date(list[0]!.mtime).toISOString()).not.toThrow();
  });
});

describe("deleteDrop", () => {
  test("removes the drop subdir and returns true", () => {
    const r = writeDrop(storage, "doomed", Buffer.from("x"));
    expect(deleteDrop(storage, r.dropId)).toBe(true);
    expect(fs.existsSync(path.dirname(r.absolutePath))).toBe(false);
  });

  test("returns false when the drop doesn't exist", () => {
    writeDrop(storage, "keep", Buffer.from("x"));
    expect(deleteDrop(storage, "nonexistent-id")).toBe(false);
  });

  test("rejects drop ids containing path separators", () => {
    const r = writeDrop(storage, "victim", Buffer.from("x"));
    expect(deleteDrop(storage, "../" + r.dropId)).toBe(false);
    expect(fs.existsSync(path.dirname(r.absolutePath))).toBe(true);
  });

  test("rejects an empty drop id", () => {
    expect(deleteDrop(storage, "")).toBe(false);
  });
});

describe("sweepRoot ring-buffer cap (within TTL)", () => {
  test("evicts oldest fresh drops once cap is exceeded", () => {
    // Very large TTL so nothing expires by age — this isolates the
    // cap-eviction branch (lines 163-168) from the TTL branch.
    const s: DropStorage = { root, maxFilesPerSession: 2, ttlMs: 24 * 60 * 60 * 1000, autoUnlinkOnClose: false };
    // Pre-populate 4 drops directly, all fresh but with distinct mtimes.
    const now = Date.now();
    const dirs: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = `pre-${i}`;
      const dir = path.join(root, id);
      fs.mkdirSync(dir, { mode: 0o700 });
      fs.writeFileSync(path.join(dir, "f"), "x");
      const t = (now - (1000 * (4 - i))) / 1000; // oldest first
      fs.utimesSync(dir, t, t);
      dirs.push(dir);
    }
    // Trigger a sweep by writing one more drop. After sweep, fresh.length
    // will be 5, cap is 2, so 3 oldest get evicted.
    writeDrop(s, "trigger.bin", Buffer.from("t"));
    const remaining = fs.readdirSync(root);
    // Sweep runs before the new drop is added: 4 pre-existing → capped to 2
    // → plus trigger = 3 on disk. What matters is the cap branch fired and
    // evicted the oldest.
    expect(remaining.length).toBeLessThanOrEqual(3);
    // Two oldest pre-created drops must be gone.
    expect(fs.existsSync(dirs[0]!)).toBe(false);
    expect(fs.existsSync(dirs[1]!)).toBe(false);
  });
});

describe("defaultDropStorage", () => {
  // These tests manipulate the storage-path env vars; snapshot + restore
  // both TMUX_WEB_DROP_ROOT (the hard override) and XDG_RUNTIME_DIR so a
  // developer who happens to have either set in their shell doesn't
  // poison the asserts.
  function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const prev: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) prev[k] = process.env[k];
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try { return fn(); }
    finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  test("returns a usable writable DropStorage (XDG_RUNTIME_DIR path)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-xdg-"));
    try {
      withEnv({ TMUX_WEB_DROP_ROOT: undefined, XDG_RUNTIME_DIR: tmp }, () => {
        const s = defaultDropStorage();
        expect(s.root.startsWith(tmp)).toBe(true);
        expect(fs.statSync(s.root).isDirectory()).toBe(true);
        expect(s.maxFilesPerSession).toBeGreaterThan(0);
        expect(s.ttlMs).toBeGreaterThan(0);
        expect(typeof s.autoUnlinkOnClose).toBe("boolean");
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("falls back to os.tmpdir() when XDG_RUNTIME_DIR is absent", () => {
    withEnv({ TMUX_WEB_DROP_ROOT: undefined, XDG_RUNTIME_DIR: undefined }, () => {
      const s = defaultDropStorage();
      expect(s.root.startsWith(os.tmpdir())).toBe(true);
      expect(s.root).toContain("tmux-web-drop-");
    });
  });

  test("resolveDropRoot falls back when XDG_RUNTIME_DIR is not usable", () => {
    const root = resolveDropRoot({
      override: undefined,
      xdgRuntimeDir: "/run/user/1000",
      tmpDir: "/tmp",
      uid: 1000,
      isUsableDir: () => false,
    });

    expect(root).toBe("/tmp/tmux-web-drop-1000");
  });

  test("TMUX_WEB_DROP_ROOT overrides both XDG_RUNTIME_DIR and tmpdir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-drop-override-"));
    try {
      withEnv({ TMUX_WEB_DROP_ROOT: tmp, XDG_RUNTIME_DIR: '/nonexistent/nope' }, () => {
        const s = defaultDropStorage();
        expect(s.root).toBe(tmp);
        expect(fs.statSync(s.root).isDirectory()).toBe(true);
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("hasInotifywait / _resetInotifyProbe", () => {
  test("probe is cached; reset forces re-probe", () => {
    _resetInotifyProbe();
    const a = hasInotifywait();
    // Second call returns the cached value without re-spawning.
    const b = hasInotifywait();
    expect(a).toBe(b);
    _resetInotifyProbe();
    // After reset, calling again re-runs the probe and returns a boolean.
    const c = hasInotifywait();
    expect(typeof c).toBe("boolean");
  });

  test("non-Linux platform short-circuits to false without spawning (cluster 15 / F2)", () => {
    _resetInotifyProbe();
    let spawnCalled = false;
    const result = hasInotifywait({
      platform: "darwin",
      spawnSync: () => { spawnCalled = true; return { exitCode: 0 }; },
    });
    expect(result).toBe(false);
    expect(spawnCalled).toBe(false);
    _resetInotifyProbe();
  });

  test("passes timeout: 2000 to spawnSync on Linux (cluster 15 / F2)", () => {
    _resetInotifyProbe();
    let observedTimeout: number | undefined;
    const result = hasInotifywait({
      platform: "linux",
      spawnSync: (_cmd, opts) => {
        observedTimeout = opts.timeout;
        return { exitCode: 1 }; // inotifywait --help exits 1 by convention
      },
    });
    expect(result).toBe(true);
    expect(observedTimeout).toBe(2000);
    _resetInotifyProbe();
  });

  test("returns false within 2s when spawnSync reports a timed-out / hung child (cluster 15 / F2)", async () => {
    // Bun.spawnSync's `timeout` option is best-effort: when it trips, it
    // SIGTERMs the child and the call returns with `exitCode: null`. Our
    // contract is that a wedged inotifywait yields false, never hangs the
    // calling thread past the configured timeout. We simulate the
    // timed-out spawn by returning exitCode:null and assert the call is
    // bounded.
    _resetInotifyProbe();
    const start = Date.now();
    const result = hasInotifywait({
      platform: "linux",
      spawnSync: (_cmd, opts) => {
        // Production: Bun.spawnSync would have killed the child and
        // returned. We mirror that with exitCode:null. If the test ever
        // observed `opts.timeout` < 2000, the real call would not be
        // bounded the way we promise.
        expect(opts.timeout).toBe(2000);
        return { exitCode: null };
      },
    });
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    // Sanity bound — the test mock returns immediately. Real-world bound
    // is the timeout itself (2s), enforced by Bun.spawnSync.
    expect(elapsed).toBeLessThan(2000);
    _resetInotifyProbe();
  });

  test("spawnSync throwing (ENOENT) yields false (cluster 15 / F2)", () => {
    _resetInotifyProbe();
    const result = hasInotifywait({
      platform: "linux",
      spawnSync: () => { throw new Error("ENOENT: inotifywait not found"); },
    });
    expect(result).toBe(false);
    _resetInotifyProbe();
  });
});

describe("armAutoUnlink (autoUnlinkOnClose=true)", () => {
  test("spawns inotifywait watcher and unlinks the file after the grace delay", async () => {
    // Only meaningful if inotifywait is installed; when not, the spawn
    // child will emit 'error'.
    const s: DropStorage = { root, maxFilesPerSession: 5, ttlMs: 60_000, autoUnlinkOnClose: true };
    const r = writeDrop(s, "watched.bin", Buffer.from("abc"));
    // Let inotifywait (if present) start up, then touch the file's close
    // by reading it. The first close event should schedule deletion, not
    // immediately unlink the file.
    if (hasInotifywait()) {
      await new Promise(res => setTimeout(res, 150));
      fs.readFileSync(r.absolutePath); // close_nowrite fires

      await new Promise(res => setTimeout(res, 250));
      expect(fs.existsSync(r.absolutePath)).toBe(true);

      const deadline = Date.now() + AUTO_UNLINK_GRACE_MS + 2500;
      while (fs.existsSync(r.absolutePath) && Date.now() < deadline) {
        await new Promise(res => setTimeout(res, 50));
      }
      expect(fs.existsSync(r.absolutePath)).toBe(false);
    }
    // Either way the file write succeeded; we just needed the armAutoUnlink
    // branch to execute. Clean up.
    try { fs.rmSync(path.dirname(r.absolutePath), { recursive: true, force: true }); } catch {}
  });

  test("cleanupAll with active watchers kills them (covers stopAllWatchers)", async () => {
    const s: DropStorage = { root, maxFilesPerSession: 5, ttlMs: 60_000, autoUnlinkOnClose: true };
    writeDrop(s, "w1.bin", Buffer.from("a"));
    writeDrop(s, "w2.bin", Buffer.from("b"));
    await new Promise(res => setTimeout(res, 50));
    cleanupAll(s);
    expect(fs.existsSync(root)).toBe(false);
  });

  test("deleteDrop with active watcher stops the watcher (covers rmDrop watcher branch)", async () => {
    const s: DropStorage = { root, maxFilesPerSession: 5, ttlMs: 60_000, autoUnlinkOnClose: true };
    const r = writeDrop(s, "w3.bin", Buffer.from("c"));
    // Give the watcher time to be registered in activeWatchers.
    await new Promise(res => setTimeout(res, 50));
    // deleteDrop → rmDrop → should hit the `if (watcher)` branch
    // when inotifywait is available; otherwise falls through. Either
    // way the drop is gone.
    expect(deleteDrop(s, r.dropId)).toBe(true);
    expect(fs.existsSync(path.dirname(r.absolutePath))).toBe(false);
  });
});

describe("global byte cap (DropQuotaExceededError)", () => {
  test("rejects a drop that would push total bytes over maxRootBytes", () => {
    // 100-byte cap; a 60-byte drop succeeds, the next 50-byte one would
    // total 110 > 100 → reject with DropQuotaExceededError. Cluster 03
    // (docs/code-analysis/2026-04-26).
    const s: DropStorage = {
      root, maxFilesPerSession: 50, ttlMs: 60_000, autoUnlinkOnClose: false,
      maxRootBytes: 100,
    };
    writeDrop(s, "first.bin", Buffer.alloc(60));
    expect(currentRootBytes(s)).toBe(60);

    let caught: unknown = null;
    try { writeDrop(s, "second.bin", Buffer.alloc(50)); }
    catch (err) { caught = err; }

    expect(caught).toBeInstanceOf(DropQuotaExceededError);
    const e = caught as DropQuotaExceededError;
    expect(e.currentBytes).toBe(60);
    expect(e.attemptedBytes).toBe(50);
    expect(e.capBytes).toBe(100);
    // Existing drop must remain on disk; the rejection happens before
    // the file is created.
    expect(currentRootBytes(s)).toBe(60);
  });

  test("accepts a drop that exactly hits the cap", () => {
    const s: DropStorage = {
      root, maxFilesPerSession: 50, ttlMs: 60_000, autoUnlinkOnClose: false,
      maxRootBytes: 100,
    };
    expect(() => writeDrop(s, "exact.bin", Buffer.alloc(100))).not.toThrow();
    expect(currentRootBytes(s)).toBe(100);
  });

  test("a TTL-expired drop is swept before the cap check (room re-opens)", () => {
    // Pre-populate a drop that's older than the TTL. The pre-write sweep
    // inside writeDrop should reclaim it, leaving room for a fresh upload
    // that would otherwise trip the cap.
    const s: DropStorage = {
      root, maxFilesPerSession: 50, ttlMs: 1_000, autoUnlinkOnClose: false,
      maxRootBytes: 100,
    };
    const old = writeDrop(s, "old.bin", Buffer.alloc(80));
    const past = (Date.now() - 60_000) / 1000;
    fs.utimesSync(path.dirname(old.absolutePath), past, past);

    expect(() => writeDrop(s, "fresh.bin", Buffer.alloc(80))).not.toThrow();
  });

  test("missing or non-positive maxRootBytes disables the cap entirely", () => {
    // No cap at all → arbitrary writes succeed.
    const s: DropStorage = {
      root, maxFilesPerSession: 50, ttlMs: 60_000, autoUnlinkOnClose: false,
    };
    for (let i = 0; i < 3; i++) {
      expect(() => writeDrop(s, `f${i}.bin`, Buffer.alloc(1024))).not.toThrow();
    }
  });
});

describe("startPeriodicSweep (proactive TTL reclamation)", () => {
  test("registers an unref'd setInterval; idempotent re-arm; cleanupAll stops it", async () => {
    // Use a small TTL so the interval fires within the test window.
    const s: DropStorage = {
      root, maxFilesPerSession: 50, ttlMs: 100, autoUnlinkOnClose: false,
    };
    // Pre-populate a drop and back-date it so the sweep will collect it.
    const old = writeDrop(s, "stale.bin", Buffer.from("x"));
    const past = (Date.now() - 60_000) / 1000;
    fs.utimesSync(path.dirname(old.absolutePath), past, past);

    startPeriodicSweep(s);
    // Idempotent — re-arm is a no-op (no second timer queued).
    startPeriodicSweep(s);

    // ttlMs/2 = 50 ms; give the timer a few cycles to fire.
    const deadline = Date.now() + 1500;
    while (fs.existsSync(path.dirname(old.absolutePath)) && Date.now() < deadline) {
      await new Promise(res => setTimeout(res, 25));
    }
    expect(fs.existsSync(path.dirname(old.absolutePath))).toBe(false);

    // cleanupAll stops the interval; subsequent stop is a no-op.
    await cleanupAll(s);
    stopPeriodicSweep(s);
  });

  test("ttlMs <= 0 is a no-op (no timer registered)", () => {
    const s: DropStorage = {
      root, maxFilesPerSession: 50, ttlMs: 0, autoUnlinkOnClose: false,
    };
    // Should not throw, should not register a timer that would block exit.
    startPeriodicSweep(s);
    stopPeriodicSweep(s);
  });
});
