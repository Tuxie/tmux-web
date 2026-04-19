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

/** Terminal color theme. Mirrors ITheme — all fields optional to allow partial
 *  colour schemes (xterm.js accepts undefined for any field). */
export type TerminalTheme = ITheme;

/** Options passed to terminal adapter on init. */
export interface TerminalOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: TerminalTheme;
  /** 0..100. The actual alpha blending lives on #page. */
  opacity: number;
  /** 0..100. Alpha for explicit TUI cell background rectangles. */
  tuiBgOpacity: number;
  /** 0..100. Glyph fg blended toward the cell's effective bg; 0 = text
   *  invisible (matches bg), 100 = text fully opaque at theme fg. */
  tuiFgOpacity: number;
  /** 0..100. OKLab-lightness repulsion applied to glyph fg colours so
   *  text doesn't disappear into near-identical-brightness bgs. */
  fgContrastStrength: number;
  /** -50..+50. Shifts the FG Contrast repulsion midpoint up (positive)
   *  or down (negative). */
  fgContrastBias: number;
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
  /** OSC 52 read request needs a user decision. Client pops a modal and
   *  replies with `{type:'clipboard-decision', ...}`. */
  clipboardPrompt?: {
    reqId: string;
    exePath: string | null;
    commandName: string | null;
  };
  /** OSC 52 read has been allowed by policy; server is asking the client
   *  for current clipboard contents. Client replies with
   *  `{type:'clipboard-read-reply', ...}`. */
  clipboardReadRequest?: { reqId: string };
  /** Fired server-side whenever the set of dropped files changes (new
   *  drop, auto-unlink on close, TTL sweep, ring-buffer trim, explicit
   *  revoke / purge). Drops are a per-user pool (not partitioned by
   *  tmux session), so every attached client refreshes on receipt. */
  dropsChanged?: true;
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
  allowedOrigins: Array<{ scheme: 'http' | 'https'; host: string; port: number } | '*'>;
  tls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  testMode: boolean;
  debug: boolean;
  tmuxBin: string;
  tmuxConf?: string;
  themesDir?: string;
  auth: {
    enabled: boolean;
    username?: string;
    password?: string;
  };
}

/** Config injected into the HTML page for the client. */
export interface ClientConfig {
  version: string;
  /** Test-mode flag set by the server when --test is active. Enables the
   *  window.__twInjectMessage backdoor used by e2e tests to drive the client
   *  without a server round-trip. Absent in production builds. */
  testMode?: boolean;
}
