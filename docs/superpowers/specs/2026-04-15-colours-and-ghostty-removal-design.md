# Colours support + ghostty-web removal

Date: 2026-04-15
Status: Approved design

## Summary

Remove the ghostty-web terminal backend entirely; xterm.js (vendored) becomes
the sole backend. Add terminal colour scheme support ("Colours" in the config
UI) using Alacritty TOML theme files contributed by theme packs. Theme packs
may also declare default colour scheme, font, font size, and line-height;
defaults apply on theme switch but all values are user-overridable per
session. Terminal background becomes translucent so the UI theme shows
through, controlled by a per-session opacity slider.

## Goals

- Single terminal backend (xterm.js) — smaller surface, faster iteration.
- Rich, curated library of colour schemes using existing Alacritty theme
  ecosystem.
- Per-session, live-editable settings (theme, colours, font, opacity).
- Theme packs remain the sole extensibility unit for UI theme, fonts, and
  colours.

## Non-goals

- Custom colour scheme editor in the browser.
- Per-user colour scheme storage on the server.
- Migrating users' existing cookie-based global settings.
- Runtime theme-pack hot-reload (scan happens at server start, as today).

## 1. Ghostty removal

### Scope

Delete:

- `src/client/adapters/ghostty.ts`
- `vendor/ghostty-web` submodule and all build steps that reference it
- `--terminal` CLI flag, `TMUX_WEB_TERMINAL` env var
- `getTerminalBackend` / `setTerminalBackend` in `src/client/settings.ts`
- Backend picker row from the settings menu
- Ghostty branches in `src/server/pty.ts`, `src/server/http.ts`,
  `bun-build.ts`, `scripts/generate-assets.ts`
- E2E suites that exist solely to cover the ghostty backend:
  `tests/e2e/binary-backends.test.ts`, `tests/e2e/terminal-backends.test.ts`
- All ghostty mentions in `README.md` and `CLAUDE.md`

Convert, don't delete: E2E tests whose only xterm coverage was implicit
(e.g. ghostty-only matrix rows in `terminal-selection.test.ts`,
`font-change-rendering.test.ts`, `menu-focus.test.ts`,
`font-selection.test.ts`, `keyboard.test.ts`) are retargeted to xterm. If an
equivalent xterm case already exists, the ghostty row is deleted as
duplicate.

### Adapter interface

`src/client/adapters/types.ts` (`TerminalAdapter`) is retained. xterm remains
the sole implementation. Keeping the interface is low-cost and preserves a
seam for unit tests.

## 2. Colour scheme data model

### File format

Alacritty TOML. Supported sections:

- `[colors.primary]` — `foreground`, `background`
- `[colors.normal]` — `black red green yellow blue magenta cyan white`
- `[colors.bright]` — same keys as normal
- `[colors.cursor]` — `cursor`, `text`
- `[colors.selection]` — `background`, `text`

Hex values `#RRGGBB`. `#RRGGBBAA` is passed through unchanged to xterm.

### Manifest

`theme.json` in each theme pack gains an optional `colours` array. All file
references in the manifest (`colours[].file`, `fonts[].file`, `themes[].css`)
use **full relative paths from the theme pack root** — subdirectories
allowed; `..` and leading `/` rejected.

```json
{
  "author": "tmux-web",
  "version": "1",
  "fonts": [
    { "file": "fonts/Iosevka Nerd Font Mono.woff2",
      "family": "Iosevka Nerd Font Mono" }
  ],
  "colours": [
    { "file": "colours/gruvbox-dark.toml",
      "name": "Gruvbox Dark", "variant": "dark" },
    { "file": "colours/solarized-light.toml",
      "name": "Solarized Light", "variant": "light" }
  ],
  "themes": [
    { "name": "Amiga",
      "css": "css/amiga.css",
      "defaultFont": "Topaz8 Amiga1200 Nerd Font",
      "defaultFontSize": 16,
      "defaultLineHeight": 1.0,
      "defaultColours": "Gruvbox Dark" }
  ]
}
```

`variant` is optional metadata (`"dark" | "light"`) used by the picker to
group entries.

### Server pipeline

`scripts/generate-assets.ts` (and the runtime equivalent in
`src/server/`) walks each theme pack, reads the manifest, parses each
referenced `.toml` via `import { TOML } from "bun"`, converts the result to
an xterm `ITheme`, and emits the compiled JSON into
`src/server/assets-embedded.ts`. Colours contributed by any theme pack are
merged into a single global pool keyed by scheme name. Duplicate names emit
a warning and last-wins, matching the existing fonts rule.

### API

