import type { TerminalAdapter } from './adapters/types.js';
import type { ClientConfig, SwitchSessionMessage } from '../shared/types.js';
import { Connection, buildWsUrl } from './connection.js';
import { handleServerData } from './message-handler.js';
import { Topbar } from './ui/topbar.js';
import { installMouseHandler, buildWheelSgrSequences } from './ui/mouse.js';
import { installKeyboardHandler } from './ui/keyboard.js';
import { handleClipboard } from './ui/clipboard.js';
import { showClipboardPrompt } from './ui/clipboard-prompt.js';
import { installFileDropHandler } from './ui/file-drop.js';
import { showToast, formatBytes } from './ui/toast.js';
import { consumeBootErrors } from './boot-errors.js';
import { installAuthenticatedFetch } from './auth-fetch.js';
import { clientLog } from './client-log.js';
import { installDropsPanel } from './ui/drops-panel.js';
import { getTopbarAutohide, getFontSubpixelAA } from './prefs.js';
import { applyTheme, loadAllFonts, listThemes } from './theme.js';
import { fetchColours, composeBgColor, composeTheme, type ITheme } from './colours.js';
import {
  applyBackgroundHue,
  applyBackgroundSaturation,
  applyBackgroundBrightest,
  applyBackgroundDarkest,
  applyThemeHue,
  applyThemeSat,
  applyThemeLtn,
  applyThemeContrast,
  applyDepth,
} from './background-hue.js';
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
    __adapter?: TerminalAdapter;
    __twInjectMessage?: (data: string) => void;
    /** Set by the sessionStorage-consuming snippet in `index.html` before
     *  the deferred module script runs. `topbar.setupMenu()` reads it to
     *  decide whether to re-open the settings menu after a reload (e.g.
     *  after a font switch that forced `location.reload()`). */
    __menuReopen?: boolean;
    /** Teardown for `main()`'s subscriptions (window/document listeners,
     *  observers, child-handler disposers, connection + dropsPanel).
     *  Production never calls this — it exists so multi-mount test
     *  harnesses can clean up without leaking listeners across runs. */
    __twDispose?: () => void;
  }
}


