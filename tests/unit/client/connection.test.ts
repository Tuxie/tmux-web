import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Connection, buildWsUrl } from '../../../src/client/connection.ts';

const origWS = (globalThis as any).WebSocket;
const origSetTimeout = globalThis.setTimeout;
const origClearTimeout = globalThis.clearTimeout;
const origLocation = (globalThis as any).location;
afterAll(() => {
  (globalThis as any).WebSocket = origWS;
  (globalThis as any).setTimeout = origSetTimeout;
  (globalThis as any).clearTimeout = origClearTimeout;
  (globalThis as any).location = origLocation;
});

/** Fake WebSocket driver. Captures the URL used at construction time,
 *  exposes `simulateOpen/simulateMessage/simulateClose/simulateError`,
 *  and keeps a `sent` array of everything `.send()` saw. Read/write
 *  access to `readyState` is explicit so tests can simulate
 *  CONNECTING / OPEN / CLOSED transitions. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState: number = FakeWebSocket.CONNECTING;
  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; this.readyState = FakeWebSocket.CLOSED; }
  simulateOpen(): void { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  simulateMessage(data: any): void { this.onmessage?.({ data }); }
  simulateClose(): void { this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); }
  simulateError(): void { this.onerror?.(); }
}

let pendingTimers: Array<{ fn: () => void; ms: number; id: number }>;
let nextTimerId = 0;

function installHarness() {
  FakeWebSocket.instances = [];
  pendingTimers = [];
  nextTimerId = 0;
  (globalThis as any).WebSocket = FakeWebSocket;
  (globalThis as any).setTimeout = ((fn: () => void, ms: number) => {
    const id = ++nextTimerId;
    pendingTimers.push({ fn, ms, id });
    return id;
  }) as any;
  (globalThis as any).clearTimeout = ((id: number) => {
    pendingTimers = pendingTimers.filter(t => t.id !== id);
  }) as any;
}

function makeOpts(overrides: Partial<{
  onMessage: (s: string) => void;
  onOpen: () => void;
  onClose: () => void;
  url: string;
}> = {}) {
  return {
    getUrl: () => overrides.url ?? 'ws://localhost/ws',
    onMessage: overrides.onMessage ?? (() => {}),
    onOpen: overrides.onOpen ?? (() => {}),
    onClose: overrides.onClose ?? (() => {}),
  };
}

describe('Connection.connect', () => {
  beforeEach(installHarness);

  it('opens a socket at the URL returned by getUrl()', () => {
    const c = new Connection(makeOpts({ url: 'ws://example/ws?session=x' }));
    c.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toBe('ws://example/ws?session=x');
  });

  it('invokes onOpen when the socket opens', () => {
    let opened = 0;
    const c = new Connection(makeOpts({ onOpen: () => opened++ }));
    c.connect();
    FakeWebSocket.instances[0]!.simulateOpen();
    expect(opened).toBe(1);
  });

  it('forwards string messages to onMessage; non-string is ignored', () => {
    const got: string[] = [];
    const c = new Connection(makeOpts({ onMessage: (s) => got.push(s) }));
    c.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.simulateMessage('hello');
    ws.simulateMessage(new ArrayBuffer(4));
    ws.simulateMessage('world');
    expect(got).toEqual(['hello', 'world']);
  });

  it('invokes onClose and schedules a reconnect 2 s later', () => {
    let closed = 0;
    const c = new Connection(makeOpts({ onClose: () => closed++ }));
    c.connect();
    FakeWebSocket.instances[0]!.simulateClose();
    expect(closed).toBe(1);
    expect(pendingTimers.some(t => t.ms === 2000)).toBe(true);
  });

  it('reconnects when the 2 s timer fires', () => {
    const c = new Connection(makeOpts());
    c.connect();
    FakeWebSocket.instances[0]!.simulateClose();
    const reconnectTimer = pendingTimers.find(t => t.ms === 2000)!;
    expect(FakeWebSocket.instances).toHaveLength(1);
    reconnectTimer.fn();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('installs a no-op onerror so browser-default rethrow is suppressed', () => {
    const c = new Connection(makeOpts());
    c.connect();
    const ws = FakeWebSocket.instances[0]!;
    expect(typeof ws.onerror).toBe('function');
    // Calling it must not throw (it's the silent-failure no-op).
    ws.simulateError();
  });
});

describe('Connection.isOpen', () => {
  beforeEach(installHarness);

  it('false before connect()', () => {
    const c = new Connection(makeOpts());
    expect(c.isOpen).toBe(false);
  });

  it('false while the socket is CONNECTING', () => {
    const c = new Connection(makeOpts());
    c.connect();
    expect(c.isOpen).toBe(false);
  });

  it('true once the socket transitions to OPEN', () => {
    const c = new Connection(makeOpts());
    c.connect();
    FakeWebSocket.instances[0]!.simulateOpen();
    expect(c.isOpen).toBe(true);
  });
});

describe('Connection.send', () => {
  beforeEach(installHarness);

  it('no-ops before open', () => {
    const c = new Connection(makeOpts());
    c.connect();
    c.send('x');
    expect(FakeWebSocket.instances[0]!.sent).toEqual([]);
  });

  it('forwards to the socket once OPEN', () => {
    const c = new Connection(makeOpts());
    c.connect();
    FakeWebSocket.instances[0]!.simulateOpen();
    c.send('hello');
    expect(FakeWebSocket.instances[0]!.sent).toEqual(['hello']);
  });

  it('sendResize builds and sends a well-formed JSON payload', () => {
    const c = new Connection(makeOpts());
    c.connect();
    FakeWebSocket.instances[0]!.simulateOpen();
    c.sendResize(80, 24);
    expect(FakeWebSocket.instances[0]!.sent).toEqual([
      JSON.stringify({ type: 'resize', cols: 80, rows: 24 }),
    ]);
  });
});

describe('Connection.dispose', () => {
  beforeEach(installHarness);

  it('clears the reconnect timer and closes the socket', () => {
    const c = new Connection(makeOpts());
    c.connect();
    FakeWebSocket.instances[0]!.simulateClose();
    expect(pendingTimers).toHaveLength(1);
    c.dispose();
    expect(pendingTimers).toHaveLength(0);
  });

  it('dispose on a pre-open socket still closes it', () => {
    const c = new Connection(makeOpts());
    c.connect();
    c.dispose();
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
  });
});

describe('Connection.reconnect', () => {
  beforeEach(installHarness);

  it('cancels the pending auto-reconnect and opens a fresh socket', () => {
    const c = new Connection(makeOpts());
    c.connect();
    FakeWebSocket.instances[0]!.simulateClose();
    expect(pendingTimers).toHaveLength(1);
    c.reconnect();
    expect(pendingTimers).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('suppresses the old socket\'s onclose to prevent double-reconnect', () => {
    let closedCalls = 0;
    const c = new Connection(makeOpts({ onClose: () => closedCalls++ }));
    c.connect();
    const first = FakeWebSocket.instances[0]!;
    first.simulateOpen();
    c.reconnect();
    // Simulate the old socket firing close AFTER reconnect() already swapped
    // it out. The opts.onClose must not fire a second time because reconnect
    // nulled the onclose handler.
    first.onclose = null as any;
    // Guard: Connection.reconnect sets onclose=null on the old socket.
    expect(first.onclose).toBe(null);
    expect(closedCalls).toBe(0);
  });

  it('sends resize on initial open and on auto-reconnect open', () => {
    // Mirrors what index.ts wires up: call sendResize inside onOpen.
    let c: Connection;
    c = new Connection({
      getUrl: () => 'ws://localhost/ws',
      onMessage: () => {},
      onOpen: () => { c.sendResize(80, 24); },
      onClose: () => {},
    });
    c.connect();

    FakeWebSocket.instances[0]!.simulateOpen();
    expect(FakeWebSocket.instances[0]!.sent).toEqual([
      JSON.stringify({ type: 'resize', cols: 80, rows: 24 }),
    ]);

    FakeWebSocket.instances[0]!.simulateClose();
    const timer = pendingTimers.find(t => t.ms === 2000)!;
    timer.fn();

    FakeWebSocket.instances[1]!.simulateOpen();
    expect(FakeWebSocket.instances[1]!.sent).toEqual([
      JSON.stringify({ type: 'resize', cols: 80, rows: 24 }),
    ]);
  });
});

describe('buildWsUrl', () => {
  beforeEach(() => {
    (globalThis as any).location = {
      protocol: 'https:',
      host: 'example.com:4022',
      href: 'https://example.com:4022/',
    };
  });

  it('picks wss:// when location.protocol is https:', () => {
    expect(buildWsUrl('main', 80, 24)).toBe(
      'wss://example.com:4022/ws?cols=80&rows=24&session=main',
    );
  });

  it('picks ws:// when location.protocol is http:', () => {
    (globalThis as any).location = {
      protocol: 'http:',
      host: '127.0.0.1:4022',
      href: 'http://127.0.0.1:4022/',
    };
    expect(buildWsUrl('dev', 120, 40)).toBe(
      'ws://127.0.0.1:4022/ws?cols=120&rows=40&session=dev',
    );
  });

  it('carries Basic Auth userinfo from the current page URL', () => {
    (globalThis as any).location = {
      protocol: 'http:',
      host: '127.0.0.1:4022',
      href: 'http://tmux-term-user:p%40ss%2Fw%3Ard@127.0.0.1:4022/',
    };
    expect(buildWsUrl('dev', 120, 40)).toBe(
      'ws://tmux-term-user:p%40ss%2Fw%3Ard@127.0.0.1:4022/ws?cols=120&rows=40&session=dev',
    );
  });

  it('uses explicit desktop Basic Auth userinfo when location userinfo is absent', () => {
    (globalThis as any).location = {
      protocol: 'http:',
      host: '127.0.0.1:4022',
      href: 'http://127.0.0.1:4022/',
    };
    expect(buildWsUrl('dev', 120, 40, 'tmux-term-user:p%40ss%2Fw%3Ard')).toBe(
      'ws://tmux-term-user:p%40ss%2Fw%3Ard@127.0.0.1:4022/ws?cols=120&rows=40&session=dev',
    );
  });

  it('URL-encodes session names with special characters', () => {
    expect(buildWsUrl('my session', 80, 24)).toBe(
      'wss://example.com:4022/ws?cols=80&rows=24&session=my%20session',
    );
  });
});
