---
Status: partial
Autonomy: needs-decision
Resolved-in: 0fe9ad1dccf16cb3d65649dc6598e848428b80ea (partial — F5 homebrew-tap SHA validation deferred per 2026-04-26 preflight decision)
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 04 — security-low-defenses

## TL;DR

- **Goal:** Five small Security findings that share severity (Low) and decision axis (defence-in-depth, not load-bearing) but live in unrelated subsystems — OSC-title trust, --reset TLS verification, IPv6 allowlist canonicalization, homebrew-tap supply chain.
- **Impact:** Closes corner cases; none are exploitable today. Honest catch-all per synthesis §6 step 4.
- **Size:** Medium (half-day across all five; could split if a session opens with one in mind).
- **Depends on:** none
- **Severity:** Low (all five)
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Security · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/ws.ts` (2 findings)
- `src/server/http.ts` (1 finding)
- `src/server/index.ts` (1 finding)
- `src/server/origin.ts` (1 finding)
- `.github/workflows/bump-homebrew-tap.yml` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 4
- autofix-ready: 1 · needs-decision: 4 · needs-spec: 0

## Findings

- **OSC-title-driven session switch validates only existence; an attacker-controlled pane can force WS rebinding to any tmux session the user has** — `handleTitleChange` in `ws.ts` reads OSC titles emitted by tmux/the shell, splits on `:`, and if the prefix matches a known tmux session, *moves the WS connection to that session*, attaches a control client, and tears down the old one. There is no policy that the OSC-title-driven session switch be limited to sessions the user "owns" — anyone running code in a pane (e.g. `printf '\x1b]0;target-session:foo\x07'` from inside a less-trusted command) can re-target the WS to a different tmux session and gain visibility/keystrokes for that session. Tmux is single-user so this is not a privilege escalation, but a hostile script run inside one pane can hijack the browser's view to a different tmux session the user did not intend to expose to that script. The PTY itself stays bound to the original session so keystrokes still go to the original session, but the browser starts forwarding window/title/scrollbar info from the hijacked session and the URL bar updates.
  - Location: `src/server/ws.ts:341-386`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `osc-title-trust`
  - Notes: Mitigated: the existing `tmuxSessionExists` check rejects unknown names, and the docstring acknowledges the trust-laundering of OSC titles. Local-first calibration "code running as the user on their own box" sets the floor; the residual is the cross-pane horizontal-move attack inside a single user's tmux server. Worth tracking; not worth blocking a release for.
  - Raised by: Security

- **OSC 52 read content delivery uses `state.lastSession` which can be reassigned mid-flight by an OSC title** — `replyToRead` (OSC 52) and `formatDropPasteBytes` (file-drop) call `sendBytesToPane({ target: state.lastSession, … })`. `state.lastSession` is mutated whenever an OSC title introduces a recognised session (see `handleTitleChange` → `moveWsToSession`). A request initiated against session A whose `replyToRead` runs after `handleTitleChange` has rotated `lastSession` to session B will deliver clipboard/file bytes into B's active pane. The window is small (between "OSC 52 read request seen on stream A" and `await deliverOsc52Reply`), but it's real, and grants for binary X on session A get dispensed onto pane Y in session B.
  - Location: `src/server/ws.ts:669-688` (replyToRead)
  - Location: `src/server/http.ts:437-464` (drops/paste)
  - Location: `src/server/ws.ts:802-831` (moveWsToSession mutates `lastSession`)
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `osc-title-trust`
  - Notes: Static-only — confirming that the race window is reachable in practice requires runtime tracing of OSC title emission interleaved with OSC 52 reads. The fix is to capture the session name at the time the pending-read entry is created (`pendingReads.get(reqId).session`) and pass that snapshot to `replyToRead`, not `state.lastSession`.
  - Raised by: Security

- **`--reset` POSTs the saved Basic Auth credentials with `rejectUnauthorized: false` over HTTPS** — When a user runs `tmux-web --reset` against an existing instance, the code synthesises a `https://127.0.0.1:port/api/exit?action=restart` URL, attaches `Authorization: Basic <user:pass>`, and calls `fetch` with `tls: { rejectUnauthorized: false }`. With `--reset`, `host` may be a non-loopback bind (e.g. `0.0.0.0`) and the code remaps `0.0.0.0`/`::` → `127.0.0.1` for the connect host, but `rejectUnauthorized: false` means a stranger holding the local TLS port (on a multi-user box: any other user owning the listening socket on `127.0.0.1:4022` because the existing server died and someone else opened that port) would receive the credential. The cert has been pinned to a stable file (`tls/selfsigned.crt`), so verifying against it is feasible.
  - Location: `src/server/index.ts:240-252`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `tls-trust`
  - Notes: Local-first calibration applies. Real risk is bounded (loopback target on a single-user box is the dominant case), but the code disables TLS verification *and* sends a long-lived secret in the same request. Either pin the persisted self-signed cert (`tls/selfsigned.crt`) and verify against it, or deliver `--reset` via a Unix socket / SIGTERM rather than an authenticated HTTP request.
  - Raised by: Security

