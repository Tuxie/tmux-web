---
Status: partial
Autonomy: needs-decision
Resolved-in: ca1993b2128df199d8b937b99e353077db4dc1e9 (partial — F1 disk-extraction architectural concern deferred per preflight; F2/F3 landed)
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 16 — theme-pack-runtime

## TL;DR

- **Goal:** Three findings about the embedded-theme runtime — bundled themes are extracted to `tmpdir()/tmux-web-themes-${pid}` on startup with a process exit listener; the xterm sentinel SHA is recovered by regex-grepping a 1.5 MB bundle though `bun-build.ts` already has it; the `materializeBundledThemes` exit listener could accumulate on test re-mounts.
- **Impact:** None of these are bugs at T2; they are architectural smells in a recently-touched area. The xterm SHA cleanup is the most concrete improvement.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Low
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Backend · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/http.ts` (3 findings)
- `bun-build.ts` (touched by xterm-sentinel fix)
- `src/server/themes.ts` (touched by extract-removal fix)
- `scripts/generate-assets.ts` (touched by both)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 3
- autofix-ready: 0 · needs-decision: 3 · needs-spec: 0

## Findings

- **Server boot path mixes sync and async fs reads in the hot startup path with no timing instrumentation** — `index.ts:325-352` reads `index.html`, `tmux.conf`, fallbacks via a mix of `fs.readFileSync` and `Bun.file().text()`; `http.ts:111-129` runs an in-handler `materializeBundledThemes` that synchronously walks all embedded theme keys, mkdirs, writes, registers a process exit hook. That last step happens inside `createHttpHandler`, after the WS upgrade hooks are wired but before `Bun.serve` is called — every restart re-extracts every theme to a `tmpdir()/tmux-web-themes-${pid}` dir (PID-suffixed so prior runs aren't reused). On a 2-theme repo this is fine; the pattern of "extract every embedded asset to /tmp on startup with a process.exit cleanup hook" doesn't scale and makes tmpdir handling load-bearing for theme rendering.
  - Location: `src/server/http.ts:111-129`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `theme-pack-runtime`
  - Notes: T2-appropriate fix is one-shot extraction at first request keyed by content hash, or always-from-buffer reads in `readPackFile`. The current architecture serves theme files from disk (`Bun.file(found.fullPath)`) so eliminating the disk extraction would require teaching `themes.ts` about embedded assets too — non-trivial. Also: unhandled promise rejection if `materializeBundledThemes` throws inside `createHttpHandler` await chain — currently nothing gates startup on that.
  - Raised by: Backend

- **`getTerminalVersions` reads the full xterm bundle on startup via `fs.readFileSync` to recover a 7-char SHA that already exists as a build-time variable in `bun-build.ts`** — `http.ts:166-178` parses the embedded `dist/client/xterm.js` (typically ~1.5 MB) for the sentinel `tmux-web: vendor xterm.js rev <SHA>` regex. This recovers a value `bun-build.ts:188` already knows at build time and emits as a bundle marker. The cache is computed once at startup so per-request cost is zero, but the startup cost is non-zero and the round-trip (build emits SHA → server greps it back out) is awkward. A `dist/client/xterm-version.json` written by `bun-build.ts` and embedded as an asset would be cleaner.
  - Location: `src/server/http.ts:166-178`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `theme-pack-runtime`
  - Notes: T2 fix is `bun-build.ts` writes `dist/client/xterm-version.json` containing `{ rev: vendorRev }`, `assets-embedded.ts` picks it up via the existing `with { type: 'file' }` import, `getTerminalVersions` reads the JSON (~50 bytes) instead of regex-scanning a megabyte. Verify-vendor-xterm.ts still greps the bundle for the sentinel — that path remains as the source-of-truth.
  - Raised by: Backend

- **`createHttpHandler` is `async` and may complete after `Bun.serve` is called (timing window)** — `index.ts:398` awaits `createHttpHandler(...)` before constructing `Bun.serve`. So the handler is ready when `serve` starts. But `materializeBundledThemes` schedules `process.on('exit')` to rm the tmpdir — the assumption is that the handler is built only once. If the boot path were ever forked (e.g. `--reset` triggering a re-exec, or test harness re-instantiating), each successive `materializeBundledThemes` would register a fresh exit listener; over many cycles the listener-count grows and Node warns about >10 listeners. Not a bug today (single boot per process); brittle.
  - Location: `src/server/http.ts:123-127`
  - Severity: Low · Confidence: Speculative · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `theme-pack-runtime`
  - Notes: Tests using `createHttpHandler` repeatedly inside one process would warn. Cheap fix: hold the registered listener in a module-level handle and `process.removeListener` if the handler is rebuilt; or delegate cleanup to the caller's `runServerCleanup`.
  - Raised by: Backend

## Suggested session approach

Brainstorming session. The xterm-sentinel fix is the cheapest and most concrete — a JSON sidecar instead of a regex on a 1.5MB bundle. The disk-extraction architectural concern is genuinely deferred-shaped — large refactor for a non-bug at T2. The exit-listener accumulation is informational. If only one ships, take the xterm sentinel.
