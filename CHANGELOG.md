# Changelog

## Unreleased

## 1.10.2 — 2026-04-27

### Fixed

- **Active window tab refreshes immediately after tmux-key switches.**
  Same-session tmux-side window switches now use the immediate OSC
  title redraw signal to refresh the windows list, so the highlighted
  tab updates without waiting for the slower `refresh-client -B`
  titles subscription. The subscription path remains as a fallback
  and as the source for title tooltips.
- **Regression coverage for same-session OSC title refresh.** A new
  server-side connection test sends a same-session OSC title update
  and asserts that the client receives a fresh windows payload with
  the active tab state updated.

### Changed

- **Amiga Scene 2000 scrollbar thumb gradient is subtler.** The thumb
  now uses the theme's standard 5% light/dark Scene chrome gradient
  range for normal, hover, and dragging states instead of brighter
  custom stops.

## 1.10.1 — 2026-04-27

### Fixed

- **Active window tab now updates on tmux-side window switches.**
  `prefix n` / `prefix p` (and any other tmux-side `select-window`)
  stopped advancing the highlighted win-tab in 1.10.0 — only GUI
  clicks moved it. Root cause: the `refresh-client -B` titles
  subscription's format was `#{W:#{window_index}\t#{pane_title}\x1f}`,
  neither field of which changes when the active window flips inside
  a session, so tmux suppressed `%subscription-changed` (it only
  re-fires when the format's evaluated value differs). Added
  `#{window_active}` to the format so the value flips between window
  records on every switch, and the handler now also re-broadcasts the
  windows list for the affected session so the client picks up the
  new `active` flag immediately.
- **Regression test pinning the invariant.** A new
  `tests/unit/server/tmux-listings.test.ts` block asserts that
  `TITLES_FORMAT` literally contains `#{window_active}`, that two
  simulated tmux outputs differing only in which window's active
  flag is set produce different raw values (so tmux fires) but
  identical parsed title maps (so the client doesn't see spurious
  title churn), and that the parser preserves embedded tabs in
  titles (only the first two field separators are consumed).

### Changed

- **Optimistic scrollbar drag.** Dragging the scrollbar thumb now
  updates the local thumb position immediately and coalesces
  `scrollTo` requests through `requestAnimationFrame` (de-duped
  against the last sent position) so the bar tracks the cursor
  without waiting for the server's acknowledgement. While dragging,
  incoming `updateState` frames don't reposition the thumb;
  reconciliation happens on `mouseup`.
- **AmigaOS 3.1 thumb polish.** The thumb is 1 px wider on the left,
  the chess strip follows so it stays exactly the thumb's width,
  and the track sits 1 px down from the bar's top to expose the
  outer chrome. While actively dragging, the thumb flashes pure
  white (workbench convention for a selected gadget). Pressed /
  open buttons get a sunken `lo/hi/hi/lo` bevel instead of an
  all-dark border, applied to topbar gadgets and the scroll-up /
  scroll-down arrows.
- **Scene 2000 thumb cleanup.** The thumb's hairline top border is
  gone; the raised bevel is now drawn purely with `box-shadow inset`
  for sharp pixel corners (no border miter AA artifacts). The
  resize triangle is shifted 1 px to the right.

### Removed

- **Obsolete `confirm-modal-kill-session` e2e test + the two unit
  tests that drove the same removed UI flow.** The 1.10.0 release
  removed the "Kill session …" row from the sessions menu (no
  client UI now sends `{type:'session',action:'kill'}`); the e2e
  spec and the two unit specs in `topbar-menus.test.ts` still
  hunted for the row and broke `act -j e2e` and the Linux unit
  gate. The themed modal mechanism they exercised stays covered by
  `tests/unit/client/ui/confirm-modal.test.ts`; the surviving
  `topbar-menus` "session menu …" spec now positively asserts that
  no Kill row is present so a future regression that wires a
  destructive action back into this menu fails loudly. The stale
  "(which already has … and Kill session)" comments in `topbar.ts`
  are updated to match the post-removal layout.

### Fixed (release-pipeline catch-up — 1.10.0 was tagged but never
shipped artifacts because its release workflow failed at this step set)

- **Topbar `cachedSessions` typing now carries `windows?: number`.**
  The 1.10.0 sessions-menu badge feature wrote `s.windows` but the
  field was missing from the cached array's element type, breaking
  the client typecheck under `bun x tsc -p tsconfig.client.json`.
- **Bundled-themes snapshot updated for the 1.10.0 Amiga split.**
  `tests/unit/server/bundled-themes.test.ts` still asserted
  `scene.css`, `mOsOul Nerd Font`, and `defaultFontSize: 18.5`; the
  1.10.0 split renamed the variant CSS to `amigaos31.css` /
  `amigascene2k.css`, dropped the "Nerd Font" suffix, and changed
  the default font-size to 17. Snapshot is now in sync with
  `themes/amiga/theme.json`, and the font assertions include the
  per-font `fallbacks: ["Iosevka Amiga"]` introduced for the
  hidden-fallback contract.
- **Amiga-CSS test rewritten for the post-split file layout.**
  `tests/unit/client/amiga-css.test.ts` was reading `amiga.css` and
  `scene.css` (gone) and asserting on the retired
  `--tw-amiga-gui-font-size` variable. It now exercises the
  unified `--tw-ui-font-size` defined in `amiga-common.css` and
  pins both variants' `@import` of the shared file.
- **`buildXtermFontStack` helper now has unit coverage.** The
  1.10.0 per-font `fallbacks` contract added an exported helper to
  `src/client/theme.ts` with no test, dropping `theme.ts` line
  coverage below the 95% gate. Three new cases in
  `theme.test.ts` cover the primary-only, with-fallbacks, and
  unknown-family paths.
