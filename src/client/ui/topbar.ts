import {
  getShowWindowTabs, setShowWindowTabs,
} from '../prefs.js';
import { applyTheme, listFonts, listThemes } from '../theme.js';
import { fetchColours } from '../colours.js';
import { Dropdown, showContextMenu, type DropdownItem } from './dropdown.js';
import { showConfirmModal } from './confirm-modal.js';
import {
  loadSessionSettings,
  saveSessionSettings,
  deleteSessionSettings,
  getLiveSessionSettings,
  getStoredSessionNames,
  getKnownRemoteServers,
  initSessionStore,
  recordKnownRemoteServer,
  sessionSettingsKey,
  setLastActiveSession,
  applyThemeDefaults,
  DEFAULT_SESSION_SETTINGS,
  clampFontSize,
  clampSpacing,
  clampPercent0to100,
  type SessionSettings,
  type ThemeDefaults,
} from '../session-settings.js';
import {
  DEFAULT_BACKGROUND_HUE,
  DEFAULT_BACKGROUND_SATURATION,
  DEFAULT_BACKGROUND_BRIGHTEST,
  DEFAULT_BACKGROUND_DARKEST,
  DEFAULT_THEME_HUE,
  clampBackgroundHue,
  clampBackgroundSaturation,
  clampBackgroundBrightest,
  clampBackgroundDarkest,
  clampThemeHue,
  clampThemeSat,
  clampThemeLtn,
  clampThemeContrast,
  DEFAULT_THEME_SAT,
  DEFAULT_THEME_LTN,
  DEFAULT_THEME_CONTRAST,
  DEFAULT_DEPTH,
  clampDepth,
} from '../background-hue.js';
import {
  DEFAULT_FG_CONTRAST_STRENGTH,
  DEFAULT_FG_CONTRAST_BIAS,
  clampFgContrastStrength,
  clampFgContrastBias,
} from '../fg-contrast.js';
import {
  DEFAULT_TUI_SATURATION,
  clampTuiSaturation,
} from '../tui-saturation.js';
import type { SessionInfo } from '../../shared/types.js';
import {
  notifyDesktopTitlebarDrag,
  requestDesktopToggleMaximize,
  requestDesktopWindowClose,
} from '../desktop-host.js';
import { remoteHostFromPath, remotePathForSession, sessionFromPath } from '../connection.js';

const TITLEBAR_DRAG_RESTORE_THRESHOLD_PX = 4;

/** Typed `getElementById` that throws on a missing id, replacing the
 *  20+ `document.getElementById('…') as HTMLInputElement` casts that
 *  used to silently turn a stale id into a runtime null-deref. The
 *  thrown error names the missing id so an HTML refactor that drops a
 *  control surfaces immediately rather than at the first user
 *  interaction. Only safe for static ids guaranteed to exist by
 *  `index.html` — dynamically-built nodes still need a manual cast. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`tmux-web: missing required element #${id}`);
  }
  return node as T;
}

/** Map a `{type:'window', action:…}` action verb to a human-readable
 *  phrase for the disconnect toast — `select` → "switch window",
 *  `rename` → "rename window", etc. Falls through to a generic
 *  "<action> window" so a future action key still produces something
 *  sensible without needing a new entry here. */
function windowActionLabel(action: string): string {
  switch (action) {
    case 'select': return 'switch window';
    case 'rename': return 'rename window';
    case 'new':    return 'create window';
    case 'close':  return 'close window';
    default:       return `${action} window`;
  }
}

export interface TopbarOptions {
  send: (data: string) => void;
  focus: () => void;
  getLiveSettings: () => SessionSettings | null;
  onAutohideChange?: () => void;
  onSettingsChange?: (s: SessionSettings) => void | Promise<void>;
  /** Switch to a different (or new) session without a full page reload —
   *  caller is expected to update the URL and reconnect the WebSocket. */
  onSwitchSession?: (name: string, remoteHost?: string) => void;
  /** True when the underlying WS is OPEN. Topbar consults this before
   *  firing UI-driven commit messages (rename / kill / select-window /
   *  switch-session etc.) so a click-while-disconnected surfaces a
   *  toast via {@link onOffline} instead of being silently dropped by
   *  `Connection.send`. Default `() => true` keeps existing call sites
   *  (and tests) working unchanged. */
  isOpen?: () => boolean;
  /** Invoked with a short action verb (e.g. "rename session",
   *  "switch window") when an `isOpen()`-guarded UI commit is skipped
   *  because the WS isn't OPEN. Wired in `index.ts` to `showToast`
   *  with an "<action> ignored" message — same shape as the
   *  paste-while-disconnected toast already there. */
  onOffline?: (action: string) => void;
}

export class Topbar {
  private topbar!: HTMLElement;
  private sessionNameEl!: HTMLElement;
  private winTabs!: HTMLElement;
  private tbTitle!: HTMLElement;
  private autohideChk!: HTMLInputElement;
  private scrollbarAutohideChk!: HTMLInputElement;
  private autohide = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActiveWindowIndex: string | null = null;
  private syncSettingsUi?: (s: SessionSettings) => void;
  private cachedWindows: Array<{ index: string; name: string; active: boolean }> = [];
  private cachedTitles: Record<string, string> = {};
  private lastWinTabsKey = '';
  private menuBtn?: HTMLButtonElement;
  private menuDropdown?: HTMLElement;
  private opts: TopbarOptions;
  /** Document-level listeners + any other teardown thunks registered
   *  during {@link init}. Drained by {@link dispose} so multi-mount
   *  test harnesses (and a future window-reuse path) don't leak
   *  listeners across mounts. Production never calls dispose(). */
  private disposers: Array<() => void> = [];

  constructor(opts: TopbarOptions) {
    this.opts = opts;
  }

  async init(): Promise<void> {
    this.topbar = el<HTMLElement>('topbar');
    this.sessionNameEl = el<HTMLElement>('tb-session-name');
    this.sessionNameEl.textContent = this.currentSession;
    this.winTabs = el<HTMLElement>('win-tabs');
    this.tbTitle = el<HTMLElement>('tb-title');
    this.autohideChk = el<HTMLInputElement>('chk-autohide');
    this.scrollbarAutohideChk = el<HTMLInputElement>('chk-scrollbar-autohide');

    this.setupSessionMenu();
    this.setupAutoHide();
    this.setupMenu();
    this.setupFullscreenCheckbox();
    // setupSettingsInputs wires event listeners synchronously and returns a
    // promise for the async font-list fetch. We await here so that callers of
    // init() can rely on fonts being populated (e.g. before opening WebSocket).
    const fontListReady = this.setupSettingsInputs();
    this.setupFocusHandling();
    this.show();
    await fontListReady;
  }

  /** Tear down every document-level listener registered by {@link init}.
   *  Idempotent: a second call is a no-op. Production never invokes
   *  this — it exists so multi-mount test harnesses can clean up
   *  without leaking handlers across runs (mirrors the `__twDispose`
   *  contract in `index.ts`). */
  dispose(): void {
    for (const d of this.disposers.splice(0)) {
      try { d(); } catch (err) { console.warn('Topbar dispose handler threw:', err); }
    }
  }

  private cachedSessions: Array<{ id: string; name: string; windows?: number }> = [];
  private cachedRemoteSessions = new Map<string, Array<{ id: string; name: string; windows?: number }>>();
  private refreshInFlight: { promise: Promise<void>; includeRemote: boolean } | null = null;

  private currentSettingsKey(): string {
    return sessionSettingsKey(this.currentSession, remoteHostFromPath(location.pathname));
  }

