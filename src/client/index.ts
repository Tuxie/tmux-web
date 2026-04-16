import type { TerminalAdapter } from './adapters/types.js';
import type { ClientConfig } from '../shared/types.js';
import { extractTTMessages } from './protocol.js';
import { Connection, buildWsUrl } from './connection.js';
import { Topbar } from './ui/topbar.js';
import { installMouseHandler, getSgrCoords, buildSgrSequence } from './ui/mouse.js';
import { installKeyboardHandler } from './ui/keyboard.js';
import { handleClipboard } from './ui/clipboard.js';
import { getTopbarAutohide } from './prefs.js';
import { applyTheme, loadAllFonts, listThemes } from './theme.js';
import { fetchColours, composeBgColor, composeTheme, type ITheme } from './colours.js';
import {
  loadSessionSettings,
  saveSessionSettings,
  getLiveSessionSettings,
  setLastActiveSession,
  initSessionStore,
  DEFAULT_SESSION_SETTINGS,
  type SessionSettings,
} from './session-settings.js';
import { XtermAdapter } from './adapters/xterm.ts';

declare global {
  interface Window {
    __TMUX_WEB_CONFIG: ClientConfig;
  }
}


async function main() {
  const adapter: TerminalAdapter = new XtermAdapter();
  const container = document.getElementById('terminal')!;

  if (!getTopbarAutohide()) document.body.classList.add('topbar-pinned');

  const [themes, colours] = await Promise.all([listThemes(), fetchColours()]);
  await initSessionStore();
  await loadAllFonts();

  // Read from the URL every time we need it — the URL is rewritten in place
  // via history.replaceState when tmux switches sessions, so saves must follow.
  const getSession = (): string => location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
  const sessionName = getSession();
  const currentTheme = themes.find(t => t.name === DEFAULT_SESSION_SETTINGS.theme) ?? themes[0];
  const themeDefaults = currentTheme ? {
    colours: currentTheme.defaultColours,
    fontFamily: currentTheme.defaultFont,
    fontSize: currentTheme.defaultFontSize,
    spacing: currentTheme.defaultSpacing,
  } : undefined;

  const liveSettings = getLiveSessionSettings(sessionName);
  let settings = loadSessionSettings(sessionName, liveSettings, {
    defaults: DEFAULT_SESSION_SETTINGS,
    themeDefaults,
  });
  setLastActiveSession(sessionName);
  saveSessionSettings(sessionName, settings);

  await applyTheme(settings.theme);

  const colourByName = new Map(colours.map(c => [c.name, c.theme]));
  const coloursOrDefault = (name: string): ITheme =>
    colourByName.get(name) ?? { foreground: '#d4d4d4', background: '#1e1e1e' };
  const variantByName = new Map(colours.map(c => [c.name, c.variant]));
  const sendColourVariant = (colourName: string): void => {
    const v = variantByName.get(colourName);
    if (v === 'dark' || v === 'light') {
      connection?.send(JSON.stringify({ type: 'colour-variant', variant: v }));
    }
  };

  const page = document.getElementById('page')!;
  const getBodyBg = (): string =>
    getComputedStyle(document.body).backgroundColor;
  page.style.backgroundColor = composeBgColor(coloursOrDefault(settings.colours), settings.opacity);
  await adapter.init(container, {
    fontFamily: `"${settings.fontFamily}", monospace`,
    fontSize: settings.fontSize,
    lineHeight: settings.spacing,
    theme: composeTheme(coloursOrDefault(settings.colours), settings.opacity, getBodyBg()),
    opacity: settings.opacity,
  });
  adapter.focus();
  (window as any).__adapter = adapter;

  let appliedFontKey = settings.fontFamily;
  let connection: Connection;

  const topbar = new Topbar({
    send: (data) => connection.send(data),
    focus: () => adapter.focus(),
    getLiveSettings: () => settings,
    onAutohideChange: () => {
      adapter.fit();
    },
    onSwitchSession: (name) => {
      // Switch sessions without a full page navigation — full reloads
      // exit fullscreen and lose terminal state. updateSession runs the
      // existing in-place session-change flow (URL replaceState, load
      // per-session settings, sync UI, fire onSettingsChange). Then
      // reconnect the WebSocket so the server attaches to the new tmux
      // session.
      topbar.updateSession(name);
      connection.reconnect();
    },
    onSettingsChange: async (s) => {
      const themeChanged = s.theme !== settings.theme;
      const fontChanged = s.fontFamily !== appliedFontKey;
      const colourChanged = s.colours !== settings.colours;
      settings = s;
      saveSessionSettings(getSession(), s);
      if (colourChanged) sendColourVariant(s.colours);

      if (themeChanged) {
        await applyTheme(s.theme);
      }

      page.style.backgroundColor = composeBgColor(coloursOrDefault(s.colours), s.opacity);
      adapter.setTheme(composeTheme(coloursOrDefault(s.colours), s.opacity, getBodyBg()));

      if (fontChanged && adapter.requiresReloadForFontChange) {
        const _dd = document.getElementById('menu-dropdown') as HTMLElement | null;
        if (_dd && !_dd.hidden) sessionStorage.setItem('tmux-web:menu-reopen', '1');
        appliedFontKey = s.fontFamily;
        location.reload();
        return;
      }

      if (adapter.updateOptions) {
        adapter.updateOptions({
          fontFamily: `"${s.fontFamily}", monospace`,
          fontSize: s.fontSize,
          lineHeight: s.spacing,
          opacity: s.opacity,
        });
      } else if (fontChanged) {
        const _dd = document.getElementById('menu-dropdown') as HTMLElement | null;
        if (_dd && !_dd.hidden) sessionStorage.setItem('tmux-web:menu-reopen', '1');
        location.reload();
        return;
      }

      if (fontChanged) {
        appliedFontKey = s.fontFamily;
        document.fonts.load(`18px "${s.fontFamily}"`).then(() => adapter.fit()).catch(() => adapter.fit());
      }
      adapter.fit();
    },
  });
  await topbar.init();
  adapter.fit();

  // Title comes exclusively from the server's TT `title` message, which
  // carries tmux's raw #{pane_title} (what the shell set). We intentionally
  // ignore xterm.js's onTitleChange here — it'd fire in parallel with the
  // server message but deliver tmux's set-titles-string output (typically
  // `session:window_name`), which tmux sanitises (non-printables → `_`) and
  // differs from pane_title. Having both sources race made the topbar
  // flicker between the two forms on rapid title updates.
  function handleMessage(data: string) {
    const { terminalData, messages } = extractTTMessages(data);
    if (terminalData) adapter.write(terminalData);
    for (const msg of messages) {
      if (msg.clipboard) handleClipboard(msg.clipboard);
      if (msg.session) topbar.updateSession(msg.session);
      if (msg.windows) topbar.updateWindows(msg.windows);
      if (msg.title !== undefined) topbar.updateTitle(msg.title);
    }
  }

  connection = new Connection({
    getUrl: () => {
      const currentSession = location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
      return buildWsUrl(currentSession, adapter.cols, adapter.rows);
    },
    onMessage: handleMessage,
    onOpen: () => {
      connection.sendResize(adapter.cols, adapter.rows);
      sendColourVariant(settings.colours);
    },
    onClose: () => {
      adapter.write('\r\n\x1b[33mDisconnected. Reconnecting...\x1b[0m\r\n');
    },
  });
  connection.connect();

  adapter.onData((data) => connection.send(data));
  adapter.onResize(({ cols, rows }) => connection.sendResize(cols, rows));
  window.addEventListener('resize', () => adapter.fit());

  document.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    // Don't snap focus back to the terminal while the user is typing in a
    // regular form control (settings menu number inputs, the session/new
    // window popups, etc.).
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (target?.isContentEditable) return;
    adapter.focus();
  });

  document.addEventListener('paste', (ev) => {
    const text = ev.clipboardData?.getData('text/plain');
    if (text) {
      connection.send(text);
      ev.preventDefault();
      ev.stopPropagation();
    }
  });

  installMouseHandler({
    getMetrics: () => adapter.metrics,
    getCanvasRect: () => {
      const canvas = document.querySelector('#terminal canvas') as HTMLElement;
      return canvas?.getBoundingClientRect() || container.getBoundingClientRect();
    },
    getTerminalElement: () => container,
    send: (data) => connection.send(data),
  });

  adapter.attachCustomWheelEventHandler((ev) => {
    if (ev.shiftKey) return false;
    const canvas = document.querySelector('#terminal canvas') as HTMLElement;
    const rect = canvas?.getBoundingClientRect() || container.getBoundingClientRect();
    const coords = getSgrCoords(ev.clientX, ev.clientY, adapter.metrics, rect);
    const btn = ev.deltaY < 0 ? 64 : 65;
    const count = Math.max(1, Math.min(Math.abs(Math.round(ev.deltaY / 33)), 5));
    for (let i = 0; i < count; i++) {
      connection.send(buildSgrSequence(btn, coords.col, coords.row, false));
    }
    return true;
  });

  installKeyboardHandler({
    terminalElement: container,
    send: (data) => connection.send(data),
    toggleFullscreen: () => topbar.toggleFullscreen(),
  });
}

main();
