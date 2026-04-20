# CSS Variable Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a CSS variable hierarchy in base.css where all derived colors auto-calculate from a small set of primitives, then simplify each theme to set only what makes it unique.

**Architecture:** base.css declares a variable tree rooted at `--tw-primary` (computed from `--tw-theme-hue/sat/ltn`), branching into `--tw-chrome` → `--tw-chrome-bg` → `--tw-gadget-bg`, with leaves derived via `color-mix(in srgb, ...)`. Themes override only branch-level variables and structural patterns (bevel width, gradients, fonts). Three new sliders (Theme Saturation, Theme Lightness, Theme Contrast) join the existing Theme Hue slider.

**Tech Stack:** CSS custom properties, `color-mix()`, `calc()`, Bun, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-20-css-variable-refactor-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/client/base.css` | Modify | Variable tree + component rules consuming variables |
| `themes/default/default.css` | Modify | Strip to variables + font + body background |
| `themes/amiga/amiga.css` | Modify | Strip to variables + bevel patterns + frame + font |
| `themes/amiga/scene.css` | Modify | Strip to variables + gradients + bevels + frame + font |
| `themes/default/theme.json` | Modify | Add `defaultThemeSat`, `defaultThemeLtn`, `defaultThemeContrast` |
| `themes/amiga/theme.json` | Modify | Add `defaultThemeSat`, `defaultThemeLtn`, `defaultThemeContrast` |
| `src/client/background-hue.ts` | Modify | Add theme-sat, theme-ltn, theme-contrast clamp/apply functions (spec suggests rename to `theme-sliders.ts` — deferred to avoid import churn; can be done as a separate follow-up) |
| `src/client/session-settings.ts` | Modify | Add `themeSat`, `themeLtn`, `themeContrast` fields |
| `src/client/index.html` | Modify | Add 3 slider rows in GUI section |
| `src/client/ui/topbar.ts` | Modify | Wire 3 new sliders (DOM queries, listeners, syncUi, resets) |
| `src/client/index.ts` | Modify | Apply new sliders on startup + settings change |
| `src/server/themes.ts` | Modify | Add 3 new fields to ThemeInfo, PackManifest, INHERITABLE_FIELDS, listThemes |
| `tests/unit/client/background-hue.test.ts` | Modify | Tests for new clamp/apply functions |
| `tests/unit/server/themes.test.ts` | Verify | Existing tests still pass |
| `tests/unit/client/session-settings.test.ts` | Verify | Existing tests still pass |

---

### Task 1: base.css — Variable Tree Declarations

Add the full variable tree to `:root` in base.css. This is a pure addition — nothing consumes these yet, so there is zero visual change.

**Files:**
- Modify: `src/client/base.css:6-20` (existing `:root` block)

- [ ] **Step 1: Add variable tree to `:root`**

Replace the existing `:root` block in `src/client/base.css` (lines 6-20) with:

```css
:root {
  /* === SLIDER INPUTS (JS-written; defaults are fallbacks for no-JS) === */
  --tw-theme-hue: 0;
  --tw-theme-sat: 0%;
  --tw-theme-ltn: 15%;
  --tw-theme-contrast: 1;

  /* === ROOT === */
  --tw-primary: hsl(var(--tw-theme-hue) var(--tw-theme-sat) var(--tw-theme-ltn));

  /* === CHROME (toolbar, frame, active elements) === */
  --tw-chrome: var(--tw-primary);
  --tw-bevel-hi: color-mix(in srgb, var(--tw-chrome), white calc(20% * var(--tw-theme-contrast)));
  --tw-bevel-lo: color-mix(in srgb, var(--tw-chrome), black calc(35% * var(--tw-theme-contrast)));

  /* === CHROME-BG (menu bg, panel bg) === */
  --tw-chrome-bg: var(--tw-chrome);
  --tw-menu-bevel-hi: color-mix(in srgb, var(--tw-chrome-bg), white calc(15% * var(--tw-theme-contrast)));
  --tw-menu-bevel-lo: color-mix(in srgb, var(--tw-chrome-bg), black calc(30% * var(--tw-theme-contrast)));

  /* === GADGET (inputs, buttons, checkboxes, slider thumbs) === */
  --tw-gadget-bg: var(--tw-chrome-bg);
  --tw-gadget-hover: color-mix(in srgb, var(--tw-gadget-bg), white 8%);
  --tw-gadget-active: color-mix(in srgb, var(--tw-gadget-bg), white 15%);

  /* === TEXT === */
  --tw-text: #d4d4d4;
  --tw-text-muted: color-mix(in srgb, var(--tw-text), transparent 40%);
  --tw-muted: var(--tw-text-muted);

  /* === STATUS === */
  --tw-status-active: #2ecc40;
  --tw-status-inactive: #888;

  /* === SEMANTIC (toast/prompt) === */
  --tw-danger-bg: #5a2a2a;
  --tw-danger-border: #a05555;
  --tw-success-bg: #2a6a2a;

  /* === BODY BACKGROUND (existing slider system) === */
  --tw-antialias-bg: hsl(
    var(--tw-background-hue, 0)
    calc(var(--tw-background-saturation, 0) * 1%)
    calc((var(--tw-background-brightest, 12) * 0.58
        + var(--tw-background-darkest,  12) * 0.42) * 1%)
  );
}
```

Note: the old `--tw-surface-*` variables are removed from `:root`. They are replaced by the new hierarchy. The toast/prompt rules in base.css that reference `--tw-surface-*` will be updated to use the new variables in Task 2.

- [ ] **Step 2: Run unit tests**

Run: `make test-unit`
Expected: All pass. No code depends on the new variables yet.

- [ ] **Step 3: Verify visually**

Run: `bun src/server/index.ts --test --listen 127.0.0.1:4022 --no-auth --no-tls`
Open in browser. All three themes should look identical to before — the new variables exist but nothing consumes them yet.

- [ ] **Step 4: Commit**

```bash
git add src/client/base.css
git commit -m "refactor(css): add variable tree declarations to base.css :root"
```

---

### Task 2: base.css — Component Rules Using Variables

Move component color rules into base.css, consuming the variable tree. Replace `--tw-surface-*` references in existing base.css rules with the new variables. This gives a working dark UI from base.css alone.

**Files:**
- Modify: `src/client/base.css` (add component rules, update existing rules)

- [ ] **Step 1: Update existing base.css rules to use new variables**

In `src/client/base.css`, replace all `--tw-surface-*` references with new variable names:

| Old variable | New variable |
|-------------|-------------|
| `var(--tw-surface-bg)` | `var(--tw-chrome-bg)` |
| `var(--tw-surface-bg-alt)` | `var(--tw-gadget-bg)` |
| `var(--tw-surface-border)` | `var(--tw-bevel-hi)` |
| `var(--tw-surface-hover)` | `var(--tw-gadget-hover)` |

This applies to the toast (`.tw-toast`), clipboard prompt (`.tw-clip-prompt-*`), and prompt button rules. Also update `.menu-label` from `var(--tw-text-muted)` → stays as `var(--tw-text-muted)` (already correct). Update `.menu-hr` and `.menu-section` from `#444` / `#888` to `var(--tw-muted)`.

