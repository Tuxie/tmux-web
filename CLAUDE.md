# tmux-web

Browser-based tmux frontend. Support ghostty-web + xterm.js backends. Run as systemd user service.

## Architecture

- **Server** — TypeScript, Bun runtime (`src/server/`)
- **Client** — TypeScript, bundle via `bun-build.ts` (`src/client/`)
- **Terminal backends** — ghostty-web 0.4.0, xterm.js 6.0.0
- **PTY** — Bun native `Bun.spawn` with `terminal` support, spawn `tmux -f tmux.conf` (or custom `--tmux`)
- **Auth** — HTTP Basic Auth (enabled by default) + IP allowlist via `--allow-ip`
- **TLS** — HTTPS enabled by default (self-signed or custom cert)

## Project Structure

```
src/
  server/            # Bun server
    index.ts         # CLI parse, startup
    http.ts          # HTTP handler, static serve, API routes
    ws.ts            # WS handler, PTY lifecycle
    pty.ts           # PTY spawn, session management
    protocol.ts      # OSC interception (pure)
    allowlist.ts     # IP allowlist (pure)
    tls.ts           # TLS cert gen
  client/            # Browser client
    index.ts         # Entry point, wire adapters + UI
    index.html       # HTML template
    adapters/        # Terminal backend abstraction
      types.ts       # TerminalAdapter interface
      ghostty.ts     # ghostty-web adapter
      xterm.ts       # xterm.js adapter
    ui/              # UI modules
      topbar.ts      # Session dropdown, window tabs, fullscreen
      mouse.ts       # SGR mouse forward
      keyboard.ts    # CSI-u sequences, shortcuts
      clipboard.ts   # OSC 52 clipboard
    connection.ts    # WS connect/reconnect
    protocol.ts      # \x00TT: message parse (pure)
  shared/            # Shared
    types.ts         # Protocol types, interfaces
    constants.ts     # Constants
tests/
  unit/              # bun test (mirrors src/)
  e2e/               # Playwright
```

## Development

```bash
bun install
make build           # build client + server bundles via bun-build.ts
make dev             # watch mode (client + server)
make test            # unit (bun test) + e2e (playwright)
make test-unit       # bun test only
make test-e2e        # playwright only
bun src/server/index.ts --test --listen 127.0.0.1:4022 --no-auth --no-tls
```

Use `bun`. No `pnpm`, `npm`, `tsx`, or `vitest`.

## CLI Options

```
--listen <host:port>     Bind address (default: 0.0.0.0:4022)
--terminal <backend>     ghostty or xterm (default: xterm)
--username <name>        Basic Auth user (default: $TMUX_WEB_USERNAME or current user)
--password <pass>        Basic Auth pass (default: $TMUX_WEB_PASSWORD, required)
--no-auth                Disable HTTP Basic Auth
--allow-ip <ip>          Allow IP (repeatable; localhost always allowed)
--tls                    Enable HTTPS with self-signed cert (default)
--no-tls                 Disable HTTPS and fallback to HTTP
--tls-cert / --tls-key   Custom TLS certificate files
--test                   Test mode: cat PTY, bypass IP allowlist
```

## Production Binary

```bash
make tmux-web    # self-contained executable with embedded assets
```
Binary is standalone and can be run anywhere with `tmux` installed. It embeds all client assets, fonts, and the default `tmux.conf`.

## Deployment

Systemd user service. See `tmux-web.service`.

```bash
systemctl --user restart tmux-web
systemctl --user status tmux-web
```

## tmux.conf

`tmux.conf` set defaults (passthrough, extended-keys, clipboard). End with:
```
source-file -q ~/.config/tmux/tmux.conf
source-file -q ~/.tmux.conf
```
User override via own config. Server pass via `tmux -f <path>`. Alternative config can be supplied via `--tmux-conf`.

---

## Terminal Backend Adapter

`TerminalAdapter` interface (`src/client/adapters/types.ts`) abstract terminal emulator. UI modules interact with interface only.

## Server-Client Protocol