- **Origin allowlist auto-allows IP-literal origins whose host matches `--allow-ip`, but the IP literal is matched lower-cased without normalising IPv6 short forms** — `parseOriginHeader` lower-cases hostnames and strips IPv6 brackets, but `--allow-ip` entries are stored as-given (`new Set<string>(['127.0.0.1', '::1', ...rawAllowIps])`). A user passing `--allow-ip ::1` will match an Origin of `http://[::1]:4022`; a user passing `--allow-ip ::0001:0` will not match `http://[::1:0]:4022`. Ditto IPv4-mapped (`::ffff:127.0.0.1` is normalised in `normaliseIpV4Mapped`, but only one direction). The existing tests cover the documented forms; the gap is "non-canonical IPv6 in the user's `--allow-ip` flag silently fails-closed" rather than a privilege escalation.
  - Location: `src/server/origin.ts:78-83`
  - Location: `src/server/index.ts:118-119`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `ipv6-canonicalisation`
  - Notes: Plausible-not-Verified because the failure mode is "user gets `403` and notices"; not exploitable. Right-sized fix is to canonicalise `--allow-ip` entries through the same normaliser at parse time, but the canonicalisation function would need to handle 6-7 IPv6 zero-compression edge cases.
  - Raised by: Security

- **`bump-homebrew-tap.yml` workflow checks out `Tuxie/homebrew-tap` with a long-lived PAT (`HOMEBREW_TAP_TOKEN`) and runs an inline Python rewriter** — The rewriter takes `VERSION` and four `*_*64` SHAs from `${{ steps.shas.outputs.* }}` and embeds them into a `re.sub` replacement. The SHAs are sourced from `curl -fsSL "$url" | awk '{print $1}'` against `https://github.com/${{ github.repository }}/releases/download/${TAG}/tmux-web-${TAG}-${arch}.tar.xz.sha256`. If the release-download step is ever upstream-redirected (e.g. CDN compromise) or the `awk '{print $1}'` parse is fooled by an unusual sidecar (a sha-line containing whitespace tricks), an attacker controlling that asset could inject Ruby into `Formula/tmux-web.rb`. The `python3` rewriter does not validate that each SHA is exactly 64 lowercase-hex bytes before substituting.
  - Location: `.github/workflows/bump-homebrew-tap.yml:62-77, 104-136`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-supply-chain`
  - Fix: After the `awk` parse, validate `[[ "$sha" =~ ^[0-9a-f]{64}$ ]]` and `exit 1` on mismatch. Defence in depth — the asset originates from the same release the workflow just produced, so today's threat model is internally consistent, but the validation is a one-line guard against a future regression where SHAs come from a less-trusted source.
  - Raised by: Security

## Suggested session approach

Honest catch-all per synthesis §6. Each finding is a small standalone decision; pair them in a single brainstorming session because batching maintainer interviews matters more than batching commits. The OSC-title-trust pair (two findings) shares the same root: trusting `state.lastSession` as a stable identity across async work — they should be decided together. The TLS, IPv6, and supply-chain findings are independent.

If only one is picked up, take the OSC-title pair: the session-snapshot fix (capture `state.lastSession` at the time of `pendingReads.set`, pass through to `replyToRead`) closes the documented race and is small. The OSC-title trust laundering itself (Finding 1) is more philosophical — the existing docstring acknowledges it as accepted risk; the meaningful question is whether to add an opt-in `--allow-osc-session-switch` flag for paranoid deployments.
