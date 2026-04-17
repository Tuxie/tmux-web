# Checklist

Grouped by category in ID order. Multi-owner items keep one line per owning scope.

## EFF

- `EFF-1 (Backend) [-] N/A — below profile threshold (project=T2)`
- `EFF-1 (Frontend) [-] N/A — below profile threshold (project=T2)`
- `EFF-2 (Backend) [-] N/A — below profile threshold (project=T2)`
- `EFF-2 (Frontend) [-] N/A — below profile threshold (project=T2)`
- `EFF-3 (Backend) [-] N/A — below profile threshold (project=T2)`
- `EFF-3 (Frontend) [-] N/A — below profile threshold (project=T2)`

## PERF

- `PERF-1 (Backend) [x] src/server/themes.ts:140 — listColours re-reads .toml files on every /api/colours request → cluster 05`
- `PERF-1 (Frontend) [x] src/client/theme.ts:26-39 — module-level cache in listThemes/listFonts; fetchColours called twice at init`
- `PERF-2 (Frontend) [-] N/A — single-page app, bundle pre-split by build`
- `PERF-3 (Backend) [-] N/A — below profile threshold (project=T2)`
- `PERF-3 (Frontend) [-] N/A — below profile threshold (project=T2)`
- `PERF-4 (Backend) [x] src/server/http.ts:262,276, ws.ts:87,90,114,121,126,130,150,151,163,166 — no timeout on execFileAsync → cluster 05`
- `PERF-5 (Backend) [x] clean — execFileAsync calls are short-lived tmux subcommands`
- `PERF-5 (Frontend) [x] clean — Connection.reconnect() cancels pending timers`

## QUAL

- `QUAL-1..4 (Backend) [-] N/A — below profile threshold (project=T2)`
- `QUAL-1..4 (Frontend) [-] N/A — below profile threshold (project=T2)`
- `QUAL-5a (Backend) [-] N/A — below profile threshold (project=T2)`
- `QUAL-5a (Frontend) [-] N/A — below profile threshold (project=T2)`
- `QUAL-5b (Backend) [x] src/server/http.ts:447 — session-settings PUT body read outside try/catch → cluster 05`
- `QUAL-5b (Frontend) [x] clean — fetch() calls check res.ok`
- `QUAL-5c (Backend) [-] N/A — below profile threshold (project=T2)`
- `QUAL-5c (Frontend) [-] N/A — below profile threshold (project=T2)`
- `QUAL-6..8 (Backend) [-] N/A — below profile threshold (project=T2)`
- `QUAL-6..8 (Frontend) [-] N/A — below profile threshold (project=T2)`

## ERR

- `ERR-1 (Backend) [x] clean — retry/backoff not applicable to one-shot tmux commands`
- `ERR-2 (Backend) [x] clean — sessions-store atomic .part→rename; file-drop unique dropId`
- `ERR-3 (Backend) [-] N/A — below profile threshold (project=T3)`
- `ERR-4 (Frontend) [x] clean — defensive try/catch on async paths`
- `ERR-5 (Backend) [-] N/A — below profile threshold (project=T2)`
- `ERR-5 (Frontend) [-] N/A — below profile threshold (project=T2)`

## CONC

- `CONC-1 (Backend) [-] N/A — below profile threshold (project=T2)`
- `CONC-1 (Frontend) [-] N/A — below profile threshold (project=T2)`
- `CONC-2 (Backend) [x] src/server/ws.ts:321 — sendWindowState() without void/await → cluster 05`
- `CONC-2 (Frontend) [x] src/client/index.ts:205,208,215,307 — void intentional on fire-and-forget`
- `CONC-3 (Backend) [x] clean — pendingReads Map bounded per-connection`
- `CONC-4 (Backend) [x] clean — ws.ts cleans up PTY on close`
- `CONC-4 (Frontend) [x] clean — WS reconnect cancels timer`
- `CONC-5 (Backend) [x] clean — no lock/mutex usage`

## OBS

