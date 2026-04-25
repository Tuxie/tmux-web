import { describe, expect, test } from "bun:test";
import { runServerCleanup } from "../../../src/server/index.ts";
import type { DropStorage } from "../../../src/server/file-drop.ts";

describe("runServerCleanup", () => {
  test("awaits tmux-control and drop cleanup before resolving", async () => {
    const events: string[] = [];
    let resolveTmux!: () => void;
    let resolveDrops!: () => void;
    const tmuxClosed = new Promise<void>(resolve => { resolveTmux = resolve; });
    const dropsCleaned = new Promise<void>(resolve => { resolveDrops = resolve; });

    const cleanup = runServerCleanup({
      ws: { close: () => { events.push("ws"); } },
      tmuxControl: {
        close: async () => {
          events.push("tmux:start");
          await tmuxClosed;
          events.push("tmux:done");
        },
      },
      dropStorage: { root: "/tmp/tw-test", maxFilesPerSession: 1, ttlMs: 1, autoUnlinkOnClose: false },
      cleanupDrops: async (_storage: DropStorage) => {
        events.push("drops:start");
        await dropsCleaned;
        events.push("drops:done");
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["ws", "tmux:start", "drops:start"]);

    resolveTmux();
    await Promise.resolve();
    expect(events).toEqual(["ws", "tmux:start", "drops:start", "tmux:done"]);

    resolveDrops();
    await cleanup;
    expect(events).toEqual(["ws", "tmux:start", "drops:start", "tmux:done", "drops:done"]);
  });
});