Replace the drops overlay hardcoded colors:
```css
.tw-drop-overlay {
  background: color-mix(in srgb, var(--tw-chrome), transparent 75%);
  border: 2px dashed var(--tw-bevel-hi);
  color: var(--tw-text);
}
```

Update `#drops-list .drops-empty` from `var(--tw-muted)` to `var(--tw-text-muted)`.

Update scrollbar from `rgba(255, 255, 255, 0.2)` to `var(--tw-gadget-hover)`:
```css
.tw-dropdown-menu { scrollbar-color: var(--tw-gadget-hover) transparent; }
.tw-dropdown-menu::-webkit-scrollbar-thumb { background: var(--tw-gadget-hover); }
.tw-dropdown-menu::-webkit-scrollbar-thumb:hover { background: var(--tw-gadget-active); }
```

- [ ] **Step 2: Add component color rules to base.css**

Add these rules to the end of base.css (before the `#terminal` position rules). These provide the default dark theme look — flat 1px borders, all from variables:

```css
/* === Component color rules — themes override variables, not these rules === */

body {
  background: hsl(
    var(--tw-background-hue, 0)
    calc(var(--tw-background-saturation, 0) * 1%)
    calc(var(--tw-background-brightest, 12) * 1%)
  );
  color: var(--tw-text);
}

#topbar {
  background: var(--tw-chrome);
  color: var(--tw-text);
}

#topbar .tb-btn {
  background: var(--tw-chrome);
  border: 1px solid var(--tw-bevel-hi);
  color: var(--tw-text);
}
#topbar .tb-btn:hover { background: var(--tw-gadget-hover); }
#topbar .tb-btn:active { background: var(--tw-gadget-active); }

#topbar .win-tab {
  color: var(--tw-muted);
  border: 1px solid transparent;
}
#topbar .win-tab:hover { background: var(--tw-gadget-hover); color: var(--tw-text); }
#topbar .win-tab.active { color: var(--tw-text); border-color: var(--tw-bevel-hi); }

.tw-dropdown-trigger {
  background: var(--tw-gadget-bg);
  border: 1px solid var(--tw-bevel-hi);
  color: var(--tw-text);
}
.tw-dropdown-trigger:hover { background: var(--tw-gadget-hover); }

.tw-dropdown-menu {
  background: var(--tw-chrome-bg);
  border: 1px solid var(--tw-bevel-hi);
  color: var(--tw-text);
}

.tw-dropdown-item { color: var(--tw-text); }
.tw-dropdown-item:hover { background: var(--tw-gadget-hover); }
.tw-dropdown-item.selected { background: var(--tw-gadget-active); }

.tw-dropdown-sep { border-top-color: var(--tw-muted); }

.tw-dd-input {
  background: var(--tw-gadget-bg);
  border: 1px solid var(--tw-bevel-hi);
  color: var(--tw-text);
}

.tw-dd-session-status.running { background: var(--tw-status-active); }
.tw-dd-session-status.stopped { color: var(--tw-status-inactive); }

.menu-row:hover { background: var(--tw-gadget-hover); }
.menu-label { color: var(--tw-text-muted); }

.menu-input-select, .menu-input-number {
  background: var(--tw-gadget-bg);
  border: 1px solid var(--tw-bevel-lo);
  color: var(--tw-text);
}

#menu-footer { color: var(--tw-muted); }

#menu-dropdown input[type="range"] { accent-color: var(--tw-chrome); }

#menu-dropdown .tb-btn {
  background: var(--tw-gadget-bg);
  color: var(--tw-text);
}
```

