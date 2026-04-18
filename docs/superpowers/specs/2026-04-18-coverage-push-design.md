# Coverage Push — Design

Goal: raise `bun test --coverage` line coverage from ~69 % to ≥ 95 %
overall without degrading the architecture. Where a module resists
testing, refactor it into (pure core + thin IO shell) rather than
stretch tests into the shell.

## Scope

In-scope modules (must hit ~100 % lines, subject to thin-shell
carve-outs documented per module):

- `src/server/ws.ts`
- `src/server/pty.ts`
- `src/server/http.ts`
- `src/server/exec.ts`
- `src/server/foreground-process.ts`
- `src/server/file-drop.ts` (residual gaps)
- `src/server/origin.ts` (residual gaps)
- `src/server/themes.ts` (residual gaps)
- `src/server/clipboard-policy.ts` (residual gaps)
- `src/client/protocol.ts` (already 100 %)
- `src/client/colours.ts` (residual gaps)
- `src/client/theme.ts` (residual gaps)
- `src/client/prefs.ts`
- `src/client/session-settings.ts`
- `src/client/ui/keyboard.ts` (residual gaps)
- `src/client/ui/mouse.ts`
- `src/client/ui/clipboard.ts`
- `src/client/ui/clipboard-prompt.ts`
- `src/client/ui/file-drop.ts`
- `src/client/ui/topbar.ts`
- `src/client/ui/drops-panel.ts`

Out-of-scope (excluded from the coverage target — too thin, pure
bootstrap, generated, or IO-bound past the useful-test boundary):

- `src/server/index.ts` — CLI arg parse + `Bun.serve` bootstrap.
- `src/client/index.ts` — browser entry wiring.
- `src/client/adapters/xterm.ts` — thin xterm.js wrapper, relies on
  vendored xterm DOM renderer.
- `src/server/assets-embedded.ts` — generated at build time.
- `src/server/tls.ts` — already 100 %; kept in-scope by default.

Exclusions are enforced via explicit path filters in a new
`scripts/check-coverage.ts` (described below), not via source-level
`istanbul ignore` comments — keeps source clean and makes the policy
visible in one place.

## Approach

### 1. Pure-core / thin-shell refactors

For each module that currently mixes decision logic with IO, split it:

**`src/server/ws.ts` → `src/server/ws-router.ts` + `src/server/ws.ts`**

- `ws-router.ts` (pure): takes an inbound client message plus session
  state and returns a list of `WsAction` union values
  (`{type:'spawn',…}`, `{type:'write',data}`, `{type:'resize',cols,rows}`,
  `{type:'select-window',index}`, `{type:'clipboard-reply',…}`, etc.).
  No `Bun.spawn`, no socket writes, no timers.
- `ws.ts`: thin dispatcher that translates each `WsAction` into real
  PTY / socket / tmux-inject calls. Keeps the socket lifecycle
  (`open` / `close` / `ping`), because that genuinely needs a live
  connection.

Tests: exhaustive unit tests on the router (every message shape,
every malformed-input branch). One integration test per glue path
(see §2).

**`src/server/pty.ts` → pure `buildTmuxArgv()` + thin `spawnPty()`**

- Pure helper returns `{file, args, env}` for a given session /
  config / tmux-conf combination. Unit-test every branch (custom
  conf path, `--tmux` override, session attach vs new-session, test
  mode).
- `spawnPty` remains the only thing calling `Bun.spawn`. One
  integration test covers it with a fake `tmux` shell script.

**`src/server/exec.ts` + `src/server/foreground-process.ts`**

- `exec.ts` exposes `execCapture(argv): Promise<{stdout,stderr,code}>`
  and becomes a one-line wrapper around `Bun.spawn`. It is the only
  IO surface; everything else injects it.
- `foreground-process.ts` splits into:
  - `parseForegroundFromProc(stat: string, status: string, exe: string
    | null): ForegroundProcess` — pure, exhaustively tested.
  - `getForegroundProcess(pid, deps = {exec: execCapture, readFile,
    readlink})` — thin orchestrator using injected deps. Unit-tested
    with fake deps; one integration test optional.

**`src/client/ui/file-drop.ts`**

- Split URL/path-building + multi-file coalescing logic into a pure
  `buildDropPayload(files, foregroundIsShell)` helper. UI glue keeps
  the `dragover` / `drop` / `paste` listeners and calls the pure
  helper. Unit-test the helper exhaustively and the listener glue
  via DOM stubs.

**`src/client/ui/mouse.ts`**

- Extract pure `encodeMouseEvent(ev, kind): string | null`
  (handles SGR format, motion bit, shift bypass). Tests drive it
  with event-shaped literals; the document-level listener glue
  gets a single stub-DOM smoke test.

**`src/client/prefs.ts`, `src/client/session-settings.ts`**

- Refactor: extract pure merge/derive helpers where present; cover
  the `fetch`-wrapping shell with the existing fake-fetch pattern.

### 2. Integration harnesses

Two new small harnesses in `tests/unit/server/_harness/`:

