# ws-network-trust — design

**Date:** 2026-04-18
**Source:** `docs/code-analysis/2026-04-17/clusters/01-ws-network-trust.md` (High-severity finding).

## Problem

`tmux-web` validates the TCP peer IP (`--allow-ip`, loopback always allowed) and HTTP Basic Auth, but performs no validation of the `Origin` or `Host` header on either HTTP requests or WebSocket upgrades. Combined with the default `0.0.0.0:4022` bind and the `tmux-web-dev` wrapper (`--no-auth --no-tls`), this opens two concrete attack paths:

- **DNS rebinding.** A page the user visits has DNS TTL=0 and rebinds its hostname to `127.0.0.1`; browser JS opens a WebSocket to `127.0.0.1:4022` and drives a real tmux PTY. The `LOCALHOST_IPS` allowlist does not defeat this because the socket peer really is `127.0.0.1`.
- **Cross-site WebSocket with cached Basic credentials.** Browsers exempt WebSocket upgrades from CORS and will send cached `Authorization: Basic` headers on cross-origin upgrades. A page the user visits can upgrade to the real host and, if the user's browser has visited tmux-web in the same session, drive the PTY.

Both attacks are caught by validating the browser-reported `Origin` header. Browsers always send `Origin` on cross-origin requests (fetch, XHR, WebSocket). Non-browser clients (curl, scripts) typically do not, and they remain gated by the existing IP allowlist and Basic Auth.

## Goals

1. Reject cross-origin HTTP requests and WebSocket upgrades by default.
2. Continue to work out of the box for the two common local cases: loopback browser access and LAN-IP browser access.
3. Expose a clear configuration path for reverse-proxied hostname access.
4. Preserve non-browser tooling (curl, API scripts) so long as they pass IP + auth.
5. Fail noisy and helpful — a blocked origin prints a one-line hint on how to allow it.

## Non-goals

- Replacing Basic Auth, TLS defaults, or the IP allowlist. This design layers on top of them.
- Parsing or trusting `X-Forwarded-*` headers. Reverse-proxy setups configure `--allow-ip <proxy>` and `--allow-origin <public-url>` explicitly.
- Rate limiting, CSRF tokens, or anything that would require client-side changes.

## Threat model (explicit)

- **In scope:** browser-based attackers on pages the user visits while a tmux-web instance is reachable on the user's machine or LAN.
- **Out of scope:** attackers with shell access to the user's machine; a rogue reverse-proxy operator; malicious browser extensions; TLS MitM.

## Design

### CLI

Two flags.

- `-i <ip>` / `--allow-ip <ip>`, repeatable — the existing flag gains a short alias.
- `-o <origin>` / `--allow-origin <origin>`, repeatable, new.

Defaults:

- `--allow-ip`: `127.0.0.1`, `::1`.
- `--allow-origin`: empty.

`--allow-origin` values are parsed as full origins: `scheme://host[:port]`. Scheme is `http` or `https`; port is optional and defaults to the scheme's standard port (`80` for `http`, `443` for `https`). Host is compared case-insensitively; trailing slashes are stripped. A single entry of `*` is accepted as an explicit wildcard.

### Allow rule

Applied per HTTP request and per WebSocket upgrade, after the IP allowlist check and before Basic Auth.

```
function isOriginAllowed(req, config) {
  const origin = req.headers.origin;
  if (!origin) return true;                 // non-browser / same-origin with omitted header
  if (config.allowedOrigins.includes('*')) return true;

  const url = parseOrigin(origin);           // fills implicit port from scheme (80/443)
  if (!url) return false;                    // malformed

  if (isIpLiteral(url.host)) {
    // Direct-access path: Origin describes THIS server's listen address.
    if (url.scheme !== serverScheme(config)) return false;
    if (url.port !== config.listenPort) return false;
    return config.allowedIps.includes(normaliseIp(url.host));
  }

  // Hostname path (reverse-proxy case): Origin describes the public URL the
  // browser is visiting, which may use a different scheme/port than the
  // server's listen address. Exact triple match against an --allow-origin entry.
  return config.allowedOrigins
    .some(entry => entry !== '*'
                && entry.host === url.host.toLowerCase()
                && entry.scheme === url.scheme
                && entry.port === url.port);
}
```

The hostname path deliberately does **not** check `serverScheme` or `listenPort`: when a reverse proxy fronts the server, the public origin (e.g. `https://tmux.example.com` on 443) legitimately differs from the server's actual bind (e.g. `http://127.0.0.1:4022`). The operator is trusted to list the correct public origin via `-o`; the IP allowlist (`-i <proxy-ip>`) still gates who can reach the server.

### Rejection behavior