Out-of-band messages: `\x00TT:<json>` in WS stream.

| Key | Trigger | Content |
|---|---|---|
| `session` | OSC title change | tmux session name |
| `windows` | OSC title change | `tmux list-windows` result |
| `clipboard` | OSC 52 received | Base64 clipboard text |

Server logic: `src/server/protocol.ts` (pure). Client parse: `src/client/protocol.ts`.

---

## Workarounds and Tweaks

### 1. Line height padding

ghostty-web no `lineHeight` option. Adapter add 2px to `term.renderer.metrics.height` before first `fit()`. xterm adapter use native `lineHeight`.

### 2. Mouse wheel forwarding

Forward `\x1b[<64;col;rowM` / `\x1b[<65;col;rowM` (up/down). Shift+wheel bypass for native scroll. `src/client/ui/mouse.ts` + `src/client/index.ts`.

### 3. Mouse button + drag forwarding

Backends no forward mouse button as SGR for tmux.
**Fix:** `src/client/ui/mouse.ts` register `mousedown`/`mouseup`/`mousemove` on **`document`** (capture). `stopPropagation()` prevent terminal from see event. Shift+click bypass for native selection.

Format: `\x1b[<btn;col;rowM` (press), `\x1b[<btn;col;rowm` (release), motion add 32 to btn.

### 4. CSI-u keyboard sequences

Emulators no send CSI-u for modified special keys. `src/client/ui/keyboard.ts` intercept `keydown` (capture) and send `\x1b[<code>;<mod>u`.
Keys: Enter (13), Tab (9), Backspace (127), Escape (27). Only with modifiers.

### 5. OSC 52 clipboard (tmux to browser)

Intercepted **server-side** (`src/server/protocol.ts`). Sequence strip from PTY, base64 payload send as `\x00TT:{"clipboard":"..."}`. Client decode via `atob()`, write to `navigator.clipboard` (`src/client/ui/clipboard.ts`).

### 6. Reconnect size sync

WS reconnect: call `adapter.fit()`, send `{"type":"resize"}` on `ws.onopen`. `src/client/connection.ts`.

### 7. Topbar UI

32px toolbar overlay terminal. `src/client/ui/topbar.ts`:

- **Session dropdown** (`#session-select`) — via `/api/sessions`
- **[+] button** — prompt for name, nav to `/<name>`
- **Window tabs** (`#win-tabs`) — one per tmux window, click send `Ctrl-S <index>`
- **Fullscreen button** (`#btn-fullscreen`)

**Auto-hide:** slide out after 1s. Reappear on mouse near top or window/fullscreen change.
**Focus:** `mousedown` + `preventDefault()` on buttons prevent focus theft. `adapter.focus()` call after interact.

### 8. Keyboard shortcuts

`src/client/ui/keyboard.ts`, document capture:
- **Cmd+R / Shift+Cmd+R** — passthrough to browser
- **Cmd+F** — toggle fullscreen

### 9. URL = session name

URL path = tmux session name (e.g. `/dev`). URL update via `history.replaceState` on session change.

## DOM Contract (E2E Tests)

IDs (do not rename):
- `#terminal` — container
- `#session-select` — `<select>`
- `#win-tabs` — window buttons
- `#btn-fullscreen` — toggle button
- `#btn-new-session` — "+" button

## Tests

### Test Fixing Policy

- Assume failing tests indicate implementation bug.
- Fix implementation, not tests.
- **No modify, weaken, delete, or bypass tests.**
- Exception: intentional behavior change (explicit instruct + recent commit confirm).
- Review git commits before modify test.
- Unclear? Ask for clarify.

## Development methodology

TDD: Test verify behavior → verify fail → implement → verify pass.

### Bug fixing

When asked to fix a bug, first run the full test suite and note the result. If existing failed tests already confirm the bug, fix it and make sure the full test suite pass. If no tests existed to verify the bug, create tests confirming the bug, fix the bug and make sure the full test suite is still passing.

### Git

Commit after every change with descriptive message.
