/**
 * Post-compile binary smoke tests.
 *
 * IMPORTANT: this directory is invoked explicitly from CI / `make
 * test-post-compile` against the *compiled* `tmux-web` binary. It is
 * NOT picked up by `make test` / `make test-unit` (bunfig pins the
 * default test root to `tests/unit`) or by `make test-e2e`
 * (Playwright `testDir` is `./tests/e2e`).
 *
 * These tests guard against artifact regressions that source-mode
 * tests cannot see. The v1.8.0 bunfs precedent (CHANGELOG.md `1.8.1`
 * entry) is the canonical example: four binaries shipped without
 * working embedded tmux because nothing in CI ran the *packaged*
 * artifact. `verify-vendor-xterm.ts` proves the embedded xterm bundle
 * is served, but does not exercise WS upgrade, Basic Auth wiring, or
 * the `/api/*` round-trip. This file fills that gap with a small
 * 3-endpoint contract:
 *   - GET / returns the HTML shell containing `id="terminal"`
 *   - GET /api/sessions returns 200 with a JSON array
 *   - WS upgrade on /ws succeeds against the running binary
 *
 * Binary location: $TMUX_WEB_BINARY (preferred), else project-root
 * `./tmux-web`. If neither exists the suite skips with a clear
 * message — local dev without a built binary should not break
 * `bun test tests/post-compile/`.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type { Subprocess } from 'bun';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dir, '..', '..');
const BINARY = process.env.TMUX_WEB_BINARY
  ? path.resolve(process.env.TMUX_WEB_BINARY)
  : path.resolve(PROJECT_ROOT, 'tmux-web');

const HAVE_BINARY = existsSync(BINARY);

// Random high port so concurrent CI legs and a developer's running
// instance can coexist. Range chosen above the e2e PORTS.md table.
const PORT = 17000 + Math.floor(Math.random() * 1000);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const WS_BASE = `ws://${HOST}:${PORT}`;

let server: Subprocess<'ignore', 'inherit', 'inherit'> | undefined;

async function waitForServer(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/sessions`);
      if (r.ok) return;
    } catch {
      // ECONNREFUSED while the binary is still starting up.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`post-compile: timed out waiting for ${BASE} to come up`);
}

beforeAll(async () => {
  if (!HAVE_BINARY) return;
  server = Bun.spawn(
    [BINARY, '--test', '--listen', `${HOST}:${PORT}`, '--no-auth', '--no-tls'],
    { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
  );
  await waitForServer(15_000);
});

afterAll(async () => {
  if (server) {
    try {
      server.kill('SIGTERM');
    } catch {
      // best effort
    }
    // Give the process a moment to exit before the suite tears down.
    await new Promise((r) => setTimeout(r, 100));
  }
});

describe('post-compile binary smoke', () => {
  test.skipIf(!HAVE_BINARY)(
    'binary is present (skips when neither TMUX_WEB_BINARY nor ./tmux-web exists)',
    () => {
      expect(HAVE_BINARY).toBe(true);
    },
  );

  test.skipIf(!HAVE_BINARY)('GET / serves the HTML shell with #terminal', async () => {
    const r = await fetch(`${BASE}/`);
    expect(r.status).toBe(200);
    const ct = r.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
    const body = await r.text();
    // Same selector e2e tests rely on (`#terminal` in the DOM contract,
    // see AGENTS.md "DOM Contract (E2E Tests)"). If the compiled binary
    // ever stops embedding the client HTML, this catches it.
    expect(body).toContain('id="terminal"');
  });

  test.skipIf(!HAVE_BINARY)('GET /api/sessions returns 200 + JSON array', async () => {
    const r = await fetch(`${BASE}/api/sessions`);
    expect(r.status).toBe(200);
    const ct = r.headers.get('content-type') ?? '';
    expect(ct).toContain('application/json');
    const json = await r.json();
    // In --test mode the server has no real tmux server; the route
    // returns []. Either way the response must be a JSON array.
    expect(Array.isArray(json)).toBe(true);
  });

  test.skipIf(!HAVE_BINARY)('WS upgrade on /ws succeeds', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `${WS_BASE}/ws?session=main&cols=80&rows=24`,
      );
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('post-compile: WS upgrade timed out after 5s'));
      }, 5_000);
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            // ignore
          }
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        'error',
        (e) => {
          clearTimeout(timer);
          reject(new Error(`post-compile: WS upgrade error: ${String(e)}`));
        },
        { once: true },
      );
    });
  });
});
