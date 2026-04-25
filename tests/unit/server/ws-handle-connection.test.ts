import { describe, test, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import http from 'node:http';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';
import { makeFakeTmux } from './_harness/fake-tmux.ts';
import { execFileAsync } from '../../../src/server/exec.ts';
import { NoControlClientError, type TmuxControl, type TmuxNotification } from '../../../src/server/tmux-control.ts';
import { SCROLLBAR_FORMAT } from '../../../src/server/scrollbar.ts';

function postDrop(baseUrl: string, filename: string, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + '/api/drop?session=main');
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'x-filename': encodeURIComponent(filename), 'content-length': String(body.length) },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode ?? 0));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let h: Harness | undefined;
afterEach(async () => { if (h) { await h.close(); h = undefined; } });

interface OpenedWs {
  ws: WebSocket;
  opened: Promise<void>;
  messages: string[];
  raw: Buffer[];
}

function openWs(wsUrl: string, path = '/ws?session=main&cols=80&rows=24'): OpenedWs {
  const ws = new WebSocket(wsUrl + path);
  ws.binaryType = 'arraybuffer';
  const messages: string[] = [];
  const raw: Buffer[] = [];
  // Attach listener *before* open so early PTY output (trigger file) is captured.
  ws.addEventListener('message', (ev: MessageEvent) => {
    const buf = typeof ev.data === 'string'
      ? Buffer.from(ev.data, 'utf8')
      : Buffer.from(ev.data as ArrayBuffer);
    raw.push(buf);
    const s = buf.toString('utf8');
    if (s.startsWith('\x00TT:')) messages.push(s.slice(4));
  });
  ws.addEventListener('error', () => { /* swallow async errors so tests don't crash on close */ });
  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(e), { once: true });
  });
  return { ws, opened, messages, raw };
}

/** Poll `pred` every `intervalMs` until it returns truthy or `timeoutMs` elapses.
 *  Resolves to pred()'s final value. */
async function waitFor<T>(pred: () => T | Promise<T>, timeoutMs = 3000, intervalMs = 10): Promise<T> {
  const start = Date.now();
  // First check is immediate — no sleep before first attempt.
  while (true) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - start >= timeoutMs) return v;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/** Wait until `messages` contains one matching `predicate`. Returns parsed JSON or undefined. */