async function main() {
  clientLog('main:start');
  installAuthenticatedFetch(window.__TMUX_WEB_CONFIG.wsBasicAuth);
  clientLog('fetch:installed');

  const adapter: TerminalAdapter = new XtermAdapter();
  const container = document.getElementById('terminal')!;

  if (!getTopbarAutohide()) document.body.classList.add('topbar-pinned');

  clientLog('boot-fetch:start');
  const [themes, colours] = await Promise.all([listThemes(), fetchColours()]);
  clientLog(`boot-fetch:done themes=${themes.length} colours=${colours.length}`);
  await initSessionStore();
  clientLog('session-store:done');
  await loadAllFonts();
  clientLog('fonts:done');

  // If any of the three boot fetches failed, collapse the labels into
  // one user-visible toast. Individual console.warn entries are already
  // written by `recordBootError` — the toast only exists so a user
  // without devtools open notices the degraded state.
  const bootErrors = consumeBootErrors();
  if (bootErrors.length > 0) {
    const unique = [...new Set(bootErrors)];
    showToast(
      'Failed to load some UI data (' + unique.join(', ') + ') — settings menu may be incomplete.',
      { variant: 'error', durationMs: 6000 },
    );
  }

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
    opacity: currentTheme.defaultOpacity,
    tuiBgOpacity: currentTheme.defaultTuiBgOpacity,
    tuiFgOpacity: currentTheme.defaultTuiFgOpacity,
    tuiSaturation: currentTheme.defaultTuiSaturation,
    fgContrastStrength: currentTheme.defaultFgContrastStrength,
    fgContrastBias: currentTheme.defaultFgContrastBias,
    themeHue: currentTheme.defaultThemeHue,
    themeSat: currentTheme.defaultThemeSat,
    themeLtn: currentTheme.defaultThemeLtn,
    themeContrast: currentTheme.defaultThemeContrast,
    depth: currentTheme.defaultDepth,
    backgroundHue: currentTheme.defaultBackgroundHue,
    backgroundSaturation: currentTheme.defaultBackgroundSaturation,
    backgroundBrightest: currentTheme.defaultBackgroundBrightest,
    backgroundDarkest: currentTheme.defaultBackgroundDarkest,
  } : undefined;

  const liveSettings = getLiveSessionSettings(sessionName);
  let settings = loadSessionSettings(sessionName, liveSettings, {
    defaults: DEFAULT_SESSION_SETTINGS,
    themeDefaults,
  });
  setLastActiveSession(sessionName);
  saveSessionSettings(sessionName, settings);

  await applyTheme(settings.theme);
  applyBackgroundHue(settings.backgroundHue);
  applyBackgroundSaturation(settings.backgroundSaturation);
  applyBackgroundBrightest(settings.backgroundBrightest);
  applyBackgroundDarkest(settings.backgroundDarkest);
  applyThemeHue(settings.themeHue);
  applyThemeSat(settings.themeSat);
  applyThemeLtn(settings.themeLtn);
  applyThemeContrast(settings.themeContrast);
  applyDepth(settings.depth);

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
  // The atlas needs a representative colour of whatever sits behind the
  // terminal so glyph-edge AA doesn't fringe against the scheme bg when
  // the scheme is light and the actual body is dark. For solid-body
  // themes `getComputedStyle(body).backgroundColor` is correct, but for
  // gradient/image bodies it returns `rgba(0,0,0,0)` and composeTheme
  // falls through to pure scheme bg. Let themes declare a
  // `--tw-antialias-bg: <css-colour>` on :root so they can name the colour
  // the AA should blend against; when absent, fall back to the body
  // computed bg. The value can be any CSS colour syntax (hsl(), rgb(),
  // hex, named, var() chains) — we resolve it via a detached probe so
  // `composeTheme`'s `rgba()` parser always gets canonical form.
  const getBodyBg = (): string => {
    const haloRaw = getComputedStyle(document.documentElement)
      .getPropertyValue('--tw-antialias-bg').trim();
    if (haloRaw && haloRaw !== 'transparent') {
      const probe = document.createElement('span');
      probe.style.display = 'none';
      probe.style.color = haloRaw;
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      if (resolved && resolved !== 'rgba(0, 0, 0, 0)') return resolved;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  page.style.setProperty('--tw-page-bg', composeBgColor(coloursOrDefault(settings.colours), settings.opacity));
  await adapter.init(container, {
    fontFamily: `"${settings.fontFamily}", monospace`,
    fontSize: settings.fontSize,
    lineHeight: settings.spacing,
    theme: composeTheme(coloursOrDefault(settings.colours), settings.opacity, getBodyBg()),
    opacity: settings.opacity,
    tuiBgOpacity: settings.tuiBgOpacity,
    tuiFgOpacity: settings.tuiFgOpacity,
    fgContrastStrength: settings.fgContrastStrength,
    fgContrastBias: settings.fgContrastBias,
    tuiSaturation: settings.tuiSaturation,
    subpixelAA: getFontSubpixelAA(settings.fontFamily),
  });
  adapter.focus();
  window.__adapter = adapter;

  let appliedFontKey = settings.fontFamily;
  let connection: Connection;
  // Forward-declared so handleMessage can refresh the drops panel on
  // server-push notifications. Assigned after topbar init below.
  let dropsPanel: ReturnType<typeof installDropsPanel> | null = null;

  const topbar = new Topbar({
    send: (data) => connection.send(data),
    focus: () => adapter.focus(),
    getLiveSettings: () => settings,
    onAutohideChange: () => {
      adapter.fit();
    },
    onSwitchSession: (name) => {
      // Ask the server to retarget the existing PTY tmux client. Do not
      // update the URL/settings optimistically: attach/switch can take time
      // or fail, and applying the target session's settings before tmux has
      // actually switched makes the old session appear under the new theme.
      // The server's TT session notification drives updateSession on success.
      const msg: SwitchSessionMessage = { type: 'switch-session', name };
      connection.send(JSON.stringify(msg));
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
      applyBackgroundHue(s.backgroundHue);
      applyBackgroundSaturation(s.backgroundSaturation);
      applyBackgroundBrightest(s.backgroundBrightest);
      applyBackgroundDarkest(s.backgroundDarkest);
      applyThemeHue(s.themeHue);
      applyThemeSat(s.themeSat);
      applyThemeLtn(s.themeLtn);
      applyThemeContrast(s.themeContrast);
      applyDepth(s.depth);

      page.style.setProperty('--tw-page-bg', composeBgColor(coloursOrDefault(s.colours), s.opacity));
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
          tuiBgOpacity: s.tuiBgOpacity,
          tuiFgOpacity: s.tuiFgOpacity,
          fgContrastStrength: s.fgContrastStrength,
          fgContrastBias: s.fgContrastBias,
          tuiSaturation: s.tuiSaturation,
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
  async function sendClipboardForRead(reqId: string): Promise<void> {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Browser blocked the read (no user gesture, permissions) — reply
      // with empty so the server sends an empty OSC 52 response back to
      // the app and it doesn't hang.
    }
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    connection.send(JSON.stringify({ type: 'clipboard-read-reply', reqId, base64 }));
  }

  async function handleClipboardPrompt(reqId: string, exePath: string | null, commandName: string | null): Promise<void> {
    const decision = await showClipboardPrompt({ exePath, commandName });
    connection.send(JSON.stringify({
      type: 'clipboard-decision',
      reqId,
      allow: decision.allow,
      persist: decision.persist,
      pinHash: decision.pinHash,
      expiresAt: decision.expiresAt,
    }));
  }

  function handleMessage(data: string) {
    handleServerData(data, {
      adapter,
      topbar,
      onClipboard: handleClipboard,
      onClipboardReadRequest: (req) => { void sendClipboardForRead(req.reqId); },
      onClipboardPrompt: (prompt) => {
        void handleClipboardPrompt(prompt.reqId, prompt.exePath, prompt.commandName);
      },
      onDropsChanged: () => { void dropsPanel?.refresh(); },
      onPtyExit: () => {
        // Server signals the underlying PTY/tmux process exited. The
        // server intentionally does not initiate the close itself (Bun
        // 1.3.13 leaves `server.stop()` blocked when it does). Closing
        // from the client lets the auto-reconnect timer in Connection
        // pick up a fresh PTY on the next attempt.
        try { connection?.reconnect(); } catch { /* connection may not be set yet */ }
      },
    });
  }

  // Once-per-reconnect-burst toast: a single failing open fires
  // onerror + onclose + onopen (retry) repeatedly during backoff. A
  // toast per attempt would spam; toast once when we first notice
  // trouble, then reset on the next successful open.
  let wsErrorToasted = false;

  connection = new Connection({
    getUrl: () => {
      const currentSession = location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
      return buildWsUrl(currentSession, adapter.cols, adapter.rows, window.__TMUX_WEB_CONFIG.wsBasicAuth);
    },
    onMessage: handleMessage,
    onOpen: () => {
      wsErrorToasted = false;
      connection.sendResize(adapter.cols, adapter.rows);
      sendColourVariant(settings.colours);
    },
    onClose: () => {
      adapter.write('\r\n\x1b[33mDisconnected. Reconnecting...\x1b[0m\r\n');
    },
    onError: (ev) => {
      console.warn('WebSocket error', ev);
      if (!wsErrorToasted) {
        wsErrorToasted = true;
        showToast('WebSocket connection error — check network / server', { variant: 'error' });
      }
    },
  });
  connection.connect();

  if (window.__TMUX_WEB_CONFIG.testMode) {
    // Test-only backdoor: lets Playwright inject a TT message directly into
    // the dispatch pipeline without a WS round-trip. Only attached when the
    // server is running under --test; production HTML has no testMode field.
    window.__twInjectMessage = (data: string) => handleMessage(data);
  }

  adapter.onData((data) => connection.send(data));
  adapter.onResize(({ cols, rows }) => connection.sendResize(cols, rows));

  // Collect teardown hooks. Production only ever calls `main()` once
  // per page load, but exposing a dispose path lets multi-mount tests
  // (and any future hot-reload idea) clean up without listener leaks.
  const disposers: Array<() => void> = [];

  const onWindowResize = () => adapter.fit();
  window.addEventListener('resize', onWindowResize);
  disposers.push(() => window.removeEventListener('resize', onWindowResize));

  // A theme swap changes #topbar height, #terminal insets, and CSS font
  // metrics — none of which fire a `resize` event on window. Observe the
  // terminal container directly so we re-fit whenever its own box
  // changes, regardless of the trigger.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => adapter.fit());
    ro.observe(container);
    disposers.push(() => ro.disconnect());
  }

  const onDocKeydown = (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    // Don't snap focus back to the terminal while the user is typing in a
    // regular form control (settings menu number inputs, the session/new
    // window popups, etc.).
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (target?.isContentEditable) return;
    adapter.focus();
  };
  document.addEventListener('keydown', onDocKeydown);
  disposers.push(() => document.removeEventListener('keydown', onDocKeydown));

  const onDocPaste = (ev: ClipboardEvent) => {
    const text = ev.clipboardData?.getData('text/plain');
    if (!text) return;
    if (!connection.isOpen) {
      showToast('Not connected — paste ignored', { variant: 'error' });
      return;
    }
    connection.send(text);
    ev.preventDefault();
    ev.stopPropagation();
  };
  document.addEventListener('paste', onDocPaste);
  disposers.push(() => document.removeEventListener('paste', onDocPaste));

  const uninstallMouse = installMouseHandler({
    getMetrics: () => adapter.metrics,
    getCanvasRect: () => {
      const canvas = document.querySelector('#terminal canvas') as HTMLElement;
      return canvas?.getBoundingClientRect() || container.getBoundingClientRect();
    },
    getTerminalElement: () => container,
    send: (data) => connection.send(data),
  });
  disposers.push(uninstallMouse);

  adapter.attachCustomWheelEventHandler((ev) => {
    if (ev.shiftKey) return false;
    const canvas = document.querySelector('#terminal canvas') as HTMLElement;
    const rect = canvas?.getBoundingClientRect() || container.getBoundingClientRect();
    for (const seq of buildWheelSgrSequences(ev, adapter.metrics, rect)) connection.send(seq);
    return true;
  });

  const uninstallKeyboard = installKeyboardHandler({
    terminalElement: container,
    send: (data) => connection.send(data),
    toggleFullscreen: () => topbar.toggleFullscreen(),
  });
  disposers.push(uninstallKeyboard);

  dropsPanel = installDropsPanel({ getSession });
  disposers.push(() => dropsPanel?.dispose());

  const uninstallFileDrop = installFileDropHandler({
    terminal: container,
    getSession,
    onDropped: (info) => {
      showToast(`Uploaded ${info.filename} — ${formatBytes(info.size)}`);
      // The server push (dropsChanged TT) already refreshes the panel;
      // this is just a belt-and-braces call for the case where the WS
      // message hasn't arrived yet.
      void dropsPanel?.refresh();
    },
    onError: (err, file) => {
      console.warn(`file-drop upload failed for ${file.name}:`, err);
      showToast(`Upload failed: ${file.name}`, { variant: 'error' });
    },
  });
  disposers.push(uninstallFileDrop);

  // Connection + adapter own their own internal state; calling their
  // `.dispose()` lives at the tail so handlers higher up run first.
  disposers.push(() => connection.dispose());

  // Expose a single teardown entry point. Never called in production;
  // documented for multi-mount test harnesses (see
  // docs/ideas/topbar-full-coverage-harness.md for the bigger picture).
  window.__twDispose = () => {
    for (const d of disposers.reverse()) {
      try { d(); } catch (err) { console.warn('dispose handler threw:', err); }
    }
    disposers.length = 0;
    delete window.__twDispose;
    delete window.__twInjectMessage;
    delete window.__adapter;
  };

  // (drops-panel handles auto-refresh itself via a MutationObserver on
  // #menu-dropdown, polling while the settings menu is visible.)
}

main().catch((err) => {
  clientLog(`main:error ${err instanceof Error ? err.message : String(err)}`);
  throw err;
});