- [ ] **Step 3: Run unit tests**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 4: Verify Default theme visually**

Start dev server, load Default theme. The base.css rules now provide the Default look. Visuals should match (close to identical — minor differences in derived colors are acceptable as long as the overall look is the same dark-neutral theme).

- [ ] **Step 5: Commit**

```bash
git add src/client/base.css
git commit -m "refactor(css): base.css component rules consume variable tree"
```

---

### Task 3: Default Theme — Strip to Minimal

Remove all color/font/size declarations from default.css that are now handled by base.css. Keep only: body background rule (with the HSL slider formula), font-family overrides, `#terminal` inset, and any structural rules not in base.css.

**Files:**
- Modify: `themes/default/default.css`

- [ ] **Step 1: Strip default.css**

Replace the entire file with the minimal version. Keep:
- The `:root` block with `--tw-antialias-bg` is now in base.css — remove from default.css.
- Body: font-family only (background comes from base.css now).
- `#topbar`: only layout/position properties not already in base.css. Keep font-family override.
- `#terminal`: inset values (`left: 3px; right: 3px; bottom: 3px; top: 3px`) and `body.topbar-pinned` offset.
- Session button structural rules (plus icon shape, compact window icon).
- `#btn-menu` structural rules (hamburger icon).
- `#menu-dropdown` anchor (`right: 0; left: auto; min-width: 270px`).
- `#menu-footer` layout.

Remove all hardcoded color values (`#262626`, `#1e1e1e`, `#333`, `#444`, `#555`, `#888`, `#d4d4d4`). They are now provided by base.css via the variable tree.

The Default theme's `--tw-gadget-bg` should be set to produce the darker input background:
```css
:root {
  --tw-gadget-bg: color-mix(in srgb, var(--tw-chrome-bg), black 20%);
}
```

- [ ] **Step 2: Run unit tests**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 3: Verify Default theme visually**

Open Default theme in browser. Compare to the pre-refactor look. The overall dark-neutral appearance should be preserved. Check: topbar, dropdowns, settings menu, session menu, window tabs, toast (if triggerable), input fields.

- [ ] **Step 4: Commit**

```bash
git add themes/default/default.css
git commit -m "refactor(themes): strip Default to minimal — colors from variable tree"
```

---

### Task 4: AmigaOS 3.1 Theme — Strip to Variables + Bevel Patterns

Replace hardcoded colors with variable overrides. Keep bevel border patterns (2px raised/sunken), frame geometry, font-family, depth-gadget pseudo-elements.

**Files:**
- Modify: `themes/amiga/amiga.css`

- [ ] **Step 1: Set variable overrides in `:root`**

Replace the existing amiga.css `:root` block with variable overrides:

```css
:root {
  --tw-chrome: hsl(var(--tw-theme-hue, 216) 38% 62%);
  --tw-chrome-bg: #b8b8b8;
  --tw-gadget-bg: #aaa;
  --tw-bevel-hi: #fff;
  --tw-bevel-lo: #000;
  --tw-menu-bevel-hi: #fff;
  --tw-menu-bevel-lo: #000;
  --tw-text: #000;
  --tw-muted: #000;
  --tw-status-active: #2c2;
  --tw-status-inactive: #c22;
  --tw-danger-bg: #a04040;
  --tw-danger-border: #000;
  --tw-success-bg: #4a8c4a;
}
```

- [ ] **Step 2: Strip color declarations from component rules**

Go through every rule in amiga.css and remove hardcoded color properties that are now provided by base.css + variables. Keep:

- `border: 2px solid; border-color: var(--tw-bevel-hi) var(--tw-bevel-lo) var(--tw-bevel-lo) var(--tw-bevel-hi);` — the Amiga raised bevel pattern (structural, not base.css)
- Pressed state: `border-color: var(--tw-bevel-lo) var(--tw-bevel-hi) var(--tw-bevel-hi) var(--tw-bevel-lo);`
- Frame `#frame-*` rules — geometry + bevel borders (structural, Amiga-specific)
- `font-family: 'Topaz8 Amiga1200 Nerd Font', monospace;`
- `font-size` overrides for Amiga pixel sizing
- Depth-gadget pseudo-elements (`#btn-menu::before`, `::after`, `.tb-session-plus`, `.tb-window-compact-plus::before/::after`)
- Checkbox raised/sunken bevel pattern
- Slider track/thumb bevel patterns
- Padding/margin nudges specific to the Amiga layout

Remove:
- All `background: hsl(var(--tw-theme-hue, 216) 38% 62%)` — now `var(--tw-chrome)` from base.css
- All `background: #aaa` — now `var(--tw-gadget-bg)` from base.css
- All `background: #b8b8b8` — now `var(--tw-chrome-bg)` from base.css
- All `color: #000` — now `var(--tw-text)` from base.css
- All `color: #fff` and `color: var(--tw-muted)` — from base.css
- All `border-color: #555` / `border: 1px solid #555` — now `var(--tw-bevel-hi)` from base.css
- `.tw-dd-session-status.running { background: #2c2; }` — now `var(--tw-status-active)` from base.css
- `.tw-dd-session-status.stopped { color: #c22; }` — now `var(--tw-status-inactive)` from base.css
- `accent-color` — from base.css
- `.menu-hr`, `.menu-section`, `#menu-footer` color rules — from base.css

