# Codebase map — /src/tmux-web (2026-04-26)

## File inventory

Total tracked files: **379** (via `git ls-files`). Bucketed by top-level dir:

- `src/` (67) — `src/client/` 33, `src/server/` 23, `src/desktop/` 8, `src/shared/` 3
- `tests/` (145) — `tests/unit/` 88, `tests/e2e/` 27, `tests/fixtures/` 18, `tests/fuzz/` 10, plus `tests/tmux.conf` and `tests/dev-restart.sh`
- `docs/` (115) — `docs/code-analysis/` 56 (two prior dated runs `2026-04-17/`, `2026-04-21/`), `docs/bugs/` 33 (mostly `fixed/`), `docs/superpowers/` 22 (`plans/` + `specs/`), `docs/ideas/` 4
- `themes/` (19) — `themes/amiga/` and `themes/default/` with `*.css`, `*.woff2`, `*.toml`, `theme.json`
- `scripts/` (8) — `bench-render-math.ts`, `build-desktop-prereqs.ts`, `check-coverage.ts`, `generate-assets.ts`, `prepare-electrobun-bundle.ts`, `test-unit-files.sh`, `verify-electrobun-bundle.ts`, `verify-vendor-xterm.ts`
- `.github/` (2) — `workflows/release.yml`, `workflows/bump-homebrew-tap.yml`
- `packaging/` (1) — `packaging/homebrew/tmux-web.rb`
- `vendor/` (1) — `vendor/xterm.js` submodule pointer (only the gitlink is tracked)
- Root config & meta (rest): `.bun-version`, `.gitignore`, `.gitmodules`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `Makefile`, `README.md`, `bun-build.ts`, `bun.lock`, `bunfig.toml`, `electrobun.config.ts`, `package.json`, `playwright.config.ts`, `tmux-web-dev`, `tmux-web-dev.service`, `tmux-web.service`, `tmux.conf`, `tsconfig.json`, `tsconfig.client.json`, `tsconfig.electrobun.json`

No directory exceeds 200 files; full enumeration was within budget.

## Tech stack

- **Language: TypeScript** — `tsconfig.json`, `tsconfig.client.json`, `tsconfig.electrobun.json`; `package.json` `"typescript": "^6.0.3"`.
- **Runtime: Bun** — `.bun-version`, `Makefile` `BUN := bun`, `Bun.serve` at `src/server/index.ts:460`, `Bun.spawn(Sync)` at `src/server/index.ts:291,375`.
- **Framework (server): native Bun HTTP/WS** — `Bun.serve<WsData, never>` in `src/server/index.ts`; no Express/Fastify/Hono import in `package.json`.
- **Framework (client): vanilla TS + xterm.js** — `package.json` declares no React/Vue/Svelte; `src/client/index.html` plus per-module wiring in `src/client/index.ts`.
- **Terminal emulator: vendored xterm.js** — `vendor/xterm.js` submodule (`.gitmodules`); `bun-build.ts` builds it; AGENTS.md line 59 pins "xterm.js 6.0.0".
- **Desktop wrapper: Electrobun 1.16.0** — `package.json` devDependency; `electrobun.config.ts`; `src/desktop/index.ts:1` `import { BrowserWindow, Screen } from 'electrobun/bun'`.
- **Crypto/hash: @noble/hashes ^2.2.0** — only runtime dependency; `src/server/hash.ts` uses it.
- **Test runner (unit): bun test** — `bunfig.toml` `[test] root = "tests/unit"`; `package.json` `"test:unit": "bun test"`.
- **Test runner (e2e): Playwright ^1.59.1** — `playwright.config.ts`; `package.json` `"test:e2e": "bunx playwright test"`.
- **Property/fuzz: fast-check ^4.7.0** — devDep; tests in `tests/fuzz/`.
- **DOM mock: jsdom ^29.0.2** plus happy-dom (referenced in `docs/bugs/fixed/2026-04-23-e2e-*-happy-dom.md`).
- **Build / bundler: Bun build** — `bun-build.ts` calls `import { build } from "bun"`; final binary via `bun build … --compile --minify --bytecode` in `Makefile:77`.
- **Build orchestrator: GNU Make** — `Makefile` is canonical entry point for build/test/release.
- **Database / ORM: none** — no SQL, migrations, ORM imports, or driver deps; settings stored in `~/.config/tmux-web/sessions.json` (atomic file writes per README).
- **Packaging: Homebrew tap** — `packaging/homebrew/tmux-web.rb` plus `.github/workflows/bump-homebrew-tap.yml`.
- **Service deployment: systemd units** — `tmux-web.service`, `tmux-web-dev.service` shipped at root.
- **Image processing: pngjs ^7.0.0** — devDep, used in tests.

## Entry points

