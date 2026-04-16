/** Cell dimensions in CSS pixels, used for mouse coordinate math. */
export interface CellMetrics {
  width: number;
  height: number;
}

/** Full xterm.js ITheme-compatible colour map (Alacritty convention). */
export interface ITheme {
  foreground?: string;
  background?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black?: string; red?: string; green?: string; yellow?: string;
  blue?: string; magenta?: string; cyan?: string; white?: string;
  brightBlack?: string; brightRed?: string; brightGreen?: string; brightYellow?: string;
  brightBlue?: string; brightMagenta?: string; brightCyan?: string; brightWhite?: string;
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
  title?: string;    // active pane title (shell window title)
}

/** Client-to-server resize message. */
export interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

/** Server configuration derived from CLI args. */
export interface ServerConfig {
  host: string;
  port: number;
  allowedIps: Set<string>;
  tls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  testMode: boolean;
  debug: boolean;
  tmuxBin: string;
  tmuxConf?: string;
  themesDir?: string;
  theme?: string;
  auth: {
    enabled: boolean;
    username?: string;
    password?: string;
  };
}

/** Config injected into the HTML page for the client. */
export interface ClientConfig {
  version: string;
}
