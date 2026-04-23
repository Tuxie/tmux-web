# tmux-web

Browser-based tmux frontend. Uses xterm.js as terminal backend. Run as systemd user service.

---

## ⚠️ CRITICAL — xterm.js MUST come from `vendor/xterm.js`, NEVER from npm

The release binary **MUST** embed the xterm.js built from the
`vendor/xterm.js` git submodule (pinned to a specific upstream HEAD
commit). It **MUST NOT** fall back to the npm `@xterm/xterm@6.0.0`
package. This has silently regressed at least five times and burned
hours of debugging. Treat any change touching `bun-build.ts`,
`Makefile`, the vendor tsconfig patching, or `release.yml` as
load-bearing.

- `bun-build.ts` throws hard if `vendor/xterm.js` is absent. Do not
  re-introduce an npm fallback.
- `bun-build.ts` appends a sentinel `tmux-web: vendor xterm.js rev <SHA>`
  to `dist/client/xterm.js` — the release workflow greps for it via
  `scripts/verify-vendor-xterm.ts`.
- CI step "Verify compiled binary embeds vendor/xterm.js" runs that
  script against the compiled binary. A regression fails the release.

### Before pushing a release tag (or any change to the build pipeline)

You **MUST** run the release workflow locally with `act` and confirm
the verify step passes. Only push the tag after act is green:

```bash
act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

The upload-artifact step fails under `act` (no runtime token) — that
is expected and fine. Everything preceding it, including unit tests
and `verify-vendor-xterm.ts`, must succeed.

After `act` is green, also run the property / fuzz pass before pushing
the tag:

```bash
make fuzz
```

Fuzz tests live under `tests/fuzz/` and target the nine
security-sensitive parsers (shell quoting, filename / session
sanitisation, OSC 52 extraction, origin parsing, WS router, TOML
colour parsing, `/proc/<pid>/stat` parsing, TT message extraction).
They're excluded from `bun test` / the release CI path (bunfig's
`root = "tests/unit"`) so the per-release cost is zero; the trade-off
is that discovering a new fuzz regression is a manual pre-tag step.

---

## Architecture

- **Server** — TypeScript, Bun runtime (`src/server/`)
- **Client** — TypeScript, bundle via `bun-build.ts` (`src/client/`)
- **Terminal backend** — xterm.js 6.0.0 (from `vendor/xterm.js` submodule)
- **Renderer** — **WebGL only** (`@xterm/addon-webgl`). The DOM renderer is
  not supported. All colour transforms (contrast, bias, saturation, opacity)
  are patched into the WebGL glyph renderer and rectangle renderer via
  `_patchWebglExplicitBackgroundOpacity()` in `src/client/adapters/xterm.ts`.
  Do not add DOM-renderer fallback paths or skip-guards for missing WebGL.
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
-l, --listen <host:port>       Bind address (default: 0.0.0.0:4022)
-i, --allow-ip <ip>            Allow IP (repeatable; default: 127.0.0.1 and ::1)
-o, --allow-origin <origin>    Allow browser Origin (repeatable; full scheme://host[:port] or '*')
-u, --username <name>          Basic Auth user (default: $TMUX_WEB_USERNAME or current user)
-p, --password <pass>          Basic Auth pass (default: $TMUX_WEB_PASSWORD, required)
    --no-auth                  Disable HTTP Basic Auth
    --tls                      Enable HTTPS with self-signed cert (default)
    --no-tls                   Disable HTTPS and fallback to HTTP
    --tls-cert <path>          Custom TLS certificate file (use with --tls-key)
    --tls-key <path>           Custom TLS private key file (use with --tls-cert)
    --tmux <path>              Path to tmux executable (default: tmux)
    --tmux-conf <path>         Alternative tmux.conf
    --themes-dir <path>        User theme-pack directory override
    --test                     Test mode: cat PTY, bypass IP/Origin allowlists
    --reset                    Delete saved settings and restart running instances
-d, --debug                    Log debug messages to stderr
-V, --version                  Print version and exit
-h, --help                     Show this help
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

`tmux.conf` sets defaults (passthrough, extended-keys, clipboard) then sources user configs in this order (each silent if missing):
```
/etc/tmux.conf
~/.tmux.conf
~/.config/tmux/tmux.conf
/etc/tmux-web.conf
~/.config/tmux-web/tmux.conf
~/.config/tmux-web/tmux-web.conf
```
General `tmux.conf` files are picked up first so a single user config works everywhere; the `tmux-web*` files come last so you can override anything specifically for the web frontend. Server passes via `tmux -f <path>`. Alternative config via `--tmux-conf`.

---

## Terminal Backend Adapter

`TerminalAdapter` interface (`src/client/adapters/types.ts`) abstracts the terminal emulator. UI modules interact with the interface only.

## Colour Schemes

Theme packs contribute colour schemes alongside font and theming assets.

### How it works

- `theme.json` lists colour files in a `colours[]` array. Each entry is a relative path within the pack (e.g. `colours/gruvbox-dark.toml`). **All paths must be forward-slash separated, no `..` or leading `/`** (validated by `isValidPackRelPath` in `src/server/themes.ts`).
- `.toml` files use **Alacritty colour format** (`[colors.primary]`, `[colors.normal]`, `[colors.bright]`). Parsed server-side via `import { TOML } from 'bun'` in `src/server/colours.ts` → xterm `ITheme`.
- `/api/colours` returns `ColourInfo[]` (name + parsed `ITheme`) for the UI.

### Per-session storage

Session settings are persisted server-side at `~/.config/tmux-web/sessions.json` (override via `TMUX_WEB_SESSIONS_FILE`). Atomic writes via `.part` → rename. Format:

```jsonc
{
  "version": 1,
  "lastActive": "main",
  "sessions": {
    "<name>": {
      "theme": "Default",
      "colours": "Gruvbox Dark",
      "fontFamily": "Iosevka Nerd Font Mono",
      "fontSize": 18,
      "spacing": 0.85,
      "opacity": 0,
      "clipboard": { /* per-binary OSC 52 read grants, BLAKE3-pinned */ }
    }
  }
}
```

`initSessionStore()` fetches the full config on page load; `saveSessionSettings` / `setLastActiveSession` update an in-memory cache and fire-and-forget `PUT /api/session-settings` with a partial body. Server merges and writes atomically. New sessions inherit settings from `lastActive`.

### Theme-switch semantics

When the user switches theme, every theme default declared in `theme.json` overwrites the corresponding session field — `colours`, `fontFamily`, `fontSize`, `spacing`, `opacity`, `themeHue`, `backgroundHue`, and all slider defaults introduced in v1.6.0 (`tuiBgOpacity`, `tuiFgOpacity`, `fgContrastStrength`, `fgContrastBias`, `tuiSaturation`, `themeSat`, `themeLtn`, `themeContrast`, `depth`, `backgroundSaturation`, `backgroundBrightest`, `backgroundDarkest`). See `applyThemeDefaults` in `src/client/session-settings.ts` for the authoritative list. Fields the target theme does not declare keep their previous values.

## Server-Client Protocol

Out-of-band messages: `\x00TT:<json>` in WS stream.

| Key | Trigger | Content |
|---|---|---|
| `session` | OSC title change | tmux session name |
| `windows` | OSC title change | `tmux list-windows` result |
| `title` | OSC title change | active pane title string (foreground process's window title) |
| `clipboard` | OSC 52 received | Base64 clipboard text |
| `clipboardPrompt`, `clipboardReadRequest` | OSC 52 read (DCS passthrough) | Prompt user + deliver reply |
| `dropsChanged` | File-drop write/delete/TTL-sweep | Refresh drops panel |

Server logic: `src/server/protocol.ts` (pure). Client parse: `src/client/protocol.ts`.

---

## Workarounds and Tweaks

### 1. Mouse wheel forwarding

Forward `\x1b[<64;col;rowM` / `\x1b[<65;col;rowM` (up/down). Shift+wheel bypass for native scroll. `src/client/ui/mouse.ts` + `src/client/index.ts`.

### 2. Mouse button + drag forwarding

Backends do not forward mouse buttons as SGR sequences to tmux.
**Fix:** `src/client/ui/mouse.ts` register `mousedown`/`mouseup`/`mousemove` on **`document`** (capture). `stopPropagation()` prevents the terminal from seeing the event. Shift+click bypass for native selection.

Format: `\x1b[<btn;col;rowM` (press), `\x1b[<btn;col;rowm` (release), motion add 32 to btn.

### 3. Kitty keyboard protocol

xterm.js's `vtExtensions.kittyKeyboard: true` option (vendored build) emits
Kitty-protocol CSI sequences for modified special keys once the app
negotiates Kitty mode. `src/client/ui/keyboard.ts` handles the pieces
xterm can't or won't: Cmd+R / Shift+Cmd+R browser-reload passthrough,
Cmd+F fullscreen toggle, and unconditional Shift+Enter / Ctrl+Enter
CSI-u sends (`\x1b[13;2u` / `\x1b[13;5u`). The explicit CSI-u sends
exist because TUIs that don't negotiate Kitty mode — notably Claude
Code — would otherwise receive a bare `\r`.

### 4. OSC 52 clipboard

**Write (tmux → browser):** intercepted server-side (`src/server/protocol.ts`).
Sequence stripped from PTY, base64 payload sent as `\x00TT:{"clipboard":"…"}`.
Client decodes via `atob()`, writes to `navigator.clipboard`
(`src/client/ui/clipboard.ts`).

**Read (browser → tmux):** `ESC ] 52 ; c ; ? BEL` requests trigger a per-binary
consent prompt (`src/client/ui/clipboard-prompt.ts`). Grants persist in
`sessions.json` under `clipboard: { [exePath]: { read, write } }`; optional
BLAKE3 pinning (`src/server/hash.ts`) guards against binary swap. Reply is
delivered to the tmux pane via `tmux send-keys -H <hex>` (see
`src/server/tmux-inject.ts` + `src/server/osc52-reply.ts`).

**TOCTOU assumption.** The BLAKE3 pin is hashed at consent-decision
time via `/proc/<pid>/exe`, and the reply lands back at the same pid
via `tmux send-keys -H`. Between the two the process could `exec` a
different binary (same pid), receiving a clipboard grant the consent
prompt granted to the previously-hashed image. We accept this gap at
T2: the attacker must already have code execution as the tmux user,
in which case they already control the consent-prompting session and
the on-disk `sessions.json`. The pin defends against accidental
binary replacement and unrelated processes; it is not a kernel-level
isolation boundary. See cluster 06 (docs/code-analysis/2026-04-21)
for the rejected mitigations (re-hash-before-send, pidfd routing).

**Clipboard grants are consent-only.** The server rejects any
`clipboard` sub-object on `PUT /api/session-settings` with 400 —
grants flow exclusively through `recordGrant` driven by the consent
prompt. This preserves the invariant that `sessions.json.clipboard`
entries map 1:1 to prompt accepts.

### 4b. File drop & clipboard paste

`POST /api/drop?session=<name>` persists an uploaded file under a stable
per-user tmp dir (`$XDG_RUNTIME_DIR/tmux-web/drop/<dropId>/<filename>`, or
uid-scoped `/tmp` fallback), then injects the absolute path into the pane as
a bracketed paste — shell-quoted when the foreground process is a shell
(`/bin/bash`, `/bin/zsh`, …), raw otherwise. Trailing space so multi-file
drops concatenate to `p1 p2 p3 ` for e.g. `cp …`.

Client hooks:
- **Drag-and-drop**: `src/client/ui/file-drop.ts` (`installFileDropHandler`).
- **Clipboard paste**: same module installs a document-level `paste` listener;
  pastes with file entries upload via the same pipeline. Firefox on macOS
  Finder only exposes the first file from a multi-file paste — browser
  limit, can't be worked around.

Auto-cleanup: `inotifywait -q -e close_write,close_nowrite` fires once per
drop; when the client-side process finishes reading, the file is unlinked
and the parent subdir removed. TTL sweep + per-session ring-buffer cap in
`src/server/file-drop.ts` provide backstops. Drop state changes emit a
`dropsChanged` TT push so the drops panel (`src/client/ui/drops-panel.ts`)
stays in sync without polling.

### 5. Reconnect size sync

WS reconnect: call `adapter.fit()`, send `{"type":"resize"}` on `ws.onopen`. `src/client/connection.ts`.

### 6. Topbar UI

32px toolbar overlay terminal. `src/client/ui/topbar.ts`:

- **Session menu button** (`#btn-session-menu`) — the right half of the `[ + | <session name> ]` control. Opens a custom dropdown listing sessions from `/api/sessions`, a "New session:" text-input row, and a "Kill session X…" entry at the bottom. Label is `#tb-session-name`. Button gets `.open` while dropdown is showing. The `+` half is `#btn-session-plus`, currently an unwired placeholder (fate tracked in cluster 11).
- **Window tabs** (`#win-tabs`) — one per tmux window; click sends a `{type:'window', action:'select', index}` WS message, which the server translates to `tmux select-window`
- **Fullscreen checkbox** (`#chk-fullscreen`) — inside the settings menu

**Auto-hide:** slide out after 1s. Reappear on mouse near top or window/fullscreen change.
**Focus:** `mousedown` + `preventDefault()` on buttons prevent focus theft. `adapter.focus()` call after interact.

### 7. Keyboard shortcuts

`src/client/ui/keyboard.ts`, document capture:
- **Cmd+R / Shift+Cmd+R** — passthrough to browser
- **Cmd+F** — toggle fullscreen
- **Shift+Enter** — send `\x1b[13;2u` (CSI-u) even when the app hasn't
  negotiated Kitty mode, so e.g. Claude Code sees a real modified-Enter
  instead of a bare `\r`.
- **Ctrl+Enter** — send `\x1b[13;5u` for the same reason.

### 7b. Custom-dropdown keyboard model

Every `Dropdown` instance (theme / colours / font / sessions / windows)
shares one keyboard contract, implemented once in
`src/client/ui/dropdown.ts`:

- **ArrowDown / ArrowUp** move the active-option marker, wrapping at
  both ends.
- **Enter** or **Space** selects the active option and closes the menu.
- **Escape** closes without selecting.

Focus stays on the trigger; the active option is tracked via
`aria-activedescendant` on the trigger + `.tw-dd-active` visual class
on the option. Items are `role="option"` inside a `role="listbox"`
container, with `aria-selected` toggled for the already-picked value.
No Home/End, no first-letter type-ahead — deliberate choice to keep
the sessions-dropdown text input (bottom of the menu) free of
keystroke ambiguity.

### 8. URL = session name

URL path = tmux session name (e.g. `/dev`). URL update via `history.replaceState` on session change.

## DOM Contract (E2E Tests)

IDs (do not rename):
- `#terminal` — container
- `#btn-session-plus` — left half of the session control (currently unwired; fate tracked in cluster 11)
- `#btn-session-menu` — right half of the session control, opens the sessions dropdown
- `#tb-session-name` — text label inside `#btn-session-menu` (the `<name>` part)
- `#win-tabs` — window buttons
- `#chk-fullscreen` — fullscreen checkbox (inside settings menu)
- `#chk-autohide` — topbar auto-hide checkbox (inside settings menu)
- `#inp-theme` — theme `<select>` (visually replaced by `#inp-theme-dd` + `#inp-theme-btn` custom dropdown; original `<select>` stays hidden as source of truth)
- `#inp-colours` — colour scheme `<select>` (custom dropdown: `#inp-colours-dd` / `#inp-colours-btn`)
- `#inp-font-bundled` — bundled font `<select>` (custom dropdown: `#inp-font-bundled-dd` / `#inp-font-bundled-btn`)
- `#inp-fontsize` / `#sld-fontsize` — font size number/slider
- `#inp-spacing` / `#sld-spacing` — spacing (line height) number/slider
- `#inp-opacity` / `#sld-opacity` — opacity number/slider
- Slider pairs following the pattern `#sld-{name}` / `#inp-{name}` for
  v1.6.0 theming controls: `theme-hue`, `theme-sat`, `theme-ltn`,
  `theme-contrast`, `depth`, `background-hue`, `background-saturation`,
  `background-brightest`, `background-darkest`, `tui-bg-opacity`,
  `tui-fg-opacity`, `fg-contrast-strength`, `fg-contrast-bias`,
  `tui-saturation`.
- `#btn-reset-colours` / `#btn-reset-font` — reset to theme defaults
- `#chk-subpixel-aa` — Subpixel AA checkbox (inside settings menu, under Line Spacing). Persisted per fontFamily via `getFontSubpixelAA` / `setFontSubpixelAA` in `prefs.ts`; default is on for every font. Toggling reloads the page because `allowTransparency` is effectively init-only in xterm.

## Tests

### Test Fixing Policy

- Assume failing tests indicate implementation bug.
- Fix implementation, not tests.
- **No modify, weaken, delete, or bypass tests.**
- Exception: intentional behavior change (explicit instruct + recent commit confirm).
- Review git commits before modify test.
- Unclear? Ask for clarify.

## CSS

**No inline CSS, ever.** All styling lives in CSS files:

- **`src/client/base.css`** — shared, theme-neutral defaults (layout,
  sizing, positioning, flex/grid rules). Everything that is *not*
  "look and feel" goes here.
- **`themes/<name>/<name>.css`** — colours, borders, fonts, bevels,
  background — i.e. look-and-feel overrides that can override the base
  cleanly without `!important`.

This includes `style=""` attributes in `index.html` *and* `el.style.*`
/ `Object.assign(el.style, …)` in TypeScript. If you catch yourself
writing either, stop: give the element a class or id, and put the
rule in `base.css`. The only exception is a value that is genuinely
dynamic (e.g. `overlay.style.display = 'flex' | 'none'` toggled at
runtime) — those are fine.

Why: inline styles have the highest specificity short of `!important`,
which forces every theme override to use `!important` and turns the
cascade into a shouting match. Keeping rules in files means themes can
override any base style with a plain selector.

### Class naming

Project-owned classes carry a `tw-` prefix (`tw-menu-row`, `tw-dropdown`,
`tw-drops-row`, `tw-win-tab`, `tw-toast`, …). This separates them at a
glance from browser / library defaults (xterm's `.xterm-*`, state flags
like `.active` / `.open` / `.selected` applied alongside a prefixed
base class, etc.). IDs stay bare (`#topbar`, `#menu-dropdown`,
`#win-tabs` …) because there's no ambiguity with third-party markup
there. When adding a new dynamic class from TypeScript, prefix it with
`tw-` unless you're flipping a state flag on an element that already
carries a `tw-*` base class.

### Slider styling contract

The menu-scoped range-input structure (dimensions, pseudo-element
layout, active-press bevel flip) lives in `src/client/base.css`. Themes
vary only the *material* via CSS custom properties declared on
`#menu-dropdown`:

- `--tw-slider-fill` — left-of-thumb track colour
- `--tw-slider-track-bg` — right-of-thumb track colour
- `--tw-slider-track-bevel-hi` / `--tw-slider-track-bevel-lo`
- `--tw-slider-thumb-bg` / `--tw-slider-thumb-bg-active`
- `--tw-slider-thumb-bevel-hi` / `--tw-slider-thumb-bevel-lo`

All fall back to the existing `--tw-chrome` / `--tw-gadget-bg` /
`--tw-bevel-hi` / `--tw-bevel-lo` family, so a minimal theme can set
nothing and still get a usable slider. If your theme needs a different
track height or thumb shape, override the structural rules directly
instead of forcing the custom-property path.

## Development methodology

TDD: Test verify behavior → verify fail → implement → verify pass.

### Bug reporting

Whenever coming across a bug unrelated to what you are currently working on, automatically report it in a file in `docs/bugs/`. Write all details you already know about the bug and what you were doing when you encountered the bug. Don't do any further research about the bug, just leave the research for a future bug fixing session. When the bug report is filed, continue doing what you were supposed to do. If the bug you found affects the implementation of what you were working on, fix it if it's trivial, otherwise stop and ask for guidance.

When explicitly asked to file a bug report, the audience of that bug report will be a much lesser capable language model. Include enough detail for a simple model to be able to implement the fix without first having to do a lot of research on things you already know.

### Bug fixing

When fixing a bug, first run the related tests and note the result. If existing failed tests already confirm the bug, fix it and make sure the full test suite pass. If no tests existed to verify the bug, create tests confirming the bug, fix the bug and make sure the full test suite is still passing.

If the bug you fixed was filed under `docs/bugs/`, move it to `docs/bugs/fixed/`.

### Git

Commit after every change with a descriptive title and a medium detailed explanation.

### Releases

**Every release must ship a human-readable changelog in the
GitHub Release body, not just a bump commit title.**

Before tagging `vX.Y.Z`:

1. Add a new `## X.Y.Z — YYYY-MM-DD` section at the top of
   `CHANGELOG.md` summarising what changed in plain English
   (grouped under *Added* / *Changed* / *Fixed* / *Internal*
   headings as appropriate). Write for the user, not for the
   committer — the goal is a reader who taps "Releases" on the
   repo page should understand what changed and why.
2. Bump `version` in `package.json`.
3. Commit, tag, push.

The release workflow extracts the matching section from
`CHANGELOG.md` and uses it verbatim as the release body. A missing
or empty section falls back to a placeholder — **don't rely on
the fallback**; always write the section before tagging.
