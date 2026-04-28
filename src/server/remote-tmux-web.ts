import { EventEmitter } from 'node:events';
import { encodePtyBytes, type StdioFrame } from './stdio-protocol.js';
import type { OpenChannelOptions } from './remote-agent-manager.js';
import { isValidRemoteHostAlias } from './remote-route.js';

type FrameListener = (frame: StdioFrame) => void;

export interface RemoteTmuxWebChannel {
  readonly channelId?: string;
  on(event: 'frame', cb: FrameListener): () => void;
  sendPty(data: string): void;
  resize(cols: number, rows: number): void;
  sendClientMessage(data: string): void;
  close(reason?: string): void;
}

export interface RemoteTmuxWebConnection {
  apiGet(path: string): Promise<{ status: number; body: unknown }>;
  openChannel(opts: OpenChannelOptions): Promise<RemoteTmuxWebChannel>;
}

export interface RemoteTmuxWebConnectionManager {
  getHost(host: string): Promise<RemoteTmuxWebConnection>;
  close(): Promise<void> | void;
}

interface DirectHttpRemoteTmuxWebConnectionOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  webSocketFactory?: (url: string) => WebSocket;
}

class DirectHttpRemoteTmuxWebChannel extends EventEmitter implements RemoteTmuxWebChannel {
  readonly channelId: string;
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
  ) {
    super();
    this.channelId = crypto.randomUUID();
    ws.addEventListener('message', event => {
      if (this.closed) return;
      const data = typeof event.data === 'string'
        ? Buffer.from(event.data, 'utf8')
        : Buffer.from(event.data as ArrayBuffer);
      this.emit('frame', encodePtyBytes(this.channelId, data, 'pty-out'));
    });
    ws.addEventListener('close', event => {
      if (this.closed) return;
      this.closed = true;
      this.emit('frame', {
        v: 1,
        type: 'close',
        channelId: this.channelId,
        reason: event.reason || 'remote websocket closed',
      });
    });
    ws.addEventListener('error', () => {
      if (this.closed) return;
      this.emit('frame', {
        v: 1,
        type: 'channel-error',
        channelId: this.channelId,
        code: 'remote-websocket-error',
        message: 'remote websocket error',
      });
    });
  }

  override on(event: 'frame', cb: FrameListener): () => void {
    super.on(event, cb);
    return () => { this.off(event, cb); };
  }

  sendPty(data: string): void {
    if (this.closed) return;
    this.ws.send(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  sendClientMessage(data: string): void {
    if (this.closed) return;
    this.ws.send(data);
  }

  close(reason = 'local close'): void {
    if (this.closed) return;
    this.closed = true;
    this.ws.close(1000, reason);
  }
}

export class DirectHttpRemoteTmuxWebConnection implements RemoteTmuxWebConnection {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketFactory: (url: string) => WebSocket;

  constructor(opts: DirectHttpRemoteTmuxWebConnectionOptions) {
    this.baseUrl = new URL(opts.baseUrl);
    this.fetchImpl = opts.fetch ?? fetch;
    this.webSocketFactory = opts.webSocketFactory ?? ((url: string) => new WebSocket(url));
  }

  async apiGet(path: string): Promise<{ status: number; body: unknown }> {
    const url = this.url(path);
    const response = await this.fetchImpl(url.href);
    return { status: response.status, body: await responseBody(response) };
  }

  openChannel(opts: OpenChannelOptions): Promise<RemoteTmuxWebChannel> {
    const url = this.url('/ws');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('session', opts.session);
    url.searchParams.set('cols', String(opts.cols));
    url.searchParams.set('rows', String(opts.rows));

    const ws = this.webSocketFactory(url.href);
    ws.binaryType = 'arraybuffer';
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error('remote websocket error'));
      ws.addEventListener('open', () => {
        resolve(new DirectHttpRemoteTmuxWebChannel(ws));
      });
      ws.addEventListener('error', fail);
    });
  }

  private url(path: string): URL {
    if (!path.startsWith('/')) throw new Error('remote API path must start with /');
    return new URL(path, this.baseUrl);
  }
}

export interface RemoteTmuxWebManagerOptions {
  directHttpBaseUrls?: Map<string, string>;
  stdioManager: RemoteTmuxWebConnectionManager;
}

export class RemoteTmuxWebManager implements RemoteTmuxWebConnectionManager {
  private readonly direct = new Map<string, DirectHttpRemoteTmuxWebConnection>();

  constructor(private readonly opts: RemoteTmuxWebManagerOptions) {}

  async getHost(host: string): Promise<RemoteTmuxWebConnection> {
    const baseUrl = this.opts.directHttpBaseUrls?.get(host);
    if (!baseUrl) return this.opts.stdioManager.getHost(host);
    let existing = this.direct.get(host);
    if (!existing) {
      existing = new DirectHttpRemoteTmuxWebConnection({ baseUrl });
      this.direct.set(host, existing);
    }
    return existing;
  }

  async close(): Promise<void> {
    await this.opts.stdioManager.close();
  }
}

export function parseRemoteHttpBaseUrls(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    for (const [host, value] of Object.entries(parsed)) {
      if (!isValidRemoteHostAlias(host)) continue;
      if (typeof value !== 'string' || value.trim() === '') continue;
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      out.set(host, url.href.replace(/\/$/, ''));
    }
  } catch {
    return out;
  }
  return out;
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('application/json')) return response.json();
  return response.text();
}
