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

- **Real terminal emulator in the browser** — [xterm.js](https://xtermjs.org/) built from a pinned vendor submodule, with the WebGL, unicode-graphemes, web-links, web-fonts, and image addons.
- **Full mouse support** — click, drag, wheel, and SGR mouse reporting are forwarded to tmux.
- **Modern keyboard support** — Kitty keyboard protocol via xterm's `vtExtensions` for modified special keys (Ctrl+Enter, Shift+Tab, etc.).
- **Two-way OSC 52 clipboard** — `tmux` copy actions land in the browser clipboard automatically; clipboard reads from inside the pane (e.g. vim `+` register) work too, gated by a per-binary consent prompt.
- **Drag-and-drop and paste files into the terminal** — files are staged under a per-user tmp dir and their absolute path is pasted into the focused pane as a bracketed paste (shell-quoted for shells, raw for Claude / TUIs). Auto-cleaned via inotify close-watch plus a TTL sweep.
- **Theme packs** — colour scheme, font, spacing, opacity, background hue; three built-in themes ("Default", "AmigaOS 3.1", and "Amiga Scene 2000").
- **Session and window switcher** — auto-hiding toolbar with a session dropdown, per-window tabs, a "new session" button, and a fullscreen toggle.
- **Server-side session settings** — per-session colours/font/opacity/background hue/etc. persist in `~/.config/tmux-web/sessions.json` (atomic writes) and follow you across browsers.
- **URL-as-session** — the path (`/dev`, `/work`) maps to a tmux session name; bookmarkable.
- **Reconnect-safe** — WebSocket reconnect resyncs the terminal size automatically.
- **HTTP Basic Auth** — on by default.
- **TLS by default** — self-signed certificate auto-generated if none provided.
- **IP allowlist** — restrict access by client IP in addition to auth.
- **Single server binary** — `make tmux-web` produces an executable with embedded web assets and default config; it uses the host's `tmux`.

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

## tmux-term desktop app

`tmux-term` is an optional Electrobun desktop wrapper around tmux-web. It starts
a private tmux-web server on `127.0.0.1` with a per-launch random Basic Auth
secret, opens it in a native desktop window, and shuts the server down when the
window closes.

Local development:

```bash
bun install
bun run desktop:dev
```

Local package build:

```bash
make tmux-term
```

The desktop wrapper uses Electrobun's native webview first. Because tmux-web's
terminal renderer is WebGL-only, macOS and Linux builds must be smoke-tested in
the native webview before release.

**macOS Users**: Binaries downloaded via a web browser are flagged with a quarantine attribute by macOS Gatekeeper. Because these binaries are not signed with a paid Apple Developer account, macOS may say the file is "damaged" or "cannot be verified". You must remove the quarantine flag before running it:
```bash
xattr -d com.apple.quarantine tmux-web-darwin-*
```

## CLI options

```
-l, --listen <host:port>       Bind address (default: 0.0.0.0:4022)
-u, --username <name>          Basic Auth user (default: $TMUX_WEB_USERNAME or current user)
-p, --password <pass>          Basic Auth password (default: $TMUX_WEB_PASSWORD, required unless --no-auth)
    --no-auth                  Disable HTTP Basic Auth
-i, --allow-ip <ip>            Allow a client IP (repeatable; default: 127.0.0.1 and ::1)
-o, --allow-origin <origin>    Allow browser Origin (repeatable; full scheme://host[:port] or '*')
    --tls                      Enable HTTPS with a self-signed certificate (default)
    --no-tls                   Disable HTTPS and fallback to HTTP
    --tls-cert <file>          Use a specific TLS certificate
    --tls-key <file>           Use a specific TLS private key
    --tmux <path>              Path to tmux executable (default: tmux)
    --tmux-conf <path>         Alternative tmux.conf to load instead of user default
    --themes-dir <path>        User theme-pack directory override
    --reset                    Delete saved settings and restart running instances
    --test                     Test mode: `cat` instead of tmux, bypass IP/Origin allowlists
-d, --debug                    Log debug messages to stderr
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
source-file -q /etc/tmux.conf
source-file -q ~/.tmux.conf
source-file -q ~/.config/tmux/tmux.conf
source-file -q /etc/tmux-web.conf
source-file -q ~/.config/tmux-web/tmux.conf
source-file -q ~/.config/tmux-web/tmux-web.conf
```

Each path is silent if missing. General `tmux.conf` paths are sourced first so a single user config works everywhere; the `tmux-web*` paths come last so you can override anything specifically for the web frontend. Your existing tmux configuration keeps working; tmux-web simply ensures the required options are set first. You can also specify an alternative config to source using `--tmux-conf <path>`, which replaces the default `source-file` commands. To use a specific tmux executable, pass `--tmux <path>`.

## Security

tmux-web exposes an interactive shell over the network. Treat it accordingly.

- **Always set a password.** Basic Auth is enabled by default and the server refuses to start without a password unless `--no-auth` is given explicitly.
- **TLS is enabled by default.** Basic Auth credentials are encrypted in transit. If you provide no certificate, a self-signed one is generated.
- **Never bind to a public interface without TLS.** If you use `--no-tls`, ensure you are terminating TLS in front of tmux-web (nginx, Caddy, Cloudflare Tunnel, Tailscale Funnel).
- **Prefer localhost + reverse proxy** for production deployments. `--listen 127.0.0.1:4022` behind nginx/Caddy with a real certificate is the recommended setup. Use `--no-tls` if the proxy handles TLS.
- **Use `--allow-ip`** to restrict access to known client IPs when binding beyond localhost. Localhost is always allowed so local health checks keep working.
- **Use `--allow-origin`** to whitelist the browser Origins that are permitted to open WebSocket connections (see below).
- **Rotate the password** if the service has ever been exposed without TLS.
- **Consider a VPN or overlay network** (Tailscale, WireGuard) rather than exposing tmux-web directly to the internet.
- **Remember what this is.** Anyone who reaches a logged-in session has full shell access as the service user.

### Origin validation

tmux-web validates the browser `Origin` header on HTTP and WebSocket requests to close DNS-rebinding and cross-site-WebSocket attacks. Requests without an `Origin` header (curl, scripts) are not affected.

Default behaviour:

- Origins whose host is a literal IP listed in `--allow-ip` are auto-allowed (so `http://127.0.0.1:4022` and `http://<your-LAN-IP>:4022` work without extra config).
- Origins whose host is a hostname must appear in `--allow-origin`.

Examples:

```bash
# Direct LAN access
tmux-web --listen 0.0.0.0:4022 -i 192.168.2.4

# Behind nginx-proxy-manager at https://tmux.example.com
tmux-web --listen 127.0.0.1:4022 -i 10.0.0.5 \
  -o https://tmux.example.com
```

`-o *` disables the Origin check entirely — including the scheme/port tightening on IP-literal origins. It is an explicit opt-in; the server warns at startup if it's combined with any non-loopback `--allow-ip`.

## Architecture

- **Server** (`src/server/`) — TypeScript on Bun. HTTP, WebSocket, PTY lifecycle, OSC interception, TLS, IP allowlist.
- **Client** (`src/client/`) — TypeScript, bundled with `bun-build.ts`. Thin UI around a `TerminalAdapter` interface backed by xterm.js.
- **PTY** — `Bun.spawn` with `terminal` support, spawning `tmux -f tmux.conf`.
- **Out-of-band protocol** — session/window/clipboard updates are multiplexed into the PTY stream as `\x00TT:<json>` frames and stripped client-side.

See [`AGENTS.md`](AGENTS.md) for a deeper tour of the codebase, including the rationale behind each workaround (line-height padding, mouse forwarding, CSI-u, OSC 52 handling, reconnect resize).

## Development

```bash
make dev            # watch mode for client and server
make test           # unit tests (bun test) + e2e (playwright)
make test-unit
make test-e2e
```

Use `bun` exclusively; `npm`, `pnpm`, `tsx`, and `vitest` are not supported.

Tests follow a strict policy: failing tests indicate implementation bugs and are fixed by changing the implementation, not the test. See `AGENTS.md` for details.

## Credits

- **tmux-web** — © 2026 Per Wigren <per@wigren.eu>. The frontend, server, and packaging.
- **[tmux](https://tmux.github.io)** — the terminal multiplexer that does all the actual work. ISC-licensed; tmux-web is licensed the same way for compatibility.
- **[xterm.js](https://xtermjs.org)** — the in-browser terminal emulator that renders the PTY stream (vendored as a git submodule and patched for the Webgl/explicit-bg pipeline). MIT.
- **[Iosevka](https://typeof.net/Iosevka/)** — the Default theme's monospace font, by Belleve Invis. SIL Open Font License.
- **Amiga fonts** — bundled with the AmigaOS 3.1 and Amiga Scene 2000 themes. Sourced from [rewtnull/amigafonts](https://github.com/rewtnull/amigafonts):
  - **MicroKnight Nerd Font** — Niels Krogh "Nölb/Grafictive" Mortensen & dMG/t!s^dS!
  - **Topaz8 Amiga1200 Nerd Font** — Amiga Inc & dMG/t!s^dS!
  - **mOsOul Nerd Font** — Desoto/Mo'Soul & dMG/t!s^dS!

The same credits surface as tooltips on the font picker in the settings menu (hover a font name to see its attribution).

## License

ISC — see [LICENSE](LICENSE). Same license as tmux itself.
