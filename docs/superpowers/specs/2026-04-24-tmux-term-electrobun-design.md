# tmux-term Electrobun Desktop Wrapper Design

## Goal

Add an optional Electrobun desktop application named `tmux-term` that runs
the existing tmux-web experience in its own native application window. The
first version is a pragmatic localhost wrapper around the existing tmux-web
server, not a rewrite of the client or server transport.

`tmux-web` remains the browser/server product. Its CLI, systemd service use,
default TLS/auth behavior, release binary, and browser access path stay
unchanged.

## Non-Goals

- Replacing tmux-web's browser mode.
- Forking the client UI or creating a second terminal frontend.
- Implementing Electrobun internal IPC for HTTP/WebSocket replacement in the
  first version.
- Adding remote desktop access, multi-user access, or network-facing listener
  behavior to `tmux-term`.
- Using Electrobun beta releases unless a later implementation note identifies
  a blocking stable-release defect.

## Product Shape

`tmux-term` is a second product artifact built from this repo. It opens a
native Electrobun window and points it at a private tmux-web server started
for that desktop app instance.

The app should look and behave like tmux-web already does. Any user-visible
changes should be limited to native app packaging and window lifecycle.

Supported first-pass platforms:

- macOS
- Linux

Electrobun native webview is the default. CEF is not part of the first design;
it becomes an option only if native webview cannot reliably render tmux-web's
WebGL-only xterm.js renderer.

## Electrobun Version

As of 2026-04-24, `electrobun@1.16.0` is the latest stable npm package. The
GitHub releases page lists newer `v1.17.3-beta.*` prereleases, but the first
implementation should use the stable npm version.

Pin the dependency exactly:

```json
"electrobun": "1.16.0"
```

Do not use `latest` or a caret range. Before implementation starts, re-check
the npm registry in case a newer stable version has been published.

References checked during brainstorming:

- `https://registry.npmjs.org/electrobun/latest`
- `https://github.com/blackboardsh/electrobun/releases`
- `https://www.electrobun.dev/docs/guides/Architecture/Overview`
- `https://electrobun.dev/docs/guides/distributing`

## Runtime Architecture

Add a desktop entrypoint under a new desktop-owned area such as
`src/desktop/`. That code owns application lifecycle only:

1. Ask the OS for an ephemeral loopback port, preferably by passing port `0`
   to tmux-web.
2. Generate high-entropy Basic Auth credentials for this launch.
3. Start tmux-web on `127.0.0.1:<port>`.
4. Open an Electrobun window to the authenticated localhost URL.
5. Shut down tmux-web when the app/window exits.
6. Shut down the app if the tmux-web child exits unexpectedly.

The tmux-web child process should receive arguments equivalent to:

```bash
tmux-web \
  --listen 127.0.0.1:0 \
  --username <generated-user> \
  --password <generated-password> \
  --no-tls
```

Prefer asking the OS for the port with `--listen 127.0.0.1:0`, then parse the
actual listening URL from tmux-web's startup output. This avoids a
check-then-bind race. If Bun or tmux-web cannot support port `0` cleanly, the
implementation plan may use a preselected free port, but must start the server
immediately after selection and handle bind failure by retrying with a new
port.

After the actual port is known, include an explicit allow-origin value if
needed:

```bash
--allow-origin http://127.0.0.1:<actual-port>
```

The opened URL is:

```text
http://<generated-user>:<generated-password>@127.0.0.1:<ephemeral-port>/
```

The implementation may omit `--allow-origin` only if verification shows the
Electrobun native webview does not send Origin headers that tmux-web rejects.
If there is any doubt, include the explicit localhost origin.

The server should be launched as a child process first. That matches the
current `src/server/index.ts` process-oriented entrypoint and keeps server
cleanup behavior independent from the desktop shell. In-process hosting can be
considered later only if Electrobun packaging makes a child server artifact
impractical.

## Server And Client Reuse

The existing tmux-web code remains the source of truth for:

- PTY spawning and tmux lifecycle.
- tmux control-mode session/window state.
- HTTP API behavior.
- WebSocket terminal stream behavior.
- OSC 52 clipboard behavior.
- File drops and paste injection.
- Theme packs, fonts, colours, and session settings.
- Vendored xterm.js build and WebGL renderer patches.

The first desktop version should avoid client changes. If the Electrobun
webview exposes a browser compatibility issue, fix that narrowly in the
existing client code and cover it with tests.

## Security Model

`tmux-term` is local-only but still authenticated.

Requirements:

- Bind only to `127.0.0.1`.
- Never bind to `0.0.0.0`.
- Use an OS-assigned ephemeral port when supported; otherwise retry safely on
  bind failure.
- Keep tmux-web Basic Auth enabled.
- Generate a cryptographically random username and password per app launch.
- Do not log the generated password or the fully authenticated URL.
- Use `--no-tls` for the local loopback hop to avoid certificate prompts.
- Terminate the server child when the desktop app exits.

The random Basic Auth secret prevents unrelated local processes from casually
curling the desktop server. This is not a strong boundary against malicious
same-user code that can inspect process arguments or the app process, and the
documentation should not claim otherwise.

## Build Integration

The desktop build is additive.

Existing targets and release behavior remain unchanged:

- `make build`
- `make tmux-web`
- `make test`
- current release workflow semantics
- vendored `vendor/xterm.js` requirement and sentinel verification

Add separate desktop build wiring, for example:

- `make tmux-term`
- `bun run desktop:build`
- `bun run desktop:dev`

The desktop target depends on the same client build path as tmux-web. The
release binary must still embed the xterm.js bundle produced from
`vendor/xterm.js`; no npm xterm fallback is allowed.

Packaging should prefer including or invoking the compiled `tmux-web` server
binary from the desktop app. If Electrobun packaging makes that awkward, the
implementation plan may choose a Bun-script child process path for the first
local build, but the design preference remains a desktop shell plus existing
server artifact.

Release workflow changes should be a follow-up after local macOS and Linux
desktop builds and smoke tests are working. Do not disturb the current
tmux-web release pipeline while proving out the desktop target.

## Testing And Verification

Unit tests should cover desktop-owned logic:

- Credentials are generated with cryptographic randomness and are not constant.
- Server arguments bind to `127.0.0.1`, include Basic Auth, include `--no-tls`,
  and do not expose wildcard network access.
- Port selection uses `127.0.0.1:0` where supported, or retries safely after
  bind failure.
- Authenticated URL construction is correct.
- Child-process lifecycle code terminates the server on app shutdown.
- Unexpected server exit closes or fails the app cleanly.

Integration or smoke tests should cover:

- Starting the wrapper in a test-friendly mode launches tmux-web on loopback.
- The loaded page can authenticate successfully.
- Existing server/client tests still pass.

Manual verification is required for the first implementation:

- macOS native webview renders the terminal using WebGL.
- Linux native webview renders the terminal using WebGL.
- The app exits cleanly without leaving a tmux-web child process behind.
- A request without the generated Basic Auth credentials is rejected.

If native webview cannot render xterm.js WebGL reliably on either macOS or
Linux, file a bug report under `docs/bugs/` with the platform, Electrobun
version, observed failure, and reproduction steps before considering CEF.

## Future Work

A later version can replace the localhost HTTP/WebSocket boundary with
Electrobun internal IPC. That work should be designed separately because it
requires a transport abstraction across the client and server:

- client fetch/WebSocket adapters;
- desktop RPC handlers;
- shared service extraction from HTTP handlers;
- test coverage proving browser and desktop transports behave the same.

The loopback wrapper should not add abstractions solely for that future work.
Keep the first version small and reversible.