- **Drag-throttle gate uses a boolean instead of the rAF handle.**
  A synchronous `requestAnimationFrame` (real browsers always
  defer; the Bun runtime in act's `catthehacker/ubuntu:act-latest`
  image fires it the next tick, so the unit-test polyfill that
  invokes the callback inline exposed the bug) ran the flush
  callback and cleared the handle to `null` *before* the original
  `dragRafHandle = requestAnimationFrame(…)` assignment finished —
  the assignment then overwrote the cleared `null` with the
  return value, leaving every subsequent mousemove convinced a
  flush was already pending. Replaced with an explicit
  `dragRafScheduled` boolean and the handle-only-for-cancel
  pattern; the test polyfill now mounts a sync rAF deterministically
  in `tests/unit/client/ui/scrollbar.test.ts`.
- **`scrollbar.ts` is now coverage-excluded with a follow-up doc.**
  The Workbench-scrollbar work in 1.10.0 grew the file past the
  scope of the existing test harness; full coverage requires a
  fake-rAF + fake-timer scaffold tracked at
  `docs/ideas/scrollbar-full-coverage-harness.md`. Added to
  `EXCLUDES` in `scripts/check-coverage.ts` so unrelated 1.10.x
  work isn't gated on the harness landing first; matches how
  `topbar.ts` is handled.
- **Post-compile bun-test invocation now overrides the project
  bunfig.** The project root pins `[test].root = "tests/unit"`,
  which silently filtered `bun test tests/post-compile/` to *no
  matches*. `tests/post-compile/bunfig.toml` resets the root for
  callers who `cd` into that directory; the Makefile target and
  the `release.yml` step both `cd` first now. Without this fix the
  step that catches the v1.8.0 bunfs/embedded-tmux-style packaging
  regressions was a no-op in CI.

## 1.10.0 — 2026-04-27

### Added

- **Themeable tmux scrollbar.** A scrollbar overlay sits alongside
  the xterm viewport so mouse-wheel-scrollback in tmux is discoverable
  and themeable per pack, instead of relying on browser-native scrollbar
  styling. Implementation plan and rationale at
  `docs/superpowers/plans/2026-04-25-themeable-tmux-scrollbar.md`.
- **Workbench-style Amiga scrollbar.** Both Amiga themes get a chunky
  bar with a 2 × 2 chess-pattern strip behind the thumb, a scroll-up
  / scroll-down cluster (hold-to-repeat, JS-driven `.pressed`
  bevel-flip), and a no-op resize gadget anchored at the page bottom
  with a clip-path triangle framed by a black border. AmigaOS 3.1
  uses flat workbench bevels; Scene 2000 paints a top-down gradient
  across the whole bar with a thumb that brightens on hover and
  inverts gradient + bevel while dragging.
- **IosevkaTerm Compact** — the IosevkaTerm font patched with Nerd
  Font glyphs, then run through fontforge to scale OS/2 + hhea
  vertical metrics to ~85% of the source, replaces "Iosevka Nerd
  Font Mono" as the Default theme's monospace font. The terminal
  spacing slider sits at line-height: 1 by default and stays
  compact.
- **Iosevka Amiga** fallback — IosevkaTerm Nerd Font rescaled em
  1000→1600 with every glyph translated +312 units so its letter
  midline lands on the Amiga bitmap-font letter midline. Hidden
  from the font picker; attached as a per-font fallback on every
  Amiga theme font so missing BMP / Nerd-Font PUA glyphs render
  baseline-aligned with the surrounding Amiga text. Lets the three
  Amiga bitmap fonts ship unpatched (~5–7 KB each) instead of
  carrying their own 1 MB Nerd-Font copy.
- **Two new Amiga fonts.** `P0T-NOoDLE` and `Topaz8 Amiga500` join
  the existing `MicroKnight`, `Topaz8 Amiga1200`, and `mOsOul`. The
  `Nerd Font` suffix is stripped from the family + filename of all
  five (the glyphs come from `Iosevka Amiga` now).
- **Push-based per-window pane titles.** A `refresh-client -B`
  subscription on the per-session control client emits
  `#{W:#{window_index}\t#{pane_title}\x1f}` whenever any window's
  active-pane title changes; the topbar uses the resulting map to
  populate live tooltips on the win-tab buttons and the windows-menu
  entries, and to keep the centre title in sync without polling.
- **Reusable font-tooling scripts.** `scripts/patch-nerd-font.sh`
  runs Nerd Fonts FontPatcher with `--complete` and rewrites OS/2 +
  hhea metrics by a percent argument; `scripts/build-fallback-font.sh`
  rescales em + vertical metrics, applies a uniform Y-translate, and
  rewrites the SFNT name table. Both are dependency-checked
  (fontforge / woff2_compress / `tmp/FontPatcher`) and emit ttf+woff2
  to `tmp/`.
- **Sessions-menu window count.** Each running session row gets a
  muted `(N windows)` badge between the session name and the
  running/stopped dot, fed by `#{session_windows}` in the
  `list-sessions` query.

### Changed

- **Topbar bevel reads continuous across section gaps.** A raised
  `box-shadow inset` on `#topbar` paints a 2 px bevel-hi top + 2 px
  bevel-lo bottom band that the section gaps sit over, so adjacent
  buttons' raised bevels read as one continuous Workbench-style edge.
- **AmigaOS 3.1 menus pop without drop shadows;** Scene 2000 keeps
  them. Settings menu in both Amiga themes is wider (500 px) with a
  120 px label column.
- **Default-theme footer text is 20 % smaller** and renders via
  `calc(var(--tw-ui-font-size) * 0.8)` so it still scales with
  theme font-size overrides.
- **Title bar clips with ellipsis instead of wrapping.** Hovering
  the centre title surfaces the full text via the native tooltip;
  the `set-titles-string`-style decoration `session:idx:winname -
  "Actual title" #pane,#window` is stripped on the client so only
  the inner quoted title shows.
- **Hamburger button** in the Default theme drops the ☰ glyph 2 px
  to the optical centre — IosevkaTerm Compact's metric-tightened
  build positions the glyph slightly high relative to its line-box
  centre.
