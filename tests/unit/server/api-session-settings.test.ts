import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createHttpHandler } from "../../../src/server/http.ts";
import { callHandler } from "./_harness/call-handler.ts";

let tmp: string;
let storePath: string;
let settingsPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-api-ss-"));
  storePath = path.join(tmp, "sessions.json");
  settingsPath = path.join(tmp, "settings.json");
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
    settingsStorePath: settingsPath,
    dropStorage: { root: path.join(tmp, "drop"), maxFilesPerSession: 20, ttlMs: 60_000 },
    tmuxControl: { run: async () => "", attachSession: async () => {}, detachSession: () => {}, close: async () => {} } as any,
  });
}

function call(handler: any, opts: { method: string; url: string; body?: string }): Promise<{status: number; body: string}> {
  return callHandler(handler, opts);
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
    expect(cfg.sessions.a).toMatchObject({ colours: SAMPLE.colours });
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

  test("PUT with a clipboard field on a session patch is rejected with 400", async () => {
    // Clipboard grants are consent-only (recorded server-side via
    // recordGrant after the prompt accepts). Accepting them on PUT
    // would let an authenticated client pre-seed allow-grants for any
    // exePath they control. See cluster 06-post-auth-data-handling.
    const handler = await makeHandler();
    const r = await call(handler, {
      method: "PUT", url: "/api/session-settings",
      body: JSON.stringify({
        sessions: {
          main: {
            ...SAMPLE,
            clipboard: {
              '/usr/bin/tmux': {
                blake3: 'deadbeef'.repeat(8),
                read: true,
                write: true,
              },
            },
          },
        },
      }),
    });
    expect(r.status).toBe(400);
    expect(r.body).toContain('clipboard');
    // Store file must not have been created: the patch never ran.
    expect(fs.existsSync(storePath)).toBe(false);
  });

  test("PUT without clipboard still succeeds (regression guard)", async () => {
    const handler = await makeHandler();
    const r = await call(handler, {
      method: "PUT", url: "/api/session-settings",
      body: JSON.stringify({ sessions: { main: SAMPLE } }),
    });
    expect(r.status).toBe(200);
  });
});

describe("/api/settings", () => {
  test("GET returns empty knownServers when settings.json is missing", async () => {
    const handler = await makeHandler();
    const { status, body } = await call(handler, { method: "GET", url: "/api/settings" });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ version: 1, knownServers: [] });
  });

  test("PUT persists valid known remote servers to settings.json", async () => {
    const handler = await makeHandler();
    const put = await call(handler, {
      method: "PUT",
      url: "/api/settings",
      body: JSON.stringify({ knownServers: ["dev"] }),
    });
    expect(put.status).toBe(200);

    const get = await call(handler, { method: "GET", url: "/api/settings" });
    expect(JSON.parse(get.body)).toEqual({ version: 1, knownServers: ["dev"] });
  });

  test("PUT rejects invalid known remote server aliases", async () => {
    const handler = await makeHandler();
    const r = await call(handler, {
      method: "PUT",
      url: "/api/settings",
      body: JSON.stringify({ knownServers: ["-Jbad"] }),
    });
    expect(r.status).toBe(400);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });
});

describe("/api/remote-sessions", () => {
  test("GET lists sessions through the remote agent manager", async () => {
    const handler = await createHttpHandler({
      config: { host: "", port: 0, allowedIps: new Set(), tls: false, testMode: true, debug: false,
                tmuxBin: "tmux", auth: { enabled: false } } as any,
      htmlTemplate: "", distDir: "",
      themesUserDir: tmp,
      themesBundledDir: tmp, projectRoot: tmp, isCompiled: false,
      sessionsStorePath: storePath,
      settingsStorePath: settingsPath,
      dropStorage: { root: path.join(tmp, "drop"), maxFilesPerSession: 20, ttlMs: 60_000 },
      tmuxControl: { run: async () => "", attachSession: async () => {}, detachSession: () => {}, close: async () => {} } as any,
      remoteAgentManager: {
        async getHost(host: string) {
          expect(host).toBe("dev");
          return { listSessions: async () => [{ id: "1", name: "main", windows: 2 }] };
        },
      },
    });

    const r = await call(handler, { method: "GET", url: "/api/remote-sessions?host=dev" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual([{ id: "1", name: "main", windows: 2 }]);
  });

  test("GET rejects invalid remote host aliases", async () => {
    const handler = await makeHandler();
    const r = await call(handler, { method: "GET", url: "/api/remote-sessions?host=-Jbad" });
    expect(r.status).toBe(400);
  });
});