Where Amiga needs to override the base.css `1px solid` with `2px solid` bevel pattern, keep the structural override but use the variables for colors:

```css
#topbar .tb-btn {
  border: 2px solid;
  border-color: var(--tw-bevel-hi) var(--tw-bevel-lo) var(--tw-bevel-lo) var(--tw-bevel-hi);
}
#topbar .tb-btn:active {
  border-color: var(--tw-bevel-lo) var(--tw-bevel-hi) var(--tw-bevel-hi) var(--tw-bevel-lo);
}
```

The `input` accent-color rule `input { accent-color: hsl(var(--tw-theme-hue, 216) 38% 62%); }` becomes unnecessary — base.css sets `accent-color: var(--tw-chrome)`.

For the slider track fill color `hsl(var(--tw-theme-hue, 216) 38% 62%)`, replace with `var(--tw-chrome)`.

For the slider thumb `background: #aaa`, replace with `var(--tw-gadget-bg)`.

- [ ] **Step 3: Run unit tests**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 4: Verify AmigaOS 3.1 visually**

Switch to AmigaOS 3.1 theme. Compare: topbar (blue), frame (blue bevels, white/black edges), session button, window tabs, settings menu, dropdowns, slider controls, checkboxes. Rotate Theme Hue slider — all chrome should rotate together.

- [ ] **Step 5: Commit**

```bash
git add themes/amiga/amiga.css
git commit -m "refactor(themes): strip Amiga 3.1 — colors from variable tree"
```

---

### Task 5: Amiga Scene 2000 — Strip to Variables + Gradients + Bevels

Similar to Task 4, but Scene uses gradients for toolbar/menu and translucent overlay for gadgets.

**Files:**
- Modify: `themes/amiga/scene.css`

- [ ] **Step 1: Set variable overrides in `:root`**

Replace the existing scene.css `:root` block:

```css
:root {
  --tw-chrome: hsl(var(--tw-theme-hue, 222) 36% 27%);
  --tw-chrome-bg: hsl(var(--tw-theme-hue, 222) 37% 22%);
  --tw-gadget-bg: rgba(255, 255, 255, 0.12);
  --tw-bevel-hi: hsl(var(--tw-theme-hue, 222) 32% 34%);
  --tw-bevel-lo: hsl(var(--tw-theme-hue, 222) 36% 10%);
  --tw-menu-bevel-hi: hsl(var(--tw-theme-hue, 222) 32% 27%);
  --tw-menu-bevel-lo: hsl(var(--tw-theme-hue, 222) 36% 10%);
  --tw-text: #fff;
  --tw-muted: rgba(255, 255, 255, 0.3);
  --tw-status-active: #2c2;
  --tw-status-inactive: #c22;
  --tw-danger-bg: #a04040;
  --tw-danger-border: hsl(var(--tw-theme-hue, 222) 36% 5%);
  --tw-success-bg: #4a8c4a;
}
```

Note: `--tw-chrome-bg` is set to `hsl(H 37% 22%)` — the midpoint of the current menu gradient (24% → 19%). The gradient itself is expressed in the topbar/menu rules.

- [ ] **Step 2: Strip color declarations, keep gradients + bevel patterns**

Remove all hardcoded colors that are now variables. Keep:

- Toolbar gradient (expressed from variables):
  ```css
  #topbar {
    background: linear-gradient(to bottom,
      color-mix(in srgb, var(--tw-chrome), white 5%),
      color-mix(in srgb, var(--tw-chrome), black 5%));
  }
  ```

- Menu gradient:
  ```css
  .tw-dropdown-menu {
    background: linear-gradient(to bottom,
      var(--tw-chrome-bg),
      color-mix(in srgb, var(--tw-chrome-bg), black 12%));
  }
  .tw-dropdown-trigger {
    background: linear-gradient(to bottom,
      var(--tw-chrome-bg),
      color-mix(in srgb, var(--tw-chrome-bg), black 12%));
  }
  ```

- Reversed gradient for pressed/active states:
  ```css
  #topbar .tb-btn:active {
    background: linear-gradient(to bottom,
      color-mix(in srgb, var(--tw-chrome), black 5%),
      color-mix(in srgb, var(--tw-chrome), white 5%));
  }
  ```

- 2px bevel border patterns (same structure as Amiga, using variables)
- Frame geometry + bevel borders
- Font-family overrides
- Depth-gadget pseudo-elements
- Slider thumb `background: hsl(var(--tw-theme-hue, 222) 15% 42%)` — keep as explicit override (desaturated variant of primary, not derivable from the tree)
- Slider track `rgba(255, 255, 255, 0.55)` filled section — keep as explicit
- Checkbox bevel patterns (structural, not color)

Remove:
- All standalone `color: #fff` — from `var(--tw-text)` in base.css
- All `color: var(--tw-muted)` — from base.css
- All `background: rgba(255, 255, 255, 0.12)` on gadgets — from `var(--tw-gadget-bg)` in base.css
- All `background: rgba(255, 255, 255, 0.18)` on hover — from `var(--tw-gadget-hover)` (8% white mix ≈ 0.19 alpha, close enough)
- All `background: rgba(255, 255, 255, 0.24)` on checked — from `var(--tw-gadget-active)` (15% white mix ≈ 0.25 alpha)
- Session status colors — from base.css + variables
- `.menu-hr`, `.menu-section`, `#menu-footer` — from base.css
- `input { accent-color: ... }` — from base.css `accent-color: var(--tw-chrome)`

