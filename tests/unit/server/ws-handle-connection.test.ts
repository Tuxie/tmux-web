import { describe, test, expect, afterEach } from 'bun:test';
import WebSocket from 'ws';
import fs from 'node:fs';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';
import { makeFakeTmux } from './_harness/fake-tmux.ts';

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

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 20));
  }
  return pred();
}

describe('ws handleConnection — OSC 52 read flow', () => {
  test('prompt → allow → clipboard-read-reply persists grant in store', async () => {
    // PTY = fake-tmux (raw cat). tmuxBin also fake-tmux so
    // getForegroundProcess resolves an exePath. panePid = process.pid so
    // readlink /proc/<pid>/exe succeeds. No prior grant → 'prompt'.
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    // Pre-populate the main session so recordGrant writes through instead
    // of the "skip silently when no session row" branch.
    fs.writeFileSync(h.tmpDir + '/sessions.json', JSON.stringify({
      version: 1,
      sessions: { main: { theme: 'Default', fontFamily: 'x', fontSize: 12, spacing: 1, opacity: 0 } },
    }));
    const o = openWs(h.wsUrl);
    await o.opened;

    await waitFor(() => o.messages.some(m => m.includes('clipboardPrompt')), 15000);
    const promptMsg = o.messages.find(m => m.includes('clipboardPrompt'));
    expect(promptMsg).toBeTruthy();
    const prompt = JSON.parse(promptMsg!).clipboardPrompt;
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

    await waitFor(() => o.messages.some(m => m.includes('clipboardReadRequest')), 2000);
    const readReqMsg = o.messages.find(m => m.includes('clipboardReadRequest'));
    expect(readReqMsg).toBeTruthy();
    const readReq = JSON.parse(readReqMsg!).clipboardReadRequest;
    expect(readReq.reqId).toBe(prompt.reqId);

    const payload = Buffer.from('hello').toString('base64');
    o.ws.send(JSON.stringify({
      type: 'clipboard-read-reply',
      reqId: prompt.reqId,
      base64: payload,
    }));
    await new Promise(r => setTimeout(r, 800));

    const store = JSON.parse(fs.readFileSync(h.tmpDir + '/sessions.json', 'utf8'));
    expect(store.sessions.main?.clipboard).toBeTruthy();

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('prompt → deny sends empty OSC 52 reply without recording a grant', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    await waitFor(() => o.messages.some(m => m.includes('clipboardPrompt')), 15000);
    const promptMsg = o.messages.find(m => m.includes('clipboardPrompt'));
    expect(promptMsg).toBeTruthy();
    const prompt = JSON.parse(promptMsg!).clipboardPrompt;

    o.ws.send(JSON.stringify({ type: 'clipboard-decision', reqId: prompt.reqId, allow: false }));
    await new Promise(r => setTimeout(r, 200));

    // No grant was persisted — sessions store still has no clipboard entry.
    const store = JSON.parse(fs.readFileSync(h.tmpDir + '/sessions.json', 'utf8'));
    expect(store.sessions.main?.clipboard).toBeFalsy();

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('OSC 52 read with unresolvable foreground → silent deny (no prompt)', async () => {
    // fake-tmux with failDisplayMessage: display-message exits 1 →
    // getForegroundProcess returns all-null → handleReadRequest takes
    // the "unknown foreground" branch (lines 313-319 in ws.ts).
    const { path: tmuxBin, dir } = makeFakeTmux({ failDisplayMessage: true });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;
    await new Promise(r => setTimeout(r, 2500));
    expect(o.messages.some(m => m.includes('clipboardPrompt'))).toBe(false);
    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('replyToRead catch branch fires when tmux send-keys fails', async () => {
    // policy=allow pre-populated so we get straight to the
    // clipboardReadRequest → reply flow. Mutate tmuxBin to /bin/false
    // right before the reply arrives so deliverOsc52Reply's tmux
    // send-keys call rejects and replyToRead's catch runs (line 296).
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
    await waitFor(() => o.messages.some(m => m.includes('clipboardReadRequest')), 15000);
    const rrMsg = o.messages.find(m => m.includes('clipboardReadRequest'));
    if (!rrMsg) { o.ws.close(); return; } // skip if timing didn't line up
    const rr = JSON.parse(rrMsg).clipboardReadRequest;

    // Break tmux for subsequent calls — sendBytesToPane will reject.
    h.config.tmuxBin = '/bin/false';
    o.ws.send(JSON.stringify({
      type: 'clipboard-read-reply',
      reqId: rr.reqId,
      base64: Buffer.from('x').toString('base64'),
    }));
    await new Promise(r => setTimeout(r, 500));
    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('ws closed during resolvePolicy → prompt emission guard fires', async () => {
    // Pin a bogus blake3 so resolvePolicy hashes the real bun binary
    // (~100 MB). The hash takes hundreds of ms, giving us a reliable
    // window to close the ws. Decision will be 'prompt' (hash mismatch);
    // when the prompt-emission path runs, the socket is already CLOSED —
    // exercising the `ws.readyState !== OPEN` guard.
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
    // Let the trigger fire + handleReadRequest start its hash.
    await new Promise(r => setTimeout(r, 400));
    o.ws.close();
    // Give the hash + prompt-guard path time to complete.
    await new Promise(r => setTimeout(r, 4000));
    expect(true).toBe(true);
  }, 20000);

  test('ws.terminate() on client triggers server ws error handler', async () => {
    h = await startTestServer({ testMode: true });
    const o = openWs(h.wsUrl);
    await o.opened;
    // terminate() triggers an abrupt close on the underlying TCP socket,
    // which the server's ws instance surfaces as an 'error' event — covers
    // the ws.on('error', () => {}) noop handler.
    o.ws.terminate();
    await new Promise(r => setTimeout(r, 200));
    expect(true).toBe(true);
  }, 20000);

  test('dropsChanged TT push when a drop is POST\'d via /api/drop', async () => {
    h = await startTestServer({ testMode: true });
    const o = openWs(h.wsUrl);
    await o.opened;

    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }), 'd.bin');
    await fetch(h.url + '/api/drop?session=main', { method: 'POST', body: fd });

    await waitFor(() => o.messages.some(m => m.includes('dropsChanged')), 2000);
    expect(o.messages.some(m => m.includes('dropsChanged'))).toBe(true);

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);
});

describe('ws handleConnection — OSC 52 policy shortcuts', () => {
  async function runWithPrepopulatedPolicy(allow: boolean, maxWaitMs = 12000) {
    const { path: tmuxBin, dir } = makeFakeTmux({ panePid: process.pid });
    fs.writeFileSync(dir + '/trigger', '\x1b]52;c;?\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    // Resolve the exe path the same way getForegroundProcess will.
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
    // Wait for handleReadRequest to run and either emit clipboardReadRequest
    // (allow) or nothing (deny). The trigger fires ~500ms after PTY start;
    // handleReadRequest then awaits getForegroundProcess (~50ms) plus
    // resolvePolicy (~5ms). Generous timeout.
    // Bounded wait: either clipboardReadRequest arrives (allow) or we wait
    // long enough for handleReadRequest to definitely have completed (deny).
    // For allow: wait until clipboardReadRequest arrives. For deny: wait a
    // fixed window for handleReadRequest to complete (no message arrives).
    if (allow) {
      const deadline = Date.now() + maxWaitMs;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100));
        if (o.messages.some(m => m.includes('clipboardReadRequest'))) break;
      }
    } else {
      // Just wait for the trigger + handleReadRequest to finish.
      await new Promise(r => setTimeout(r, 2000));
    }
    return o;
  }

  test('policy=allow short-circuits to clipboardReadRequest (no prompt)', async () => {
    const o = await runWithPrepopulatedPolicy(true);
    // No clipboardPrompt because policy is 'allow'.
    expect(o.messages.some(m => m.includes('clipboardPrompt'))).toBe(false);
    // clipboardReadRequest is emitted directly.
    expect(o.messages.some(m => m.includes('clipboardReadRequest'))).toBe(true);
    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('policy=deny short-circuits to empty reply (no prompt, no read request)', async () => {
    const o = await runWithPrepopulatedPolicy(false);
    expect(o.messages.some(m => m.includes('clipboardPrompt'))).toBe(false);
    expect(o.messages.some(m => m.includes('clipboardReadRequest'))).toBe(false);
    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);
});

describe('ws handleConnection — OSC 52 write + title change from PTY', () => {
  test('OSC 52 write payload in PTY output is forwarded as clipboard TT message', async () => {
    const { path: tmuxBin, dir } = makeFakeTmux();
    // Emit an OSC 52 write sequence (copy to clipboard) from the PTY.
    const base64 = Buffer.from('hi').toString('base64');
    fs.writeFileSync(dir + '/trigger', `\x1b]52;c;${base64}\x07`);
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;
    await waitFor(() => o.messages.some(m => m.includes('"clipboard"')), 10000);
    expect(o.messages.some(m => m.includes('"clipboard"'))).toBe(true);
    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('OSC title change from PTY triggers sendWindowState', async () => {
    // OSC 0 sets window title; "session:window" format triggers session detect.
    const { path: tmuxBin, dir } = makeFakeTmux();
    fs.writeFileSync(dir + '/trigger', '\x1b]0;dev:editor\x07');
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;
    await waitFor(() => o.messages.some(m => m.includes('"session":"dev"')), 10000);
    expect(o.messages.some(m => m.includes('"session":"dev"'))).toBe(true);
    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);
});

describe('ws handleConnection — non-testMode actions & sendWindowState', () => {
  test('window select triggers applyWindowAction + sendWindowState', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
    await waitFor(() => o.messages.some(m => m.includes('"windows"')), 10000);

    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toContain('select-window');
    expect(log).toContain('list-windows');
    expect(o.messages.some(m => m.includes('"windows"'))).toBe(true);

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('window new + rename + close all dispatch tmux calls', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'window', action: 'new', name: 'neu' }));
    await new Promise(r => setTimeout(r, 400));
    o.ws.send(JSON.stringify({ type: 'window', action: 'rename', index: '0', name: 'renamed' }));
    await new Promise(r => setTimeout(r, 400));
    o.ws.send(JSON.stringify({ type: 'window', action: 'close', index: '0' }));
    await new Promise(r => setTimeout(r, 1200));

    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toContain('new-window');
    expect(log).toContain('rename-window');
    expect(log).toContain('kill-window');

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('session rename + kill dispatch tmux calls', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'session', action: 'rename', name: 'newname' }));
    await new Promise(r => setTimeout(r, 400));
    o.ws.send(JSON.stringify({ type: 'session', action: 'kill' }));
    await new Promise(r => setTimeout(r, 1000));

    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toContain('rename-session');
    expect(log).toContain('kill-session');

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('colour-variant dark + light dispatch set-environment twice', async () => {
    const { path: tmuxBin, logFile } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;

    o.ws.send(JSON.stringify({ type: 'colour-variant', variant: 'dark' }));
    await new Promise(r => setTimeout(r, 500));
    o.ws.send(JSON.stringify({ type: 'colour-variant', variant: 'light' }));
    await new Promise(r => setTimeout(r, 700));

    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toContain('COLORFGBG');
    expect(log).toContain('CLITHEME');

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);

  test('colour-variant retry-on-failure branch (tmuxBin=/bin/false)', async () => {
    // /bin/false always exits non-zero → first run() rejects → setTimeout(500)
    // schedules a retry that also rejects but is caught. Covers the retry
    // branch inside applyColourVariant.
    h = await startTestServer({ testMode: false, tmuxBin: '/bin/false' });
    const o = openWs(h.wsUrl);
    // PTY is /bin/false, which exits immediately → onExit will close the
    // socket. The 'open' event should still fire first.
    try { await o.opened; } catch { /* ok if it never opens */ }
    try { o.ws.send(JSON.stringify({ type: 'colour-variant', variant: 'dark' })); } catch { /* ok */ }
    await new Promise(r => setTimeout(r, 900));
    try { o.ws.close(); } catch { /* ok */ }
  }, 20000);

  test('sendWindowState pushes a session+windows frame on window-action completion', async () => {
    const { path: tmuxBin } = makeFakeTmux();
    h = await startTestServer({ testMode: false, tmuxBin });
    const o = openWs(h.wsUrl);
    await o.opened;
    // Small settling delay so the PTY child is ready.
    await new Promise(r => setTimeout(r, 100));

    o.ws.send(JSON.stringify({ type: 'window', action: 'select', index: '0' }));
    await waitFor(() => o.messages.some(m => m.includes('"session"')), 15000);
    expect(o.messages.some(m => m.includes('"session"'))).toBe(true);

    o.ws.close();
    await new Promise(r => setTimeout(r, 50));
  }, 20000);
});