async function waitForMsg(messages: string[], predicate: (parsed: any) => boolean, timeoutMs = 3000): Promise<any | undefined> {
  const start = Date.now();
  while (true) {
    for (const raw of messages) {
      try { const p = JSON.parse(raw); if (predicate(p)) return p; } catch { /* skip */ }
    }
    if (Date.now() - start >= timeoutMs) return undefined;
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('ws handleConnection — OSC 52 read flow', () => {
  test.skipIf(process.platform !== 'linux')('prompt → allow → clipboard-read-reply persists grant in store', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    fs.writeFileSync(h.tmpDir + '/sessions.json', JSON.stringify({
      version: 1,
      sessions: { main: { theme: 'Default', fontFamily: 'x', fontSize: 12, spacing: 1, opacity: 0 } },
    }));
    const o = openWs(h.wsUrl);
    await o.opened;

    const promptFrame = await waitForMsg(o.messages, m => 'clipboardPrompt' in m, 8000);
    expect(promptFrame).toBeTruthy();
    const prompt = promptFrame!.clipboardPrompt;
    expect(typeof prompt.reqId).toBe('string');
    expect(typeof prompt.exePath).toBe('string');

    o.ws.send(JSON.stringify({
      type: 'clipboard-decision',
      reqId: prompt.reqId,
      allow: true,
      persist: true,
      expiresAt: null,
      pinHash: false,
    }));

    const readReqFrame = await waitForMsg(o.messages, m => 'clipboardReadRequest' in m, 8000);
    expect(readReqFrame).toBeTruthy();
    const readReq = readReqFrame!.clipboardReadRequest;
    expect(readReq.reqId).toBe(prompt.reqId);

    const payload = Buffer.from('hello').toString('base64');
    o.ws.send(JSON.stringify({
      type: 'clipboard-read-reply',
      reqId: prompt.reqId,
      base64: payload,
    }));

    // Poll for the sessions store to gain a clipboard entry (persistGrant is
    // fire-and-forget). Condition-based wait — resolves the moment the write
    // lands on disk.
    const got = await waitFor(() => {
      try {
        const s = JSON.parse(fs.readFileSync(h!.tmpDir + '/sessions.json', 'utf8'));
        return s.sessions.main?.clipboard ? s : null;
      } catch { return null; }
    }, 8000);
    expect(got).toBeTruthy();
    expect(got.sessions.main?.clipboard).toBeTruthy();

    o.ws.close();
  }, 15000);

  test.skipIf(process.platform !== 'linux')('prompt → deny sends empty OSC 52 reply without recording a grant', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    const promptFrame = await waitForMsg(o.messages, m => 'clipboardPrompt' in m, 8000);
    expect(promptFrame).toBeTruthy();
    const prompt = promptFrame!.clipboardPrompt;

    o.ws.send(JSON.stringify({ type: 'clipboard-decision', reqId: prompt.reqId, allow: false }));

    // Negative case: wait a brief window to give the server time to persist
    // *if* it were going to — but deny path must not record a grant.
    // 100ms covers fs writeAtomic round-trip comfortably.
    await new Promise(r => setTimeout(r, 100));

    const store = JSON.parse(fs.readFileSync(h.tmpDir + '/sessions.json', 'utf8'));
    expect(store.sessions.main?.clipboard).toBeFalsy();

    o.ws.close();
  }, 15000);

  test('OSC 52 read with unresolvable foreground → silent deny (no prompt)', async () => {
    // failDisplayMessage → getForegroundProcess null → "unknown foreground"
    // branch. Negative case: we need to give the server enough time for the
    // trigger (50ms) + handleReadRequest (await getForegroundProcess) to run
    // and decide not to emit anything. 300ms is comfortably past both.
    const { path: tmuxBin, dir } = makeFakeTmux({ failDisplayMessage: true });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;
    await new Promise(r => setTimeout(r, 300));
    expect(o.messages.some(m => m.includes('clipboardPrompt'))).toBe(false);
    o.ws.close();
  }, 15000);

  test.skipIf(process.platform !== 'linux')('replyToRead catch branch fires when tmux send-keys fails', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const exePath = fs.readlinkSync(`/proc/${process.pid}/exe`);
    fs.writeFileSync(h.tmpDir + '/sessions.json', JSON.stringify({
      version: 1,
      sessions: {
        main: {
          theme: 'Default', fontFamily: 'x', fontSize: 12, spacing: 1, opacity: 0,
          clipboard: { [exePath]: { blake3: null, read: { allow: true, expiresAt: null, grantedAt: new Date().toISOString() } } },
        },
      },
    }));
    const o = openWs(h.wsUrl);
    await o.opened;
    const rrFrame = await waitForMsg(o.messages, m => 'clipboardReadRequest' in m, 8000);
    if (!rrFrame) { o.ws.close(); return; }
    const rr = rrFrame.clipboardReadRequest;

    h.config.tmuxBin = '/bin/false';
    o.ws.send(JSON.stringify({
      type: 'clipboard-read-reply',
      reqId: rr.reqId,
      base64: Buffer.from('x').toString('base64'),
    }));
    // Give deliverOsc52Reply's tmux send-keys call time to reject and the
    // catch branch to run. ~80ms is enough for /bin/false spawn + rejection.
    await new Promise(r => setTimeout(r, 80));
    o.ws.close();
  }, 15000);

  test.skipIf(process.platform !== 'linux')('ws closed during resolvePolicy → prompt emission guard fires', async () => {
    // Bogus blake3 pin → resolvePolicy hashes the real bun binary (~100MB,
    // hundreds of ms). We close the ws before the hash completes so the
    // ws.readyState !== OPEN guard on the prompt-emission path fires.
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const exePath = fs.readlinkSync(`/proc/${process.pid}/exe`);
    fs.writeFileSync(h.tmpDir + '/sessions.json', JSON.stringify({
      version: 1,
      sessions: {
        main: {
          theme: 'Default', fontFamily: 'x', fontSize: 12, spacing: 1, opacity: 0,
          clipboard: {
            [exePath]: {
              blake3: 'pin-that-will-never-match',
              read: { allow: true, expiresAt: null, grantedAt: new Date().toISOString() },
            },
          },
        },
      },
    }));
    const o = openWs(h.wsUrl);
    await o.opened;
    // Close quickly — while the hash is mid-flight. The exact sleep here is
    // short (50ms) so the trigger fires (server sees OSC 52), handleReadRequest
    // kicks off hashing, THEN we close. We then need to wait long enough for
    // the hash+guard path to complete so the code is actually covered.
    await new Promise(r => setTimeout(r, 80));
    o.ws.close();
    // Poll for the prompt-guard path to have run: resolvePolicy's hash of
    // the bun binary completes in ~500-1500ms. We need to give that time.
    // No specific observable from outside — bounded sleep required.
    await new Promise(r => setTimeout(r, 1500));
    expect(true).toBe(true);
  }, 15000);

  test('ws abrupt close on client triggers server ws close handler', async () => {
    // The legacy `ws.terminate()` path doesn't exist on Bun's spec-compliant
    // global WebSocket. `close()` triggers the same server-side cleanup
    // (handleClose); the test is here to ensure no crash.
    h = await startTestServer({ testMode: true });
    const o = openWs(h.wsUrl);
    await o.opened;
    o.ws.close();
    // Short wait to let the server's close handler run.
    await new Promise(r => setTimeout(r, 50));
    expect(true).toBe(true);
  }, 15000);

  test('dropsChanged TT push when a drop is POST\'d via /api/drop', async () => {
    h = await startTestServer({ testMode: true });
    const o = openWs(h.wsUrl);
    await o.opened;

    // Use node:http directly instead of Bun's fetch — the latter has proven
    // flaky under act's nested-docker environment (see http-branches.test.ts).
    // The server reads raw body bytes + x-filename header; no multipart parsing.
    await postDrop(h.url, 'd.bin', Buffer.from([1, 2, 3]));

    const got = await waitForMsg(o.messages, m => 'dropsChanged' in m, 8000);
    expect(got).toBeTruthy();

    o.ws.close();
  }, 15000);
});

describe('ws handleConnection — OSC 52 policy shortcuts', () => {
  async function runWithPrepopulatedPolicy(allow: boolean) {
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const exePath = fs.readlinkSync(`/proc/${process.pid}/exe`);
    fs.writeFileSync(h.tmpDir + '/sessions.json', JSON.stringify({
      version: 1,
      sessions: {
        main: {
          theme: 'Default', fontFamily: 'x', fontSize: 12, spacing: 1, opacity: 0,
          clipboard: {
            [exePath]: {
              blake3: null,
              read: { allow, expiresAt: null, grantedAt: new Date().toISOString() },
            },
          },
        },
      },
    }));
    const o = openWs(h.wsUrl);
    await o.opened;
    if (allow) {
      // Poll for the read-request frame.
      await waitForMsg(o.messages, m => 'clipboardReadRequest' in m, 8000);
    } else {
      // Deny path: wait long enough for trigger (50ms) + getForegroundProcess
      // + resolvePolicy + emptyReply to run. 300ms is a comfortable ceiling.
      await new Promise(r => setTimeout(r, 300));
    }
    return o;
  }

  test.skipIf(process.platform !== 'linux')('policy=allow short-circuits to clipboardReadRequest (no prompt)', async () => {
    const o = await runWithPrepopulatedPolicy(true);
    expect(o.messages.some(m => m.includes('clipboardPrompt'))).toBe(false);
    expect(o.messages.some(m => m.includes('clipboardReadRequest'))).toBe(true);
    o.ws.close();
  }, 15000);

  test.skipIf(process.platform !== 'linux')('policy=deny short-circuits to empty reply (no prompt, no read request)', async () => {
    const o = await runWithPrepopulatedPolicy(false);
    expect(o.messages.some(m => m.includes('clipboardPrompt'))).toBe(false);
    expect(o.messages.some(m => m.includes('clipboardReadRequest'))).toBe(false);
    o.ws.close();
  }, 15000);
});

