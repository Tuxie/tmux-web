# Themeable tmux Scrollbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a themeable scrollbar that reflects and controls tmux active-pane scrollback instead of xterm.js scrollback.

**Architecture:** tmux is the source of truth. The server subscribes to active-pane scroll formats through the existing tmux control-mode pool, emits `scrollbar` TT messages, and applies scroll actions as tmux copy-mode commands. The client owns a single scrollbar controller that handles terminal wheel, scrollbar wheel, track click, and thumb drag, while allowing alternate-screen wheel events to pass through as existing SGR mouse input.

**Tech Stack:** TypeScript, Bun, tmux control mode, xterm.js WebGL-only terminal adapter, project CSS theme variables, `bun test`, Playwright e2e.

---

## File Structure

- Modify `src/shared/types.ts`: add shared `ScrollbarState`, `ScrollbarActionMessage`, and `ServerMessage.scrollbar`.
- Modify `src/client/session-settings.ts`: add `topbarAutohide` and `scrollbarAutohide` to `SessionSettings` and defaults.
- Modify `src/server/sessions-store.ts`: persist optional autohide fields in `StoredSessionSettings`.
- Modify `src/client/prefs.ts`: remove topbar autohide localStorage/cookie helpers; keep font AA and window tabs helpers.
- Modify `src/client/index.html`: add `#chk-scrollbar-autohide` next to `#chk-autohide`, and add the scrollbar DOM container.
- Modify `src/client/base.css`: add layout rules for pinned/autohide scrollbar, scrollbar structure, and theme variable fallbacks.
- Modify `src/client/ui/topbar.ts`: read/write both autohide booleans through `SessionSettings`, not `prefs.ts`.
- Create `src/client/ui/scrollbar.ts`: pure thumb math plus DOM controller and input normalization.
- Modify `src/client/message-handler.ts`: dispatch `scrollbar` TT messages to the client controller.
- Modify `src/client/index.ts`: instantiate the scrollbar controller, route terminal wheel through it, and refit on autohide changes.
- Modify `src/server/tmux-control.ts`: parse `%subscription-changed` notifications and expose them through `TmuxNotification`.
- Create `src/server/scrollbar.ts`: parse tmux format state and translate scrollbar actions into tmux commands.
- Modify `src/server/ws-router.ts`: route client `scrollbar` messages into typed actions.
- Modify `src/server/ws.ts`: subscribe to tmux scroll state per websocket, emit `scrollbar` TT messages, and dispatch scroll actions.
- Add/modify tests under `tests/unit/client`, `tests/unit/server`, and `tests/e2e`.

## Task 1: Shared Types And Per-Session Autohide Defaults

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/client/session-settings.ts`
- Modify: `src/server/sessions-store.ts`
- Modify: `src/client/prefs.ts`
- Modify: `tests/unit/client/session-settings.test.ts`
- Modify: `tests/unit/client/prefs.test.ts`
- Modify: `tests/unit/server/sessions-store.test.ts`

- [ ] **Step 1: Write failing client session-settings tests**

Add these tests to `tests/unit/client/session-settings.test.ts` inside `describe("session-settings", ...)`:

```ts
test("autohide settings default to false when missing", async () => {
  await initSessionStore();
  const s = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
  expect(s.topbarAutohide).toBe(false);
  expect(s.scrollbarAutohide).toBe(false);
});

test("stored autohide settings round-trip through cache and PUT body", async () => {
  const calls = setupFakeFetch({ sessions: {} });
  await initSessionStore();
  const s = {
    ...DEFAULT_SESSION_SETTINGS,
    topbarAutohide: true,
    scrollbarAutohide: true,
  };
  saveSessionSettings("main", s);
  const loaded = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
  expect(loaded.topbarAutohide).toBe(true);
  expect(loaded.scrollbarAutohide).toBe(true);
  await new Promise(r => setTimeout(r, 0));
  const put = calls.find(c => c.init?.method === "PUT");
  expect(put).toBeDefined();
  const body = JSON.parse(put!.init!.body as string);
  expect(body.sessions.main.topbarAutohide).toBe(true);
  expect(body.sessions.main.scrollbarAutohide).toBe(true);
});
```

- [ ] **Step 2: Update prefs tests to remove toolbar autohide expectations**

In `tests/unit/client/prefs.test.ts`, delete the import and tests for `getTopbarAutohide` and `setTopbarAutohide`. Keep the subpixel AA and show-window-tabs tests unchanged.

The remaining import from `src/client/prefs.ts` should look like:

```ts
import {
  getFontSubpixelAA,
  setFontSubpixelAA,
  getShowWindowTabs,
  setShowWindowTabs,
} from "../../../src/client/prefs.ts";
```

- [ ] **Step 3: Write failing server persistence test**

Add this test to `tests/unit/server/sessions-store.test.ts`:

```ts
test("mergeConfig preserves per-session autohide fields", () => {
  const current = emptyConfig();
  const next = mergeConfig(current, {
    sessions: {
      main: {
        theme: "Default",
        colours: "Gruvbox Dark",
        fontFamily: "Iosevka Nerd Font Mono",
        fontSize: 18,
        spacing: 0.85,
        opacity: 0,
        topbarAutohide: true,
        scrollbarAutohide: true,
      },
    },
  });
  expect(next.sessions.main?.topbarAutohide).toBe(true);
  expect(next.sessions.main?.scrollbarAutohide).toBe(true);
});
```

- [ ] **Step 4: Run the focused tests and confirm failure**

Run:

```bash
bun test tests/unit/client/session-settings.test.ts tests/unit/client/prefs.test.ts tests/unit/server/sessions-store.test.ts
```

Expected: session-settings type/runtime tests fail because `topbarAutohide` and `scrollbarAutohide` do not exist; prefs tests fail until topbar localStorage helpers are removed from the import/test set.

- [ ] **Step 5: Implement shared and persisted autohide fields**

In `src/client/session-settings.ts`, add fields to `SessionSettings`:

```ts
  topbarAutohide: boolean;
  scrollbarAutohide: boolean;
```

Add defaults to `DEFAULT_SESSION_SETTINGS`:

```ts
  topbarAutohide: false,
  scrollbarAutohide: false,
```

Do not add these fields to `ThemeDefaults` or `applyThemeDefaults`; theme changes must not overwrite per-session chrome autohide choices.

In `src/server/sessions-store.ts`, add optional persisted fields to `StoredSessionSettings`:

```ts
  topbarAutohide?: boolean;
  scrollbarAutohide?: boolean;
```

In `src/shared/types.ts`, add:

```ts
export interface ScrollbarState {
  paneId: string | null;
  paneHeight: number;
  historySize: number;
  scrollPosition: number;
  paneInMode: number;
  paneMode: string;
  alternateOn: boolean;
  unavailable?: boolean;
}