**`fake-tmux.ts`** — builds a temp directory containing a shell
script that behaves enough like `tmux` to exercise our calls:
`list-sessions`, `list-windows`, `select-window`, `send-keys -H`,
`new-session`, attach. Used by the pty + ws integration tests.

**`spawn-server.ts`** — starts `http.ts` on an ephemeral port with
`--test --no-auth --no-tls`, returns `{url, wsUrl, close()}`. Covers
the socket-lifecycle paths and the static-serve paths not hit by
existing API tests.

Integration tests stay minimal — one end-to-end happy-path per
glue, plus reconnect/resize and socket-close. The router tests
carry the combinatorial weight.

### 3. Residual branch tests (no refactor)

Modules where coverage gaps are just missing cases:

- `http.ts` — static file 200/404, auth 401, session 302, TLS
  header passthrough, origin reject, IP reject, malformed
  `/api/*` payloads.
- `origin.ts`, `themes.ts`, `clipboard-policy.ts`, `file-drop.ts`,
  `colours.ts`, `theme.ts`, `keyboard.ts`, `clipboard.ts` —
  drive remaining branches via the existing test patterns.

### 4. Coverage policy + enforcement

Add `scripts/check-coverage.ts`:

- Runs `bun test --coverage --coverage-reporter=lcov
  --coverage-dir=coverage` (Bun supports lcov output).
- Parses `coverage/lcov.info`, applies the exclusion list from a
  single `COVERAGE_EXCLUDES` constant.
- Fails with a readable diff if any in-scope file drops below a
  per-file threshold (default 95 % lines, 90 % funcs) or if the
  aggregate drops below 95 % lines.
- Wired as `bun run coverage:check` and added to `make test`.

## Client DOM test convention

Keep the hand-rolled stub style used by existing client tests.
Factor the recurring boilerplate into
`tests/unit/client/_dom.ts` exporting `setupDom({fetch?, clipboard?,
elements?})`. Each test composes on top. No jsdom.

## File inventory (new / renamed)

- `src/server/ws-router.ts` (new, pure)
- `src/server/ws.ts` (reduced to glue)
- `src/server/pty.ts` (exports new pure `buildTmuxArgv`)
- `src/server/foreground-process.ts` (split; pure `parseForegroundFromProc`)
- `src/client/ui/file-drop.ts` (exports pure `buildDropPayload`)
- `src/client/ui/mouse.ts` (exports pure `encodeMouseEvent`)
- `tests/unit/client/_dom.ts` (shared DOM stub helper)
- `tests/unit/server/_harness/fake-tmux.ts`
- `tests/unit/server/_harness/spawn-server.ts`
- `tests/unit/server/ws-router.test.ts`
- `tests/unit/server/ws-integration.test.ts`
- `tests/unit/server/pty-argv.test.ts`
- `tests/unit/server/pty-integration.test.ts`
- `tests/unit/server/foreground-process.test.ts`
- `tests/unit/server/exec.test.ts`
- `tests/unit/server/http-static.test.ts`
- `tests/unit/server/http-auth-paths.test.ts`
- `tests/unit/client/ui/mouse.test.ts`
- `tests/unit/client/ui/file-drop.test.ts`
- `tests/unit/client/ui/clipboard.test.ts`
- `tests/unit/client/ui/clipboard-prompt.test.ts`
- `tests/unit/client/ui/topbar.test.ts`
- `tests/unit/client/ui/drops-panel.test.ts`
- `tests/unit/client/prefs.test.ts`
- `scripts/check-coverage.ts`

## Success criteria

1. `bun test` all-green.
2. `bun run coverage:check` reports ≥ 95 % lines and ≥ 90 % funcs
   across in-scope files, and every in-scope file individually
   ≥ 95 % lines.
3. `ws.ts`, `pty.ts`, `foreground-process.ts` lose their current
   low-coverage status by virtue of the pure-core refactor, not
   by loosening the threshold.
4. No test modifies, weakens, deletes, or bypasses existing
   behavior coverage (per CLAUDE.md test policy).
5. Playwright E2E suite still all-green after refactors.
6. `act -j build --matrix name:linux-x64` release check still
   green (vendor-xterm sentinel untouched).

## Out of scope

- Adding new product features.
- E2E coverage (Playwright remains functional-only).
- Mutation testing / branch coverage tooling.
- Coverage for generated assets, CLI bootstrap, or the vendored
  xterm adapter wrapper.

## Risks / tradeoffs

- **Router extraction for `ws.ts`** introduces an extra module
  boundary. Mitigated: the router mirrors the message-type enum,
  so the split is natural; the glue remains the single place that
  touches `Bun.spawn` + sockets.
- **Injected `exec`** makes call sites slightly more verbose.
  Mitigated: a module-local default argument keeps consumers
  unchanged outside tests.
- **Fake tmux script** could diverge from real tmux behaviour.
  Mitigated: the script only implements the narrow surface we
  call, and the real-tmux E2E suite still exercises the
  integration.
- **lcov parsing** in `check-coverage.ts` is an extra dep-free
  script. If Bun's lcov output format changes, the script may
  need an update — acceptable maintenance cost.