- [ ] **Step 3: Run unit tests**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 4: Verify Scene 2000 visually**

Switch to Amiga Scene 2000. Compare: toolbar gradient (dark blue), menu gradient (slightly darker), frame bevels, translucent inputs/checkboxes, slider thumb/track, session dots, radial body gradient. Rotate Theme Hue — all chrome should rotate while body stays independent.

- [ ] **Step 5: Commit**

```bash
git add themes/amiga/scene.css
git commit -m "refactor(themes): strip Scene 2000 — colors from variable tree"
```

---

### Task 6: TDD — New Slider Clamp/Apply Functions

Add `clampThemeSat`, `applyThemeSat`, `clampThemeLtn`, `applyThemeLtn`, `clampThemeContrast`, `applyThemeContrast` to `background-hue.ts`, following existing patterns. TDD: tests first, then implementation.

**Files:**
- Test: `tests/unit/client/background-hue.test.ts`
- Modify: `src/client/background-hue.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/client/background-hue.test.ts`:

```typescript
import {
  DEFAULT_THEME_SAT,
  DEFAULT_THEME_LTN,
  DEFAULT_THEME_CONTRAST,
  clampThemeSat,
  clampThemeLtn,
  clampThemeContrast,
  applyThemeSat,
  applyThemeLtn,
  applyThemeContrast,
} from "../../../src/client/background-hue.ts";

describe("theme saturation", () => {
  test("defaults to 0%", () => {
    expect(DEFAULT_THEME_SAT).toBe(0);
  });

  test("clamps to 0..100", () => {
    expect(clampThemeSat(-10)).toBe(0);
    expect(clampThemeSat(0)).toBe(0);
    expect(clampThemeSat(50.7)).toBe(51);
    expect(clampThemeSat(100)).toBe(100);
    expect(clampThemeSat(150)).toBe(100);
    expect(clampThemeSat(NaN)).toBe(DEFAULT_THEME_SAT);
  });

  test("applies --tw-theme-sat as percentage", () => {
    const el = mockElement();
    applyThemeSat(38, el);
    expect(el.style.getPropertyValue("--tw-theme-sat")).toBe("38%");
  });
});

describe("theme lightness", () => {
  test("defaults to 15%", () => {
    expect(DEFAULT_THEME_LTN).toBe(15);
  });

  test("clamps to 0..100", () => {
    expect(clampThemeLtn(-5)).toBe(0);
    expect(clampThemeLtn(0)).toBe(0);
    expect(clampThemeLtn(62.3)).toBe(62);
    expect(clampThemeLtn(100)).toBe(100);
    expect(clampThemeLtn(200)).toBe(100);
    expect(clampThemeLtn(NaN)).toBe(DEFAULT_THEME_LTN);
  });

  test("applies --tw-theme-ltn as percentage", () => {
    const el = mockElement();
    applyThemeLtn(62, el);
    expect(el.style.getPropertyValue("--tw-theme-ltn")).toBe("62%");
  });
});

describe("theme contrast", () => {
  test("defaults to 100 (maps to 1.0x)", () => {
    expect(DEFAULT_THEME_CONTRAST).toBe(100);
  });

  test("clamps to 0..200", () => {
    expect(clampThemeContrast(-10)).toBe(0);
    expect(clampThemeContrast(0)).toBe(0);
    expect(clampThemeContrast(100)).toBe(100);
    expect(clampThemeContrast(150.4)).toBe(150);
    expect(clampThemeContrast(200)).toBe(200);
    expect(clampThemeContrast(250)).toBe(200);
    expect(clampThemeContrast(NaN)).toBe(DEFAULT_THEME_CONTRAST);
  });

  test("applies --tw-theme-contrast as factor (divide by 100)", () => {
    const el = mockElement();
    applyThemeContrast(150, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("1.5");
  });

  test("contrast 100 applies factor 1", () => {
    const el = mockElement();
    applyThemeContrast(100, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("1");
  });

  test("contrast 50 applies factor 0.5", () => {
    const el = mockElement();
    applyThemeContrast(50, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("0.5");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test tests/unit/client/background-hue.test.ts`
Expected: FAIL — imports don't resolve.

- [ ] **Step 3: Implement clamp/apply functions**

Add to `src/client/background-hue.ts`:

```typescript
export const DEFAULT_THEME_SAT = 0;
export const DEFAULT_THEME_LTN = 15;
export const DEFAULT_THEME_CONTRAST = 100;

export function clampThemeSat(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THEME_SAT;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampThemeLtn(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THEME_LTN;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampThemeContrast(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_THEME_CONTRAST;
  return Math.max(0, Math.min(200, Math.round(value)));
}

export function applyThemeSat(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-theme-sat", clampThemeSat(value) + "%");
}

export function applyThemeLtn(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--tw-theme-ltn", clampThemeLtn(value) + "%");
}

export function applyThemeContrast(
  value: number,
  root: HTMLElement = document.documentElement,
): void {
  const clamped = clampThemeContrast(value);
  root.style.setProperty("--tw-theme-contrast", String(clamped / 100));
}
```

Note: Contrast slider range is 0-200 (integer), but the CSS variable is a factor (0-2). The apply function divides by 100. This matches user mental model: "100 = normal, 150 = 50% more contrast."

