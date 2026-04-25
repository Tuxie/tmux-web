import { describe, test, expect } from "bun:test";
import {
  SCROLLBAR_FORMAT,
  parseScrollbarState,
  buildScrollbarSubscriptionArgs,
  applyScrollbarAction,
  type ScrollbarAction,
} from "../../../src/server/scrollbar.ts";

describe("server scrollbar helpers", () => {
  test("SCROLLBAR_FORMAT is the agreed tab-separated tmux format", () => {
    expect(SCROLLBAR_FORMAT).toBe("#{pane_id}\\t#{pane_height}\\t#{history_size}\\t#{scroll_position}\\t#{pane_in_mode}\\t#{pane_mode}\\t#{alternate_on}");
  });

  test("parseScrollbarState parses numeric fields and alternate screen", () => {
    expect(parseScrollbarState("%4\t42\t1200\t7\t1\tcopy-mode\t0")).toEqual({
      paneId: "%4",
      paneHeight: 42,
      historySize: 1200,
      scrollPosition: 7,
      paneInMode: 1,
      paneMode: "copy-mode",
      alternateOn: false,
    });
    expect(parseScrollbarState("%5\t10\t0\t0\t0\t\t1")?.alternateOn).toBe(true);
  });

  test("parseScrollbarState returns unavailable for malformed values", () => {
    expect(parseScrollbarState("")).toEqual({
      paneId: null,
      paneHeight: 0,
      historySize: 0,
      scrollPosition: 0,
      paneInMode: 0,
      paneMode: "",
      alternateOn: false,
      unavailable: true,
    });
    expect(parseScrollbarState("%4\tbad\t1200\t7\t1\tcopy-mode\t0")?.unavailable).toBe(true);
  });

  test("buildScrollbarSubscriptionArgs uses refresh-client -B", () => {
    expect(buildScrollbarSubscriptionArgs("tw-scroll-main")).toEqual([
      "refresh-client",
      "-B",
      "tw-scroll-main:%*:" + SCROLLBAR_FORMAT,
    ]);
  });

  test("line-up enters copy-mode -e and scrolls active pane", async () => {
    const calls: readonly string[][] = [];
    const mutableCalls: string[][] = calls as string[][];
    await applyScrollbarAction({
      action: "line-up",
      count: 3,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false }),
      run: async (args) => { mutableCalls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "3", "scroll-up"],
    ]);
  });

  test("line-down sends scroll-down without entering copy mode", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "line-down",
      count: 2,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 10, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["send-keys", "-X", "-t", "%4", "-N", "2", "scroll-down"],
    ]);
  });

  test("line-up and line-down use fallback count and clamp count to 500", async () => {
    const lineUpCalls: string[][] = [];
    await applyScrollbarAction({
      action: "line-up",
      count: Number.NaN,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false }),
      run: async (args) => { lineUpCalls.push([...args]); return ""; },
    });
    expect(lineUpCalls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "1", "scroll-up"],
    ]);

    const lineDownCalls: string[][] = [];
    await applyScrollbarAction({
      action: "line-down",
      count: 999,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { lineDownCalls.push([...args]); return ""; },
    });
    expect(lineDownCalls).toEqual([
      ["send-keys", "-X", "-t", "%4", "-N", "500", "scroll-down"],
    ]);
  });

  test("page-up enters copy mode and scrolls pane height minus one", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "page-up",
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "39", "scroll-up"],
    ]);
  });

  test("page-up scroll count has minimum one", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "page-up",
      getState: async () => ({ paneId: "%4", paneHeight: 0, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "1", "scroll-up"],
    ]);
  });

  test("page-down scrolls pane height minus one without entering copy mode", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "page-down",
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 39, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["send-keys", "-X", "-t", "%4", "-N", "39", "scroll-down"],
    ]);
  });

  test("page-down scroll count has minimum one", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "page-down",
      getState: async () => ({ paneId: "%4", paneHeight: 1, historySize: 100, scrollPosition: 1, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["send-keys", "-X", "-t", "%4", "-N", "1", "scroll-down"],
    ]);
  });

  test("drag computes delta from current scroll position", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "drag",
      position: 70,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 25, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "45", "scroll-up"],
    ]);
  });

  test("drag downward delta sends scroll-down", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "drag",
      position: 10,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 25, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "15", "scroll-down"],
    ]);
  });

  test("drag target clamps to zero and history size", async () => {
    const beforeHistoryCalls: string[][] = [];
    await applyScrollbarAction({
      action: "drag",
      position: -10,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 25, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { beforeHistoryCalls.push([...args]); return ""; },
    });
    expect(beforeHistoryCalls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "25", "scroll-down"],
    ]);

    const pastHistoryCalls: string[][] = [];
    await applyScrollbarAction({
      action: "drag",
      position: 999,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 25, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { pastHistoryCalls.push([...args]); return ""; },
    });
    expect(pastHistoryCalls).toEqual([
      ["copy-mode", "-e", "-t", "%4"],
      ["send-keys", "-X", "-t", "%4", "-N", "75", "scroll-up"],
    ]);
  });

  test("drag no-ops when target equals current scroll position", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "drag",
      position: 25,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 25, paneInMode: 1, paneMode: "copy-mode", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([]);
  });

  test("alternate screen and no history are no-ops", async () => {
    const actions: ScrollbarAction[] = [{ action: "line-up", count: 1 }, { action: "drag", position: 10 }];
    for (const action of actions) {
      const calls: string[][] = [];
      await applyScrollbarAction({
        ...action,
        getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 0, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: true }),
        run: async (args) => { calls.push([...args]); return ""; },
      });
      expect(calls).toEqual([]);
    }
  });

  test("unavailable state is a no-op", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "line-up",
      count: 1,
      getState: async () => ({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false, unavailable: true }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([]);
  });

  test("missing pane id is a no-op", async () => {
    const calls: string[][] = [];
    await applyScrollbarAction({
      action: "line-up",
      count: 1,
      getState: async () => ({ paneId: null, paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false }),
      run: async (args) => { calls.push([...args]); return ""; },
    });
    expect(calls).toEqual([]);
  });
});
