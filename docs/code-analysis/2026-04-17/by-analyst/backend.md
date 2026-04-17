# Backend — analyst-native output

> Preserved for traceability. For fix work use the clusters under `../clusters/`.

## Summary

The backend is well-structured and defensively coded: trust boundaries (IP allowlist, Basic Auth, path traversal guards on theme files and drop IDs) are consistently enforced, atomic file writes prevent corruption, and the PTY/WS lifecycle cleanup is thorough. The most actionable gap is the floating async call at ws.ts:321 (`sendWindowState` without `void`) and the unguarded body-stream read in the session-settings PUT handler — both are small fixes. `listColours` reading TOML files from disk on every `/api/colours` request is the main performance oversight and is trivially fixed by computing the colour list once at handler creation time alongside `packs`.

## Findings

- **Floating async call: `sendWindowState` return value discarded in `onData` handler** — `src/server/ws.ts:321` · Medium/Verified · Cluster hint: `async-hygiene` · → see cluster 05-backend-hygiene
- **`/api/session-settings` PUT body read has no error handling and no size cap** — `src/server/http.ts:447` · Medium/Verified · Cluster hint: `input-guard` · → see cluster 05-backend-hygiene
- **`listColours` reads all `.toml` files from disk synchronously on every `/api/colours` request** — `src/server/themes.ts:140-171`, `src/server/http.ts:213` · Low/Verified · Cluster hint: `perf-cache` · → see cluster 05-backend-hygiene
- **`as any` casts in server files have no justification comments** — `src/server/colours.ts:18,32,34`, `src/server/file-drop.ts:214`, `src/server/ws.ts:40,196` · Low/Verified · Cluster hint: `type-hygiene` · → see cluster 05-backend-hygiene
- **`--terminal` compatibility shim accepted but never read** — `src/server/index.ts:52-54` · Low/Verified · Cluster hint: `dead-code` · → see cluster 05-backend-hygiene
- **`resolveTheme` exported but never imported in production code** — `src/server/themes.ts:173-175` · Low/Verified · Cluster hint: `dead-code` · → see cluster 05-backend-hygiene
- **No timeout on any `execFileAsync` subprocess call** — `src/server/http.ts:262,276`, `src/server/ws.ts:87,90,114,121,126,130,150,151,163,166`, `src/server/foreground-process.ts:30` · Low/Verified · Cluster hint: `missing-timeout` · → see cluster 05-backend-hygiene
- **Plain string equality for Basic Auth credential comparison** — `src/server/http.ts:163` · Low/Verified · Cluster hint: `auth` · → see cluster 10-minor-security-hardening
- **`materializeBundledThemes` temp dirs without restrictive permissions** — `src/server/http.ts:84` · Low/Verified · Cluster hint: `file-perms` · → see cluster 05-backend-hygiene

## Checklist (owned items)

- `EFF-1 [-] N/A — below profile threshold (project=T2)`
- `EFF-2 [-] N/A — below profile threshold (project=T2)`
- `EFF-3 [-] N/A — below profile threshold (project=T2)`
- `PERF-1 [x] src/server/themes.ts:140 — listColours re-reads all .toml files from disk on every request; no cache`
- `PERF-3 [-] N/A — below profile threshold (project=T2)`
- `PERF-4 [x] src/server/http.ts:262, ws.ts:87 — no timeout option on any execFileAsync call`
- `PERF-5 [x] clean — no AbortSignal use found; all execFileAsync calls are short-lived tmux subcommands; acceptable absence for this tier`
- `QUAL-1 [-] N/A — below profile threshold (project=T2)`
- `QUAL-2 [-] N/A — below profile threshold (project=T2)`
- `QUAL-3 [-] N/A — below profile threshold (project=T2)`
- `QUAL-4 [-] N/A — below profile threshold (project=T2)`
- `QUAL-5a [-] N/A — below profile threshold (project=T2)`
- `QUAL-5b [x] src/server/http.ts:447 — session-settings PUT body read outside try/catch; stream error propagates unhandled`
- `QUAL-5c [-] N/A — below profile threshold (project=T2)`
- `QUAL-6 [-] N/A — below profile threshold (project=T2)`
- `QUAL-7 [-] N/A — below profile threshold (project=T2)`
- `QUAL-8 [-] N/A — below profile threshold (project=T2)`
- `ERR-1 [x] clean — sampled ws.ts applyColourVariant (has 500 ms retry), foreground-process.ts, http.ts; retry/backoff not applicable to these one-shot tmux commands`
- `ERR-2 [x] clean — sessions-store.ts uses atomic .part→rename; file-drop uses unique dropId per upload`
- `ERR-3 [-] N/A — below profile threshold (project=T3)`
- `ERR-5 [-] N/A — below profile threshold (project=T2)`
- `CONC-1 [-] N/A — below profile threshold (project=T2)`
- `CONC-2 [x] src/server/ws.ts:321 — sendWindowState() called without void/await`
- `CONC-3 [x] clean — sampled handleReadRequest fan-out; pendingReads Map is per-connection and bounded`
- `CONC-4 [x] clean — no AbortSignal propagation needed; ws.ts cleans up PTY on close`
- `CONC-5 [x] clean — no lock/mutex usage; single-threaded Bun event loop`
- `OBS-1 [-] N/A — below profile threshold (project=T3)`
- `OBS-2 [-] N/A — below profile threshold (project=T3)`
- `OBS-3 [x] clean — no /health endpoint; not expected for T2 personal systemd service`
- `OBS-4 [-] N/A — below profile threshold (project=T2)`
- `LOG-1..7 [x] clean — fatal paths use console.error; themes.ts uses console.warn for invalid entries; debug() helper gates on config.debug; consistent [debug] prefix`
- `TYPE-1 [x] src/server/colours.ts:18,32,34; file-drop.ts:214; ws.ts:40,196 — as any without justification comments`
- `TYPE-2 [x] clean — no public API typed as unknown/any`
- `TYPE-3 [x] clean — optional chaining traces to genuinely nullable fields`
- `API-1 [x] clean — version bump and CHANGELOG present in release commits`
- `API-2 [-] N/A — no OpenAPI spec`
- `API-3 [x] clean — JSON response shapes consistent across /api/* endpoints`
- `API-4 [x] clean — 403/401/405/404/400/413/500 statuses used correctly`
- `DEP-1..3 [-] N/A — below profile threshold (project=T2)`
- `DEP-4 [x] clean — no reimplemented cache/queue primitives`
- `DEP-5..6 [-] N/A — below profile threshold (project=T2)`
- `DEP-7 [x] src/server/index.ts:52-54 — --terminal option parsed-and-ignored as legacy shim`
- `DEP-8 [-] N/A — below profile threshold (project=T2)`
- `NAM-1..4,6,7,8 [-] N/A — below profile threshold (project=T2)`
- `NAM-5 [x] clean — /api/drops, /api/drops/paste, /api/session-settings, /api/terminal-versions are REST-consistent`
- `DEAD-1 [x] src/server/index.ts:52-54 — --terminal shim`
- `DEAD-2 [x] clean — no @deprecated symbols in src/server/**`
- `COM-1..3 [-] N/A — below profile threshold (project=T2)`
