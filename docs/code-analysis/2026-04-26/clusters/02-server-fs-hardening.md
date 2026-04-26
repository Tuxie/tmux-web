---
Status: open
Autonomy: autofix-ready
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 02 — server-fs-hardening

## TL;DR

- **Goal:** Apply four small defensive improvements to the server's filesystem and probe surfaces — true LRU on the origin-reject map, exclusive-create on the TLS keypair temp file, drop the never-used multi-key warn-times Map shape, replace `Math.random` token with `crypto.randomBytes`.
- **Impact:** Tightens edge-case correctness without changing observable behaviour. The TLS .part finding in particular is the kind of "narrow but real" attack surface that pays for itself if the daemon ever runs in a multi-user host.
- **Size:** Small (<2h).
- **Depends on:** none
- **Severity:** Low
- **Autonomy (cluster level):** autofix-ready

## Header

> Session size: Small · Analysts: Backend, Security · Depends on: none · Autonomy: autofix-ready

## Files touched

- `src/server/origin.ts` (1 finding)
- `src/server/protocol.ts` (1 finding)
- `src/server/tls.ts` (1 finding)
- `src/server/tmux-control.ts` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 4
- autofix-ready: 3 · needs-decision: 1

## Findings

- **`logOriginReject` uses Map-as-LRU eviction (single-entry-per-overflow) which is O(N) on each overflow** — `origin.ts:111-114` deletes one oldest entry per call when the map exceeds 256. Under sustained attack this means each rejected origin past the cap pays the same cost, which is fine (256 is small), but more importantly the comment says "Map preserves insertion order; the first key is the oldest" — true on insert but not on update. `recentOriginRejects.set(origin, now)` re-uses the existing key, leaving its insertion position unchanged. So an origin that gets seen many times within the 60-second rate-limit window stays at the front of the iterator and is the first eviction candidate after the cap is reached, which inverts the intended LRU semantics (delete least-recently-seen, not first-inserted).
  - Location: `src/server/origin.ts:106-119`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `server-fs-hardening`
  - Fix: in `logOriginReject`, when an origin already exists in the map, `delete` then `set` so the entry moves to the end of insertion order (true LRU): `recentOriginRejects.delete(origin); recentOriginRejects.set(origin, now);`.
  - Raised by: Backend

- **OSC52 `_osc52WarnTimes` map grows unboundedly in pathological cases (de-facto bounded today but no cap)** — `protocol.ts:37,40-48` has a single key (`'osc52-write-too-large'`) so the Map has at most one entry. Defensive against future expansion only — the same rate-limit pattern in `origin.ts:111` is properly capped at 256. Symmetry and "you'll thank yourself later" — match the cap.
  - Location: `src/server/protocol.ts:37-48`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `server-fs-hardening`
  - Fix: collapse `_osc52WarnTimes` to a single `_osc52LastWarnAt = 0` number — the key was forward-looking but never used; one-warn-per-minute on size overflow is the only call pattern.
  - Raised by: Backend

- **Persistent self-signed cert key written without exclusive-create check** — `tls.ts:75-79` writes `selfsigned.key.part` via `writeFileSync` without `O_EXCL`/`flag: 'wx'` and without verifying the directory wasn't a hostile pre-existing symlink. The cert/key directory is created with `mode: 0o700` (good), but the `.part` files are written with `mode: 0o600` then `renameSync`'d. If an attacker controls `<configDir>/tls/` (e.g. sibling user with write access to a shared parent, or a stale dir from an earlier run with weaker perms) they could place a symlink at `selfsigned.key.part` pointing somewhere they can read, capturing the freshly-generated private key on first start. The `mkdirSync({recursive: true, mode: 0o700})` only sets mode on dirs it creates.
  - Location: `src/server/tls.ts:73-79`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `server-fs-hardening`
  - Notes: T2 local-first. Threat assumes a same-host attacker who already controls a parent directory; very narrow. Could open with `flag: 'wx'` + explicit unlink-stale-`.part`-first.
  - Raised by: Backend

- **`Math.random()` is used as the readiness-probe token for the tmux control client** — `ControlClient.probe()` builds a token via `Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)`. The token is never sent across an attacker-controllable boundary (it's written to the tmux child's stdin and matched against its own `display-message` echo), so this is **not** a security defect today. Calling it out so it doesn't get reused as an authentication token in a future refactor.
  - Location: `src/server/tmux-control.ts:319`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `crypto-hygiene`
  - Fix: Replace with `crypto.randomBytes(8).toString('hex')` (matches `file-drop.ts:215`'s pattern). Mechanical; one line; cannot regress correctness.
  - Raised by: Security

## Suggested session approach

Subagent-driven mechanical sweep. The four findings are independent; apply each fix and verify the type checker remains green plus existing tests still pass. The TLS `.part` exclusive-create change needs a one-line addition to `writeFileSync(path, data, {mode: 0o600, flag: 'wx'})` plus a defensive `try { fs.unlinkSync(partPath); } catch {}` directly above to clear stale `.part` files from prior crashed runs — verify by manually creating a stale `.part` file and re-running `--reset` to confirm the unlink succeeds. The other three are pure substitutions.

Verify with `make typecheck && make test-unit && make test-e2e`. No new tests required — these are existing-behaviour-preserving substitutions.