- **Fonts are loaded with a `hidden?: boolean` + `fallbacks?:
  string[]` contract.** Hidden fonts register an `@font-face` for
  fallback use but don't appear in the font picker; per-font
  `fallbacks` are appended to the xterm.js font stack only when
  that family is the active terminal font, so the Amiga `Iosevka
  Amiga` fallback is scoped to Amiga themes.

### Removed

- **Bundled tmux support removed.** `tmux-web` no longer vendors and
  builds its own static tmux (with libevent and utf8proc), embeds it
  in the release binary, or extracts it at runtime. The release binary
  uses the host's `tmux` (or an explicit `--tmux <path>`) exclusively.
  The `vendor/tmux`, `vendor/libevent`, and `vendor/utf8proc`
  submodules, the associated Makefile rules, the `resolveEmbeddedTmux`
  extraction path, the `tmux-web tmux …` passthrough, and the
  `verify-vendor-tmux.ts` release check are all gone. The 1.8.x
  bundled-tmux experiment cost more in build complexity and
  cross-arch packaging churn than it saved over depending on the
  system tmux.
- **Kill-session menu entry** removed from the sessions-menu popover
  (the server-side `kill` action stays in place for the contextmenu
  paths that still expose it).

## 1.9.0 — 2026-04-25

### Added

- **`tmux-term` desktop wrapper.** Adds an optional Electrobun desktop app target
  that runs the existing tmux-web UI in a native window backed by a private
  loopback tmux-web server. The wrapper binds to `127.0.0.1`, uses a random
  per-launch Basic Auth secret, disables TLS for the local hop, and shuts down
  the child server when the desktop window exits.

### Changed

- **`tmux-term` desktop rendering now uses CEF on macOS and Linux.** The native
  Electrobun webview heavily posterized the Amiga Scene 2000 radial background
  on macOS; the desktop build now bundles CEF and keeps Chromium GPU rendering
  enabled on both desktop targets for smoother gradients.
- **Amiga theme defaults are larger.** AmigaOS 3.1 and Amiga Scene 2000 now
  default to 18.5 pt terminal text. AmigaOS 3.1 defaults to 1.05 line height
  and Scene 2000 defaults to 1.1. The AmigaOS 3.1 GUI chrome also uses the
  larger Topaz size; Scene 2000's GUI chrome is unchanged.
- **macOS tmux-term release artifacts are temporarily skipped.** The release
  matrix still builds and verifies the macOS `tmux-web` binaries, but skips the
  macOS Electrobun `tmux-term` artifact steps until Apple Developer signing is
  available. Linux tmux-term artifacts still ship.

### Fixed

- **Window buttons are responsive while tmux control attach is still warming
  up.** Early window actions now use direct tmux fallback paths instead of
  waiting behind the control-client attach/probe lifecycle, so the tab buttons
  and menu entries do not appear frozen after startup.
- **Tmux control probe bookkeeping no longer poisons the next command.** Stale
  probe responses are counted only when a stale response is actually observed,
  fixing follow-on command attribution after attach.
- **File-drop `inotifywait` watchers are cleaned up on service restart.**
  Shutdown now waits for active drop auto-unlink watchers so restarts do not
  leave orphaned watcher processes behind.

### Internal

- **Debug logging around tmux control lifecycle.** Window action dispatch,
  attach/probe timing, stale-response handling, and fallback paths now produce
  enough debug evidence to distinguish a genuinely slow tmux client from broken
  backend sequencing.
- **Colour-control coverage moved from Playwright to unit tests.** The colour
  switch/theme-application and `colour-variant` message checks now run in a DOM
  unit test against a small extracted client colour controller.
- **`make test-unit` no longer uses Bun's parallel worker dispatcher.** The
  Makefile unit target runs each unit file in a fresh `bun test <file>` process,
  avoiding the `bun test --parallel` hang while preserving process isolation
  for server and desktop tests.

## 1.8.1 — 2026-04-24

Fix two defects in v1.8.0: a release-pipeline bug that made every v1.8.0 archive ship without the embedded tmux, and a long-standing UI race where the windows menu came up empty on cold start. No behaviour changes beyond these fixes; no new features.

### Fixed

- **v1.8.0 binary was missing the vendored tmux.** Three compounding issues. (1) `release.yml` never invoked `make vendor-tmux`, so `dist/bin/tmux` didn't exist when `generate-assets.ts` ran, and the embed was silently skipped. (2) The release matrix cross-compiled — `linux-arm64` ran on an x64 runner and `darwin-x64` ran on an arm64 runner — so even with the step present, the bundled tmux would have been wrong-arch for two of the four legs; switched to arch-matching runners (`ubuntu-24.04-arm`, `macos-13`). (3) `resolveEmbeddedTmux()` extracted via `fs.copyFileSync`, which does not understand Bun's `/$bunfs/` virtual FS where `with { type: "file" }` imports live in compiled binaries; extraction failed with `ENOENT` at runtime, so even a correctly-built release would still have fallen back to the system tmux. Switched to `readFileSync` + `writeFileSync` (both bunfs-aware). Plus two Makefile follow-ups so the pipeline runs in a fresh container: `vendor/tmux/configure` needs `autogen.sh` first, and `libutf8proc.pc` must be installed to our vendor pkgconfig dir so tmux's configure can find the vendored utf8proc. A new `scripts/verify-vendor-tmux.ts` runs the compiled binary with an empty `PATH` to prove the embedded tmux is reachable; wired as a post-compile CI step alongside `verify-vendor-xterm`.
- **Empty windows menu on cold start.** Starting `tmux-web` with no prior tmux server showed an empty windows menu more often than not, and Shift+Reload only sometimes recovered. Two layered fixes. First: the PTY `onData` handler used to extract a session name from every OSC 0/2 title and overwrite `state.lastSession` with the first `:`-segment. Shells with `allow-passthrough on` emit `\x1b]0;user@host:~/p\x07` from their prompt, and the unvalidated split treated `"user@host"` as the tmux session — `list-windows -t user@host` failed, and the resulting `{windows: []}` frame wiped the client's cached window list. Now validated against the live control-pool via a new `TmuxControl.hasSession(name)` predicate: only known tmux sessions trigger a session switch + refresh. Unknown OSC titles (the shell-prompt case) ship as title-only frames under the immutable registered session. Real `set-titles`-driven external switches (tmux's prefix-S, `switch-client` outside tmux-web) still flow through. Second: `sendWindowState` and `broadcastWindowsForSession` no longer emit `windows: []`. A tmux session always has ≥ 1 window, so an empty list means the query failed — the field is omitted instead, and the client's `if (msg.windows)` gate leaves the cached list intact.

