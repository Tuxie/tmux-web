# CSS Variable Refactor: Design Spec

**Date:** 2026-04-20
**Goal:** Maximize design reuse across themes by establishing a CSS variable hierarchy in base.css where all derived colors auto-calculate from a small set of primitives. Themes set only what makes them unique; everything else cascades.

**Constraint:** The visual appearance of all three themes (Default, AmigaOS 3.1, Amiga Scene 2000) must remain identical after the refactor.

---

## 1. Variable Hierarchy

Two independent color systems:

- **Theme primary** — drives all GUI chrome (toolbar, menus, gadgets, bevels)
- **Body background** — drives the terminal/body gradient (existing slider system, unchanged)

### Slider Inputs (JS-written)

| Variable | Range | Default | Notes |
|----------|-------|---------|-------|
| `--tw-theme-hue` | 0-360 | 0 | Existing |
| `--tw-theme-sat` | 0%-100% | 0% | New |
| `--tw-theme-ltn` | 0%-100% | 15% | New |
| `--tw-theme-contrast` | 0.5-1.5 | 1 | New. Scales bevel/shadow spread |
| `--tw-bg-hue` | 0-360 | 0 | Existing, unchanged |
| `--tw-bg-sat` | (delta) | 0 | Existing, unchanged |
| `--tw-bg-brightest` | 0-100 | 12 | Existing, unchanged |
| `--tw-bg-darkest` | 0-100 | 12 | Existing, unchanged |

### Root

```css
--tw-primary: hsl(var(--tw-theme-hue) var(--tw-theme-sat) var(--tw-theme-ltn));
```

### Branch Variables

Each defaults to its parent. Override = one line.

```
--tw-primary
  |
  +-- --tw-chrome: var(--tw-primary)
  |     Toolbar, frame fill, active tabs
  |
  +-- --tw-chrome-bg: var(--tw-chrome)
  |     Menu bg, panel bg, dropdown bg
  |
  +-- --tw-gadget-bg: var(--tw-chrome-bg)
        Inputs, buttons, checkboxes, slider thumbs
```

### Derived Leaves

