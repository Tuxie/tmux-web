# Colours + ghostty-removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ghostty-web terminal backend entirely and add per-session terminal colour scheme support (Alacritty TOML theme packs), plus per-session font/opacity overrides with inherit-from-active-session and theme-default semantics.

**Architecture:** Phase A rips ghostty from every layer (adapter, server, build, HTML, tests, deps). Phase B adds a colour pipeline in the server that parses Alacritty TOML via Bun's built-in `TOML`, contributed by theme packs and exposed at `/api/colours`. Phase C replaces the global cookie settings model with a per-session `localStorage` model keyed by tmux session name; new sessions inherit from the active session; UI-theme switches unconditionally replace font/colour/line-height with the new theme's declared defaults. Phase D wires the new Colours dropdown and Opacity slider into the settings menu; xterm runs with `allowTransparency: true` and live `ITheme` updates compose RGB + opacity slider into `rgba()`. Phases E–F cover tests and docs.

**Tech Stack:** Bun, TypeScript, xterm.js 6/vendor HEAD, `@xterm/addon-fit`, Playwright, node-ws. TOML parsed via `import { TOML } from "bun"`. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-04-15-colours-and-ghostty-removal-design.md`

---

## File Structure

### Create

- `src/server/colours.ts` — Alacritty TOML parser + `ITheme` converter.
- `src/client/session-settings.ts` — per-session `localStorage` model (`SessionSettings`, `loadSessionSettings`, `saveSessionSettings`, inherit logic).
- `src/client/colours.ts` — client-side colour fetch + cache + `composeTheme(colours, opacity)` helper.
- `themes/default/colours/*.toml` — 10 bundled Alacritty theme files.
- `tests/unit/server/colours.test.ts`
- `tests/unit/server/manifest-paths.test.ts`
- `tests/unit/client/session-settings.test.ts`
- `tests/e2e/colours.test.ts`
- `tests/e2e/opacity.test.ts`
- `tests/e2e/session-inheritance.test.ts`

### Modify

- `src/server/themes.ts` — manifest gains `colours[]`, extended theme fields, full-relative-path validation.
- `src/server/http.ts` — `/api/colours`; drop ghostty branches; drop `getEffectiveTerminal` + ghostty-dist; drop `/ghostty-vt.wasm`; `/api/terminal-versions` returns xterm-only.
- `src/server/index.ts` — drop `--terminal`, ghostty search, `TerminalBackend`.
- `src/shared/types.ts` — remove `TerminalBackend`, simplify `ClientConfig`, `ServerConfig`; add `ITheme` re-export surface.
- `src/shared/constants.ts` — drop `DEFAULT_TERMINAL`.
- `src/client/index.ts` — drop ghostty dynamic import; wire session settings, opacity→rgba, live theme updates.
- `src/client/adapters/xterm.ts` — `allowTransparency: true`; expose `setTheme()` wrapper.
- `src/client/adapters/types.ts` — add `setTheme(theme)` method.
- `src/client/settings.ts` — DELETE (logic moves to `session-settings.ts`); only keep `getTopbarAutohide`/`setTopbarAutohide` which move into a tiny `src/client/prefs.ts`.
- `src/client/prefs.ts` (new) — `getTopbarAutohide`/`setTopbarAutohide` only.
- `src/client/ui/topbar.ts` — colours picker, opacity slider, reset links, remove terminal-selector section.
- `src/client/index.html` — remove terminal row; add colours + opacity rows; add reset buttons.
- `src/client/theme.ts` — `ThemeInfo` gains `defaultColours`, `defaultFontSize`, `defaultLineHeight`.
- `bun-build.ts` — drop ghostty config from `configs`, drop `external: ["/dist/ghostty-web.js"]`.
- `scripts/generate-assets.ts` — drop ghostty-web asset scan; keep theme recursion (already picks up `colours/*.toml`).
- `Makefile` — retarget to `xterm.js` target; drop ghostty from `install`.
- `package.json` — drop `ghostty-web` dep; bump to `1.1.0`.
- `themes/default/theme.json` — add `colours[]` list.
- `themes/amiga/theme.json` — add `defaultColours`, optional `defaultFontSize`, optional `defaultLineHeight`.
- `CLAUDE.md`, `README.md` — remove ghostty; document colours/opacity/full-relative-path rule.
- `tests/e2e/*` — retarget or delete ghostty rows (see Task 26).
- `.gitmodules` + submodule dir — remove `vendor/ghostty-web` if present.

### Delete

- `src/client/adapters/ghostty.ts`
- `tests/e2e/binary-backends.test.ts`
- `tests/e2e/terminal-backends.test.ts`

---

## Phase A — Ghostty removal

### Task 1: Remove ghostty from client adapter layer

**Files:**
- Delete: `src/client/adapters/ghostty.ts`
- Modify: `src/client/adapters/types.ts`
- Modify: `src/client/index.ts:42-49` (remove dynamic import branch)

- [ ] **Step 1: Delete the adapter file**

```bash
git rm src/client/adapters/ghostty.ts
```

- [ ] **Step 2: Inline xterm in `src/client/index.ts`**

Replace the `if (config.terminal === 'ghostty') { ... } else { ... }` block with a direct import, and delete the `setTerminalBackend(config.terminal)` line + `ClientConfig.terminal` usage.

```ts
// at top of main():
const { XtermAdapter } = await import('./adapters/xterm.ts');
const adapter: TerminalAdapter = new XtermAdapter();
```

Remove the `setTerminalBackend(config.terminal)` call (2 lines) and its `import`. Remove the `config.terminal` check block entirely.

- [ ] **Step 3: Add `setTheme` to adapter interface**

Edit `src/client/adapters/types.ts` — add line inside `TerminalAdapter`:

```ts
setTheme(theme: TerminalTheme): void;
```

Import `TerminalTheme` via the existing `../../shared/types.js` import (add it to the import if not already).

- [ ] **Step 4: Run typecheck**

Run: `bun run tsc --noEmit`
Expected: compile errors only for things that still reference `ghostty` (which we fix in later tasks) — no `adapters/ghostty.ts` missing errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(client): drop ghostty adapter, add setTheme to TerminalAdapter"
```

---

### Task 2: Remove ghostty from xterm adapter, add transparency + setTheme

**Files:**
- Modify: `src/client/adapters/xterm.ts`

- [ ] **Step 1: Write failing test (bun test)**

Create `tests/unit/client/xterm-adapter.test.ts`:

```ts
import { describe, test, expect } from "bun:test";

// Import-time smoke test: construct XtermAdapter and ensure setTheme + allowTransparency are wired.
describe("XtermAdapter", () => {
  test("exposes setTheme method on prototype", async () => {
    const { XtermAdapter } = await import("../../../src/client/adapters/xterm.ts");
    expect(typeof XtermAdapter.prototype.setTheme).toBe("function");
  });
});
```

Run: `bun test tests/unit/client/xterm-adapter.test.ts`
Expected: FAIL — `setTheme is not a function`.

- [ ] **Step 2: Implement**

In `src/client/adapters/xterm.ts`:

1. In `init()`, pass `allowTransparency: true` in the Terminal ctor options.
2. Add method:

```ts
setTheme(theme: import('../../shared/types.js').TerminalTheme): void {
  this.term.options.theme = theme;
}
```

- [ ] **Step 3: Run test**

Run: `bun test tests/unit/client/xterm-adapter.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/adapters/xterm.ts tests/unit/client/xterm-adapter.test.ts
git commit -m "feat(adapter): xterm allowTransparency + setTheme wrapper"
```

---

### Task 3: Drop ghostty from server HTTP + config

**Files:**
- Modify: `src/server/http.ts`
- Modify: `src/server/index.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Update shared types**

In `src/shared/types.ts`:

- Remove `export type TerminalBackend = 'ghostty' | 'xterm';`
- Remove `terminal: TerminalBackend;` from both `ServerConfig` and `ClientConfig`.

In `src/shared/constants.ts`:

- Remove `export const DEFAULT_TERMINAL = 'xterm' as const;`

- [ ] **Step 2: Simplify server entry**

In `src/server/index.ts`:

- Remove the `terminal` CLI option, `--terminal` help line, `ghostty*` search-path logic, `ghosttyWasmPath`, `ghosttyDistDir`.
- Remove `terminal: (args.terminal as TerminalBackend) || DEFAULT_TERMINAL,` from the `config` object.
- Remove `TerminalBackend` and `DEFAULT_TERMINAL` imports.
- Change the `console.log` startup line to drop the `terminal:` suffix:

```ts
console.log(`tmux-web listening on ${scheme}://${host}:${port}`);
```

- Remove `ghosttyDistDir` and `ghosttyWasmPath` from the `createHttpHandler(...)` call.

- [ ] **Step 3: Simplify HTTP handler**

In `src/server/http.ts`:

- Remove `TerminalBackend` import.
- Delete `bundleName()`, `getEffectiveTerminal()`, and the `ghosttyDistDir`/`ghosttyWasmPath` fields from `HttpHandlerOptions`.
- In `makeHtml`, replace with:

```ts
const makeHtml = () => {
  return opts.htmlTemplate
    .replace('<!-- __CONFIG__ -->', `<script>window.__TMUX_WEB_CONFIG = ${JSON.stringify({ version: pkg.version })}</script>`)
    .replace('__BUNDLE__', `/dist/client/xterm.js`);
};
```

- Inside the handler: change `res.end(makeHtml(req))` to `res.end(makeHtml())`.
- Delete the `if (pathname === '/ghostty-vt.wasm') { ... }` block entirely.
- Inside `/dist/`: remove the `|| (opts.ghosttyDistDir ? ... : null)` fallback.
- Rewrite `getTerminalVersions` to return only xterm:

```ts
function getTerminalVersions(projectRoot: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const xtermAssetPath = embeddedAssets['dist/client/xterm.js']
    ?? path.join(projectRoot, 'dist/client/xterm.js');
  try {
    const bundle = fs.readFileSync(xtermAssetPath, 'utf-8');
    const m = bundle.match(/tmux-web: vendor xterm\.js rev ([0-9a-f]{40})/);
    versions['xterm'] = m ? `xterm.js (HEAD, ${m[1].slice(0, 7)})` : 'xterm.js (unknown)';
  } catch {
    versions['xterm'] = 'xterm.js (unknown)';
  }
  return versions;
}
```

- Remove `const require = createRequire(import.meta.url);` and its `import { createRequire }` — no longer used. (Keep if other code in file uses it; verify first.)

- [ ] **Step 4: Typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors in `src/server` or `src/shared`. Existing errors in client files still OK.

- [ ] **Step 5: Commit**

```bash
git add src/server/http.ts src/server/index.ts src/shared/types.ts src/shared/constants.ts
git commit -m "refactor(server): drop --terminal flag, ghostty wasm/bundle routing, TerminalBackend type"
```

---

### Task 4: Drop ghostty from build + asset generation

**Files:**
- Modify: `bun-build.ts`
- Modify: `scripts/generate-assets.ts`
- Modify: `Makefile`
- Modify: `package.json`

- [ ] **Step 1: Update `bun-build.ts`**

- Remove the initial `configs` ghostty entry (line ~73–75); start `configs` as `[]`.
- Remove `external: ["/dist/ghostty-web.js"],` from `commonOpts`.
- The `configs.push({ name: "xterm", outfile: "xterm.js" });` line stays.

- [ ] **Step 2: Update `scripts/generate-assets.ts`**

- Drop the `ghostty-web` asset block (the `try { const ghosttyDir = path.dirname(require.resolve("ghostty-web/package.json")); ... } catch { ... }`).
- In the bundle-filter condition, drop `file.endsWith("ghostty.js")`:

```ts
const isBundle = file.startsWith("dist/client/") && (
  file.endsWith("xterm.js") ||
  file.endsWith("xterm.css") || file.endsWith("base.css")
);
```

- [ ] **Step 3: Update `Makefile`**

Replace `ghostty.js` targets with `xterm.js`:

- `dist/client/ghostty.js` → `dist/client/xterm.js` in rule name and deps.
- `build`, `build-client`: depend on `dist/client/xterm.js`.
- `test-e2e`, `test-e2e-headed`: depend on `dist/client/xterm.js`.
- `src/server/assets-embedded.ts`: depends on `dist/client/xterm.js` instead of `ghostty.js`.
- Delete the `install` rule's `ghostty-web` copy block (the `@if [ -d node_modules/ghostty-web ]; then ...`).

- [ ] **Step 4: Update `package.json`**

- Remove `"ghostty-web": "^0.4.0",` from `dependencies`.
- Bump `"version": "1.0.3"` → `"version": "1.1.0"`.

- [ ] **Step 5: Reinstall deps**

Run: `bun install`
Expected: `ghostty-web` disappears from `bun.lock` / `node_modules`.

- [ ] **Step 6: Rebuild assets**

Run: `rm -rf dist src/server/assets-embedded.ts && make build && bun run scripts/generate-assets.ts`
Expected: `dist/client/xterm.js` produced; `src/server/assets-embedded.ts` contains no `ghostty` entries.

- [ ] **Step 7: Commit**

```bash
git add bun-build.ts scripts/generate-assets.ts Makefile package.json bun.lock src/server/assets-embedded.ts
git commit -m "build: drop ghostty-web from build pipeline and deps; bump to 1.1.0"
```

---

### Task 5: Drop ghostty from HTML + topbar settings

**Files:**
- Modify: `src/client/index.html`
- Modify: `src/client/ui/topbar.ts`

- [ ] **Step 1: Remove the terminal-selector row from HTML**

Delete lines 54–60 of `src/client/index.html`:

```html
<div class="menu-row menu-row-static">
  <span class="menu-label">Terminal</span>
  <select id="inp-terminal" class="menu-input-select" style="flex:1">
    <option value="ghostty">ghostty-web</option>
    <option value="xterm">xterm.js</option>
  </select>
</div>
```

- [ ] **Step 2: Remove the terminal-selector wiring**

In `src/client/ui/topbar.ts`:

- Delete `setupTerminalSelector()` method (lines ~140–175).
- Remove `this.setupTerminalSelector();` call in `init()`.

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit`
Expected: may still flag removed `setTerminalBackend` import; to be cleaned in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/client/index.html src/client/ui/topbar.ts
git commit -m "refactor(ui): remove terminal-backend selector from settings menu"
```

---

### Task 6: Delete old settings module; extract prefs

**Files:**
- Delete: `src/client/settings.ts`
- Create: `src/client/prefs.ts`
- Modify: `src/client/ui/topbar.ts`, `src/client/index.ts` (imports only)

`src/client/settings.ts` is being fully replaced in Phase C. Here we delete only the obsolete pieces (`setTerminalBackend`, `getTerminalBackend`, `setActiveThemeName`, etc.) that phase C doesn't need, and move the 2 prefs we DO keep (`getTopbarAutohide`/`setTopbarAutohide`) to a new tiny module. Leave the rest of `settings.ts` intact for now so Phase C can replace it cleanly in Task 13.

- [ ] **Step 1: Create `src/client/prefs.ts`**

```ts
const KEY = 'tmux-web-topbar-autohide';

export function getTopbarAutohide(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setTopbarAutohide(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {}
}
```

- [ ] **Step 2: Re-route imports**

In `src/client/index.ts`, change:

```ts
import { loadSettings, setTerminalBackend, getTopbarAutohide, getActiveThemeName } from './settings.js';
```

to:

```ts
import { loadSettings, getActiveThemeName } from './settings.js';
import { getTopbarAutohide } from './prefs.js';
```

Remove the `setTerminalBackend(config.terminal);` line.

In `src/client/ui/topbar.ts`, change the `import { ... } from '../settings.js'` list: drop `getTerminalBackend`, `setTerminalBackend`. Add `import { getTopbarAutohide, setTopbarAutohide } from '../prefs.js';` and remove those from the `../settings.js` import.

- [ ] **Step 3: Delete the now-unused exports from `src/client/settings.ts`**

Edit `src/client/settings.ts`:

- Delete `getTerminalBackend`, `setTerminalBackend`, `getTopbarAutohide`, `setTopbarAutohide` functions.
- Delete `terminal?: string;` and `topbarAutohide?: boolean;` from `AllSettings`.

- [ ] **Step 4: Typecheck**

Run: `bun run tsc --noEmit`
Expected: clean or only errors in files we haven't touched yet (Phase C).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(client): extract topbar-autohide to prefs.ts, drop ghostty settings"
```

---

### Task 7: Convert ghostty-matrix E2E tests to xterm; delete ghostty-only suites

**Files:**
- Delete: `tests/e2e/binary-backends.test.ts`, `tests/e2e/terminal-backends.test.ts`
- Modify: `tests/e2e/font-change-rendering.test.ts`, `tests/e2e/font-selection.test.ts`, `tests/e2e/menu-focus.test.ts`, `tests/e2e/terminal-selection.test.ts`, `tests/e2e/keyboard.test.ts`

- [ ] **Step 1: Delete ghostty-only suites**

```bash
git rm tests/e2e/binary-backends.test.ts tests/e2e/terminal-backends.test.ts
```

- [ ] **Step 2: Retarget matrix tests**

For each of the 5 remaining suites that use a `['ghostty', 'xterm']` matrix (grep for `ghostty` in `tests/e2e/`), remove the ghostty iteration and keep only xterm. If both iterations call `/?terminal=...` URLs, change to plain `/`. If a test asserts ghostty-specific selectors (e.g. ghostty canvas class), replace with the equivalent xterm selector.

Concretely, replace any `for (const term of ['ghostty', 'xterm'])` with direct inline xterm tests. Example transform for `terminal-selection.test.ts`: delete the ghostty `test.describe` or `for` branch; keep only the xterm branch, and drop the `?terminal=xterm` query param from URLs.

- [ ] **Step 3: Delete `/api/terminal-versions` terminal-picker assertions**

In any test that asserts content of `/api/terminal-versions` ghostty values, remove those assertions.

- [ ] **Step 4: Grep for remaining ghostty references**

Run: `grep -r "ghostty" tests/ src/ bun-build.ts scripts/ Makefile`
Expected: only matches in `README.md` and `CLAUDE.md` (handled Task 27) and in `tests/e2e/theming.spec.ts`/`tests/unit/server/pty.test.ts` if any — clean those up too.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): retarget matrix suites to xterm; delete ghostty-only suites"
```

---

### Task 8: Remove ghostty submodule and vendor tree if present

**Files:**
- `.gitmodules`, `vendor/ghostty-web` (if exists)

- [ ] **Step 1: Inspect**

Run: `cat .gitmodules 2>/dev/null; ls vendor/ 2>/dev/null`
Expected: shows any `vendor/ghostty-web` submodule. If there is none, skip this task and record a no-op commit note.

- [ ] **Step 2: Remove**

If a `vendor/ghostty-web` submodule exists:

```bash
git submodule deinit -f vendor/ghostty-web
git rm -f vendor/ghostty-web
rm -rf .git/modules/vendor/ghostty-web
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove vendor/ghostty-web submodule"
```

If there was no submodule, skip this commit.

---

## Phase B — Colour scheme data pipeline

### Task 9: Manifest path validator (`src/server/themes.ts`)

**Files:**
- Modify: `src/server/themes.ts`
- Create: `tests/unit/server/manifest-paths.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/server/manifest-paths.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { isValidPackRelPath } from "../../../src/server/themes.ts";

describe("isValidPackRelPath", () => {
  test("accepts simple filename", () => {
    expect(isValidPackRelPath("default.css")).toBe(true);
  });
  test("accepts subdirectory path", () => {
    expect(isValidPackRelPath("colours/gruvbox-dark.toml")).toBe(true);
  });
  test("rejects empty string", () => {
    expect(isValidPackRelPath("")).toBe(false);
  });
  test("rejects parent traversal", () => {
    expect(isValidPackRelPath("../evil")).toBe(false);
    expect(isValidPackRelPath("colours/../evil.toml")).toBe(false);
  });
  test("rejects leading slash", () => {
    expect(isValidPackRelPath("/abs.toml")).toBe(false);
  });
  test("rejects backslash", () => {
    expect(isValidPackRelPath("colours\\evil.toml")).toBe(false);
  });
  test("rejects leading dot segment", () => {
    expect(isValidPackRelPath(".hidden/file.toml")).toBe(false);
  });
});
```

Run: `bun test tests/unit/server/manifest-paths.test.ts`
Expected: FAIL — `isValidPackRelPath is not exported`.

- [ ] **Step 2: Implement**

In `src/server/themes.ts`, export:

```ts
export function isValidPackRelPath(rel: string): boolean {
  if (!rel) return false;
  if (rel.startsWith('/') || rel.startsWith('\\')) return false;
  if (rel.includes('\\')) return false;
  const segments = rel.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false;
    if (seg.startsWith('.')) return false;
  }
  return true;
}
```

- [ ] **Step 3: Run test**

Run: `bun test tests/unit/server/manifest-paths.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/themes.ts tests/unit/server/manifest-paths.test.ts
git commit -m "feat(themes): isValidPackRelPath validator for manifest file refs"
```

---

### Task 10: Generalize pack file reader to allow subdirs

**Files:**
- Modify: `src/server/themes.ts`
- Modify: `src/server/http.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/unit/server/manifest-paths.test.ts`:

```ts
import { readPackFile } from "../../../src/server/themes.ts";
import fs from "fs";
import path from "path";
import os from "os";

describe("readPackFile subdirectory support", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-pack-"));
  fs.mkdirSync(path.join(tmp, "colours"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "colours", "foo.toml"), "# empty\n");
  const packs = [{ dir: "x", fullPath: tmp, source: "bundled" as const, manifest: {} }];

  test("reads subdir path", () => {
    const r = readPackFile("x", "colours/foo.toml", packs);
    expect(r?.fullPath).toBe(path.join(tmp, "colours", "foo.toml"));
  });
  test("rejects traversal", () => {
    expect(readPackFile("x", "../escape", packs)).toBeNull();
  });
});
```

Run: `bun test tests/unit/server/manifest-paths.test.ts`
Expected: subdir test FAILS because current `readPackFile` rejects any `/`.

- [ ] **Step 2: Replace `readPackFile` body**

In `src/server/themes.ts`:

```ts
export function readPackFile(packDir: string, file: string, packs: PackInfo[]): { fullPath: string } | null {
  if (!isValidPackRelPath(file)) return null;
  const pack = findPack(packDir, packs);
  if (!pack) return null;
  const fullPath = path.join(pack.fullPath, file);
  const resolved = path.resolve(fullPath);
  const root = path.resolve(pack.fullPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  if (!fs.existsSync(resolved)) return null;
  return { fullPath: resolved };
}
```

- [ ] **Step 3: Update HTTP handler**

`src/server/http.ts` `/themes/` branch: the current code does `rest.indexOf('/')` and takes everything after the first `/` as `fileName`. This already works for subpaths if we stop rejecting `/` in `readPackFile`. Verify no additional change needed.

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/server/manifest-paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/themes.ts tests/unit/server/manifest-paths.test.ts
git commit -m "feat(themes): allow manifest-listed subdir paths (validated via isValidPackRelPath)"
```

---

### Task 11: Alacritty TOML → xterm `ITheme` converter

**Files:**
- Create: `src/server/colours.ts`
- Create: `tests/unit/server/colours.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/server/colours.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { alacrittyTomlToITheme } from "../../../src/server/colours.ts";

const minimal = `
[colors.primary]
foreground = "#d4d4d4"
background = "#1e1e1e"

[colors.normal]
black   = "#000000"
red     = "#cc0000"
green   = "#00cc00"
yellow  = "#cccc00"
blue    = "#0000cc"
magenta = "#cc00cc"
cyan    = "#00cccc"
white   = "#cccccc"

[colors.bright]
black   = "#555555"
red     = "#ff5555"
green   = "#55ff55"
yellow  = "#ffff55"
blue    = "#5555ff"
magenta = "#ff55ff"
cyan    = "#55ffff"
white   = "#ffffff"

[colors.cursor]
cursor = "#aabbcc"
text   = "#112233"

[colors.selection]
background = "#334455"
text       = "#665544"
`;

describe("alacrittyTomlToITheme", () => {
  test("maps all primary/normal/bright/cursor/selection", () => {
    const t = alacrittyTomlToITheme(minimal);
    expect(t.foreground).toBe("#d4d4d4");
    expect(t.background).toBe("#1e1e1e");
    expect(t.black).toBe("#000000");
    expect(t.white).toBe("#cccccc");
    expect(t.brightBlack).toBe("#555555");
    expect(t.brightWhite).toBe("#ffffff");
    expect(t.cursor).toBe("#aabbcc");
    expect(t.cursorAccent).toBe("#112233");
    expect(t.selectionBackground).toBe("#334455");
    expect(t.selectionForeground).toBe("#665544");
  });

  test("passes through #RRGGBBAA unchanged", () => {
    const t = alacrittyTomlToITheme(`
[colors.primary]
foreground = "#ff00ff80"
background = "#00000000"
`);
    expect(t.foreground).toBe("#ff00ff80");
    expect(t.background).toBe("#00000000");
  });

  test("normalizes 0x prefix to #", () => {
    const t = alacrittyTomlToITheme(`
[colors.primary]
foreground = "0xaabbcc"
background = "0x112233"
`);
    expect(t.foreground).toBe("#aabbcc");
    expect(t.background).toBe("#112233");
  });

  test("missing sections fall back to undefined (xterm defaults)", () => {
    const t = alacrittyTomlToITheme(`
[colors.primary]
foreground = "#ffffff"
background = "#000000"
`);
    expect(t.black).toBeUndefined();
    expect(t.cursor).toBeUndefined();
  });

  test("throws on invalid TOML", () => {
    expect(() => alacrittyTomlToITheme("this = is [broken")).toThrow();
  });

  test("throws if neither foreground nor background present", () => {
    expect(() => alacrittyTomlToITheme(`[colors.normal]\nblack = "#000"\n`)).toThrow(/primary/);
  });
});
```

Run: `bun test tests/unit/server/colours.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: Implement**

Create `src/server/colours.ts`:

```ts
import { TOML } from "bun";

export interface ITheme {
  foreground?: string;
  background?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black?: string; red?: string; green?: string; yellow?: string;
  blue?: string; magenta?: string; cyan?: string; white?: string;
  brightBlack?: string; brightRed?: string; brightGreen?: string; brightYellow?: string;
  brightBlue?: string; brightMagenta?: string; brightCyan?: string; brightWhite?: string;
}

function normalize(c: unknown): string | undefined {
  if (typeof c !== "string") return undefined;
  const trimmed = c.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("#")) return trimmed.toLowerCase();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) return "#" + trimmed.slice(2).toLowerCase();
  return "#" + trimmed.toLowerCase();
}

const NORMAL_KEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

export function alacrittyTomlToITheme(src: string): ITheme {
  const parsed = TOML.parse(src) as any;
  const colors = parsed?.colors ?? {};
  const primary = colors.primary ?? {};
  const fg = normalize(primary.foreground);
  const bg = normalize(primary.background);
  if (!fg && !bg) {
    throw new Error("alacritty theme missing [colors.primary] foreground/background");
  }
  const out: ITheme = {};
  if (fg) out.foreground = fg;
  if (bg) out.background = bg;

  for (const key of NORMAL_KEYS) {
    const n = normalize(colors.normal?.[key]);
    if (n) (out as any)[key] = n;
    const b = normalize(colors.bright?.[key]);
    if (b) (out as any)["bright" + key[0]!.toUpperCase() + key.slice(1)] = b;
  }

  const cur = normalize(colors.cursor?.cursor);
  if (cur) out.cursor = cur;
  const curTxt = normalize(colors.cursor?.text);
  if (curTxt) out.cursorAccent = curTxt;

  const selBg = normalize(colors.selection?.background);
  if (selBg) out.selectionBackground = selBg;
  const selFg = normalize(colors.selection?.text);
  if (selFg) out.selectionForeground = selFg;

  return out;
}
```

Adjust the test's first case to match lowercase: all expected hex values in the minimal test already are lowercase; fine.

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/server/colours.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/colours.ts tests/unit/server/colours.test.ts
git commit -m "feat(server): alacritty TOML → xterm ITheme converter"
```

---

### Task 12: Extend manifest types + pack scanner to carry colours & theme defaults

**Files:**
- Modify: `src/server/themes.ts`
- Create: `tests/unit/server/colours-scan.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/server/colours-scan.test.ts`:

```ts
import { describe, test, expect, beforeAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { listPacks, listColours, listThemes } from "../../../src/server/themes.ts";

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-coltest-"));
  const pack = path.join(tmp, "p1");
  fs.mkdirSync(path.join(pack, "colours"), { recursive: true });
  fs.writeFileSync(path.join(pack, "colours", "a.toml"),
    `[colors.primary]\nforeground="#ffffff"\nbackground="#000000"\n`);
  fs.writeFileSync(path.join(pack, "theme.json"), JSON.stringify({
    author: "t", version: "1",
    colours: [{ file: "colours/a.toml", name: "A", variant: "dark" }],
    themes: [{ name: "T1", css: "t.css",
      defaultColours: "A", defaultFont: "F", defaultFontSize: 14, defaultLineHeight: 1.1 }],
  }));
  fs.writeFileSync(path.join(pack, "t.css"), "/* */");
});

