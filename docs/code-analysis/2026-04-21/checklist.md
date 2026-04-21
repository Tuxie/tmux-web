# Checklist

Rendered per-item in ID order, grouped by category. Multi-owner items show one line per owning scope. Defect-demoted entries appear verbatim with their `— defect: …` suffix so the weakest parts of the analysis stay visible. None triggered this run.

## EFF

- `EFF-1 [x] (backend) clean — scanned all 22 server files; no O(n²) or large-constant loops`
- `EFF-1 [x] (frontend) clean — OKLab math O(1); WebGL patched loop inherent to cell/frame rendering`
- `EFF-2 [x] (backend) clean — all tmux subcommands async; PTY data event-driven; no polling`
- `EFF-2 [x] (frontend) clean — fetches appropriately deduped via in-memory caches`
- `EFF-3 [x] (backend) clean — no dead exports`
- `EFF-3 [x] (frontend) see cluster 09 (pushFgLightness, defaultTuiOpacity); cluster 11 (#btn-session-plus)`

## PERF

- `PERF-1 [x] (backend) src/server/http.ts:136,233,239 — see cluster 03 (server-http-cleanup)`
- `PERF-1 [x] (frontend) clean — module-level caches adequate`
- `PERF-2 [x] (frontend) clean — xterm addons dynamically imported after Terminal init`
- `PERF-3 [x] (backend) clean — no unbounded collections`
- `PERF-3 [x] (frontend) src/client/index.ts:324,329 — see cluster 10`
- `PERF-4 [x] (backend) src/server/tmux-inject.ts:4 — see cluster 04 (pty-and-tmux-exec-safety)`
- `PERF-5 [-] (backend) N/A — no long-running work chains`
- `PERF-5 [x] (frontend) clean — no AbortSignal in fetches; acceptable at T2`

## QUAL

- `QUAL-1 [x] (backend) src/server/index.ts:127 LOOPBACK_IPS dup — see cluster 07`
- `QUAL-1 [x] (frontend) see cluster 09 (OKLab dup); cluster 11 (slider event wiring)`
- `QUAL-2 [x] (backend) clean — pty/ws/http/protocol/ws-router/exec/sessions-store/themes/file-drop well-separated`
- `QUAL-2 [x] (frontend) clean — adapters/ui/shared/protocol well-separated`
- `QUAL-3 [x] (backend) clean — consistent style across files`
- `QUAL-3 [x] (frontend) src/client/ui/topbar.ts:663-676 — see cluster 11`
- `QUAL-4 [x] (backend) clean — right-sized for T2`
- `QUAL-4 [x] (frontend) clean — WebGL patcher complex but documented workaround`
- `QUAL-5a [x] (backend) clean — sanitizeSession, sanitiseFilename, isValidPackRelPath, realpath containment all present`
- `QUAL-5a [x] (frontend) src/client/ui/topbar.ts:1194 title coercion — see cluster 10`
- `QUAL-5b [x] (backend) clean — external I/O wrapped in try/catch`
- `QUAL-5b [x] (frontend) src/client/{session-settings,colours,theme}.ts silent boot failures; src/client/connection.ts:29 ws.onerror no-op — see cluster 10`
- `QUAL-5c [x] (backend) clean — fd closed in finally; PTY killed on WS close; watchers killed on exit`
- `QUAL-5c [x] (frontend) src/client/index.ts:324,329 ResizeObserver + window resize cleanup — see cluster 10`
- `QUAL-6 [x] (backend) clean — idiomatic Bun/Node patterns`
- `QUAL-6 [-] (frontend) N/A — plain TS+DOM by design`
- `QUAL-7 [x] (backend) clean — no stdlib reimplementations`
- `QUAL-7 [x] (frontend) clean — hexToRgb is a small necessary utility`
- `QUAL-8 [x] (backend) Bun 'socket' workaround in ws.ts:47 documented`
- `QUAL-8 [x] (frontend) clean — xterm workarounds documented in CLAUDE.md`
- `QUAL-9 [x] (backend) clean — protocol.ts pure and shared; no cross-boundary dup`
- `QUAL-9 [x] (frontend) clean — colours/protocol client-only; server counterparts separate`

