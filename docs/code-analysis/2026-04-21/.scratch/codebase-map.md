# Structure Scout output — 2026-04-21

## File inventory

Total tracked files: **240** (across git ls-files, excluding vendor submodule).

```
./.github:          2 files (.github/workflows/{release.yml, bump-homebrew-tap.yml})
./src:             47 files
  ├── src/client     (13 files: TypeScript, UI modules, HTML, CSS)
  ├── src/server     (22 files: TypeScript, core server modules)
  ├── src/shared      (2 files: types, constants)
./tests:          106 files
  ├── tests/unit     (52 files: test modules for server)
  ├── tests/e2e      (33 files: Playwright e2e tests)
  ├── tests/fixtures (rest: test data, configs)
./docs:            42 files (analysis reports from 2026-04-17, plans, ideas)
./themes:          19 files (JSON theme configs and bundled assets)
./scripts:          3 files (build scripts: generate-assets.ts, check-coverage.ts, verify-vendor-xterm.ts)
./packaging:        1 file (systemd service template)
Root config:       ~13 files (package.json, tsconfig variants, Makefile, bun.lock, .bun-version, CHANGELOG.md, CLAUDE.md, LICENSE, README.md, tmux.conf, service files, etc.)
./vendor:          1 git submodule reference (xterm.js; **21,561 vendored files not counted toward project LOC**)
```

Non-vendored approximate LOC: **47,948** (unit tests + e2e + src code combined).

## Tech stack

