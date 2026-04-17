# Cluster 04 — doc-drift

> **Goal:** Bring `CLAUDE.md` and `README.md` back in sync with the code they describe.
>
> Session size: Small · Analysts: Docs · Depends on: none

## Files touched

- `CLAUDE.md` (5 findings)
- `README.md` (3 findings)
- `docs/superpowers/plans/2026-04-15-colours-and-ghostty-removal.md` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 5 · Low: 4
- autofix-ready: 9 · needs-decision: 0 · needs-spec: 0

## Findings

- **CLAUDE.md protocol table missing `title` key** — `ServerMessage.title` (active pane title string) is sent via `ws.send(frameTTMessage({ session, windows, title }))` and declared in `src/shared/types.ts:56`, but the protocol table omits it.
  - Location: `CLAUDE.md:187-193`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `protocol-drift`
  - Raised by: Docs
  - Fix: Add row `| \`title\` | OSC title change | active pane title string |`.

- **CLAUDE.md window-tab click described as `Ctrl-S <index>` — it is actually a WS action message** — The implementation (`topbar.ts:sendWindowMsg`, `ws.ts:342`) sends `{type:'window', action:'select', index}` which calls `tmux select-window` server-side. No key sequence is injected into the PTY.
  - Location: `CLAUDE.md:265`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `protocol-drift`
  - Raised by: Docs
  - Fix: Replace "click send `Ctrl-S <index>`" with "click sends a `{type:'window', action:'select', index}` WS message".

- **CLAUDE.md theme-switch semantics names `lineHeight` / `defaultLineHeight` — the code uses `spacing` / `defaultSpacing`** — `themes/default/theme.json:25` and `themes/amiga/theme.json:15` declare `defaultSpacing`; `sessions-store.ts:30` stores `spacing`. `lineHeight` / `defaultLineHeight` do not exist.
  - Location: `CLAUDE.md:181`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `schema-drift`
  - Raised by: Docs
  - Fix: Replace `lineHeight` → `spacing`, `defaultLineHeight` → `defaultSpacing`.

- **README tmux.conf sourcing section shows 2 of 6 paths** — README's snippet shows `~/.config/tmux/tmux.conf` and `~/.tmux.conf`; the actual `tmux.conf` sources 6: `/etc/tmux.conf`, `~/.tmux.conf`, `~/.config/tmux/tmux.conf`, `/etc/tmux-web.conf`, `~/.config/tmux-web/tmux.conf`, `~/.config/tmux-web/tmux-web.conf`. The full list is correctly in CLAUDE.md; README lags.
  - Location: `README.md:97-104`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `readme-drift`
  - Raised by: Docs

- **`#btn-fullscreen` listed in CLAUDE.md DOM contract — the element is `#chk-fullscreen`** — `index.html` has no `#btn-fullscreen`; fullscreen is controlled by a checkbox `#chk-fullscreen` inside the settings menu. `topbar.ts` references `chk-fullscreen` only.
  - Location: `CLAUDE.md:290`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dom-contract-drift`
  - Raised by: Docs
  - Fix: Replace `#btn-fullscreen — toggle button` with `#chk-fullscreen — fullscreen checkbox (inside settings menu)`.

- **CLAUDE.md CLI Options table is incomplete** — Lists 8 flags; `parseConfig` in `src/server/index.ts:48-73` and `--help` define 14. Missing: `--tmux`, `--tmux-conf`, `--themes-dir`, `--theme`/`-t`, `--debug`/`-d`, `--version`/`-V`. Also: `--tls-cert` and `--tls-key` are shown as a single entry instead of two flags with file arguments.
  - Location: `CLAUDE.md:98-108`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `cli-drift`
  - Raised by: Docs

- **README LICENSE hedge stale** — README: "See `LICENSE` if present, otherwise treat as all rights reserved by the author." The MIT `LICENSE` is present and tracked.
  - Location: `README.md:143`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `readme-drift`
  - Raised by: Docs
  - Fix: Replace with `MIT — see [LICENSE](LICENSE).`

- **Superpowers plan describes `localStorage`-based session settings; implementation shipped server-side** — The plan specifies per-session `localStorage`; the delivered impl uses `~/.config/tmux-web/sessions.json` via `PUT /api/session-settings`. Plan is 2 days old, not DEAD-3, but now misleads any reader tracing the design.
  - Location: `docs/superpowers/plans/2026-04-15-colours-and-ghostty-removal.md:7`, `docs/superpowers/plans/2026-04-15-colours-and-ghostty-removal.md:20`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `stale-plan`
  - Raised by: Docs
  - Notes: Either annotate the plan with an "UPDATE 2026-04-16: shipped server-side instead, see commit <sha>" note, or archive it.

- **Grammar error in CLAUDE.md mouse workaround description** — "Backends no forward mouse button as SGR for tmux." is an ungrammatical fragment.
  - Location: `CLAUDE.md:207`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `typo`
  - Raised by: Docs
  - Fix: Replace with "Backends do not forward mouse buttons as SGR sequences to tmux."

## Suggested session approach

Nine targeted edits, all autofix-ready except the stale plan (which needs a one-call decision: annotate vs archive). Dispatch a subagent to apply them in a single commit; spot-check the protocol table and DOM contract against `src/shared/types.ts` and `src/client/index.html` respectively before committing.
