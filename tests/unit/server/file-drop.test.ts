import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  sanitiseFilename,
  writeDrop,
  cleanupSession,
  cleanupAll,
  listDrops,
  deleteDrop,
  type DropStorage,
} from "../../../src/server/file-drop.ts";

let root: string;
let storage: DropStorage;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-drop-"));
  storage = { root, maxFilesPerSession: 3, ttlMs: 60_000, autoUnlinkOnClose: false };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("sanitiseFilename", () => {
  test("strips directory separators", () => {
    expect(sanitiseFilename("/etc/passwd")).toBe("etcpasswd");
    expect(sanitiseFilename("a/b/c.txt")).toBe("abc.txt");
    expect(sanitiseFilename("a\\b\\c.txt")).toBe("abc.txt");
  });

  test("strips NUL bytes", () => {
    expect(sanitiseFilename("foo\x00.txt")).toBe("foo.txt");
  });

  test("replaces control characters with underscore", () => {
    expect(sanitiseFilename("foo\x01\x1f\x7fbar.txt")).toBe("foo___bar.txt");
  });

  test("keeps ordinary leading dots (hidden files allowed)", () => {
    expect(sanitiseFilename(".env")).toBe(".env");
    expect(sanitiseFilename(".bashrc")).toBe(".bashrc");
  });

  test("empty / single-dot / double-dot names become 'file'", () => {
    expect(sanitiseFilename("")).toBe("file");
    expect(sanitiseFilename(".")).toBe("file");
    expect(sanitiseFilename("..")).toBe("file");
    expect(sanitiseFilename("   ")).toBe("file");
  });

  test("caps length at 200 chars (trailing)", () => {
    const long = "a".repeat(400) + ".txt";
    const out = sanitiseFilename(long);
    expect(out.length).toBe(200);
    expect(out.endsWith(".txt")).toBe(true);
  });
});

