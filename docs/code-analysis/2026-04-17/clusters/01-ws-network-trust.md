# Cluster 01 — ws-network-trust

> **Goal:** Close the DNS-rebind / cross-site-WebSocket gap against the local HTTP + WS server.
>
> Session size: Small · Analysts: Security · Depends on: none

## Files touched

- `src/server/http.ts` (1 finding)
- `src/server/ws.ts` (1 finding — same defect, second anchor)

## Severity & autonomy

- Critical: 0 · High: 1 · Medium: 0 · Low: 0
- autofix-ready: 0 · needs-decision: 1 · needs-spec: 0

## Findings

- **No Origin/Host validation on HTTP or WebSocket** — The HTTP handler and the WS upgrade path ignore the `Origin` header entirely and trust whatever `Host` arrives. Combined with the default 0.0.0.0 bind and the `tmux-web-dev` wrapper's `--no-auth --no-tls`, a web page the user visits can perform **DNS rebinding** against `127.0.0.1:4022`, open a WebSocket, and drive a real tmux PTY. Even with Basic Auth enabled, a browser that has cached credentials for the origin will send them on a cross-site WS upgrade (WS is exempt from CORS). The `LOCALHOST_IPS` allowlist does not defeat rebinding because the socket peer really is 127.0.0.1.
  - Location: `src/server/http.ts:180-194`, `src/server/ws.ts:39-62`
  - Severity: High · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `ws-csrf-dns-rebind`
  - Raised by: Security
  - Notes: Mitigations to consider (not exclusive): enforce `Origin` against a configurable allowlist that defaults to `https://<bind-host>:<port>` and `https://localhost:<port>`; reject unexpected `Host` header values; make `--no-auth` refuse to bind anything other than loopback unless the user explicitly opts in with a second flag.

## Suggested session approach

This is one defect with two anchors, not two independent bugs. Brainstorm the `Origin`/`Host` policy first (what should the default allowlist contain, and how does it interact with `--allow-ip`), then implement the check in a single shared helper used by both the HTTP 403 path and the WS upgrade reject path. The `--no-auth` + non-loopback bind combination is worth a separate decision — whether to warn, refuse, or require an opt-in flag.
