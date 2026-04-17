import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  sanitiseFilename,
  writeDrop,
  cleanupAll,
  listDrops,
  deleteDrop,
  onDropsChange,
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

  test("sanitises a traversal attempt and keeps the file inside the root", () => {
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
