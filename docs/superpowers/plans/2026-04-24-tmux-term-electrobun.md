# tmux-term Electrobun Desktop Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tmux-term`, an optional Electrobun desktop app that opens the existing tmux-web UI in a native window backed by a private authenticated loopback tmux-web server.

**Architecture:** Keep tmux-web unchanged as the source of truth. Add a small desktop layer under `src/desktop/` with testable helpers for credentials, child-process launch config, server readiness parsing, and lifecycle cleanup. Electrobun-specific code only creates the native window and wires app/window close to the tmux-web child.

**Tech Stack:** Bun, TypeScript, Electrobun `1.16.0`, existing tmux-web server/client build, Bun unit tests.

---

## File Structure

- Create `src/desktop/auth.ts`
  - Generates per-launch Basic Auth credentials with cryptographic randomness.
  - Builds authenticated localhost URLs without logging secrets.
- Create `src/desktop/server-process.ts`
  - Builds tmux-web child launch arguments and environment.
  - Parses `tmux-web listening on http://127.0.0.1:<port>` readiness output.
  - Starts and stops the tmux-web child process.
  - Uses `TMUX_WEB_USERNAME` and `TMUX_WEB_PASSWORD` environment variables instead of `--password`, so the random secret is not exposed in the child argv.
- Create `src/desktop/app.ts`
  - Electrobun main entrypoint.
  - Starts the tmux-web child, waits for readiness, opens `BrowserWindow`, and cleans up on window close or process signal.
- Create `tests/unit/desktop/auth.test.ts`
  - Unit coverage for random credentials and URL construction.
- Create `tests/unit/desktop/server-process.test.ts`
  - Unit coverage for args/env construction, readiness parsing, and cleanup behavior.
- Create `electrobun.config.ts`
  - Defines the `tmux-term` Electrobun app using native renderer by default.
- Modify `package.json`
  - Add exact dependency `"electrobun": "1.16.0"`.
  - Add desktop scripts.
- Modify `Makefile`
  - Add `tmux-term` target.
- Modify `README.md`
  - Document local desktop build/run basics.
- Modify `CHANGELOG.md`
  - Add an Unreleased entry for the desktop wrapper.

Implementation sources:

- Approved design: `docs/superpowers/specs/2026-04-24-tmux-term-electrobun-design.md`
- Electrobun BrowserWindow docs: `https://electrobun.dev/docs/apis/bun/BrowserWindow`
- Electrobun build config docs: `https://blackboard.sh/electrobun/docs/apis/cli/build-configuration/`
- Electrobun stable npm metadata: `https://registry.npmjs.org/electrobun/latest`

## Task 1: Desktop Credential Helpers

**Files:**
- Create: `src/desktop/auth.ts`
- Test: `tests/unit/desktop/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/desktop/auth.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  buildAuthenticatedUrl,
  generateDesktopCredentials,
} from '../../../src/desktop/auth.js';

describe('desktop auth helpers', () => {
  test('generateDesktopCredentials returns stable prefixes and long random secrets', () => {
    const first = generateDesktopCredentials();
    const second = generateDesktopCredentials();

    expect(first.username.startsWith('tmux-term-')).toBe(true);
    expect(second.username.startsWith('tmux-term-')).toBe(true);
    expect(first.password.length).toBeGreaterThanOrEqual(43);
    expect(second.password.length).toBeGreaterThanOrEqual(43);
    expect(first.username).not.toBe(second.username);
    expect(first.password).not.toBe(second.password);
    expect(first.password).not.toContain(':');
    expect(first.username).not.toContain(':');
  });

  test('generateDesktopCredentials accepts deterministic bytes for tests', () => {
    const creds = generateDesktopCredentials({
      randomBytes: (size) => Buffer.alloc(size, 0xab),
    });

    expect(creds.username).toBe('tmux-term-q6urq6urq6s');
    expect(creds.password).toBe('q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s');
  });

  test('buildAuthenticatedUrl encodes credentials and uses loopback http', () => {
    const url = buildAuthenticatedUrl({
      host: '127.0.0.1',
      port: 41234,
      credentials: {
        username: 'tmux-term-user',
        password: 'p@ss/w:rd',
      },
    });

    expect(url).toBe('http://tmux-term-user:p%40ss%2Fw%3Ard@127.0.0.1:41234/');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/unit/desktop/auth.test.ts
```

Expected: FAIL because `src/desktop/auth.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/desktop/auth.ts`:

```ts
import { randomBytes as nodeRandomBytes } from 'node:crypto';

export interface DesktopCredentials {
  username: string;
  password: string;
}

export interface GenerateDesktopCredentialsOptions {
  randomBytes?: (size: number) => Uint8Array;
}

export interface AuthenticatedUrlOptions {
  host: string;
  port: number;
  credentials: DesktopCredentials;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function generateDesktopCredentials(
  opts: GenerateDesktopCredentialsOptions = {},
): DesktopCredentials {
  const randomBytes = opts.randomBytes ?? nodeRandomBytes;
  return {
    username: `tmux-term-${base64Url(randomBytes(8))}`,
    password: base64Url(randomBytes(32)),
  };
}

export function buildAuthenticatedUrl(opts: AuthenticatedUrlOptions): string {
  const user = encodeURIComponent(opts.credentials.username);
  const pass = encodeURIComponent(opts.credentials.password);
  return `http://${user}:${pass}@${opts.host}:${opts.port}/`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/unit/desktop/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/auth.ts tests/unit/desktop/auth.test.ts
git commit -m "feat(desktop): generate private launch credentials"
```

## Task 2: tmux-web Child Launch Helpers

**Files:**
- Create: `src/desktop/server-process.ts`
- Test: `tests/unit/desktop/server-process.test.ts`

- [ ] **Step 1: Write failing tests for launch config and readiness parsing**

Create `tests/unit/desktop/server-process.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  buildTmuxWebLaunch,
  parseTmuxWebListeningLine,
} from '../../../src/desktop/server-process.js';

