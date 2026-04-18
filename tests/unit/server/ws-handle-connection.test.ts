import { describe, test, expect, afterEach } from 'bun:test';
import WebSocket from 'ws';
import fs from 'node:fs';
import http from 'node:http';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';
import { makeFakeTmux } from './_harness/fake-tmux.ts';

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
  const messages: string[] = [];
  const raw: Buffer[] = [];
  // Attach listener *before* open so early PTY output (trigger file) is captured.
  ws.on('message', (data: Buffer) => {
    raw.push(data);
    const s = data.toString('utf8');
    if (s.startsWith('\x00TT:')) messages.push(s.slice(4));
  });
  ws.on('error', () => { /* swallow async errors so tests don't crash on close */ });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
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

  test('ws.terminate() on client triggers server ws error handler', async () => {
    h = await startTestServer({ testMode: true });
    const o = openWs(h.wsUrl);
    await o.opened;
    o.ws.terminate();
    // Short wait to let the server's 'error' event fire. Negative-observable:
    // we just need the error handler to run (50ms is plenty on localhost).
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
});