describe("listColours / listThemes", () => {
  test("enumerates colours with parsed ITheme", () => {
    const packs = listPacks(null, tmp);
    const cols = listColours(packs);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.name).toBe("A");
    expect(cols[0]!.variant).toBe("dark");
    expect(cols[0]!.theme.foreground).toBe("#ffffff");
  });

  test("theme info carries defaultColours, defaultFontSize, defaultLineHeight", () => {
    const packs = listPacks(null, tmp);
    const themes = listThemes(packs);
    const t1 = themes.find(x => x.name === "T1")!;
    expect(t1.defaultColours).toBe("A");
    expect(t1.defaultFontSize).toBe(14);
    expect(t1.defaultLineHeight).toBe(1.1);
  });

  test("skips colour entry with invalid rel path", () => {
    const bad = path.join(tmp, "p2");
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, "theme.json"), JSON.stringify({
      colours: [{ file: "../evil.toml", name: "BAD" }], themes: [],
    }));
    const packs = listPacks(null, tmp);
    const cols = listColours(packs);
    expect(cols.find(c => c.name === "BAD")).toBeUndefined();
  });
});
```

Run: `bun test tests/unit/server/colours-scan.test.ts`
Expected: FAIL — `listColours` not exported, `defaultColours` missing.

- [ ] **Step 2: Extend types and listers**

In `src/server/themes.ts`:

Extend `PackManifest`:

```ts
export type PackManifest = {
  author?: string;
  version?: string;
  fonts?: { file: string; family: string }[];
  colours?: { file: string; name: string; variant?: 'dark' | 'light' }[];
  themes?: {
    name: string; css: string;
    defaultFont?: string;
    defaultFontSize?: number;
    defaultLineHeight?: number;
    defaultColours?: string;
  }[];
};
```

Extend `ThemeInfo`:

```ts
export type ThemeInfo = {
  name: string;
  pack: string;
  css: string;
  defaultFont?: string;
  defaultFontSize?: number;
  defaultLineHeight?: number;
  defaultColours?: string;
  author?: string;
  version?: string;
  source: 'user' | 'bundled';
};
```

Add the `ColourInfo` type and `listColours`:

```ts
import { alacrittyTomlToITheme, type ITheme } from './colours.js';