- `OBS-1 (Backend) [-] N/A — below profile threshold (project=T3)`
- `OBS-2 (Backend) [-] N/A — below profile threshold (project=T3)`
- `OBS-3 (Backend) [x] clean — no /health endpoint expected for T2 systemd service`
- `OBS-4 (Backend) [-] N/A — below profile threshold (project=T2)`
- `OBS-4 (Frontend) [-] N/A — no telemetry in scope`

## LOG

- `LOG-1..7 (Backend) [x] clean — console.error on fatal, console.warn on invalid theme entries, [debug] prefix consistent, debug() helper gated on config.debug`

## TYPE

- `TYPE-1 (Backend) [x] src/server/colours.ts:18,32,34, file-drop.ts:214, ws.ts:40,196 — as any without justification → cluster 05`
- `TYPE-1 (Frontend) [x] src/client/index.ts:89 — (window as any).__adapter → cluster 07`
- `TYPE-2 (Backend) [x] clean — public API fully typed`
- `TYPE-2 (Frontend) [x] clean — TerminalAdapter interface fully typed`
- `TYPE-3 (Backend) [x] clean`
- `TYPE-3 (Frontend) [x] clean`

## A11Y

- `A11Y-1 [x] src/client/ui/dropdown.ts:491-494 — missing aria-expanded/haspopup → cluster 07`
- `A11Y-2 [x] clean — title attrs + keyboard actions present`
- `A11Y-3 [x] src/client/ui/topbar.ts:144-146 — colour-only status dots → cluster 07`
- `A11Y-4 [?] inconclusive — landmark roles absent on #topbar; not scoped to full assessment`
- `A11Y-5 [x] clean — no <img> elements in scope`

## I18N

- `I18N-* [-] N/A — no i18n intent per scout`

## SEO

- `SEO-* [-] N/A — LAN-oriented self-hosted tool; below profile threshold`

## API

- `API-1 [x] clean — version bump + CHANGELOG present in release commits`
- `API-2 [-] N/A — no OpenAPI spec`
- `API-3 [x] clean — JSON response shapes consistent`
- `API-4 [x] clean — 4xx/5xx statuses used correctly`

## DEP

- `DEP-1..3 (Backend) [-] N/A — below profile threshold (project=T2)`
- `DEP-1..3 (Frontend) [-] N/A — below profile threshold (project=T2)`
- `DEP-4 (Backend) [x] clean`
- `DEP-4 (Frontend) [-] N/A — no reimplemented primitives`
- `DEP-5..6 [-] N/A — below profile threshold (project=T2)`
- `DEP-7 (Backend) [x] src/server/index.ts:52-54 — --terminal legacy shim → cluster 05`
- `DEP-7 (Frontend) [-] N/A`
- `DEP-8 [-] N/A — below profile threshold (project=T2)`

## NAM

- `NAM-1..4 [-] N/A — below profile threshold (project=T2)`
- `NAM-5 (Backend) [x] clean — /api/* endpoints REST-consistent`
- `NAM-5 (Frontend) [-] N/A — frontend scope`
- `NAM-6..7 [-] N/A — below profile threshold (project=T2)`
- `NAM-8 (Frontend) [x] clean — UI strings sampled; no typos`
- `NAM-8 (Backend) [-] N/A — below profile threshold (project=T2)`
- `NAM-8 (Docs) [x] CLAUDE.md:207 — "Backends no forward" grammar → cluster 04`

## FE

- `FE-1 [x] src/client/base.css:32-122 — hardcoded colours → cluster 08; dynamic-value sites are permitted per CLAUDE.md`
- `FE-2..3 [-] N/A — below profile threshold (project=T2)`
- `FE-4 [x] clean — semantic HTML`
- `FE-5 [-] N/A — no framework; vanilla DOM intended`
- `FE-6 [x] themes/default/default.css:45, themes/amiga/amiga.css:256 — .tw-dd-hidden-select duplication → cluster 08`
- `FE-7..8 [x] clean`
- `FE-9..14 [-] N/A — no overlapping libs`
- `FE-15 [-] N/A — no reactive framework`
- `FE-16..17 [-/x] N/A — no <img>; xterm addons dynamically imported`
- `FE-18 [x] clean — forms label/name OK`
- `FE-19 [x] drops-panel.ts:156, xterm.ts:98 — observers never disconnected → cluster 07`
- `FE-20 [-] N/A`

