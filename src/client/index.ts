import type { TerminalAdapter } from './adapters/types.js';
import type { ClientConfig } from '../shared/types.js';
import { extractTTMessages } from './protocol.js';
import { Connection, buildWsUrl } from './connection.js';
import { Topbar } from './ui/topbar.js';
import { installMouseHandler, getSgrCoords, buildSgrSequence } from './ui/mouse.js';
import { installKeyboardHandler } from './ui/keyboard.js';
import { handleClipboard } from './ui/clipboard.js';
import { loadSettings, setTerminalBackend, getTopbarAutohide, getActiveThemeName } from './settings.js';
import type { TerminalSettings } from './settings.js';
import { applyTheme, loadAllFonts, readBorderInsets } from './theme.js';

declare global {
  interface Window {
    __TMUX_WEB_CONFIG: ClientConfig;
  }
}

function fontFamilyCss(s: TerminalSettings): string {
  return `"${s.fontFamily}", monospace`;
}

function applyTerminalInsets(): void {
  const terminal = document.getElementById('terminal')!;
  const insets = readBorderInsets();
  const pinned = document.body.classList.contains('topbar-pinned');
  terminal.style.top = `${(pinned ? 28 : 3) + insets.top}px`;
  terminal.style.right = `${insets.right || 3}px`;
  terminal.style.bottom = `${insets.bottom || 3}px`;
  terminal.style.left = `${insets.left || 3}px`;
}

async function main() {
  const config = window.__TMUX_WEB_CONFIG;

  // Keep cookie in sync with the current terminal config.
  // The server handles all terminal selection (via query parameter or default config),
  // so the client just needs to remember what's currently loaded.
  // This prevents redirect loops when server restarts with a different --terminal.
  setTerminalBackend(config.terminal);

  let adapter: TerminalAdapter;
  if (config.terminal === 'ghostty') {
    const { GhosttyAdapter } = await import('./adapters/ghostty.js');
    adapter = new GhosttyAdapter();
  } else {
    const { XtermAdapter } = await import('./adapters/xterm.ts');
    adapter = new XtermAdapter();
  }

  const container = document.getElementById('terminal')!;

  // Pre-apply pinned topbar class so the container has the correct size during
  // the first adapter.init() → fit() call. topbar.init() later reads the same
  // value and calls applyPinnedClass() redundantly, which is harmless.
  if (!getTopbarAutohide()) {
    document.body.classList.add('topbar-pinned');
  }

  await loadAllFonts();
  await applyTheme(getActiveThemeName());
  applyTerminalInsets();

  const settings = loadSettings();
  await adapter.init(container, {
    fontFamily: fontFamilyCss(settings),
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
  });
  adapter.focus();
  (window as any).__adapter = adapter;

  const session = location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
  let connection: Connection;

  let appliedFontKey = settings.fontFamily;

  const topbar = new Topbar({
    send: (data) => connection.send(data),
    focus: () => adapter.focus(),
    onAutohideChange: () => {
      applyTerminalInsets();
      adapter.fit();
    },
    onThemeChange: () => {
      applyTerminalInsets();
      adapter.fit();
    },
    onSettingsChange: (s) => {
      // Check if font changed and adapter requires reload for font changes
      const newFontKey = s.fontFamily;
      const fontChanged = newFontKey !== appliedFontKey;

      if (fontChanged && adapter.requiresReloadForFontChange) {
        // Adapter can't recalculate metrics after font change — reload page
        const _dd = document.getElementById('menu-dropdown') as HTMLElement | null;
        if (_dd && !_dd.hidden) sessionStorage.setItem('tmux-web:menu-reopen', '1');
        appliedFontKey = newFontKey;
        location.reload();
        return;
      }

      // Apply adapter options immediately so the terminal reflects the change
      // before the font file is fetched. The browser will render with the new
      // font once the download completes.
      if (adapter.updateOptions) {
        adapter.updateOptions({
          fontFamily: fontFamilyCss(s),
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
        });
      } else {
        // ghostty has no updateOptions — reload so init() picks up the new font
        // from the start. Preserve menu-open state so it reopens after reload.
        const _dd = document.getElementById('menu-dropdown') as HTMLElement | null;
        if (_dd && !_dd.hidden) sessionStorage.setItem('tmux-web:menu-reopen', '1');
        location.reload();
        return;
      }

      // Load font in the background after the adapter is already updated.
      // After the font loads, re-fit the terminal so xterm recalculates character
      // cell metrics with the actual rendered font. Without this, text appears
      // cramped/overlapped because xterm calculates dimensions before the font loads.
      if (fontChanged) {
        appliedFontKey = newFontKey;
        document.fonts.load(`18px "${s.fontFamily}"`).then(() => {
          // Font has loaded — now re-fit with correct metrics
          adapter.fit();
        }).catch(() => {
          // Even if font loading failed, re-fit to apply any CSS changes
          adapter.fit();
        });
      }
    },
  });
  await topbar.init();
  applyTerminalInsets();
  adapter.fit();

  function handleMessage(data: string) {
    const { terminalData, messages } = extractTTMessages(data);
    if (terminalData) adapter.write(terminalData);
    for (const msg of messages) {
      if (msg.clipboard) handleClipboard(msg.clipboard);
      if (msg.session) topbar.updateSession(msg.session);
      if (msg.windows) topbar.updateWindows(msg.windows);
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
      topbar.refreshSessionList();
    },
    onClose: () => {
      adapter.write('\r\n\x1b[33mDisconnected. Reconnecting...\x1b[0m\r\n');
    },
  });
  connection.connect();

  adapter.onData((data) => connection.send(data));
  adapter.onResize(({ cols, rows }) => connection.sendResize(cols, rows));
  window.addEventListener('resize', () => adapter.fit());

  document.addEventListener('keydown', () => adapter.focus());

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