- **Languages** — TypeScript (package.json#type: "module"; src/server/*.ts, src/client/*.ts, tests/**/*.ts, tsconfig.json, playwright.config.ts)
- **Frontend framework** — xterm.js 6.0.0 (vendor/xterm.js submodule + @xterm/* npm addons: addon-fit, addon-image, addon-unicode-graphemes, addon-web-fonts, addon-web-links, addon-webgl; src/client/index.ts imports XtermAdapter)
- **Server runtime** — Bun (bun-build.ts, package.json scripts: "bun run", "bun test", bunfig.toml, .bun-version)
- **Backend framework** — Node http/https stdlib (src/server/index.ts imports http, https; Bun.spawn for PTY; ws package for WebSocket)
- **Test runner** — Bun native test (package.json "test:unit": "bun test"), Playwright (package.json "test:e2e": "playwright test"; playwright.config.ts)
- **Build / bundler** — Bun build (bun-build.ts: "bun build src/server/index.ts --compile"; Makefile targets: tmux-web binary)
- **Runtime** — Bun (v1.3.12 pinned in release.yml; Node.js compat layer for ws, http/https)
- **Security/crypto** — @noble/hashes (package.json dependency; src/server/hash.ts)
- **WebSocket** — ws@^8.20.0 (package.json; src/server/ws.ts)

## Entry points

1. **src/server/index.ts:346** — `createHttpHandler()` HTTP server setup
2. **src/server/index.ts:386** — `createWsServer()` WebSocket server setup
3. **src/server/index.ts** (~L403 main) — CLI argument parsing, server bootstrap
4. **src/client/index.ts:47** — `main()` async client boot; XtermAdapter instantiation
5. **Makefile:tmux-web target** — Bun compile entrypoint
6. **bun-build.ts** — Frontend bundle build (xterm.js, client code minification)
7. **scripts/generate-assets.ts** — Asset embedding for release binary
8. **scripts/check-coverage.ts** — Coverage validation gate
9. **scripts/verify-vendor-xterm.ts** — Vendor xterm.js verification (release CI)
10. **tests/unit/** & **tests/e2e/** — Bun test and Playwright test runners

## Project tier

**Tier: T2**

**Rationale:** Single maintainer (1 unique author, Per Wigren) with **very high** recent commit cadence (448 commits in last 90 days as of 2026-04-21), strong CI/CD (GitHub Actions release workflow with multi-platform builds), MIT LICENSE present, CHANGELOG.md actively maintained, Makefile with test gates (coverage:check), and release automation (tag-triggered build). No production deploy artifacts (k8s/terraform) — typical of solo high-velocity OSS or serious small-team project. Early age (v1.6.3 as of today) and lean organizational surface place it in **T2 serious OSS** rather than T3 enterprise.

**Signals:**

- Contributors (unique authors): **1**
- Recent activity (commits last 90d): **448**
- Approximate LOC (non-vendored): **47,948**
- LICENSE: **present (MIT)**
- CI: **multi-job** (.github/workflows/release.yml with matrix builds: linux-x64, linux-arm64, darwin-x64, darwin-arm64; unit + e2e + coverage gates)
- Deploy artifacts: **Bun compiled binary only** (Makefile: tmux-web standalone; no Dockerfile, k8s, terraform, helm)
- Release / changelog: **CHANGELOG.md present, tag-triggered release workflow, regular releases** (v1.6.3 released 2026-04-21)
- Security/policy files: **SECURITY.md absent, CODEOWNERS absent, ISSUE_TEMPLATE absent, CODE_OF_CONDUCT absent** (lightweight governance)

## Applicability flags

- **backend**: present — src/server/ (http.ts, ws.ts, pty.ts, ws-router.ts, auth, TLS, session mgmt, file-drop, clipboard protocol, tmux integration)
- **frontend**: present — src/client/ (xterm.js terminal UI, theme system, clipboard handlers, file-drop UI, topbar, keyboard/mouse handlers, protocol parsing)
- **database**: absent — no schema, migrations, ORM, or persistent store (only sessions.json file-based store for per-session settings)
- **tests**: present — tests/unit/ (52 test files), tests/e2e/ (33 Playwright tests); Makefile test gates; coverage check script
- **security-surface**: present — src/server/http.ts (HTTP Basic Auth), src/server/allowlist.ts (IP allowlist), src/server/tls.ts (self-signed cert generation), src/server/origin.ts (CORS/origin checks), src/server/clipboard-policy.ts (two-way OSC 52 consent), src/server/exec.ts (subprocess spawning for tmux), src/server/pty.ts (PTY spawn), WebSocket upgrade in ws.ts
- **tooling**: present — Makefile, bun-build.ts, scripts/, GitHub Actions release workflow, playwright.config.ts, tsconfig variants
- **docs**: present — CLAUDE.md (16.6 KB), README.md (10 KB), CHANGELOG.md (15 KB), docs/
- **container**: absent — no Dockerfile, Containerfile, or OCI config
- **ci**: present — .github/workflows/ (release.yml, bump-homebrew-tap.yml)
- **iac**: absent — no terraform, k8s, helm, pulumi, cloudformation
- **monorepo**: absent — single workspace
- **web-facing-ui**: present — user-facing on public internet (README states "Attach to your tmux sessions from any modern browser"; HTTPS default; Basic Auth + allowlist)
- **i18n-intent**: absent — no locales/, no i18n framework, UI labels hardcoded English

## Docs drift

**Docs drift: Fresh** — CLAUDE.md last modified 2026-04-21 (today); references src/server/index.ts, bun-build.ts, scripts/verify-vendor-xterm.ts, release.yml all touched within 3 days (2026-04-18 to 2026-04-21). No stale references detected.

- **CLAUDE.md** (updated 2026-04-21): pinned instruction about vendor xterm.js (**critical load-bearing alert**); references bun-build.ts (2026-04-18), verify-vendor-xterm.ts (2026-04-21), release.yml (2026-04-21). Status: **fresh**.
- **README.md** (last change 2026-04-19): feature list, requirements, quick-start. Status: **fresh** (evergreen).
- **No AGENTS.md or GEMINI.md present.**

## Pre-release verification surface

- **CI config**: present — `.github/workflows/release.yml` (multi-platform matrix, unit + e2e + coverage + vendor verify steps)
- **Local CI-equivalent**: present — `Makefile` test/test-unit/test-e2e/typecheck targets; CLAUDE.md §"Before pushing a release tag" explicitly documents local verification via `act`
- **Recommend pre-release checklist in report: YES** — Both CI config and local runner present; pre-tag verification is load-bearing (vendor xterm.js verification must pass).

## Notable oddities

1. **Vendor submodule strategy** — xterm.js pinned as git submodule (vendor/xterm.js) rather than npm package. CLAUDE.md flags as **critical** non-negotiable. Bun-build.ts and release CI actively verify. Regression-prone ("silently regressed at least five times").
2. **Bun-specific build patching** — Makefile patches xterm.js tsconfig files post-submodule-init to inject `experimentalDecorators: true`. Load-bearing workaround.
3. **CSS & theme system** — src/client/base.css + themes/ (19 JSON files). Colour transforms patched directly into WebGL glyph/rect renderers in src/client/adapters/xterm.ts. WebGL-only (no DOM renderer fallback).
4. **Systemd service templates** — tmux-web.service, tmux-web-dev.service in repo root.
5. **Recent deep-analysis artifacts** — docs/code-analysis/2026-04-17/ — prior analysis tree, clusters, executive summary (4 days old).
6. **Dated superpowers plans** — docs/superpowers/plans/ historical plans.
7. **Zero production deploy artifact** — single-binary model.

## Scale tier confidence

**T2 (Serious OSS / solo high-velocity)**.
Not T3 (no k8s/terraform, no CODEOWNERS, no templates, no team).
Not T1 (active release cadence, CI present and used, serious architecture).