  /** Returned promise resolves once `cachedSessions` reflects a fresh
   *  `/api/sessions` response (or the existing cache stays, on error).
   *  Concurrent callers share the in-flight request so two rapid
   *  dropdown opens can't interleave two fetches and leave the cache
   *  pointing at the slower response's payload. */
  private refreshCachedSessions(opts: { includeRemote?: boolean } = {}): Promise<void> {
    const includeRemote = opts.includeRemote === true;
    if (this.refreshInFlight && (!includeRemote || this.refreshInFlight.includeRemote)) {
      return this.refreshInFlight.promise;
    }
    let currentFlight!: { promise: Promise<void>; includeRemote: boolean };
    const p = (async () => {
      try {
        const [running] = await Promise.all([
          fetch('/api/sessions').then(r =>
            r.ok ? r.json() as Promise<Array<{ id: string; name: string; windows?: number }>> : null
          ),
          initSessionStore(),
        ]);
        if (running) this.cachedSessions = running;
        const currentRemoteHost = remoteHostFromPath(location.pathname);
        if (currentRemoteHost) recordKnownRemoteServer(currentRemoteHost);
        if (!includeRemote) return;
        const hosts = getKnownRemoteServers();
        const remoteResults = await Promise.all(hosts.map(async (host) => {
          try {
            const res = await fetch('/api/remote-sessions?host=' + encodeURIComponent(host));
            if (!res.ok) return null;
            const sessions = await res.json() as Array<{ id: string; name: string; windows?: number }>;
            return { host, sessions };
          } catch {
            return null;
          }
        }));
        for (const result of remoteResults) {
          if (result) this.cachedRemoteSessions.set(result.host, result.sessions);
        }
      } catch { /* keep previous cache */ }
      finally {
        if (this.refreshInFlight === currentFlight) this.refreshInFlight = null;
      }
    })();
    currentFlight = { promise: p, includeRemote };
    this.refreshInFlight = currentFlight;
    return p;
  }