Note: Saturation and lightness apply with a `%` suffix because the CSS `hsl()` function in `--tw-primary` expects percentage values: `hsl(var(--tw-theme-hue) var(--tw-theme-sat) var(--tw-theme-ltn))`.

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun test tests/unit/client/background-hue.test.ts`
Expected: All PASS.

- [ ] **Step 5: Run full test suite**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/background-hue.ts tests/unit/client/background-hue.test.ts
git commit -m "feat(sliders): add theme-sat, theme-ltn, theme-contrast clamp/apply"
```

---

### Task 7: Wire New Sliders — Session Settings + Server Themes

Add the three new fields to `SessionSettings`, `ThemeDefaults`, `ThemeInfo`, `PackManifest`, and `INHERITABLE_FIELDS`. Update `loadSessionSettings` overlay logic and `applyThemeDefaults`.

**Files:**
- Modify: `src/client/session-settings.ts`
- Modify: `src/server/themes.ts`

- [ ] **Step 1: Update SessionSettings interface**

In `src/client/session-settings.ts`, add to the `SessionSettings` interface (after line 30, `themeHue`):

```typescript
  themeSat: number;              // 0..100, --tw-theme-sat GUI chrome saturation
  themeLtn: number;              // 0..100, --tw-theme-ltn GUI chrome lightness
  themeContrast: number;         // 0..200, --tw-theme-contrast bevel spread (100 = 1.0x)
```

- [ ] **Step 2: Update DEFAULT_SESSION_SETTINGS**

Add imports at the top of `src/client/session-settings.ts`:

```typescript
import {
  DEFAULT_THEME_SAT,
  DEFAULT_THEME_LTN,
  DEFAULT_THEME_CONTRAST,
} from './background-hue.js';
```

Add to the `DEFAULT_SESSION_SETTINGS` object (after `themeHue`):

```typescript
  themeSat: DEFAULT_THEME_SAT,
  themeLtn: DEFAULT_THEME_LTN,
  themeContrast: DEFAULT_THEME_CONTRAST,
```

- [ ] **Step 3: Update ThemeDefaults interface**

Add to `ThemeDefaults` (after `themeHue`):

```typescript
  themeSat?: number;
  themeLtn?: number;
  themeContrast?: number;
```

- [ ] **Step 4: Update loadSessionSettings overlay logic**

In the `loadSessionSettings` function, add after the `themeHue` overlay line (line ~121):

```typescript
  if (td.themeSat !== undefined) overlay.themeSat = td.themeSat;
  if (td.themeLtn !== undefined) overlay.themeLtn = td.themeLtn;
  if (td.themeContrast !== undefined) overlay.themeContrast = td.themeContrast;
```

- [ ] **Step 5: Update applyThemeDefaults**

In the `applyThemeDefaults` function, add after the `themeHue` line:

```typescript
    themeSat: td.themeSat ?? s.themeSat,
    themeLtn: td.themeLtn ?? s.themeLtn,
    themeContrast: td.themeContrast ?? s.themeContrast,
```

- [ ] **Step 6: Update server ThemeInfo type**

In `src/server/themes.ts`, add to the `ThemeInfo` type (after `defaultThemeHue`):

```typescript
  defaultThemeSat?: number;
  defaultThemeLtn?: number;
  defaultThemeContrast?: number;
```

- [ ] **Step 7: Update server PackManifest type**

In `src/server/themes.ts`, add to the `PackManifest.themes[]` type (after `defaultThemeHue`):

```typescript
  defaultThemeSat?: number;
  defaultThemeLtn?: number;
  defaultThemeContrast?: number;
```

- [ ] **Step 8: Update INHERITABLE_FIELDS**

Add to the `INHERITABLE_FIELDS` array (after `'defaultThemeHue'`):

```typescript
  'defaultThemeSat',
  'defaultThemeLtn',
  'defaultThemeContrast',
```

- [ ] **Step 9: Update listThemes defaultBase and own extraction**

In `listThemes()`, add to the `defaultBase` object (after `defaultThemeHue`):

```typescript
        defaultThemeSat: rawDefaultBase.defaultThemeSat,
        defaultThemeLtn: rawDefaultBase.defaultThemeLtn,
        defaultThemeContrast: rawDefaultBase.defaultThemeContrast,
```

And to the `own` object inside the pack loop (after `defaultThemeHue`):

```typescript
        defaultThemeSat: theme.defaultThemeSat,
        defaultThemeLtn: theme.defaultThemeLtn,
        defaultThemeContrast: theme.defaultThemeContrast,
```

- [ ] **Step 10: Run unit tests**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 11: Commit**

```bash
git add src/client/session-settings.ts src/server/themes.ts
git commit -m "feat(settings): add themeSat, themeLtn, themeContrast to session settings + server themes"
```

---

### Task 8: Wire New Sliders — HTML + Topbar UI + Startup

Add 3 new slider rows to the HTML, wire them in topbar.ts (DOM queries, input listeners, syncUi, reset), and apply on startup/change in index.ts.

**Files:**
- Modify: `src/client/index.html:71-74` (after Theme Hue row)
- Modify: `src/client/ui/topbar.ts`
- Modify: `src/client/index.ts`

- [ ] **Step 1: Add slider rows to HTML**

In `src/client/index.html`, after the Theme Hue slider row (line 74), add:

```html
          <div class="menu-row menu-row-static">
            <span class="menu-label">Theme Sat</span>
            <input type="range" id="sld-theme-sat" min="0" max="100" step="1">
            <input type="number" id="inp-theme-sat" min="0" max="100" step="1" class="menu-input-number">
          </div>
          <div class="menu-row menu-row-static">
            <span class="menu-label">Theme Light</span>
            <input type="range" id="sld-theme-ltn" min="0" max="100" step="1">
            <input type="number" id="inp-theme-ltn" min="0" max="100" step="1" class="menu-input-number">
          </div>
          <div class="menu-row menu-row-static">
            <span class="menu-label">Theme Contrast</span>
            <input type="range" id="sld-theme-contrast" min="0" max="200" step="1">
            <input type="number" id="inp-theme-contrast" min="0" max="200" step="1" class="menu-input-number">
          </div>
```

- [ ] **Step 2: Add imports to topbar.ts**

In `src/client/ui/topbar.ts`, add to the existing import from `background-hue.js`:

```typescript
import {
  // ... existing imports ...
  clampThemeSat,
  clampThemeLtn,
  clampThemeContrast,
  DEFAULT_THEME_SAT,
  DEFAULT_THEME_LTN,
  DEFAULT_THEME_CONTRAST,
} from '../background-hue.js';
```

- [ ] **Step 3: Add DOM queries**

After the existing `sldThemeHue` / `inpThemeHue` queries (line ~405), add:

```typescript
    const sldThemeSat = document.getElementById('sld-theme-sat') as HTMLInputElement;
    const inpThemeSat = document.getElementById('inp-theme-sat') as HTMLInputElement;
    const sldThemeLtn = document.getElementById('sld-theme-ltn') as HTMLInputElement;
    const inpThemeLtn = document.getElementById('inp-theme-ltn') as HTMLInputElement;
    const sldThemeContrast = document.getElementById('sld-theme-contrast') as HTMLInputElement;
    const inpThemeContrast = document.getElementById('inp-theme-contrast') as HTMLInputElement;
```

- [ ] **Step 4: Add to refreshAllSliderFills**

In `refreshAllSliderFills()` (line ~474), add:

```typescript
      updateSliderFill(sldThemeSat);
      updateSliderFill(sldThemeLtn);
      updateSliderFill(sldThemeContrast);
```

- [ ] **Step 5: Add input → fill sync listeners**

After `sldThemeHue.addEventListener('input', ...)` (line ~501), add:

```typescript
    sldThemeSat.addEventListener('input', () => updateSliderFill(sldThemeSat));
    sldThemeLtn.addEventListener('input', () => updateSliderFill(sldThemeLtn));
    sldThemeContrast.addEventListener('input', () => updateSliderFill(sldThemeContrast));
```

- [ ] **Step 6: Add to syncUi**

In `syncUi()` (after the `sldThemeHue` sync line), add:

```typescript
      sldThemeSat.value = inpThemeSat.value = String(s.themeSat);
      sldThemeLtn.value = inpThemeLtn.value = String(s.themeLtn);
      sldThemeContrast.value = inpThemeContrast.value = String(s.themeContrast);
```

- [ ] **Step 7: Add paired input/change listeners**

After the existing `sldThemeHue` / `inpThemeHue` listeners (line ~752), add:

```typescript
    sldThemeSat.addEventListener('input', () => {
      const v = clampThemeSat(parseInt(sldThemeSat.value, 10));
      inpThemeSat.value = String(v);
      commit({ themeSat: v });
    });
    inpThemeSat.addEventListener('change', () => {
      const v = clampThemeSat(parseInt(inpThemeSat.value, 10));
      sldThemeSat.value = inpThemeSat.value = String(v);
      updateSliderFill(sldThemeSat);
      commit({ themeSat: v });
    });

    sldThemeLtn.addEventListener('input', () => {
      const v = clampThemeLtn(parseInt(sldThemeLtn.value, 10));
      inpThemeLtn.value = String(v);
      commit({ themeLtn: v });
    });
    inpThemeLtn.addEventListener('change', () => {
      const v = clampThemeLtn(parseInt(inpThemeLtn.value, 10));
      sldThemeLtn.value = inpThemeLtn.value = String(v);
      updateSliderFill(sldThemeLtn);
      commit({ themeLtn: v });
    });

    sldThemeContrast.addEventListener('input', () => {
      const v = clampThemeContrast(parseInt(sldThemeContrast.value, 10));
      inpThemeContrast.value = String(v);
      commit({ themeContrast: v });
    });
    inpThemeContrast.addEventListener('change', () => {
      const v = clampThemeContrast(parseInt(inpThemeContrast.value, 10));
      sldThemeContrast.value = inpThemeContrast.value = String(v);
      updateSliderFill(sldThemeContrast);
      commit({ themeContrast: v });
    });
```

- [ ] **Step 8: Add to resets array**

In the `resets` array (after the `sldThemeHue` entry), add:

```typescript
      { slider: sldThemeSat, input: inpThemeSat, key: 'themeSat',
        getDefault: () => activeTheme()?.defaultThemeSat ?? DEFAULT_THEME_SAT },
      { slider: sldThemeLtn, input: inpThemeLtn, key: 'themeLtn',
        getDefault: () => activeTheme()?.defaultThemeLtn ?? DEFAULT_THEME_LTN },
      { slider: sldThemeContrast, input: inpThemeContrast, key: 'themeContrast',
        getDefault: () => activeTheme()?.defaultThemeContrast ?? DEFAULT_THEME_CONTRAST },
```