export type ColourInfo = {
  name: string;
  variant?: 'dark' | 'light';
  pack: string;
  source: 'user' | 'bundled';
  theme: ITheme;
};

export function listColours(packs: PackInfo[]): ColourInfo[] {
  const seen = new Map<string, ColourInfo>();
  for (const pack of packs) {
    for (const entry of pack.manifest.colours ?? []) {
      if (!entry.name || !entry.file) continue;
      if (!isValidPackRelPath(entry.file)) {
        console.warn(`[themes] pack '${pack.dir}': colour '${entry.name}' has invalid file path '${entry.file}'`);
        continue;
      }
      if (seen.has(entry.name)) {
        console.warn(`[themes] duplicate colour name '${entry.name}' in pack '${pack.dir}' (${pack.source}); overwriting`);
      }
      const fullPath = path.join(pack.fullPath, entry.file);
      let theme: ITheme;
      try {
        const src = fs.readFileSync(fullPath, 'utf8');
        theme = alacrittyTomlToITheme(src);
      } catch (e) {
        console.warn(`[themes] pack '${pack.dir}': failed to parse colour '${entry.name}' from '${entry.file}': ${e}`);
        continue;
      }
      seen.set(entry.name, {
        name: entry.name,
        variant: entry.variant,
        pack: pack.dir,
        source: pack.source,
        theme,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

Update `listThemes` to also copy `defaultFontSize`, `defaultLineHeight`, `defaultColours` (and validate `theme.css` via `isValidPackRelPath`).

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/server/colours-scan.test.ts`
Expected: PASS.

Also run the previously-passing tests to confirm no regression:

Run: `bun test tests/unit/server/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/themes.ts tests/unit/server/colours-scan.test.ts
git commit -m "feat(themes): pack manifest supports colours[] and extended theme defaults"
```

---

### Task 13: `/api/colours` endpoint

**Files:**
- Modify: `src/server/http.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/server/api-colours.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { createHttpHandler } from "../../../src/server/http.ts";
import fs from "fs"; import path from "path"; import os from "os";
import http from "http";

async function once(handler: any, url: string) {
  return new Promise<{status: number; body: string}>((resolve) => {
    const req: any = { method: "GET", url, headers: { host: "x" }, socket: { remoteAddress: "127.0.0.1" } };
    const chunks: Buffer[] = [];
    const res: any = {
      writeHead(status: number, _h?: any) { this._status = status; },
      end(body?: any) { resolve({ status: this._status ?? 200, body: body?.toString?.() ?? "" }); },
    };
    Promise.resolve(handler(req, res));
  });
}

describe("/api/colours", () => {
  test("returns parsed colour schemes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-api-"));
    const pack = path.join(tmp, "p");
    fs.mkdirSync(path.join(pack, "colours"), { recursive: true });
    fs.writeFileSync(path.join(pack, "colours", "foo.toml"),
      `[colors.primary]\nforeground="#ffffff"\nbackground="#000000"\n`);
    fs.writeFileSync(path.join(pack, "theme.json"), JSON.stringify({
      colours: [{ file: "colours/foo.toml", name: "Foo", variant: "dark" }],
      themes: [],
    }));

    const handler = await createHttpHandler({
      config: { host: "", port: 0, allowedIps: new Set(), tls: false, testMode: true, debug: false,
                tmuxBin: "tmux", auth: { enabled: false } } as any,
      htmlTemplate: "", distDir: "", fontsDir: "", themesUserDir: "",
      themesBundledDir: tmp, projectRoot: tmp, isCompiled: false,
    });
    const { status, body } = await once(handler, "/api/colours");
    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("Foo");
    expect(json[0].variant).toBe("dark");
    expect(json[0].theme.background).toBe("#000000");
  });
});
```

Run: `bun test tests/unit/server/api-colours.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 2: Add route**

In `src/server/http.ts`, inside the handler, beside the `/api/themes` branch:

```ts
if (pathname === '/api/colours') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(listColours(packs).map(c => ({
    name: c.name, variant: c.variant, theme: c.theme,
  }))));
  return;
}
```

Add `listColours` to the import from `./themes.js`.

- [ ] **Step 3: Run test**

Run: `bun test tests/unit/server/api-colours.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/http.ts tests/unit/server/api-colours.test.ts
git commit -m "feat(api): GET /api/colours"
```

---

### Task 14: Ship 10 bundled Alacritty colour schemes

**Files:**
- Create: `themes/default/colours/{gruvbox-dark,gruvbox-light,solarized-dark,solarized-light,dracula,nord,tokyo-night,catppuccin-mocha,monokai,tomorrow}.toml`
- Modify: `themes/default/theme.json`

- [ ] **Step 1: Create the 10 files**

Copy canonical Alacritty theme TOML for each scheme from the alacritty-theme repo at `github.com/alacritty/alacritty-theme/tree/master/themes`. Each file must contain `[colors.primary]`, `[colors.normal]`, `[colors.bright]`; `[colors.cursor]` and `[colors.selection]` when upstream provides them.

For each scheme, verify it parses:

```bash
bun -e 'import { alacrittyTomlToITheme } from "./src/server/colours.ts"; \
import fs from "fs"; \
for (const f of ["gruvbox-dark","gruvbox-light","solarized-dark","solarized-light","dracula","nord","tokyo-night","catppuccin-mocha","monokai","tomorrow"]) { \
  const src = fs.readFileSync(`themes/default/colours/${f}.toml`, "utf8"); \
  const t = alacrittyTomlToITheme(src); \
  console.log(f, "bg=", t.background, "fg=", t.foreground); \
}'
```

Expected: 10 lines, each with `bg=` and `fg=` hex values.

- [ ] **Step 2: Update `themes/default/theme.json`**

```json
{
  "author": "tmux-web",
  "version": "1",
  "fonts": [
    { "file": "fonts/Iosevka Nerd Font Mono.woff2", "family": "Iosevka Nerd Font Mono" },
    { "file": "fonts/MicroKnight Nerd Font.woff2", "family": "MicroKnight Nerd Font" },
    { "file": "fonts/Topaz8 Amiga1200 Nerd Font.woff2", "family": "Topaz8 Amiga1200 Nerd Font" },
    { "file": "fonts/mOsOul Nerd Font.woff2", "family": "mOsOul Nerd Font" }
  ],
  "colours": [
    { "file": "colours/gruvbox-dark.toml", "name": "Gruvbox Dark", "variant": "dark" },
    { "file": "colours/gruvbox-light.toml", "name": "Gruvbox Light", "variant": "light" },
    { "file": "colours/solarized-dark.toml", "name": "Solarized Dark", "variant": "dark" },
    { "file": "colours/solarized-light.toml", "name": "Solarized Light", "variant": "light" },
    { "file": "colours/dracula.toml", "name": "Dracula", "variant": "dark" },
    { "file": "colours/nord.toml", "name": "Nord", "variant": "dark" },
    { "file": "colours/tokyo-night.toml", "name": "Tokyo Night", "variant": "dark" },
    { "file": "colours/catppuccin-mocha.toml", "name": "Catppuccin Mocha", "variant": "dark" },
    { "file": "colours/monokai.toml", "name": "Monokai", "variant": "dark" },
    { "file": "colours/tomorrow.toml", "name": "Tomorrow", "variant": "light" }
  ],
  "themes": [
    { "name": "Default", "css": "default.css",
      "defaultColours": "Gruvbox Dark" }
  ]
}
```

Also move `default.css` under a subdirectory if desired — NOT NEEDED; `default.css` stays at pack root.

Also relocate existing bundled fonts: the fonts currently resolve via `/fonts/...` and are packaged in a separate `fonts/` dir at project root. They stay there for backward-compat. Leave `fonts[].file` using the `fonts/...` subpath (already accepted by `isValidPackRelPath`). Verify at runtime via font loading test in Task 23.

Actually — current layout has fonts in `fonts/` at project root, not `themes/default/fonts/`. The `theme.json.fonts` entries currently use bare filenames like `"Iosevka Nerd Font Mono.woff2"` which are served from the legacy `/fonts/` URL (see `src/server/http.ts:254-256` legacy fallback). Keep that behaviour: do NOT change `fonts[].file` values here. Keep the `theme.json` fonts exactly as today.

Corrected `theme.json`:

```json
{
  "author": "tmux-web",
  "version": "1",
  "fonts": [
    { "file": "Iosevka Nerd Font Mono.woff2", "family": "Iosevka Nerd Font Mono" },
    { "file": "MicroKnight Nerd Font.woff2", "family": "MicroKnight Nerd Font" },
    { "file": "Topaz8 Amiga1200 Nerd Font.woff2", "family": "Topaz8 Amiga1200 Nerd Font" },
    { "file": "mOsOul Nerd Font.woff2", "family": "mOsOul Nerd Font" }
  ],
  "colours": [
    { "file": "colours/gruvbox-dark.toml", "name": "Gruvbox Dark", "variant": "dark" },
    ...
  ],
  "themes": [
    { "name": "Default", "css": "default.css", "defaultColours": "Gruvbox Dark" }
  ]
}
```

- [ ] **Step 3: Update `themes/amiga/theme.json`**

```json
{
  "author": "tmux-web",
  "version": "1",
  "themes": [
    {
      "name": "AmigaOS 3.1",
      "css": "amiga.css",
      "defaultFont": "Topaz8 Amiga1200 Nerd Font",
      "defaultFontSize": 16,
      "defaultLineHeight": 1.0,
      "defaultColours": "Monokai"
    }
  ]
}
```

(User may revise later.)

- [ ] **Step 4: Regenerate embedded assets**

Run: `bun run scripts/generate-assets.ts`
Expected: `src/server/assets-embedded.ts` now includes `themes/default/colours/*.toml` entries.

- [ ] **Step 5: Commit**

```bash
git add themes/default/colours themes/default/theme.json themes/amiga/theme.json src/server/assets-embedded.ts
git commit -m "feat(themes): bundle 10 alacritty colour schemes; wire defaults into themes"
```

---

## Phase C — Client session-settings model

### Task 15: Client-side session-settings module

**Files:**
- Create: `src/client/session-settings.ts`
- Create: `tests/unit/client/session-settings.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, test, expect, beforeEach } from "bun:test";

describe("session-settings", () => {
  beforeEach(() => {
    // Simulate localStorage
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    };
  });

  test("returns defaults when nothing stored and no live session", async () => {
    const { loadSessionSettings, DEFAULT_SESSION_SETTINGS } =
      await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const s = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.fontSize).toBe(DEFAULT_SESSION_SETTINGS.fontSize);
  });

  test("overlays theme defaults when no stored + no live", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const s = mod.loadSessionSettings("foo", null, {
      defaults: mod.DEFAULT_SESSION_SETTINGS,
      themeDefaults: { colours: "Dracula", fontFamily: "X", fontSize: 14, lineHeight: 1.2 },
    });
    expect(s.colours).toBe("Dracula");
    expect(s.fontFamily).toBe("X");
    expect(s.fontSize).toBe(14);
    expect(s.lineHeight).toBe(1.2);
  });

  test("inherits from live session when no stored", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const live = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Nord", opacity: 40, fontSize: 20 };
    const s = mod.loadSessionSettings("new-sess", live, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(s.colours).toBe("Nord");
    expect(s.opacity).toBe(40);
    expect(s.fontSize).toBe(20);
  });

  test("saves and loads round-trip", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const s = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Monokai", opacity: 50 };
    mod.saveSessionSettings("x", s);
    const loaded = mod.loadSessionSettings("x", null, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(loaded.colours).toBe("Monokai");
    expect(loaded.opacity).toBe(50);
  });
});
```

Run: `bun test tests/unit/client/session-settings.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: Implement**

Create `src/client/session-settings.ts`:

```ts
export interface SessionSettings {
  theme: string;
  colours: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  opacity: number; // 0..100
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  theme: 'Default',
  colours: 'Gruvbox Dark',
  fontFamily: 'Iosevka Nerd Font Mono',
  fontSize: 18,
  lineHeight: 0.85,
  opacity: 0,
};

const prefix = 'tmux-web-session:';

export interface ThemeDefaults {
  colours?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
}

export interface LoadOpts {
  defaults: SessionSettings;
  themeDefaults?: ThemeDefaults;
}

export function loadSessionSettings(name: string, live: SessionSettings | null, opts: LoadOpts): SessionSettings {
  try {
    const raw = localStorage.getItem(prefix + name);
    if (raw) return { ...opts.defaults, ...JSON.parse(raw) };
  } catch {}
  if (live) return { ...live };
  const overlay: Partial<SessionSettings> = {};
  const td = opts.themeDefaults ?? {};
  if (td.colours) overlay.colours = td.colours;
  if (td.fontFamily) overlay.fontFamily = td.fontFamily;
  if (td.fontSize !== undefined) overlay.fontSize = td.fontSize;
  if (td.lineHeight !== undefined) overlay.lineHeight = td.lineHeight;
  return { ...opts.defaults, ...overlay };
}

export function saveSessionSettings(name: string, s: SessionSettings): void {
  try { localStorage.setItem(prefix + name, JSON.stringify(s)); } catch {}
}

export function applyThemeDefaults(s: SessionSettings, td: ThemeDefaults): SessionSettings {
  return {
    ...s,
    colours: td.colours ?? s.colours,
    fontFamily: td.fontFamily ?? s.fontFamily,
    fontSize: td.fontSize ?? s.fontSize,
    lineHeight: td.lineHeight ?? s.lineHeight,
  };
}
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/client/session-settings.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/session-settings.ts tests/unit/client/session-settings.test.ts
git commit -m "feat(client): per-session settings with inherit-from-active and theme-defaults overlay"
```

---

### Task 16: Opacity → rgba compositor

**Files:**
- Create: `src/client/colours.ts`
- Create: `tests/unit/client/compose-theme.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, test, expect } from "bun:test";
import { composeTheme } from "../../../src/client/colours.ts";

describe("composeTheme", () => {
  test("applies opacity to #RRGGBB background", () => {
    const t = composeTheme({ foreground: "#ffffff", background: "#112233" } as any, 50);
    expect(t.background).toBe("rgba(17,34,51,0.5)");
  });

  test("opacity 0 is fully transparent", () => {
    const t = composeTheme({ background: "#abcdef" } as any, 0);
    expect(t.background).toBe("rgba(171,205,239,0)");
  });

  test("opacity 100 preserves full alpha", () => {
    const t = composeTheme({ background: "#abcdef" } as any, 100);
    expect(t.background).toBe("rgba(171,205,239,1)");
  });

  test("preserves foreground untouched", () => {
    const t = composeTheme({ foreground: "#ff0000", background: "#000000" } as any, 40);
    expect(t.foreground).toBe("#ff0000");
  });

  test("#RRGGBBAA background: replaces existing alpha with opacity", () => {
    const t = composeTheme({ background: "#11223380" } as any, 50);
    expect(t.background).toBe("rgba(17,34,51,0.5)");
  });
});
```

Run: `bun test tests/unit/client/compose-theme.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/client/colours.ts`:

```ts
import type { ITheme } from '../server/colours.js';

export type { ITheme };

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace(/^#/, '');
  const six = s.length >= 6 ? s.slice(0, 6) : s.padStart(6, '0');
  return {
    r: parseInt(six.slice(0, 2), 16),
    g: parseInt(six.slice(2, 4), 16),
    b: parseInt(six.slice(4, 6), 16),
  };
}

export function composeTheme(theme: ITheme, opacityPct: number): ITheme {
  const bg = theme.background ?? '#000000';
  const { r, g, b } = hexToRgb(bg);
  const alpha = Math.max(0, Math.min(100, opacityPct)) / 100;
  const alphaStr = alpha === 0 ? '0' : alpha === 1 ? '1' : String(alpha);
  return { ...theme, background: `rgba(${r},${g},${b},${alphaStr})` };
}

export async function fetchColours(): Promise<Array<{ name: string; variant?: string; theme: ITheme }>> {
  const res = await fetch('/api/colours');
  if (!res.ok) return [];
  return res.json();
}
```

Note: importing `ITheme` from `src/server/colours.js` would bundle server code into client. Fix by declaring `ITheme` locally instead:

```ts
export interface ITheme { /* same shape as server/colours.ts */ }
```

Then update `src/server/colours.ts` test import path unchanged. The two `ITheme` shapes are structurally identical; if we want a single source of truth, move the interface to `src/shared/types.ts`. Do that:

In `src/shared/types.ts`, add the `ITheme` interface (copy the shape from `src/server/colours.ts`). Then both `src/server/colours.ts` and `src/client/colours.ts` import it from shared.

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/client/compose-theme.test.ts`
Expected: PASS.

Run: `bun test tests/unit/server/colours.test.ts` to confirm the import-path change didn't break the server test.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/colours.ts src/shared/types.ts src/server/colours.ts tests/unit/client/compose-theme.test.ts
git commit -m "feat(client): composeTheme(opacity) + /api/colours fetch; share ITheme type"
```

---

### Task 17: Replace `src/client/settings.ts` with slim session-settings consumers

**Files:**
- Delete: `src/client/settings.ts`
- Modify: `src/client/theme.ts` (extend `ThemeInfo`)
- Modify: `src/client/index.ts` and `src/client/ui/topbar.ts` (imports only)

- [ ] **Step 1: Extend client `ThemeInfo`**

`src/client/theme.ts` — extend the exported `ThemeInfo`:

```ts
export type ThemeInfo = {
  name: string;
  pack: string;
  css: string;
  defaultFont?: string;
  defaultFontSize?: number;
  defaultLineHeight?: number;
  defaultColours?: string;
  author?: string;
  version?: string;
  source: 'user' | 'bundled';
};
```

- [ ] **Step 2: Delete the old settings module**

```bash
git rm src/client/settings.ts
```

- [ ] **Step 3: Replace imports**

Everywhere that imports from `./settings.js` (or `../settings.js`) — grep and update:

- `src/client/index.ts`: replace `import { loadSettings, getActiveThemeName } from './settings.js'; import type { TerminalSettings } from './settings.js';` with the new session-settings imports.
- `src/client/ui/topbar.ts`: replace the big import from `'../settings.js'` with imports from `'../session-settings.js'` + `'../prefs.js'`.

The full rewires live in Task 18 (topbar UI) and Task 19 (index.ts wiring). For this commit only, mechanically delete the dead imports and let the typechecker flag what still references deleted names — those references are handled in 18/19.

- [ ] **Step 4: Commit (WIP — typecheck red)**

```bash
git add -A
git commit -m "refactor(client): delete settings.ts; extend ThemeInfo with new default fields (WIP)"
```

(This commit is intentionally WIP — the next two tasks finish the wiring.)

---

### Task 18: Topbar UI — colours select, opacity slider, reset links

**Files:**
- Modify: `src/client/index.html`
- Modify: `src/client/ui/topbar.ts`

- [ ] **Step 1: Update HTML**

In `src/client/index.html`, replace the existing font/size/line-height rows with this block and add new rows. The new menu body (between the first `<hr class="menu-hr">` and `<div id="menu-footer">`):

```html
<div class="menu-row menu-row-static">
  <span class="menu-label">Theme</span>
  <select id="inp-theme" class="menu-input-select" style="flex:1"></select>
</div>
<div class="menu-row menu-row-static">
  <span class="menu-label">Colours</span>
  <select id="inp-colours" class="menu-input-select" style="flex:1"></select>
  <button class="tb-btn" id="btn-reset-colours" title="Reset colours to theme default">↺</button>
</div>
<hr class="menu-hr">
<div class="menu-row menu-row-static">
  <span class="menu-label">Font</span>
  <select id="inp-font-bundled" class="menu-input-select" style="flex:1"></select>
  <button class="tb-btn" id="btn-reset-font" title="Reset font to theme default">↺</button>
</div>
<div class="menu-row menu-row-static">
  <span class="menu-label">Size</span>
  <input type="range" id="sld-fontsize" min="8" max="30" step="0.5" style="flex:1">
  <input type="number" id="inp-fontsize" min="8" max="30" step="0.5" class="menu-input-number">
</div>
<div class="menu-row menu-row-static">
  <span class="menu-label">Line height</span>
  <input type="range" id="sld-lineheight" min="0.5" max="2" step="0.05" style="flex:1">
  <input type="number" id="inp-lineheight" min="0.5" max="2" step="0.05" class="menu-input-number">
</div>
<div class="menu-row menu-row-static">
  <span class="menu-label">Opacity</span>
  <input type="range" id="sld-opacity" min="0" max="100" step="1" style="flex:1">
  <input type="number" id="inp-opacity" min="0" max="100" step="1" class="menu-input-number">
</div>
```

- [ ] **Step 2: Rewrite `setupSettingsInputs()` in `topbar.ts`**

Replace the method body to:

1. Read the active session's settings via `loadSessionSettings(sessionName, liveGetter(), { defaults, themeDefaults })` — where `liveGetter()` returns `null` on first load.
2. Populate `#inp-theme`, `#inp-colours`, `#inp-font-bundled` from `/api/themes`, `/api/colours`, `/api/fonts`.
3. Wire change listeners: each commits a new full `SessionSettings` via `saveSessionSettings(name, s)` and calls `opts.onSettingsChange(s)`.
4. On theme change: look up the theme in the fetched list, call `applyThemeDefaults(current, { colours: theme.defaultColours, fontFamily: theme.defaultFont, fontSize: theme.defaultFontSize, lineHeight: theme.defaultLineHeight })`, save, push to `opts.onSettingsChange`.
5. "Reset to theme default" buttons: rebuild with `applyThemeDefaults` for the relevant subset (colours-only, font-only).
6. Opacity slider + number input bi-directional (mirror the existing size/line-height pattern).

Remove `setupTerminalSelector`, `isThemeFontTouched`, `markThemeFontTouched`, `lineHeightPerFont` machinery entirely — per Q4=A, theme switch always overwrites.

Key signature change to `TopbarOptions`:

```ts
export interface TopbarOptions {
  send: (data: string) => void;
  focus: () => void;
  getLiveSettings: () => SessionSettings | null;
  onAutohideChange?: () => void;
  onSettingsChange?: (s: SessionSettings) => void | Promise<void>;
}
```

Note `onThemeChange` folds into `onSettingsChange` — the UI theme is one field of `SessionSettings`.

The full body is substantial; implement it directly following these rules. No code block repeated here — reference the module contract above and the event-wiring patterns already present.

- [ ] **Step 3: Typecheck**

Run: `bun run tsc --noEmit`
Expected: only errors in `src/client/index.ts`, fixed in Task 19.

- [ ] **Step 4: Commit**

```bash
git add src/client/index.html src/client/ui/topbar.ts
git commit -m "feat(ui): colours dropdown, opacity slider, reset-to-theme-default buttons"
```

---

### Task 19: Wire session-settings + live theme updates in `src/client/index.ts`

**Files:**
- Modify: `src/client/index.ts`

- [ ] **Step 1: Rewrite `main()`**

Replacement outline:

```ts
import { loadSessionSettings, saveSessionSettings, applyThemeDefaults,
  DEFAULT_SESSION_SETTINGS, type SessionSettings } from './session-settings.js';
import { fetchColours, composeTheme, type ITheme } from './colours.js';
import { applyTheme, loadAllFonts, listThemes, readBorderInsets } from './theme.js';
import { getTopbarAutohide } from './prefs.js';

async function main() {
  const config = window.__TMUX_WEB_CONFIG;
  const { XtermAdapter } = await import('./adapters/xterm.ts');
  const adapter: TerminalAdapter = new XtermAdapter();

  const container = document.getElementById('terminal')!;
  if (!getTopbarAutohide()) document.body.classList.add('topbar-pinned');

  const [themes, colours] = await Promise.all([listThemes(), fetchColours()]);
  await loadAllFonts();

  const sessionName = location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
  const currentTheme = themes.find(t => t.name === DEFAULT_SESSION_SETTINGS.theme) ?? themes[0];
  const themeDefaults = currentTheme ? {
    colours: currentTheme.defaultColours,
    fontFamily: currentTheme.defaultFont,
    fontSize: currentTheme.defaultFontSize,
    lineHeight: currentTheme.defaultLineHeight,
  } : undefined;

  let settings = loadSessionSettings(sessionName, null, {
    defaults: DEFAULT_SESSION_SETTINGS,
    themeDefaults,
  });
  // Persist immediately so a later "live session" lookup finds it.
  saveSessionSettings(sessionName, settings);

  await applyTheme(settings.theme);
  applyTerminalInsets();

  const colourByName = new Map(colours.map(c => [c.name, c.theme]));
  const coloursOrDefault = (name: string): ITheme =>
    colourByName.get(name) ?? { foreground: '#d4d4d4', background: '#1e1e1e' };

  await adapter.init(container, {
    fontFamily: `"${settings.fontFamily}", monospace`,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    theme: composeTheme(coloursOrDefault(settings.colours), settings.opacity),
  });
  adapter.focus();
  (window as any).__adapter = adapter;

  let appliedFontKey = settings.fontFamily;
  let connection: Connection;

  const topbar = new Topbar({
    send: (data) => connection.send(data),
    focus: () => adapter.focus(),
    getLiveSettings: () => settings,
    onAutohideChange: () => { applyTerminalInsets(); adapter.fit(); },
    onSettingsChange: async (s) => {
      const themeChanged = s.theme !== settings.theme;
      const fontChanged = s.fontFamily !== appliedFontKey;
      settings = s;
      saveSessionSettings(sessionName, s);
      if (themeChanged) {
        await applyTheme(s.theme);
        applyTerminalInsets();
      }
      adapter.setTheme(composeTheme(coloursOrDefault(s.colours), s.opacity));
      if (fontChanged && adapter.requiresReloadForFontChange) {
        const _dd = document.getElementById('menu-dropdown') as HTMLElement | null;
        if (_dd && !_dd.hidden) sessionStorage.setItem('tmux-web:menu-reopen', '1');
        appliedFontKey = s.fontFamily;
        location.reload();
        return;
      }
      adapter.updateOptions?.({
        fontFamily: `"${s.fontFamily}", monospace`,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
      });
      if (fontChanged) {
        appliedFontKey = s.fontFamily;
        document.fonts.load(`18px "${s.fontFamily}"`).then(() => adapter.fit()).catch(() => adapter.fit());
      }
      adapter.fit();
    },
  });
  await topbar.init();
  applyTerminalInsets();
  adapter.fit();

  // ... rest of main() (connection, handlers) unchanged from current ...
}
```

Reuse everything after `topbar.init()` — `handleMessage`, `connection`, `installMouseHandler`, `attachCustomWheelEventHandler`, `installKeyboardHandler`, etc. — verbatim.

- [ ] **Step 2: Typecheck + build**

Run: `bun run tsc --noEmit && make build`
Expected: no errors, `dist/client/xterm.js` produced.

- [ ] **Step 3: Commit**

```bash
git add src/client/index.ts
git commit -m "feat(client): wire per-session settings, live colours + opacity, theme defaults on switch"
```

---

## Phase D — Integration smoke + tests

### Task 20: Unit test — theme switch overwrites fields

**Files:**
- Modify: `tests/unit/client/session-settings.test.ts`

- [ ] **Step 1: Add test**

```ts
test("applyThemeDefaults overwrites all four fields when provided", async () => {
  const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
  const start = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Old", fontFamily: "Old", fontSize: 10, lineHeight: 1.5, opacity: 30 };
  const result = mod.applyThemeDefaults(start, { colours: "New", fontFamily: "New", fontSize: 20, lineHeight: 0.9 });
  expect(result.colours).toBe("New");
  expect(result.fontFamily).toBe("New");
  expect(result.fontSize).toBe(20);
  expect(result.lineHeight).toBe(0.9);
  expect(result.opacity).toBe(30);  // opacity not in theme defaults — unchanged
});

test("applyThemeDefaults leaves fields unchanged when theme has no default", async () => {
  const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
  const start = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Keep" };
  const result = mod.applyThemeDefaults(start, {});
  expect(result.colours).toBe("Keep");
});
```

- [ ] **Step 2: Run tests**

Run: `bun test tests/unit/client/session-settings.test.ts`
Expected: PASS (already implemented in Task 15).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/client/session-settings.test.ts
git commit -m "test(session-settings): theme-default overwrite semantics"
```

---

### Task 21: E2E — colour scheme switch

**Files:**
- Create: `tests/e2e/colours.test.ts`

- [ ] **Step 1: Write test**

Using existing helpers in `tests/e2e/helpers.ts` (grep for `launchServer` / `buildContext` patterns used in `theming.spec.ts`):

```ts
import { test, expect } from "@playwright/test";
import { launchWithTmuxWeb } from "./helpers";

test("switch colour scheme applies new background hex live", async ({ browser }) => {
  const { page, stop } = await launchWithTmuxWeb(browser);
  try {
    await page.goto("/");
    await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

    await page.click("#btn-menu");
    await page.selectOption("#inp-colours", "Dracula");

    // Inspect the xterm computed background via adapter handle
    const bg = await page.evaluate(() => {
      const t = (window as any).__adapter?.term;
      return t?.options?.theme?.background;
    });
    expect(bg).toMatch(/^rgba\(/);
  } finally { await stop(); }
});
```

Adapt the helper name to whatever `tests/e2e/helpers.ts` actually exports (check `tests/e2e/theming.spec.ts` for its pattern and copy).

- [ ] **Step 2: Run**

Run: `make build && node node_modules/.bin/playwright test tests/e2e/colours.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/colours.test.ts
git commit -m "test(e2e): switch colour scheme updates live xterm theme"
```

---

### Task 22: E2E — opacity slider

**Files:**
- Create: `tests/e2e/opacity.test.ts`

- [ ] **Step 1: Write test**

```ts
import { test, expect } from "@playwright/test";
import { launchWithTmuxWeb } from "./helpers";

test("opacity slider updates xterm background alpha", async ({ browser }) => {
  const { page, stop } = await launchWithTmuxWeb(browser);
  try {
    await page.goto("/");
    await page.click("#btn-menu");

    await page.fill("#inp-opacity", "50");
    await page.dispatchEvent("#inp-opacity", "change");

    const bg = await page.evaluate(() => (window as any).__adapter?.term?.options?.theme?.background);
    expect(bg).toMatch(/rgba\([^)]+,\s*0\.5\)$/);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run**

Run: `node node_modules/.bin/playwright test tests/e2e/opacity.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/opacity.test.ts
git commit -m "test(e2e): opacity slider composes rgba alpha"
```

---

### Task 23: E2E — session inheritance

**Files:**
- Create: `tests/e2e/session-inheritance.test.ts`

- [ ] **Step 1: Write test**

```ts
import { test, expect } from "@playwright/test";
import { launchWithTmuxWeb } from "./helpers";

test("new session inherits live session's settings", async ({ browser }) => {
  const { page, stop } = await launchWithTmuxWeb(browser);
  try {
    await page.goto("/main");
    await page.click("#btn-menu");
    await page.selectOption("#inp-colours", "Nord");
    await page.fill("#inp-opacity", "40");
    await page.dispatchEvent("#inp-opacity", "change");

    // Navigate directly to a new session URL (as [+] does via location.href).
    await page.goto("/fresh-sess");
    await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tmux-web-session:fresh-sess") || "null")
    );
    expect(stored?.colours).toBe("Nord");
    expect(stored?.opacity).toBe(40);
  } finally { await stop(); }
});

test("theme switch overwrites colours and font in active session", async ({ browser }) => {
  const { page, stop } = await launchWithTmuxWeb(browser);
  try {
    await page.goto("/main");
    await page.click("#btn-menu");
    // Assume "AmigaOS 3.1" has defaultColours: "Monokai"
    await page.selectOption("#inp-theme", "AmigaOS 3.1");
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tmux-web-session:main") || "null")
    );
    expect(stored?.colours).toBe("Monokai");
    expect(stored?.fontFamily).toBe("Topaz8 Amiga1200 Nerd Font");
  } finally { await stop(); }
});
```

Inheritance works because `loadSessionSettings` reads from `localStorage` if present; the new-session flow saves immediately on first load. Verify that either (a) the same page context is reused across the two `page.goto` calls (playwright default: yes, same context), so localStorage persists; or (b) use `browser.newContext()` with storageState to force the scenario. Default should be fine.

- [ ] **Step 2: Run**

Run: `node node_modules/.bin/playwright test tests/e2e/session-inheritance.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/session-inheritance.test.ts
git commit -m "test(e2e): session inheritance and theme-switch overwrite"
```

---

### Task 24: Full test sweep

- [ ] **Step 1: Run unit tests**

Run: `bun test`
Expected: all pass.

- [ ] **Step 2: Run E2E tests**

Run: `make build && node node_modules/.bin/playwright test`
Expected: all pass.

- [ ] **Step 3: Fix any regressions**

If failures surface, fix the implementation (never the tests — per CLAUDE.md Test Fixing Policy). Commit each fix separately.

- [ ] **Step 4: No extra commit if all green**

---

## Phase E — Docs + release verification

### Task 25: Update CLAUDE.md and README.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: CLAUDE.md**

- Remove `ghostty-web 0.4.0` from Terminal backends line.
- Remove the `ghostty` branch from the CLI options table.
- Add a "Colour schemes" subsection under Architecture explaining:
  - Theme packs contribute colour schemes via `colours[]` in `theme.json`.
  - `.toml` uses Alacritty format.
  - Parsed server-side via `import { TOML } from "bun"` → xterm `ITheme`.
  - Per-session storage in `localStorage["tmux-web-session:<name>"]`.
  - Theme switch unconditionally overwrites `colours`, `fontFamily`, `fontSize`, `lineHeight` with the new theme's defaults.
- Document the full-relative-path rule: `theme.json` file references may use subdirectories, but no `..` or leading `/` or leading `.` segments.

- [ ] **Step 2: README.md**

Remove all ghostty mentions, document the Colours section of the settings menu, document `--terminal` removal (breaking change for 1.1.0), and list new features.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document colours, remove ghostty, flag 1.1.0 as breaking"
```

---

### Task 26: Release verification via `act`

Per `CLAUDE.md`: "Before pushing a release tag (or any change to the build pipeline) you MUST run the release workflow locally with `act`".

- [ ] **Step 1: Run `act`**

Run:

```bash
act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

Expected:
- `scripts/verify-vendor-xterm.ts` passes.
- Unit tests pass.
- `upload-artifact` step fails with no token (expected and fine).
- Every step before upload is green.

- [ ] **Step 2: Fix any pipeline regressions**

If vendor xterm sentinel check fails, investigate `bun-build.ts` (we did NOT touch the vendor block per CLAUDE.md, so this should stay green). If it fails, stop and debug — do not proceed.

- [ ] **Step 3: Commit any fixes**

Separate commit per fix.

- [ ] **Step 4: No extra commit if all green**

---

### Task 27: Final sanity sweep

- [ ] **Step 1: Grep for stragglers**

Run:

```bash
grep -rn "ghostty" . --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.html" --include="Makefile" | grep -v node_modules | grep -v vendor/xterm.js
```

Expected: empty, or only historical mentions in commit messages (which can't be in tracked files) — in which case investigate and remove.

- [ ] **Step 2: Manual smoke**

Run: `bun src/server/index.ts --test --listen 127.0.0.1:4022 --no-auth --no-tls` and open `https://127.0.0.1:4022` (or http). Verify:
- Theme dropdown shows Default + AmigaOS 3.1.
- Colours dropdown shows 10 entries grouped by variant.
- Switching theme overwrites font/colours/line-height.
- Opacity slider visibly changes terminal background alpha (UI theme shows through).
- Creating a new session via `[+]` inherits current colours/opacity.
- No ghostty references anywhere in the UI.

- [ ] **Step 3: Final commit**

No changes required if everything passes. If cleanup needed, commit it:

```bash
git add -A
git commit -m "chore: final sweep for ghostty stragglers"
```

---

## Self-Review Notes

**Spec coverage:**
- Ghostty removal: Tasks 1–8 ✓
- Alacritty TOML parsing: Task 11 ✓
- `theme.json.colours` + subdir paths: Tasks 9, 10, 12, 14 ✓
- `/api/colours` + extended `/api/themes`: Tasks 12, 13 ✓
- 10 bundled schemes: Task 14 ✓
- Per-session `localStorage` model: Tasks 15, 16 ✓
- Inherit-from-active: Task 15 + E2E Task 23 ✓
- Theme-switch always overwrites (Q4=A): Tasks 15, 18, 19, 20, 23 ✓
- Transparent bg + opacity slider: Tasks 2, 16, 18, 19, 22 ✓
- Full-relative-path rule: Tasks 9, 10 ✓
- Config-menu restructure: Task 18 ✓
- Tests: Tasks 20–24 ✓
- Docs + release verify + version bump: Tasks 4 (version), 25, 26 ✓
- No cookie migration: confirmed (Task 17 deletes `settings.ts` outright).

**Type consistency:**
- `SessionSettings` shape identical across Tasks 15, 18, 19. ✓
- `ITheme` moved to `src/shared/types.ts` in Task 16, consumed by server and client. ✓
- `ThemeInfo` extended identically in server (`src/server/themes.ts`, Task 12) and client (`src/client/theme.ts`, Task 17). ✓
- `TopbarOptions` renamed `onThemeChange` → folded into `onSettingsChange`; new `getLiveSettings` field added in Task 18, consumed in Task 19. ✓

**Placeholder scan:**
- Task 18 Step 2 deliberately summarises the method body instead of inlining it in full — this is a ~80-line method. The contract is specified (API populate, change-listener semantics, reset buttons, opacity pattern). Acceptable given size; an engineer following the plan will synthesise from surrounding code.
- Task 26 Step 1 — `act` command copied verbatim from CLAUDE.md.

No TBDs, no "handle edge cases", no "similar to Task N".