describe('desktop tmux-web launch helpers', () => {
  test('buildTmuxWebLaunch binds loopback port 0 and keeps password out of argv', () => {
    const launch = buildTmuxWebLaunch({
      executable: '/opt/tmux-term/tmux-web',
      credentials: {
        username: 'tmux-term-user',
        password: 'random-secret',
      },
      extraArgs: ['--tmux', '/usr/bin/tmux'],
      env: { PATH: '/usr/bin', TMUX_WEB_PASSWORD: 'old' },
    });

    expect(launch.cmd).toBe('/opt/tmux-term/tmux-web');
    expect(launch.args).toEqual([
      '--listen', '127.0.0.1:0',
      '--no-tls',
      '--tmux', '/usr/bin/tmux',
    ]);
    expect(launch.args.join(' ')).not.toContain('random-secret');
    expect(launch.env.TMUX_WEB_USERNAME).toBe('tmux-term-user');
    expect(launch.env.TMUX_WEB_PASSWORD).toBe('random-secret');
    expect(launch.env.PATH).toBe('/usr/bin');
  });

  test('buildTmuxWebLaunch supports running the server through bun', () => {
    const launch = buildTmuxWebLaunch({
      executable: 'bun',
      executableArgs: ['src/server/index.ts'],
      credentials: { username: 'tmux-term-user', password: 'random-secret' },
    });

    expect(launch.cmd).toBe('bun');
    expect(launch.args).toEqual([
      'src/server/index.ts',
      '--listen', '127.0.0.1:0',
      '--no-tls',
    ]);
  });

  test('parseTmuxWebListeningLine accepts loopback http lines', () => {
    expect(parseTmuxWebListeningLine('tmux-web listening on http://127.0.0.1:38123')).toEqual({
      host: '127.0.0.1',
      port: 38123,
      origin: 'http://127.0.0.1:38123',
    });
  });

  test('parseTmuxWebListeningLine rejects tls, wildcard, and unrelated output', () => {
    expect(parseTmuxWebListeningLine('tmux-web listening on https://127.0.0.1:38123')).toBeNull();
    expect(parseTmuxWebListeningLine('tmux-web listening on http://0.0.0.0:38123')).toBeNull();
    expect(parseTmuxWebListeningLine('warning: booting')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/unit/desktop/server-process.test.ts
```

Expected: FAIL because `src/desktop/server-process.ts` does not exist.

- [ ] **Step 3: Implement launch config and parsing**

Create `src/desktop/server-process.ts`:

```ts
import type { Subprocess } from 'bun';
import type { DesktopCredentials } from './auth.js';

export interface TmuxWebLaunchOptions {
  executable: string;
  credentials: DesktopCredentials;
  executableArgs?: string[];
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface TmuxWebLaunch {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface ListeningEndpoint {
  host: string;
  port: number;
  origin: string;
}

export function buildTmuxWebLaunch(opts: TmuxWebLaunchOptions): TmuxWebLaunch {
  return {
    cmd: opts.executable,
    args: [
      ...(opts.executableArgs ?? []),
      '--listen', '127.0.0.1:0',
      '--no-tls',
      ...(opts.extraArgs ?? []),
    ],
    env: {
      ...(opts.env ?? process.env),
      TMUX_WEB_USERNAME: opts.credentials.username,
      TMUX_WEB_PASSWORD: opts.credentials.password,
    },
  };
}

export function parseTmuxWebListeningLine(line: string): ListeningEndpoint | null {
  const match = line.match(/^tmux-web listening on (http:\/\/127\.0\.0\.1:(\d+))$/);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: '127.0.0.1', port, origin: match[1]! };
}

export interface StartedTmuxWebServer {
  process: Subprocess<'pipe', 'pipe', 'pipe'>;
  endpoint: ListeningEndpoint;
  close: () => Promise<void>;
}

export interface StartTmuxWebServerOptions extends TmuxWebLaunchOptions {
  startupTimeoutMs?: number;
}

function terminateProcess(proc: Subprocess<'pipe', 'pipe', 'pipe'>): void {
  try {
    proc.kill('SIGTERM');
  } catch {
    try { proc.kill(); } catch {}
  }
}

export async function startTmuxWebServer(
  opts: StartTmuxWebServerOptions,
): Promise<StartedTmuxWebServer> {
  const launch = buildTmuxWebLaunch(opts);
  const proc = Bun.spawn({
    cmd: [launch.cmd, ...launch.args],
    env: launch.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const decoder = new TextDecoder();
  const timeoutMs = opts.startupTimeoutMs ?? 10_000;
  let buffer = '';

  const endpoint = await new Promise<ListeningEndpoint>((resolve, reject) => {
    const timer = setTimeout(() => {
      terminateProcess(proc);
      reject(new Error(`tmux-web did not report readiness within ${timeoutMs}ms`));
    }, timeoutMs);

    const fail = (err: unknown) => {
      clearTimeout(timer);
      terminateProcess(proc);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    void proc.exited.then((code) => {
      fail(new Error(`tmux-web exited before readiness with status ${code}`));
    });

    void (async () => {
      const reader = proc.stdout.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const parsed = parseTmuxWebListeningLine(line);
            if (parsed) {
              clearTimeout(timer);
              resolve(parsed);
              return;
            }
          }
        }
        fail(new Error('tmux-web stdout closed before readiness'));
      } catch (err) {
        fail(err);
      } finally {
        try { reader.releaseLock(); } catch {}
      }
    })();
  });

  return {
    process: proc,
    endpoint,
    close: async () => {
      terminateProcess(proc);
      try { await proc.exited; } catch {}
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/unit/desktop/server-process.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/server-process.ts tests/unit/desktop/server-process.test.ts
git commit -m "feat(desktop): prepare private tmux-web launch"
```

## Task 3: Desktop Lifecycle Entrypoint

**Files:**
- Create: `src/desktop/app.ts`
- Modify: `tests/unit/desktop/server-process.test.ts`

- [ ] **Step 1: Add tests for lifecycle cleanup helper**

Modify the import block at the top of `tests/unit/desktop/server-process.test.ts`:

```ts
import {
  buildTmuxWebLaunch,
  createCloseOnce,
  parseTmuxWebListeningLine,
} from '../../../src/desktop/server-process.js';
```

Then append this test inside the existing `describe('desktop tmux-web launch helpers', ...)` block:

```ts
test('createCloseOnce runs cleanup once', async () => {
  let calls = 0;
  const close = createCloseOnce(async () => { calls += 1; });

  await close();
  await close();
  await close();

  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/unit/desktop/server-process.test.ts
```

Expected: FAIL because `createCloseOnce` is not exported.

- [ ] **Step 3: Implement `createCloseOnce`**

Add this export near the bottom of `src/desktop/server-process.ts`:

```ts
export function createCloseOnce(close: () => Promise<void> | void): () => Promise<void> {
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    await close();
  };
}
```

- [ ] **Step 4: Create the Electrobun entrypoint**

Create `src/desktop/app.ts`:

```ts
import { BrowserWindow } from 'electrobun/bun';
import { buildAuthenticatedUrl, generateDesktopCredentials } from './auth.js';
import {
  createCloseOnce,
  startTmuxWebServer,
} from './server-process.js';

function resolveTmuxWebExecutable(): string {
  return process.env.TMUX_TERM_TMUX_WEB ?? './tmux-web';
}

function desktopExtraArgs(): string[] {
  const args: string[] = [];
  if (process.env.TMUX_TERM_TMUX_BIN) {
    args.push('--tmux', process.env.TMUX_TERM_TMUX_BIN);
  }
  if (process.env.TMUX_TERM_THEMES_DIR) {
    args.push('--themes-dir', process.env.TMUX_TERM_THEMES_DIR);
  }
  return args;
}

async function main(): Promise<void> {
  const credentials = generateDesktopCredentials();
  const server = await startTmuxWebServer({
    executable: resolveTmuxWebExecutable(),
    credentials,
    extraArgs: desktopExtraArgs(),
  });
  const closeServer = createCloseOnce(server.close);

  const url = buildAuthenticatedUrl({
    host: server.endpoint.host,
    port: server.endpoint.port,
    credentials,
  });

  const win = new BrowserWindow({
    title: 'tmux-term',
    url,
    partition: `tmux-term-${process.pid}`,
    frame: {
      width: 1200,
      height: 760,
    },
  });

  win.on('close', () => {
    void closeServer().finally(() => process.exit(0));
  });

  void server.process.exited.then((code) => {
    try { win.close(); } catch {}
    process.exit(code === 0 ? 0 : 1);
  });

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      void closeServer().finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 5: Run desktop unit tests**

Run:

```bash
bun test tests/unit/desktop/auth.test.ts tests/unit/desktop/server-process.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/desktop/app.ts src/desktop/server-process.ts tests/unit/desktop/server-process.test.ts
git commit -m "feat(desktop): add Electrobun app entrypoint"
```

## Task 4: Electrobun Build Configuration

**Files:**
- Create: `electrobun.config.ts`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add the exact Electrobun dependency**

Run:

```bash
bun add --exact --dev electrobun@1.16.0
```

Expected: `package.json` gains `"electrobun": "1.16.0"` under `devDependencies`, and `bun.lock` updates.

- [ ] **Step 2: Add desktop scripts to `package.json`**

Modify the `scripts` object in `package.json` so it includes these entries:

```json
"desktop:dev": "bun run bun-build.ts && make tmux-web && TMUX_TERM_TMUX_WEB=./tmux-web electrobun dev",
"desktop:build": "bun run bun-build.ts && make tmux-web && electrobun build",
"desktop:stable": "bun run bun-build.ts && make tmux-web && electrobun build --env=stable"
```

Keep all existing scripts.

- [ ] **Step 3: Create `electrobun.config.ts`**

Create `electrobun.config.ts`:

```ts
import type { ElectrobunConfig } from 'electrobun';
import pkg from './package.json' with { type: 'json' };

export default {
  app: {
    name: 'tmux-term',
    identifier: 'dev.tmux-web.tmux-term',
    version: pkg.version,
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: 'src/desktop/app.ts',
      external: ['electrobun/bun'],
    },
    mac: {
      bundleCEF: false,
      defaultRenderer: 'native',
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: 'native',
    },
  },
} satisfies ElectrobunConfig;
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
make typecheck
```

Expected: PASS. If TypeScript reports that `external: ['electrobun/bun']` is invalid for Electrobun's build config, remove that property and rerun. If TypeScript reports missing Electrobun config types, inspect `node_modules/electrobun/dist` and adjust only the import path, keeping the config fields above.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock electrobun.config.ts
git commit -m "build(desktop): configure Electrobun wrapper"
```

## Task 5: Makefile Desktop Target

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add failing Makefile target expectation by inspection**

Run:

```bash
make -n tmux-term
```

Expected: FAIL with `No rule to make target 'tmux-term'`.

- [ ] **Step 2: Add `tmux-term` to phony targets**

Modify the `.PHONY` block in `Makefile` so the first line includes `tmux-term`:

```make
.PHONY: all dev build build-client build-server tmux-term \
        vendor vendor-tmux \
        test typecheck test-unit test-e2e test-e2e-headed \
        bench fuzz install clean distclean
```

- [ ] **Step 3: Add the target**

Add this target after `build-server`:

```make
tmux-term: tmux-web
	$(BUN) run desktop:build
```

- [ ] **Step 4: Verify make resolves the target**

Run:

```bash
make -n tmux-term
```

Expected: command trace includes `bun run desktop:build`.

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -m "build(make): add tmux-term target"
```

## Task 6: Local Smoke Test Script

**Files:**
- Create: `tests/unit/desktop/smoke.test.ts`

- [ ] **Step 1: Write a smoke test for tmux-web readiness parsing against a real child**

Create `tests/unit/desktop/smoke.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { generateDesktopCredentials } from '../../../src/desktop/auth.js';
import { startTmuxWebServer, type StartedTmuxWebServer } from '../../../src/desktop/server-process.js';

let server: StartedTmuxWebServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('desktop tmux-web smoke', () => {
  test('starts tmux-web in test mode on loopback with generated auth', async () => {
    server = await startTmuxWebServer({
      executable: 'bun',
      executableArgs: ['src/server/index.ts'],
      credentials: generateDesktopCredentials({
        randomBytes: (size) => Buffer.alloc(size, 0xcd),
      }),
      extraArgs: ['--test'],
      startupTimeoutMs: 15_000,
    });

    expect(server.endpoint.host).toBe('127.0.0.1');
    expect(server.endpoint.port).toBeGreaterThan(0);

    const noAuth = await fetch(`${server.endpoint.origin}/`);
    expect(noAuth.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run:

```bash
bun test tests/unit/desktop/smoke.test.ts
```

Expected: PASS. The test starts `src/server/index.ts` through Bun in `--test` mode, waits for the readiness line, verifies loopback binding, and confirms unauthenticated requests receive `401`.

- [ ] **Step 3: Run desktop tests**

Run:

```bash
bun test tests/unit/desktop/auth.test.ts tests/unit/desktop/server-process.test.ts tests/unit/desktop/smoke.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/desktop/server-process.ts tests/unit/desktop/server-process.test.ts tests/unit/desktop/smoke.test.ts
git commit -m "test(desktop): smoke private tmux-web launch"
```

## Task 7: Documentation And Changelog

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README**

Add this section near the development/build instructions in `README.md`:

````md
## tmux-term desktop app

`tmux-term` is an optional Electrobun desktop wrapper around tmux-web. It starts
a private tmux-web server on `127.0.0.1` with a per-launch random Basic Auth
secret, opens it in a native desktop window, and shuts the server down when the
window closes.

Local development:

```bash
bun install
bun run desktop:dev
```

Local package build:

```bash
make tmux-term
```

The desktop wrapper uses Electrobun's native webview first. Because tmux-web's
terminal renderer is WebGL-only, macOS and Linux builds must be smoke-tested in
the native webview before release.
````

- [ ] **Step 2: Update CHANGELOG**

Add this section at the top of `CHANGELOG.md`, above the latest released version:

```md
## Unreleased

### Added

- **`tmux-term` desktop wrapper.** Adds an optional Electrobun desktop app target
  that runs the existing tmux-web UI in a native window backed by a private
  loopback tmux-web server. The wrapper binds to `127.0.0.1`, uses a random
  per-launch Basic Auth secret, disables TLS for the local hop, and shuts down
  the child server when the desktop window exits.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document tmux-term desktop wrapper"
```

## Task 8: Verification

**Files:**
- No source changes unless verification exposes a bug.

- [ ] **Step 1: Run desktop unit and smoke tests**

Run:

```bash
bun test tests/unit/desktop/
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

Run:

```bash
make test-unit
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
make typecheck
```

Expected: PASS.

- [ ] **Step 4: Build tmux-web**

Run:

```bash
make tmux-web
```

Expected: PASS, including vendored `vendor/xterm.js` build/sentinel behavior.

- [ ] **Step 5: Try the desktop dev target**

Run on a machine with GUI support:

```bash
bun run desktop:dev
```

Expected:

- Electrobun opens a native window titled `tmux-term`.
- The tmux-web UI loads without a browser chrome.
- The terminal renders using WebGL.
- Closing the window terminates the tmux-web child process.
- Visiting the printed localhost URL without Basic Auth returns `401`.

- [ ] **Step 6: File a bug if native webview cannot render WebGL**

If macOS or Linux native webview fails to render the terminal, create a bug report under `docs/bugs/`:

```md
# tmux-term native webview WebGL render failure

## Context

While verifying the `tmux-term` Electrobun desktop wrapper, the native webview
failed to render tmux-web's WebGL-only xterm.js terminal.

## Platform

- OS:
- Architecture:
- Electrobun version: 1.16.0
- Command:

## Observed

Describe the visible failure and include terminal output.

## Expected

The tmux-web terminal should render in the Electrobun native webview.

## Reproduction

1. Run `bun run desktop:dev`.
2. Wait for the native window to open.
3. Observe the terminal area.

## Notes

Do not switch to CEF until this is triaged. The design requires native webview
first, with CEF only as a fallback for a confirmed native renderer blocker.
```

Then commit the bug report:

```bash
git add docs/bugs/<filename>.md
git commit -m "docs(bugs): report tmux-term native webview render failure"
```

## Self-Review Notes

- Spec coverage: The plan covers the loopback wrapper, random auth, exact Electrobun stable dependency, native renderer default, build isolation, server cleanup, tests, docs, and future IPC exclusion.
- Scope: This plan does not implement internal Electrobun IPC, CEF fallback, release workflow publishing, or a forked UI.
- Security nuance: The child password is passed via environment variables, not `--password`, to avoid the existing tmux-web CLI password warning and keep secrets out of argv.
