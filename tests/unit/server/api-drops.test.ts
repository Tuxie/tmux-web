import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { createHttpHandler } from "../../../src/server/http.ts";
import { writeDrop, type DropStorage } from "../../../src/server/file-drop.ts";

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
  return new Promise((resolve) => {
    const stream: any = Readable.from([]);
    stream.method = opts.method;
    stream.url = opts.url;
    stream.headers = { host: "x" };
    stream.socket = { remoteAddress: "127.0.0.1" };
    const res: any = {
      writeHead(status: number) { this._status = status; },
      end(body?: any) {
        resolve({ status: this._status ?? 200, body: body?.toString?.() ?? "" });
      },
    };
    Promise.resolve(handler(stream, res));
  });
}

describe("/api/drops", () => {
  test("GET returns empty list for a fresh session", async () => {
    const h = await makeHandler();
    const r = await call(h, { method: "GET", url: "/api/drops?session=main" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ drops: [] });
  });

  test("GET lists existing drops newest-first with dropId and original filename", async () => {
    const a = writeDrop(storage, "main", "a.txt", Buffer.from("aa"));
    const b = writeDrop(storage, "main", "b.txt", Buffer.from("bbbb"));
    const now = Date.now();
    fs.utimesSync(a.absolutePath, (now - 2000) / 1000, (now - 2000) / 1000);
    fs.utimesSync(b.absolutePath, (now - 1000) / 1000, (now - 1000) / 1000);

    const h = await makeHandler();
    const r = await call(h, { method: "GET", url: "/api/drops?session=main" });
    const body = JSON.parse(r.body) as {
      drops: Array<{ dropId: string; filename: string; size: number }>;
    };
    expect(body.drops).toHaveLength(2);
    expect(body.drops[0]!.filename).toBe("b.txt");
    expect(body.drops[0]!.dropId).toBe(b.dropId);
    expect(body.drops[1]!.filename).toBe("a.txt");
    expect(body.drops[1]!.dropId).toBe(a.dropId);
  });

  test("DELETE with ?id= removes one drop (whole subdir)", async () => {
    const a = writeDrop(storage, "main", "f", Buffer.from("x"));
    const h = await makeHandler();
    const r = await call(h, {
      method: "DELETE",
      url: `/api/drops?session=main&id=${encodeURIComponent(a.dropId)}`,
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ deleted: true, id: a.dropId });
    expect(fs.existsSync(path.dirname(a.absolutePath))).toBe(false);
  });

  test("DELETE with no id purges the session dir and reports count", async () => {
    writeDrop(storage, "main", "a", Buffer.from("a"));
    writeDrop(storage, "main", "b", Buffer.from("b"));
    writeDrop(storage, "other", "c", Buffer.from("c"));

    const h = await makeHandler();
    const r = await call(h, { method: "DELETE", url: "/api/drops?session=main" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ purged: 2 });
    expect(fs.readdirSync(path.join(storage.root, "main"))).toHaveLength(0);
    expect(fs.readdirSync(path.join(storage.root, "other"))).toHaveLength(1);
  });

  test("DELETE of a non-existent id returns 404 but doesn't crash", async () => {
    const h = await makeHandler();
    const r = await call(h, {
      method: "DELETE",
      url: "/api/drops?session=main&id=nothing-here",
    });
    expect(r.status).toBe(404);
  });

  test("DELETE rejects an id that contains path separators (defence in depth)", async () => {
    const victim = writeDrop(storage, "other", "victim", Buffer.from("x"));
    const h = await makeHandler();
    const r = await call(h, {
      method: "DELETE",
      url: "/api/drops?session=main&id=" + encodeURIComponent("../other/" + victim.dropId),
    });
    expect(r.status).toBe(404);
    expect(fs.existsSync(path.dirname(victim.absolutePath))).toBe(true);
  });

  test("unsupported methods return 405", async () => {
    const h = await makeHandler();
    const r = await call(h, { method: "PATCH", url: "/api/drops?session=main" });
    expect(r.status).toBe(405);
  });
});
