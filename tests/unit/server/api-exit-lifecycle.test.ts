import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { createHttpHandler } from "../../../src/server/http.ts";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-exit-life-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function makeHandler() {
  return await createHttpHandler({
    config: {
      host: "127.0.0.1", port: 0, allowedIps: new Set(["127.0.0.1"]),
      allowedOrigins: [], tls: false, testMode: true, debug: false,
      tmuxBin: "/bin/true", auth: { enabled: false },
    } as any,
    htmlTemplate: "<html></html>", distDir: tmp,
    themesUserDir: tmp, themesBundledDir: tmp, projectRoot: tmp,
    isCompiled: false,
    sessionsStorePath: path.join(tmp, "sessions.json"),
    dropStorage: { root: path.join(tmp, "drop"), maxFilesPerSession: 20, ttlMs: 60_000 } as any,
    tmuxControl: { run: async () => "", attachSession: async () => {}, detachSession: () => {}, on: () => () => {}, hasSession: () => false, close: async () => {} } as any,
  });
}

describe("/api/exit lifecycle (cluster 15 / F1)", () => {
  test("response is fully delivered before process.exit fires (server.stop completes first)", async () => {
    const handler = await makeHandler();

    // Capture process.exit and server.stop ordering. The contract is:
    // 1. Response is returned (and can be read fully) immediately.
    // 2. server.stop() is called and resolves.
    // 3. THEN process.exit fires.
    const events: string[] = [];
    const realExit = process.exit;
    const exitFired = new Promise<number>((resolve) => {
      // Cast through unknown — we deliberately monkey-patch process.exit
      // for the duration of this test so the real exit doesn't tear down
      // the test runner.
      (process as unknown as { exit: (code?: number) => void }).exit = (code?: number) => {
        events.push("exit");
        resolve(code ?? 0);
        // No-op return — we don't actually want to exit the test runner.
        // We can't make the type checker accept `void` here because the
        // real signature returns `never`, but at runtime nothing reads it.
        return undefined as unknown as never;
      };
    });

    let stopResolved = false;
    let stopCalled = false;
    const fakeServer: any = {
      port: 0,
      requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 0 }),
      stop: async (closeActiveConnections?: boolean) => {
        stopCalled = true;
        events.push("stop:" + (closeActiveConnections ?? "default"));
        // Yield once so the test can prove stop has to resolve before
        // exit fires (i.e. the handler awaits it rather than firing exit
        // immediately).
        await new Promise(r => setTimeout(r, 5));
        stopResolved = true;
        events.push("stop-resolved");
      },
    };

    try {
      const req = new Request("http://x/api/exit?action=quit", { method: "POST" });
      const res = await handler(req, fakeServer);

      // Critical invariant: the handler returned synchronously, NOT inside
      // a `setTimeout(..., 100)` or other delay. The previous shape was
      // `setTimeout(() => process.exit, 100); return Response` — under
      // load the response could still be in-flight when exit ran. The
      // new shape resolves the response object first, then performs the
      // shutdown via a queued microtask.
      expect(res.status).toBe(200);

      // Process.exit must NOT have fired synchronously. (If F1 regressed
      // to fire process.exit before the response body is read, exitFired
      // would already be settled here; we verify it's still pending by
      // racing against an immediate timeout.)
      let exitedEarly = false;
      await Promise.race([
        exitFired.then(() => { exitedEarly = true; }),
        new Promise(r => setTimeout(r, 0)),
      ]);
      expect(exitedEarly).toBe(false);

      // Response body must be fully readable.
      const body = await res.text();
      expect(body).toBe("quitting");

      // Wait for the deferred shutdown chain to fire process.exit.
      const code = await exitFired;
      expect(stopCalled).toBe(true);
      expect(stopResolved).toBe(true);
      expect(code).toBe(0);

      // Ordering invariant on the events that the shutdown chain emits:
      // stop-called → stop-resolved → exit. Without the await, exit would
      // race stop-resolved.
      const stopCalledIdx = events.findIndex(e => e.startsWith("stop:"));
      const stopResolvedIdx = events.indexOf("stop-resolved");
      const exitIdx = events.indexOf("exit");
      expect(stopCalledIdx).toBeGreaterThanOrEqual(0);
      expect(stopResolvedIdx).toBeGreaterThan(stopCalledIdx);
      expect(exitIdx).toBeGreaterThan(stopResolvedIdx);
    } finally {
      (process as unknown as { exit: typeof realExit }).exit = realExit;
    }
  });

  test("action=restart exits with code 2", async () => {
    const handler = await makeHandler();

    const realExit = process.exit;
    let capturedCode: number | undefined;
    const exitFired = new Promise<number>((resolve) => {
      (process as unknown as { exit: (code?: number) => void }).exit = (code?: number) => {
        capturedCode = code ?? 0;
        resolve(capturedCode);
        return undefined as unknown as never;
      };
    });

    const fakeServer: any = {
      port: 0,
      requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 0 }),
      stop: async () => { /* no-op fast resolve */ },
    };

    try {
      const req = new Request("http://x/api/exit?action=restart", { method: "POST" });
      const res = await handler(req, fakeServer);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("restarting");
      const code = await exitFired;
      expect(code).toBe(2);
    } finally {
      (process as unknown as { exit: typeof realExit }).exit = realExit;
    }
  });

  test("server.stop() throwing does not block process.exit", async () => {
    // If server.stop() rejects (e.g. Bun internal hiccup), we must still
    // process.exit — not leave the daemon in a half-stopped state.
    const handler = await makeHandler();

    const realExit = process.exit;
    let capturedCode: number | undefined;
    const exitFired = new Promise<number>((resolve) => {
      (process as unknown as { exit: (code?: number) => void }).exit = (code?: number) => {
        capturedCode = code ?? 0;
        resolve(capturedCode);
        return undefined as unknown as never;
      };
    });

    const fakeServer: any = {
      port: 0,
      requestIP: () => ({ address: "127.0.0.1", family: "IPv4", port: 0 }),
      stop: async () => { throw new Error("boom"); },
    };

    try {
      const req = new Request("http://x/api/exit?action=quit", { method: "POST" });
      const res = await handler(req, fakeServer);
      expect(res.status).toBe(200);
      const code = await exitFired;
      expect(code).toBe(0);
      expect(capturedCode).toBe(0);
    } finally {
      (process as unknown as { exit: typeof realExit }).exit = realExit;
    }
  });
});
