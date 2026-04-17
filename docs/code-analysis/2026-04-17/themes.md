# Themes

Cross-cutting patterns surfaced across analysts.

## Missing size/time bounds on untrusted input surfaces

- **Pattern:** Several endpoints accept untrusted input with no explicit size or timeout cap. PUT body on `/api/session-settings` has no size limit (contrast `/api/drop` at 50 MiB). OSC-52 **write** passthrough has no length cap (the **read** path does). `execFileAsync` calls for tmux subcommands have no `{timeout}` option.
- **Occurrences:** 3 across 3 files.
- **Sample locations:** `src/server/http.ts:447`, `src/server/protocol.ts:46`, `src/server/ws.ts:87`
- **Severity:** Medium
- **Raised by:** Backend, Security
- **Fix sketch:** Apply the existing 50 MiB / 1 MiB pattern consistently; settle on a default `execFileAsync` timeout (e.g. 5 s) and thread it through the wrapper.
- **Addressed in clusters:** 05-backend-hygiene, 09-fuzz-parsers

## Type escape hatches without justification

- **Pattern:** `as any` casts appear in both server (`colours.ts`, `file-drop.ts`, `ws.ts`) and client (`theme.ts`, `index.ts`) without a `// safe: <reason>` comment. Some are genuinely load-bearing (Bun TOML parse result, Node/Bun `Duplex` vs `net.Socket`), others are avoidable (`document.fonts` is properly typed in `lib.dom.d.ts`).
- **Occurrences:** 7 across 5 files.
- **Sample locations:** `src/server/colours.ts:18,32,34`, `src/server/file-drop.ts:214`, `src/server/ws.ts:40,196`, `src/client/theme.ts:55`, `src/client/index.ts:89`
- **Severity:** Low
- **Raised by:** Backend, Frontend
- **Fix sketch:** Add a one-line justification comment to every surviving cast; replace the ones that have a proper type (`document.fonts`, `out as Record<string,string>`).
- **Addressed in clusters:** 05-backend-hygiene, 07-frontend-hygiene

## Drift between `CLAUDE.md` and the code it describes

- **Pattern:** `CLAUDE.md` is the project's authoritative architecture doc and is loaded into every agent session, but multiple concrete claims no longer match the code: the protocol TT-message table is missing a key, the window-tab click is described as a keystroke when it is a WS message, the theme-switch semantics names `lineHeight` where the code uses `spacing`, and the DOM contract lists `#btn-fullscreen` when the element is `#chk-fullscreen`. README has parallel drift on tmux.conf sourcing and LICENSE.
- **Occurrences:** 9 across 3 files.
- **Sample locations:** `CLAUDE.md:181`, `CLAUDE.md:187-193`, `CLAUDE.md:207`, `CLAUDE.md:265`, `CLAUDE.md:290`, `README.md:97-104`, `README.md:143`.
- **Severity:** Medium
- **Raised by:** Docs
- **Fix sketch:** One-line edits, no restructuring. See cluster 04.
- **Addressed in clusters:** 04-doc-drift

## Unfuzzed / untested parser surfaces accepting attacker-shaped input

- **Pattern:** Two parser surfaces read attacker-influenced input with no property / fuzz / adversarial-input tests: the Alacritty TOML colour parser (`colours.ts:normalize`) reads user theme-pack files, and the OSC-52 regex path in `protocol.ts` extracts a base64 payload with no length cap or size-guarded property test.
- **Occurrences:** 2 across 2 files.
- **Sample locations:** `src/server/colours.ts:8`, `src/server/protocol.ts:24`
- **Severity:** Low
- **Raised by:** Security, Test
- **Fix sketch:** A handful of targeted edge-case tests plus a 1 MiB cap on the OSC-52 write path. Not a full fuzz harness for T2.
- **Addressed in clusters:** 09-fuzz-parsers
