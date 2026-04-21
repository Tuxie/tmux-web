# Changelog

## 1.6.0 — 2026-04-21

Major theming overhaul: all GUI chrome colours derive from a small set of CSS variables and slider-driven values. Themes set defaults; users tune everything at runtime.

### Added

- **Depth slider** (0–100): controls bevel opacity globally. 0 = flat/invisible, 100 = opaque black-and-white. All bevels in base.css use `rgba(255,255,255,depth)` / `rgba(0,0,0,depth)` — themes just set `defaultDepth` in theme.json.
- **Theme Contrast slider** (−100 to +100): scales gradient spread. 0 = theme default, +100 = full black-to-white gradient endpoints, −100 = flat. Piecewise mapping: negative fades to zero, positive amplifies up to 20× the base percentage.
- **Theme Saturation, Theme Lightness sliders**: now work across all themes (previously Default-only). Chrome derives from `--tw-primary = hsl(hue, sat, ltn)`.
- **Bias slider** (−100 to +100): independent brightness shift for all terminal colours (FG + explicit cell BG). +100 = all white, −100 = all black, works at any Contrast setting including zero.
- **TUI FG Opacity slider**: fades terminal text independently of background opacity.
- **TUI Saturation slider**: OKLab chroma scale for both FG and BG.
- **BG Brightest / BG Darkest sliders**: replace the old single BG Brightness. Body background is now a top-to-bottom gradient (brightest → darkest).
- **`--tw-ui-font` CSS variable**: themes set it once in `:root`; topbar, dropdowns, and context menus all inherit. Fixes font inheritance for menus appended to `document.body`.
- Scene 2000 frame sides now have a top-to-bottom gradient matching the toolbar.
- Default theme topbar has a subtle gradient (bright top, dark bottom).
- Double-click any slider to reset to its theme default.

### Changed

- **Contrast transform rewritten**: cutoff auto-centers on the rendered background's OKLab luminance. The exclusion zone pushes colours away from the background so nothing blends in — the original implementation could push colours *closer*.
- **WebGL renderer is now mandatory**. The DOM renderer fallback, `getWebglEnabled()` toggle, and all skip-guards have been removed. All colour transforms (contrast, bias, saturation, opacity, depth) are WebGL-only.
- Amiga 3.1 and Scene 2000 themes no longer hardcode `--tw-chrome` or bevel colours — they inherit from base.css and respond to all sliders.
- Button symbols (close-gadget, depth-gadget, settings-gadget icons) use opaque borders unaffected by the Depth slider.
- `--tw-chrome-bg` is a fixed 5% offset from `--tw-chrome` (no longer scales with contrast).
- Form controls (`input`, `select`, `button`) now inherit `font-family` globally.

### Fixed

- Terminal Contrast + Bias calculations: colours no longer get pushed closer to the background luminance.
- Contrast transform now affects explicit cell background colours (rectangle renderer), not just foreground glyphs.
- Scene 2000 menu/context fonts: all dropdown menus inherit `--tw-ui-font` regardless of DOM attachment point.
- TUI Opacity slider now fades ANSI / palette / RGB background cells linearly through to the real page backdrop (including gradients/images). Premultiplied-alpha pipeline fixed.
- Inverse + default-fg rects now fade with TUI Opacity instead of staying opaque.

### Internal

- CSS variable tree in base.css: `--tw-primary` → `--tw-chrome` → `--tw-chrome-bg` → bevels/gadgets. Themes override variables, base.css `:where()` rules consume them.
- Theme packs declare all slider defaults in `theme.json` (`defaultDepth`, `defaultThemeContrast`, `defaultThemeSat`, `defaultThemeLtn`, etc.).
- `pushFgLightness` → `pushLightness` (applies to both FG and BG). New `rgbToOklabL` utility exported.

## 1.5.1 — 2026-04-18

## 1.5.1 — 2026-04-18

### Fixed

- WebGL renderer: bracketed-paste active-region highlight (shells using SGR 7 on default colours) was rendering as an invisible line. Root cause: upstream `TextureAtlas._getForegroundColor` only applies `color.opaque(result)` when `allowTransparency: true`, contradicting its own comment. Combined with tmux-web's opacity trick (`theme.background = rgba(r,g,b,0)`), INVERSE + CM_DEFAULT cells resolved to a fully-transparent fill, the glyph was never painted, and the tile classified as `NULL_RASTERIZED_GLYPH`. `bun-build.ts` now patches the vendor xterm.js to apply `color.opaque(result)` unconditionally.