export interface ScrollbarActionMessage {
  type: "scrollbar";
  action: "line-up" | "line-down" | "page-up" | "page-down" | "drag";
  count?: number;
  position?: number;
  paneId?: string;
}
```

Extend `ServerMessage`:

```ts
  scrollbar?: ScrollbarState;
```

In `src/client/prefs.ts`, remove the `KEY`, `LEGACY_SETTINGS_COOKIE`, `readLegacyTopbarAutohideCookie`, `getTopbarAutohide`, and `setTopbarAutohide` code. Leave subpixel AA and show-window-tabs code intact.

- [ ] **Step 6: Run focused tests and confirm pass**

Run:

```bash
bun test tests/unit/client/session-settings.test.ts tests/unit/client/prefs.test.ts tests/unit/server/sessions-store.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/client/session-settings.ts src/server/sessions-store.ts src/client/prefs.ts tests/unit/client/session-settings.test.ts tests/unit/client/prefs.test.ts tests/unit/server/sessions-store.test.ts
git commit -m "Add per-session chrome autohide settings"
```

## Task 2: Parse tmux Scrollbar Subscription Notifications

**Files:**
- Modify: `src/server/tmux-control.ts`
- Modify: `tests/unit/server/tmux-control-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add these tests to `tests/unit/server/tmux-control-parser.test.ts`:

```ts
test("parses %subscription-changed notification", () => {
  const notes: TmuxNotification[] = [];
  const parser = new ControlParser({
    onResponse: () => {},
    onError: () => {},
    onNotification: (n) => notes.push(n),
  });
  parser.push("%subscription-changed tw-scroll $1 @2 3 %4 : %4\\t42\\t1200\\t7\\t1\\tcopy-mode\\t0\n");
  expect(notes).toEqual([{
    type: "subscriptionChanged",
    name: "tw-scroll",
    sessionId: "$1",
    windowId: "@2",
    windowIndex: "3",
    paneId: "%4",
    value: "%4\\t42\\t1200\\t7\\t1\\tcopy-mode\\t0",
  }]);
});

test("parses %subscription-changed with empty value", () => {
  const notes: TmuxNotification[] = [];
  const parser = new ControlParser({
    onResponse: () => {},
    onError: () => {},
    onNotification: (n) => notes.push(n),
  });
  parser.push("%subscription-changed tw-scroll $1 @2 3 %4 : \n");
  expect(notes).toEqual([{
    type: "subscriptionChanged",
    name: "tw-scroll",
    sessionId: "$1",
    windowId: "@2",
    windowIndex: "3",
    paneId: "%4",
    value: "",
  }]);
});
```

- [ ] **Step 2: Run parser test and confirm failure**

Run:

```bash
bun test tests/unit/server/tmux-control-parser.test.ts
```

Expected: the new tests fail because `subscriptionChanged` is not in `TmuxNotification`.

- [ ] **Step 3: Implement notification type and parser branch**

In `src/server/tmux-control.ts`, extend `TmuxNotification`:

```ts
  | {
      type: "subscriptionChanged";
      name: string;
      sessionId: string;
      windowId: string;
      windowIndex: string;
      paneId: string;
      value: string;
    };
```

In `parseNotification`, add this `case`:

```ts
    case "%subscription-changed": {
      const marker = " : ";
      const markerIdx = rest.indexOf(marker);
      if (markerIdx < 0) return null;
      const head = rest.slice(0, markerIdx);
      const value = rest.slice(markerIdx + marker.length);
      const parts = head.split(" ");
      if (parts.length < 5) return null;
      const [name, sessionId, windowId, windowIndex, paneId] = parts;
      if (!name || !sessionId || !windowId || !windowIndex || !paneId) return null;
      return {
        type: "subscriptionChanged",
        name,
        sessionId,
        windowId,
        windowIndex,
        paneId,
        value,
      };
    }
```

- [ ] **Step 4: Run parser test and confirm pass**

Run:

```bash
bun test tests/unit/server/tmux-control-parser.test.ts
```

Expected: all parser tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/tmux-control.ts tests/unit/server/tmux-control-parser.test.ts
git commit -m "Parse tmux subscription notifications"
```

## Task 3: Server Scrollbar State And Command Semantics

**Files:**
- Create: `src/server/scrollbar.ts`
- Create: `tests/unit/server/scrollbar.test.ts`

- [ ] **Step 1: Write failing server scrollbar tests**

Create `tests/unit/server/scrollbar.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run server scrollbar test and confirm failure**

Run:

```bash
bun test tests/unit/server/scrollbar.test.ts
```

Expected: fails because `src/server/scrollbar.ts` does not exist.

- [ ] **Step 3: Implement `src/server/scrollbar.ts`**

Create `src/server/scrollbar.ts` with:

```ts
import type { ScrollbarState } from "../shared/types.js";
import type { RunCmd } from "./tmux-control.js";

export const SCROLLBAR_FORMAT = "#{pane_id}\\t#{pane_height}\\t#{history_size}\\t#{scroll_position}\\t#{pane_in_mode}\\t#{pane_mode}\\t#{alternate_on}";

export type ScrollbarAction =
  | { action: "line-up"; count?: number }
  | { action: "line-down"; count?: number }
  | { action: "page-up" }
  | { action: "page-down" }
  | { action: "drag"; position?: number };

export function unavailableScrollbarState(): ScrollbarState {
  return {
    paneId: null,
    paneHeight: 0,
    historySize: 0,
    scrollPosition: 0,
    paneInMode: 0,
    paneMode: "",
    alternateOn: false,
    unavailable: true,
  };
}

function parseNonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseScrollbarState(raw: string): ScrollbarState {
  const parts = raw.split("\t");
  if (parts.length !== 7) return unavailableScrollbarState();
  const [paneId, paneHeightRaw, historySizeRaw, scrollPositionRaw, paneInModeRaw, paneMode, alternateOnRaw] = parts;
  const paneHeight = parseNonNegativeInt(paneHeightRaw);
  const historySize = parseNonNegativeInt(historySizeRaw);
  const scrollPosition = parseNonNegativeInt(scrollPositionRaw);
  const paneInMode = parseNonNegativeInt(paneInModeRaw);
  if (!paneId || paneHeight === null || historySize === null || scrollPosition === null || paneInMode === null) {
    return unavailableScrollbarState();
  }
  return {
    paneId,
    paneHeight,
    historySize,
    scrollPosition,
    paneInMode,
    paneMode,
    alternateOn: alternateOnRaw === "1",
  };
}

export function buildScrollbarSubscriptionArgs(name: string): string[] {
  return ["refresh-client", "-B", `${name}:%*:${SCROLLBAR_FORMAT}`];
}

function countFrom(action: { count?: number }, fallback: number): number {
  const n = typeof action.count === "number" && Number.isFinite(action.count) ? Math.round(action.count) : fallback;
  return Math.max(1, Math.min(n, 500));
}

async function ensureCopyMode(run: RunCmd, paneId: string): Promise<void> {
  await run(["copy-mode", "-e", "-t", paneId]);
}

async function sendCopyScroll(run: RunCmd, paneId: string, count: number, direction: "scroll-up" | "scroll-down"): Promise<void> {
  await run(["send-keys", "-X", "-t", paneId, "-N", String(count), direction]);
}

export async function applyScrollbarAction(opts: {
  action: ScrollbarAction["action"];
  count?: number;
  position?: number;
  getState: () => Promise<ScrollbarState>;
  run: RunCmd;
}): Promise<void> {
  const state = await opts.getState();
  if (state.unavailable || state.alternateOn || !state.paneId || state.historySize <= 0) return;

  if (opts.action === "line-up") {
    await ensureCopyMode(opts.run, state.paneId);
    await sendCopyScroll(opts.run, state.paneId, countFrom(opts, 1), "scroll-up");
    return;
  }
  if (opts.action === "line-down") {
    await sendCopyScroll(opts.run, state.paneId, countFrom(opts, 1), "scroll-down");
    return;
  }
  if (opts.action === "page-up") {
    await ensureCopyMode(opts.run, state.paneId);
    await sendCopyScroll(opts.run, state.paneId, Math.max(1, state.paneHeight - 1), "scroll-up");
    return;
  }
  if (opts.action === "page-down") {
    await sendCopyScroll(opts.run, state.paneId, Math.max(1, state.paneHeight - 1), "scroll-down");
    return;
  }
  if (opts.action === "drag") {
    const target = typeof opts.position === "number" && Number.isFinite(opts.position)
      ? Math.max(0, Math.min(Math.round(opts.position), state.historySize))
      : state.scrollPosition;
    const delta = target - state.scrollPosition;
    if (delta === 0) return;
    await ensureCopyMode(opts.run, state.paneId);
    await sendCopyScroll(opts.run, state.paneId, Math.abs(delta), delta > 0 ? "scroll-up" : "scroll-down");
  }
}
```

- [ ] **Step 4: Run server scrollbar test and confirm pass**

Run:

```bash
bun test tests/unit/server/scrollbar.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/scrollbar.ts tests/unit/server/scrollbar.test.ts
git commit -m "Add tmux scrollbar command helpers"
```

## Task 4: WebSocket Routing And Server Integration

**Files:**
- Modify: `src/server/ws-router.ts`
- Modify: `src/server/ws.ts`
- Modify: `tests/unit/server/ws-router.test.ts`
- Modify: `tests/unit/server/ws-handle-connection.test.ts`

- [ ] **Step 1: Write failing router tests**

Add these tests to `tests/unit/server/ws-router.test.ts`:

```ts
test("scrollbar line action validates count", () => {
  expect(routeClientMessage('{"type":"scrollbar","action":"line-up","count":4}', state()))
    .toEqual([{ type: "scrollbar", action: "line-up", count: 4 }]);
});

test("scrollbar drag action validates position", () => {
  expect(routeClientMessage('{"type":"scrollbar","action":"drag","position":25}', state()))
    .toEqual([{ type: "scrollbar", action: "drag", position: 25 }]);
});

test("invalid scrollbar action falls through as pty write", () => {
  const raw = '{"type":"scrollbar","action":"explode"}';
  expect(routeClientMessage(raw, state())).toEqual([{ type: "pty-write", data: raw }]);
});
```

- [ ] **Step 2: Write failing ws integration test for subscription emit**

Add this test near the other websocket handler tests in `tests/unit/server/ws-handle-connection.test.ts`:

```ts
test("tmux subscription change emits scrollbar TT message", async () => {
  const listeners: Partial<Record<TmuxNotification["type"], Array<(n: any) => void>>> = {};
  let subscriptionName = "";
  const tmuxControl: TmuxControl = {
    attachSession: async () => {},
    detachSession: () => {},
    hasSession: () => true,
    close: async () => {},
    run: async (args) => {
      if (args[0] === "refresh-client" && args[1] === "-B") {
        subscriptionName = String(args[2]).split(":")[0]!;
        return "";
      }
      if (args[0] === "display-message" && args.includes("#{pane_id}\\t#{pane_height}\\t#{history_size}\\t#{scroll_position}\\t#{pane_in_mode}\\t#{pane_mode}\\t#{alternate_on}")) {
        return "%4\t42\t1200\t0\t0\t\t0";
      }
      if (args[0] === "display-message") return "fake-title";
      if (args[0] === "list-windows") return "1\tmain\t1\n";
      return "";
    },
    on: (event, cb) => {
      (listeners[event] ??= []).push(cb as any);
      return () => {};
    },
  };
  h = await startTestServer({ testMode: false, tmuxControl });
  const o = openWs(h.wsUrl);
  await o.opened;
  await waitFor(() => subscriptionName.length > 0, 3000);
  listeners.subscriptionChanged?.[0]?.({
    type: "subscriptionChanged",
    name: subscriptionName,
    sessionId: "$1",
    windowId: "@1",
    windowIndex: "1",
    paneId: "%4",
    value: "%4\t42\t1200\t7\t1\tcopy-mode\t0",
  });
  const frame = await waitForMsg(o.messages, m => "scrollbar" in m, 3000);
  expect(frame?.scrollbar).toEqual({
    paneId: "%4",
    paneHeight: 42,
    historySize: 1200,
    scrollPosition: 7,
    paneInMode: 1,
    paneMode: "copy-mode",
    alternateOn: false,
  });
  o.ws.close();
});
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
bun test tests/unit/server/ws-router.test.ts tests/unit/server/ws-handle-connection.test.ts
```

Expected: router tests fail because `scrollbar` actions are unknown; ws test fails because subscription notifications are not wired.

- [ ] **Step 4: Implement router action**

In `src/server/ws-router.ts`, import the shared message type:

```ts
import type { ScrollbarActionMessage } from "../shared/types.js";
```

Extend `WsAction`:

```ts
  | { type: "scrollbar"; action: ScrollbarActionMessage["action"]; count?: number; position?: number };
```

Add this branch in `routeClientMessage` before the clipboard branches:

```ts
  if (parsed?.type === "scrollbar" && typeof parsed.action === "string") {
    const action = parsed.action;
    if (action === "line-up" || action === "line-down" || action === "page-up" || action === "page-down" || action === "drag") {
      return [{
        type: "scrollbar",
        action,
        count: typeof parsed.count === "number" ? parsed.count : undefined,
        position: typeof parsed.position === "number" ? parsed.position : undefined,
      }];
    }
  }
```