## ERR

- `ERR-1 [x] (backend) applyColourVariant retries once after 500ms; no other retry candidates — (analyst cited a client-side function; minor cross-scope slip, not a defect)`
- `ERR-2 [x] (backend) clean — session-settings writes atomic`
- `ERR-3 [-] (backend) N/A — below profile threshold (project=T2)`
- `ERR-4 [x] (frontend) src/client/connection.ts:29 — see cluster 10`
- `ERR-5 [x] (backend) clean`
- `ERR-5 [x] (frontend) clean — JSON parses wrapped`

## CONC

- `CONC-1 [x] (backend) clean — no shared mutable state across connections`
- `CONC-1 [x] (frontend) src/client/ui/topbar.ts:106-116 speculative race — see cluster 11`
- `CONC-2 [x] (backend) clean — fire-and-forget void intentional; proc.exited handled`
- `CONC-2 [x] (frontend) clean — void used correctly`
- `CONC-3 [x] (backend) No WS connection limit; dropped as low-practical-risk behind IP allowlist + auth`
- `CONC-4 [-] (backend) N/A — no long-running work chains`
- `CONC-4 [x] (frontend) clean — dropped with PERF-5`
- `CONC-5 [-] (backend) N/A — no lock primitives`

## OBS

- `OBS-1 [-] (backend) N/A — below profile threshold (project=T2)`
- `OBS-2 [-] (backend) N/A — below profile threshold (project=T2)`
- `OBS-3 [x] (backend) No /health endpoint; dropped — personal-use systemd service`
- `OBS-4 [-] (backend) N/A — no telemetry emitted`
- `OBS-4 [-] (frontend) N/A — no telemetry`

## LOG

- `LOG-1 [x] (backend) clean`
- `LOG-2 [x] (backend) clean`
- `LOG-3 [x] (backend) "tmux-web listening on ..." at startup; PTY spawn at debug`
- `LOG-4 [x] (backend) clean — debug logging for WS upgrade, PTY, OSC 52 decisions`
- `LOG-5 [x] (backend) clean — appropriate severity levels`
- `LOG-6 [x] (backend) clean`
- `LOG-7 [x] (backend) clean — consistent [debug] / [themes] prefixes`

## TYPE

- `TYPE-1 [x] (backend) src/server/ws-router.ts:41 — see cluster 03`
- `TYPE-1 [x] (frontend) src/client/ui/topbar.ts:307,327 window-as-any — see cluster 10; xterm.ts any dropped as documented intent`
- `TYPE-2 [x] (backend) clean`
- `TYPE-2 [x] (frontend) clean`
- `TYPE-3 [x] (backend) clean`
- `TYPE-3 [x] (frontend) clean`

## A11Y (frontend only)

- `A11Y-1 [x] src/client/ui/{dropdown,topbar}.ts — see cluster 05`
- `A11Y-2 [x] src/client/ui/dropdown.ts:81-107 — see cluster 05`
- `A11Y-3 [x] clean — shape cue (border ring) in base.css for stopped dot`
- `A11Y-4 [-] N/A — auth-gated terminal, no crawlable surface`
- `A11Y-5 [x] clean — no <img> elements in frontend`

## I18N (frontend only)

- `I18N-1..3 [-] N/A — no i18n intent`

## SEO (frontend only)

- `SEO-1..3 [-] N/A — auth-gated terminal, no crawlable surface`

## API (backend only)

- `API-1 [-] N/A — no versioned API`
- `API-2 [-] N/A — no OpenAPI spec`
- `API-3 [x] clean`
- `API-4 [x] read-only endpoints accept any HTTP method — see cluster 03`

## DEP

