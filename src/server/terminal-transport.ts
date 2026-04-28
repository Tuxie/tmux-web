import type { ServerMessage } from '../shared/types.js';

export interface TerminalTransport {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface TerminalTransportCallbacks {
  onPtyData(data: string): void;
  onServerMessage(msg: ServerMessage): void;
  onExit(reason?: string): void;
  onError(message: string): void;
}
