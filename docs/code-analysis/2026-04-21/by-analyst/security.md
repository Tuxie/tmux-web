# Security Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

Posture is tight for T2. Authentication is constant-time Basic Auth plus IP-allowlist plus Origin check across both HTTP and WS upgrade paths; all subprocess calls use arg-array `execFile`; the clipboard-consent pipeline persists BLAKE3 pins and re-validates on every decision; file drops land under a 0700 per-uid dir with a random `dropId` subdir and the file opened `wx` 0600. No Critical/High findings — six Lows, most post-auth footguns (rename-arg `--` separator missing, TOCTOU between BLAKE3 check and OSC 52 reply, unvalidated `clipboard` field on `PUT /api/session-settings`, path disclosure in `/api/drops` GET) plus one DoS-your-own-browser (unbounded OSC 52 write count per frame). Supply chain is clean: SHA-pinned Actions, narrow per-job permissions, no fork triggers. No secrets in history. The single biggest leverage for a security-focused session is adding property/fuzz tests against `processData`, `extractTTMessages`, `routeClientMessage`, and `sanitiseFilename` — they are the four adversarial-input parsers whose failure modes are most security-adjacent.

## Findings (by cluster)

**→ cluster 04-pty-and-tmux-exec-safety**
- WS/HTTP rename and new-window args not sanitized nor `--` terminated — Low / Verified
- OSC 52 write has no per-frame count cap — Low / Verified

**→ cluster 06-post-auth-data-handling**
- TOCTOU between BLAKE3 pin check and OSC-52 clipboard reply — Low / Plausible
- `/api/session-settings` PUT accepts unvalidated `clipboard` sub-object — Low / Verified
- Drop store path disclosure via `/api/drops` GET — Low / Verified

**→ cluster 15-fuzz-gaps**
- FUZZ-1 security-sensitive parsers without property/fuzz tests — Medium / Plausible (merged with Test's FUZZ-1)

**Dropped**
- `--reset` path disables TLS verification for self-signed cert — documented intent; dropped as rule-restatement (see `not-in-scope.md`).

## Checklist (owned items)

- SEC-1 [x] — six Low findings above (two in cluster 04, three in cluster 06). No High/Critical: authn path timingSafeEqual Basic Auth (`http.ts:150-178`), strict origin check (`origin.ts`), IP allowlist, arg-array `execFile` everywhere, PTY spawn `Bun.spawn([file, ...args])`.
- GIT-3 [x] clean — no apparent secrets in tracked history. `git log` search for `BEGIN [A-Z ]*PRIVATE KEY`, `password`, `HOMEBREW_TAP_TOKEN`, `ghp_`, `AKIA…` produced only a single hit inside `tests/unit/server/tls.test.ts:22` asserting the literal string `-----BEGIN PRIVATE KEY-----` (no key body). No `.env*`/`.pem`/`.key`/`.pfx`/`.p12`/`secrets/`/`credentials/` in ls-files.
- FUZZ-1 [x] — see cluster 15. Nine security-sensitive parsers, each with fixture tests but none with property/fuzz coverage. Highest-leverage set flagged: `processData`, `extractTTMessages`, `routeClientMessage`, `sanitiseFilename`.
- CI-1 [x] clean — all third-party Actions pinned to commit SHA (`actions/checkout@de0fac2e…`, `oven-sh/setup-bun@0c5077e5…`, `actions/upload-artifact@043fb46d…`, `actions/download-artifact@3e5f45b2…`, `softprops/action-gh-release@b4309332…`).
- CI-2 [x] clean — all jobs set explicit `permissions:`. No `permissions: write-all` or unset.
- CI-3 [x] clean — no `pull_request` trigger. `release.yml` on `push: tags: v*`; `bump-homebrew-tap.yml` on `release: published` + `workflow_dispatch`.
- CI-4 [-] N/A at T2 — all jobs use `ubuntu-latest` / `macos-latest`; no self-hosted runners.
- CONT-3 [-] N/A (no container).
- IAC-1..3 [-] N/A (no IaC).