- `DEP-1 [?] (backend) inconclusive — could not run bun outdated; declared versions look recent`
- `DEP-1 [x] (frontend) clean (frontend-scoped)`
- `DEP-2 [x] (backend) clean`
- `DEP-2 [x] (frontend) clean — no overlapping frontend packages`
- `DEP-3 [x] (backend) clean — all declared deps imported`
- `DEP-3 [x] (frontend) clean`
- `DEP-4 [x] (backend) clean`
- `DEP-4 [x] (frontend) clean`
- `DEP-5 [x] (backend) clean — execFile over exec, timingSafeEqual, parseArgs appropriate`
- `DEP-5 [x] (frontend) clean`
- `DEP-6 [x] (backend) clean`
- `DEP-6 [x] (frontend) clean`
- `DEP-7 [-] (backend) N/A`
- `DEP-7 [-] (frontend) N/A`
- `DEP-8 [x] (backend) inotifywait (inotify-tools) host dep, explicitly probed + graceful macOS/BSD disable`
- `DEP-8 [x] (frontend) clean`

## NAM

- `NAM-1..NAM-7 [x] (backend) clean`
- `NAM-1..NAM-7 [x] (frontend) clean (frontend-scoped)`
- `NAM-8 [x] (backend) clean — log messages grammar/spelling correct`
- `NAM-8 [x] (frontend) src/client/index.html:93,113-119 ambiguous slider labels — see cluster 11`
- `NAM-8 [x] (docs) CLAUDE.md:157,223 grammar fragments — see cluster 08`

## FE (frontend only)

- `FE-1 [x] src/client/index.ts:140,200 — see cluster 10; other instances dropped as justified dynamic values`
- `FE-2 [x] clean — layout uses flex/grid throughout`
- `FE-3 [x] clean — no inline onclick`
- `FE-4 [x] see cluster 05 (dropdown items as <div> → A11Y-1)`
- `FE-5 [-] N/A — plain TS+DOM project by design`
- `FE-6 [x] clean — single styling system`
- `FE-7 [x] !important confined to two documented xterm overrides; acceptable`
- `FE-8 [x] clean — deliberately global CSS in single-page app`
- `FE-9..FE-13 [x] clean — no overlapping libraries`
- `FE-14 [x] clean — no jQuery/polyfills`
- `FE-15 [-] N/A — plain-DOM project`
- `FE-16 [x] clean — no <img> in UI`
- `FE-17 [x] clean — no images to lazy-load; fonts via FontFace API`
- `FE-18 [x] clean — form labels implicit-wrap; context inputs have visible spans`
- `FE-19 [x] see cluster 10 (QUAL-5c)`
- `FE-20 [x] clean — no Node/Bun imports in client`
- `FE-21 [x] themes/amiga/{amiga,scene}.css slider rules — see cluster 12`
- `FE-22 [x] clean — repeated patterns all have base classes`
- `FE-23 [x] src/client/base.css + topbar.ts + dropdown.ts — see cluster 12`

## UX (frontend only)

- `UX-1 [x] clean — theme divergences intentional; confirm() use documented`
- `UX-2 [x] clean — only Cmd+F and Cmd+R custom shortcuts`

## DB / MIG

- `DB-1..5, MIG-1..5 [-] N/A — no database`

## TEST

- `TEST-1 [x] tests/unit/server/origin.test.ts:207 — see cluster 14 (tautological assertion)`
- `TEST-2 [x] clean — test names concise and descriptive`
- `TEST-3 [x] dropdown/toast/connection no unit coverage — see cluster 02`
- `TEST-4 [x] clean — major user-visible flows have E2E tests`
- `TEST-5 [x] pty.test.ts vs pty-argv.test.ts duplicate — see cluster 14`
- `TEST-6 [x] logOriginReject assertion always true — see cluster 14`
- `TEST-7 [x] clean — beforeEach/afterEach used consistently`
- `TEST-8 [x] clean — Bun single-process; E2E port isolation via PORTS.md`
- `TEST-9 [x] clean — no tagging needed; one known slow test has explicit timeout`
- `TEST-10 [x] clean — no unrelated concerns mixed in one file`

## DET

- `DET-1 [x] clean — no wall-clock assertions`
- `DET-2 [x] clean — no RNG without seed`
- `DET-3 [x] tests/unit/server/bundled-themes.test.ts reads live dir — see cluster 14`
- `DET-4 [x] recentOriginRejects Map not reset between tests — see cluster 14`