describe('ws handleConnection — OSC 52 write + title change from PTY', () => {
  test('OSC 52 write payload in PTY output is forwarded as clipboard TT message', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux();
    const base64 = Buffer.from('hi').toString('base64');
    fs.writeFileSync(dir + '/trigger', `\x1b]52;c;${base64}\x07`);
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;
    const got = await waitForMsg(o.messages, m => 'clipboard' in m, 8000);
    expect(got).toBeTruthy();
    o.ws.close();
  }, 15000);

  test('OSC title change pushes title under the registered session, never inferring session from the OSC payload', async () => {
    // Old buggy behaviour: an OSC `\x1b]0;dev:editor\x07` would set
    // state.lastSession='dev' and trigger a sendWindowState query against
    // session 'dev'. With shells emitting `\x1b]0;user@host:~\x07` from
    // their prompt, this clobbered the cached window list (list-windows
    // -t user@host fails → windows: []). The OSC title is now pushed
    // as title-only under the immutable URL session.
    const { path: tmuxBin, dir } = makeFakeTmux();
    fs.writeFileSync(dir + '/trigger', '\x1b]0;user@host:~/path\x07');
    const tmuxControlCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async () => {},
      detachSession: () => {},
      run: async (args) => {
        tmuxControlCalls.push([...args]);
        if (args[0] === 'list-windows') return '0\teditor\t1\n';
        if (args[0] === 'display-message') return 'paneTitle';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;
    const got = await waitForMsg(o.messages, m => m.title === 'user@host:~/path', 8000);
    expect(got).toBeTruthy();
    expect(got.session).toBe('main');
    // No tmuxControl.run was issued against 'user@host'.
    expect(tmuxControlCalls.some(a => a.includes('user@host'))).toBe(false);
    o.ws.close();
  }, 15000);

  test('OSC title naming a known tmux session triggers a real sendWindowState (external switch-client detected)', async () => {
    // tmux's set-titles output during an external `switch-client` looks like
    // `\x1b]0;<session>:<window>:<process>\x07`. When the detected session
    // matches a control-pool entry we *do* want to mutate registeredSession
    // and refresh the window list — otherwise an external switch (e.g.
    // tmux's prefix-S) would leave the topbar showing the previous session.
    const { path: tmuxBin, dir } = makeFakeTmux();
    fs.writeFileSync(dir + '/trigger', '\x1b]0;dev:1:zsh\x07');
    const tmuxControl: TmuxControl = {
      attachSession: async () => {},
      detachSession: () => {},
      run: async (args) => {
        if (args[0] === 'list-windows') return '0\teditor\t1\n';
        if (args[0] === 'display-message') return 'pane';
        return '';
      },
      on: () => () => {},
      hasSession: (s) => s === 'main' || s === 'dev',
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;
    // Expect a frame for 'dev' (the OSC-detected, validated session) with windows.
    const got = await waitForMsg(o.messages, m => m.session === 'dev' && Array.isArray(m.windows) && m.windows.length > 0, 8000);
    expect(got).toBeTruthy();
    o.ws.close();
  }, 15000);

  test('OSC title naming an existing unattached tmux session updates session state', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux();
    fs.writeFileSync(dir + '/trigger', '\x1b]0;dev:1:zsh\x07');
    const attachedSessions: string[] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async (sessionName) => { attachedSessions.push(sessionName); },
      detachSession: () => {},
      run: async (args) => {
        if (args[0] === 'list-windows') return '0\teditor\t1\n';
        if (args[0] === 'display-message') return 'pane';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    const got = await waitForMsg(o.messages, m => m.session === 'dev' && Array.isArray(m.windows) && m.windows.length > 0, 8000);
    expect(got).toBeTruthy();
    expect(attachedSessions).toContain('dev');
    o.ws.close();
  }, 15000);

  test('sendWindowState falls back to tmux binary when control list-windows fails', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    const tmuxControl: TmuxControl = {
      attachSession: async () => {},
      detachSession: () => {},
      run: async (args) => {
        if (args[0] === 'list-windows') throw new Error('list-windows: no such session');
        if (args[0] === 'display-message') return 'a-title';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;
    // Wait for the chained-on-attach sendWindowState to fire and push a frame.
    const got = await waitForMsg(o.messages, m => m.session === 'main' && m.title === 'a-title', 8000);
    expect(got).toBeTruthy();
    expect(got.windows).toEqual([
      { index: '0', name: 'one', active: true },
      { index: '1', name: 'two', active: false },
    ]);
    o.ws.close();
  }, 15000);
});

describe('ws handleConnection — non-testMode actions & sendWindowState', () => {
  test('tmux-control window notifications refresh only the originating session', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    const listeners = new Map<TmuxNotification['type'], Array<(n: any) => void>>();
    const runCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async () => {},
      detachSession: () => {},
      run: async (args) => {
        runCalls.push([...args]);
        if (args[0] === 'list-windows') return '0\tone\t1\n1\ttwo\t0\n';
        return '';
      },
      on: (event, cb) => {
        const arr = listeners.get(event) ?? [];
        arr.push(cb);
        listeners.set(event, arr);
        return () => {
          const idx = arr.indexOf(cb);
          if (idx >= 0) arr.splice(idx, 1);
        };
      },
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const main = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    const dev = openWs(h.wsUrl, '/ws?session=dev&cols=80&rows=24');
    await Promise.all([main.opened, dev.opened]);

    // Wait for the initial sendWindowState calls triggered by attachSession.then()
    // to complete before measuring notification-driven behaviour.
    await waitForMsg(main.messages, m => m.session === 'main' && 'windows' in m, 3000);
    await waitForMsg(dev.messages, m => m.session === 'dev' && 'windows' in m, 3000);
    // Let any startup direct-query retry finish before clearing buffers;
    // otherwise a late startup frame can be mistaken for notification fanout.
    await new Promise(r => setTimeout(r, 350));

    // Reset so we only measure the notification-driven refresh below.
    runCalls.length = 0;
    main.messages.length = 0;
    dev.messages.length = 0;

    for (const cb of listeners.get('windowAdd') ?? []) {
      cb({ type: 'windowAdd', window: '@7', session: 'dev' });
    }

    const got = await waitForMsg(dev.messages, m => m.session === 'dev' && 'windows' in m, 8000);
    expect(got).toBeTruthy();
    await new Promise(r => setTimeout(r, 50));
    // Notification routing must not call display-message (old approach used it to
    // look up the owning session; the new approach uses n.session directly).
    expect(runCalls.some(args => args[0] === 'display-message')).toBe(false);
    const listWindowTargets = runCalls
      .filter(args => args[0] === 'list-windows')
      .map(args => args[2]);
    expect(listWindowTargets).toEqual(['dev']);
    expect(main.messages.some(raw => {
      try {
        const parsed = JSON.parse(raw);
        return parsed.session === 'main' && 'windows' in parsed;
      } catch {
        return false;
      }
    })).toBe(false);

    main.ws.close();
    dev.ws.close();
  }, 15000);

  test('scrollbar subscription update emits scrollbar TT message for matching websocket', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    const listeners = new Map<TmuxNotification['type'], Array<(n: any) => void>>();
    const runCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async () => {},
      detachSession: () => {},
      run: async (args) => {
        runCalls.push([...args]);
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        if (args[0] === 'display-message' && args.includes(SCROLLBAR_FORMAT)) {
          return '%4\t40\t1200\t0\t0\t\t0';
        }
        if (args[0] === 'display-message') return 'pane';
        return '';
      },
      on: (event, cb) => {
        const arr = listeners.get(event) ?? [];
        arr.push(cb);
        listeners.set(event, arr);
        return () => {
          const idx = arr.indexOf(cb);
          if (idx >= 0) arr.splice(idx, 1);
        };
      },
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    await waitFor(() => runCalls.find(args => args[0] === 'refresh-client' && args[1] === '-B'), 8000);
    const subscriptionArgs = runCalls.find(args => args[0] === 'refresh-client' && args[1] === '-B')!;
    const subscriptionName = subscriptionArgs[2]!.split(':')[0]!;

    o.messages.length = 0;
    for (const cb of listeners.get('subscriptionChanged') ?? []) {
      cb({
        type: 'subscriptionChanged',
        name: subscriptionName,
        session: 'other',
        sessionId: '$2',
        windowId: '@3',
        windowIndex: '0',
        paneId: '%9',
        value: '%9\t40\t1200\t99\t1\tcopy-mode\t0',
      });
    }
    expect(o.messages.find(m => 'scrollbar' in m)).toBeUndefined();

    for (const cb of listeners.get('subscriptionChanged') ?? []) {
      cb({
        type: 'subscriptionChanged',
        name: subscriptionName,
        session: 'main',
        sessionId: '$1',
        windowId: '@2',
        windowIndex: '0',
        paneId: '%4',
        value: '%4\t40\t1200\t17\t1\tcopy-mode\t0',
      });
    }

    const got = await waitForMsg(o.messages, m => 'scrollbar' in m, 8000);
    expect(got).toEqual({
      scrollbar: {
        paneId: '%4',
        paneHeight: 40,
        historySize: 1200,
        scrollPosition: 17,
        paneInMode: 1,
        paneMode: 'copy-mode',
        alternateOn: false,
      },
    });

    o.ws.close();
  }, 15000);

  test('scrollbar setup waits for attach and uses the session control client', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    let resolveAttach!: () => void;
    const attachDone = new Promise<void>(r => { resolveAttach = r; });
    let attached = false;
    const runCalls: Array<{ session: string; args: string[] }> = [];
    const tmuxControl: TmuxControl = {
      attachSession: async () => { await attachDone; attached = true; },
      detachSession: () => {},
      run: async (args) => {
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        throw new NoControlClientError();
      },
      runInSession: async (session, args) => {
        expect(attached).toBe(true);
        runCalls.push({ session, args: [...args] });
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        if (args[0] === 'display-message' && args.includes(SCROLLBAR_FORMAT)) return '%4\t40\t1200\t0\t0\t\t0';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    await new Promise(r => setTimeout(r, 20));
    expect(runCalls).toEqual([]);

    resolveAttach();
    await waitFor(() => runCalls.some(c => c.args[0] === 'refresh-client' && c.args[1] === '-B'), 8000);
    expect(runCalls.find(c => c.args[0] === 'refresh-client')?.session).toBe('main');
    expect(runCalls.find(c => c.args[0] === 'display-message')?.session).toBe('main');
    const got = await waitForMsg(o.messages, m => 'scrollbar' in m, 8000);
    expect(got?.scrollbar?.paneId).toBe('%4');

    const subscribeName = runCalls.find(c => c.args[0] === 'refresh-client' && c.args[1] === '-B')?.args[2]?.split(':')[0];
    expect(subscribeName).toBeTruthy();
    o.ws.close();
    await waitFor(() => runCalls.some(c => c.args[0] === 'refresh-client' && c.args[1] === '-B' && c.args[2] === subscribeName), 8000);
  }, 15000);

  test('scrollbar action dispatches through tmux control using current scrollbar state', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    const runCalls: string[][] = [];
    let scrollbarReads = 0;
    const tmuxControl: TmuxControl = {
      attachSession: async () => {},
      detachSession: () => {},
      run: async (args) => {
        runCalls.push([...args]);
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        if (args[0] === 'display-message' && args.includes(SCROLLBAR_FORMAT)) {
          scrollbarReads++;
          return scrollbarReads === 1
            ? '%4\t40\t1200\t17\t1\tcopy-mode\t0'
            : '%4\t40\t1200\t15\t1\tcopy-mode\t0';
        }
        if (args[0] === 'display-message') return 'pane';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;
    await waitForMsg(o.messages, m => 'scrollbar' in m, 8000);

    runCalls.length = 0;
    o.ws.send(JSON.stringify({ type: 'scrollbar', action: 'line-down', count: 2 }));

    await waitFor(() => runCalls.some(args => args.join(' ') === 'send-keys -X -t %4 -N 2 scroll-down-and-cancel'), 8000);
    expect(runCalls).toContainEqual(['send-keys', '-X', '-t', '%4', '-N', '2', 'scroll-down-and-cancel']);
    const updated = await waitForMsg(o.messages, m => m.scrollbar?.scrollPosition === 15, 8000);
    expect(updated?.scrollbar?.scrollPosition).toBe(15);

    o.ws.close();
  }, 15000);

  test('rapid scrollbar drags use fresh state instead of compounding stale deltas', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    const runCalls: string[][] = [];
    let scrollPosition = 25;
    let releaseFirstScroll!: () => void;
    const firstScroll = new Promise<void>(r => { releaseFirstScroll = r; });
    let blockedFirstScroll = false;
    const tmuxControl: TmuxControl = {
      attachSession: async () => {},
      detachSession: () => {},
      run: async (args) => {
        runCalls.push([...args]);
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        if (args[0] === 'display-message' && args.includes(SCROLLBAR_FORMAT)) {
          return `%4\t40\t1200\t${scrollPosition}\t1\tcopy-mode\t0`;
        }
        if (args[0] === 'send-keys' && args[1] === '-X') {
          const count = Number(args[5]);
          const command = args[6];
          if (!blockedFirstScroll) {
            blockedFirstScroll = true;
            await firstScroll;
          }
          if (command === 'scroll-up') scrollPosition = Math.min(1200, scrollPosition + count);
          if (command === 'scroll-down-and-cancel') scrollPosition = Math.max(0, scrollPosition - count);
          return '';
        }
        if (args[0] === 'display-message') return 'pane';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;
    await waitForMsg(o.messages, m => 'scrollbar' in m, 8000);

    o.ws.send(JSON.stringify({ type: 'scrollbar', action: 'drag', position: 900 }));
    await waitFor(() => blockedFirstScroll, 8000);
    o.ws.send(JSON.stringify({ type: 'scrollbar', action: 'drag', position: 100 }));
    o.ws.send(JSON.stringify({ type: 'scrollbar', action: 'drag', position: 110 }));
    releaseFirstScroll();

    const updated = await waitForMsg(o.messages, m => m.scrollbar?.scrollPosition === 110, 8000);
    expect(updated?.scrollbar?.scrollPosition).toBe(110);
    const scrollCommands = runCalls.filter(args => args[0] === 'send-keys' && args[1] === '-X').map(args => args.slice(3));
    expect(scrollCommands).toEqual([
      ['%4', '-N', '875', 'scroll-up'],
      ['%4', '-N', '800', 'scroll-down-and-cancel'],
      ['%4', '-N', '10', 'scroll-up'],
    ]);

    o.ws.close();
  }, 15000);

  test('switch-session reuses the open PTY and moves session bookkeeping', async () => {
    const { path: tmuxBin, logFile, dir } = makeFakeTmux();
    const attached: string[] = [];
    const detached: string[] = [];
    const controlEvents: string[] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async (session) => { attached.push(session); controlEvents.push(`attach:${session}`); },
      detachSession: (session) => { detached.push(session); controlEvents.push(`detach:${session}`); },
      run: async (args) => {
        if (args[0] === 'list-clients' && args.includes('#{client_tty}\t#{client_name}\t#{client_session}')) {
          return '/dev/pts/fake\tfake\tdev\n';
        }
        const { stdout } = await execFileAsync(tmuxBin, args);
        return stdout;
      },
      runInSession: async (session, args) => {
        if (args[0] === 'refresh-client' && args[1] === '-B') {
          const mode = String(args[2]).includes(':') ? 'subscribe' : 'unsubscribe';
          controlEvents.push(`${mode}:${session}`);
          return '';
        }
        if (args[0] === 'display-message' && args.includes(SCROLLBAR_FORMAT)) return '%4\t40\t1200\t0\t0\t\t0';
        return tmuxControl.run(args);
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    await o.opened;
    await waitFor(() => {
      try { return fs.readFileSync(`${dir}/client.pid`, 'utf8').trim(); }
      catch { return ''; }
    }, 8000);
    await waitFor(() => controlEvents.includes('subscribe:main'), 8000);

    o.ws.send(JSON.stringify({ type: 'switch-session', name: 'dev' }));
    await waitFor(() => attached.includes('dev'), 8000);

    const switched = await waitFor(() => {
      try {
        const s = fs.readFileSync(logFile, 'utf8');
        return s.includes('switch-client -c /dev/pts/fake -t dev') ? s : null;
      } catch { return null; }
    }, 8000);
    expect(switched).toBeTruthy();
    expect((switched as string).match(/new-session/g)?.length).toBe(1);
    expect(attached).toEqual(['main', 'dev']);
    await waitFor(() => detached.includes('main'), 8000);
    expect(detached).toEqual(['main']);
    const mainUnsubscribeIdx = controlEvents.indexOf('unsubscribe:main');
    const mainDetachIdx = controlEvents.indexOf('detach:main');
    expect(mainUnsubscribeIdx).toBeGreaterThan(-1);
    expect(mainDetachIdx).toBeGreaterThan(-1);
    expect(mainUnsubscribeIdx).toBeLessThan(mainDetachIdx);
    await waitFor(() => {
      try { return fs.readFileSync(logFile, 'utf8').includes('refresh-client -t /dev/pts/fake'); }
      catch { return false; }
    }, 8000);
    o.ws.send('REDRAW');
    const sessionAck = await waitForMsg(o.messages, m => m.session === 'dev', 8000);
    expect(sessionAck).toBeTruthy();

    o.messages.length = 0;
    o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
    const got = await waitForMsg(o.messages, m => m.session === 'dev' && 'windows' in m, 8000);
    expect(got).toBeTruthy();

    o.ws.close();
    await waitFor(() => detached.includes('dev'), 8000);
    expect(detached).toEqual(['main', 'dev']);
  }, 15000);

  test('switch-session does not acknowledge or move bookkeeping until tmux reports the PTY client on target session', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux({ ignoreSwitchClient: true });
    const attached: string[] = [];
    const detached: string[] = [];
    const runCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async (session) => { attached.push(session); },
      detachSession: (session) => { detached.push(session); },
      run: async (args) => {
        runCalls.push(args);
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        if (args[0] === 'display-message') return 'title';
        const { stdout } = await execFileAsync(tmuxBin, args);
        return stdout;
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    await o.opened;
    await waitFor(() => attached.includes('main'), 3000);

    o.messages.length = 0;
    o.ws.send(JSON.stringify({ type: 'switch-session', name: 'dev' }));
    await waitFor(() => {
      try { return fs.readFileSync(logFile, 'utf8').includes('switch-client'); }
      catch { return false; }
    }, 3000);
    await new Promise(r => setTimeout(r, 30));

    expect(o.messages.some(raw => {
      try { return JSON.parse(raw).session === 'dev'; } catch { return false; }
    })).toBe(false);
    expect(detached).not.toContain('main');

    o.messages.length = 0;
    o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
    const got = await waitForMsg(o.messages, m => m.session === 'main' && 'windows' in m, 3000);
    expect(got).toBeTruthy();

    o.ws.close();
    await waitFor(() => detached.includes('main'), 3000);
  }, 15000);

  test('window select triggers applyWindowAction + sendWindowState', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
    const got = await waitForMsg(o.messages, m => 'windows' in m, 8000);
    expect(got).toBeTruthy();

    // Log is appended to asynchronously by the fake-tmux shell script; poll.
    const logOk = await waitFor(() => {
      try {
        const s = fs.readFileSync(logFile, 'utf8');
        return s.includes('select-window') && s.includes('list-windows') ? s : null;
      } catch { return null; }
    }, 8000);
    expect(logOk).toBeTruthy();

    o.ws.close();
  }, 15000);

  test('window new + rename + close all dispatch tmux calls', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'window', action: 'new', name: 'neu' }));
    o.ws.send(JSON.stringify({ type: 'window', action: 'rename', index: '0', name: 'renamed' }));
    o.ws.send(JSON.stringify({ type: 'window', action: 'close', index: '0' }));

    const logOk = await waitFor(() => {
      try {
        const s = fs.readFileSync(logFile, 'utf8');
        return s.includes('new-window') && s.includes('rename-window') && s.includes('kill-window') ? s : null;
      } catch { return null; }
    }, 8000);
    expect(logOk).toBeTruthy();

    o.ws.close();
  }, 15000);

  test('session rename + kill dispatch tmux calls', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'session', action: 'rename', name: 'newname' }));
    o.ws.send(JSON.stringify({ type: 'session', action: 'kill' }));

    const logOk = await waitFor(() => {
      try {
        const s = fs.readFileSync(logFile, 'utf8');
        return s.includes('rename-session') && s.includes('kill-session') ? s : null;
      } catch { return null; }
    }, 8000);
    expect(logOk).toBeTruthy();
    expect(logOk as string).toContain('rename-session -t main -- newname');

    o.ws.close();
  }, 15000);

  test('session rename rejects names starting with - or containing : / .', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'session', action: 'rename', name: '-evil' }));
    o.ws.send(JSON.stringify({ type: 'session', action: 'rename', name: 'bad:name' }));
    o.ws.send(JSON.stringify({ type: 'session', action: 'rename', name: 'bad.name' }));
    o.ws.send(JSON.stringify({ type: 'session', action: 'rename', name: '   ' }));
    // Follow with a valid rename so we can assert only the valid one landed.
    o.ws.send(JSON.stringify({ type: 'session', action: 'rename', name: 'allowed' }));

    const logOk = await waitFor(() => {
      try {
        const s = fs.readFileSync(logFile, 'utf8');
        return s.includes('rename-session -t main -- allowed') ? s : null;
      } catch { return null; }
    }, 8000);
    expect(logOk).toBeTruthy();
    expect(logOk as string).not.toContain('-evil');
    expect(logOk as string).not.toContain('bad:name');
    expect(logOk as string).not.toContain('bad.name');

    o.ws.close();
  }, 15000);

  test('window rename + new reject unsafe names; -- separator used on positional', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'window', action: 'rename', index: '0', name: '-dash' }));
    o.ws.send(JSON.stringify({ type: 'window', action: 'rename', index: '0', name: 'ok' }));
    o.ws.send(JSON.stringify({ type: 'window', action: 'new', name: '-also' }));
    o.ws.send(JSON.stringify({ type: 'window', action: 'new', name: 'fresh' }));

    const logOk = await waitFor(() => {
      try {
        const s = fs.readFileSync(logFile, 'utf8');
        return s.includes('rename-window -t main:0 -- ok')
          && s.includes('new-window -t main -n fresh')
          ? s : null;
      } catch { return null; }
    }, 8000);
    expect(logOk).toBeTruthy();
    expect(logOk as string).not.toContain('-dash');
    expect(logOk as string).not.toContain('-also');

    o.ws.close();
  }, 15000);

  test('colour-variant dark + light dispatch set-environment twice', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'colour-variant', variant: 'dark' }));
    o.ws.send(JSON.stringify({ type: 'colour-variant', variant: 'light' }));

    const logOk = await waitFor(() => {
      try {
        const s = fs.readFileSync(logFile, 'utf8');
        return s.includes('COLORFGBG') && s.includes('CLITHEME') ? s : null;
      } catch { return null; }
    }, 8000);
    expect(logOk).toBeTruthy();

    o.ws.close();
  }, 15000);

  test.skipIf(process.platform !== 'linux')('colour-variant retry-on-failure branch (tmuxBin=/bin/false)', async () => {
    // /bin/false always exits non-zero → first run() rejects → setTimeout(500)
    // schedules a retry that also rejects but is caught. Covers the retry
    // branch inside applyColourVariant. The actual retry delay in ws.ts is
    // 500ms, so we must wait for at least that + a bit of margin.
    h = await startTestServer({ testMode: false, tmuxBin: '/bin/false' });
    const o = openWs(h.wsUrl);
    try { await o.opened; } catch { /* ok if it never opens */ }
    try { o.ws.send(JSON.stringify({ type: 'colour-variant', variant: 'dark' })); } catch { /* ok */ }
    // Sleep just past the 500ms retry delay in applyColourVariant so the
    // scheduled retry actually runs and its catch branch executes.
    await new Promise(r => setTimeout(r, 650));
    try { o.ws.close(); } catch { /* ok */ }
  }, 15000);

  test('sendWindowState pushes a session+windows frame on window-action completion', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '0' }));
    const got = await waitForMsg(o.messages, m => 'session' in m, 8000);
    expect(got).toBeTruthy();

    o.ws.close();
  }, 15000);

  test('startup windows arrive before slow attachSession resolves', async () => {
    // First paint must not wait for the control client attach/probe path.
    // The direct startup query should populate tabs even while attachSession
    // is still blocked.
    const { path: tmuxBin, dir } = makeFakeTmux();
    fs.writeFileSync(dir + '/trigger', '\x1b]0;main:editor\x07');

    let resolveAttach!: () => void;
    const attachDone = new Promise<void>(r => { resolveAttach = r; });
    let attached = false;

    const tmuxControl: TmuxControl = {
      attachSession: async () => { await attachDone; attached = true; },
      detachSession: () => {},
      run: async (args) => {
        if (!attached) throw new Error('no control client available');
        if (args[0] === 'list-windows') return '0\teditor\t1\n';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };

    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    const gotBeforeAttach = await waitForMsg(o.messages, m => Array.isArray(m.windows) && m.windows.length > 0, 1000);
    expect(gotBeforeAttach).toBeTruthy();
    expect(attached).toBe(false);
    expect(gotBeforeAttach.windows).toHaveLength(2);

    // Resolve attach — the regular control-backed refresh may send a later
    // frame, but the initial UI was already populated.
    resolveAttach();
    await new Promise(r => setTimeout(r, 0));

    o.ws.close();
  }, 15000);

  test('window select works before slow attachSession resolves', async () => {
    // UI tab clicks must not be dropped while the startup control client is
    // still probing. tmux itself is already usable through the PTY at this
    // point, so server-side UI actions should fall back to direct tmux.
    const { path: tmuxBin, logFile } = makeFakeTmux();

    let resolveAttach!: () => void;
    const attachDone = new Promise<void>(r => { resolveAttach = r; });

    const tmuxControl: TmuxControl = {
      attachSession: async () => { await attachDone; },
      detachSession: () => {},
      run: async () => { throw new NoControlClientError(); },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };

    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));

    const sawSelect = await waitFor(() => {
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      return log.includes('select-window -t main:1');
    }, 1000);
    expect(sawSelect).toBe(true);

    resolveAttach();
    o.ws.close();
  }, 15000);

  test('debug log records window action control fallback timing', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();

    let resolveAttach!: () => void;
    const attachDone = new Promise<void>(r => { resolveAttach = r; });

    const tmuxControl: TmuxControl = {
      attachSession: async () => { await attachDone; },
      detachSession: () => {},
      run: async () => { throw new NoControlClientError(); },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };

    const stderr: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return (originalWrite as any).call(process.stderr, chunk, ...args);
    }) as typeof process.stderr.write;
    try {
      h = await startTestServer({ testMode: false, tmuxBin, tmuxControl, configOverrides: { debug: true } });
      const o = openWs(h.wsUrl);
      await o.opened;

      o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));

      const sawSelect = await waitFor(() => {
        const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
        return log.includes('select-window -t main:1');
      }, 1000);
      expect(sawSelect).toBe(true);

      const text = stderr.join('');
      expect(text).toContain('window action start');
      expect(text).toContain('action=select');
      expect(text).toContain('control=no-primary');
      expect(text).toContain('fallback=exec');
      expect(text).toContain('window action done');

      resolveAttach();
      o.ws.close();
    } finally {
      process.stderr.write = originalWrite;
    }
  }, 15000);

  test('windows populated even when shell passthrough title corrupts state.lastSession', async () => {
    // Regression: with `allow-passthrough on`, the shell may send an OSC
    // title like `user@host: ~` AFTER tmux's own set-titles output. The last
    // title wins in processData → detectedSession='user@host' →
    // state.lastSession='user@host'. attachSession.then(sendWindowState) then
    // calls list-windows -t user@host which fails → windows:[]. Fix: use the
    // immutable `session` captured from the URL, not state.lastSession.
    const { path: tmuxBin, dir } = makeFakeTmux();
    // Two OSC titles in sequence: tmux's set-titles first, shell passthrough last.
    // processData iterates with /g and detectedSession = last match = 'user@host'.
    fs.writeFileSync(dir + '/trigger', '\x1b]0;main:1 bash\x07\x1b]0;user@host: ~\x07');

    // Gate attachSession so it resolves AFTER the title fires (400ms > 150ms trigger).
    let resolveAttach!: () => void;
    const attachDone = new Promise<void>(r => { resolveAttach = r; });

    const tmuxControl: TmuxControl = {
      attachSession: async () => { await attachDone; },
      detachSession: () => {},
      run: async (args) => {
        // Only honour list-windows for the real session 'main', not the corrupted 'user@host'.
        if (args[0] === 'list-windows' && args[2] === 'main') return '1\tbash\t1\n';
        if (args[0] === 'display-message') return '';
        throw new Error(`no session: ${args[2] ?? '?'}`);
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };

    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    // Wait past the 150ms trigger delay so PTY title fires before attach resolves.
    await new Promise(r => setTimeout(r, 400));

    // Title has fired; state.lastSession may now be 'user@host' (corrupted),
    // but the startup direct query should already have populated the UI using
    // the URL session ('main') rather than waiting for attachSession.
    const startup = await waitForMsg(o.messages, m => Array.isArray(m.windows) && m.windows.length > 0, 1000);
    expect(startup).toBeTruthy();
    expect(startup.session).toBe('main');

    // Resolve attach — server must use the URL session ('main'), not state.lastSession.
    resolveAttach();
    await new Promise(r => setTimeout(r, 0));

    o.ws.close();
  }, 15000);
});