## UX

- `UX-1 [x] src/client/ui/topbar.ts:192,631 — confirm() vs custom modal → cluster 07`
- `UX-2 [x] clean`

## DB / MIG

- `DB-* [-] N/A — no database (Database analyst skipped)`
- `MIG-* [-] N/A — no database`

## TEST

- `TEST-1 [x] clean`
- `TEST-2 [x] clean`
- `TEST-3 [x] tests/unit/server/pty.test.ts:9 — sanitize dot+slash edge untested → cluster 06`
- `TEST-4 [x] tests/e2e/ — file-drop and OSC 52 consent missing → cluster 06`
- `TEST-5..7 [x] clean`
- `TEST-8 [x] tests/e2e/{font-selection,menu-settings-open,terminal-selection,tls}.test.ts — port collision risk → cluster 06`
- `TEST-9 [x] tests/e2e/topbar.test.ts:16,22 — waitForTimeout(1500) → cluster 06`
- `TEST-10 [x] clean`

## DET

- `DET-1..4 [x] clean`

## FUZZ

- `FUZZ-1 (Security) [x] src/server/colours.ts:17-48 (TOML), src/server/protocol.ts:24 (OSC-52) — no fuzz coverage → cluster 09`
- `FUZZ-1 (Test) [x] joint — see cluster 09`

## SEC

- `SEC-1 [x] see Findings in by-analyst/security.md — clusters 01, 10`

## CONT / IAC

- `CONT-* [-] N/A — no Dockerfile`
- `IAC-* [-] N/A — no iac`

## CI

- `CI-1 (Security) [x] .github/workflows/*.yml — Actions pinned to tags → cluster 02`
- `CI-1 (Tooling) [x] same anchor → cluster 02`
- `CI-2 (Security) [x] release.yml, bump-homebrew-tap.yml — missing permissions → cluster 02`
- `CI-2 (Tooling) [x] same anchor → cluster 02`
- `CI-3 [x] clean — no pull_request triggers`
- `CI-4 [-] N/A — no self-hosted runners`

## TOOL

- `TOOL-1..4 [x] clean`
- `TOOL-5 [x] Makefile:35-38, release.yml:58-60 — no typecheck → cluster 03`
- `TOOL-6 [x] release.yml:40,59,63 — 2/4 matrix skips tests + verify; no --frozen-lockfile → clusters 02, 03`
- `TOOL-7 [x] clean`

## BUILD

- `BUILD-1 [x] clean — bun.lock tracked`
- `BUILD-2 [x] clean — lockfile↔manifest aligned`
- `BUILD-3 [x] release.yml:37 — bun-version: latest → cluster 03`

## GIT

- `GIT-1 (Docs) [x] clean — MIT LICENSE present`
- `GIT-2 (Tooling) [x] clean — tmux-web binary .gitignore'd`
- `GIT-3 (Security) [x] clean — no secrets in tracked tree or history`
- `GIT-4 (Tooling) [x] clean — .gitignore coverage adequate`

## MONO

- `MONO-* [-] N/A — not a monorepo`

## DEAD

- `DEAD-1 (Backend) [x] src/server/index.ts:52-54 → cluster 05`
- `DEAD-1 (Frontend) [x] clean`
- `DEAD-2 [x] clean`
- `DEAD-3 (Docs) [x] clean — no >12mo TODO/FIXME`

## COM

- `COM-1..3 [-] N/A — below profile threshold (project=T2)`

## DOC

- `DOC-1 [x] clean`
- `DOC-2 [x] CLAUDE.md:181,187-193,207,265,290 → cluster 04`
- `DOC-3 [x] README.md:97-104,143 → cluster 04`
- `DOC-4 [x] clean`
- `DOC-5 [-] N/A`

## META

- `META-1 [-] drafted in synthesis — see meta.md`
