import type { Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';

/**
 * Start a server process and resolve when it reports "listening".
 * Uses detached:true so killServer() can reap the entire process group
 * (important for bun which may spawn child processes).
 */
export function startServer(cmd: string, args: string[], timeoutMs = 20_000): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        proc.stdout?.off('data', onData);
        proc.stderr?.off('data', onData);
        resolve(proc);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', reject);
    setTimeout(() => reject(new Error(`server failed to start: ${cmd} ${args.join(' ')}`)), timeoutMs);
  });
}

/** Kill a server process group cleanly. Safe to call when proc is undefined. */
export function killServer(proc: ChildProcess | undefined): void {
  if (!proc?.pid) return;
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
}

/** Inject raw terminal data into the page as if received from the server. */
export async function writeToTerminal(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => (window as any).__mockWsReceive(t), text);
}

/**
 * Mock /api/sessions and /api/windows via page.route().
 * Call before page.goto().
 */
export async function mockApis(page: Page, sessions: string[], windows: object[]): Promise<void> {
  await page.route('/api/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) })
  );
  await page.route('/api/windows**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(windows) })
  );
}

/**
 * Install a WebSocket spy before page load via addInitScript.
 *
 * Installs:
 *   window.__wsSent        — array of all outgoing WS messages (strings)
 *   window.__wsInstance    — the live WebSocket object (set on construction)
 *   window.__mockWsReceive — call with a string to inject a fake incoming message
 *
 * The real WebSocket connection is preserved — this is a spy, not a stub.
 * Call before page.goto().
 */
export async function injectWsSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__wsSent = [];
    (window as any).__wsInstance = null;
    const OrigWS = window.WebSocket;
    class SpyWS extends OrigWS {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        (window as any).__wsInstance = this;
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        (window as any).__wsSent.push(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBufferView));
        return super.send(data as string);
      }
    }
    window.WebSocket = SpyWS as any;
    (window as any).__mockWsReceive = (data: string) => {
      if ((window as any).__wsInstance?.onmessage) {
        (window as any).__wsInstance.onmessage({ data });
      }
    };
  });
}

/**
 * Wait until the WebSocket connection is open.
 * The frontend sends a resize JSON message immediately in ws.onopen — we poll for it.
 */
export async function waitForWsOpen(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__wsSent.some((m: string) => typeof m === 'string' && m.startsWith('{"type":"resize"')),
    { timeout: 10000 }
  );
}

/**
 * Inject a server-push message into the page's ws.onmessage handler.
 * Simulates the server sending \x00TT:<json>.
 * Call after waitForWsOpen().
 */
export async function sendFromServer(page: Page, payload: object): Promise<void> {
  await page.evaluate(
    (json) => (window as any).__mockWsReceive('\x00TT:' + JSON.stringify(json)),
    payload
  );
}
