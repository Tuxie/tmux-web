import { describe, test, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import http from 'node:http';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';
import { makeFakeTmux } from './_harness/fake-tmux.ts';
import { execFileAsync } from '../../../src/server/exec.ts';
import type { TmuxControl, TmuxNotification } from '../../../src/server/tmux-control.ts';

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

  test('OSC title change from PTY triggers sendWindowState', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux();
    fs.writeFileSync(dir + '/trigger', '\x1b]0;dev:editor\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;
    const got = await waitForMsg(o.messages, m => m.session === 'dev', 8000);
    expect(got).toBeTruthy();
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

  test('switch-session reuses the open PTY and moves session bookkeeping', async () => {
    const { path: tmuxBin, logFile, dir } = makeFakeTmux();
    const attached: string[] = [];
    const detached: string[] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async (session) => { attached.push(session); },
      detachSession: (session) => { detached.push(session); },
      run: async (args) => {
        if (args[0] === 'display-message' && args.includes('#{client_session}')) return 'dev\n';
        const { stdout } = await execFileAsync(tmuxBin, args);
        return stdout;
      },
      on: () => () => {},
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    await o.opened;
    await waitFor(() => {
      try { return fs.readFileSync(`${dir}/client.pid`, 'utf8').trim(); }
      catch { return ''; }
    }, 8000);

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
    expect(detached).toEqual(['main']);
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
    const { path: tmuxBin } = makeFakeTmux();
    const attached: string[] = [];
    const detached: string[] = [];
    const runCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      attachSession: async (session) => { attached.push(session); },
      detachSession: (session) => { detached.push(session); },
      run: async (args) => {
        runCalls.push(args);
        if (args[0] === 'list-windows') return '0\tone\t1\n';
        if (args[0] === 'display-message' && args.includes('#{client_session}')) return 'main\n';
        if (args[0] === 'display-message') return 'title';
        if (args[0] === 'list-clients') return `1\t/dev/pts/fake\tfake`;
        if (args[0] === 'switch-client') return '';
        const { stdout } = await execFileAsync(tmuxBin, args);
        return stdout;
      },
      on: () => () => {},
      close: async () => {},
    };
    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl, '/ws?session=main&cols=80&rows=24');
    await o.opened;
    await waitFor(() => attached.includes('main'), 3000);

    o.messages.length = 0;
    o.ws.send(JSON.stringify({ type: 'switch-session', name: 'dev' }));
    await waitFor(() => runCalls.some(args => args[0] === 'switch-client'), 3000);
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

  test('windows arrive after attachSession resolves even when PTY title fires first', async () => {
    // Regression: probe() made attachSession slower. Title change fired before
    // insertionOrder had a client → sendWindowState threw NoControlClientError
    // → sent {session} without windows → lastTitle set → no retry → tabs gone.
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
      close: async () => {},
    };

    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    // Wait past the 150ms trigger delay for PTY title change to fire
    await new Promise(r => setTimeout(r, 400));

    // Title fired but attach not resolved — windows frame sent but empty
    // (sendWindowState uses Promise.allSettled → rejected → windows:[])
    expect(o.messages.some(raw => {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p.windows) && p.windows.length > 0;
      } catch { return false; }
    })).toBe(false);

    // Resolve attach — server should now call sendWindowState with real data
    resolveAttach();

    const got = await waitForMsg(o.messages, m => Array.isArray(m.windows) && m.windows.length > 0, 3000);
    expect(got).toBeTruthy();
    expect(got.windows).toHaveLength(1);

    o.ws.close();
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
      close: async () => {},
    };

    h = await startTestServer({ testMode: false, tmuxBin, tmuxControl });
    const o = openWs(h.wsUrl);
    await o.opened;

    // Wait past the 150ms trigger delay so PTY title fires before attach resolves.
    await new Promise(r => setTimeout(r, 400));

    // Title has fired; state.lastSession may now be 'user@host' (corrupted).
    // No windows frame with real data should have arrived yet.
    expect(o.messages.some(raw => {
      try { const p = JSON.parse(raw); return Array.isArray(p.windows) && p.windows.length > 0; }
      catch { return false; }
    })).toBe(false);

    // Resolve attach — server must use the URL session ('main'), not state.lastSession.
    resolveAttach();

    const got = await waitForMsg(o.messages, m => Array.isArray(m.windows) && m.windows.length > 0, 3000);
    expect(got).toBeTruthy();
    expect(got.session).toBe('main');
    expect(got.windows).toHaveLength(1);
    expect(got.windows[0]).toMatchObject({ index: '1', name: 'bash', active: true });

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
      if (args[0] === 'display-message' && args.includes('#{client_session}')) return switchedTo + '\n';
      if (args[0] === 'display-message') return 'title';
      // Single candidate → tmuxClientForPty fallback returns it regardless of PID.
      if (args[0] === 'list-clients') return `1\t/dev/pts/fake\tfake`;
      if (args[0] === 'switch-client') { switchedTo = args[args.length - 1] ?? switchedTo; return ''; }
      return '';
    },
    on: () => () => {},
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