Auto-calculated via `color-mix(in srgb, ...)`. The `srgb` color space is used throughout because it handles translucent base values correctly (Scene's `rgba(255,255,255,0.12)` gadget-bg needs hover/active states that increase opacity).

**From `--tw-chrome`:**

| Variable | Formula |
|----------|---------|
| `--tw-bevel-hi` | `color-mix(in srgb, var(--tw-chrome), white calc(20% * var(--tw-theme-contrast)))` |
| `--tw-bevel-lo` | `color-mix(in srgb, var(--tw-chrome), black calc(35% * var(--tw-theme-contrast)))` |

**From `--tw-chrome-bg`:**

| Variable | Formula |
|----------|---------|
| `--tw-menu-bevel-hi` | `color-mix(in srgb, var(--tw-chrome-bg), white calc(15% * var(--tw-theme-contrast)))` |
| `--tw-menu-bevel-lo` | `color-mix(in srgb, var(--tw-chrome-bg), black calc(30% * var(--tw-theme-contrast)))` |

**From `--tw-gadget-bg`:**

| Variable | Formula |
|----------|---------|
| `--tw-gadget-hover` | `color-mix(in srgb, var(--tw-gadget-bg), white 8%)` |
| `--tw-gadget-active` | `color-mix(in srgb, var(--tw-gadget-bg), white 15%)` |

### Text

Not derived from primary (contrast direction varies by theme).

| Variable | Default | Notes |
|----------|---------|-------|
| `--tw-text` | `#d4d4d4` | Theme-set |
| `--tw-text-muted` | `color-mix(in srgb, var(--tw-text), transparent 40%)` | Auto-derived |
| `--tw-muted` | `var(--tw-text-muted)` | Alias |

### Status & Semantic

| Variable | Default |
|----------|---------|
| `--tw-status-active` | `#2ecc40` |
| `--tw-status-inactive` | `#888` |
| `--tw-danger-bg` | `#5a2a2a` |
| `--tw-danger-border` | `#a05555` |
| `--tw-success-bg` | `#2a6a2a` |

### Body Background (unchanged)

Existing `--tw-bg-*` slider system and `--tw-antialias-bg` formula remain as-is.

---

## 2. How Contrast Works

The `--tw-theme-contrast` variable scales the mix percentages used for bevel derivations:

| Contrast | bevel-hi (white mix) | bevel-lo (black mix) |
|----------|---------------------|---------------------|
| 0.5 (flat) | 10% | 17% |
| 1.0 (normal) | 20% | 35% |
| 1.5 (punchy) | 30% | 52% |

This is a single slider that controls how pronounced all bevels and shadows appear.

---

## 3. base.css Rule Consolidation

Currently each theme redeclares full rule blocks for `#topbar`, `.tb-btn`, `.tw-dropdown-trigger`, `.tw-dropdown-menu`, `.menu-row`, inputs, sliders, etc. (~150 lines repeated per theme).

After the refactor, base.css declares all component rules using the variable tree. Themes set variables and override only structural differences.

### base.css gains component rules like:

```css
#topbar {
  background: var(--tw-chrome);
  color: var(--tw-text);
}

#topbar .tb-btn {
  background: var(--tw-chrome);
  border: 1px solid var(--tw-bevel-hi);
  color: var(--tw-text);
}

.tw-dropdown-trigger {
  background: var(--tw-gadget-bg);
  border: 1px solid var(--tw-bevel-hi);
  color: var(--tw-text);
}

.tw-dropdown-menu {
  background: var(--tw-chrome-bg);
  border: 1px solid var(--tw-bevel-hi);
  color: var(--tw-text);
}

.tw-dropdown-item:hover    { background: var(--tw-gadget-hover); }
.tw-dropdown-item.selected { background: var(--tw-gadget-active); }

.menu-input-select, .menu-input-number {
  background: var(--tw-gadget-bg);
  border: 1px solid var(--tw-bevel-lo);
  color: var(--tw-text);
}

.tw-dd-session-status.running { background: var(--tw-status-active); }
.tw-dd-session-status.stopped { color: var(--tw-status-inactive); }
```

base.css provides a complete, working UI with 1px flat borders. This IS the Default theme's look.

### Themes keep only:

**Default:** Near-empty. Font-family, body background rule. The 1px flat borders from base.css already match its current look.

**Amiga 3.1:** Variable overrides (`--tw-chrome-bg: #b8b8b8`, `--tw-gadget-bg: #aaa`, `--tw-bevel-hi: #fff`, `--tw-bevel-lo: #000`, `--tw-text: #000`) + structural overrides (2px raised bevel border pattern, frame geometry, font-family, depth-gadget pseudo-elements).

**Scene 2000:** Variable overrides (`--tw-gadget-bg: rgba(255,255,255,0.12)`, `--tw-text: #fff`) + structural overrides (gradient rules built from variables for toolbar/menu, 2px bevel border pattern, frame geometry, font-family, depth-gadget pseudo-elements).

### Estimated line counts:

| File | Before | After |
|------|--------|-------|
| base.css | ~220 | ~350 |
| default.css | ~330 | ~60 |
| amiga.css | ~590 | ~200 |
| scene.css | ~635 | ~220 |
| **Total** | **~1775** | **~830** |

---

## 4. Theme Mapping

How each theme's current hardcoded colors map to the new variable system.

### Default

| Current | New |
|---------|-----|
| `#262626` (topbar, menu bg) | `--tw-primary` at `hsl(0 0% 15%)` |
| `#1e1e1e` (inputs, dropdown trigger) | `--tw-gadget-bg: color-mix(in srgb, var(--tw-chrome-bg), black 20%)` (explicit override) |
| `#555` (borders) | `--tw-bevel-hi` (derived: 20% white mix from #262626) |
| `#333` (hover) | `--tw-gadget-hover` (derived: 8% white mix) |
| `#3a3a3a` (selected) | `--tw-gadget-active` (derived: 15% white mix) |
| `#d4d4d4` (text) | `--tw-text: #d4d4d4` |
| `#888` (muted) | `--tw-text-muted` (derived: 40% transparent) |
| `#2ecc40` / `#e74c3c` (status) | `--tw-status-active` / `--tw-status-inactive` |

### AmigaOS 3.1

| Current | New |
|---------|-----|
| `hsl(216 38% 62%)` (everywhere) | `--tw-primary` via `--tw-theme-hue: 216; --tw-theme-sat: 38%; --tw-theme-ltn: 62%` |
| `#b8b8b8` (menu/panel bg) | `--tw-chrome-bg: #b8b8b8` |
| `#aaa` (inputs, buttons, slider thumb) | `--tw-gadget-bg: #aaa` |
| `#fff` / `#000` (bevels) | `--tw-bevel-hi: #fff; --tw-bevel-lo: #000` |
| `#000` (text) | `--tw-text: #000` |
| `#2c2` / `#c22` (status) | `--tw-status-active: #2c2; --tw-status-inactive: #c22` |

### Amiga Scene 2000

| Current | New |
|---------|-----|
| `hsl(222 36% 27%)` (toolbar base) | `--tw-primary` via `--tw-theme-hue: 222; --tw-theme-sat: 36%; --tw-theme-ltn: 27%` |
| Toolbar gradient | Theme CSS: `linear-gradient(color-mix(chrome, white 5%), color-mix(chrome, black 5%))` |
| Menu gradient | Theme CSS: `linear-gradient(var(--tw-chrome-bg), color-mix(chrome-bg, black 10%))` |
| `hsl(222 32% 34%)` (bevel-light) | `--tw-bevel-hi` (derived: ~20% white mix from primary) |
| `hsl(222 36% 10%)` (bevel-dark) | `--tw-bevel-lo` (derived: ~35% black mix from primary) |
| `rgba(255,255,255,0.12)` (gadgets) | `--tw-gadget-bg: rgba(255,255,255,0.12)` |
| `#fff` (text) | `--tw-text: #fff` |
| `rgba(255,255,255,0.3)` (muted) | `--tw-text-muted` (derived: 40% transparent from #fff — yields rgba(255,255,255,0.6), but current is 0.3; theme overrides `--tw-muted: rgba(255,255,255,0.3)`) |

---

## 5. JS/TS Changes

### New slider inputs

| Slider | Variable | Notes |
|--------|----------|-------|
| Theme Saturation | `--tw-theme-sat` | New |
| Theme Lightness | `--tw-theme-ltn` | New |
| Theme Contrast | `--tw-theme-contrast` | New |

### Files affected

1. **`src/client/background-hue.ts`** — Rename to `src/client/theme-sliders.ts`. Add `applyThemeSat()`, `applyThemeLtn()`, `applyThemeContrast()` alongside existing functions.

2. **`theme.json` schema** — New fields per theme entry:
   ```json
   {
     "name": "Amiga Scene 2000",
     "defaultThemeHue": 222,
     "defaultThemeSat": 36,
     "defaultThemeLtn": 27,
     "defaultThemeContrast": 1,
     "defaultBackgroundHue": 183,
     ...
   }
   ```

3. **`src/client/session-settings.ts`** — Add `themeSat`, `themeLtn`, `themeContrast` to persisted session settings.

4. **`src/client/ui/topbar.ts`** — Add 3 new slider rows in the Theme section of the settings menu.

5. **`src/server/themes.ts`** — Pass new defaults through the API response.

No DOM structure changes needed. Frame divs, topbar layout, dropdown structure all stay the same.

---

## 6. Migration Strategy

Each step keeps all 3 themes visually identical. Each step is a separate commit.

1. **base.css variable declarations** — Add the full variable tree with defaults to `:root`. No visual change; nothing consumes them yet.

2. **base.css component rules** — Move component styling (topbar, dropdowns, inputs, etc.) into base.css using variables. Default theme should look identical since defaults match current hardcoded values.

3. **Default theme** — Strip to near-empty (variables + font). Verify visually.

4. **Amiga 3.1** — Set variables, keep only bevel patterns + frame geometry + font. Verify visually.

5. **Scene 2000** — Set variables, keep gradients + bevel patterns + frame + font. Verify visually.

6. **New sliders** — Add theme-sat, theme-ltn, theme-contrast to JS, settings menu, and theme.json.

### Testing

- **Unit tests:** Existing tests should pass unchanged (they test behavior, not colors).
- **E2E tests:** Existing Playwright tests use stable DOM IDs; should pass unchanged.
- **Visual verification:** Manual side-by-side comparison of each theme at each step. Each step is its own commit for easy rollback.