describe("writeDrop", () => {
  test("persists bytes under <root>/<session>/<ts-nonce-name>", () => {
    const res = writeDrop(storage, "main", "hello.txt", Buffer.from("hi"));
    expect(res.absolutePath.startsWith(path.join(root, "main") + "/")).toBe(true);
    expect(res.filename).toBe("hello.txt");
    expect(res.size).toBe(2);
    expect(fs.readFileSync(res.absolutePath, "utf-8")).toBe("hi");
  });

  test("stamps each filename with a unique prefix to avoid collisions", () => {
    const a = writeDrop(storage, "main", "dup.txt", Buffer.from("a"));
    const b = writeDrop(storage, "main", "dup.txt", Buffer.from("b"));
    expect(a.absolutePath).not.toBe(b.absolutePath);
    expect(path.basename(a.absolutePath)).toMatch(/-dup\.txt$/);
    expect(path.basename(b.absolutePath)).toMatch(/-dup\.txt$/);
  });

  test("sanitises a traversal attempt and keeps the file inside the session dir", () => {
    const res = writeDrop(storage, "main", "../../etc/passwd", Buffer.from("x"));
    expect(res.absolutePath.startsWith(path.join(root, "main") + "/")).toBe(true);
    expect(res.filename).toBe("....etcpasswd");
  });

  test("creates session dirs with 0700 mode", () => {
    writeDrop(storage, "main", "foo", Buffer.from(""));
    const mode = fs.statSync(path.join(root, "main")).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("ring buffer caps the session dir to maxFilesPerSession", () => {
    // maxFilesPerSession = 3 from beforeEach.
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      // Small mtime stagger so the "oldest" vs "newest" ordering is
      // deterministic on fast filesystems.
      const r = writeDrop(storage, "main", `f${i}.bin`, Buffer.from([i]));
      paths.push(r.absolutePath);
      // Bump the just-written file's mtime by i ms relative to epoch so
      // the next sweep can discriminate.
      fs.utimesSync(r.absolutePath, new Date(1000 + i), new Date(1000 + i));
    }
    const remaining = fs.readdirSync(path.join(root, "main"));
    expect(remaining.length).toBeLessThanOrEqual(3);
    // The two oldest (f0, f1) should be gone.
    expect(fs.existsSync(paths[0]!)).toBe(false);
    expect(fs.existsSync(paths[1]!)).toBe(false);
    // The latest write is always present.
    expect(fs.existsSync(paths[4]!)).toBe(true);
  });

  test("TTL sweep removes old files on next write", () => {
    const old = writeDrop(storage, "main", "old.bin", Buffer.from("x"));
    // Backdate the file so the next write's sweep considers it expired.
    const past = Date.now() - storage.ttlMs - 10_000;
    fs.utimesSync(old.absolutePath, past / 1000, past / 1000);

    writeDrop(storage, "main", "new.bin", Buffer.from("y"));
    expect(fs.existsSync(old.absolutePath)).toBe(false);
  });
});

describe("cleanup helpers", () => {
  test("cleanupSession removes the session dir and its contents", () => {
    writeDrop(storage, "main", "f.bin", Buffer.from("x"));
    writeDrop(storage, "other", "g.bin", Buffer.from("y"));
    cleanupSession(storage, "main");
    expect(fs.existsSync(path.join(root, "main"))).toBe(false);
    expect(fs.existsSync(path.join(root, "other"))).toBe(true);
  });

  test("cleanupAll removes the whole root", () => {
    writeDrop(storage, "main", "f.bin", Buffer.from("x"));
    cleanupAll(storage);
    expect(fs.existsSync(root)).toBe(false);
  });
});

describe("listDrops", () => {
  test("empty when no session dir exists", () => {
    expect(listDrops(storage, "nope")).toEqual([]);
  });

  test("returns drops sorted newest-first with size and ISO mtime", () => {
    const a = writeDrop(storage, "main", "a.txt", Buffer.from("aa"));
    const b = writeDrop(storage, "main", "b.txt", Buffer.from("bbbb"));
    // Backdate mtimes AFTER both writes so the second write's TTL sweep
    // (which uses the real mtime) doesn't unlink the first file.
    const now = Date.now();
    fs.utimesSync(a.absolutePath, (now - 2000) / 1000, (now - 2000) / 1000);
    fs.utimesSync(b.absolutePath, (now - 1000) / 1000, (now - 1000) / 1000);

    const list = listDrops(storage, "main");
    expect(list).toHaveLength(2);
    expect(list[0]!.filename).toBe(path.basename(b.absolutePath));
    expect(list[1]!.filename).toBe(path.basename(a.absolutePath));
    expect(list[0]!.size).toBe(4);
    expect(list[1]!.size).toBe(2);
    // ISO 8601 round-trip.
    expect(() => new Date(list[0]!.mtime).toISOString()).not.toThrow();
  });
});

describe("deleteDrop", () => {
  test("unlinks a file inside the session dir and returns true", () => {
    const r = writeDrop(storage, "main", "doomed", Buffer.from("x"));
    const filename = path.basename(r.absolutePath);
    expect(deleteDrop(storage, "main", filename)).toBe(true);
    expect(fs.existsSync(r.absolutePath)).toBe(false);
  });

  test("returns false when the file doesn't exist", () => {
    writeDrop(storage, "main", "keep", Buffer.from("x"));
    expect(deleteDrop(storage, "main", "nonexistent")).toBe(false);
  });

  test("rejects filenames that resolve outside the session dir", () => {
    // Relative-parent traversal attempt. path.join normalises this to
    // something escaping the session dir, which the confinement check
    // refuses.
    writeDrop(storage, "other", "neighbour", Buffer.from("x"));
    const escaped = "../other/neighbour";
    expect(deleteDrop(storage, "main", escaped)).toBe(false);
    // Neighbour file is untouched.
    expect(fs.readdirSync(path.join(root, "other")).length).toBe(1);
  });
});
