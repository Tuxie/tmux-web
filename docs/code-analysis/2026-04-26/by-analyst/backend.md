# Backend Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

The backend is genuinely well-structured for T2 — clean module boundaries, consistent async patterns, and the prior audits' big-ticket items (cluster-03 method guards, cluster-04 sendBytesToPane timeout, cluster-06 absolute-path leak + clipboard-grant rejection, cluster-07 safeStringEqual length-padding) are all verified in-place. The biggest live debt is the `tmux-listing-dedup` cluster: 6 near-identical inline parsers for tmux's list-sessions / list-windows / display-message output, with a real consistency bug brewing in `broadcastWindowsForSession` that skips the `.trim()` its sister functions perform. The `sanitiz` vs `sanitis` spelling split is a small cross-file naming smell. Nothing here suggests the Scout's T2 / auth-gated / local-first profile is wrong.

## Findings

(Findings here have been merged into clusters; consult the cluster index for cross-cluster context. The verbatim finding bodies are reproduced in the cluster files. This list shows analyst-native order: Severity desc → Confidence desc.)

- **Massive duplication: list-sessions / list-windows / display-message helpers exist 6 times** — `src/server/ws.ts:1071-1157` + `src/server/http.ts:387-435` — Severity Medium, Confidence Verified · → see cluster 01-tmux-control-and-listings
- **`ControlClient` decodes tmux stdout chunks as UTF-8 per-chunk, can split multi-byte sequences** — `src/server/tmux-control.ts:287-290` — Severity Low, Confidence Verified · → see cluster 01-tmux-control-and-listings
- **`broadcastWindowsForSession` re-implements list-windows tab-parsing inline** — `src/server/ws.ts:1223-1248` — Severity Low, Confidence Verified · → see cluster 01-tmux-control-and-listings
- **Session id stripping uses fragile string parsing on output that already has a structured field** — `src/server/http.ts:391`, `src/server/ws.ts:1072,1123` — Severity Low, Confidence Verified · → see cluster 01-tmux-control-and-listings
- **`broadcastSessionRefresh` iteration invariant under future async refactor** — `src/server/ws.ts:1213-1248` — Severity Low, Confidence Speculative · → see cluster 01-tmux-control-and-listings
- **Persistent self-signed cert key written without exclusive-create check** — `src/server/tls.ts:73-79` — Severity Low, Confidence Plausible · → see cluster 02-server-fs-hardening
- **OSC52 `_osc52WarnTimes` map grows unboundedly in pathological cases** — `src/server/protocol.ts:37-48` — Severity Low, Confidence Verified · → see cluster 02-server-fs-hardening
- **`logOriginReject` Map-as-LRU eviction inverts intended LRU semantics** — `src/server/origin.ts:106-119` — Severity Low, Confidence Verified · → see cluster 02-server-fs-hardening
- **Naming inconsistency: `sanitizeSession` (US) vs `sanitiseFilename`/`sanitiseSessions` (UK)** — `src/server/pty.ts:15`, `src/server/file-drop.ts:202`, `src/server/sessions-store.ts:75` — Severity Low, Confidence Verified · → see cluster 17-naming-consistency
- **`hasClipboardField` uses string parsing on a structured value when a typed schema would suffice** — `src/server/http.ts:62-73`, `src/server/sessions-store.ts:102-112` — Severity Low, Confidence Plausible · → see cluster 15-backend-low-cleanup
- **`/api/exit` schedules `process.exit` via `setTimeout(..., 100)` rather than awaiting the response flush** — `src/server/http.ts:617-623` — Severity Low, Confidence Verified · → see cluster 15-backend-low-cleanup
- **`hasInotifywait` probe runs `inotifywait --help` synchronously at startup with no timeout** — `src/server/file-drop.ts:79-89` — Severity Low, Confidence Plausible · → see cluster 15-backend-low-cleanup
- **Server boot path mixes sync and async fs reads in the hot startup path** — `src/server/http.ts:111-129` — Severity Low, Confidence Verified · → see cluster 16-theme-pack-runtime
- **`readBodyCapped` calls `reader.cancel()` inside an awaited try without a timeout** — `src/server/http.ts:233-237` — Severity Low, Confidence Speculative · → see cluster 15-backend-low-cleanup
- **`applyPatch` does read-modify-write of `sessions.json` with no concurrency guard** — `src/server/sessions-store.ts:121-126` — Severity Low, Confidence Verified · → see cluster 15-backend-low-cleanup
- **`getTerminalVersions` reads the full xterm bundle on startup to recover a SHA that exists at build time** — `src/server/http.ts:166-178` — Severity Low, Confidence Verified · → see cluster 16-theme-pack-runtime
- **`hashFile` (BLAKE3) creates a fresh hasher per call without caching by `(exePath, mtime)`** — `src/server/clipboard-policy.ts:32-40`, `src/server/hash.ts:11-18` — Severity Low, Confidence Verified · → see cluster 15-backend-low-cleanup
- **`createHttpHandler` may register multiple `process.on('exit')` listeners on test re-mount** — `src/server/http.ts:123-127` — Severity Low, Confidence Speculative · → see cluster 16-theme-pack-runtime
- **`buildPtyEnv` deletes `EDITOR` and `VISUAL` from the spawn environment but does not document why** — `src/server/pty.ts:43-46` — Severity Low, Confidence Verified · → see cluster 15-backend-low-cleanup
- **`spawnPty` ignores `Bun.spawn` errors silently** — `src/server/pty.ts:75-86`, `src/server/ws.ts:252` — Severity Low, Confidence Plausible · → see cluster 15-backend-low-cleanup