- `src/server/index.ts:484` — server CLI main (`if (import.meta.main) { … }`); `startServer` at `src/server/index.ts:190`; `Bun.serve` at `src/server/index.ts:460`.
- `src/client/index.ts:62` — browser client `async function main()`; document listeners wired starting at line 421.
- `src/desktop/index.ts:34` — Electrobun desktop main (`async function main()`); invoked at `src/desktop/index.ts:113`.
- `bun-build.ts` (top-level script) — client bundle build entry; `--watch` honoured at `bun-build.ts:6`.
- `scripts/build-desktop-prereqs.ts` — desktop-build prerequisite generator.
- `scripts/prepare-electrobun-bundle.ts` — Electrobun packaging step.
- `scripts/verify-electrobun-bundle.ts` — packaging verification.
- `scripts/verify-vendor-xterm.ts` — release-time check that compiled binary embeds vendored xterm.
- `scripts/generate-assets.ts` — produces `src/server/assets-embedded.ts` (referenced by `Makefile:73`).
- `scripts/check-coverage.ts` — coverage threshold gate (referenced by `package.json` `coverage:check`).

## Project tier

```
Tier: T2
Rationale: Solo maintainer (one author "Per Wigren") and no SECURITY/CODEOWNERS/templates argue T1, but the repo carries strong primary signals — MIT LICENSE, multi-job GitHub Actions release workflow, 36 release tags, a maintained CHANGELOG.md, a Homebrew packaging artifact, systemd unit files, and an Electrobun desktop deploy target. Recent activity is high (737 commits in 90d, latest 2026-04-26) and the project has explicit pre-release verification surface (`act` + `make fuzz`). Coordination infrastructure is deploy/release-shaped, not team-shaped, which is the textbook T2 "serious OSS" pattern.

Signals:
- Contributors (unique authors): 1 (Per Wigren)
- Recent activity (commits last 90d): 737
- Approximate LOC (code-only, non-vendored, ex-tests): ~14,466
- Approximate LOC (total non-vendored, ex-docs/lock/md): ~35,496
- LICENSE: present (MIT, last touched 2026-04-17)
- CI: multi-job (.github/workflows/release.yml, bump-homebrew-tap.yml)
- Deploy artifacts: multi-target (systemd unit files, Homebrew tap formula, Electrobun desktop bundles, compiled --compile binary). No Dockerfile, no k8s/terraform.
- Release / changelog: 36 git tags (v0.9.0 → v1.2.x), CHANGELOG.md present and recently updated (2026-04-25).
- Security/policy files: none — no SECURITY.md, no CODEOWNERS, no .github/ISSUE_TEMPLATE, no CODE_OF_CONDUCT, no CONTRIBUTING.
```

## Applicability flags

- `backend`: **present** — `src/server/` 23 files, full HTTP+WS server in `src/server/index.ts`, `http.ts`, `ws.ts`, `pty.ts`, `tmux-control.ts`.
- `frontend`: **present** — `src/client/` 33 files including `index.html`, `index.ts`, `ui/*.ts`, `adapters/xterm.ts`, `base.css`.
- `database`: **absent** — no SQL, no migrations, no ORM imports; persistence is JSON file (`sessions-store.ts`).
- `tests`: **present** — `tests/unit/` 88 files, `tests/e2e/` 27 files, `tests/fuzz/` 10 files; bun test + Playwright.
- `security-surface`: **present** — HTTP + WS handlers (`http.ts`, `ws.ts`, `ws-router.ts`), HTTP Basic Auth (`hash.ts` with @noble/hashes), origin parsing (`origin.ts`), IP allowlist (`allowlist.ts`), TLS cert generation (`tls.ts`), shell quoting (`shell-quote.ts`), OSC 52 clipboard (`osc52-reply.ts`), file-drop (`file-drop.ts`, `drop-paste.ts`), subprocess spawn (`exec.ts`, `pty.ts`, `Bun.spawn` 4× in `index.ts`).
- `tooling`: **present** — `Makefile`, `bun-build.ts`, `bunfig.toml`, `playwright.config.ts`, `electrobun.config.ts`, `scripts/` (8 files), `.github/workflows/` (2 files).
- `docs`: **present** — `AGENTS.md` (23 KB), `README.md` (10.9 KB), `CHANGELOG.md` (48.8 KB), `docs/` 115 files including 2 prior dated `code-analysis/` runs.
- `container`: **absent** — no Dockerfile, Containerfile, or `docker-compose*.yml` tracked.
- `ci`: **present** — `.github/workflows/release.yml`, `.github/workflows/bump-homebrew-tap.yml`.
- `iac`: **absent** — no `*.tf`, no `k8s/`, `helm/`, `pulumi/`, `serverless.yml`, `wrangler.toml`. (Systemd `.service` units exist but are host-config, not IaC.)
- `monorepo`: **absent** — single `package.json`, no `workspaces` field, no `pnpm-workspace.yaml`, no nx/turbo.
- `web-facing-ui`: **present, auth-gated** — single-tenant browser UI with HTTP Basic Auth + IP allowlist enabled by default, TLS by default. Every HTML route requires Basic Auth credential; no marketing site, no public docs route, no unauthenticated index. `DEFAULT_HOST=0.0.0.0` per `src/shared/constants.ts:8` but `LOCALHOST_IPS` allowlist gates non-local IPs.
- `i18n-intent`: **absent** — no `locales/` dir, no i18n framework dep, no Intl framework imports beyond standard locale APIs; user-facing strings are English literals in `ui/*.ts`.

