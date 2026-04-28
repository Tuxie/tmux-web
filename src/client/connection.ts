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
   *  surface as a generic "disconnected" message from `onclose`.
   *
   *  `url` is the URL captured at construction time, before the failure
   *  redacted anything; useful for the developer-side console log
   *  because the browser-supplied `Event` is intentionally
   *  information-poor on WebSocket failures. */
  onError?: (ev: Event, url: string) => void;
}

export class Connection {
  private ws: WebSocket | null = null;
  private opts: ConnectionOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
  }

  connect(): void {
    // Capture the URL once per attempt so onerror can log a directional
    // hint without re-resolving getUrl() (which can shift if the user
    // changed sessions while we were reconnecting). Browsers fire onerror
    // with an information-poor `Event`, so the URL is the most useful
    // datum a developer-side log line can carry.
    const url = this.opts.getUrl();
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.opts.onOpen();
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.opts.onMessage(e.data);
    };
    this.ws.onclose = () => {
      this.opts.onClose();
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = (ev) => this.opts.onError?.(ev, url);
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
  const params = new URLSearchParams();
  params.set('cols', String(cols));
  params.set('rows', String(rows));
  params.set('session', session);
  const remoteHost = remoteHostFromPath(location.pathname ?? current.pathname);
  if (remoteHost) params.set('remoteHost', remoteHost);
  const twAuth = current.searchParams.get('tw_auth');
  if (twAuth !== null) params.set('tw_auth', twAuth);
  return `${protocol}//${auth}${location.host}/ws?${params.toString().replace(/\+/g, '%20')}`;
}

export function remoteHostFromPath(pathname: string): string | null {
  const parts = pathname.split('/');
  if (parts[1] !== 'r' || !parts[2] || !parts[3]) return null;
  const host = parts[2];
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host) ? host : null;
}

export function sessionFromPath(pathname: string): string {
  const parts = pathname.split('/');
  if (remoteHostFromPath(pathname)) {
    return parts.slice(3).join('/') || 'main';
  }
  return pathname.replace(/^\/+|\/+$/g, '') || 'main';
}

export function remotePathForSession(currentPathname: string, session: string): string {
  const remoteHost = remoteHostFromPath(currentPathname);
  if (remoteHost) return `/r/${remoteHost}/${session}`;
  return `/${session}`;
}
