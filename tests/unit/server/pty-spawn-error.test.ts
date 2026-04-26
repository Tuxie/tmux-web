import { describe, test, expect } from "bun:test";
import { spawnPty, buildPtyEnv } from "../../../src/server/pty.ts";

describe("spawnPty Bun.spawn error handling (cluster 15 / F5)", () => {
  test("non-existent binary surfaces a structured spawnError, not a thrown exception", () => {
    // The previous shape let `Bun.spawn` propagate up; ws.ts:252 didn't
    // try/catch the call so the WS handler crashed mid-handle and the WS
    // closed with an uninformative 1006. New shape: spawnPty catches the
    // spawn error and returns a no-op BunPty whose `spawnError` is
    // populated; ws.ts handleOpen detects this and emits a structured
    // {ptyExit:true, exitCode:-1, exitReason} before closing the WS.
    const pty = spawnPty({
      command: { file: "/this/path/does/not/exist/abcdef-deliberately", args: [] },
      env: buildPtyEnv(),
      cols: 80, rows: 24,
    });
    expect(pty.spawnError).toBeDefined();
    expect(pty.pid).toBe(0);

    // No-op methods must not throw.
    expect(() => pty.write("anything")).not.toThrow();
    expect(() => pty.resize(120, 30)).not.toThrow();
    expect(() => pty.kill()).not.toThrow();

    // onData / onExit can still be registered (they just never fire).
    expect(() => pty.onData(() => {})).not.toThrow();
    expect(() => pty.onExit(() => {})).not.toThrow();
  });

  test("successful spawn does not set spawnError (regression guard)", () => {
    // /bin/true exists everywhere we run unit tests (Linux + macOS CI).
    // We just verify the absence of `spawnError` and that `pid` is real.
    const pty = spawnPty({
      command: { file: "/bin/true", args: [] },
      env: buildPtyEnv(),
      cols: 80, rows: 24,
    });
    expect(pty.spawnError).toBeUndefined();
    expect(pty.pid).toBeGreaterThan(0);
    pty.kill();
  });
});
