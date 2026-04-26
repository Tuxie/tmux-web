# Security Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

Core network-boundary code is well-thought-through: Basic Auth uses constant-time compare with explicit length-mismatch handling, Origin parsing is fuzz-tested against URL invariants, IP-literal allowlist auto-flow is principled and warned-on, and the OSC 52 / file-drop pipelines have multi-layered isolation (per-binary BLAKE3 grants, sanitised filenames, raw `send-keys -H` injection bypassing shell parsing, dropId-based path resolution to prevent `absolutePath` leak). The main residual surface is endpoint completeness — `/api/exit`, `/api/drops/paste`, and the OSC 52 read size cap are post-auth amplifiers that a hostile authenticated client (XSS, leaked password) can chain into denial-of-service or session hijack. CI gates are well-pinned and permissions-scoped, but the tarball that users actually download is not smoke-tested post-package; `verify-vendor-xterm.ts` runs against the compiled binary, not the archive. Tier and applicability flags from the Scout match what I see; nothing to re-tier.

## Findings

(Findings have been merged into clusters; cluster files carry the verbatim bodies.)

- **`/api/exit?action=…` lacks Origin/IP enforcement: a single authenticated POST kills or restarts the server** — `src/server/http.ts:617-623` — Severity Medium, Confidence Verified · → see cluster 03-endpoint-hardening
- **`--reset` POSTs the saved Basic Auth credentials with `rejectUnauthorized: false` over HTTPS** — `src/server/index.ts:240-252` — Severity Medium, Confidence Verified · → see cluster 04-security-low-defenses
- **OSC 52 read content is not size-checked between `clipboard-read-reply` and tmux injection** — `src/server/ws-router.ts:39,117`, `src/server/tmux-inject.ts:16-22` — Severity Medium, Confidence Verified · → see cluster 03-endpoint-hardening
- **CI builds and tests the binary, but no smoke test runs the *packaged tarball*** — `.github/workflows/release.yml:144-165` — Severity Medium, Confidence Verified · → see cluster 05-ci-artifact-verification
- **OSC-title-driven session switch validates only existence; an attacker-controlled pane can force WS rebinding** — `src/server/ws.ts:341-386` — Severity Low, Confidence Verified · → see cluster 04-security-low-defenses
- **`tmux send-keys -H -t <target>` injects bytes via `state.lastSession`, which can be reassigned mid-flight by an OSC title** — `src/server/ws.ts:669-688,802-831`, `src/server/http.ts:437-464` — Severity Low, Confidence Plausible · → see cluster 04-security-low-defenses
- **`/api/drops/paste` and `/api/drop` accept a `session` query param that bypasses the WS session policy** — `src/server/http.ts:437-464,502-550` — Severity Low, Confidence Verified · → see cluster 03-endpoint-hardening
- **`MAX_DROP_BYTES = 50 MiB` per upload is documented; there is no per-user quota across drops** — `src/server/http.ts:50`, `src/server/file-drop.ts:62-68` — Severity Low, Confidence Verified · → see cluster 03-endpoint-hardening
- **`Math.random()` is used as the readiness-probe token for the tmux control client** — `src/server/tmux-control.ts:319` — Severity Low, Confidence Verified · → see cluster 02-server-fs-hardening
- **WS upgrade does not honour the `tw_auth` query token; HTTP routes do** — `src/server/ws.ts:164-171`, `src/server/http.ts:323-325` — Severity Low, Confidence Verified · → see cluster 03-endpoint-hardening
- **Origin allowlist auto-allows IP-literal origins without normalising IPv6 short forms** — `src/server/origin.ts:78-83`, `src/server/index.ts:118-119` — Severity Low, Confidence Plausible · → see cluster 04-security-low-defenses
- **`bump-homebrew-tap.yml` workflow runs an inline Python rewriter without validating SHA shape** — `.github/workflows/bump-homebrew-tap.yml:62-77,104-136` — Severity Low, Confidence Plausible · → see cluster 04-security-low-defenses
- **`scripts/verify-vendor-xterm.ts` runs only on Linux/macOS native legs; macOS coverage gate absent** — `.github/workflows/release.yml:127-138` — Severity Low, Confidence Verified · → see cluster 05-ci-artifact-verification

## Checklist (owned items)

- SEC-1 [x] `src/server/index.ts:617-623`, `src/server/http.ts:437-550`, `src/server/ws-router.ts:117`, `src/server/tmux-inject.ts:16-22`, `.github/workflows/release.yml:144-165`, `.github/workflows/bump-homebrew-tap.yml:104-136` — multiple findings filed; auth/Origin/allowlist/TLS-cert/shell-quoting/sanitise paths read and confirmed defensively correct elsewhere.
- GIT-3 [x] clean — `.gitignore` covers all sensitive shapes; tracked unit files hold placeholders not real credentials.
- FUZZ-1 [x] `tests/fuzz/` (10 files) — trust-boundary review verified. Gaps: `parseScrollbarState` and composed bracketed-paste fuzz; not blocking. See cluster 21-test-organisation for shape side.
- CI-1 [x] `.github/workflows/release.yml:17-19,58-59,226-227`, `bump-homebrew-tap.yml:41-42` — explicit `permissions:` blocks; all actions SHA-pinned.
- CI-2 [x] clean — actions SHA-pinned with semver comments; convention consistent.
- CI-3 [x] clean — secrets via `secrets:` block; no `set -x` / no echo of env vars.
- CI-4 [-] N/A — below profile threshold (project=T2).
- CI-5 [x] `.github/workflows/release.yml:144-165` — see cluster 05-ci-artifact-verification.
- CONT-3 [-] N/A — container absent.
- IAC-1 [-] N/A — iac absent.
- IAC-2 [-] N/A — iac absent.
- IAC-3 [-] N/A — iac absent.