## Load-bearing instruction-file drift

Velocity: 737 commits in last 90d → **high-velocity** threshold applies.

- AGENTS.md last touched 2026-04-23 (3 days ago); referenced source paths last touched 2026-04-23 to 2026-04-26. Doc has been touched within 14d → timestamp clean.
- README.md last touched 2026-04-26 (today). Timestamp clean by definition.

Structural — AGENTS.md path checks: 20/20 present, 0 missing → clean. README.md path checks: 3/3 refs present → clean.

Content — AGENTS.md declarations sampled: "Auth — HTTP Basic Auth (enabled by default)" matches `src/server/index.ts` argv `--no-auth` opt-out + `hash.ts` + `http.ts`; "TLS — HTTPS enabled by default" matches `--no-tls` opt-out + `tls.ts:generateSelfSignedCert`; "DEFAULT bind 0.0.0.0:4022" matches `DEFAULT_HOST` and `DEFAULT_PORT` in `src/shared/constants.ts:5,8`; "PTY — Bun native `Bun.spawn`" matches `src/server/pty.ts`. README declarations match. **All sampled declarations match.** Content clean.

```
Docs drift:
- AGENTS.md — last change 7bd61b0 2026-04-23 12:09:58 +0200; status: fresh
- README.md — last change 67cf30e 2026-04-26 10:02:49 +0200; status: fresh
```

(No `CLAUDE.md` or `GEMINI.md` present; nothing further to call.)

## Pre-release verification surface

```
Pre-release surface:
- CI config: .github/workflows/release.yml, .github/workflows/bump-homebrew-tap.yml
- Local runner: act (documented in AGENTS.md:28-36 with explicit `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest` invocation), make fuzz (Makefile:68 — `bun test ./tests/fuzz/`), make typecheck (Makefile:47), make test (Makefile:42)
- Recommend pre-release checklist in report: yes
```

Both CI workflow and explicit local runner (`act` + `make fuzz`) exist; AGENTS.md treats local `act` run as mandatory before pushing a release tag.

## Notable oddities

- **Vendored xterm.js as git submodule** (`vendor/xterm.js`, declared in `.gitmodules`) with bespoke build patching in `Makefile:95-108` to inline `experimentalDecorators` into per-dir tsconfigs because Bun does not follow `tsconfig "extends"`. AGENTS.md line 7 marks this as *load-bearing-must-not-regress* and warns it has silently regressed at least five times.
- **Three TypeScript projects**: `tsconfig.json` (server), `tsconfig.client.json` (client), `tsconfig.electrobun.json` (desktop), each independently typechecked in `Makefile:48-50`. No path aliases shared via `extends`.
- **Generated source file**: `src/server/assets-embedded.ts` is produced by `scripts/generate-assets.ts` via `Makefile:73`. Its presence at typecheck time is enforced as a typecheck prerequisite.
- **Compiled-binary artifact in repo working tree** (not tracked): root `tmux-web` binary (105 MB) and root `index.js.map` (366 KB) sit alongside source. `.gitignore` excludes them but they are visible in `ls -la`.
- **Two parallel "design plans" tracks**: `docs/superpowers/plans/` and `docs/superpowers/specs/` (22 files), distinct from `docs/ideas/` (4) and `docs/bugs/fixed/` (33 dated bug postmortems).
- **Two prior code-analysis runs in tree**: `docs/code-analysis/2026-04-17/` and `docs/code-analysis/2026-04-21/`, both fully populated — provides prior structure-scout output usable as a comparison baseline.
- **`.codex` empty zero-byte sentinel file** at repo root (read-only, mode 444), purpose unclear from filename alone.
- **`mempalace.yaml` and `entities.json`** at repo root tracked as `.gitignore`'d; not referenced by any TS file scanned. Possible Memory Palace / dev-tooling sidecar artifact.
- **Single-author, very-high-velocity repo** (737 commits / 90d / 1 author) — coordination shape is solo discipline despite T2 release artifacts.
- **Submodule build mutates vendor tree**: `Makefile:97` runs `cd vendor/xterm.js && bun install && rm -f bun.lock` — submodule's lockfile is intentionally deleted on every refresh; the patch loop at `Makefile:104-106` mutates per-dir tsconfigs in-place.
- **`tests/fuzz/` excluded from default `bun test`** by `bunfig.toml` `root = "tests/unit"`. The 10 fuzz files run only via `make fuzz`. Coverage analyst should not assume fuzz files contribute to the coverage gate.
