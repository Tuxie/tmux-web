# Backend Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

The backend is well-structured for a T2 solo OSS project: clean module boundaries, consistent async patterns, deliberate security controls (timing-safe auth, IP allowlist, origin validation, session-name sanitization, path-traversal prevention). The most actionable findings are a verified parsing bug where colon-containing tmux window names corrupt the window-list state pushed to every connected client; a missing 5-second timeout on `sendBytesToPane` that can leave HTTP handlers waiting indefinitely on a hung tmux process; and a minor length-leak in the `safeStringEqual` function that contradicts its own stated timing-safety guarantee. All three are small-effort fixes. The remaining findings (caching, method guards, duplicate constant, ws-router `any` → `unknown`) are Low-severity and autofix-ready.

## Findings

- **Window name parsing breaks on colon-containing names** — Medium / Verified → see cluster 03-server-http-cleanup
- **`sendBytesToPane` uses unbounded `promisify(execFile)` with no timeout** — Medium / Verified → see cluster 04-pty-and-tmux-exec-safety
- **`safeStringEqual` length-leaks credential length despite constant-time intent** — Low / Verified → see cluster 07-server-auth-consistency
- **Read-only API endpoints accept any HTTP method** — Low / Verified → see cluster 03-server-http-cleanup
- **`listThemes` and `listFonts` recomputed on every request** — Low / Verified → see cluster 03-server-http-cleanup
- **`LOOPBACK_IPS` defined twice, diverging — `::ffff:127.0.0.1` absent from `index.ts` copy** — Low / Verified → see cluster 07-server-auth-consistency
- **`getTerminalVersions` reads and regex-scans the full xterm bundle on every call** — Low / Verified → see cluster 03-server-http-cleanup
- **`ws-router.ts` uses untyped `any` for JSON parse with no validation** — Low / Verified → see cluster 03-server-http-cleanup

## Checklist (owned items)

