# Theming Support — Design

**Date:** 2026-04-15
**Status:** Approved (pending implementation plan)

## Goal

Add theme support to tmux-web. A theme styles the frame around the terminal (borders, corners, scalable background), the toolbar (five logical slots), and all interactive controls (buttons, tabs, selects, menu). Themes ship as folders containing CSS, images, fonts, and a `theme.json` manifest. Themes are loaded server-side from the user's config dir or from themes bundled into the binary, and selected at runtime via a menu dropdown.

## Theme Pack Format

A **theme pack** is a directory:

```
<pack-name>/
  theme.json        # required: manifest
  *.css             # one or more CSS files (one per theme variant)
  *.woff2           # optional: fonts
  *.png|webp|jpg    # optional: images referenced by CSS
```

A pack contains zero or more **themes** (selectable variants sharing assets) and zero or more **fonts** (always globally available). A pack with only fonts and no themes is valid — it just contributes to the global font list.

### `theme.json`

```json
{
  "author": "Per Wigren",
  "version": "1",
  "fonts": [
    { "file": "Iosevka.woff2", "family": "Iosevka Theme" }
  ],
  "themes": [
    { "name": "Foo Brown", "css": "brown.css", "defaultFont": "Iosevka Theme" },
    { "name": "Foo Green", "css": "green.css" }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `author` | no | string |
| `version` | no | string, free-form |
| `fonts` | no | array of `{file, family}` |
| `themes` | no | array of theme entries |
| `themes[].name` | yes (if pack has themes) | unique across all packs |
| `themes[].css` | yes | filename relative to pack dir |
| `themes[].defaultFont` | no | font family applied on first activation |

### Theme sources & precedence

1. `~/.config/tmux-web/themes/<pack>/` — user dir (overridable via `--themes-dir`)
2. Bundled — embedded in the binary at build time from top-level `themes/` (mirrors how `fonts/` is bundled)

Theme name collisions: user-dir wins over bundled. Within the same source, first scanned wins; later one ignored with a logged warning.

### Palette (deferred)

Terminal color palette (xterm/ghostty fg/bg/ansi16) is **not** in v1. A future version may extend `theme.json` with optional palette blocks.

## DOM Contract

New layout (inside `<body>`):

```html
<div id="frame-bg"></div>
<div id="frame-top"></div>
<div id="frame-right"></div>
<div id="frame-bottom"></div>
<div id="frame-left"></div>
<div id="frame-tl"></div>
<div id="frame-tr"></div>
<div id="frame-bl"></div>
<div id="frame-br"></div>

<div id="topbar">
  <div id="tb-left"></div>
  <div id="tb-session">
    <select id="session-select"></select>
    <button id="btn-new-session">+</button>
  </div>
  <div id="tb-windows"><div id="win-tabs"></div></div>
  <div id="tb-spacer"></div>
  <div id="tb-right">
    <div id="menu-wrap">
      <button id="btn-menu">☰</button>
      <div id="menu-dropdown" hidden>...</div>
    </div>
  </div>
</div>

<div id="terminal"></div>
```

Frame divs are empty paint surfaces, positioned absolute. Theme CSS sets their backgrounds (`background: url('bg.png') ...`). Theme can leave any of them sized at zero (current borderless look).

### CSS variables (theme → layout JS)

Theme CSS sets these on `:root`. Layout JS reads via `getComputedStyle` after CSS load and recomputes `#terminal` insets.

| Var | Default | Meaning |
|---|---|---|
| `--tw-border-top` | 0 | reserved inset (terminal shrinks by this) |
| `--tw-border-right` | 0 | reserved inset |
| `--tw-border-bottom` | 0 | reserved inset |
| `--tw-border-left` | 0 | reserved inset |
| `--tw-overlay-top` | 0 | overlay only (no inset) |
| `--tw-overlay-right` | 0 | overlay only |
| `--tw-overlay-bottom` | 0 | overlay only |
| `--tw-overlay-left` | 0 | overlay only |
| `--tw-toolbar-height` | 28 | toolbar height (px) |
| `--tw-corner-w` | 0 | corner box width |
| `--tw-corner-h` | 0 | corner box height |