- [ ] **Step 5: Implement ws subscription and dispatch**

In `src/server/ws.ts`, import:

```ts
import { applyScrollbarAction, buildScrollbarSubscriptionArgs, parseScrollbarState, unavailableScrollbarState } from "./scrollbar.js";
import type { ScrollbarState } from "../shared/types.js";
```

Add to `WsConnState`:

```ts
  scrollbarState: ScrollbarState;
  scrollbarSubscriptionName: string;
```

Initialize in `upgrade` state:

```ts
        scrollbarState: unavailableScrollbarState(),
        scrollbarSubscriptionName: `tw-scroll-${Math.random().toString(36).slice(2)}`,
```

Register an event handler in `createWsHandlers`:

```ts
  unsubscribers.push(opts.tmuxControl.on("subscriptionChanged", (n) => {
    for (const set of reg.wsClientsBySession.values()) {
      for (const ws of set) {
        if (ws.data.state.scrollbarSubscriptionName !== n.name) continue;
        const next = parseScrollbarState(n.value);
        ws.data.state.scrollbarState = next;
        if (ws.readyState === WS_OPEN) ws.send(frameTTMessage({ scrollbar: next }));
      }
    }
  }));
```

Add this helper near the other websocket helpers:

```ts
async function sendInitialScrollbarState(ws: ServerWebSocket<WsData>, opts: WsServerOptions): Promise<void> {
  try {
    const out = await opts.tmuxControl.run(["display-message", "-p", "-t", ws.data.state.lastSession, "-F", SCROLLBAR_FORMAT]);
    const initial = parseScrollbarState(out.trim());
    ws.data.state.scrollbarState = initial;
    if (ws.readyState === WS_OPEN) ws.send(frameTTMessage({ scrollbar: initial }));
  } catch (err) {
    debug(opts.config, `initial scrollbar state failed: ${(err as Error).message}`);
    const unavailable = unavailableScrollbarState();
    ws.data.state.scrollbarState = unavailable;
    if (ws.readyState === WS_OPEN) ws.send(frameTTMessage({ scrollbar: unavailable }));
  }
}
```

In `handleOpen`, after attachSession starts for non-test mode, request the subscription and initial state:

```ts
    void opts.tmuxControl.run(buildScrollbarSubscriptionArgs(state.scrollbarSubscriptionName))
      .catch((err) => {
        debug(config, `scrollbar subscription failed: ${(err as Error).message}`);
        if (ws.readyState === WS_OPEN) ws.send(frameTTMessage({ scrollbar: unavailableScrollbarState() }));
      });
    void sendInitialScrollbarState(ws, opts);
```

In `dispatchAction`, add:

```ts
    case "scrollbar":
      void applyScrollbarAction({
        action: act.action,
        count: act.count,
        position: act.position,
        getState: async () => state.scrollbarState,
        run: opts.tmuxControl.run,
      }).catch((err) => debug(opts.config, `scrollbar action failed: ${(err as Error).message}`));
      return;
```

- [ ] **Step 6: Run focused tests and confirm pass**

Run:

```bash
bun test tests/unit/server/ws-router.test.ts tests/unit/server/ws-handle-connection.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/ws-router.ts src/server/ws.ts tests/unit/server/ws-router.test.ts tests/unit/server/ws-handle-connection.test.ts
git commit -m "Wire tmux scrollbar websocket state"
```

## Task 5: Client Scrollbar Controller And Thumb Math

**Files:**
- Create: `src/client/ui/scrollbar.ts`
- Create: `tests/unit/client/ui/scrollbar.test.ts`
- Modify: `src/client/message-handler.ts`
- Modify: `tests/unit/client/message-handler.test.ts`

- [ ] **Step 1: Write failing scrollbar unit tests**

Create `tests/unit/client/ui/scrollbar.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "bun:test";
import { setupDocument, el } from "../_dom.ts";
import { computeScrollbarThumb, createScrollbarController } from "../../../../src/client/ui/scrollbar.ts";

describe("computeScrollbarThumb", () => {
  test("fills track when there is no history", () => {
    expect(computeScrollbarThumb({ paneHeight: 40, historySize: 0, scrollPosition: 0 }, 200))
      .toEqual({ topPx: 0, heightPx: 200 });
  });

  test("places live bottom at bottom and oldest history at top", () => {
    expect(computeScrollbarThumb({ paneHeight: 40, historySize: 160, scrollPosition: 0 }, 200))
      .toEqual({ topPx: 160, heightPx: 40 });
    expect(computeScrollbarThumb({ paneHeight: 40, historySize: 160, scrollPosition: 160 }, 200))
      .toEqual({ topPx: 0, heightPx: 40 });
  });

  test("enforces minimum thumb size", () => {
    expect(computeScrollbarThumb({ paneHeight: 10, historySize: 9990, scrollPosition: 0 }, 200).heightPx)
      .toBe(24);
  });
});

describe("createScrollbarController", () => {
  beforeEach(() => setupDocument());

  test("wheel sends line actions when available", () => {
    const sent: string[] = [];
    const root = el("div");
    const controller = createScrollbarController({
      root,
      send: (msg) => sent.push(JSON.stringify(msg)),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    controller.updateState({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false });
    const handled = controller.handleWheel({ deltaY: -99, preventDefault() {}, stopPropagation() {} } as WheelEvent);
    expect(handled).toBe(true);
    expect(sent).toEqual(['{"type":"scrollbar","action":"line-up","count":3,"paneId":"%4"}']);
  });

  test("alternate screen adds unavailable and lets wheel pass through", () => {
    let passThrough = false;
    const root = el("div");
    const controller = createScrollbarController({
      root,
      send: () => {},
      passThroughWheel: () => { passThrough = true; return false; },
      requestFit: () => {},
    });
    controller.updateState({ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: true });
    const handled = controller.handleWheel({ deltaY: 33, preventDefault() {}, stopPropagation() {} } as WheelEvent);
    expect(handled).toBe(false);
    expect(passThrough).toBe(true);
    expect((root as any).classList.contains("unavailable")).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing message-handler test**

Add this to `tests/unit/client/message-handler.test.ts`:

```ts
test("dispatches scrollbar TT messages", () => {
  const states: any[] = [];
  handleServerData('\x00TT:{"scrollbar":{"paneId":"%4","paneHeight":40,"historySize":100,"scrollPosition":0,"paneInMode":0,"paneMode":"","alternateOn":false}}', {
    adapter: { write: () => {} },
    topbar: {},
    onScrollbar: (state) => states.push(state),
  });
  expect(states).toEqual([{ paneId: "%4", paneHeight: 40, historySize: 100, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false }]);
});
```

- [ ] **Step 3: Run focused client tests and confirm failure**

Run:

```bash
bun test tests/unit/client/ui/scrollbar.test.ts tests/unit/client/message-handler.test.ts
```

Expected: fails because scrollbar module and `onScrollbar` do not exist.

- [ ] **Step 4: Implement scrollbar controller**

Create `src/client/ui/scrollbar.ts`:

```ts
import type { ScrollbarActionMessage, ScrollbarState } from "../../shared/types.js";