### Internal

- Unit-test coverage raised to ≥ 98.7% lines; `make test-unit` gated on coverage thresholds via `scripts/check-coverage.ts`.
- WebSocket, PTY, file-drop, foreground-process, origin, colours, prefs, theme, session-settings, and UI modules (clipboard, keyboard, mouse, file-drop, clipboard-prompt) now have integration + unit coverage.
- `foreground-process` split into a pure parser + DI wrapper for testability.
- `ws` message dispatch extracted to a pure `ws-router` module.
- Test harness helpers added: ephemeral http+ws server startup, fake-tmux shell script, shared DOM/fetch stubs.
- E2E test for OSC 52 clipboard-read consent modal (previously deferred).

## 1.5.0 — 2026-04-18

Consolidated release closing all ten clusters of the 2026-04-17 internal code review. Non-user-visible changes (doc drift, CSS refactors, test-suite migrations, CI supply-chain hardening) are not repeated here — see the git log.

### Added

- `-i` short flag for `--allow-ip`.
- `-o` / `--allow-origin` flag to whitelist browser Origins for HTTP and WebSocket access. Repeatable. Values are full origins (`scheme://host[:port]`) or `*`.
- Self-signed TLS certificate and key are now persisted under `$XDG_CONFIG_HOME/tmux-web/tls/` (fallback `~/.config/tmux-web/tls/`) at mode 0o600. The cert fingerprint is stable across restarts — browsers keep their trust decision instead of prompting on every start. Regenerated on expiry (≥ 365 days) or if the files are missing.
- End-to-end test for the file-drop upload pipeline (`POST /api/drop` → `GET /api/drops` → `DELETE /api/drops`).
- Status-dot shape cue: stopped tmux sessions now render as a hollow outline alongside the existing colour change. Improves legibility for colour-blind users.
- Toast notification when a clipboard paste is attempted while the WebSocket is not connected (previously the paste was silently dropped).

### Security

- HTTP requests and WebSocket upgrades now validate the browser `Origin` header. Origins whose host is an IP literal in `--allow-ip` are auto-allowed; hostnames must appear in `--allow-origin`. Requests without an `Origin` header (curl, scripts) are unaffected. Closes a DNS-rebinding and cross-site-WebSocket vector identified in the 2026-04-17 code review.
- HTTP Basic Auth credential comparison now uses `crypto.timingSafeEqual` instead of plain `===`, closing a theoretical length/prefix timing oracle.
- Third-party GitHub Actions in the release workflow are pinned to commit SHAs instead of floating tags. Build/release/homebrew-tap-bump jobs have explicit `permissions:` blocks.
- `sanitiseSessions` filters out `__proto__`, `constructor`, and `prototype` keys, defusing a prototype-pollution path that was latent under current call sites.
- Theme-pack file reads validate containment via `fs.realpathSync` instead of `path.resolve`, closing a symlink-escape corner case.
- Custom dropdown triggers (session menu, settings menu, etc.) set `aria-haspopup` and toggle `aria-expanded`, making the open/closed state discoverable to screen readers.

### Changed

- Default `--allow-ip` now explicitly lists `127.0.0.1` and `::1` rather than relying only on the inline loopback guard.
- `--allow-ip`'s short flag is now `-i` (was `-a`). The long form is unchanged.
- `/api/session-settings` PUT body is capped at 1 MiB and wrapped in `try/catch`; broken streams respond `400 Bad Request` instead of crashing the handler.
- OSC 52 clipboard-write passthrough is capped at 1 MiB, matching the existing cap on the read path. Oversize payloads are dropped with a rate-limited stderr warning.
- All tmux subprocess calls now carry a 5 s timeout (was unbounded). A hung tmux subcommand can no longer pin an HTTP or WebSocket handler open indefinitely.
- Materialised bundled-themes directory is created with mode 0o700 (was default umask, typically world-readable).
- `--password` on the command line now emits a stderr warning recommending `$TMUX_WEB_PASSWORD` instead, and the argv entry is scrubbed to `***` after parse. The flag still works.
- The legacy `--terminal` compatibility alias has been removed. It was only a silent no-op shim for a two-day window during the terminal-backend refactor; no released version advertised it.
- The `--theme` / `-t` CLI flag is now accepted silently as a no-op (it was never wired to anything in 1.4.3 or earlier either). Reserved for a future re-introduction.