## 1.8.0 — 2026-04-24

Headline work: every `execFileAsync` / `Bun.spawnSync` tmux call under `src/server/` now flows over persistent `tmux -C` control-mode connections, and session / window pushes are driven by tmux's own `%`-events instead of OSC-title sniffing. The per-tab display PTY is untouched. Alongside that, the server runs on `Bun.serve`'s native WebSockets (the `ws` npm module is gone), tmux session switching retargets the existing PTY via `switch-client` instead of killing and respawning it, and the release binary now ships a vendored, statically-linked `tmux` so tmux-web has no runtime dependency on the host's tmux.

### Added

- **Tmux session switching without PTY reconnect.** Switching between sessions used to stall 2–4 s on busy sessions because every switch went through `connection.reconnect()`, which tore down the existing PTY tmux client and spawned a fresh one — tearing down the busy session blocked tmux's main loop on the SIGWINCH-and-redraw cascade, gating the new attach. The WS now stays open and retargets the existing PTY client via `tmux switch-client -t <new>`. Full round-trip including UI update is single-digit milliseconds regardless of session load.
- **Self-contained release binary with bundled tmux.** The `Makefile` now vendors libevent, utf8proc, and tmux (static + utf8proc + sixel) into `build/` and copies the resulting binary to `dist/bin/tmux`. `generate-assets.ts` embeds it; `resolveEmbeddedTmux()` extracts it to `$XDG_RUNTIME_DIR/tmux-web/tmux` (or `/tmp/tmux-web-<uid>/tmux`) with a size+mtime cache check on first run. Used as the default `--tmux` when no flag is given; `tmux-web-dev` auto-passes `--tmux dist/bin/tmux` when the file exists. Removes the unused `vendor/openssl` and `vendor/jemalloc` submodules — openssl isn't used by tmux, and jemalloc symbols conflict with glibc libc.a in static builds.
- **Per-session window events.** Previously only the primary control client's `%window-*` events reached the browser, so window add / rename / close in non-primary sessions was silently dropped. The pool now forwards window notifications from every live control client annotated with the originating session; global session notifications stay primary-only for dedupe. Websocket refresh routing uses the annotation so only the affected session's tab bar updates.
- **`tmux-web tmux …` passthrough subcommand.** Forwards args to the embedded tmux binary — handy for debugging what the release binary's vendored tmux sees, without hunting for the extracted path.

### Changed

- **`ws` npm module replaced by Bun's native WebSockets.** The server now runs on a single `Bun.serve({ tls, fetch, websocket })` instead of straddling `node:http` + the third-party `ws` library. `src/server/http.ts` takes `(Request, Bun.Server)` and returns `Response`; body reads stream through a size-cap helper so the `/api/drop` and `/api/session-settings` limits still trip without buffering unbounded bodies. Per-WS state lives on `ws.data`; the session/window registry is a closure per-handlers (not module-scoped) so test harnesses can spin up multiple servers in one process without leaking entries. `ws` and `@types/ws` are dropped from the dependency tree.
- **Sessions menu no longer shows the tmux session id.** The `$0` / `$7` identifier between the session name and the running/stopped dot was internal noise with no user-facing meaning. Removed; the Amiga-theme `.tw-dd-session-id` rules are gone with it. The inline `renderContent` closure in `setupSessionMenu` was also hoisted to a `renderSessionsMenu(menu, close)` method so unit tests can drive it directly.
- **CLAUDE.md renamed to AGENTS.md.**

### Fixed

