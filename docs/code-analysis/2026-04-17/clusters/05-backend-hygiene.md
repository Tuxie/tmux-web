# Cluster 05 — backend-hygiene

> **Goal:** Tighten async hygiene, input guards, dead-code removal, and resource-permissions consistency in the server.
>
> Session size: Small · Analysts: Backend · Depends on: none

## Files touched

- `src/server/ws.ts` (1 finding)
- `src/server/http.ts` (3 findings)
- `src/server/themes.ts` (2 findings)
- `src/server/index.ts` (1 finding)
- `src/server/colours.ts` / `src/server/file-drop.ts` / `src/server/ws.ts` (1 shared type-hygiene finding)
- (various) (1 subprocess-timeout finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 2 · Low: 6
- autofix-ready: 4 · needs-decision: 4 · needs-spec: 0

## Findings

- **Floating async call: `sendWindowState` return value discarded** — `sendWindowState` is `async ... Promise<void>` (ws.ts:160) and is called without `void` or `await` at ws.ts:321. A rejection from either of the two `execFileAsync` calls inside (tmux missing, killed session) becomes an unhandled rejection. The `.then()`-chained call at ws.ts:348 is fine — only line 321 is affected.
  - Location: `src/server/ws.ts:321`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `async-hygiene`
  - Raised by: Backend
  - Fix: `void sendWindowState(ws, lastSession, config);`

- **`/api/session-settings` PUT body read has no error handling and no size cap** — The `for await (const chunk of req)` loop at http.ts:447 sits outside any try/catch, so a broken HTTP stream becomes an unhandled rejection in the async handler. There is no `MAX_*_BYTES` guard (contrast `/api/drop` which applies `MAX_DROP_BYTES = 50 MiB`). Sessions data is small in practice, but an authenticated client can upload unbounded bytes here.
  - Location: `src/server/http.ts:447`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `input-guard`
  - Raised by: Backend
  - Notes: Apply the same `try/catch` + `Content-Length`-aware cap pattern used by the drop handler at http.ts:381-394. A 1 MiB cap is overwhelmingly generous for the sessions schema.

- **`listColours` reads all `.toml` files from disk synchronously on every `/api/colours` request** — `listColours` (themes.ts:140) calls `fs.readFileSync` for each colour entry across all packs each call. With the default pack's ~10 colour files this is 10 sync disk reads per request. `packs` is computed once at handler init but the parsed `ITheme[]` is not cached.
  - Location: `src/server/themes.ts:140-171`, `src/server/http.ts:213`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `perf-cache`
  - Raised by: Backend
  - Notes: `listThemes` and `listFonts` are pure in-memory over already-loaded `packs`. Compute `ColourInfo[]` once at `createHttpHandler` init time, or memoize inside the module.

- **`as any` casts without justification comments** — Server-side: `colours.ts:18` (Bun TOML type), `colours.ts:32,34` (ITheme index), `file-drop.ts:214` (writeSync overload), `ws.ts:40,196` (`Duplex` vs `net.Socket`). All are real type gaps with pragmatic justification but none carry a `// safe: …` comment.
  - Location: `src/server/colours.ts:18`, `src/server/colours.ts:32`, `src/server/colours.ts:34`, `src/server/file-drop.ts:214`, `src/server/ws.ts:40`, `src/server/ws.ts:196`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `type-hygiene`
  - Raised by: Backend
  - Fix: Add `// safe: <reason>` comments. `colours.ts:32,34` can additionally switch to `(out as Record<string, string>)[key]` instead of `any`.

- **`--terminal` compatibility shim parsed and silently ignored** — `index.ts:52-54` registers a `--terminal` string option only to keep legacy callers from tripping `parseArgs` strict mode. `args.terminal` is never read. Introduced 2 days ago per `git log`; no tracking of when the shim will be removed.
  - Location: `src/server/index.ts:52-54`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `dead-code`
  - Raised by: Backend
  - Notes: Add a CHANGELOG entry targeting removal in the next minor release, or drop it now if no caller still sets it.

- **`resolveTheme` exported but unused in production code** — `themes.ts:173-175` exports `resolveTheme` which is only imported by unit tests. No HTTP route or WS handler uses it; the CLI `--theme` flag sets `config.theme` but nothing on the server applies it through `resolveTheme`.
  - Location: `src/server/themes.ts:173`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `dead-code`
  - Raised by: Backend
  - Notes: Either wire the CLI `--theme` through it (so the flag actually chooses a default pack at startup), or delete it and its unit coverage. Decision, not mechanical.

- **No timeout on any `execFileAsync` subprocess call** — All tmux subcommand wrappers omit `{ timeout: N }`. A hung tmux holds the HTTP or WS handler open indefinitely. `applyColourVariant` already carries a manual 500 ms retry, evidence that the race is known.
  - Location: `src/server/http.ts:262`, `src/server/http.ts:276`, `src/server/ws.ts:87`, `src/server/ws.ts:90`, `src/server/ws.ts:114`, `src/server/ws.ts:121`, `src/server/ws.ts:126`, `src/server/ws.ts:130`, `src/server/ws.ts:150`, `src/server/ws.ts:151`, `src/server/ws.ts:163`, `src/server/ws.ts:166`, `src/server/foreground-process.ts:30`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `missing-timeout`
  - Raised by: Backend
  - Notes: Settle on a default (5000 ms is reasonable for all tmux subcommands) and thread it through the wrapper, or add it at each call site.

- **`materializeBundledThemes` temp dirs created without restrictive permissions** — `http.ts:84` calls `mkdirSync(..., { recursive: true })` without `mode: 0o700`. Contrast with `file-drop.ts` which consistently uses `0o700` / `0o600`. Font and theme files are extracted with default umask, making them world-readable on shared hosts.
  - Location: `src/server/http.ts:84`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `file-perms`
  - Raised by: Backend
  - Fix: `fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });`

## Suggested session approach

Split into a mechanical pass (floating-async, file-perms, `as any` comments, session-settings cap) and a small design pass (the two `dead-code` items and the subprocess-timeout default). The mechanical pass can be a subagent one-shot. The design pass is 5 minutes of decisions plus the edits.
