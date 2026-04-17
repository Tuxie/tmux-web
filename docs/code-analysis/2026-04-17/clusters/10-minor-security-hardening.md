# Cluster 10 — minor-security-hardening

> **Goal:** Close several low-severity security papercuts: timing-safe Basic Auth compare, persist the self-signed TLS cert across restarts, prototype-pollution filter on session keys, theme-pack symlink escape, CLI-visible password.
>
> Session size: Small · Analysts: Security · Depends on: none

## Files touched

- `src/server/http.ts` (timing-safe compare)
- `src/server/tls.ts` (cert persistence)
- `src/server/sessions-store.ts` (`__proto__` filter)
- `src/server/themes.ts` (symlink escape)
- `src/server/index.ts` (`--password` warning)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 4
- autofix-ready: 2 · needs-decision: 3 · needs-spec: 0

## Findings

- **Basic Auth uses non-constant-time string compare** — `user === config.auth.username && pass === config.auth.password`. JS string equality short-circuits on length and prefix, leaking timing. Over loopback/LAN the signal is weak, but the fix is mechanical and the tool is documented to sometimes run over a network.
  - Location: `src/server/http.ts:163`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `auth-timing`
  - Raised by: Backend, Security
  - Fix: Compare using `crypto.timingSafeEqual` with equal-length Buffers (pad or HMAC-normalise). Check both fields timing-safe.

- **Self-signed TLS cert regenerated on every process start** — `generateSelfSignedCert()` creates a fresh RSA-2048 cert each start into a tempdir that is immediately unlinked; the key lives only in memory. Consequences: every restart changes the cert fingerprint (users trained to click through warnings), and cached Basic creds scope to the ephemeral cert context.
  - Location: `src/server/tls.ts:11-31`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `tls-ephemeral-cert`
  - Raised by: Security
  - Notes: Persist the cert under `$XDG_CONFIG_HOME/tmux-web/` at mode 0600 so fingerprint pinning survives restarts; regenerate only if the file is missing or past a configured expiry.

- **`sanitiseSessions` key filter admits `__proto__`** — `isValidSessionName` rejects empty / whitespace-only / `[object `-prefixed keys but not `__proto__` / `constructor` / `prototype`. `out[k] = v` on a fresh object literal invokes the Object-prototype setter for `__proto__`. Current impact: the polluted object is immediately spread and JSON-serialised, so nothing persists to disk. Any future refactor that enumerates or has a missing-key lookup would hit the pollution.
  - Location: `src/server/sessions-store.ts:55-69`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `proto-pollution`
  - Raised by: Security
  - Fix: `if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;` at the top of the sanitise loop, or build `out` with `Object.create(null)`.

- **`readPackFile` relies on `path.resolve` (not `fs.realpath`) for escape containment** — A theme-pack file under `themesUserDir` that is a symlink to `/etc/passwd` would pass `isValidPackRelPath` (no `..`, no leading `/`) and `resolved.startsWith(root + sep)` (the link path is under root, but its target isn't). Exploitation requires an attacker who can already drop files into `~/.config/tmux-web/themes/...`.
  - Location: `src/server/themes.ts:193-203`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `theme-symlink-escape`
  - Raised by: Security
  - Fix: Call `fs.realpathSync(resolved)` and compare it to `fs.realpathSync(pack.fullPath) + sep`.

- **Basic Auth password accepted on CLI** — `--password` is documented and wired. On shared systems it leaks via `/proc/<pid>/cmdline` and shell history. `$TMUX_WEB_PASSWORD` is the preferred path.
  - Location: `src/server/index.ts:57`, `src/server/index.ts:82`, `src/server/index.ts:143-146`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `password-cli-leak`
  - Raised by: Security
  - Notes: Warn on stderr when `--password` is used in place of the env var; optionally blank the argv entry after parse (cosmetic — doesn't clear `/proc` at the moment of observation but limits later inspection).

## Suggested session approach

`auth-timing` and `proto-pollution` are autofix-ready — commit those first. `tls-ephemeral-cert` is a 15-minute design discussion (where to store, when to regenerate, does persistence break the `--test` mode expectation). `password-cli-leak` is a cheap stderr warning. `theme-symlink-escape` is one line if you go with `realpathSync`.
