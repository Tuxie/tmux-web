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
  /** -100..+100. OKLab chroma scale applied to FG and BG colours.
   *  -100 = greyscale, 0 = identity, +100 = doubled chroma. */
  tuiSaturation: number;
}

/** Info about a single tmux window. */
export interface WindowInfo {
  index: string;
  name: string;
  active: boolean;
}

export interface SessionInfo {
  id: string;
  name: string;
  /** Window count from `#{session_windows}`. Optional because older
   *  server builds (and persisted-only stopped sessions on the client)
   *  don't supply it. */
  windows?: number;
}

export interface ScrollbarState {
  paneId: string | null;
  paneHeight: number;
  historySize: number;
  scrollPosition: number;
  paneInMode: number;
  paneMode: string;
  alternateOn: boolean;
  unavailable?: boolean;
}

export interface ScrollbarActionMessage {
  type: "scrollbar";
  action: "line-up" | "line-down" | "page-up" | "page-down" | "drag";
  count?: number;
  position?: number;
  paneId?: string;
}

/**
 * Server-to-client out-of-band message.
 * Framed as \x00TT:<json> in the WebSocket data stream.
 * Uses presence of keys to indicate message type (matches original protocol).
 */
export interface ServerMessage {
  session?: string;
  sessions?: SessionInfo[];
  windows?: WindowInfo[];
  scrollbar?: ScrollbarState;
  clipboard?: string; // base64-encoded
  title?: string;    // active pane title (shell window title)
  /** Per-window pane titles, keyed by tmux window index. Sourced from a
   *  push-based `refresh-client -B` subscription on the per-session
   *  control client; updated whenever any window's active-pane title
   *  changes. The client uses these as tooltips on the win-tab buttons
   *  and the windows-menu entries. */
  titles?: Record<string, string>;
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
  /** Sent when the PTY child (tmux / `cat` in test mode) exits, or when
   *  `Bun.spawn` itself threw (e.g. `--tmux <path>` no longer runnable).
   *  The server intentionally does *not* call `ws.close()` for normal
   *  exits because doing so triggers a Bun 1.3.13 bug that leaves
   *  `server.stop()` blocked; the client should treat receipt as
   *  "session ended" and close the socket on its own.
   *
   *  For the spawn-failure case (cluster 15 / F5) the server *does*
   *  close the WS and the optional `exitCode` / `exitReason` fields
   *  carry diagnostic information so the client can surface a useful
   *  message instead of "WS closed unexpectedly". */
  ptyExit?: true;
  /** Optional exit code accompanying `ptyExit`. Set to `-1` by the
   *  server when `Bun.spawn` itself threw before the child even
   *  started. Cluster 15 / F5 — docs/code-analysis/2026-04-26. */
  exitCode?: number;
  /** Optional human-readable reason accompanying `ptyExit` for the
   *  spawn-failure case. Cluster 15 / F5. */
  exitReason?: string;
}

/** Client-to-server resize message. */
export interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

/** Client-to-server tmux session switch message. */
export interface SwitchSessionMessage {
  type: 'switch-session';
  /** The target tmux session name. Server validates and sanitizes. */
  name: string;
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
  exposeClientAuth?: boolean;
  clientAuthToken?: string;
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
  /** Desktop-only Basic Auth userinfo for WebSocket URLs. Normal browser
   *  deployments do not expose this; tmux-term opts in with per-launch
   *  random loopback credentials because WebKit strips URL userinfo from
   *  `location.href` after the HTTP Basic challenge. */
  wsBasicAuth?: string;
  /** Desktop-only bearer-style query token for browser-managed resource
   *  loads that cannot set an Authorization header, such as stylesheet
   *  links and FontFace URLs. */
  clientAuthToken?: string;
  /** Desktop-only boot metadata. Native WebViews can be inconsistent
   *  about fetch(), while the initial document config is already proven
   *  to load. */
  themes?: Array<{
    name: string;
    pack: string;
    css: string;
    defaultFont?: string;
    defaultFontSize?: number;
    defaultSpacing?: number;
    defaultColours?: string;
    defaultOpacity?: number;
    defaultTuiBgOpacity?: number;
    defaultTuiFgOpacity?: number;
    defaultTuiSaturation?: number;
    defaultFgContrastStrength?: number;
    defaultFgContrastBias?: number;
    defaultThemeHue?: number;
    defaultThemeSat?: number;
    defaultThemeLtn?: number;
    defaultThemeContrast?: number;
    defaultDepth?: number;
    defaultBackgroundHue?: number;
    defaultBackgroundSaturation?: number;
    defaultBackgroundBrightest?: number;
    defaultBackgroundDarkest?: number;
    defaultTopbarAutohide?: boolean;
    defaultScrollbarAutohide?: boolean;
    author?: string;
    version?: string;
    source: 'user' | 'bundled';
  }>;
  fonts?: Array<{ family: string; file: string; pack: string }>;
  colours?: Array<{ name: string; variant?: string; theme: ITheme }>;
}
