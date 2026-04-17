# Suggested CLAUDE.md additions (META-1)

Drafts of rules that would have prevented ≥3 recurring finding shapes in this run.

- **"Every input surface that accepts untrusted bytes must declare an explicit size cap and an explicit error path."** — prevents: `input-guard` (http.ts:447), `osc52-write-dos` (protocol.ts:46), and generalises the existing 50 MiB cap in the drop handler at http.ts:381-394. Rationale: the project already has the right pattern in one place; a rule would catch future endpoints and the OSC-52 write gap that were missed.

- **"Every `as any` cast must carry a `// safe: <reason>` comment; otherwise use a narrower type."** — prevents: the 7 unjustified casts surfaced across `colours.ts`, `file-drop.ts`, `ws.ts`, `theme.ts`, `index.ts`. Rationale: some casts are genuinely load-bearing (Bun TOML result, `Duplex` vs `net.Socket`), so a blanket ban is wrong, but silent casts prevent future reviewers from assessing the risk. A one-line justification is cheap.

- **"Every `ResizeObserver` / `MutationObserver` / `addEventListener` installed in the client must return a teardown function that disconnects/removes it, even if the caller is page-lifetime."** — prevents: `resize-fit` (dual observer on `#terminal`), `resource-cleanup` (drops-panel MutationObserver), and the xterm.ts:98 ResizeObserver. Rationale: the project's own `installFileDropHandler` already follows this pattern; making it a universal rule would catch the divergent sites.

- **"Every GitHub Action reference in `.github/workflows/` must be pinned to a commit SHA, with the version tag left as a trailing `# vX.Y.Z` comment."** — prevents: `ci-action-pin` (6 references), and gives reviewers a mechanical grep to enforce the rule. Rationale: the project ships a Homebrew-distributed binary, so release-workflow supply-chain is a real concern.

- **"When a CLAUDE.md section names a concrete symbol (DOM id, JSON key, field, flag, keystroke), it is a contract that a reviewer must verify against the code before merging changes that rename or remove the referenced thing."** — prevents: all 5 Medium doc-drift findings in cluster 04 (`title` key, `Ctrl-S <index>`, `lineHeight`/`defaultLineHeight`, `#btn-fullscreen`, tmux.conf paths). Rationale: CLAUDE.md is loaded into every agent session; drift there compounds across every future task.
