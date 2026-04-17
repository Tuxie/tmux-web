# Make TLS Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TLS (HTTPS) the default for tmux-web, providing a `--no-tls` flag for HTTP.

**Architecture:** Refactor `src/server/index.ts` to extract configuration parsing into a testable function. Update CLI argument handling to flip the default TLS state and add the override flag.

**Tech Stack:** Bun, TypeScript, util.parseArgs

---

### Task 1: Refactor Server Entry Point for Testability

**Files:**
- Modify: `src/server/index.ts`
- Create: `tests/unit/server/config.test.ts`

- [ ] **Step 1: Extract `parseConfig` function in `src/server/index.ts`**
  Refactor the code to move argument parsing and config object creation into an exported `parseConfig` function.

```typescript
export interface ConfigResult {
  config: ServerConfig | null;
  host: string;
  port: number;
  help?: boolean;
}

export function parseConfig(argv: string[]): ConfigResult {
  const { values: args } = parseArgs({
    args: argv,
    options: {
      // existing options...
    },
    strict: true,
  });

  if (args.help) return { config: null, host: '', port: 0, help: true };

  // ... parsing logic ...
  return { config, host, port };
}
```

- [ ] **Step 2: Update `startServer` to use `parseConfig`**
  Call the new function and handle the result.

- [ ] **Step 3: Create initial unit test for `parseConfig`**
  Verify that the current (old) defaults are correctly parsed.

```typescript
import { expect, test } from "bun:test";
import { parseConfig } from "../../../src/server/index.js";

test("parseConfig returns default values", () => {
  const { config } = parseConfig([]);
  expect(config?.tls).toBe(false);
});
```

- [ ] **Step 4: Run unit tests**
  Run: `bun test tests/unit/server/config.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/server/index.ts tests/unit/server/config.test.ts
  git commit -m "refactor(server): extract parseConfig for testability"
  ```

### Task 2: Implement TLS as Default and `--no-tls` Flag

**Files:**
- Modify: `src/server/index.ts`
- Modify: `tests/unit/server/config.test.ts`

- [ ] **Step 1: Update `parseConfig` options and logic in `src/server/index.ts`**
  Change `tls` default to `true` and add `no-tls`.

```typescript
options: {
  // ...
  tls:          { type: 'boolean', default: true },
  'no-tls':     { type: 'boolean', default: false },
  // ...
}
// ...
tls: args.tls && !args['no-tls'],
```

- [ ] **Step 2: Update help message in `src/server/index.ts`**
  Mark `--tls` as (default) and add `--no-tls`.

- [ ] **Step 3: Update unit tests to verify new defaults**

```typescript
test("parseConfig defaults to TLS enabled", () => {
  const { config } = parseConfig([]);
  expect(config?.tls).toBe(true);
});

test("parseConfig respects --no-tls", () => {
  const { config } = parseConfig(["--no-tls"]);
  expect(config?.tls).toBe(false);
});
```

- [ ] **Step 4: Run unit tests**
  Run: `bun test tests/unit/server/config.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/server/index.ts tests/unit/server/config.test.ts
  git commit -m "feat(server): make TLS default and add --no-tls"
  ```

### Task 3: Update E2E Tests to use `--no-tls`

**Files:**
- Modify: `tests/e2e/*.test.ts` (multiple files)
- Create: `tests/e2e/tls.test.ts`

- [ ] **Step 1: Update `startDevServer` in E2E tests**
  Add `--no-tls` to all `startDevServer` calls in existing E2E tests to maintain HTTP for now.

- [ ] **Step 2: Create `tests/e2e/tls.test.ts`**
  Add a test that verifies the server starts in HTTPS mode by default (check console output for "https://").

- [ ] **Step 3: Run E2E tests**
  Run: `npm run test:e2e`
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add tests/e2e/
  git commit -m "test(e2e): update existing tests to use --no-tls and add TLS default test"
  ```

### Task 4: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README.md**
  Update the "Usage" or "HTTPS" section to state that TLS is now the default. Mention `--no-tls`.

- [ ] **Step 2: Update CLAUDE.md**
  Update any development or test commands that might be affected.

- [ ] **Step 3: Commit**
  ```bash
  git add README.md CLAUDE.md
  git commit -m "docs: update TLS default information"
  ```
