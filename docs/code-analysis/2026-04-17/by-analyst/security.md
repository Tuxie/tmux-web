# Security — analyst-native output

> Preserved for traceability. For fix work use the clusters under `../clusters/`.

## Summary

Security posture is reasonable for a single-user LAN tool: PTY spawn uses argv (no shell), tmux injection is hex-encoded via `send-keys -H`, file-drop paths are defanged before bracketed-paste (with shell-quoting heuristic), and both the OSC-52 read flow and the drop store have capped/TTL backstops. The two real gaps at T2 are (1) absence of `Origin`/`Host` checks on the HTTP handler and WebSocket upgrade — which combined with the default 0.0.0.0:4022 bind and `--no-auth` dev shortcut opens DNS-rebinding and cross-site-WS concerns — and (2) floating-tag CI action pins coupled with an unbounded build-job token. Basic Auth timing, `__proto__` key filtering, and symlink-escape in the theme-pack reader are cheap wins; the rest is borderline noise for a LAN terminal frontend.

## Findings

- **No Origin/Host validation on HTTP or WebSocket** — `src/server/http.ts:180-194`, `src/server/ws.ts:39-62` · High/Verified · Cluster hint: `ws-csrf-dns-rebind` · → see cluster 01-ws-network-trust
- **Basic Auth uses non-constant-time string compare** — `src/server/http.ts:163` · Medium/Verified · Cluster hint: `auth-timing` · → see cluster 10-minor-security-hardening
- **Third-party GitHub Actions pinned to floating tags, not SHAs** — `.github/workflows/release.yml:30,35,84,103,130`, `.github/workflows/bump-homebrew-tap.yml:60` · Medium/Verified · Cluster hint: `ci-action-pin` · → see cluster 02-ci-supply-chain
- **Release workflow `build` job has no `permissions:` block** — `.github/workflows/release.yml:1-91` · Low/Plausible · Cluster hint: `ci-perms` · → see cluster 02-ci-supply-chain
- **Self-signed TLS cert+key regenerated on every start** — `src/server/tls.ts:11-31` · Low/Verified · Cluster hint: `tls-ephemeral-cert` · → see cluster 10-minor-security-hardening
- **`sanitiseSessions` key filter admits `__proto__`** — `src/server/sessions-store.ts:55-69` · Low/Verified · Cluster hint: `proto-pollution` · → see cluster 10-minor-security-hardening
- **Basic Auth password accepted on CLI** — `src/server/index.ts:57,82,143-146` · Low/Verified · Cluster hint: `password-cli-leak` · → see cluster 10-minor-security-hardening
- **`readPackFile` relies on `path.resolve`, not `fs.realpath`, for escape containment** — `src/server/themes.ts:193-203` · Low/Plausible · Cluster hint: `theme-symlink-escape` · → see cluster 10-minor-security-hardening
- **No upper-bound cap on OSC-52 write clipboard base64 forwarded to client** — `src/server/protocol.ts:46-50`, `src/server/ws.ts:308-323` · Low/Verified · Cluster hint: `osc52-write-dos` · → see cluster 09-fuzz-parsers
- **Alacritty TOML colour parser unfuzzed** — `src/server/colours.ts:17-48`, `src/server/themes.ts:140-171` · Low/Plausible · Cluster hint: `fuzz-toml-theme` · → see cluster 09-fuzz-parsers

## Checklist (owned items)

- `SEC-1 [x] see Findings above — inline at cluster 01/10`
- `GIT-3 [x] clean — no .env/.pem/.key/.pfx/.p12 in tracked tree or diff-filter=A git history`
- `FUZZ-1 [x] src/server/colours.ts (TOML), src/server/protocol.ts (OSC-52) — no fuzz/property coverage → cluster 09`
- `CI-1 [x] .github/workflows/*.yml — Actions pinned to tags, not SHAs → cluster 02`
- `CI-2 [x] .github/workflows/release.yml — build job missing permissions block → cluster 02`
- `CI-3 [x] clean — neither workflow triggers on pull_request; HOMEBREW_TAP_TOKEN used only under release:published and workflow_dispatch`
- `CI-4 [-] N/A — below profile threshold (project=T2); no self-hosted runners`
- `CONT-* [-] N/A — no Dockerfile`
- `IAC-* [-] N/A — no iac`