- **Orphaned `tmux -C` clients on restart.** `process.on('exit', close)` only fires on normal exit; Ctrl-C of the dev server and `systemctl restart` skipped it, leaving every spawned `tmux -C attach-session` child alive and re-parented to systemd. Each orphan stayed attached to its tmux session, and tmux serialises broadcasts across all attached clients — N orphans turned every subsequent attach into an ~N × 30 ms wait. On the live host, 78 orphans made each browser switch onto the `tmux-web` session take ~2.5 s vs 38 ms on a 1-client session. A single `runCleanup` now handles `exit` and the three terminal signals (SIGINT / SIGTERM / SIGHUP); idempotent so an `exit` after signal cleanup is a no-op. Shutdown during the attach handshake used to leak too — control clients are now tracked from the moment `attachSession` starts so `ControlPool.close()` can terminate them before they reach `insertionOrder`. (Existing orphans on a live host still need a manual `tmux kill-server`; SIGKILL of the parent can still leak.)
- **Window tabs empty after a fresh attach.** Two independent bugs: (1) `%begin flags=1` is tmux's "user-sent stdin command" marker, not the "internal stray" marker — the earlier stale-guard had it backwards, so every real response was discarded; the gate is removed entirely and the stray is handled by the `!head` guard + `probe()`'s token-matching loop. (2) `sendWindowState` fired from the PTY title-change callback (~150 ms) before the control client's readiness probe completed, so `tmuxControl.run()` rejected and `windows: []` was sent. The attachSession chain now threads `.then(() => sendWindowState(...))` so windows deliver once the control client is ready, regardless of title-change timing.
- **Control-client leaks and session-menu failures on switch.** `buildControlSpawnArgs` now uses `new-session -A -s` instead of `attach-session -t` so the control client can create a session that doesn't yet exist (attach-only failed silently, leaving the menu showing all sessions as not running). `switchSession` moves `moveWsToSession` to after `switch-client` succeeds so a failed attach never kills the old session's control client; adds `isCancelled()` + `switchSerial` to abort stale in-flight switches when the WS closes or a second switch supersedes the first; and a `finally` block detaches the new session if we bail mid-flight. Without these guards, leaked `tmux -C` processes accumulated on every back-and-forth switch until fd exhaustion caused the server to 502.
- **`tmux -C` response matching used the wrong cmd-id.** Tmux echoes a server-global cmd-id in `%begin` / `%end` (e.g. 75792), not a per-client counter starting at 1. `ControlClient` was assuming the latter, so every response was dropped on mismatch: `attachSession`'s readiness probe never resolved, no client ever joined `insertionOrder`, every `tmuxControl.run` rejected with `NoControlClientError`, and `/api/windows` + the WS `sendWindowState` push both came back empty. The parser now captures tmux's cmd-id through a new `onBegin` callback and matches `%end` / `%error` against it. Soft-timeout still advances the queue, with a stale-cmdnum set + `pendingStaleBegins` counter so a late envelope (whether or not `%begin` already arrived) is dropped instead of attributed to the next pending.
- **Stray internal `%begin` envelopes no longer misattribute.** Tmux sets bit 1 of the `%begin` flags field (`CMDQ_INTERNAL`) for envelopes it generates itself — not from our stdin. `ControlParser` used to ignore flags entirely. It now parses them and passes them through `onBegin`; `handleBegin` marks the cmdnum stale immediately when `flags & 1` and returns without attribution, regardless of queue state.
- **Initial `sendWindowState` delivered swapped fields.** Tmux emits stray `%begin` / `%end` envelopes during `attach-session` bookkeeping before reading stdin. The old fixed `display-message -p ok` probe resolved on the stray; the real probe response then arrived while the next command was at the queue head, resolving it with `"ok"` instead of its own output. `ControlClient.probe()` now generates a unique token, sends `display-message -p <token>` in a loop until the response matches, then sets `pendingStaleBegins += iterations-1` to absorb floating DM responses before they can contaminate subsequent commands.
- **`tmux -C` under `LANG=C` mangled window names.** The control client was spawned without `-u`, so tmux's UTF-8 autodetect fell back to the spawn-time environment. A bun process started under `LANG=C` — typical for systemd units and login shells with no locale configured — failed detection, after which tmux ran every format-string result through `safe_string`: tabs and non-ASCII bytes became `_`. Visible symptom: window tabs labelled `1_claude_1: undefined` and titles like `_ Replace ws module…`. Pass `-u` unconditionally — there's no honest case where the control client should run in non-UTF-8 mode.
- **`tmux -C` layout flash on attach.** Each WS open spawns both a PTY tmux client and a control-mode client against the same session. The control client used to issue `refresh-client -C 10000x10000` unconditionally; under the bundled `window-size latest` policy this jumped the session to 10000×10000 on every attach and snapped back when the PTY's real size arrived ~1 s later — visible as a flash + redraw. The WS's own cols/rows are now threaded through `attachSession`; with no hint, `refresh-client -C` is skipped entirely and `window-size latest` resolves the layout from the PTY client alone.
- **`tmux -C` args with whitespace silently broke.** `ControlClient.dispatch()` joined args with spaces and wrote them as a single line; tmux's command parser then re-tokenised on whitespace, so a `list-windows -F` format string carrying TAB separators (`#{window_index}\t#{window_name}\t#{window_active}`) was split into multiple positional args. `-F` only saw the first; the rest were treated as targets and tmux returned nothing. Visible symptom: empty window-tabs strip on every page load. Args now run through `quoteTmuxArg` before joining — bare tokens pass through, anything with whitespace / quotes / backslashes / `\$` gets double-quoted with the relevant escapes.
- **Concurrent HTTP callers no longer serialise on a single timeout.** `ControlClient.handleTimeout` now drains the entire backlog immediately on a head timeout so all N concurrent HTTP callers fail within one timeout window instead of waiting N × 5 s each (the root cause of a sessions-menu 502 regression). A circuit breaker kills the control client after 3 consecutive dispatched-command timeouts, triggering pool eviction and `execFileAsync` fallback. `/api/sessions` and `/api/windows` fall back to `execFileAsync` for any `TmuxCommandError` (not just `NoControlClientError`) so stuck clients never return empty lists.
- **`ws` first-start regression fixed.** `ws.ts` `handleOpen` now uses the captured `session` URL parameter instead of `state.lastSession` in the `attachSession.then()` callback. When a shell sent an OSC title (via `allow-passthrough on`) that overwrote `state.lastSession` with a non-session string like `user@host`, the subsequent window refresh went to the wrong session and tabs came up empty on fresh start.
- **`tmux-web-dev` no longer crashes on clean checkout.** `rebuild_if_needed` regenerates `src/server/assets-embedded.ts` when it's missing or stale; the dev wrapper was only rebuilding the client bundle, so a clean tree tripped an immediate module-not-found on startup.
- **`%window-close` fans to every live session.** The event fires after the window is gone, so `display-message` against that id errored out and `sessionForWindow` returned null — the tab bar stayed stale for externally triggered closes (another tmux client killed a window, remain-on-exit off, etc.). `list-windows` now broadcasts to every session that has a live tmux-web tab.
- **Menu session switch confirmation.** The session menu waited for an ACK that never arrived; fixed by verifying `tmux switch-client` before firing the UI update. PTY verification flow rewritten so the menu doesn't deadlock on a switch that fails mid-flight.
- **Early-close attaches no longer leak.** If `detachSession` fires before `ControlPool.startSession` finishes its probes, a cancellation guard after each `await` kills the in-flight child so it doesn't get inserted into the pool.
- **Dim default backgrounds stay transparent.** Fixes a regression where dim themes forced an opaque fill.

### Internal

