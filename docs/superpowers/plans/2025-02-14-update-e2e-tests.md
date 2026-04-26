> **Note:** This file's `2025-02-14` filename date is artefactual — the project's first commit predates 2026, so any 2025-* plan filename in this directory is a typo / template echo, not a historical record. The canonical TLS-default rollout plan is [`2026-04-14-tls-default.md`](2026-04-14-tls-default.md); refer to that for the as-shipped behaviour. This file is kept for archaeology only and may differ from what actually shipped.

# Update E2E Tests to use clearSettings and New Defaults

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize E2E tests to use `clearSettings(page)` for clean state and align with new default settings: font 'Iosevka Nerd Font Mono', size 18, line height 0.95.

**Architecture:** Update `beforeEach` hooks to call `clearSettings(page)`. Update hardcoded cookie mocks. Improve reload detection.

**Tech Stack:** Playwright (TypeScript)

---

### Task 1: Update font-selection.test.ts

**Files:**
- Modify: `tests/e2e/font-selection.test.ts`

- [ ] **Step 1: Import clearSettings and update beforeEach hooks**
  - Replace manual cookie clearing with `await clearSettings(page)`.
  - Update any hardcoded default settings objects to match new defaults.
  - Update expectations that used 'IosevkaNerdFontMono-Regular'.

```typescript
// Example update for beforeEach
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer, clearSettings } from './helpers.js';

// ...
  test.beforeEach(async ({ page }) => {
    await clearSettings(page);
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await waitForFontList(page);
  });
```

- [ ] **Step 2: Run tests to verify**
  Run: `bunx playwright test tests/e2e/font-selection.test.ts`
  Expected: PASS

---

### Task 2: Update terminal-selection.test.ts

**Files:**
- Modify: `tests/e2e/terminal-selection.test.ts`

- [ ] **Step 1: Add clearSettings to beforeEach and update cookie logic**
  - Import `clearSettings`.
  - Call `await clearSettings(page)` in `beforeEach`.
  - Replace manual cookie parsing with a helper if possible or just ensure it's robust.
  - Use `page.waitForURL` or `page.waitForNavigation` for reloads.

- [ ] **Step 2: Run tests to verify**
  Run: `bunx playwright test tests/e2e/terminal-selection.test.ts`
  Expected: PASS

---

### Task 3: Update font-change-rendering.test.ts and xterm-font-metrics.test.ts

**Files:**
- Modify: `tests/e2e/font-change-rendering.test.ts`
- Modify: `tests/e2e/xterm-font-metrics.test.ts`

- [ ] **Step 1: Add clearSettings and improve reload detection**
  - Use `clearSettings(page)` in `beforeEach` or at start of tests.
  - Replace `page.waitForTimeout(500)` with `page.waitForNavigation()` or `page.waitForURL()` where applicable.
  - Ensure new defaults are used if any cookies are set manually.

- [ ] **Step 2: Run tests to verify**
  Run: `bunx playwright test tests/e2e/font-change-rendering.test.ts tests/e2e/xterm-font-metrics.test.ts`
  Expected: PASS

---

### Task 4: Batch update remaining E2E tests

**Files:**
- Modify: All other `tests/e2e/*.test.ts`

- [ ] **Step 1: Ensure all tests use clearSettings(page)**
  - Iterate through `clipboard.test.ts`, `font-history.test.ts`, `fullscreen.test.ts`, `keyboard.test.ts`, `menu-focus.test.ts`, `menu-settings-open.test.ts`, `mouse.test.ts`, `reconnect.test.ts`, `sessions.test.ts`, `terminal-backends.test.ts`, `topbar.test.ts`, `url-session.test.ts`, `windows.test.ts`.
  - Add `clearSettings(page)` to `beforeEach`.

- [ ] **Step 2: Run all E2E tests**
  Run: `bunx playwright test tests/e2e/`
  Expected: PASS
