# Executive summary

Top 5 clusters.

## 01 — ws-network-trust

- **Goal:** Close the DNS-rebind / cross-site-WebSocket gap so a malicious web page the user visits cannot reach `127.0.0.1:4022` and drive a real tmux PTY.
- **Files touched:** 2 · **Severity spread:** Critical: 0, High: 1, Medium: 0, Low: 0
- **Autonomy mix:** autofix-ready: 0, needs-decision: 1, needs-spec: 0
- **Est. session size:** Small
- **Why it's in the summary:** Only High-severity finding in the run. Combined with the default `--no-auth` dev wrapper and the 0.0.0.0 default bind, the missing `Origin`/`Host` check is a real attack path, not a theoretical one.
- **Read:** [cluster file](./clusters/01-ws-network-trust.md)

## 02 — ci-supply-chain

- **Goal:** Pin all third-party Actions to commit SHAs and narrow each job's `permissions:` so a tag-hijack or prompt-injection cannot escalate to `HOMEBREW_TAP_TOKEN` or repo-write.
- **Files touched:** 2 · **Severity spread:** Critical: 0, High: 0, Medium: 1, Low: 2
- **Autonomy mix:** autofix-ready: 3, needs-decision: 0, needs-spec: 0
- **Est. session size:** Small
- **Why it's in the summary:** Ships a Homebrew-distributed binary. Supply-chain hardening for the release workflow is the single highest-leverage batch of small edits in the run.
- **Read:** [cluster file](./clusters/02-ci-supply-chain.md)

## 04 — doc-drift

- **Goal:** Bring `CLAUDE.md` and `README.md` back in sync with the code they describe (protocol table, DOM contract, CLI flags, theme-switch field names, tmux.conf sourcing, LICENSE note).
- **Files touched:** 3 · **Severity spread:** Critical: 0, High: 0, Medium: 5, Low: 4
- **Autonomy mix:** autofix-ready: 9, needs-decision: 0, needs-spec: 0
- **Est. session size:** Small
- **Why it's in the summary:** `CLAUDE.md` is the project's contract with future contributors and future-you; silent drift here is expensive because every agent session starts from it. Nine targeted one-line fixes.
- **Read:** [cluster file](./clusters/04-doc-drift.md)

## 05 — backend-hygiene

- **Goal:** Close the bare `sendWindowState` floating-async call, guard the session-settings PUT body (error + size cap), cache `/api/colours` disk reads, remove the `--terminal` shim + unused `resolveTheme`, add subprocess timeouts and restrictive mkdir modes.
- **Files touched:** 6 · **Severity spread:** Critical: 0, High: 0, Medium: 2, Low: 6
- **Autonomy mix:** autofix-ready: 4, needs-decision: 4, needs-spec: 0
- **Est. session size:** Small
- **Why it's in the summary:** Two Medium findings in the async/input-guard layer that the rest of the server is consistent about — fixing them brings one file in line with the pattern already used elsewhere.
- **Read:** [cluster file](./clusters/05-backend-hygiene.md)

## 06 — test-coverage-framework

- **Goal:** Convert 8 unit files from `'vitest'` imports to `'bun:test'` (undeclared-dep risk), and add two E2E flows (file-drop upload + OSC-52 clipboard-read consent) that are security-relevant and currently uncovered.
- **Files touched:** 10 · **Severity spread:** Critical: 0, High: 0, Medium: 4, Low: 3
- **Autonomy mix:** autofix-ready: 1, needs-decision: 3, needs-spec: 2
- **Est. session size:** Medium
- **Why it's in the summary:** The vitest-import issue is latent — it works only because bun ships a compatibility shim — and the two missing E2E flows cover the project's two most security-relevant user paths.
- **Read:** [cluster file](./clusters/06-test-coverage-framework.md)
