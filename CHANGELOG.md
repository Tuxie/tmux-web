# Changelog

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
