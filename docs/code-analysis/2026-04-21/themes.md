# Themes

Cross-cutting patterns surfaced per `synthesis.md` §5. Each theme links to the clusters that address it.

## Untested client UI surface

- **Pattern:** Multiple client UI modules have no unit-test imports, so Bun never instruments them for coverage. The E2E suite exercises these modules at a black-box level but leaves per-function coverage at 0%. Separately, the core WebGL adapter (`xterm.ts`, 672 lines) is at 61% funcs / 72% lines and is permanently excluded from the project's own coverage gate.
- **Occurrences:** 6 across 6 files.
- **Sample locations:** `src/client/ui/topbar.ts`, `src/client/ui/dropdown.ts`, `src/client/ui/toast.ts`, `src/client/ui/drops-panel.ts`, `src/client/connection.ts`, `src/client/adapters/xterm.ts`
- **Severity:** High
- **Raised by:** Coverage & Profiling Analyst, Test Analyst
- **Fix sketch:** The project already ships a JSDOM unit-test harness at `tests/unit/client/_dom.ts`. Writing module-level imports that touch the public surface of each untested file (even without deep assertions initially) is enough to get Bun to instrument them and surface genuine coverage numbers. The xterm.ts case is different — it needs either a WebGL mock or a scoped test fixture around the patch functions.
- **Addressed in clusters:** `02-client-unit-test-coverage`

## Security-sensitive parsers without property tests

- **Pattern:** The server- and client-side input decoders/parsers that run over adversarial input (shell-quoted strings, session names, filenames, OSC/TT escape streams, origin headers, JSON from WS, user theme TOML, `/proc/<pid>/stat` fields) are each covered by hand-picked fixture tests. No property-based or fuzz framework is present in `package.json`. The invariants these parsers must uphold — "round-trips through a real POSIX shell", "never allows path escape", "always terminates", "never emits a quote character" — are easy to state and would catch regressions no fixture test can anticipate.
- **Occurrences:** 9 across 9 files.
- **Sample locations:** `src/server/shell-quote.ts`, `src/server/pty.ts` (sanitizeSession), `src/server/file-drop.ts` (sanitiseFilename), `src/server/protocol.ts` (processData), `src/server/origin.ts` (parseOriginHeader), `src/server/ws-router.ts` (routeClientMessage), `src/server/colours.ts` (alacrittyTomlToITheme), `src/server/foreground-process.ts` (parseForegroundFromProc), `src/client/protocol.ts` (extractTTMessages)
- **Severity:** Medium
- **Raised by:** Security Analyst, Test Analyst
- **Fix sketch:** Add `fast-check` (or equivalent) as a devDependency. Pick one parser — `shellQuote` is the highest-leverage target because its output lands directly in a shell context — and write the first property test: "for any Unicode string `s`, `JSON.parse(execShell(shellQuote(s)))` equals `s`." Apply the same shape to the other eight once the pattern is proven.
- **Addressed in clusters:** `15-fuzz-gaps`
