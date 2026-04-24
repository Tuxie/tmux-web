# Menu session switch can acknowledge before xterm displays the target tmux session

Date found: 2026-04-24

## Summary

Switching tmux sessions through the tmux-web sessions menu is still flaky after commits:

- `bd170a0` (`Fix menu session switch confirmation`)
- `272ee5f` (`Verify tmux session switch before UI update`)

The UI can report that the requested session is active while the xterm.js terminal buffer is still displaying the previous tmux session. This is not just a theme/topbar issue: direct comparison of xterm's visible buffer against `tmux capture-pane` output shows the displayed terminal content still matches the old session exactly.

## Live Reproduction

Tested against the user's running dev server:

```text
http://127.0.0.1:4022/
```

The host tmux server had exactly these sessions:

```text
Fotona
HASS
main
```

The test used Playwright against the live server and switched only via the tmux-web sessions menu. It randomly selected among `Fotona`, `HASS`, and `main` for 20 intended switches, with a 0.2 second delay only after a switch was verified complete.

For each switch, the test verified the actual terminal display, not just the topbar:

1. Read xterm.js visible buffer text from:

   ```js
   window.__adapter.term.buffer.active
   ```

2. Captured the real tmux panes with:

   ```bash
   tmux capture-pane -p -t Fotona
   tmux capture-pane -p -t HASS
   tmux capture-pane -p -t main
   ```

3. Compared informative visible lines from xterm against each captured pane.
4. Considered a switch complete only when:
   - `#tb-session-name` equaled the target session, and
   - xterm's visible buffer best matched the same target session.

## Observed Failure

The run failed on the 6th switch:

```text
initial topbar=main
initial xterm best=main:1.000 scores=main:1.000, Fotona:0.000, HASS:0.000
01 main -> HASS   ok 128ms xterm=HASS:1.000
02 HASS -> Fotona ok 152ms xterm=Fotona:1.000
03 Fotona -> HASS ok 129ms xterm=HASS:1.000
04 HASS -> Fotona ok 139ms xterm=Fotona:1.000
05 Fotona -> HASS ok 127ms xterm=HASS:1.000
06 HASS -> main   FAILED
```

Failure details:

```text
timed out waiting for main
last topbar=main
best xterm match=HASS:1.000
scores=HASS:1.000, Fotona:0.029, main:0.000
xterm sample:
per dev /src/tmux-web on main ❯
```

Interpretation:

- The browser topbar said `main`.
- The visible shell prompt text happened to contain `main`, but the full xterm buffer still matched the `HASS` pane exactly.
- `tmux capture-pane -p -t main` did not match xterm at all.
- Therefore the UI/session acknowledgement path advanced to `main` while the terminal content remained attached to `HASS`.

## Why Existing Tests Missed This

The existing regression tests added in `tests/e2e/url-session.test.ts` verify that the browser waits for a `TT session` message before applying target session settings. That is necessary but insufficient.

Those tests use mocked WebSocket/session events and fixture themes. They prove:

- the topbar/URL/settings do not update before a `TT session` notification, and
- a target session's stored theme is applied after that notification.

They do not prove:

- the PTY-backed tmux client has actually switched its displayed session,
- the bytes reaching xterm correspond to the target session's pane, or
- the server's acknowledgement cannot race ahead of terminal redraw/content propagation.

Commit `272ee5f` added a server-side `display-message -p -c <client> '#{client_session}'` check after `switch-client`, but the live failure shows that check is still not a sufficient proxy for xterm's displayed PTY content.

## Related Visual/Menu Issue Already Fixed

The user also noticed that the sessions menu showed:

- one current-session marker (`√`) on the left, and
- a second non-current row with a hover-looking marker.

That was real and was fixed in `272ee5f`: custom dropdown rows used `aria-selected=true`, but dropdown active seeding only looked for `.selected`, causing the first row to get `.tw-dd-active` and look hovered. This was a misleading visual state, but the live reproduction above demonstrates there is still a separate backend/PTY switch race.

## Likely Area To Investigate

Start in:

- `src/server/ws.ts`
  - `switchSession`
  - `tmuxClientForPty`
  - `tmuxClientSession`
  - `moveWsToSession`
  - `sendWindowState`

Relevant current flow:

1. Browser sends:

   ```json
   {"type":"switch-session","name":"main"}
   ```

2. Server runs `switchSession`.
3. Server attaches control client for target session.
4. Server finds the tmux client associated with the PTY.
5. Server runs:

   ```bash
   tmux switch-client -c <client> -t <target>
   ```

