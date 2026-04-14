import type { ResizeMessage } from '../shared/types.js';

export interface ConnectionOptions {
  getUrl: () => string;
  onMessage: (data: string) => void;
  onOpen: () => void;
  onClose: () => void;
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
    this.ws.onerror = () => {};
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
}

export function buildWsUrl(session: string, cols: number, rows: number): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws?cols=${cols}&rows=${rows}&session=${encodeURIComponent(session)}`;
}