  private buildMenuInputRow(opts: {
    label: string;
    defaultValue?: string;
    placeholder?: string;
    /** Fire `onSubmit` even when the input is empty. Callers that map
     *  empty → "use server default" (e.g. New window) opt in; rename
     *  flows don't. */
    allowEmpty?: boolean;
    /** When true the label itself acts as a submit button. Used by
     *  "New window" so the user can click the label to create one
     *  without typing a name. */
    submitOnLabelClick?: boolean;
    onSubmit: (value: string) => void;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tw-menu-row tw-menu-row-static';
    const label = document.createElement('span');
    label.className = 'tw-menu-label';
    label.textContent = opts.label;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tw-dd-input';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.defaultValue) input.value = opts.defaultValue;
    const submit = (): void => {
      const value = input.value.trim();
      if (value || opts.allowEmpty) opts.onSubmit(value);
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      }
    });
    if (opts.submitOnLabelClick) {
      label.classList.add('tw-menu-label-clickable');
      label.addEventListener('click', submit);
    }
    row.appendChild(input);
    return row;
  }

  private appendSessionRow(
    menu: HTMLElement,
    close: () => void,
    opts: {
      session: { id: string | null; name: string; windows?: number };
      isCurrent: boolean;
      isRunning: boolean;
      remoteHost?: string;
      allowDelete?: boolean;
    },
  ): void {
          const s = opts.session;
          const el = document.createElement('div');
          el.className = 'tw-dropdown-item tw-dd-session-item' + (opts.isCurrent ? ' current' : '');
          el.setAttribute('role', 'option');
          el.setAttribute('tabindex', '-1');
          el.setAttribute('aria-selected', opts.isCurrent ? 'true' : 'false');
          const name = document.createElement('span');
          name.className = 'tw-dd-session-name';
          name.textContent = s.name;
          el.appendChild(name);
          if (opts.allowDelete) {
            const del = document.createElement('button');
            del.type = 'button';
            // `tb-btn tw-drops-revoke` mirror the drops-section trashcan — themes
            // that style those classes (e.g. Amiga) pick up the same look.
            del.className = 'tb-btn tw-drops-revoke tw-dd-session-delete';
            del.title = `Delete session "${s.name}".`;
            del.textContent = '\uEA81';
            del.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              ev.preventDefault();
              await deleteSessionSettings(s.name);
              el.remove();
            });
            el.appendChild(del);
          }
          // Window count, only for running sessions where we know it.
          // Sits to the left of the status dot.
          if (opts.isRunning && typeof s.windows === 'number') {
            const count = document.createElement('span');
            count.className = 'tw-dd-session-windows';
            const label = `${s.windows} window${s.windows === 1 ? '' : 's'}`;
            count.textContent = `(${label})`;
            count.title = label;
            count.setAttribute('aria-label', label);
            el.appendChild(count);
          }
          const dot = document.createElement('span');
          dot.className = 'tw-dd-session-status ' + (opts.isRunning ? 'running' : 'stopped');
          // Explicit aria-label on top of the existing `title`: `title` is not
          // reliably exposed as an accessible name across screen readers, so
          // the dot would otherwise carry only colour-coded meaning.
          const status = opts.isRunning ? 'Running' : 'Not running';
          dot.title = status;
          dot.setAttribute('aria-label', status);
          dot.setAttribute('role', 'img');
          el.appendChild(dot);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            close();
            if (opts.isCurrent) return;
            if (!this.guardOnline('switch session')) return;
            this.opts.onSwitchSession?.(s.name, opts.remoteHost);
          });
          menu.appendChild(el);
  }

  private renderSessionsMenu(menu: HTMLElement, close: () => void): void {
        const current = this.currentSession;
        const currentRemoteHost = remoteHostFromPath(location.pathname);

        // Union of running tmux sessions + persisted ones from sessions.json,
        // sorted case-insensitively by name.
        const runningByName = new Map(this.cachedSessions.map(s => [s.name, s]));
        const stored = getStoredSessionNames();
        const ordered: Array<{ id: string | null; name: string; windows?: number }> = [
          ...this.cachedSessions.map(s => ({ id: s.id, name: s.name, windows: s.windows })),
          ...stored
            .filter(n => !runningByName.has(n))
            .map(n => ({ id: null as string | null, name: n })),
        ].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

        // Each row: [ ✓ gutter | name | trashcan? | status dot ]. Stopped
        // sessions also get a trashcan that deletes the stored settings
        // entry from sessions.json.
        for (const s of ordered) {
          const isCurrent = !currentRemoteHost && s.name === current;
          const isRunning = runningByName.has(s.name);
          this.appendSessionRow(menu, close, {
            session: s,
            isCurrent,
            isRunning,
            allowDelete: !isRunning,
          });
        }

        for (const host of getKnownRemoteServers()) {
          const sessions = (this.cachedRemoteSessions.get(host) ?? [])
            .slice()
            .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
          const section = document.createElement('div');
          section.className = 'tw-menu-section';
          section.textContent = host;
          menu.appendChild(section);
          for (const s of sessions) {
            this.appendSessionRow(menu, close, {
              session: s,
              isCurrent: currentRemoteHost === host && s.name === current,
              isRunning: true,
              remoteHost: host,
            });
          }
        }

        // Rename current session
        const sep1 = document.createElement('hr');
        sep1.className = 'tw-dropdown-sep';
        menu.appendChild(sep1);
        menu.appendChild(this.buildMenuInputRow({
          label: 'Name:',
          defaultValue: current,
          onSubmit: (name) => {
            close();
            if (name !== current) {
              if (!this.guardOnline('rename session')) return;
              this.opts.send(JSON.stringify({ type: 'session', action: 'rename', name }));
            }
          },
        }));

        // Create new session (no separator — Name and New session share a block)
        menu.appendChild(this.buildMenuInputRow({
          label: 'New session:',
          placeholder: 'name',
          onSubmit: (name) => {
            close();
            const clean = name.replace(/[^a-zA-Z0-9_\-./]/g, '');
            if (!clean) return;
            if (!this.guardOnline('create session')) return;
            this.opts.onSwitchSession?.(clean);
          },
        }));

  }

  private setupSessionMenu(): void {
    const btn = el<HTMLButtonElement>('btn-session-menu');
    const btnPlus = document.getElementById('btn-session-plus') as HTMLButtonElement | null;

    let sessionDropdown: Dropdown;
    const refreshOpenMenu = (menu: HTMLElement, close: () => void): void => {
      void this.refreshCachedSessions({ includeRemote: true }).then(() => {
        if (sessionDropdown.menuElement.hidden) return;
        menu.innerHTML = '';
        this.renderSessionsMenu(menu, close);
      });
    };

    sessionDropdown = Dropdown.custom(btn, {
      className: 'tw-dd-sessions',
      renderContent: (menu, close) => {
        this.renderSessionsMenu(menu, close);
        refreshOpenMenu(menu, close);
      },
    });

    void this.refreshCachedSessions();

    // Right-click behaves like left-click — opens the same rich session
    // menu (Name, New session, and per-row delete for stopped sessions).
    btn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (sessionDropdown.menuElement.hidden) {
        void sessionDropdown.open();
      } else {
        sessionDropdown.close();
      }
    });

    btnPlus?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      requestDesktopWindowClose();
    });
    this.tbTitle.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      requestDesktopToggleMaximize();
    });
    let pendingTitleDrag: { x: number; y: number; restored: boolean } | null = null;
    this.tbTitle.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      pendingTitleDrag = { x: ev.clientX, y: ev.clientY, restored: false };
    });
    const onTitleDragMove = (ev: MouseEvent): void => {
      if (!pendingTitleDrag || pendingTitleDrag.restored) return;
      const dx = ev.clientX - pendingTitleDrag.x;
      const dy = ev.clientY - pendingTitleDrag.y;
      if (Math.hypot(dx, dy) < TITLEBAR_DRAG_RESTORE_THRESHOLD_PX) return;
      pendingTitleDrag.restored = true;
      notifyDesktopTitlebarDrag();
    };
    // Match the mousedown's `ev.button === 0` filter so a non-left-button
    // mouseup (e.g. middle-click between the press and the real release)
    // doesn't silently clear the drag and swallow the subsequent
    // drag-to-restore notification. F2 / cluster 12.
    const onTitleDragUp = (ev: MouseEvent): void => {
      if (ev.button === 0) pendingTitleDrag = null;
    };
    document.addEventListener('mousemove', onTitleDragMove);
    document.addEventListener('mouseup', onTitleDragUp);
    this.disposers.push(() => document.removeEventListener('mousemove', onTitleDragMove));
    this.disposers.push(() => document.removeEventListener('mouseup', onTitleDragUp));
  }

  private setupMenu(): void {
    const menuWrap = el<HTMLElement>('menu-wrap');
    const menuBtn = el<HTMLButtonElement>('btn-menu');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    const dropdown = el<HTMLElement>('menu-dropdown');
    const footerLeft = document.getElementById('menu-footer-left');
    const footerRight = document.getElementById('menu-footer-right');
    if (footerLeft && footerRight) {
      const version = window.__TMUX_WEB_CONFIG?.version ?? '';
      // Anchor to the project repo. .tw-menu-footer-link inherits colour /
      // text-decoration from #menu-footer so appearance is unchanged.
      const link = document.createElement('a');
      link.href = 'https://github.com/tuxie/tmux-web';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'tw-menu-footer-link';
      link.textContent = `tmux-web v${version}`;
      footerLeft.replaceChildren(link);
      footerRight.textContent = '© Per Wigren <per@wigren.eu>';
    }

    // Reopen the menu if a settings-change reload happened while it was open
    // menu-reopen flag is consumed synchronously by an inline <script> in index.html
    // (via window.__menuReopen) to avoid a race where the flag lingers in sessionStorage
    // if a subsequent reload happens before this module script runs.
    this.menuBtn = menuBtn;
    this.menuDropdown = dropdown;

    if (window.__menuReopen) {
      window.__menuReopen = false;
      this.setConfigMenuOpen(true);
      const chkFs = el<HTMLInputElement>('chk-fullscreen');
      if (chkFs) chkFs.checked = !!document.fullscreenElement;
    }

    const toggleConfigMenu = (ev: Event): void => {
      ev.preventDefault();
      ev.stopPropagation();
      // TS 6's lib.dom widens `HTMLElement.hidden` to `boolean | "until-found"`.
      // We only toggle between true and false, so coerce.
      const nextOpen = dropdown.hidden === true;
      this.setConfigMenuOpen(nextOpen);
      if (nextOpen) {
        // Sync fullscreen checkbox state on open
        const chkFs = el<HTMLInputElement>('chk-fullscreen');
        chkFs.checked = !!document.fullscreenElement;
      } else {
        this.opts.focus();
        this.show();
      }
    };
    menuBtn.addEventListener('click', toggleConfigMenu);
    menuBtn.addEventListener('contextmenu', toggleConfigMenu);

    // Close dropdown only when the user physically clicks outside the menu wrapper.
    // Use pointerdown (not click) so synthetic events fired during terminal redraws
    // don't inadvertently close the dropdown.
    const onMenuPointerDown = (ev: PointerEvent): void => {
      if (!dropdown.hidden && !menuWrap.contains(ev.target as Node)) {
        this.setConfigMenuOpen(false);
        this.opts.focus();
        this.show();
      }
    };
    document.addEventListener('pointerdown', onMenuPointerDown);
    this.disposers.push(() => document.removeEventListener('pointerdown', onMenuPointerDown));
  }

  /** Keep #menu-dropdown.hidden and #btn-menu.open in lockstep so themes
   *  can render a pressed look while the settings menu is showing. */
  private setConfigMenuOpen(open: boolean): void {
    if (!this.menuDropdown) return;
    this.menuDropdown.hidden = !open;
    this.menuBtn?.classList.toggle('open', open);
    this.menuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  private setupFullscreenCheckbox(): void {
    const chkFs = el<HTMLInputElement>('chk-fullscreen');
    chkFs.addEventListener('change', () => this.toggleFullscreen());
    const onFullscreenChange = (): void => {
      chkFs.checked = !!document.fullscreenElement;
      this.show();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    this.disposers.push(() => document.removeEventListener('fullscreenchange', onFullscreenChange));
  }

  // Returns a Promise that resolves once the async data fetches complete.
  private async setupSettingsInputs(): Promise<void> {
    // Static-id lookups via the typed `el<T>()` helper above — a missing
    // or renamed id throws with a clear message instead of silently
    // returning null and surfacing as a runtime null-deref later.
    const themeSelect = el<HTMLSelectElement>('inp-theme');
    const coloursSelect = el<HTMLSelectElement>('inp-colours');
    const btnResetColours = el<HTMLButtonElement>('btn-reset-colours');
    const fontSelect = el<HTMLSelectElement>('inp-font-bundled');
    const btnResetFont = el<HTMLButtonElement>('btn-reset-font');
    const sldSize = el<HTMLInputElement>('sld-fontsize');
    const inpSize = el<HTMLInputElement>('inp-fontsize');
    const sldHeight = el<HTMLInputElement>('sld-spacing');
    const inpHeight = el<HTMLInputElement>('inp-spacing');
    const sldTuiBgOpacity = el<HTMLInputElement>('sld-tui-bg-opacity');
    const inpTuiBgOpacity = el<HTMLInputElement>('inp-tui-bg-opacity');
    const sldTuiFgOpacity = el<HTMLInputElement>('sld-tui-fg-opacity');
    const inpTuiFgOpacity = el<HTMLInputElement>('inp-tui-fg-opacity');
    const sldOpacity = el<HTMLInputElement>('sld-opacity');
    const inpOpacity = el<HTMLInputElement>('inp-opacity');
    const sldThemeHue = el<HTMLInputElement>('sld-theme-hue');
    const inpThemeHue = el<HTMLInputElement>('inp-theme-hue');
    const sldThemeSat = el<HTMLInputElement>('sld-theme-sat');
    const inpThemeSat = el<HTMLInputElement>('inp-theme-sat');
    const sldThemeLtn = el<HTMLInputElement>('sld-theme-ltn');
    const inpThemeLtn = el<HTMLInputElement>('inp-theme-ltn');
    const sldThemeContrast = el<HTMLInputElement>('sld-theme-contrast');
    const inpThemeContrast = el<HTMLInputElement>('inp-theme-contrast');
    const sldDepth = el<HTMLInputElement>('sld-depth');
    const inpDepth = el<HTMLInputElement>('inp-depth');
    const sldBackgroundHue = el<HTMLInputElement>('sld-background-hue');
    const inpBackgroundHue = el<HTMLInputElement>('inp-background-hue');
    const sldBackgroundSaturation = el<HTMLInputElement>('sld-background-saturation');
    const inpBackgroundSaturation = el<HTMLInputElement>('inp-background-saturation');
    const sldBackgroundBrightest = el<HTMLInputElement>('sld-background-brightest');
    const inpBackgroundBrightest = el<HTMLInputElement>('inp-background-brightest');
    const sldBackgroundDarkest = el<HTMLInputElement>('sld-background-darkest');
    const inpBackgroundDarkest = el<HTMLInputElement>('inp-background-darkest');
    const sldFgContrastStrength = el<HTMLInputElement>('sld-fg-contrast-strength');
    const inpFgContrastStrength = el<HTMLInputElement>('inp-fg-contrast-strength');
    const sldFgContrastBias = el<HTMLInputElement>('sld-fg-contrast-bias');
    const inpFgContrastBias = el<HTMLInputElement>('inp-fg-contrast-bias');
    const sldTuiSaturation = el<HTMLInputElement>('sld-tui-saturation');
    const inpTuiSaturation = el<HTMLInputElement>('inp-tui-saturation');

    const [fonts, themes, colours] = await Promise.all([listFonts(), listThemes(), fetchColours()]);

    // Populate theme select
    themeSelect.innerHTML = '';
    for (const theme of themes) {
      const opt = document.createElement('option');
      opt.value = theme.name;
      opt.textContent = theme.name;
      themeSelect.appendChild(opt);
    }

    // Populate colours select
    coloursSelect.innerHTML = '';
    for (const col of colours) {
      const opt = document.createElement('option');
      opt.value = col.name;
      opt.textContent = col.name;
      coloursSelect.appendChild(opt);
    }

    // Populate font select. Setting opt.title gives the native <option>
    // a tooltip; Dropdown.fromSelect's getItems propagates it to the
    // visible custom dropdown items so the copyright credit shows in
    // both places.
    fontSelect.innerHTML = '';
    for (const font of fonts) {
      if (font.hidden) continue;
      const opt = document.createElement('option');
      opt.value = font.family;
      opt.textContent = font.family;
      if (font.copyright) opt.title = `${font.family} © ${font.copyright}`;
      fontSelect.appendChild(opt);
    }

    // Replace the three native <select>s with custom themable dropdowns.
    // The <select> stays in the DOM (hidden) as source of truth for value,
    // options, and change events — so existing listeners and Playwright's
    // selectOption keep working unchanged.
    const ddTheme = Dropdown.fromSelect(themeSelect);
    const ddColours = Dropdown.fromSelect(coloursSelect);
    const ddFont = Dropdown.fromSelect(fontSelect);
    // Flex is applied via `#menu-dropdown .tw-dropdown { flex: 1 }` in base.css.

    const getSettings = (): SessionSettings => {
      const live = this.opts.getLiveSettings();
      return loadSessionSettings(this.currentSettingsKey(), live, { defaults: DEFAULT_SESSION_SETTINGS });
    };

    // Keep a CSS custom property on each range input reflecting its value
    // as a percentage of (max - min), so themes can paint the "filled" part
    // of the track (WebKit has no native ::-moz-range-progress equivalent).
    const updateSliderFill = (slider: HTMLInputElement): void => {
      const min = parseFloat(slider.min || '0');
      const max = parseFloat(slider.max || '100');
      const val = parseFloat(slider.value);
      const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
      slider.style.setProperty('--tw-slider-val', pct + '%');
    };

    const commit = (patch: Partial<SessionSettings>) => {
      const current = getSettings();
      const updated: SessionSettings = { ...current, ...patch };
      saveSessionSettings(this.currentSettingsKey(), updated);
      this.opts.onSettingsChange?.(updated);
    };

    /** Single source of truth for every numeric slider + number-input
     *  pair in the settings menu. `parse` + `clamp` run on every commit
     *  path; `getDefault` resolves the current active-theme default (or
     *  the hard-coded fallback) for the dblclick-to-reset gesture.
     *  Also drives `syncUi` and `refreshAllSliderFills` so adding a new
     *  slider only requires one entry here + one HTML row. */
    type SliderSpec = {
      slider: HTMLInputElement;
      input: HTMLInputElement;
      key: keyof SessionSettings;
      parse: (s: string) => number;
      clamp: (v: number) => number;
      getDefault: () => number;
    };
    const activeTheme = () => themes.find(t => t.name === getSettings().theme);
    const parseInt10 = (s: string): number => parseInt(s, 10);
    const sliders: SliderSpec[] = [
      { slider: sldSize, input: inpSize, key: 'fontSize', parse: parseFloat, clamp: clampFontSize,
        getDefault: () => activeTheme()?.defaultFontSize ?? DEFAULT_SESSION_SETTINGS.fontSize },
      { slider: sldHeight, input: inpHeight, key: 'spacing', parse: parseFloat, clamp: clampSpacing,
        getDefault: () => activeTheme()?.defaultSpacing ?? DEFAULT_SESSION_SETTINGS.spacing },
      { slider: sldTuiBgOpacity, input: inpTuiBgOpacity, key: 'tuiBgOpacity', parse: parseInt10, clamp: clampPercent0to100,
        getDefault: () => activeTheme()?.defaultTuiBgOpacity ?? DEFAULT_SESSION_SETTINGS.tuiBgOpacity },
      { slider: sldTuiFgOpacity, input: inpTuiFgOpacity, key: 'tuiFgOpacity', parse: parseInt10, clamp: clampPercent0to100,
        getDefault: () => activeTheme()?.defaultTuiFgOpacity ?? DEFAULT_SESSION_SETTINGS.tuiFgOpacity },
      { slider: sldOpacity, input: inpOpacity, key: 'opacity', parse: parseInt10, clamp: clampPercent0to100,
        getDefault: () => activeTheme()?.defaultOpacity ?? DEFAULT_SESSION_SETTINGS.opacity },
      { slider: sldFgContrastStrength, input: inpFgContrastStrength, key: 'fgContrastStrength', parse: parseInt10, clamp: clampFgContrastStrength,
        getDefault: () => DEFAULT_FG_CONTRAST_STRENGTH },
      { slider: sldFgContrastBias, input: inpFgContrastBias, key: 'fgContrastBias', parse: parseInt10, clamp: clampFgContrastBias,
        getDefault: () => DEFAULT_FG_CONTRAST_BIAS },
      { slider: sldTuiSaturation, input: inpTuiSaturation, key: 'tuiSaturation', parse: parseInt10, clamp: clampTuiSaturation,
        getDefault: () => activeTheme()?.defaultTuiSaturation ?? DEFAULT_TUI_SATURATION },
      { slider: sldThemeHue, input: inpThemeHue, key: 'themeHue', parse: parseInt10, clamp: clampThemeHue,
        getDefault: () => activeTheme()?.defaultThemeHue ?? DEFAULT_THEME_HUE },
      { slider: sldThemeSat, input: inpThemeSat, key: 'themeSat', parse: parseInt10, clamp: clampThemeSat,
        getDefault: () => activeTheme()?.defaultThemeSat ?? DEFAULT_THEME_SAT },
      { slider: sldThemeLtn, input: inpThemeLtn, key: 'themeLtn', parse: parseInt10, clamp: clampThemeLtn,
        getDefault: () => activeTheme()?.defaultThemeLtn ?? DEFAULT_THEME_LTN },
      { slider: sldThemeContrast, input: inpThemeContrast, key: 'themeContrast', parse: parseInt10, clamp: clampThemeContrast,
        getDefault: () => activeTheme()?.defaultThemeContrast ?? DEFAULT_THEME_CONTRAST },
      { slider: sldDepth, input: inpDepth, key: 'depth', parse: parseInt10, clamp: clampDepth,
        getDefault: () => activeTheme()?.defaultDepth ?? DEFAULT_DEPTH },
      { slider: sldBackgroundHue, input: inpBackgroundHue, key: 'backgroundHue', parse: parseInt10, clamp: clampBackgroundHue,
        getDefault: () => activeTheme()?.defaultBackgroundHue ?? DEFAULT_BACKGROUND_HUE },
      { slider: sldBackgroundSaturation, input: inpBackgroundSaturation, key: 'backgroundSaturation', parse: parseInt10, clamp: clampBackgroundSaturation,
        getDefault: () => activeTheme()?.defaultBackgroundSaturation ?? DEFAULT_BACKGROUND_SATURATION },
      { slider: sldBackgroundBrightest, input: inpBackgroundBrightest, key: 'backgroundBrightest', parse: parseInt10, clamp: clampBackgroundBrightest,
        getDefault: () => activeTheme()?.defaultBackgroundBrightest ?? DEFAULT_BACKGROUND_BRIGHTEST },
      { slider: sldBackgroundDarkest, input: inpBackgroundDarkest, key: 'backgroundDarkest', parse: parseInt10, clamp: clampBackgroundDarkest,
        getDefault: () => activeTheme()?.defaultBackgroundDarkest ?? DEFAULT_BACKGROUND_DARKEST },
    ];

    const refreshAllSliderFills = (): void => {
      for (const sp of sliders) updateSliderFill(sp.slider);
    };

    for (const sp of sliders) {
      // 1. Slider drag (input event): clamp, mirror into number input, commit.
      sp.slider.addEventListener('input', () => {
        const v = sp.clamp(sp.parse(sp.slider.value));
        sp.input.value = String(v);
        commit({ [sp.key]: v } as Partial<SessionSettings>);
      });
      // 2. Number input edit (change event): same, plus slider track fill refresh.
      sp.input.addEventListener('change', () => {
        const v = sp.clamp(sp.parse(sp.input.value));
        sp.slider.value = sp.input.value = String(v);
        updateSliderFill(sp.slider);
        commit({ [sp.key]: v } as Partial<SessionSettings>);
      });
      // 3. Double-click-to-reset (on either half): resolve active-theme
      //    default lazily so a theme switch doesn't stale-capture.
      //    Run the resolved default through the slider's own clamp so
      //    a malformed theme.json default (e.g. defaultThemeContrast: -200)
      //    can't bypass the per-commit clamps and land in sessions.json.
      const reset = () => {
        const def = sp.clamp(sp.getDefault());
        sp.slider.value = sp.input.value = String(def);
        updateSliderFill(sp.slider);
        commit({ [sp.key]: def } as Partial<SessionSettings>);
      };
      sp.slider.addEventListener('dblclick', reset);
      sp.input.addEventListener('dblclick', reset);
    }

    const syncUi = (s: SessionSettings) => {
      this.syncAutohideSettings(s);
      ddTheme.setValue(s.theme);
      ddColours.setValue(s.colours);
      ddFont.setValue(s.fontFamily);
      for (const sp of sliders) {
        const v = String(s[sp.key]);
        sp.slider.value = sp.input.value = v;
      }
      refreshAllSliderFills();
    };
    // Expose so updateSession() can refresh the visible controls when tmux
    // switches sessions underneath us.
    this.syncSettingsUi = syncUi;

    syncUi(getSettings());

    themeSelect.addEventListener('change', async () => {
      const name = themeSelect.value;
      await applyTheme(name);
      const theme = themes.find(t => t.name === name);
      const td: ThemeDefaults = {};
      if (theme?.defaultColours) td.colours = theme.defaultColours;
      if (theme?.defaultFont) td.fontFamily = theme.defaultFont;
      if (theme?.defaultFontSize !== undefined) td.fontSize = theme.defaultFontSize;
      if (theme?.defaultSpacing !== undefined) td.spacing = theme.defaultSpacing;
      if (theme?.defaultOpacity !== undefined) td.opacity = theme.defaultOpacity;
      if (theme?.defaultTuiBgOpacity !== undefined) td.tuiBgOpacity = theme.defaultTuiBgOpacity;
      if (theme?.defaultTuiFgOpacity !== undefined) td.tuiFgOpacity = theme.defaultTuiFgOpacity;
      if (theme?.defaultTuiSaturation !== undefined) td.tuiSaturation = theme.defaultTuiSaturation;
      if (theme?.defaultFgContrastStrength !== undefined) td.fgContrastStrength = theme.defaultFgContrastStrength;
      if (theme?.defaultFgContrastBias !== undefined) td.fgContrastBias = theme.defaultFgContrastBias;
      if (theme?.defaultThemeHue !== undefined) td.themeHue = theme.defaultThemeHue;
      if (theme?.defaultThemeSat !== undefined) td.themeSat = theme.defaultThemeSat;
      if (theme?.defaultThemeLtn !== undefined) td.themeLtn = theme.defaultThemeLtn;
      if (theme?.defaultThemeContrast !== undefined) td.themeContrast = theme.defaultThemeContrast;
      if (theme?.defaultDepth !== undefined) td.depth = theme.defaultDepth;
      if (theme?.defaultBackgroundHue !== undefined) td.backgroundHue = theme.defaultBackgroundHue;
      if (theme?.defaultBackgroundSaturation !== undefined) td.backgroundSaturation = theme.defaultBackgroundSaturation;
      if (theme?.defaultBackgroundBrightest !== undefined) td.backgroundBrightest = theme.defaultBackgroundBrightest;
      if (theme?.defaultBackgroundDarkest !== undefined) td.backgroundDarkest = theme.defaultBackgroundDarkest;
      td.topbarAutohide = theme?.defaultTopbarAutohide ?? DEFAULT_SESSION_SETTINGS.topbarAutohide;
      td.scrollbarAutohide = theme?.defaultScrollbarAutohide ?? DEFAULT_SESSION_SETTINGS.scrollbarAutohide;
      const current = getSettings();
      const updated = applyThemeDefaults({ ...current, theme: name }, td);
      saveSessionSettings(this.currentSettingsKey(), updated);
      syncUi(updated);
      this.opts.onSettingsChange?.(updated);
    });

    coloursSelect.addEventListener('change', () => {
      commit({ colours: coloursSelect.value });
    });

    btnResetColours.addEventListener('click', () => {
      const current = getSettings();
      const theme = themes.find(t => t.name === current.theme);
      const patch: Partial<SessionSettings> = {};
      if (theme?.defaultColours) {
        ddColours.setValue(theme.defaultColours);
        patch.colours = theme.defaultColours;
      }
      if (theme?.defaultOpacity !== undefined) {
        sldOpacity.value = inpOpacity.value = String(theme.defaultOpacity);
        updateSliderFill(sldOpacity);
        patch.opacity = theme.defaultOpacity;
      }
      const tuiBgOpacity = theme?.defaultTuiBgOpacity ?? DEFAULT_SESSION_SETTINGS.tuiBgOpacity;
      sldTuiBgOpacity.value = inpTuiBgOpacity.value = String(tuiBgOpacity);
      updateSliderFill(sldTuiBgOpacity);
      patch.tuiBgOpacity = tuiBgOpacity;
      const tuiFgOpacity = theme?.defaultTuiFgOpacity ?? DEFAULT_SESSION_SETTINGS.tuiFgOpacity;
      sldTuiFgOpacity.value = inpTuiFgOpacity.value = String(tuiFgOpacity);
      updateSliderFill(sldTuiFgOpacity);
      patch.tuiFgOpacity = tuiFgOpacity;
      const bgHue = theme?.defaultBackgroundHue ?? DEFAULT_BACKGROUND_HUE;
      sldBackgroundHue.value = inpBackgroundHue.value = String(bgHue);
      updateSliderFill(sldBackgroundHue);
      patch.backgroundHue = bgHue;
      const bgSat = theme?.defaultBackgroundSaturation ?? DEFAULT_BACKGROUND_SATURATION;
      sldBackgroundSaturation.value = inpBackgroundSaturation.value = String(bgSat);
      updateSliderFill(sldBackgroundSaturation);
      patch.backgroundSaturation = bgSat;
      const bgBright = theme?.defaultBackgroundBrightest ?? DEFAULT_BACKGROUND_BRIGHTEST;
      sldBackgroundBrightest.value = inpBackgroundBrightest.value = String(bgBright);
      updateSliderFill(sldBackgroundBrightest);
      patch.backgroundBrightest = bgBright;
      const bgDark = theme?.defaultBackgroundDarkest ?? DEFAULT_BACKGROUND_DARKEST;
      sldBackgroundDarkest.value = inpBackgroundDarkest.value = String(bgDark);
      updateSliderFill(sldBackgroundDarkest);
      sldFgContrastStrength.value = inpFgContrastStrength.value = String(DEFAULT_FG_CONTRAST_STRENGTH);
      updateSliderFill(sldFgContrastStrength);
      patch.fgContrastStrength = DEFAULT_FG_CONTRAST_STRENGTH;
      sldFgContrastBias.value = inpFgContrastBias.value = String(DEFAULT_FG_CONTRAST_BIAS);
      updateSliderFill(sldFgContrastBias);
      patch.fgContrastBias = DEFAULT_FG_CONTRAST_BIAS;
      const tuiSaturation = theme?.defaultTuiSaturation ?? DEFAULT_SESSION_SETTINGS.tuiSaturation;
      sldTuiSaturation.value = inpTuiSaturation.value = String(tuiSaturation);
      updateSliderFill(sldTuiSaturation);
      patch.tuiSaturation = tuiSaturation;
      const themeHue = theme?.defaultThemeHue ?? DEFAULT_THEME_HUE;
      sldThemeHue.value = inpThemeHue.value = String(themeHue);
      updateSliderFill(sldThemeHue);
      patch.themeHue = themeHue;
      patch.backgroundDarkest = bgDark;
      if (Object.keys(patch).length) commit(patch);
    });

    fontSelect.addEventListener('change', () => {
      commit({ fontFamily: fontSelect.value });
    });

    btnResetFont.addEventListener('click', () => {
      const current = getSettings();
      const theme = themes.find(t => t.name === current.theme);
      const patch: Partial<SessionSettings> = {};
      if (theme?.defaultFont) {
        ddFont.setValue(theme.defaultFont);
        patch.fontFamily = theme.defaultFont;
      }
      if (theme?.defaultFontSize !== undefined) {
        sldSize.value = inpSize.value = String(theme.defaultFontSize);
        updateSliderFill(sldSize);
        patch.fontSize = theme.defaultFontSize;
      }
      if (theme?.defaultSpacing !== undefined) {
        sldHeight.value = inpHeight.value = String(theme.defaultSpacing);
        updateSliderFill(sldHeight);
        patch.spacing = theme.defaultSpacing;
      }
      if (Object.keys(patch).length) commit(patch);
    });

    // Per-slider input / change / dblclick wiring is data-driven from
    // the `sliders` table above. Reset-to-default lookup is lazy so a
    // theme switch between dblclicks picks up the new default.
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  private applyPinnedClass(): void {
    document.body.classList.toggle('topbar-pinned', !this.autohide);
  }

  private syncAutohideSettings(s: SessionSettings): void {
    const wasAutohide = this.autohide;
    this.autohide = s.topbarAutohide;
    this.autohideChk.checked = this.autohide;
    this.scrollbarAutohideChk.checked = s.scrollbarAutohide;
    this.applyPinnedClass();
    if (wasAutohide && !this.autohide) {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = null;
      this.topbar.classList.remove('hidden');
    } else if (!wasAutohide && this.autohide) {
      this.show();
    }
  }

  private commitAutohide(patch: Pick<Partial<SessionSettings>, 'topbarAutohide' | 'scrollbarAutohide'>): void {
    // F3 / cluster 12 belt-and-braces: `getLiveSettings()` returns null
    // during the boot path before the session store resolves. `main()`
    // awaits `initSessionStore` before constructing Topbar (index.ts:74)
    // so a user can't physically tick the autohide checkbox before live
    // settings exist — but if that invariant is ever broken, committing
    // here would clobber the persisted settings with `DEFAULT_SESSION_
    // SETTINGS + patch`. Skip until the live settings exist.
    const live = this.opts.getLiveSettings();
    if (!live) return;
    const current = loadSessionSettings(this.currentSettingsKey(), live, {
      defaults: DEFAULT_SESSION_SETTINGS,
    });
    const updated: SessionSettings = { ...current, ...patch };
    saveSessionSettings(this.currentSettingsKey(), updated);
    this.syncAutohideSettings(updated);
    this.opts.onSettingsChange?.(updated);
    this.opts.onAutohideChange?.();
  }

  private setupAutoHide(): void {
    const initialSettings = loadSessionSettings(this.currentSettingsKey(), this.opts.getLiveSettings(), {
      defaults: DEFAULT_SESSION_SETTINGS,
    });
    this.syncAutohideSettings(initialSettings);
    this.autohideChk.addEventListener('change', () => {
      this.commitAutohide({ topbarAutohide: this.autohideChk.checked });
    });
    this.scrollbarAutohideChk.addEventListener('change', () => {
      this.commitAutohide({ scrollbarAutohide: this.scrollbarAutohideChk.checked });
    });

    const onAutohideReveal = (ev: MouseEvent): void => {
      if (ev.clientY < 28 * 3) this.show();
    };
    document.addEventListener('mousemove', onAutohideReveal);
    this.disposers.push(() => document.removeEventListener('mousemove', onAutohideReveal));
    this.topbar.addEventListener('mouseenter', () => {
      if (this.hideTimer) clearTimeout(this.hideTimer);
    });
    this.topbar.addEventListener('mouseleave', () => this.show());
  }

  private setupFocusHandling(): void {
    this.topbar.addEventListener('mousedown', (ev) => {
      const tag = (ev.target as HTMLElement).tagName;
      if (tag !== 'SELECT' && tag !== 'INPUT') ev.preventDefault();
    });
    this.topbar.addEventListener('click', (ev) => {
      const tag = (ev.target as HTMLElement).tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT') this.opts.focus();
    });
  }

  show(): void {
    const dropdown = document.getElementById('menu-dropdown') as HTMLElement | null;
    const dropdownOpen = dropdown && !dropdown.hidden;
    const anyCustomOpen = !!document.querySelector('.tw-dropdown-menu:not([hidden])');

    this.topbar.classList.remove('hidden');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.autohide && !dropdownOpen && !anyCustomOpen) {
      this.hideTimer = setTimeout(() => {
        this.topbar.classList.add('hidden');
        this.setConfigMenuOpen(false);
      }, 1000);
    } else {
      this.hideTimer = null;
    }
  }

  get currentSession(): string {
    return sessionFromPath(location.pathname);
  }

  /** Gate a UI-driven WS commit on the current connection state. When
   *  the WS isn't OPEN, surfaces an "<action> ignored" toast via
   *  `opts.onOffline` and returns `false` so the caller can short-circuit
   *  any optimistic local work that would otherwise be left orphaned.
   *  Mirrors the paste-handler check in `index.ts` so every UI commit
   *  fails visibly rather than silently. Falls through to `true` when
   *  `isOpen` isn't wired (older callers / tests). */
  private guardOnline(action: string): boolean {
    if (!this.opts.isOpen || this.opts.isOpen()) return true;
    this.opts.onOffline?.(action);
    return false;
  }

  private sendWindowMsg(msg: { action: string; index?: string; name?: string }): void {
    // All window actions go through typed WS messages that the server
    // runs via the tmux binary directly. This avoids depending on the
    // user's tmux prefix binding (which may not be C-s) or the PTY's
    // current input mode.
    if (!this.guardOnline(windowActionLabel(msg.action))) return;
    this.opts.send(JSON.stringify({ type: 'window', ...msg }));
  }

  /** Build a `.tw-menu-row` containing a labelled checkbox. */
  private buildMenuCheckboxRow(opts: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tw-menu-row';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = opts.checked;
    chk.addEventListener('change', () => opts.onChange(chk.checked));
    row.appendChild(chk);
    const text = document.createElement('span');
    text.textContent = opts.label;
    row.appendChild(text);
    return row;
  }

  /** Shared windows-menu body (rendered in a contextmenu popup). */
  private renderWindowsMenu(menu: HTMLElement, close: () => void): void {
    const activeWin = this.cachedWindows.find(w => w.active);
    const activeIdx = activeWin?.index ?? '';
    const activeName = activeWin?.name ?? '';

    for (const w of this.cachedWindows) {
      const isCurrent = w.active;
      const el = document.createElement('div');
      el.className = 'tw-dropdown-item tw-dd-session-item' + (isCurrent ? ' current' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
      el.textContent = w.index + ': ' + w.name;
      const paneTitle = this.cachedTitles[w.index];
      if (paneTitle) el.title = paneTitle;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        close();
        if (!isCurrent) this.sendWindowMsg({ action: 'select', index: w.index });
      });
      menu.appendChild(el);
    }

    const sep1 = document.createElement('hr');
    sep1.className = 'tw-dropdown-sep';
    menu.appendChild(sep1);

    menu.appendChild(this.buildMenuInputRow({
      label: 'Name:',
      defaultValue: activeName,
      onSubmit: (name) => {
        close();
        if (activeIdx && name !== activeName) {
          this.sendWindowMsg({ action: 'rename', index: activeIdx, name });
        }
      },
    }));
    menu.appendChild(this.buildMenuInputRow({
      label: 'New window:',
      placeholder: 'name',
      allowEmpty: true,
      submitOnLabelClick: true,
      onSubmit: (name) => {
        close();
        // Empty name → let tmux pick its default; non-empty → use as-is.
        this.sendWindowMsg(name ? { action: 'new', name } : { action: 'new' });
      },
    }));

    const sep2 = document.createElement('hr');
    sep2.className = 'tw-dropdown-sep';
    menu.appendChild(sep2);

    menu.appendChild(this.buildMenuCheckboxRow({
      label: 'Show windows as tabs',
      checked: getShowWindowTabs(),
      onChange: (checked) => {
        setShowWindowTabs(checked);
        close();
        this.renderWinTabs();
      },
    }));

    const sep3 = document.createElement('hr');
    sep3.className = 'tw-dropdown-sep';
    menu.appendChild(sep3);

    if (activeIdx) {
      const closeItem = document.createElement('div');
      closeItem.className = 'tw-dropdown-item';
      closeItem.textContent = `Close window ${activeIdx}: ${activeName}\u2026`;
      closeItem.addEventListener('click', (ev) => {
        ev.stopPropagation();
        close();
        // Themed confirm-modal in place of native confirm() — cluster
        // 13 / F4. (The kill-session callsite that used to share this
        // pattern was retired with the menu row in 1.10.0.)
        void showConfirmModal<boolean>({
          title: 'Close window?',
          body: `Close window "${activeName}"?`,
          buttons: [
            { label: 'Cancel', value: false },
            { label: 'Close window', value: true, kind: 'destructive', defaultFocus: true },
          ],
        }).then((ok) => {
          if (!ok) return;
          this.sendWindowMsg({ action: 'close', index: activeIdx });
        });
      });
      menu.appendChild(closeItem);
    }
  }

  /** Open the shared windows menu, anchored below the given trigger button.
   *  Adds a `.open` class to the trigger while the menu is showing so
   *  themes can render a pressed state (like the session button). */
  private openWindowsMenu(trigger: HTMLElement): void {
    trigger.classList.add('open');
    const rect = trigger.getBoundingClientRect();
    showContextMenu({
      // Right-aligned to the trigger (x = anchor's right edge, menu shifts
      // left by its own width). +1px so the menu's right edge lines up
      // one device pixel inside the button's edge. Vertical: flush to
      // the trigger's bottom so it sits at the same level as the
      // session / settings menus.
      x: rect.right + 1,
      y: rect.bottom,
      alignRight: true,
      className: 'tw-dd-windows',
      // Match the trigger's width — without this, tw-dd-context strips
      // min-width and the menu collapses to its content, which looks
      // narrower and inconsistent next to the sessions/settings menus.
      minWidth: rect.width,
      renderContent: (menu, close) => this.renderWindowsMenu(menu, close),
      onClose: () => trigger.classList.remove('open'),
    });
  }

  /** Build the session-button-mirror [ name | ▣ ] button used to open the
   *  windows menu. Shown at the end of the tab strip in tabs mode and on
   *  its own in compact mode. Left-click opens the menu, right-click creates
   *  a new (unnamed) window. */
  private buildWindowsMenuButton(): HTMLElement {
    const active = this.cachedWindows.find(w => w.active);
    const label = active ? `${active.index}: ${active.name}` : '\u2026';
    const wrap = document.createElement('button');
    wrap.type = 'button';
    // When the tab strip is showing, the label is redundant with the tabs —
    // the .tabs-shown class lets theme CSS collapse it away (gadget only).
    wrap.className = 'tb-btn tb-btn-window-compact'
      + (getShowWindowTabs() ? ' tabs-shown' : '');
    wrap.title = 'Windows';

    const labelEl = document.createElement('span');
    labelEl.className = 'tb-window-compact-label';
    labelEl.textContent = label;
    wrap.appendChild(labelEl);

    const plus = document.createElement('span');
    plus.className = 'tb-window-compact-plus';
    wrap.appendChild(plus);

    wrap.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.openWindowsMenu(wrap);
    });
    wrap.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.sendWindowMsg({ action: 'new' });
    });
    return wrap;
  }

  /** Re-render the #win-tabs contents based on the current showWindowTabs pref.
   *  Idempotent: when the resulting DOM would be identical (same windows,
   *  same tabs-mode pref), we skip the re-render to avoid destroying the
   *  compact window button mid-interaction. Without this, any tmux push
   *  arriving while the windows menu is open would re-create the button
   *  and strip its `.open` class, making the trigger look "released" while
   *  the menu is still visible. */
  private renderWinTabs(): void {
    const windows = this.cachedWindows;
    const key = JSON.stringify({ w: windows, t: getShowWindowTabs() });
    if (key === this.lastWinTabsKey) return;
    this.lastWinTabsKey = key;
    this.winTabs.innerHTML = '';

    if (getShowWindowTabs()) {
      // Tabs mode: render one button per window, then the windows-menu button
      // at the end.
      for (const w of windows) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tw-win-tab' + (w.active ? ' active' : '');
        btn.textContent = w.index + ':' + w.name;
        const paneTitle = this.cachedTitles[w.index];
        if (paneTitle) btn.title = paneTitle;
        btn.addEventListener('click', () => {
          this.sendWindowMsg({ action: 'select', index: w.index });
        });
        btn.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          btn.classList.add('open');
          const rect = btn.getBoundingClientRect();
          showContextMenu({
            // Left-align with the clicked tab at its bottom. The viewport
            // clamp in showContextMenu will slide the menu leftward if it
            // would spill off the right edge.
            x: rect.left,
            y: rect.bottom,
            className: 'tw-dd-context-win',
            onClose: () => btn.classList.remove('open'),
            input: {
              label: 'Name:',
              defaultValue: w.name,
              onSubmit: (name) => {
                if (name !== w.name) {
                  this.sendWindowMsg({ action: 'rename', index: w.index, name });
                }
              },
            },
            items: [{ value: 'close', label: `Close window ${w.index}: ${w.name}`, separator: true }],
            onSelect: (action) => {
              if (action === 'close') {
                this.sendWindowMsg({ action: 'close', index: w.index });
              }
            },
          });
        });
        this.winTabs.appendChild(btn);
      }
    }

    // The [ name | ▣ ] button is always present — in tabs mode it replaces
    // the old + button at the end of the strip; in compact mode it's the
    // only control.
    this.winTabs.appendChild(this.buildWindowsMenuButton());
  }

  updateWindows(windows: Array<{ index: string; name: string; active: boolean }>): void {
    const activeWin = windows.find(w => w.active);
    const activeIdx = activeWin ? activeWin.index : null;
    const windowChanged = activeIdx !== this.lastActiveWindowIndex;
    if (windowChanged) {
      if (this.lastActiveWindowIndex !== null) this.show();
      this.lastActiveWindowIndex = activeIdx;
      /* Populate the title from the per-window titles map (already
       * pushed by the server's `refresh-client -B` subscription
       * before this windows broadcast) so a tmux-side switch doesn't
       * blank `#tb-title` while we wait for the next PTY-OSC title.
       * Clearing `textContent` while leaving the `title=` attr alone
       * was the visible bug: empty bar with a stale tooltip. If we
       * have no cached title yet, leave the previous text in place
       * — the next OSC will overwrite it shortly. */
      const cachedTitle = activeIdx !== null ? this.cachedTitles[activeIdx] : undefined;
      if (cachedTitle !== undefined) this.updateTitle(cachedTitle);
    }
    this.cachedWindows = windows.slice();
    this.renderWinTabs();
  }

  updateSessions(sessions: SessionInfo[]): void {
    this.cachedSessions = sessions.slice();
  }

  updateTitle(title: string): void {
    const stripped = stripTitleDecoration(title);
    this.tbTitle.textContent = stripped;
    /* Mirror the visible text into the native tooltip so the full title
     * is reachable on hover even when the title bar is too narrow and
     * the text gets ellipsis-clipped by `#tb-title`'s `text-overflow`. */
    if (stripped) this.tbTitle.title = stripped;
    else this.tbTitle.removeAttribute('title');
  }

  /** Per-window pane titles arrive whenever any window's active-pane
   *  title changes (push-based via the per-session control client's
   *  refresh-client -B subscription). We re-render the win-tab cluster
   *  on every change so the tooltips stay live; the windows-menu
   *  popover reads from `cachedTitles` lazily, which is fine since it
   *  is rebuilt every time the menu opens. */
  updateTitles(titles: Record<string, string>): void {
    this.cachedTitles = titles;
    this.lastWinTabsKey = '';   // bust the render cache so tooltips refresh
    this.renderWinTabs();
  }

  updateSession(session: string, remoteHost?: string): void {
    const prevPath = location.pathname;
    const newPath = remoteHost ? `/r/${remoteHost}/${session}` : remotePathForSession(prevPath, session);
    const switched = prevPath !== newPath;
    if (switched) {
      history.replaceState(null, '', newPath);
    }
    document.title = 'tmux-web \u2014 ' + session;
    this.sessionNameEl.textContent = session;

    // When tmux changes the active session underneath us (via a tmux
    // keyboard shortcut, not the web UI), load the target session's
    // persisted settings and re-apply them: otherwise the new session
    // would inherit the previous session's theme, colours, font, etc.
    if (switched) {
      const newRemoteHost = remoteHost ?? remoteHostFromPath(newPath);
      const key = sessionSettingsKey(session, newRemoteHost);
      const liveFromPrev = getLiveSessionSettings(key);
      const newSettings = loadSessionSettings(key, liveFromPrev, {
        defaults: DEFAULT_SESSION_SETTINGS,
      });
      setLastActiveSession(key);
      saveSessionSettings(key, newSettings);
      this.syncSettingsUi?.(newSettings);
      void this.opts.onSettingsChange?.(newSettings);
    }
  }
}

/** Strip the boilerplate that tmux's `set-titles-string` (or shell
 *  prompts that mimic it) wraps around the actual pane title:
 *  `session:idx:winname - "Actual title" suffix` → `Actual title`.
 *  tmux versions/configs vary the suffix (`#{session_alerts}`,
 *  `%pane,@window`, etc.), so anchor on the stable quoted payload.
 *  Falls back to the raw string when the pattern doesn't match. */
function stripTitleDecoration(raw: string): string {
  const m = /^[^:]+:[^:]+:.+ - "(.+)"(?:\s+\S.*)?\s*$/.exec(raw);
  return m ? m[1] : raw;
}