`#terminal` `top` = toolbar height (when pinned) + `--tw-border-top`. Etc. Layout JS recomputes on theme switch and on existing resize triggers.

### Themable element targets

Theme CSS may freely style:

| Selector | Element |
|---|---|
| `#frame-bg`, `#frame-top`/`right`/`bottom`/`left`, `#frame-tl`/`tr`/`bl`/`br` | frame paint surfaces |
| `#topbar`, `#tb-left`, `#tb-session`, `#tb-windows`, `#tb-spacer`, `#tb-right` | toolbar + slots |
| `#session-select` | session `<select>` |
| `#btn-new-session` | `[+]` button |
| `.win-tab`, `.win-tab.active`, `.win-tab:hover` | window tabs |
| `#btn-menu` | menu `☰` button |
| `#menu-dropdown` | dropdown panel |
| `#menu-dropdown label`, `hr`, `select`, `input` | menu rows |
| `.tb-btn`, `.tb-btn:hover`, `.tb-btn:active` | generic toolbar buttons |
| `#terminal` | terminal container |

### Base stylesheet

Current inline `<style>` in `index.html` and inline `style="..."` attributes on menu rows move to a new base stylesheet (`src/client/base.css` or equivalent, served at `/dist/client/base.css`). Base contains only:

- Resets (`* { margin: 0; ...}`, html/body sizing)
- `.xterm .xterm-viewport { overflow-y: hidden !important; }` workaround
- Class names for menu rows (`.menu-row`, `.menu-label`, etc.) so themes can override without specificity battles

Theme CSS loads via `<link id="theme-css">` injected after the base link, so theme rules win via cascade order (no `!important` needed).

## Server

### File layout

Top-level `themes/` directory in the project (mirrors `fonts/`). Build step embeds its contents into the binary.

### New module: `src/server/themes.ts`

Pure where possible.

```ts
type FontInfo  = { family: string; file: string; pack: string }
type ThemeInfo = { name: string; pack: string; css: string;
                   defaultFont?: string; author?: string;
                   version?: string; source: 'user' | 'bundled' }

function listPacks(userDir, bundledDir): PackInfo[]
function listThemes(packs): ThemeInfo[]      // flattened, name-deduped (user wins)
function listFonts(packs):  FontInfo[]       // flattened, family-deduped
function resolveTheme(name, packs): ThemeInfo | null
function readPackFile(pack, file, packs): Response | null  // path-traversal guarded
```

### CLI flags

```
--themes-dir <path>   Override user themes dir (default ~/.config/tmux-web/themes)
--theme <name>        Startup default theme (default "default")
```

### HTTP routes (added to `src/server/http.ts`)

| Route | Returns |
|---|---|
| `GET /api/themes` | `ThemeInfo[]` (flat, all packs, sorted) |
| `GET /api/fonts` | `FontInfo[]` (flat, all packs, family-deduped) |
| `GET /themes/<pack>/<file>` | static file from pack dir; 404 if missing |

`<file>` validation: must not contain `..`, `/`, `\`, or start with `.`. Reject with 400 otherwise.

### Bundled theme embedding

Build step walks top-level `themes/` and embeds each file using whatever mechanism `fonts/` currently uses (to be confirmed in the implementation plan by reading the build script). Runtime resolves bundled files through that mechanism in `themes.ts`.

## Client

### New module: `src/client/theme.ts`

```ts
async function applyTheme(name: string): Promise<void>
function   getActiveTheme(): string
async function listThemes(): Promise<ThemeInfo[]>
async function loadAllFonts(): Promise<void>   // called at startup
```

`applyTheme(name)`:

1. Look up theme via `/api/themes`. If not found → fall back to `default`, console error + toast `Theme "X" not found`.
2. Inject (or replace) `<link id="theme-css" rel="stylesheet" href="/themes/<pack>/<css>">` in `<head>`, after base stylesheet link.
3. On `link.onload`: re-read CSS vars from `:root`, recompute `#terminal` insets, call `adapter.fit()`.
4. If theme has `defaultFont` and user has not previously customized font for this theme: apply it (tracked via `themeFontTouched: Record<themeName, boolean>` in settings).
5. Persist `theme: <name>` in localStorage.

