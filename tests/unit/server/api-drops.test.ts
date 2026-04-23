import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createHttpHandler } from "../../../src/server/http.ts";
import { writeDrop, type DropStorage } from "../../../src/server/file-drop.ts";
import { callHandler } from "./_harness/call-handler.ts";

let tmp: string;
let storage: DropStorage;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-api-drops-"));
  storage = {
    root: path.join(tmp, "drops"),
    maxFilesPerSession: 20,
    ttlMs: 60_000,
    autoUnlinkOnClose: false,
  };
  fs.mkdirSync(storage.root, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function makeHandler() {
  return await createHttpHandler({
    config: {
      host: "", port: 0, allowedIps: new Set(),
      tls: false, testMode: true, debug: false,
      tmuxBin: "tmux", auth: { enabled: false },
    } as any,
    htmlTemplate: "", distDir: "",
    themesUserDir: tmp, themesBundledDir: tmp, projectRoot: tmp,
    isCompiled: false,
    sessionsStorePath: path.join(tmp, "sessions.json"),
    dropStorage: storage,
  });
}

function call(handler: any, opts: { method: string; url: string }): Promise<{ status: number; body: string }> {
  return callHandler(handler, opts);
}

describe("/api/drops", () => {
  test("GET returns empty list when no drops", async () => {
    const h = await makeHandler();
    const r = await call(h, { method: "GET", url: "/api/drops" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ drops: [] });
  });

  test("GET lists existing drops newest-first with dropId and original filename", async () => {
    const a = writeDrop(storage, "a.txt", Buffer.from("aa"));
    const b = writeDrop(storage, "b.txt", Buffer.from("bbbb"));
    const now = Date.now();
    fs.utimesSync(a.absolutePath, (now - 2000) / 1000, (now - 2000) / 1000);
    fs.utimesSync(b.absolutePath, (now - 1000) / 1000, (now - 1000) / 1000);

    const h = await makeHandler();
    const r = await call(h, { method: "GET", url: "/api/drops" });
    const body = JSON.parse(r.body) as {
      drops: Array<{ dropId: string; filename: string; size: number }>;
    };
    expect(body.drops).toHaveLength(2);
    expect(body.drops[0]!.filename).toBe("b.txt");
    expect(body.drops[0]!.dropId).toBe(b.dropId);
    expect(body.drops[1]!.filename).toBe("a.txt");
    expect(body.drops[1]!.dropId).toBe(a.dropId);
  });

  test("GET response omits absolutePath (cluster 06 — path disclosure fix)", async () => {
    writeDrop(storage, "secret.txt", Buffer.from("x"));
    const h = await makeHandler();
    const r = await call(h, { method: "GET", url: "/api/drops" });
    const body = JSON.parse(r.body) as { drops: any[] };
    expect(body.drops).toHaveLength(1);
    const entry = body.drops[0]!;
    // Field must be absent: a leaked absolute path discloses
    // /run/user/<uid>/… layout. Server resolves from dropId at paste time.
    expect('absolutePath' in entry).toBe(false);
    // Regression guard: the rest of the shape is unchanged.
    expect(entry.dropId).toBeDefined();
    expect(entry.filename).toBe('secret.txt');
    expect(entry.size).toBe(1);
    expect(entry.mtime).toBeDefined();
  });

  test("DELETE with ?id= removes one drop (whole subdir)", async () => {
    const a = writeDrop(storage, "f", Buffer.from("x"));
    const h = await makeHandler();
    const r = await call(h, {
      method: "DELETE",
      url: `/api/drops?id=${encodeURIComponent(a.dropId)}`,
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ deleted: true, id: a.dropId });
    expect(fs.existsSync(path.dirname(a.absolutePath))).toBe(false);
  });

  test("DELETE with no id purges all drops and reports the count", async () => {
    writeDrop(storage, "a", Buffer.from("a"));
    writeDrop(storage, "b", Buffer.from("b"));

    const h = await makeHandler();
    const r = await call(h, { method: "DELETE", url: "/api/drops" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ purged: 2 });
    expect(fs.readdirSync(storage.root)).toHaveLength(0);
  });

  test("DELETE of a non-existent id returns 404 but doesn't crash", async () => {
    const h = await makeHandler();
    const r = await call(h, {
      method: "DELETE",
      url: "/api/drops?id=nothing-here",
    });
    expect(r.status).toBe(404);
  });

  test("DELETE rejects an id that contains path separators (defence in depth)", async () => {
    const victim = writeDrop(storage, "victim", Buffer.from("x"));
    const h = await makeHandler();
    const r = await call(h, {
      method: "DELETE",
      url: "/api/drops?id=" + encodeURIComponent("../" + victim.dropId),
    });
    expect(r.status).toBe(404);
    expect(fs.existsSync(path.dirname(victim.absolutePath))).toBe(true);
  });

  test("unsupported methods return 405", async () => {
    const h = await makeHandler();
    const r = await call(h, { method: "PATCH", url: "/api/drops" });
    expect(r.status).toBe(405);
  });
});

describe("/api/drops/paste", () => {
  test("POST with a live drop returns 200 and echoes the path", async () => {
    const d = writeDrop(storage, "foo.png", Buffer.from("x"));
    const h = await makeHandler();
    const r = await call(h, {
      method: "POST",
      url: `/api/drops/paste?session=main&id=${encodeURIComponent(d.dropId)}`,
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      pasted: true,
      id: d.dropId,
      path: d.absolutePath,
      filename: "foo.png",
    });
  });

  test("POST for an unknown id returns 404 (file was auto-unlinked / TTL'd)", async () => {
    const h = await makeHandler();
    const r = await call(h, {
      method: "POST",
      url: "/api/drops/paste?session=main&id=missing-12345",
    });
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ pasted: false, id: "missing-12345" });
  });

  test("POST without an id returns 400", async () => {
    const h = await makeHandler();
    const r = await call(h, {
      method: "POST",
      url: "/api/drops/paste?session=main",
    });
    expect(r.status).toBe(400);
  });

  test("non-POST methods return 405", async () => {
    const h = await makeHandler();
    const r = await call(h, {
      method: "GET",
      url: "/api/drops/paste?session=main&id=x",
    });
    expect(r.status).toBe(405);
  });
});