export interface ThumbInput {
  paneHeight: number;
  historySize: number;
  scrollPosition: number;
}

export interface ThumbGeometry {
  topPx: number;
  heightPx: number;
}

const MIN_THUMB_PX = 24;

export function computeScrollbarThumb(input: ThumbInput, trackHeightPx: number): ThumbGeometry {
  const track = Math.max(0, Math.round(trackHeightPx));
  if (track <= 0) return { topPx: 0, heightPx: 0 };
  if (input.historySize <= 0 || input.paneHeight <= 0) return { topPx: 0, heightPx: track };
  const total = input.historySize + input.paneHeight;
  const rawHeight = Math.round(track * (input.paneHeight / total));
  const heightPx = Math.min(track, Math.max(MIN_THUMB_PX, rawHeight));
  const maxTop = Math.max(0, track - heightPx);
  const clampedScroll = Math.max(0, Math.min(input.scrollPosition, input.historySize));
  const ratioFromTop = 1 - (clampedScroll / input.historySize);
  return { topPx: Math.round(maxTop * ratioFromTop), heightPx };
}

export interface ScrollbarController {
  updateState(state: ScrollbarState): void;
  setAutohide(value: boolean): void;
  handleWheel(ev: WheelEvent): boolean;
  dispose(): void;
}

