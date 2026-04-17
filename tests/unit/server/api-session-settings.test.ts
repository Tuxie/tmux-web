import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { createHttpHandler } from "../../../src/server/http.ts";

let tmp: string;
let storePath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-api-ss-"));
  storePath = path.join(tmp, "sessions.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SAMPLE = {
  theme: "Default",
  colours: "Nord",
  fontFamily: "Iosevka",
  fontSize: 18,
  spacing: 0.85,
  opacity: 0,
};

async function makeHandler() {
  return await createHttpHandler({
    config: { host: "", port: 0, allowedIps: new Set(), tls: false, testMode: true, debug: false,
              tmuxBin: "tmux", auth: { enabled: false } } as any,
    htmlTemplate: "", distDir: "",
    themesUserDir: tmp,
    themesBundledDir: tmp, projectRoot: tmp, isCompiled: false,
    sessionsStorePath: storePath,
    dropStorage: { root: path.join(tmp, "drop"), maxFilesPerSession: 20, ttlMs: 60_000 },
  });
}

function call(handler: any, opts: { method: string; url: string; body?: string }): Promise<{status: number; body: string}> {
  return new Promise((resolve) => {
    const stream: any = opts.body !== undefined
      ? Readable.from([Buffer.from(opts.body)])
      : Readable.from([]);
    stream.method = opts.method;
    stream.url = opts.url;
    stream.headers = { host: "x" };
    stream.socket = { remoteAddress: "127.0.0.1" };
    const res: any = {
      writeHead(status: number, _h?: any) { this._status = status; },
      end(body?: any) { resolve({ status: this._status ?? 200, body: body?.toString?.() ?? "" }); },
    };
    Promise.resolve(handler(stream, res));
  });
}

describe("/api/session-settings", () => {
  test("GET returns empty config when file missing", async () => {
    const handler = await makeHandler();
    const { status, body } = await call(handler, { method: "GET", url: "/api/session-settings" });
    expect(status).toBe(200);
    const cfg = JSON.parse(body);
    expect(cfg.sessions).toEqual({});
  });

  test("PUT saves a session and round-trips via GET", async () => {
    const handler = await makeHandler();
    const put = await call(handler, {
      method: "PUT", url: "/api/session-settings",
      body: JSON.stringify({ sessions: { main: SAMPLE }, lastActive: "main" }),
    });
    expect(put.status).toBe(200);
    expect(fs.existsSync(storePath)).toBe(true);
    const get = await call(handler, { method: "GET", url: "/api/session-settings" });
    const cfg = JSON.parse(get.body);
    expect(cfg.lastActive).toBe("main");
    expect(cfg.sessions.main.colours).toBe("Nord");
  });

  test("PUT merges incrementally without losing other sessions", async () => {
    const handler = await makeHandler();
    await call(handler, {
      method: "PUT", url: "/api/session-settings",
      body: JSON.stringify({ sessions: { a: SAMPLE } }),
    });
    await call(handler, {
      method: "PUT", url: "/api/session-settings",
      body: JSON.stringify({ sessions: { b: { ...SAMPLE, colours: "Solarized" } } }),
    });
    const get = await call(handler, { method: "GET", url: "/api/session-settings" });
    const cfg = JSON.parse(get.body);
    expect(cfg.sessions.a).toBeDefined();
    expect(cfg.sessions.b.colours).toBe("Solarized");
  });

  test("PUT with malformed JSON returns 400", async () => {
    const handler = await makeHandler();
    const r = await call(handler, { method: "PUT", url: "/api/session-settings", body: "not json" });
    expect(r.status).toBe(400);
  });

  test("write is atomic: no .part file lingers after success", async () => {
    const handler = await makeHandler();
    await call(handler, {
      method: "PUT", url: "/api/session-settings",
      body: JSON.stringify({ sessions: { main: SAMPLE } }),
    });
    expect(fs.existsSync(storePath + ".part")).toBe(false);
  });
});