- `GET /api/colours` → `Array<{ name: string; variant?: "dark" | "light";
  theme: ITheme }>`
- `GET /api/themes` response gains per-theme `defaultColours`,
  `defaultFont`, `defaultFontSize`, `defaultLineHeight` fields (optional).

### Bundled themes

Ship in `themes/default/colours/` as starting point (user may revise list):
gruvbox-dark, gruvbox-light, solarized-dark, solarized-light, dracula, nord,
tokyo-night, catppuccin-mocha, monokai, tomorrow.

## 3. Client state model

### Shape

```ts
interface SessionSettings {
  theme: string;        // UI theme name
  colours: string;      // colour scheme name
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  opacity: number;      // 0..100, terminal background alpha
}
```

Stored at `localStorage["tmux-web-session:<session-name>"]` as JSON.

### Load rules — `loadSessionSettings(name)`

1. If `localStorage["tmux-web-session:<name>"]` exists, parse and return.
2. Else, if another session's settings are live in this tab, deep-copy them.
3. Else, start from `DEFAULT_SETTINGS` and overlay the active UI theme's
   `defaultColours` / `defaultFont` / `defaultFontSize` /
   `defaultLineHeight` where present.

Write-through: every UI mutation writes the active session's key
immediately.

### Old cookie

Ignored; no migration. Will expire naturally.

### UI theme switch

When the user changes UI theme, the active session's `colours`,
`fontFamily`, `fontSize`, and `lineHeight` are unconditionally replaced with
the new theme's declared defaults (or global defaults if the theme declares
none). The old `themeFontTouched` override-tracking is deleted.

### Transparency

xterm is initialized with `allowTransparency: true`. The live `ITheme`
handed to xterm has its `background` replaced with
`rgba(r, g, b, opacity/100)` computed from the active colour scheme's
background colour and the session's opacity slider. The `#terminal`
container CSS background remains `transparent`.

## 4. Config menu

Existing settings panel is restructured:

| Section   | Controls                                                        |
|-----------|-----------------------------------------------------------------|
| Theme     | Dropdown of UI themes                                           |
| Colours   | Dropdown of colour schemes (Dark / Light / Other groups); "Reset to theme default" link |
| Font      | Family dropdown, size number, line-height number; "Reset to theme default" link |
| Opacity   | 0–100 slider, live preview                                      |
| Topbar    | Autohide toggle                                                 |

Backend picker row removed. All changes apply live to the active session
and persist immediately.

## 5. Testing

### Unit (`bun test`)

- `tests/unit/server/colours.test.ts` — TOML→ITheme conversion:
  primary/normal/bright/cursor/selection mapping, hex normalization,
  missing-field fallback, `#RRGGBBAA` passthrough.
- `tests/unit/server/theme-manifest.test.ts` — relative-path validation
  (reject `..` / leading `/`), duplicate-name warning, merging of
  `colours` / `fonts` / `themes` across packs.
- `tests/unit/client/session-settings.test.ts` — inherit-from-active
  rule, theme-switch override, opacity→rgba composition.

### E2E (Playwright)

- `tests/e2e/colours.test.ts` — switch colour scheme live; verify xterm
  DOM rendered text colour matches expected ANSI palette.
- `tests/e2e/opacity.test.ts` — slider change updates computed
  `background-color` alpha.
- `tests/e2e/session-inheritance.test.ts` — create new session via `[+]`;
  confirm font/colour/opacity copied from active; switch UI theme, confirm
  overrides applied to active session only.
- Retarget ghostty-only matrix rows in surviving suites to xterm, or
  delete as duplicate when the xterm equivalent already exists.

### Manual smoke

`make dev`, cycle each bundled colour scheme and move the opacity slider
across the Amiga and Default UI themes. Confirm the UI theme's background
is visible through the terminal at non-100% opacity.

## 6. Build & release

- `bun-build.ts`: remove ghostty bundle step and vendor copy; xterm vendor
  guardrails stay intact (CLAUDE.md critical rule — do not touch).
- `scripts/generate-assets.ts`: parse `theme.json.colours[].file` entries
  via Bun's TOML support; emit compiled `ITheme` JSON into
  `src/server/assets-embedded.ts`.
- `scripts/verify-vendor-xterm.ts`: unchanged.
- Release workflow + local `act` verify: unchanged, no new matrix.
- Docs: strip ghostty from `README.md` and `CLAUDE.md`; document colours,
  opacity, and the full-relative-path rule in `theme.json`.
- Version bump to `1.1.0` (breaking — backend removed).

No new runtime dependencies. TOML parsing uses Bun's built-in
`import { TOML } from "bun"`.
