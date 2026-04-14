# tmux-web

A browser-based frontend for [tmux](https://github.com/tmux/tmux). Attach to your tmux sessions from any modern browser with a fast, faithful terminal emulator, full mouse and keyboard support, and a lightweight session/window switcher.

## Why

`tmux` is an excellent terminal multiplexer, but reaching a remote session normally requires SSH and a local terminal emulator. That is fine on a laptop, less fine on a tablet, a Chromebook, a borrowed machine, or any context where installing an SSH client and configuring keys is inconvenient.

tmux-web exposes a single tmux server over HTTPS (default) so you can:

- Attach to long-running sessions from anywhere with a browser.
- Share a terminal on devices without a native terminal (iPad, Chromebook, kiosk).
- Keep one canonical tmux server and reach it without juggling SSH multiplexing or mosh.
- Get a consistent font, color, and clipboard experience across machines.

It is intentionally small: a Bun server, a static client bundle, and a thin adapter layer over a real terminal emulator in the browser. There is no database, no account system, no multi-tenancy.

## Features

- **Real terminal emulators in the browser** — choose between [xterm.js](https://xtermjs.org/) (default) and [ghostty-web](https://ghostty.org/).
- **Full mouse support** — click, drag, wheel, and SGR mouse reporting are forwarded to tmux.
- **Modern keyboard support** — CSI-u sequences for modified special keys (Ctrl+Enter, Shift+Tab, etc.).
- **OSC 52 clipboard** — `tmux` copy actions land in the browser clipboard automatically.
- **Session and window switcher** — auto-hiding toolbar with a session dropdown, per-window tabs, a "new session" button, and a fullscreen toggle.
- **URL-as-session** — the path (`/dev`, `/work`) maps to a tmux session name; bookmarkable.
- **Reconnect-safe** — WebSocket reconnect resyncs the terminal size automatically.
- **HTTP Basic Auth** — on by default.
- **TLS by default** — self-signed certificate auto-generated if none provided.
- **IP allowlist** — restrict access by client IP in addition to auth.
- **Single static binary** — `make tmux-web` produces a self-contained executable with embedded assets.

## Requirements

- `tmux` installed and on `PATH`.
- [Bun](https://bun.sh) for development and builds (runtime is bundled into the release binary).
- A modern browser (Chromium, Firefox, or Safari).

## Quick start

```bash
bun install
make build
TMUX_WEB_PASSWORD=changeme bun src/server/index.ts --listen 127.0.0.1:4022
```

Then open <https://127.0.0.1:4022> and log in with your OS username and the password you set. (Note: browser will show a certificate warning for the auto-generated self-signed cert).

To build a standalone binary:

```bash
make tmux-web
./tmux-web --listen 127.0.0.1:4022
```

The binary embeds the client bundle, fonts, and default `tmux.conf`. It can be copied to any host with `tmux` installed.

## CLI options

```
--listen <host:port>     Bind address (default: 0.0.0.0:4022)
--terminal <backend>     Terminal backend: ghostty or xterm (default: xterm)
--username <name>        Basic Auth user (default: $TMUX_WEB_USERNAME or current user)
--password <pass>        Basic Auth password (default: $TMUX_WEB_PASSWORD, required unless --no-auth)
--no-auth                Disable HTTP Basic Auth
--allow-ip <ip>          Allow a client IP (repeatable; localhost is always allowed)
--tls                    Enable HTTPS with a self-signed certificate (default)
--no-tls                 Disable HTTPS and fallback to HTTP
--tls-cert <file>        Use a specific TLS certificate
--tls-key <file>         Use a specific TLS private key
--test                   Test mode: `cat` instead of tmux, bypass IP allowlist
```

## Running as a service

tmux-web is designed to run as a `systemd --user` service so it inherits the user environment and survives across logins.

```bash
cp tmux-web.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tmux-web
systemctl --user status tmux-web
```

Edit the unit to set `TMUX_WEB_USERNAME` and `TMUX_WEB_PASSWORD` before enabling. Use `loginctl enable-linger <user>` if you want the service to run without an active login session.

## tmux configuration

The bundled `tmux.conf` enables the settings tmux-web relies on (terminal passthrough, extended keys, clipboard integration) and then sources your own config:

```tmux
source-file -q ~/.config/tmux/tmux.conf
source-file -q ~/.tmux.conf
```

Your existing tmux configuration keeps working; tmux-web simply ensures the required options are set first.

## Security

tmux-web exposes an interactive shell over the network. Treat it accordingly.

- **Always set a password.** Basic Auth is enabled by default and the server refuses to start without a password unless `--no-auth` is given explicitly.
- **TLS is enabled by default.** Basic Auth credentials are encrypted in transit. If you provide no certificate, a self-signed one is generated.
- **Never bind to a public interface without TLS.** If you use `--no-tls`, ensure you are terminating TLS in front of tmux-web (nginx, Caddy, Cloudflare Tunnel, Tailscale Funnel).
- **Prefer localhost + reverse proxy** for production deployments. `--listen 127.0.0.1:4022` behind nginx/Caddy with a real certificate is the recommended setup. Use `--no-tls` if the proxy handles TLS.
- **Use `--allow-ip`** to restrict access to known client IPs when binding beyond localhost. Localhost is always allowed so local health checks keep working.
- **Rotate the password** if the service has ever been exposed without TLS.
- **Consider a VPN or overlay network** (Tailscale, WireGuard) rather than exposing tmux-web directly to the internet.
- **Remember what this is.** Anyone who reaches a logged-in session has full shell access as the service user.

## Architecture

- **Server** (`src/server/`) — TypeScript on Bun. HTTP, WebSocket, PTY lifecycle, OSC interception, TLS, IP allowlist.
- **Client** (`src/client/`) — TypeScript, bundled with `bun-build.ts`. Thin UI around a `TerminalAdapter` interface that abstracts xterm.js and ghostty-web.
- **PTY** — `Bun.spawn` with `terminal` support, spawning `tmux -f tmux.conf`.
- **Out-of-band protocol** — session/window/clipboard updates are multiplexed into the PTY stream as `\x00TT:<json>` frames and stripped client-side.

See [`CLAUDE.md`](CLAUDE.md) for a deeper tour of the codebase, including the rationale behind each workaround (line-height padding, mouse forwarding, CSI-u, OSC 52 handling, reconnect resize).

## Development

```bash
make dev            # watch mode for client and server
make test           # unit tests (bun test) + e2e (playwright)
make test-unit
make test-e2e
```

Use `bun` exclusively; `npm`, `pnpm`, `tsx`, and `vitest` are not supported.

Tests follow a strict policy: failing tests indicate implementation bugs and are fixed by changing the implementation, not the test. See `CLAUDE.md` for details.

## License

See `LICENSE` if present, otherwise treat as all rights reserved by the author.