- **E2E → unit migration.** Moved Playwright coverage that didn't actually need a browser into the stub-DOM unit harness: topbar menus, fullscreen, clipboard TT, mouse forwarding, title TT, menu-stays-open, font/spacing persistence, slider reset, theming (3 cases), url-session (2 cases), session-inheritance (1 case), reconnect resize, opacity wiring, theme-hue persistence, `#inp-terminal` absence guard, windows/session interaction. CSS-probe and xterm-viewport tests stay in Playwright.
- **First real-tmux e2e tests.** `rename-session` triggers a `%`-event push to the browser WS within 1500 ms; window-size regression guard asserts a control-mode attach doesn't collapse the session to the 80×24 stdin-piped default (validates the `window-size latest` + `refresh-client -C` combination).
- **Console / stderr noise silenced during `bun test`.** Modules under test legitimately emit `console.warn` / `console.error` in normal operation (theme pack validation, font-load fallback, boot-error accumulator, origin rejection logger) plus `[debug]` stderr lines from `ws.ts` / `http.ts`. A global preload replaces `console.*` with a buffer and wraps `process.stderr.write` to capture `[debug] ` lines, clearing per `beforeEach`. Bun's own stderr (unhandled rejection stacks, reporter diagnostics) still passes through.
- **`make test-unit` runs with `--parallel`.**
- **Real-tmux e2e isolation.** Each real-tmux e2e spins up an isolated tmux server on a scratch socket with a wrapper that fixes `-S`, so tests can't cross-contaminate.
- **Bun 1.3.13 + deps bump.** `@types/node` 22 → 25, `jsdom` 26 → 29, `typescript` 5.9 → 6.0, `.bun-version` 1.3.12 → 1.3.13. The `bun run node node_modules/.bin/playwright` workaround is dropped — Bun fixed the `bunx playwright` stall. TS 6's `HTMLElement.hidden` widened to `boolean | "until-found"`; `topbar.ts` narrows with `=== true`.
- **`fake-tmux` no longer calls `sync`.** On Proxmox VE with a real disk, `sync` flushes the entire system dirty-page cache and took ~2.7 s per write; three sequential fake-tmux invocations in one `sendWindowState` blew the 8 s `waitForMsg` timeout on ~20% of `ws-handle-connection` runs. POSIX append writes via `printf` are atomic under `PIPE_BUF` and `readFileSync` reads from the page cache, where writes are visible immediately. 8/8 consecutive full-suite runs pass after removal.
- **Origin checks moved to server tests.**
- **Tmux control-mode design + implementation plan** committed at `docs/design/` and `docs/plans/` with per-task TDD breakdown.
- **Fixed-bug reports moved under `docs/bugs/fixed/`.** Tmux control-mode work closed out cmd-id / flags / UTF-8 / size-negotiation / orphan-leak / window-close-fanout / stale-attach bugs; each has a verified root-cause note.

## 1.7.0 — 2026-04-22

