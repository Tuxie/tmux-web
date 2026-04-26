/** Smoke-coverage harness for src/desktop/index.ts.
 *
 * The entrypoint runs `main()` at top level (`main().catch(process.exit)`),
 * so importing the module is the only way to drive its body. The strategy
 * here is deliberately conservative: we do NOT mock `server-process.js`,
 * `auth.js`, `tmux-path.js`, `window.js`, `window-host-messages.js`, or
 * `display-workarea.js` — every override of those persists in Bun's
 * process-global module registry and contaminates the sibling test files
 * (`smoke.test.ts`, `auth.test.ts`, `index.test.ts`,
 * `display-workarea.test.ts`, `window.test.ts`,
 * `window-host-messages.test.ts`).
 *
 * Instead we mock only `electrobun/bun` (which has no sibling test) and
 * point `TMUX_TERM_TMUX_WEB` at a tiny throwaway script that prints the
 * magic readiness line so the real `startTmuxWebServer` resolves
 * naturally. The fake BrowserWindow exposes the full surface
 * `installTmuxTermHostMessages` requires (`webview.on`, `getFrame`,
 * `setFrame`, lifecycle events) so the real
 * window-host-messages installer runs all the way through.
 *
 * `process.on('SIGINT'|'SIGTERM'|'SIGHUP', ...)` is intercepted around
 * the import boundary so main()'s shutdown handlers never get attached
 * to the test process — their handler bodies call `process.exit(0)`,
 * which would silently terminate the bun-test runner if any sibling
 * test (e.g. ws-handle-connection.test.ts) later spawns a child that
 * sends SIGTERM. */
import { afterAll, describe, expect, mock, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalTmuxWebEnv = process.env.TMUX_TERM_TMUX_WEB;
const originalTmuxBin = process.env.TMUX_TERM_TMUX_BIN;
const tempPaths: string[] = [];

afterAll(() => {
  if (originalTmuxWebEnv === undefined) delete process.env.TMUX_TERM_TMUX_WEB;
  else process.env.TMUX_TERM_TMUX_WEB = originalTmuxWebEnv;
  if (originalTmuxBin === undefined) delete process.env.TMUX_TERM_TMUX_BIN;
  else process.env.TMUX_TERM_TMUX_BIN = originalTmuxBin;
  for (const p of tempPaths) {
    try { fs.rmSync(p, { force: true }); } catch {}
  }
});

describe('desktop entrypoint module', () => {
  test('main() wires server, window, and host-message routing', async () => {
    // Throwaway tmux-web stand-in: prints the readiness line so the
    // real startTmuxWebServer's stdout reader resolves, then `exec`s
    // into `sleep infinity`. The shim MUST NOT exit on its own —
    // src/desktop/index.ts wires `proc.exited.then(code => process.exit(...))`,
    // which would silently kill the bun-test runner. The orphaned
    // sleep dies with the test runner's process group when the suite
    // finishes.
    const fakeTmuxWeb = path.join(
      os.tmpdir(),
      `fake-tmux-web-${crypto.randomUUID()}.sh`,
    );
    fs.writeFileSync(
      fakeTmuxWeb,
      '#!/bin/sh\necho "tmux-web listening on http://127.0.0.1:54321"\nexec sleep infinity\n',
      { mode: 0o755 },
    );
    tempPaths.push(fakeTmuxWeb);
    process.env.TMUX_TERM_TMUX_WEB = fakeTmuxWeb;
    process.env.TMUX_TERM_TMUX_BIN = '/usr/bin/tmux'; // make desktopExtraArgs deterministic

    const winHandlers: Record<string, () => void> = {};
    const webviewHandlers: Record<string, (event: unknown) => void> = {};
    const openCalls: string[] = [];
    let frame = { x: 0, y: 0, width: 1200, height: 760 };
    /** Stand-in BrowserWindow used by the real openTmuxTermWindow when
     *  the entry-point invokes `new BrowserWindowClass({...})`. Captures
     *  the URL passed in (the constructor option), and exposes the
     *  webview / getFrame / setFrame surface that
     *  installTmuxTermHostMessages exercises. */
    class FakeBrowserWindow {
      webview = {
        on: (name: string, handler: (event: unknown) => void) => {
          webviewHandlers[name] = handler;
        },
      };
      constructor(opts: { url: string }) {
        openCalls.push(opts.url);
      }
      show() {}
      focus() {}
      on(event: 'close' | 'move' | 'resize', cb: () => void) {
        winHandlers[event] = cb;
      }
      close() {}
      getFrame() {
        return { ...frame };
      }
      setFrame(x: number, y: number, width: number, height: number) {
        frame = { x, y, width, height };
      }
    }

    mock.module('electrobun/bun', () => ({
      BrowserWindow: FakeBrowserWindow,
      Screen: {
        getAllDisplays: () => [{
          id: 1,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1,
          isPrimary: true,
        }],
        getPrimaryDisplay: () => ({
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        }),
        getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      },
    }));

    // Importing the module runs main() at top level. Wait until the
    // host-message handler is registered — that's the proxy for "main()
    // reached the post-window wiring branch". Silence the entry-point's
    // stderr writes (logDesktop + logTmuxWebOutput bypass console.* so
    // the global silence-console preload misses them) and intercept
    // SIGINT/SIGTERM/SIGHUP `process.on(...)` registrations so main()'s
    // shutdown handlers can't ride along into sibling test files (their
    // shutdown body calls `process.exit(0)`, which would terminate the
    // bun-test runner if any other test triggers SIGTERM later, e.g.
    // ws-handle-connection.test.ts spawns child processes).
    const previousWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    const originalOn = process.on.bind(process);
    process.on = ((event: string | symbol, handler: (...args: unknown[]) => void) => {
      if (event === 'SIGINT' || event === 'SIGTERM' || event === 'SIGHUP') {
        // Drop on the floor — the test does not need the signal-driven
        // shutdown branch and registering it process-globally is unsafe.
        return process;
      }
      return originalOn(event as 'exit', handler);
    }) as typeof process.on;
    try {
      await import('../../../src/desktop/index.ts');
      const deadline = Date.now() + 4000;
      while (!('host-message' in webviewHandlers) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      process.stderr.write = previousWrite;
      process.on = originalOn as typeof process.on;
    }

    expect(openCalls.length).toBe(1);
    expect(openCalls[0]).toContain('@127.0.0.1:54321/');
    expect(typeof winHandlers.close).toBe('function');
    expect(typeof webviewHandlers['host-message']).toBe('function');

    // Drive the host-message routing through the real installer so the
    // close-window branch is executed (touches main()'s win.close
    // handler too).
    let closed = false;
    const origClose = FakeBrowserWindow.prototype.close;
    FakeBrowserWindow.prototype.close = function () {
      closed = true;
      origClose.call(this);
    };
    webviewHandlers['host-message']!({
      data: { detail: { type: 'tmux-term:close-window' } },
    });
    expect(closed).toBe(true);
  });
});