## Checklist (owned items)

- EFF-1 [x] clean — sampled 22/24 server files; no O(n²) or large-constant loops on hot paths.
- EFF-2 [x] clean — all tmux subcommands async via `tmuxControl.run` or `execFileAsync`; PTY data event-driven.
- EFF-3 [x] `src/server/file-drop.ts:115` — `pendingAutoUnlinks` Map cleared on rmDrop; test-only exports use `_` prefix.
- PERF-1 [x] `src/server/clipboard-policy.ts:32-40` — see cluster 15-backend-low-cleanup (hashFile cache).
- PERF-3 [x] clean — per-connection state cleaned by `stopAllWatchers` on exit; rate-limit maps capped.
- PERF-4 [x] clean — `sendBytesToPane` flows through `tmuxControl.run` with 5s default timeout; prior cluster-04 finding from 2026-04-21 audit verified resolved.
- PERF-5 [-] N/A — below profile threshold (project=T2); no long-running work chains in scope.
- QUAL-1 [x] `src/server/ws.ts:1071-1148` — see cluster 01-tmux-control-and-listings.
- QUAL-2 [x] clean — module boundaries are tight (single-responsibility per file).
- QUAL-3 [x] clean — consistent style except `sanitiz`/`sanitis` blip; see cluster 17-naming-consistency.
- QUAL-4 [x] clean — no over-engineered DI / plugin systems / event buses.
- QUAL-5a [x] clean — sanitisation, `isSafeTmuxName --` argv anchoring, body size caps verified.
- QUAL-5b [x] clean — external I/O wrapped in try/catch consistently.
- QUAL-5c [x] clean — fd close in `finally`, PTY killed on WS close, watchers killed on exit, TLS temp dir cleaned.
- QUAL-6 [x] clean — idiomatic Bun/Node patterns.
- QUAL-7 [x] clean — no stdlib reimplementations.
- QUAL-8 [x] clean — workarounds documented (LC_ALL force-set, tmux `-u`, OSC 52 send-keys-via-hex, etc).
- QUAL-9 [x] clean — `protocol.ts` server-side / `src/client/protocol.ts` client mirror; no cross-boundary duplication.
- QUAL-10 [x] `src/server/ws.ts:1083` — see cluster 01-tmux-control-and-listings.
- QUAL-11 [x] clean — notification surface returns structured types; parsing happens inside helpers, not at call sites.
- ERR-1 [x] clean — retry patterns appropriate (applyColourVariant, sendStartupWindowState, tmuxControl.run fallback).
- ERR-2 [x] clean — atomic `.part` → rename writes for sessions and TLS certs.
- ERR-3 [-] N/A — below profile threshold (project=T2).
- ERR-5 [x] clean — `JSON.parse` in request paths try/catched; PTY exit handled.
- CONC-1 [x] clean — per-connection state on `ws.data.state`, per-handler-instance registry; no static module-scope shared mutable state except capped rate-limit maps.
- CONC-2 [x] clean — `void` annotations are intentional fire-and-forget; each catches own errors.
- CONC-3 [x] clean — no WS connection cap; T2 absence-is-correct (auth + IP-allowlist gates real attackers).
- CONC-4 [-] N/A — below profile threshold (project=T2).
- CONC-5 [-] N/A — no lock primitives in use.
- CONC-6 [x] `src/server/sessions-store.ts:121-126` — see cluster 15-backend-low-cleanup.
- CONC-7 [x] `src/server/http.ts:620` — see cluster 15-backend-low-cleanup.
- OBS-1 [-] N/A — below profile threshold (project=T2).
- OBS-2 [-] N/A — below profile threshold (project=T2).
- OBS-3 [x] clean — no `/health` endpoint; for T2 personal-use systemd service behind auth + IP allowlist, absence is correct.
- OBS-4 [-] N/A — no telemetry emitted.
- LOG-1 [x] clean — startup failures logged before exit; origin rejects logged; OSC 52 oversized writes logged; theme-pack failures logged.
- LOG-2 [x] clean — recoverable parse failures `console.warn`; debug() with structured key=value lines for tmux command paths.
- LOG-3 [x] clean — startup listening line, reset action logs, PTY spawn at debug level.
- LOG-4 [x] clean — `[debug]` / `[themes]` / `tmux-web:` prefixes consistent.
- LOG-5 [x] clean — appropriate severity levels.
- LOG-6 [x] clean — no contradictory messages observed.
- LOG-7 [x] clean — consistent structured `key=value` format on debug lines.
- TYPE-1 [x] `src/server/colours.ts:28`, `src/server/file-drop.ts:297`, `src/server/pty.ts:76` — minor `as any` casts at unavoidable boundaries (Bun TOML.parse, fs.writeSync overload, Bun terminal env type).
- TYPE-2 [x] clean — public surfaces typed.
- TYPE-3 [x] clean — non-null assertions limited and safe.
- API-1 [-] N/A — below profile threshold (project=T2); no versioned API contract.
- API-2 [-] N/A — below profile threshold (project=T2); no OpenAPI spec.
- API-3 [x] clean — JSON responses consistent (`Content-Type: application/json` everywhere via `JSON_HEADERS`).
- API-4 [x] clean — read-only endpoints have method guards (405-on-non-GET); v1.7.0 cluster-03 fix verified.
- API-5 [x] clean — `/api/sessions` / `/api/windows` / `/api/drops` return structured projections; v1.7.0 cluster-06 absolute-path leak fix verified.
- DEP-1 [?] inconclusive — could not run `bun outdated` from this read-only analyst session; backend-only runtime dep is `@noble/hashes`. Tooling analyst owns the freshness check; deferred to them.
- DEP-2 [x] clean — no overlapping packages.
- DEP-3 [x] clean — every declared dep imported.
- DEP-4 [x] clean — `Bun.spawn`, `Bun.serve`, `node:crypto`, `node:child_process` all used appropriately.
- DEP-5 [x] clean — `execFile` over `exec`; `timingSafeEqual`; `parseArgs`; `realpathSync`; BLAKE3.
- DEP-6 [x] clean — no deprecated runtime packages.
- DEP-7 [-] N/A — no backwards-compat shims in scope.
- DEP-8 [x] clean — host deps (`inotifywait`, `openssl`, `tmux`) probed at startup with graceful fallback.
- DEP-9 [x] clean — no `peerDependencies`; runtime is Bun, declared in `.bun-version`.
- NAM-1 [x] `src/server/pty.ts:15` etc — see cluster 17-naming-consistency.
- NAM-2 [x] clean — kebab-case files, camelCase functions, PascalCase types.
- NAM-3 [x] clean — consistent prefixed type names.
- NAM-4 [x] clean — no inverted boolean flags.
- NAM-5 [x] clean — function names match what they do.
- NAM-6 [x] clean — variable names self-explanatory.
- NAM-7 [x] clean — `_` prefix for test-only exports applied consistently.
- NAM-8 [x] clean — log messages and CLI output correctly punctuated; CLI flag descriptions match README.
- DEAD-1 [x] clean — `--theme` legacy no-op documented; test-only exports intentional.
- DEAD-2 [x] clean — no `@deprecated` symbols in scope.
- COM-1 [x] clean — non-obvious code well-commented.
- COM-2 [x] clean — comments verified against code; prior `safeStringEqual` COM-3 has been fixed.
- COM-3 [x] clean — no commented-out code blocks; `safeStringEqual` comment now matches behavior.