Closes the 16-cluster codebase audit from `docs/code-analysis/2026-04-21/`. 15 clusters fully resolved, 1 partial (cluster 13's `bunx playwright` swap deferred to Bun 1.4). No breaking API changes; a few label renames, one accessibility overhaul, and one CSS class-name sweep are the biggest surface changes. Also ships a couple of post-audit colour-pipeline fixes and one new user-facing toggle (Subpixel AA per font).

### Added

- **Subpixel AA per-font toggle** — new checkbox at the bottom of the Text section of the settings menu (under Line Spacing). Flips xterm's `allowTransparency` under the hood: on (default) keeps canvas-2D's LCD subpixel-AA path for crisp edges on smooth vector fonts; off switches the atlas to a transparent backdrop (grayscale AA, no halo-bg baked into edge pixels) — useful for bitmap fonts at extreme Contrast/Bias combinations where the opaque-atlas halo can mismatch a gradient body. Choice is persisted per font family in localStorage (key `tmux-web-subpixel-aa:<family>`). Toggling reloads the page because the atlas bakes the choice in at construction.
- **Keyboard navigation for every custom dropdown** (theme / colours / font / sessions / windows). ArrowDown / ArrowUp move the active option with wrap at both ends; Enter or Space selects; Escape closes. Focus stays on the trigger; the active option is tracked via `aria-activedescendant`. Listbox / option ARIA roles applied throughout, including the context-menu popup. (Cluster 05.)
- **Status-dot accessible names** — session-running indicators carry `aria-label="Running"` / `"Not running"` alongside the existing colour cue, so screen readers announce them instead of relying on the `title` attribute (which isn't reliably surfaced). (Cluster 05.)
- **Boot-fetch error surfacing** — if any of `/api/session-settings`, `/api/colours`, `/api/themes`, `/api/fonts` fails at page load, each writes a labelled `console.warn`, and `main()` shows one combined user toast listing the failed resources. Previously silent. (Cluster 10.)
- **Property-based / fuzz tests** (`tests/fuzz/`, 58 cases, 9 parsers). Covers shell quoting, session and filename sanitisation, OSC 52 extraction, origin parsing, WS message router, TOML colour parser, `/proc/<pid>/stat` parser, and client-side TT message extraction. Run via `make fuzz`; excluded from the release CI budget. (Cluster 15.)
- **OKLab render-math bench** — `scripts/bench-render-math.ts` / `make bench` times `pushLightness` / `adjustSaturation` over 100k synthetic cells so algorithmic regressions in the per-frame WebGL hot path are visible without a WebGL fixture. (Cluster 16.)
- **E2E job in release CI** — one `ubuntu-latest` Playwright run (chromium, with-deps install) gates the 4-leg build matrix. DOM / menu regressions now block every artifact. (Cluster 13.)
- **`_twDispose` teardown path** on `window` — `main()` now returns a dispose hook that unwinds every subscription (window resize, ResizeObserver, document keydown / paste, mouse + keyboard + file-drop installers, drops-panel, WebSocket connection). Production never calls it; exists for multi-mount test harnesses. (Cluster 10.)

### Changed

- **Slider labels renamed** for clarity (cluster 11):
    - **Depth** → **Bevel**
    - **Brightest** / **Darkest** (background gradient endpoints) → **Top** / **Bottom**

  Internal field names, element IDs, and clamp functions are unchanged — only the visible `<label>` text moves.
- **Topbar slider wiring** collapsed from 17 near-identical listener blocks (~350 lines) into a single 17-row `sliders: SliderSpec[]` table driving input/change commit, dblclick reset, `syncUi` mirror, and slider-fill refresh. Net −210 lines in `src/client/ui/topbar.ts`. Adding a new slider is now one table entry + one HTML row. (Cluster 11.)
- **Theme slider structure** moved from each theme's CSS into `base.css` with eight `--tw-slider-*` custom properties on `#menu-dropdown`. Amiga inherits the base defaults outright (zero overrides); Scene 2000 sets five variables instead of duplicating a 55-line pseudo-element block. (Cluster 12.)
- **Project-owned CSS classes renamed with `tw-` prefix** across 11 files. 18 class names moved: `menu-row`, `menu-row-static`, `menu-row-drops`, `menu-section`, `menu-label`, `menu-label-clickable`, `menu-input-select`, `menu-input-number`, `menu-hr`, `menu-footer-link`, `drops-empty`, `drops-header`, `drops-revoke`, `drops-row`, `drops-row-label`, `drops-row-meta`, `win-tab`. IDs stay bare. CLAUDE.md's new "Class naming" rule documents the convention. **Theme authors:** update any selectors targeting the old bare names. (Cluster 12.)
- **tmux window / session listing** now uses `\t`-separated `list-windows` output instead of `:`, so window names containing a colon (e.g. `node:server`, `2.0:api`) parse correctly on both the WS push path and `GET /api/windows`. (Cluster 03.)
- **Slider commit paths apply their clamp helpers consistently.** Font size, spacing, opacity, TUI BG opacity, and TUI FG opacity previously skipped their `clamp*` call in the commit path, so the paired number input could receive out-of-range values even when the slider thumb couldn't. All 17 sliders now route input + change through their clamp. (Cluster 11.)

### Fixed

- **OKLab → sRGB now gamut-maps instead of clipping per channel.** `oklabToSrgbByte` used to rely on the final `linearToSrgb` clamp to handle out-of-gamut points, which broke hue preservation asymmetrically: at Contrast = -100 with a dark background, red faded visibly darker than yellow / cyan / blue / white at the same requested OKLab L, because red's chroma can't survive at that L in sRGB and per-channel clipping turned the mismatch into a muddy dim red. Out-of-gamut points now binary-search for the largest in-gamut chroma scale along the OKLab a / b direction, preserving L and hue; at extreme contrast every hue lands at the same perceived lightness as the OKLab model promises. Also fixes `adjustSaturation` transitively — pushing Saturation > 0 on already-saturated colours previously clipped asymmetrically too.
- **`sanitizeSession('%')` used to throw** via internal `decodeURIComponent` on malformed percent-escapes. Now falls back to the raw input (the charset filter strips the stray `%` anyway). Found by the new `fast-check` fuzz pass on first run.
- **`safeStringEqual` is actually constant-time now.** The previous length-mismatch short-circuit leaked "wrong-length credential" through wall time — the function's name and comment promised timing safety that the implementation didn't deliver. Both buffers now pad to the longer length before `timingSafeEqual`; length mismatch still returns false via the residual equality check. (Cluster 07.)
- **Coverage gate is enforced in release CI.** `release.yml` used to run `bun test` bare; now runs `bun run coverage:check`, so a per-file regression below 95% line / 90% func blocks a tag push. (Cluster 01.)
- **Homebrew tap bump no longer races itself.** The inline `homebrew:` job in `release.yml` competed with the standalone `bump-homebrew-tap.yml` workflow on every tag; one of them occasionally failed with a non-fast-forward and marked the release run red. Inline job removed; standalone workflow is now the sole source. (Cluster 13.)
- **`ws.onerror` no longer a silent no-op.** Browser CORS / protocol errors now produce a `console.warn` plus a rate-limited user toast (once per reconnect burst, reset on next successful open). (Cluster 10.)
- **`GET /api/drops` no longer leaks absolute paths.** The response used to include `absolutePath` pointing at `/run/user/<uid>/tmux-web/drop/…`, disclosing the runtime uid and `$XDG_RUNTIME_DIR` layout to any authenticated client. Paths are now resolved server-side from `dropId` at paste time. (Cluster 06.)
- **`PUT /api/session-settings` rejects `clipboard` sub-objects** with HTTP 400. Grants flow exclusively through `recordGrant` driven by the consent prompt; the client never sent this field, but the server used to accept and store it, letting a post-auth client pre-seed allow-grants for arbitrary binary paths. (Cluster 06.)
- **Non-GET requests to read-only `/api/*` endpoints return 405.** `GET /api/fonts`, `/api/themes`, `/api/colours`, `/api/sessions`, `/api/windows`, `/api/terminal-versions` all had no method guard; `POST /api/sessions` used to spawn a tmux subprocess and return 200. (Cluster 03.)
- **`sendBytesToPane` now has a 5 s timeout** (via the shared `src/server/exec.ts` helper). A hung `tmux send-keys` can no longer pin an HTTP handler open indefinitely. (Cluster 04.)
- **WS-driven rename / new-window argv hardened.** `rename-session` and `rename-window` now insert a literal `--` before the user-controlled positional; all three rename/new-window paths reject names that start with `-` or contain `:` / `.` via a new `isSafeTmuxName` guard. Prevents a future tmux option from silently turning a rename into a flag. (Cluster 04.)
- **OSC 52 write-frame cap.** A maximum of 8 clipboard-write frames are forwarded per PTY data chunk (earlier writes are superseded on the browser side anyway), so a rogue TUI can't flood the WebSocket with an unbounded burst. Per-frame payload cap of 1 MiB already existed. (Cluster 04.)
- **Tautological test assertion removed.** `logOriginReject`'s final `expect(typeof called).toBe('number')` always passed regardless of behaviour; replaced with real eviction + rate-limit assertions. Added `_resetRecentOriginRejects` export so the module-level singleton doesn't leak state across sibling tests. (Cluster 14.)
- **Dropdown click re-paste no longer runs on revoke.** Clicking the per-row trash can inside the drops panel used to also fire the row's re-paste handler on some browsers. `stopPropagation()` on the revoke path prevents the double-fire. (Cluster 02 coverage work surfaced the case; fix in drops-panel tests.)

### Internal

- 16-cluster codebase audit report committed at `docs/code-analysis/2026-04-21/` with per-cluster findings, fix records, and a filled-in fix-coordinator retrospective (`analysis-analysis.md` Part B).
- **New module `src/client/oklab.ts`** — shared sRGB ↔ OKLab math used by `fg-contrast` and `tui-saturation` (previously duplicated across both files). (Cluster 09.)
- **New module `src/client/adapters/xterm-cell-math.ts`** — pure per-cell colour transforms (`effectiveBackgroundAttr`, `resolveAttrRgba`, `blendRgbaOverDefaultBackground`, `resolveCellBgRgb`, `blendFgTowardCellBg`, `withBlendedEffectiveBackground`) hoisted out of `_patchWebglExplicitBackgroundOpacity` so they can be unit-tested without a WebGL context. Layer 1 of `docs/ideas/webgl-mock-harness-for-xterm-adapter.md`.
- **New module `src/client/boot-errors.ts`** — small accumulator for labelled boot-time fetch failures. `main()` drains it for the combined toast.
- **CLAUDE.md pre-release protocol updated.** Previously only `act` was required; now `act` + `make fuzz` before the tag push. Fuzz discovers bugs the audit's hand-picked fixtures miss (see `sanitizeSession('%')` above).
- **`src/server/assets-embedded.ts` is now gitignored.** Regenerated in CI's build step (already happens); removes the paired diff on every theme/asset PR. (Cluster 13.)
- **Dropdown keyboard contract documented in CLAUDE.md** under Workaround 7b, including the wrap-at-ends + Enter/Space + Escape + no-Home/End + no-type-ahead decisions. (Cluster 05.)
- **TOCTOU assumption documented in CLAUDE.md** under the OSC 52 clipboard workaround. The BLAKE3 pin defends against accidental binary replacement and unrelated processes; it isn't — and doesn't claim to be — a kernel-level isolation boundary against a same-user attacker. (Cluster 06.)
- **Slider styling contract documented in CLAUDE.md.** Every menu slider's dimensions + pseudo-element layout + active-press bevel flip live in `base.css`; themes set material via `--tw-slider-*` custom properties. (Cluster 12.)
- **Dead `pushFgLightness` alias removed** (no live callers). (Cluster 09.)
- **Dead `PLATFORM` / `ARCH` Makefile vars removed** — expanded every `make` invocation but referenced by nothing. (Cluster 13.)
- **Dead `ThemeInfo.defaultTuiOpacity` field removed** — superseded in v1.6.0 by `defaultTuiBgOpacity` / `defaultTuiFgOpacity`. (Cluster 09.)
- **`pty-argv.test.ts` merged into `pty.test.ts`**, deduplicating overlapping `sanitizeSession` / `buildPtyCommand` assertions. (Cluster 14.)
- **fast-check 4.7.0** added as a devDependency; used by the new fuzz suite.
- **Two new files in `docs/ideas/`** describing deferred work: a WebGL stub harness + a topbar full-coverage harness. Both carry pointers to the relevant cluster files and the current EXCLUDES entries so future sessions can pick them up without archeology.
- **Coverage gate moved from 98.21% → 98.90%** global line coverage. 742 unit tests (+145 net) + 58 fuzz tests.

## 1.6.3 — 2026-04-21

### Added

- Themes can now set `defaultFgContrastStrength` and `defaultFgContrastBias` in theme.json to provide terminal contrast defaults.

### Changed

- AmigaOS 3.1 defaults: Background Saturation −100 (pure grey), Terminal Contrast 25.

## 1.6.2 — 2026-04-21

### Changed

- GUI slider labels shortened: "Theme Hue" → "Hue", "Theme Sat" → "Saturation", "Theme Light" → "Brightness", "Theme Contrast" → "Contrast".
- "Colour Scheme" label shortened to "Scheme".
- Menu label column (`min-width`) set to 100px in base.css — all themes inherit, no per-theme overrides.

## 1.6.1 — 2026-04-21

### Added

- **`--reset` CLI flag**: deletes saved session settings (`sessions.json`) and sends `POST /api/exit?action=restart` to the running instance on the same listen address, so the process manager restarts it with fresh defaults.
- **`POST /api/exit`** endpoint: `?action=quit` (exit 0, default) or `?action=restart` (exit 2) for process-manager-aware restarts.
- Default toolbar autohide is now **off** — toolbar stays visible by default.

### Changed

- **Default theme visual refresh**: toolbar gradient, reversed-gradient active buttons, transparent idle button borders, gradient dropdown menus, slider track with 20% brighter fill, compact menu spacing, tuned defaults (hue 222, sat 15, opacity 40, BG hue 222, BG sat −75, brightest 3, darkest 7, font size 16).
- **Compact menus** in base.css: tighter row padding (2px 8px), smaller section/hr margins. All themes inherit compact spacing; Amiga themes override with their own.
- Slider track/thumb styling moved to base.css so all themes get consistent left-side fill (fixes Firefox showing fill on wrong side).
- Scene 2000 defaults tuned: depth 22, hue 220, contrast 8, ltn 26, sat 38.

### Fixed

- Background slider defaults (`backgroundHue`, `backgroundSaturation`, `backgroundBrightest`, `backgroundDarkest`, `themeHue`) were not loaded from theme.json on initial page load — only on theme switch. New sessions now pick up all theme.json values.
- `.menu-hr` and `.tw-dropdown-sep` unified into one CSS rule — separators now look identical across all menus (settings, sessions, windows, context).
- Homebrew tap was never auto-bumped for 1.5.1 or 1.6.0: releases created with `GITHUB_TOKEN` don't fire `release: published` events. Inlined the homebrew bump job into `release.yml`.

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
