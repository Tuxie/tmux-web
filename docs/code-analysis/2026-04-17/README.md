# Codebase Analysis — 2026-04-17

> **Heavy token usage.** Before kicking off a brainstorming session from any cluster here, confirm that weekly quota has spare headroom — follow-up sessions can easily spend as much as this analysis did.

## Project tier: **T2**

Serious single-developer OSS with an established release pipeline (GitHub Actions, Homebrew), a real test suite (20 Playwright e2e + 31 bun unit), a maintained `CHANGELOG.md`, and deliberate build-pipeline decisions (the vendor `xterm.js` strategy is explicitly load-bearing). Not T3 — single contributor, no `SECURITY.md` / `CODEOWNERS` / prod deploy artifacts. Not T1 — release automation and dependency management are rigorous. Every finding below was filtered through T2.

## Run metadata

- Repo: `/src/tmux-web`
- Git head: `afb6757` on branch `main`
- Working tree at analysis time: **clean**
- Analysts dispatched: Backend, Frontend, Test, Security (Opus), Tooling, Docs
- Analysts skipped: Database — no SQL/ORM/migrations (sessions.json file-store only)
- Scope overrides: none
- Re-dispatch passes: none
- Right-sizing filter: analysts filtered at source; synthesis dropped ~4 stylistic restatements and ~2 enterprise-tier suggestions. See `not-in-scope.md`.
- Report directory: `docs/code-analysis/2026-04-17/`
- Scout map: `.scratch/codebase-map.md`

## Tech stack (excerpt)

TypeScript, Bun runtime (v1.3.12+) for server and build, vanilla browser TypeScript for client, xterm.js 6.0.0 pinned via `vendor/xterm.js` submodule. Server uses Bun-native HTTP + WebSocket; PTY via `Bun.spawn` wrapping tmux. Tests: `bun test` (unit) + Playwright (e2e). Build: `Makefile` + custom `bun-build.ts`. No database. Full map: `.scratch/codebase-map.md`.

Entry points: `src/server/index.ts`, `src/client/index.ts`, `bun-build.ts`, `Makefile`, `.github/workflows/release.yml`.

## Index

- [Executive summary](./executive-summary.md) — top 5 clusters
- [Themes](./themes.md) — cross-cutting patterns
- **Clusters** (ordered by recommended fix sequence):
  - ~~[01 — ws-network-trust](./clusters/01-ws-network-trust.md)~~ — close DNS-rebind / cross-site WS hole · Small · severity High · **closed 2026-04-18 (v1.5.0, merge 92cfb4e)**
  - ~~[02 — ci-supply-chain](./clusters/02-ci-supply-chain.md)~~ — pin Actions to SHAs, narrow job permissions · Small · severity Medium · **closed 2026-04-18**
  - ~~[03 — ci-repro-coverage](./clusters/03-ci-repro-coverage.md)~~ — deterministic builds + full-matrix tests · Small · severity Medium · **closed 2026-04-18**
  - ~~[04 — doc-drift](./clusters/04-doc-drift.md)~~ — bring CLAUDE.md + README back in sync with code · Small · severity Medium · **closed 2026-04-18**
  - ~~[05 — backend-hygiene](./clusters/05-backend-hygiene.md)~~ — floating async, body-guard, cache, dead shims · Small · severity Medium · **closed 2026-04-18**
  - ~~[06 — test-coverage-framework](./clusters/06-test-coverage-framework.md)~~ — fix vitest imports + add two E2E flows · Medium · severity Medium · **closed 2026-04-18 (OSC-52 consent E2E deferred — see placeholder)**
  - ~~[07 — frontend-hygiene](./clusters/07-frontend-hygiene.md)~~ — dup observers, `as any` casts, teardown, a11y, UX · Medium · severity Low · **closed 2026-04-18**
  - [08 — css-theming](./clusters/08-css-theming.md) — push structural rules to base.css, drop theme `!important` · Small · severity Low
  - [09 — fuzz-parsers](./clusters/09-fuzz-parsers.md) — size-cap OSC-52, property tests for TOML + base64 · Small · severity Low
  - [10 — minor-security-hardening](./clusters/10-minor-security-hardening.md) — timing-safe auth, TLS persistence, proto-pollution, perms · Small · severity Low
- **By analyst** (for traceability, not end-to-end reading):
  - [backend](./by-analyst/backend.md) · [frontend](./by-analyst/frontend.md) · [database](./by-analyst/database.md) · [tests](./by-analyst/tests.md) · [security](./by-analyst/security.md) · [tooling](./by-analyst/tooling.md) · [docs](./by-analyst/docs.md)
- [Checklist](./checklist.md)
- [META-1 draft rules](./meta.md)
- [Out of scope](./not-in-scope.md)

## How to use this report

1. Read the executive summary.
2. Pick one cluster. Open its file. Start a brainstorming session against that cluster alone — do not try to bundle clusters.
3. When a cluster is resolved, mark it done here (strike through the link). The report is a living artifact until every cluster is closed or explicitly deferred.
