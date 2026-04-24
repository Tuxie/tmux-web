import type { ResizeMessage } from '../shared/types.js';

export interface ConnectionOptions {
  getUrl: () => string;
  onMessage: (data: string) => void;
  onOpen: () => void;
  onClose: () => void;
  /** Optional: invoked when the underlying WebSocket fires `onerror`.
   *  Browsers deliver this before `onclose` on connection failures; the
   *  caller typically logs it and/or shows a rate-limited toast so the
   *  user notices CORS / protocol errors that would otherwise only
   *  surface as a generic "disconnected" message from `onclose`. */
  onError?: (ev: Event) => void;
}

export class Connection {
  private ws: WebSocket | null = null;
  private opts: ConnectionOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
  }

  connect(): void {
    this.ws = new WebSocket(this.opts.getUrl());
    this.ws.onopen = () => this.opts.onOpen();
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.opts.onMessage(e.data);
    };
    this.ws.onclose = () => {
      this.opts.onClose();
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = (ev) => this.opts.onError?.(ev);
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  sendResize(cols: number, rows: number): void {
    const msg: ResizeMessage = { type: 'resize', cols, rows };
    this.send(JSON.stringify(msg));
  }

  dispose(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  /** Close the current socket and open a new one immediately (e.g. after
   *  a client-initiated session switch where getUrl() now resolves
   *  differently). Cancels any pending auto-reconnect timer. */
  reconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      // Suppress the auto-reconnect that would otherwise run from onclose.
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connect();
  }
}

export function buildWsUrl(session: string, cols: number, rows: number, wsBasicAuth?: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new URL(location.href);
  const auth = wsBasicAuth
    ? `${wsBasicAuth}@`
    : current.username
    ? `${current.username}${current.password ? `:${current.password}` : ''}@`
    : '';
  return `${protocol}//${auth}${location.host}/ws?cols=${cols}&rows=${rows}&session=${encodeURIComponent(session)}`;
}