- [ ] **Step 9: Apply on startup in index.ts**

In `src/client/index.ts`, add imports:

```typescript
import {
  // ... existing imports ...
  applyThemeSat,
  applyThemeLtn,
  applyThemeContrast,
} from './background-hue.js';
```

After the existing `applyThemeHue(settings.themeHue);` line (~82), add:

```typescript
  applyThemeSat(settings.themeSat);
  applyThemeLtn(settings.themeLtn);
  applyThemeContrast(settings.themeContrast);
```

- [ ] **Step 10: Apply on settings change in index.ts**

In the `onSettingsChange` handler, after `applyThemeHue(s.themeHue);` (~175), add:

```typescript
      applyThemeSat(s.themeSat);
      applyThemeLtn(s.themeLtn);
      applyThemeContrast(s.themeContrast);
```

- [ ] **Step 11: Update themeDefaults in index.ts**

In the `themeDefaults` object (~58-67), add after `tuiSaturation`:

```typescript
    themeSat: currentTheme.defaultThemeSat,
    themeLtn: currentTheme.defaultThemeLtn,
    themeContrast: currentTheme.defaultThemeContrast,
```

Also update the `themeSelect` change handler's `td` object construction in `topbar.ts` to include the new fields (follow existing pattern where `td.themeHue = theme.defaultThemeHue`).

- [ ] **Step 12: Run full test suite**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 13: Verify in browser**

Start dev server. Open settings menu — three new sliders should appear under Theme Hue. Adjust each:
- Theme Sat: should change the saturation of all chrome colors
- Theme Light: should change the lightness of all chrome colors
- Theme Contrast: should widen/narrow the bevel spread
- Double-click to reset should restore theme defaults

- [ ] **Step 14: Commit**

```bash
git add src/client/index.html src/client/ui/topbar.ts src/client/index.ts
git commit -m "feat(ui): wire theme-sat, theme-ltn, theme-contrast sliders"
```

---

### Task 9: Update theme.json Defaults

Set the correct `defaultThemeSat`, `defaultThemeLtn`, and `defaultThemeContrast` in each theme.json so the sliders start at values that reproduce each theme's current look.

**Files:**
- Modify: `themes/default/theme.json`
- Modify: `themes/amiga/theme.json`

- [ ] **Step 1: Update default theme.json**

In `themes/default/theme.json`, add to the Default theme entry:

```json
      "defaultThemeSat": 0,
      "defaultThemeLtn": 15,
      "defaultThemeContrast": 100
```

These match the base.css `:root` defaults, so Default theme's chrome stays neutral grey.

- [ ] **Step 2: Update amiga theme.json**

In `themes/amiga/theme.json`, add to each theme entry:

For AmigaOS 3.1:
```json
      "defaultThemeSat": 38,
      "defaultThemeLtn": 62,
      "defaultThemeContrast": 100
```

For Amiga Scene 2000:
```json
      "defaultThemeHue": 222,
      "defaultThemeSat": 36,
      "defaultThemeLtn": 27,
      "defaultThemeContrast": 100
```

Note: Scene 2000 currently lacks `defaultThemeHue` in theme.json (it's only in the CSS fallback `222`). Add it now so the slider starts correctly.

- [ ] **Step 3: Run unit tests**

Run: `make test-unit`
Expected: All pass.

- [ ] **Step 4: Verify all themes**

Switch between all three themes. Each should look identical to before. The new sliders should show the correct default values for each theme. Rotating sliders should produce expected results (hue rotation, saturation changes, lightness changes, contrast changes).

- [ ] **Step 5: Commit**

```bash
git add themes/default/theme.json themes/amiga/theme.json
git commit -m "feat(themes): set defaultThemeSat/Ltn/Contrast in theme.json"
```

---

### Task 10: Full Verification Pass

Final check across all themes, all sliders, all UI elements.

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `make test`
Expected: All unit + e2e tests pass.

- [ ] **Step 2: Visual regression check — Default**

Open Default theme. Verify: topbar, session menu, window tabs, settings menu (all sliders, dropdowns, checkboxes, inputs), toast (trigger one if possible), clipboard prompt styling.

- [ ] **Step 3: Visual regression check — AmigaOS 3.1**

Switch to AmigaOS 3.1. Verify: blue chrome, white/black bevels, grey menu background, grey inputs, frame, slider controls. Rotate Theme Hue — all chrome rotates.

- [ ] **Step 4: Visual regression check — Amiga Scene 2000**

Switch to Scene 2000. Verify: dark blue gradient toolbar, slightly darker gradient menu, translucent inputs, frame bevels, slider thumb/track, radial body gradient. Rotate Theme Hue — toolbar/menu/bevels rotate while body stays independent.

- [ ] **Step 5: Slider interaction check**

For each theme, exercise all new sliders:
- Theme Sat: 0 → 100, verify chrome desaturates/saturates
- Theme Ltn: 0 → 100, verify chrome darkens/lightens
- Theme Contrast: 0 → 200, verify bevels flatten/widen
- Double-click each slider — verify it resets to theme default
- Switch theme — verify sliders snap to new theme's defaults