`loadAllFonts()` (called once at startup, before first `applyTheme`):

1. `fetch('/api/fonts')`.
2. For each font: `new FontFace(family, 'url(/themes/<pack>/<file>)')`, `.load()`, `document.fonts.add()`.
3. Update the font picker with the merged list.

Theme switching is **hot** — no reload. Frame divs are always present in DOM; an inactive theme just stops styling them.

### Settings changes

Add: `theme: string` (default `"default"`), `themeFontTouched: Record<string, boolean>`.

Remove: `fontSource`, `customFont`. Only "Bundled" fonts are supported, exposed as a single `font: string` family-name setting.

Old localStorage values for the removed keys are ignored. If `font` is not present or the family is not in the loaded font list, fall back to the system default.

### Menu UI changes (`topbar.ts`, `index.html`)

Replace the current "Font source / Name" section with a single row:

```
Theme  [select]   ← populated from /api/themes
Font   [select]   ← populated from loaded fonts
```

Remove `#inp-fontsource` and `#inp-font` (custom name input). Keep `#inp-font-bundled` as the only font selector, relabel its row to "Font".

## Default Theme

The current chrome ships as the bundled `default` theme:

```
themes/default/
  theme.json         # { "themes": [{"name": "Default", "css": "default.css"}] }
  default.css        # ported from current index.html <style> block
```

`default.css` does **not** set any `--tw-border-*` vars → frame divs render zero-sized → current borderless look preserved. No fonts in the pack, so global font list is unchanged when only `default` is installed.

There is no separate "no theme" code path — the theme system is the only path.

## Errors & Fallback

| Condition | Behavior |
|---|---|
| `theme.json` malformed (bad JSON / missing required field) | Pack excluded from `/api/themes` and `/api/fonts`; logged at startup |
| Theme name collision (user vs bundled) | User-dir wins |
| Theme name collision (within same source) | First scanned wins; warning logged |
| `applyTheme(unknown)` | Fall back to `default`; console error + toast |
| `theme.css` 404 / parse error | Browser logs CSS error; layout JS still runs (vars resolve to `0px`) |
| Font load failure | Browser falls back automatically |
| `/themes/<pack>/<file>` path traversal attempt | 400 |

## Testing

Unit (`tests/unit/server/themes.test.ts`):
- `listPacks` / `listThemes` / `listFonts` against fixture dir with bundled + user, name collisions, malformed `theme.json`, font-only pack
- `resolveTheme` (user-shadows-bundled)
- `readPackFile` rejects `..`, `/`, `\`, leading `.`

Unit (`tests/unit/client/theme.test.ts`):
- CSS var reading + inset computation
- Switch theme: old `<link id="theme-css">` removed, new injected
- `themeFontTouched` gating of `defaultFont`

E2E (`tests/e2e/theming.spec.ts`):
- Default theme loads; terminal renders
- Switch theme via menu → `<link id="theme-css">` href changes; `#frame-top` becomes visible when theme defines a border
- Unknown theme via setting → falls back to default; no crash
- Fonts from a theme pack appear in the font picker

Fixtures: `tests/fixtures/themes/` containing:
- `font-only/` — pack with only fonts
- `multi/` — pack with two themes sharing fonts
- `malformed/` — pack with broken `theme.json`

## Out of Scope (v1)

- Terminal palette themes (deferred)
- Zip-packed themes (scrapped)
- Hot-reload of theme files when edited on disk
- User-uploaded themes via the browser
