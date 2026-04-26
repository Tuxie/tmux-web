# Executive summary

Top clusters selected per `synthesis.md` §7. The threshold rule is: cluster must contain ≥1 Critical or High finding, ≥1 Verified or Plausible confidence, and span >1 file or sit on a security-sensitive path.

_No clusters met Executive Summary thresholds this run._

This is a healthy outcome for a well-maintained T2 OSS project. Every analyst's strongest findings landed in the Medium severity band — there is no auth bypass, no remote code execution surface, no data-loss path, no architectural breakage. The sharpest findings cluster around defence-in-depth (post-auth amplifiers, artifact-vs-source coverage gaps, CI workflow ergonomics) rather than load-bearing correctness bugs.

If you wanted a ranked starting point anyway, the highest-impact-but-still-Medium clusters are (in order of suggested fix sequence — not Executive Summary qualification):

1. **Cluster 03 — endpoint-hardening** (Security, 5 findings). The `/api/exit` route lets a single authenticated POST kill or restart the server with no per-route confirmation; the OSC 52 read path can amplify a 1 MiB clipboard reply into ~2 MiB of hex argv that DOS-es the tmux control client; `/api/drops/paste` accepts arbitrary `?session=`. None are exploitable from outside the auth boundary, but each is a chain-amplifier for a stolen credential or XSS. Cluster spans `src/server/http.ts`, `src/server/ws-router.ts`, `src/server/tmux-inject.ts`.
2. **Cluster 05 — ci-artifact-verification** (Security + Tooling + Test, 4 findings). CI builds the binary, runs `bun test` against source, and runs `verify-vendor-xterm.ts` (a real artifact-level check), but no step extracts and exercises the actual tarball users download. AGENTS.md:7-22 documents that the vendor-xterm bundle has silently regressed five times — the v1.8.0 bunfs/embedded-tmux precedent is a textbook example.
3. **Cluster 01 — tmux-control-and-listings** (Backend, 6 findings). Six near-identical inline parsers for `tmux list-sessions` / `list-windows` / `display-message` outputs across `http.ts` and `ws.ts`, plus a UTF-8 chunk-decoder bug in `ControlClient` that splits multi-byte codepoints. Cluster is mostly autofix-ready and the largest mechanical cleanup in the report.
4. **Cluster 18 — test-flaky-sleeps** (Test, 9 findings). ~17 raw `setTimeout` waits in `ws-handle-connection.test.ts` and several e2e specs use wall-clock sleeps where event/poll signals exist. Several are currently bounding 500–1500 ms operations with no observable, paying ~2-3 seconds of test time per run for no signal.
5. **Cluster 09 — frontend-a11y** (Frontend, 3 findings). Settings menu form controls (17 sliders, 4 number inputs, 3 selects) use orphan `<span>` labels instead of `<label for>`; clipboard-prompt modal traps Escape but not Tab; dynamic buttons default to `type="submit"`. Real screen-reader regression on the auth-gated UI.

Synthesis explicitly chose not to promote these into the Executive Summary because the formal thresholds matter — Medium-only output is the truthful picture of this run, and inflating to Critical/High to fill the section would mislead the reader. Use the cluster index in `README.md` to drive fix sequencing.