- EFF-1 [x] clean — scanned all 22 server files; no O(n²) algorithms or large-constant loops.
- EFF-2 [x] clean — all tmux subcommands async (`execFileAsync`); PTY data forwarded event-driven. No polling loops.
- EFF-3 [x] clean — no dead exports; `_resetInotifyProbe` exported for tests only (intentional).
- PERF-1 [x] `listThemes` + `listFonts` + `getTerminalVersions` — see cluster 03.
- PERF-3 [x] clean — `pendingReads` per-connection; watchers cleaned by `stopAllWatchers` on exit; `recentOriginRejects` capped at 256.
- PERF-4 [x] `tmux-inject.ts:sendBytesToPane` timeout missing — see cluster 04.
- PERF-5 [-] N/A — no long-running work chains; PTY lifetime is WS-scoped.
- QUAL-1 [x] `LOOPBACK_IPS` dup — see cluster 07. No other significant duplication.
- QUAL-2 [x] clean — `pty.ts`, `ws.ts`, `http.ts`, `protocol.ts`, `ws-router.ts`, `exec.ts`, `sessions-store.ts`, `themes.ts`, `file-drop.ts` have single well-defined responsibilities.
- QUAL-3 [x] clean — consistent style across files; ESM + Bun APIs + consistent error handling.
- QUAL-4 [x] clean — architecture right-sized for T2.
- QUAL-5a [x] clean — `sanitizeSession`, `sanitiseFilename`, `isValidPackRelPath`, realpath containment, HTTP body size caps all present.
- QUAL-5b [x] clean — external I/O wrapped in try/catch; PTY exit wired to WS close; file-drop errors surfaced.
- QUAL-5c [x] clean — fd closed in `finally`; PTY killed on WS close; inotifywait watchers killed on exit; TLS temp dir cleaned.
- QUAL-6 [x] clean — idiomatic Bun/Node patterns.
- QUAL-7 [x] clean — no stdlib reimplementations.
- QUAL-8 [x] Bun `socket` workaround in `ws.ts:47` (`Symbol.for('::bunternal::')`) documented.
- QUAL-9 [x] clean — `protocol.ts` pure and shared; no cross-boundary logic duplication detected.
- ERR-1 [x] `applyColourVariant` retries once after 500ms; no other retry candidates. *(Analyst cited a client-side function; minor cross-scope slip, not a checklist defect.)*
- ERR-2 [x] clean — session-settings writes use `.part` → rename atomics.
- ERR-3 [-] N/A — below profile threshold (project=T2).
- ERR-5 [x] clean — all `JSON.parse` in request paths try/catched; PTY exit handled.
- CONC-1 [x] clean — no shared mutable state across connections.
- CONC-2 [x] clean — all fire-and-forget `void` expressions intentional; `proc.exited.then(...)` handled.
- CONC-3 [x] No WS connection limit; dropped as low-practical-risk behind IP allowlist + auth.
- CONC-4 [-] N/A — no long-running work chains.
- CONC-5 [-] N/A — no lock primitives in use.
- OBS-1 [-] N/A — below profile threshold (project=T2).
- OBS-2 [-] N/A — below profile threshold (project=T2).
- OBS-3 [x] No `/health` endpoint; dropped — personal-use systemd service, not behind a load balancer.
- OBS-4 [-] N/A — no telemetry emitted.
- LOG-1 [x] clean — OSC 52 oversized write logs; origin reject logs; startup error paths log before exit.
- LOG-2 [x] clean — theme parse failures `console.warn`; inotifywait spawn failure falls through silently by design (documented TTL fallback).
- LOG-3 [x] `console.log("tmux-web listening on ...")` at startup; PTY spawn at debug.
- LOG-4 [x] clean — debug logging present for WS upgrade, PTY spawn, OSC 52 decisions.
- LOG-5 [x] clean — `console.error`/`warn`/`log` used appropriately.
- LOG-6 [x] clean — no contradictory messages.
- LOG-7 [x] clean — consistent `[debug]` / `[themes]` prefixes.
- TYPE-1 [x] Most `as any` have justification comments. Exceptions: `ws-router.ts:41` (→ cluster 03) and `colours.ts:28` (`TOML.parse(src) as any`).
- TYPE-2 [x] clean — public API surfaces typed.
- TYPE-3 [x] clean — optional chaining in `ws-router.ts` is correct guard-before-use.
- API-1 [-] N/A — no versioned API.
- API-2 [-] N/A — no OpenAPI spec.
- API-3 [x] clean — JSON responses consistent; error responses plain text (intentional).
- API-4 [x] read-only endpoints accept any HTTP method → cluster 03.
- DEP-1 [?] inconclusive — could not run `bun outdated`; declared versions (`@noble/hashes@^2.2.0`, `ws@^8.20.0`, `@playwright/test@^1.59.1`, `typescript@^5.8.0`, `@types/bun@^1.3.12`) look recent.
- DEP-2 [x] clean — no overlapping packages.
- DEP-3 [x] clean — all declared deps are imported.
- DEP-4 [x] clean — no obvious hand-rolled reimplementations.
- DEP-5 [x] clean — `execFile` over `exec`, `timingSafeEqual`, `parseArgs` are appropriate.
- DEP-6 [x] clean — no deprecated packages identified.
- DEP-7 [-] N/A — no backwards-compat shims.
- DEP-8 [x] `inotifywait` (inotify-tools) is a host dep, explicitly probed with `hasInotifywait()` and gracefully disabled on macOS/BSD.
- NAM-1..NAM-7 [x] clean — consistent camelCase funcs, PascalCase interfaces, kebab-case files, lowercase endpoints.
- NAM-8 [x] clean — log messages grammar/spelling correct.
- DEAD-1 [x] clean — `--theme` legacy no-op documented with removal note.
- DEAD-2 [x] clean — no `@deprecated` symbols found.
- COM-1 [x] clean — non-obvious code well-commented (rejectUpgradeSocket Bun workaround, OSC 52 inject rationale, parseForegroundFromProc `/proc/stat` field format, IPv4-mapped hex normalization, scheduleAutoUnlink grace period).
- COM-2 [x] clean — no obviously stale comments.
- COM-3 [x] `safeStringEqual` comment vs behavior contradicts — see cluster 07.
- MONO-1, MONO-2 [-] N/A (not monorepo).
