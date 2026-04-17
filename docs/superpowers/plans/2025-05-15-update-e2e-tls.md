# Update E2E tests to use --no-tls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update all existing E2E tests to use the `--no-tls` flag and create a new E2E test to verify the default TLS (HTTPS) behavior.

**Architecture:** Existing tests assume HTTP, but the server now defaults to HTTPS. By adding `--no-tls`, we keep the existing tests working without needing to deal with self-signed certificates or HTTPS in those tests. A new test will specifically verify that the default behavior is indeed HTTPS.

**Tech Stack:** Playwright, Bun, TypeScript

---

### Task 1: Update playwright.config.ts

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Add --no-tls to webServer command**

```typescript
<<<<
    command: 'bun src/server/index.ts --test --terminal=ghostty --listen 127.0.0.1:4023 --no-auth',
====
    command: 'bun src/server/index.ts --test --terminal=ghostty --listen 127.0.0.1:4023 --no-auth --no-tls',
>>>>
```

### Task 2: Update existing E2E tests calling startServer

**Files:**
- Modify: `tests/e2e/binary-backends.test.ts`
- Modify: `tests/e2e/font-change-rendering.test.ts`
- Modify: `tests/e2e/font-selection.test.ts`
- Modify: `tests/e2e/menu-settings-open.test.ts`
- Modify: `tests/e2e/terminal-backends.test.ts`
- Modify: `tests/e2e/terminal-selection.test.ts`
- Modify: `tests/e2e/xterm-font-metrics.test.ts`

- [ ] **Step 1: Add --no-tls to startServer calls in binary-backends.test.ts**

```typescript
<<<<
    ['--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
====
    ['--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
>>>>
```

- [ ] **Step 2: Add --no-tls to startServer calls in font-change-rendering.test.ts**

```typescript
<<<<
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
====
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
>>>>
```

- [ ] **Step 3: Add --no-tls to startServer calls in font-selection.test.ts**

```typescript
<<<<
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
====
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
>>>>
```

- [ ] **Step 4: Add --no-tls to startServer calls in menu-settings-open.test.ts**

```typescript
<<<<
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
====
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
>>>>
```

- [ ] **Step 5: Add --no-tls to startServer calls in terminal-backends.test.ts**

```typescript
<<<<
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
====
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
>>>>
```

- [ ] **Step 6: Add --no-tls to startServer calls in terminal-selection.test.ts (multiple locations)**

```typescript
<<<<
      ['src/server/index.ts', '--test', `--listen=127.0.0.1:${PORT}`, '--no-auth', '--terminal=ghostty'],
====
      ['src/server/index.ts', '--test', `--listen=127.0.0.1:${PORT}`, '--no-auth', '--terminal=ghostty', '--no-tls'],
>>>>
```

- [ ] **Step 7: Add --no-tls to startServer calls in xterm-font-metrics.test.ts**

```typescript
<<<<
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
====
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
>>>>
```

### Task 3: Create tests/e2e/tls.test.ts

**Files:**
- Create: `tests/e2e/tls.test.ts`

- [ ] **Step 1: Write tls.test.ts**

```typescript
import { test, expect } from '@playwright/test';
import { startServer, killServer } from './helpers.js';
import { type ChildProcess } from 'child_process';

test('server starts with TLS by default', async () => {
  const port = 4099;
  let stdout = '';
  
  // startServer resolves when it sees "listening" in stdout/stderr
  const server = await startServer(
    'bun',
    ['src/server/index.ts', '--test', `--listen=127.0.0.1:${port}`, '--no-auth'],
  );

  try {
    // We need to capture the output to verify https://
    // startServer already attached listeners, but we can attach another one or just trust it.
    // Actually startServer doesn't expose the captured output easily.
    // Let's modify startServer to optionally return output or just re-read from the process.
    
    // Alternative: since startServer resolves, we know it started. 
    // We can just check the output if we pipe it ourselves or if startServer does it.
    
    // Wait a bit for the "listening on https://..." message to definitely be there
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Note: startServer uses stdio: ['ignore', 'pipe', 'pipe']
    // So server.stdout is available.
    
    // However, startServer already read some data from it.
    // Let's just spawn it here manually to be sure we catch the output we want,
    // or use a simpler version of startServer.
  } finally {
    killServer(server);
  }
});
```

Actually, let's refine `tls.test.ts` to be more robust.

```typescript
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { killServer } from './helpers.js';

test('server starts with TLS by default', async () => {
  const port = 4099;
  const proc = spawn('bun', ['src/server/index.ts', '--test', `--listen=127.0.0.1:${port}`, '--no-auth'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let output = '';
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
  };
  proc.stdout?.on('data', capture);
  proc.stderr?.on('data', capture);

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for server output')), 10000);
      const interval = setInterval(() => {
        if (output.includes('listening on https://127.0.0.1')) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
    
    expect(output).toContain(`https://127.0.0.1:${port}`);
  } finally {
    killServer(proc);
  }
});
```

### Task 4: Verify and Commit

- [ ] **Step 1: Run all E2E tests**

Run: `npm run test:e2e`
Expected: ALL PASS

- [ ] **Step 2: Commit changes**

```bash
git add playwright.config.ts tests/e2e/*.test.ts
git commit -m "test(e2e): update existing tests to use --no-tls and add TLS default test"
```
