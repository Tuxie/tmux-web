# Update E2E tests to use --no-tls

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure all E2E tests use `--no-tls` when starting the server to avoid certificate issues and ensure consistent test environment.

**Architecture:** Update `startServer` calls in E2E tests to include the `--no-tls` flag.

**Tech Stack:** Playwright, Bun, TypeScript

---

### Task 1: Update xterm-font-metrics.test.ts

**Files:**
- Modify: `tests/e2e/xterm-font-metrics.test.ts`

- [ ] **Step 1: Add --no-tls to startBackendServer**

```typescript
function startBackendServer(terminal: string, port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
  );
}
```

### Task 2: Update terminal-selection.test.ts

**Files:**
- Modify: `tests/e2e/terminal-selection.test.ts`

- [ ] **Step 1: Add --no-tls to the third startServer call**

```typescript
  test.beforeAll(async () => {
    server = await startServer(
      'bun',
      ['src/server/index.ts', '--test', `--listen=127.0.0.1:${PORT}`, '--no-auth', '--terminal=xterm-dev', '--no-tls'],
    );
  });
```

### Task 3: Build the binary

- [ ] **Step 1: Run bun run build**

Run: `bun run build`
Expected: Success, `./tmux-web` updated.

### Task 4: Verify with Playwright

- [ ] **Step 1: Run all E2E tests**

Run: `npx playwright test --reporter=line`
Expected: All tests pass.

### Task 5: Commit

- [ ] **Step 1: Commit changes**

```bash
git add tests/e2e/xterm-font-metrics.test.ts tests/e2e/terminal-selection.test.ts
git commit -m "test(e2e): update all tests to use --no-tls and build binary"
```