## FUZZ

- `FUZZ-1 [x] (security + test, joint) 9 security-sensitive parsers lack property tests — see cluster 15`

## COV (coverage only; dynamic pass ran)

- `COV-1 [x] 5 client modules absent from lcov; xterm.ts at 72% lines — see cluster 02`
- `COV-2 [x] clampFgContrastStrength untested; /api/terminal-versions + POST /api/exit not exercised — see cluster 02`
- `COV-3 [x] CI runs bun test bare not coverage:check; xterm.ts permanently excluded — see cluster 01`

## PROF

- `PROF-1 [x] WebGL per-frame OKLab math loop has no bench — see cluster 16`
- `PROF-2 [x] Bun-internal .tmp coverage artifacts in coverage/ — see cluster 16. No .prof/flamegraph files in repo.`

## SEC

- `SEC-1 [x] 6 Low findings across clusters 04 (pty-and-tmux-exec-safety) and 06 (post-auth-data-handling). No High/Critical: timingSafe Basic Auth, strict origin check, IP allowlist, arg-array execFile everywhere.`

## CONT

- `CONT-1, CONT-2, CONT-3, CONT-4 [-] N/A — no container`

## CI

- `CI-1 [x] (tooling + security, joint) clean — all 5 actions SHA-pinned`
- `CI-2 [x] clean — per-job permissions narrow`
- `CI-3 [x] clean — no pull_request trigger`
- `CI-4 [-] N/A — no self-hosted runner`

## TOOL

- `TOOL-1 [x] clean — single toolchain`
- `TOOL-2 [x] node vs bunx playwright — see cluster 13`
- `TOOL-3 [x] clean — versions current and aligned`
- `TOOL-4 [x] clean — bun-build.ts complexity load-bearing`
- `TOOL-5 [x] clean — typecheck step present; local coverage gate exists`
- `TOOL-6 [x] coverage not in CI → cluster 01; E2E not in CI → cluster 13`
- `TOOL-7 [x] Homebrew double-fire race → cluster 13`

## BUILD

- `BUILD-1 [x] clean — bun.lock committed; --frozen-lockfile in CI`
- `BUILD-2 [x] clean — no lockfile drift`
- `BUILD-3 [x] clean — .bun-version 1.3.12 pinned, setup-bun and @types/bun aligned`

## GIT

- `GIT-1 [x] clean — LICENSE present (MIT)`
- `GIT-2 [x] clean — .woff2 fonts intentional embedded assets (.gitignore deliberately allows)`
- `GIT-3 [x] clean — no apparent secrets in history`
- `GIT-4 [x] assets-embedded.ts committed without gitignore entry — see cluster 13`

## IAC

- `IAC-1..3 [-] N/A — no IaC`

## MONO

- `MONO-1, MONO-2 [-] N/A — not monorepo`

## DEAD

- `DEAD-1 [x] #btn-session-plus no-op — see cluster 11`
- `DEAD-2 [x] pushFgLightness alias — see cluster 09`
- `DEAD-3 [x] clean — no TODO/FIXME in src/ older than 12 months`

## COM

- `COM-1 [x] (backend) clean — non-obvious code well-commented`
- `COM-1 [x] (frontend) clean`
- `COM-2 [x] (backend) clean — no stale comments`
- `COM-2 [x] (frontend) clean`
- `COM-3 [x] (backend) safeStringEqual comment contradicts behavior — see cluster 07`
- `COM-3 [x] (frontend) clean`

## DOC

- `DOC-1 [x] release.yml:62-64 misplaced comment — see cluster 08`
- `DOC-2 [x] CLAUDE.md keyboard handler scope, theme-switch semantics, DOM contract — see cluster 08`
- `DOC-3 [x] README.md CLI table missing flags — see cluster 08`
- `DOC-4 [x] subsumed into DOM contract finding (cluster 08)`
- `DOC-5 [x] clean — rephrases included inline in DOC-2 fixes`

## META

- `META-1 [x] see ../meta.md — 2 drafts for recurring patterns (method guards, boot-fetch error surfacing)`