### Fixed

- `colours.ts:normalize` now validates hex content and length. Previously it would accept `0xgg` as a colour and forward `#gg` — invalid CSS — to xterm.
- `pty.ts` uses the canonical `'utf-8'` TextDecoder label instead of `'utf8'` (accepted by Bun as an alias, but not in the WHATWG encoding set that `tsc` knows about).
- `sendWindowState` was called without `void`/`await` in one place in `ws.ts`, leaking an unhandled-promise shape if the underlying tmux subcommand rejected.
- Duplicate `ResizeObserver` on `#terminal` (both the xterm adapter and the outer client installed one). The outer is authoritative; the inner is gone.
- Three `MutationObserver` / `ResizeObserver` instances without teardown wiring are now connected to their existing dispose paths.

## 1.4.3 — 2026-04-17

### Added
- Clickable URLs in the terminal. xterm's web-links addon was loading
  but its click handler was being swallowed by our document-level
  mouse interception — we now bypass the SGR forwarding when the
  mouse is over a hyperlink so the addon's default handler fires
  (opens in a new tab).
- Short-flag aliases matching what most CLIs (including tmux) use:
  `-V` for `--version` (was `-v`; aligns with `tmux -V`), `-u` for
  `--username`, `-p` for `--password`, `-a` for `--allow-ip`, `-t`
  for `--theme`. `--test` no longer has a short alias (it was taking
  `-t` from `--theme`).

### Fixed
- Settings-menu dropdowns (Theme / Colours / Font) used to scroll
  *inside* the settings menu when their option lists were long.
  They now overflow the settings menu via `position: fixed` and
  scroll against the viewport instead.
- Shift+Enter and Ctrl+Enter now send CSI-u sequences
  (`\x1b[13;2u` and `\x1b[13;5u`) unconditionally, so Claude Code's
  "new-line without submitting" shortcut works again. xterm's Kitty
  keyboard support only emits enhanced sequences once the
  application opts in with `CSI > 1 u`, which Claude doesn't do.
- Startup errors are clearer and earlier when the environment is
  missing something: tmux-web now fails with a concrete message if
  the configured tmux binary isn't in `$PATH`, or if `openssl`
  isn't available when generating a self-signed TLS certificate.
  Both checks skip `--version` / `--help`, and the openssl check
  also skips when you pass `--tls-cert`/`--tls-key` or `--no-tls`.

### Internal
- Regression tests for the new short flags, version/help
  short-circuit, and the Shift+Enter / Ctrl+Enter CSI-u emissions.

## 1.4.2 — 2026-04-17

### Fixed
- Shift+Enter now produces a newline inside Claude Code again
  (regression from the Kitty-keyboard switch).

### Added
- Ctrl+Enter sends a distinguishable CSI-u sequence.

## 1.4.1 — 2026-04-17

### Fixed
- Terminal size miscalculated when switching between themes with
  different font metrics / line-height — bottom of the terminal
  could overflow the viewport or leave ~30px of dead space. The
  terminal container is now observed with `ResizeObserver` so every
  layout change triggers a re-fit.

### Added
- Homebrew-tap prerequisites: MIT LICENSE, a `--version` flag, a
  flat release-archive layout, and per-arch SHA-256 sidecars
  attached to the GitHub release.

## 1.4.0 — 2026-04-17

### Added
- Paste files from the clipboard the same way drag-and-drop works.
  Works in Chrome and Safari; Firefox on macOS only exposes the
  first file from multi-file pastes (OS-level limitation).
- Amiga theme overhaul: pixel-accurate window frame painted on the
  nine `#frame-*` divs, matched AmigaOS 3.1 depth-gadget on the
  settings button, size-matched resize-gadget on the window button,
  brighter-and-hue-matched palette.

### Changed
- All static styling in our code lives in CSS files — no more
  inline `style=""` in HTML or `.style.*` in TS except for
  genuinely dynamic values. Settings / sessions / windows menus
  now share one `.tw-dropdown-menu` styling rule per theme.
- Server-side session settings persisted in
  `~/.config/tmux-web/sessions.json` with atomic writes; dropped
  the old `localStorage` path.