- HTTP: `403 Forbidden` with a short body. Debug log records the offending origin.
- WebSocket upgrade: `HTTP/1.1 403 Forbidden` response line written to the socket, then `socket.destroy()` (mirrors the existing 401 pattern).
- In both cases, stderr receives one line: `tmux-web: rejected origin <origin> from <remoteIp> — add \`--allow-origin <origin>\` to accept`. Rate-limit to one log line per distinct origin per minute to avoid log flooding under attack.

### Startup warning

If `--allow-origin` contains `*` **and** `--allow-ip` contains any non-loopback entry (not `127.0.0.1`, `::1`, or a CIDR scoped to loopback), print to stderr at startup:

```
tmux-web: warning: --allow-origin * with non-loopback --allow-ip re-opens DNS rebinding;
  prefer listing explicit origins.
```

Does not prevent startup.

### Configuration shape

`ServerConfig` gains:

```ts
allowedOrigins: Array<{ scheme: 'http' | 'https'; host: string; port: number } | '*'>;
```

Canonicalised at parse time. Malformed `--allow-origin` arguments abort startup with a clear error (consistent with other parse failures).

### File layout

- **New:** `src/server/origin.ts` — pure helpers `parseOriginHeader(s)`, `parseAllowOriginFlag(s, listenPort)`, `isOriginAllowed(req, config)`. No I/O, trivially unit-testable.
- **Modified:** `src/server/index.ts` — parse `-o`, emit startup warning, populate `config.allowedOrigins`.
- **Modified:** `src/server/http.ts` — call `isOriginAllowed` between IP check and auth check; respond 403 on reject.
- **Modified:** `src/server/ws.ts` — same call, same position, 403-and-destroy on reject.
- **Modified:** `src/server/types.ts` (or wherever `ServerConfig` lives) — add `allowedOrigins` field.

### Example configurations

```
# Direct LAN access (works with default -i adding LAN IP)
tmux-web --listen 0.0.0.0:4022 -i 192.168.2.4

# Behind NPM at https://tmux.example.com (proxy at 10.0.0.5)
tmux-web --listen 127.0.0.1:4022 -i 10.0.0.5 \
  -o https://tmux.example.com

# Explicit wide-open (escape hatch, loopback only)
tmux-web-dev  # unchanged; --no-auth --no-tls on loopback + default -i works
```

## Testing

### New file: `tests/unit/server/origin.test.ts`

- Origin header absent → allowed.
- Origin `http://127.0.0.1:4022` with default `-i`, `--no-tls`, listen 4022 → allowed.
- Origin `http://[::1]:4022` with default `-i` → allowed (IPv6 bracket normalisation).
- Origin `http://192.168.2.4:4022` with `-i 192.168.2.4` → allowed.
- Origin `http://192.168.2.4:4022` without that IP in `-i` → rejected.
- Origin `https://evil.com` reaching a loopback server → rejected (DNS-rebind shape).
- Origin `https://tmux.example.com` with `-o https://tmux.example.com` → allowed (case-insensitive host).
- Origin scheme mismatch on IP path (`http` vs server `https`) → rejected.
- Origin port mismatch on IP path → rejected.
- Rev-proxy case: server on `http://127.0.0.1:4022`, `-o https://tmux.example.com`, Origin `https://tmux.example.com` (implicit 443) → allowed (IP path's scheme/port rule does not apply to hostname path).
- `-o *` wildcard → allowed for any origin.
- Malformed Origin value → rejected.

### Extend: `tests/unit/server/index.test.ts` (or `parseConfig` test file)

- `-o https://a.example -o https://b.example` → two canonicalised entries.
- `-o bad!value` → parse error.
- `-o * -i 192.168.1.0/24` → startup warning emitted to stderr.
- Default `-i` when none provided → `['127.0.0.1', '::1']`.

### Extend: E2E

- `tests/e2e/origin-check.test.ts` (new): start server on loopback with default config; issue HTTP GET to `/` with `Origin: https://evil.com` → expect 403.

### Regression: existing E2E

Playwright already runs against `127.0.0.1` on a fixed port — the default `-i` + IP-auto-allow rule keeps it green without changes. Verify explicitly.

## Rollout

Single commit on `main`. Bump minor version (behavior change, backward-compatible for the default loopback case but breaks cross-origin access that happened to work before). Add a CHANGELOG entry under *Added* and *Security*.

## CHANGELOG draft

```
## X.Y.Z — 2026-04-18

### Added
- `-i` short flag for `--allow-ip`.
- `-o` / `--allow-origin` flag to whitelist browser Origins for HTTP and WebSocket access. Repeatable. Values are full origins (`scheme://host[:port]`) or `*`.

### Security
- HTTP requests and WebSocket upgrades now validate the `Origin` header. Origins whose host is an IP literal in `--allow-ip` are auto-allowed; hostnames must appear in `--allow-origin`. Requests without an `Origin` header (curl, scripts) are unaffected. This closes a DNS-rebinding and cross-site-WebSocket vector identified in the 2026-04-17 code review.
```

## Open questions

None at design time.
