/** Cell dimensions in CSS pixels, used for mouse coordinate math. */
export interface CellMetrics {
  width: number;
  height: number;
}

/** Terminal color theme. */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor?: string;
  selectionBackground?: string;
}

/** Options passed to terminal adapter on init. */
export interface TerminalOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: TerminalTheme;
}

/** Info about a single tmux window. */
export interface WindowInfo {
  index: string;
  name: string;
  active: boolean;
}

/**
 * Server-to-client out-of-band message.
 * Framed as \x00TT:<json> in the WebSocket data stream.
 * Uses presence of keys to indicate message type (matches original protocol).
 */
export interface ServerMessage {
  session?: string;
  windows?: WindowInfo[];
  clipboard?: string; // base64-encoded
}

/** Client-to-server resize message. */
export interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

/** Terminal backend identifier. */
export type TerminalBackend = 'ghostty' | 'xterm' | 'xterm-dev';

/** Server configuration derived from CLI args. */
export interface ServerConfig {
  host: string;
  port: number;
  terminal: TerminalBackend;
  allowedIps: Set<string>;
  tls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  testMode: boolean;
  debug: boolean;
  auth: {
    enabled: boolean;
    username?: string;
    password?: string;
  };
}

/** Config injected into the HTML page for the client. */
export interface ClientConfig {
  terminal: TerminalBackend;
}