6. Server verifies:

   ```bash
   tmux display-message -p -c <client> '#{client_session}'
   ```

7. Server calls `moveWsToSession`.
8. Server sends:

   ```js
   frameTTMessage({ session: newSession })
   ```

9. Browser updates URL/topbar/settings.

The failure suggests that step 6 can return the target session before the PTY stream/xterm-visible content has actually transitioned, or that the `<client>` being verified is not the same data-producing client whose PTY output is being rendered.

## Hypotheses To Test

Do not assume these are all true; use instrumentation to distinguish them.

1. `display-message -p -c <client> '#{client_session}'` updates before the PTY stream redraw for that client reaches xterm. The UI acknowledgement may need to wait for observable PTY output or another tmux signal that the client redraw has completed.

2. `tmuxClientForPty` can select the wrong tmux client. It currently matches by PID when possible, but can fall back to the only listed candidate. On a live server with multiple control/PTY clients, verify that the client passed to `switch-client` is truly the PTY client backing this WebSocket.

3. The PTY client switches, but xterm does not receive a forced redraw for the target session. Maybe tmux changes the client session but does not emit enough screen content immediately, leaving xterm's old buffer visible until the target pane next writes.

4. A later stale server-side notification or title/window update updates `state.lastSession` / topbar to the requested session while the PTY data path remains on the previous session.

5. Rapid session switches leave overlapping async `switchSession` operations. The serial cancellation guards may still allow an older switch to affect PTY/control state or UI acknowledgement in a narrow race.

## Suggested Diagnostic Instrumentation

Add temporary debug logging around `switchSession`:

```ts
debug(config, `switch start serial=${mySerial} old=${oldSession} new=${newSession}`);
debug(config, `switch client candidate=${client} ptyPid=${state.pty?.pid}`);
debug(config, `clients before=${JSON.stringify(await listClientsDebug())}`);
debug(config, `switch-client done serial=${mySerial}`);
debug(config, `client_session after=${reportedSession}`);
debug(config, `clients after=${JSON.stringify(await listClientsDebug())}`);
debug(config, `ack session=${newSession} serial=${mySerial}`);
```

Where `listClientsDebug()` should capture at least:

```bash
tmux list-clients -F '#{client_pid}\t#{client_tty}\t#{client_name}\t#{client_session}\t#{client_termname}'
```

Also consider logging first PTY data chunk after `switch-client`, including:

- serial
- current `state.registeredSession`
- current `state.lastSession`
- whether `processData()` detected a session/title
- a short printable sample of the bytes

## Better Automated Regression Test

The previous e2e test is too high-level and mocked. A stronger test should use a real tmux server and distinguish pane contents.

Suggested shape:

1. Create isolated tmux server with sessions `main`, `HASS`, `Fotona`.
2. In each session, run a shell loop or static program that paints a unique stable marker, for example:

   ```bash
   while true; do clear; printf 'SESSION_MARKER_HASS\n'; sleep 1; done
   ```

3. Start tmux-web against that isolated tmux via `--tmux <wrapper>`.
4. Use Playwright to click sessions through the menu repeatedly.
5. After each switch, assert xterm's visible buffer contains the target marker and does not contain the previous marker.
6. Only then wait 0.2 seconds before the next random switch.

Important: this test must not only assert topbar text, URL path, or saved theme values.

## Temporary Live Test Script

The ad hoc live test was written to:

```text
/tmp/tmux-web-random-session-switch-check.mjs
```

It imports Playwright from:

```js
import { chromium } from '/src/tmux-web/node_modules/playwright/index.mjs';
```

It must be run with access to the host loopback and host tmux server. In the Codex sandbox, plain `curl http://127.0.0.1:4022/` failed with code 7, but escalated host-network execution succeeded.

## Acceptance Criteria For Fix

A fix should pass a real-tmux repeated-switch test:

- sessions: `Fotona`, `HASS`, `main`
- 20 random menu-driven switches
- 0.2 seconds between completed switches, not between clicks
- for every switch:
  - topbar equals target session
  - xterm visible buffer matches target session pane
  - xterm visible buffer does not still match previous session pane

The fix should also keep the existing unit/e2e suite passing:

```bash
bun test tests/unit/server/ws-handle-connection.test.ts
bun test tests/unit/client/ui/dropdown.test.ts tests/unit/client/ui/topbar-menus.test.ts
node node_modules/.bin/playwright test tests/e2e/url-session.test.ts
bun x tsc --noEmit -p tsconfig.json
bun x tsc --noEmit -p tsconfig.client.json
```
