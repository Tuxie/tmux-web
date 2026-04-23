# sendWindowState delivers a corrupt TT message during initial attach

**Status:** observed once, not investigated.
**Date noticed:** 2026-04-23
**Context:** verifying the cmd-id-from-%begin fix (commit `0eb1cd5`) by tailing WS messages with a probe script.

## What I saw

On the WS attach immediately after starting a fresh dev server, the **second** TT message had its `windows` and `title` fields swapped:

```
TT {"session":"tmux-web","windows":[]}                                  ← first push, harmless
TT {"session":"tmux-web","windows":[{"index":"ok","active":false}],
    "title":"1\t[tmux]\t1\n2\tzsh\t0"}                                  ← swapped
TT {"session":"tmux-web","windows":[{"index":"1","name":"[tmux]",...}], ← correct from here on
    "title":"⠂ Replace ws module with native bun websockets"}
```

`"ok"` is the response from the `display-message -p ok` readiness probe inside `attachSession`. `"1\t[tmux]\t1\n2\tzsh\t0"` is the tab-separated `list-windows -F` output. They got delivered to the *wrong* `Promise.allSettled` slots in `sendWindowState`.

## Suspected mechanism

`src/server/ws.ts` `sendWindowState` issues two control commands in parallel via `Promise.allSettled`:

```ts
const [winResult, titleResult] = await Promise.allSettled([
  opts.tmuxControl.run(['list-windows', ...]),
  opts.tmuxControl.run(['display-message', '-t', sess, '-p', '#{pane_title}']),
]);
```

Both calls hit `ControlPool.run` → `primary.run` → push into the same `ControlClient.queue`. Since the client serialises writes, the two responses come back in queue order — the first `.run()` should resolve with the first response, the second with the second. That should correctly map `winResult` ↔ list-windows and `titleResult` ↔ display-message.

But during the initial attach, `attachSession` is also using `client.run()` (for its own `display-message -p ok` readiness probe). If that probe is still in flight when the title-OSC fires and triggers `sendWindowState`, the queue order becomes:

```
[attach-probe-display-message-ok, sendWindowState-list-windows, sendWindowState-display-message-pane_title]
```

…and responses arrive in that order. `attachSession`'s `await client.run(...)` resolves with `"ok"`, but `sendWindowState`'s `Promise.allSettled([list-windows, display-message])` still receives them in *array order*, not queue order. So winResult = list-windows-out (correct), titleResult = "ok" (wrong — that was attach's probe response).

But the observed swap was the *opposite*: `windows = [{index:"ok"}]` and `title = "1\t[tmux]\t1\n2\tzsh\t0"`. So `winResult.value === "ok"` and `titleResult.value === "1\t[tmux]\t1\n2\tzsh\t0"`. That means `sendWindowState`'s **first** `.run()` (list-windows) resolved with "ok" — i.e. the attach-probe's response was delivered to list-windows. Inverted from my queue-order theory, so the actual mechanism is something else.

Possible alternatives:
- `attachSession` is awaiting a probe via `client.run(...)` directly — but `sendWindowState` calls `pool.run(...)`, which goes through `ControlPool.run` → `insertionOrder[0].run`. Until `attachSession` finishes, `insertionOrder` is empty, so `pool.run` rejects with `NoControlClientError`. Then both `Promise.allSettled` slots are `rejected`. That doesn't explain the swap either.
- The race is between *two* WS connections / *two* attachSession-completing windows. Multiple control clients in the pool with the new one being installed concurrently.
- A leftover stale envelope from one of the orphaned `tmux -C` clients (see `2026-04-23-tmux-c-clients-leak-on-restart.md`) bleeding into the new client's stdout.

## Why this matters

- The user briefly sees a single window tab whose name is `"ok"` (or no name, depending on how the empty fields render) and a title that is the raw tab-separated window list.
- Self-corrects on the next `sendWindowState` push (~100–200 ms later), so it's a one-frame visual artefact, not a persistent state corruption.
- But it indicates that the response → caller mapping is not as ironclad as it should be. If reproducible deterministically, the mechanism that lets it happen could in principle map a more dangerous response to the wrong caller.

## Repro

Start a fresh dev server with `--debug`, open one WS, watch the first 2–3 `\x00TT:` framed messages. The swap happened on one out of one trial during this session — frequency unknown.

## What I was doing when I noticed

Live-verifying the cmdnum-fix against a real tmux server. The probe script tails all `\x00TT:` payloads from the WS stream. The corrupt message appeared once during the initial three pushes; subsequent pushes were correct.