export function createScrollbarController(opts: {
  root: HTMLElement;
  send: (msg: ScrollbarActionMessage) => void;
  passThroughWheel: (ev: WheelEvent) => boolean;
  requestFit: () => void;
}): ScrollbarController {
  const track = opts.root.querySelector(".tw-scrollbar-track") as HTMLElement | null
    ?? opts.root.appendChild(document.createElement("div"));
  if (!track.classList.contains("tw-scrollbar-track")) track.className = "tw-scrollbar-track";
  const thumb = track.querySelector(".tw-scrollbar-thumb") as HTMLElement | null
    ?? track.appendChild(document.createElement("div"));
  if (!thumb.classList.contains("tw-scrollbar-thumb")) thumb.className = "tw-scrollbar-thumb";

  let state: ScrollbarState = { paneId: null, paneHeight: 0, historySize: 0, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false, unavailable: true };
  let autohide = false;

  const render = () => {
    opts.root.classList.toggle("unavailable", !!state.unavailable || state.alternateOn);
    opts.root.classList.toggle("tw-scrollbar-autohide", autohide);
    opts.root.classList.toggle("tw-scrollbar-pinned", !autohide);
    const rect = track.getBoundingClientRect();
    const geom = computeScrollbarThumb(state, rect.height || track.offsetHeight || 0);
    thumb.style.setProperty("--tw-scrollbar-thumb-top", `${geom.topPx}px`);
    thumb.style.setProperty("--tw-scrollbar-thumb-height", `${geom.heightPx}px`);
  };

  const sendLine = (action: "line-up" | "line-down", count: number) => {
    opts.send({ type: "scrollbar", action, count, paneId: state.paneId ?? undefined });
  };

  const onTrackWheel = (ev: WheelEvent) => {
    if (handleWheel(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  const handleWheel = (ev: WheelEvent): boolean => {
    if (state.unavailable || state.alternateOn) return opts.passThroughWheel(ev);
    const count = Math.max(1, Math.min(Math.abs(Math.round(ev.deltaY / 33)), 5));
    sendLine(ev.deltaY < 0 ? "line-up" : "line-down", count);
    return true;
  };

  track.addEventListener("wheel", onTrackWheel, { passive: false });

  return {
    updateState(next) { state = next; render(); },
    setAutohide(value) {
      autohide = value;
      render();
      opts.requestFit();
    },
    handleWheel,
    dispose() { track.removeEventListener("wheel", onTrackWheel); },
  };
}
```

- [ ] **Step 5: Wire message handler**

In `src/client/message-handler.ts`, import `ScrollbarState`, add to `HandleServerDataOptions`:

```ts
  onScrollbar?(state: ScrollbarState): void;
```

In the message loop:

```ts
    if (msg.scrollbar) opts.onScrollbar?.(msg.scrollbar);
```

- [ ] **Step 6: Run focused client tests and confirm pass**

Run:

```bash
bun test tests/unit/client/ui/scrollbar.test.ts tests/unit/client/message-handler.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/client/ui/scrollbar.ts src/client/message-handler.ts tests/unit/client/ui/scrollbar.test.ts tests/unit/client/message-handler.test.ts
git commit -m "Add client tmux scrollbar controller"
```

## Task 6: Layout, Topbar Settings, And Main Client Wiring

**Files:**
- Modify: `src/client/index.html`
- Modify: `src/client/base.css`
- Modify: `src/client/ui/topbar.ts`
- Modify: `src/client/index.ts`
- Modify: `tests/unit/client/index-html.test.ts`
- Modify: `tests/unit/client/ui/topbar.test.ts`

- [ ] **Step 1: Write failing DOM contract tests**

Add to `tests/unit/client/index-html.test.ts`:

```ts
test("settings menu includes scrollbar autohide checkbox and scrollbar shell", async () => {
  const html = await Bun.file("src/client/index.html").text();
  expect(html).toContain('id="chk-scrollbar-autohide"');
  expect(html).toContain('id="tmux-scrollbar"');
  expect(html).toContain('class="tw-scrollbar');
});
```

In `tests/unit/client/ui/topbar.test.ts`, add `chk-scrollbar-autohide` to `REQUIRED_IDS`.

Add a test in `describe('Topbar menu and autohide DOM behaviour', ...)`:

```ts
it("syncs per-session toolbar and scrollbar autohide checkboxes", async () => {
  const doc = makeDoc();
  installGlobals();
  stubFetch({
    "/api/themes": [{ name: "Default", pack: "default", css: "/themes/default/default.css", source: "bundled" }],
    "/api/fonts": [{ family: "Iosevka Nerd Font Mono", file: "/font.woff2", pack: "default" }],
    "/api/colours": [],
    "/api/session-settings": { version: 1, sessions: {} },
  });
  const sends: string[] = [];
  const changes: SessionSettings[] = [];
  const { Topbar } = await import("../../../../src/client/ui/topbar.ts");
  const t = new Topbar({
    send: (s) => sends.push(s),
    focus: () => {},
    getLiveSettings: () => ({ ...DEFAULT_SESSION_SETTINGS, topbarAutohide: true, scrollbarAutohide: true }),
    onSettingsChange: (s) => changes.push(s),
  });
  await t.init();
  expect((doc.getElementById("chk-autohide") as any).checked).toBe(true);
  expect((doc.getElementById("chk-scrollbar-autohide") as any).checked).toBe(true);
  (doc.getElementById("chk-scrollbar-autohide") as any).checked = false;
  (doc.getElementById("chk-scrollbar-autohide") as any).dispatch("change", {});
  expect(changes.at(-1)?.scrollbarAutohide).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
bun test tests/unit/client/index-html.test.ts tests/unit/client/ui/topbar.test.ts
```

Expected: fails because `#chk-scrollbar-autohide` and `#tmux-scrollbar` do not exist and topbar still uses `prefs.ts` for toolbar autohide.

- [ ] **Step 3: Update HTML**

In `src/client/index.html`, replace the autohide row:

```html
          <label class="tw-menu-row"><input type="checkbox" id="chk-autohide"> Autohide toolbar</label>
```

with:

```html
          <div class="tw-menu-row tw-menu-row-static tw-menu-row-inline">
            <label><input type="checkbox" id="chk-autohide"> Autohide toolbar</label>
            <label><input type="checkbox" id="chk-scrollbar-autohide"> Autohide scrollbar</label>
          </div>
```

Add the scrollbar shell before `#terminal`:

```html
  <div id="tmux-scrollbar" class="tw-scrollbar tw-scrollbar-pinned" aria-hidden="true">
    <div class="tw-scrollbar-track">
      <div class="tw-scrollbar-thumb"></div>
    </div>
  </div>
  <div id="terminal"></div>
```

- [ ] **Step 4: Update CSS layout**

Add to `src/client/base.css` near the terminal layout rules:

```css
:root {
  --tw-scrollbar-width: 14px;
  --tw-scrollbar-track-bg: var(--tw-slider-track-bg, var(--tw-gadget-bg));
  --tw-scrollbar-thumb-bg: var(--tw-slider-thumb-bg, var(--tw-gadget-hover));
  --tw-scrollbar-thumb-hover: var(--tw-gadget-active);
  --tw-scrollbar-thumb-active: var(--tw-gadget-active);
  --tw-scrollbar-track-bevel-hi: var(--tw-slider-track-bevel-hi, var(--tw-bevel-hi));
  --tw-scrollbar-track-bevel-lo: var(--tw-slider-track-bevel-lo, var(--tw-bevel-lo));
  --tw-scrollbar-thumb-bevel-hi: var(--tw-slider-thumb-bevel-hi, var(--tw-bevel-hi));
  --tw-scrollbar-thumb-bevel-lo: var(--tw-slider-thumb-bevel-lo, var(--tw-bevel-lo));
}

body.scrollbar-pinned #terminal { right: var(--tw-scrollbar-width); }
body.scrollbar-autohide #terminal { right: 0; }

.tw-menu-row-inline { gap: 12px; }
.tw-menu-row-inline label { display: inline-flex; align-items: center; gap: 4px; }

.tw-scrollbar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--tw-scrollbar-width);
  z-index: 8;
  color: var(--tw-text);
}
.tw-scrollbar-track {
  position: absolute;
  inset: 2px;
  background: var(--tw-scrollbar-track-bg);
  border: 1px solid;
  border-color: var(--tw-scrollbar-track-bevel-lo) var(--tw-scrollbar-track-bevel-hi) var(--tw-scrollbar-track-bevel-hi) var(--tw-scrollbar-track-bevel-lo);
}
.tw-scrollbar-thumb {
  position: absolute;
  left: 1px;
  right: 1px;
  top: var(--tw-scrollbar-thumb-top, 0);
  height: var(--tw-scrollbar-thumb-height, 100%);
  background: var(--tw-scrollbar-thumb-bg);
  border: 1px solid;
  border-color: var(--tw-scrollbar-thumb-bevel-hi) var(--tw-scrollbar-thumb-bevel-lo) var(--tw-scrollbar-thumb-bevel-lo) var(--tw-scrollbar-thumb-bevel-hi);
}
.tw-scrollbar-thumb:hover { background: var(--tw-scrollbar-thumb-hover); }
.tw-scrollbar.dragging .tw-scrollbar-thumb { background: var(--tw-scrollbar-thumb-active); }
.tw-scrollbar.unavailable { opacity: 0.4; }
.tw-scrollbar-autohide {
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.tw-scrollbar-autohide.visible,
.tw-scrollbar-autohide:hover,
.tw-scrollbar-autohide.dragging {
  opacity: 1;
  pointer-events: auto;
}
```

If existing theme CSS sets `#terminal` right positioning, adjust selectors so base structure remains theme-neutral and theme files only override material.

- [ ] **Step 5: Update topbar to use session settings**

In `src/client/ui/topbar.ts`, remove `getTopbarAutohide` and `setTopbarAutohide` from the `prefs.ts` import.

Add a field:

```ts
  private scrollbarAutohideChk!: HTMLInputElement;
```

In `init`, assign:

```ts
    this.scrollbarAutohideChk = document.getElementById("chk-scrollbar-autohide") as HTMLInputElement;
```

Replace `setupAutoHide` with settings-driven logic:

```ts
  private setupAutoHide(): void {
    const current = this.opts.getLiveSettings();
    this.autohide = current.topbarAutohide;
    this.autohideChk.checked = current.topbarAutohide;
    this.scrollbarAutohideChk.checked = current.scrollbarAutohide;
    this.applyPinnedClass();

    this.autohideChk.addEventListener("change", () => {
      this.commitAutohide({ topbarAutohide: this.autohideChk.checked });
    });
    this.scrollbarAutohideChk.addEventListener("change", () => {
      this.commitAutohide({ scrollbarAutohide: this.scrollbarAutohideChk.checked });
    });

    document.addEventListener("mousemove", (ev) => {
      if (ev.clientY < 28 * 3) this.show();
    });
    this.topbar.addEventListener("mouseenter", () => {
      if (this.hideTimer) clearTimeout(this.hideTimer);
    });
    this.topbar.addEventListener("mouseleave", () => this.show());
  }

  private commitAutohide(patch: Pick<Partial<SessionSettings>, "topbarAutohide" | "scrollbarAutohide">): void {
    const next = { ...this.opts.getLiveSettings(), ...patch };
    this.autohide = next.topbarAutohide;
    this.autohideChk.checked = next.topbarAutohide;
    this.scrollbarAutohideChk.checked = next.scrollbarAutohide;
    this.applyPinnedClass();
    this.opts.onSettingsChange?.(next);
    this.opts.onAutohideChange?.();
    if (!this.autohide) {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = null;
      this.topbar.classList.remove("hidden");
    } else {
      this.show();
    }
  }
```

Update `syncUi` in `setupMenu`:

```ts
      this.autohide = s.topbarAutohide;
      this.autohideChk.checked = s.topbarAutohide;
      this.scrollbarAutohideChk.checked = s.scrollbarAutohide;
      this.applyPinnedClass();
```

- [ ] **Step 6: Wire scrollbar controller in `index.ts`**

In `src/client/index.ts`, remove `getTopbarAutohide` import and import:

```ts
import { createScrollbarController } from "./ui/scrollbar.js";
```

Remove the startup localStorage check:

```ts
if (!getTopbarAutohide()) document.body.classList.add('topbar-pinned');
```

After `adapter.fit()` and before connection handlers need it, create:

```ts
  const scrollbarRoot = document.getElementById("tmux-scrollbar")!;
  let scrollbar: ReturnType<typeof createScrollbarController>;
  const applyScrollbarLayout = (autohide: boolean) => {
    document.body.classList.toggle("scrollbar-autohide", autohide);
    document.body.classList.toggle("scrollbar-pinned", !autohide);
    scrollbar?.setAutohide(autohide);
    adapter.fit();
  };
```

After `connection` is assigned or with a closure over `connection`, initialize:

```ts
  scrollbar = createScrollbarController({
    root: scrollbarRoot,
    send: (msg) => connection.send(JSON.stringify(msg)),
    passThroughWheel: (ev) => {
      const canvas = document.querySelector("#terminal canvas") as HTMLElement;
      const rect = canvas?.getBoundingClientRect() || container.getBoundingClientRect();
      for (const seq of buildWheelSgrSequences(ev, adapter.metrics, rect)) connection.send(seq);
      return false;
    },
    requestFit: () => adapter.fit(),
  });
  applyScrollbarLayout(settings.scrollbarAutohide);
  disposers.push(() => scrollbar.dispose());
```

In `onSettingsChange`, after `settings = s`, call:

```ts
      document.body.classList.toggle("topbar-pinned", !s.topbarAutohide);
      applyScrollbarLayout(s.scrollbarAutohide);
```

In `handleMessage`, pass:

```ts
      onScrollbar: (state) => scrollbar.updateState(state),
```

Replace terminal wheel handler with:

```ts
  adapter.attachCustomWheelEventHandler((ev) => {
    if (ev.shiftKey) return false;
    return scrollbar.handleWheel(ev);
  });
```

- [ ] **Step 7: Run focused tests and confirm pass**

Run:

```bash
bun test tests/unit/client/index-html.test.ts tests/unit/client/ui/topbar.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/client/index.html src/client/base.css src/client/ui/topbar.ts src/client/index.ts tests/unit/client/index-html.test.ts tests/unit/client/ui/topbar.test.ts
git commit -m "Add scrollbar layout and autohide controls"
```

## Task 7: Complete Scrollbar Pointer Interactions

**Files:**
- Modify: `src/client/ui/scrollbar.ts`
- Modify: `tests/unit/client/ui/scrollbar.test.ts`

- [ ] **Step 1: Add failing tests for track click and drag**

Append to `tests/unit/client/ui/scrollbar.test.ts`:

```ts
test("track click sends page action toward pointer", () => {
  const sent: string[] = [];
  const root = el("div");
  const track = el("div");
  track.className = "tw-scrollbar-track";
  (track as any).getBoundingClientRect = () => ({ top: 0, height: 200, bottom: 200, left: 0, right: 12, width: 12 });
  const thumb = el("div");
  thumb.className = "tw-scrollbar-thumb";
  track.appendChild(thumb);
  root.appendChild(track);
  const controller = createScrollbarController({
    root,
    send: (msg) => sent.push(JSON.stringify(msg)),
    passThroughWheel: () => false,
    requestFit: () => {},
  });
  controller.updateState({ paneId: "%4", paneHeight: 40, historySize: 160, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false });
  track.dispatch("mousedown", { target: track, clientY: 10, preventDefault() {}, stopPropagation() {} });
  expect(sent).toEqual(['{"type":"scrollbar","action":"page-up","paneId":"%4"}']);
});

test("thumb drag sends absolute scroll position", () => {
  const sent: string[] = [];
  const root = el("div");
  const track = el("div");
  track.className = "tw-scrollbar-track";
  (track as any).getBoundingClientRect = () => ({ top: 0, height: 200, bottom: 200, left: 0, right: 12, width: 12 });
  const thumb = el("div");
  thumb.className = "tw-scrollbar-thumb";
  track.appendChild(thumb);
  root.appendChild(track);
  const controller = createScrollbarController({
    root,
    send: (msg) => sent.push(JSON.stringify(msg)),
    passThroughWheel: () => false,
    requestFit: () => {},
  });
  controller.updateState({ paneId: "%4", paneHeight: 40, historySize: 160, scrollPosition: 0, paneInMode: 0, paneMode: "", alternateOn: false });
  thumb.dispatch("mousedown", { target: thumb, clientY: 180, preventDefault() {}, stopPropagation() {} });
  (globalThis.document as any).dispatch("mousemove", { clientY: 20, preventDefault() {}, stopPropagation() {} });
  (globalThis.document as any).dispatch("mouseup", { preventDefault() {}, stopPropagation() {} });
  expect(sent.some(s => s.includes('"action":"drag"'))).toBe(true);
  expect(sent.some(s => s.includes('"paneId":"%4"'))).toBe(true);
});
```

- [ ] **Step 2: Run scrollbar tests and confirm failure**

Run:

```bash
bun test tests/unit/client/ui/scrollbar.test.ts
```

Expected: new pointer tests fail because click/drag handlers are not implemented.

- [ ] **Step 3: Implement track click and thumb drag**

In `src/client/ui/scrollbar.ts`, add helper inside `createScrollbarController`:

```ts
  const sendPage = (action: "page-up" | "page-down") => {
    opts.send({ type: "scrollbar", action, paneId: state.paneId ?? undefined });
  };

  const scrollPositionForClientY = (clientY: number): number => {
    const rect = track.getBoundingClientRect();
    const geom = computeScrollbarThumb(state, rect.height || track.offsetHeight || 0);
    const maxTop = Math.max(1, (rect.height || 0) - geom.heightPx);
    const top = Math.max(0, Math.min(clientY - rect.top - geom.heightPx / 2, maxTop));
    const ratioFromTop = top / maxTop;
    return Math.round((1 - ratioFromTop) * state.historySize);
  };
```

Add `mousedown` handlers:

```ts
  let dragging = false;

  const onTrackMouseDown = (ev: MouseEvent) => {
    if (state.unavailable || state.alternateOn || state.historySize <= 0) return;
    if (ev.target === thumb) return;
    const rect = thumb.getBoundingClientRect();
    sendPage(ev.clientY < rect.top ? "page-up" : "page-down");
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onThumbMouseDown = (ev: MouseEvent) => {
    if (state.unavailable || state.alternateOn || state.historySize <= 0) return;
    dragging = true;
    opts.root.classList.add("dragging");
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onDocumentMouseMove = (ev: MouseEvent) => {
    if (!dragging) return;
    opts.send({ type: "scrollbar", action: "drag", position: scrollPositionForClientY(ev.clientY), paneId: state.paneId ?? undefined });
    opts.root.classList.add("visible");
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onDocumentMouseUp = () => {
    dragging = false;
    opts.root.classList.remove("dragging");
  };

  track.addEventListener("mousedown", onTrackMouseDown);
  thumb.addEventListener("mousedown", onThumbMouseDown);
  document.addEventListener("mousemove", onDocumentMouseMove, true);
  document.addEventListener("mouseup", onDocumentMouseUp, true);
```

Update `dispose()`:

```ts
      track.removeEventListener("wheel", onTrackWheel);
      track.removeEventListener("mousedown", onTrackMouseDown);
      thumb.removeEventListener("mousedown", onThumbMouseDown);
      document.removeEventListener("mousemove", onDocumentMouseMove, true);
      document.removeEventListener("mouseup", onDocumentMouseUp, true);
```

- [ ] **Step 4: Run scrollbar tests and confirm pass**

Run:

```bash
bun test tests/unit/client/ui/scrollbar.test.ts
```

Expected: all scrollbar tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/ui/scrollbar.ts tests/unit/client/ui/scrollbar.test.ts
git commit -m "Add scrollbar pointer interactions"
```

## Task 8: Real tmux E2E Coverage

**Files:**
- Create: `tests/e2e/scrollbar.spec.ts`
- Modify: `tests/e2e/PORTS.md`

- [ ] **Step 1: Add e2e port reservation**

Add a row to `tests/e2e/PORTS.md`:

```md
| 4120  | tests/e2e/scrollbar.spec.ts | real-tmux scrollbar state and wheel |
```

- [ ] **Step 2: Write failing e2e tests**

Create `tests/e2e/scrollbar.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { hasTmux, makeIsolatedTmux, startServer } from "./helpers.ts";

test.skip(!hasTmux(), "tmux not available");

test("wheel over terminal scrolls tmux copy-mode and updates scrollbar", async ({ page }) => {
  const isolatedTmux = makeIsolatedTmux("scrollbar-main");
  isolatedTmux.tmux(["send-keys", "-t", "scrollbar-main", "for i in $(seq 1 120); do echo line-$i; done", "Enter"]);
  await new Promise(r => setTimeout(r, 300));
  const server = await startServer(4120, [
    "--tmux", isolatedTmux.wrapperPath,
    "--no-auth",
    "--no-tls",
  ]);
  try {
    await page.goto("http://127.0.0.1:4120/scrollbar-main");
    await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");
    await page.locator("#terminal").hover();
    await page.mouse.wheel(0, -330);
    await expect(page.locator("#tmux-scrollbar .tw-scrollbar-thumb")).toBeVisible();
    await expect.poll(() => isolatedTmux.tmux([
      "display-message",
      "-p",
      "-t",
      "scrollbar-main",
      "#{pane_in_mode}:#{scroll_position}",
    ]).trim()).toMatch(/^1:[1-9]\d*$/);
  } finally {
    await server.close();
    isolatedTmux.cleanup();
  }
});

test("alternate screen marks scrollbar unavailable", async ({ page }) => {
  const isolatedTmux = makeIsolatedTmux("scrollbar-alt");
  isolatedTmux.tmux(["send-keys", "-t", "scrollbar-alt", "printf '\\033[?1049hALT'; sleep 5; printf '\\033[?1049l'", "Enter"]);
  const server = await startServer(4120, [
    "--tmux", isolatedTmux.wrapperPath,
    "--no-auth",
    "--no-tls",
  ]);
  try {
    await page.goto("http://127.0.0.1:4120/scrollbar-alt");
    await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");
    await expect(page.locator("#tmux-scrollbar")).toHaveClass(/unavailable/);
  } finally {
    await server.close();
    isolatedTmux.cleanup();
  }
});
```

- [ ] **Step 3: Run e2e test**

Run:

```bash
bun x playwright test tests/e2e/scrollbar.spec.ts
```

Expected: passes after the prior tasks are integrated. A failure indicates an implementation issue in state delivery, wheel routing, or tmux command semantics.

- [ ] **Step 4: Run e2e and relevant unit tests**

Run:

```bash
bun test tests/unit/server/scrollbar.test.ts tests/unit/server/ws-router.test.ts tests/unit/server/ws-handle-connection.test.ts tests/unit/client/ui/scrollbar.test.ts tests/unit/client/ui/topbar.test.ts
bun x playwright test tests/e2e/scrollbar.spec.ts
```

Expected: all listed tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/scrollbar.spec.ts tests/e2e/PORTS.md src/server/ws.ts tests/unit/server/ws-handle-connection.test.ts
git commit -m "Cover tmux scrollbar behavior end to end"
```

## Task 9: Full Verification And Cleanup

**Files:**
- Modify only files touched by earlier tasks when full-suite verification exposes scrollbar integration issues.
- Create a `docs/bugs/*.md` report if verification exposes an unrelated pre-existing failure.

- [ ] **Step 1: Run unit test suite**

Run:

```bash
make test-unit
```

Expected: all unit tests pass.

- [ ] **Step 2: Run e2e test suite**

Run:

```bash
make test-e2e
```

Expected: all e2e tests pass. If a pre-existing unrelated e2e failure appears, file a bug under `docs/bugs/` with the command, failure text, and why it appears unrelated, then continue with targeted scrollbar verification.

- [ ] **Step 3: Run build**

Run:

```bash
make build
```

Expected: client and server bundles build successfully. This also catches missing imports or type errors that focused tests may not exercise.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended scrollbar implementation and test files are changed, or the worktree is clean if every task has been committed.

- [ ] **Step 5: Commit any verification fixes**

If Step 1-3 required fixes, commit them:

```bash
git add src tests docs
git commit -m "Stabilize tmux scrollbar integration"
```

If no fixes were needed and the worktree is clean, do not create an empty commit.