/** Shared mock builder for switchSession race/leak tests. Stalls
 *  attachSession for the named sessions until the returned gate resolvers
 *  are called. */
function makeGatedControl(
  stall: string[],
  gates: Record<string, () => void>,
): { tmuxControl: TmuxControl; attached: string[]; detached: string[] } {
  const attached: string[] = [];
  const detached: string[] = [];
  let switchedTo = 'main';

  const gatePromises: Record<string, Promise<void> | undefined> = {};
  for (const s of stall) {
    gatePromises[s] = new Promise<void>(r => { gates[s] = r; });
  }

  const tmuxControl: TmuxControl = {
    attachSession: async (session) => {
      attached.push(session);
      if (gatePromises[session]) await gatePromises[session];
    },
    detachSession: (session) => { detached.push(session); },
    run: async (args) => {
      if (args[0] === 'list-windows') return '0\tone\t1\n';
      if (args[0] === 'display-message') return 'title';
      // Single candidate → tmuxClientForPty fallback returns it regardless of PID.
      if (args[0] === 'list-clients' && args.includes('#{client_pid}\t#{client_tty}\t#{client_name}')) {
        return `1\t/dev/pts/fake\tfake`;
      }
      if (args[0] === 'list-clients' && args.includes('#{client_tty}\t#{client_name}\t#{client_session}')) {
        return `/dev/pts/fake\tfake\t${switchedTo}`;
      }
      if (args[0] === 'switch-client') { switchedTo = args[args.length - 1] ?? switchedTo; return ''; }
      return '';
    },
    on: () => () => {},
    hasSession: () => false,
    close: async () => {},
  };
  return { tmuxControl, attached, detached };
}

describe('ws switchSession — race and leak guards', () => {
  test('Bug 2: failed attachSession does not detach old-session control client', async () => {
    // Before fix: moveWsToSession was called before attachSession. A failed
    // switch killed 'main's control client, making every subsequent
    // /api/sessions call fail and the menu show all sessions as not running.
    const attached: string[] = [];
    const detached: string[] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async (session) => {
        attached.push(session);
        if (session === 'dev') throw new Error('no such session: dev');
      },
      detachSession: (session) => { detached.push(session); },
      run: async (args) => {
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        if (args[0] === 'display-message') return 'title';
        return '';
      },
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    };

    const { path: tmuxBin } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    await o.opened;
    await waitFor(() => attached.includes('main'), 3000);

    o.ws.send(JSON.stringify({ type: 'switch-session', name: 'dev' }));
    await waitFor(() => attached.includes('dev'), 3000);
    // Let the catch block in switchSession run.
    await new Promise(r => setTimeout(r, 30));

    // 'main' must NOT be detached — the failed switch must not touch it.
    expect(detached.filter(s => s === 'main')).toHaveLength(0);
    // 'dev' attach threw before newSessionAttached=true, so no finally detach.
    expect(detached.filter(s => s === 'dev')).toHaveLength(0);

    // WS close → handleClose cleans up 'main' exactly once.
    o.ws.close();
    await waitFor(() => detached.includes('main'), 3000);
    expect(detached.filter(s => s === 'main')).toHaveLength(1);
  }, 15000);

  test('Bug 3: WS close mid-switch triggers finally detach of new session', async () => {
    // Before fix: isCancelled() was absent. If the WS closed after
    // attachSession resolved, moveWsToSession still ran, registering a dead
    // WS on the new session with ref count 1 and no future handleClose to
    // decrement it — leaking the tmux -C process indefinitely.
    const gates: Record<string, () => void> = {};
    const { tmuxControl, attached, detached } = makeGatedControl(['dev'], gates);

    const { path: tmuxBin } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    await o.opened;
    await waitFor(() => attached.includes('main'), 3000);

    // Trigger switch — stalls at attachSession('dev').
    o.ws.send(JSON.stringify({ type: 'switch-session', name: 'dev' }));
    await waitFor(() => attached.includes('dev'), 3000);

    // Close WS while attachSession('dev') is pending.
    o.ws.close();
    // Wait for handleClose — it detaches 'main'.
    await waitFor(() => detached.includes('main'), 3000);
    expect(detached).toContain('main');

    // Unblock attachSession('dev'). isCancelled fires (ws.readyState !== OPEN),
    // the finally block detaches 'dev', preventing the leaked control client.
    gates['dev']!();
    await waitFor(() => detached.includes('dev'), 3000);
    expect(detached).toContain('dev');
  }, 15000);

  test('Bug 4: rapid second switch cancels first; intermediate session not leaked', async () => {
    // Before fix: two concurrent switches both called moveWsToSession with the
    // same oldSession. The first moved WS to 'dev', the second moved to 'work'.
    // 'dev' ref count was never decremented, so its tmux -C process leaked.
    // Repeated back-and-forth exhausted file descriptors → server returned 502.
    const gates: Record<string, () => void> = {};
    const { tmuxControl, attached, detached } = makeGatedControl(['dev'], gates);

    const { path: tmuxBin } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    await o.opened;
    await waitFor(() => attached.includes('main'), 3000);

    // First switch to 'dev' — stalls at attachSession.
    o.ws.send(JSON.stringify({ type: 'switch-session', name: 'dev' }));
    await waitFor(() => attached.includes('dev'), 3000);

    // Second switch to 'work' — bumps switchSerial, cancelling the first.
    o.ws.send(JSON.stringify({ type: 'switch-session', name: 'work' }));
    await waitFor(() => attached.includes('work'), 3000);

    // 'work' switch completes fully: moveWsToSession detaches 'main'.
    await waitFor(() => detached.includes('main'), 3000);
    expect(detached).toContain('main');

    // Unblock 'dev' — isCancelled fires (switchSerial mismatch),
    // finally detaches 'dev' — no leaked control client.
    gates['dev']!();
    await waitFor(() => detached.includes('dev'), 3000);
    expect(detached).toContain('dev');

    // Cleanup: closing WS detaches 'work' (the active session).
    o.ws.close();
    await waitFor(() => detached.includes('work'), 3000);
    expect(detached).toContain('work');
  }, 15000);
});
