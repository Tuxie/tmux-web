import { getTopbarAutohide, setTopbarAutohide } from '../prefs.js';
import { applyTheme, listFonts, listThemes } from '../theme.js';
import { fetchColours } from '../colours.js';
import { Dropdown, showContextMenu, type DropdownItem } from './dropdown.js';
import {
  loadSessionSettings,
  saveSessionSettings,
  getLiveSessionSettings,
  setLastActiveSession,
  applyThemeDefaults,
  DEFAULT_SESSION_SETTINGS,
  type SessionSettings,
  type ThemeDefaults,
} from '../session-settings.js';

export interface TopbarOptions {
  send: (data: string) => void;
  focus: () => void;
  getLiveSettings: () => SessionSettings | null;
  onAutohideChange?: () => void;
  onSettingsChange?: (s: SessionSettings) => void | Promise<void>;
}

export class Topbar {
  private topbar!: HTMLElement;
  private sessionName!: HTMLElement;
  private winTabs!: HTMLElement;
  private tbTitle!: HTMLElement;
  private autohideChk!: HTMLInputElement;
  private autohide = true;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActiveWindowIndex: string | null = null;
  private syncSettingsUi?: (s: SessionSettings) => void;
  private opts: TopbarOptions;

  constructor(opts: TopbarOptions) {
    this.opts = opts;
  }

  async init(): Promise<void> {
    this.topbar = document.getElementById('topbar')!;
    this.sessionName = document.getElementById('tb-session-name')!;
    this.sessionName.textContent = this.currentSession;
    this.winTabs = document.getElementById('win-tabs')!;
    this.tbTitle = document.getElementById('tb-title')!;
    this.autohideChk = document.getElementById('chk-autohide') as HTMLInputElement;

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

  private cachedSessions: string[] = [];

  private async refreshCachedSessions(): Promise<void> {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) this.cachedSessions = await res.json() as string[];
    } catch { /* keep previous cache */ }
  }

  private buildMenuInputRow(opts: {
    label: string;
    defaultValue?: string;
    placeholder?: string;
    onSubmit: (value: string) => void;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'menu-row menu-row-static';
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = opts.label;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tw-dd-input';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.defaultValue) input.value = opts.defaultValue;
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const value = input.value.trim();
        if (value) opts.onSubmit(value);
      }
    });
    row.appendChild(input);
    return row;
  }

  private setupSessionMenu(): void {
    const btn = document.getElementById('btn-session-menu') as HTMLButtonElement;
    const sessionDropdown = Dropdown.custom(btn, {
      className: 'tw-dd-sessions',
      beforeOpen: () => this.refreshCachedSessions(),
      renderContent: (menu, close) => {
        const current = this.currentSession;

        // Existing sessions — current one marked with a check. The check
        // lives in a fixed-width CSS gutter so session names always align.
        for (const s of this.cachedSessions) {
          const isCurrent = s === current;
          const el = document.createElement('div');
          el.className = 'tw-dropdown-item tw-dd-session-item' + (isCurrent ? ' current' : '');
          el.textContent = s;
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            close();
            if (!isCurrent) location.href = '/' + encodeURIComponent(s);
          });
          menu.appendChild(el);
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
              this.opts.send(JSON.stringify({ type: 'session', action: 'rename', name }));
            }
          },
        }));

        // Create new session
        const sep2 = document.createElement('hr');
        sep2.className = 'tw-dropdown-sep';
        menu.appendChild(sep2);
        menu.appendChild(this.buildMenuInputRow({
          label: 'New session:',
          placeholder: 'name',
          onSubmit: (name) => {
            close();
            const clean = name.replace(/[^a-zA-Z0-9_\-./]/g, '');
            if (!clean) return;
            location.href = '/' + encodeURIComponent(clean);
          },
        }));

        // Kill current session (confirmed)
        const sep3 = document.createElement('hr');
        sep3.className = 'tw-dropdown-sep';
        menu.appendChild(sep3);
        const killItem = document.createElement('div');
        killItem.className = 'tw-dropdown-item';
        killItem.textContent = `Kill session ${current}…`;
        killItem.addEventListener('click', (ev) => {
          ev.stopPropagation();
          close();
          if (!confirm(`Kill session "${current}"?`)) return;
          this.opts.send(JSON.stringify({ type: 'session', action: 'kill' }));
        });
        menu.appendChild(killItem);
      },
    });

    // Right-click behaves like left-click — opens the same rich session
    // menu (which already has Name, New session, and Kill session).
    btn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (sessionDropdown.menuElement.hidden) {
        void sessionDropdown.open();
      } else {
        sessionDropdown.close();
      }
    });
  }

  private setupMenu(): void {
    const menuWrap = document.getElementById('menu-wrap') as HTMLElement;
    const menuBtn = document.getElementById('btn-menu') as HTMLButtonElement;
    const dropdown = document.getElementById('menu-dropdown') as HTMLElement;
    const footerLeft = document.getElementById('menu-footer-left');
    const footerRight = document.getElementById('menu-footer-right');
    if (footerLeft && footerRight) {
      const version = (window as any).__TMUX_WEB_CONFIG?.version ?? '';
      footerLeft.textContent = `tmux-web v${version}`;
      footerRight.textContent = '© Per Wigren <per@wigren.eu>';
    }

    // Reopen the menu if a settings-change reload happened while it was open
    // menu-reopen flag is consumed synchronously by an inline <script> in index.html
    // (via window.__menuReopen) to avoid a race where the flag lingers in sessionStorage
    // if a subsequent reload happens before this module script runs.
    if ((window as any).__menuReopen) {
      (window as any).__menuReopen = false;
      dropdown.hidden = false;
      const chkFs = document.getElementById('chk-fullscreen') as HTMLInputElement;
      if (chkFs) chkFs.checked = !!document.fullscreenElement;
    }

    const toggleConfigMenu = (ev: Event): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const isHidden = dropdown.hidden;
      dropdown.hidden = !isHidden;
      if (!dropdown.hidden) {
        // Sync fullscreen checkbox state on open
        const chkFs = document.getElementById('chk-fullscreen') as HTMLInputElement;
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
    document.addEventListener('pointerdown', (ev) => {
      if (!dropdown.hidden && !menuWrap.contains(ev.target as Node)) {
        dropdown.hidden = true;
        this.opts.focus();
        this.show();
      }
    });
  }

  private setupFullscreenCheckbox(): void {
    const chkFs = document.getElementById('chk-fullscreen') as HTMLInputElement;
    chkFs.addEventListener('change', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      chkFs.checked = !!document.fullscreenElement;
      this.show();
    });
  }

  private get sessionName(): string {
    return location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
  }

  // Returns a Promise that resolves once the async data fetches complete.
  private async setupSettingsInputs(): Promise<void> {
    const themeSelect = document.getElementById('inp-theme') as HTMLSelectElement;
    const coloursSelect = document.getElementById('inp-colours') as HTMLSelectElement;
    const btnResetColours = document.getElementById('btn-reset-colours') as HTMLButtonElement;
    const fontSelect = document.getElementById('inp-font-bundled') as HTMLSelectElement;
    const btnResetFont = document.getElementById('btn-reset-font') as HTMLButtonElement;
    const sldSize = document.getElementById('sld-fontsize') as HTMLInputElement;
    const inpSize = document.getElementById('inp-fontsize') as HTMLInputElement;
    const sldHeight = document.getElementById('sld-spacing') as HTMLInputElement;
    const inpHeight = document.getElementById('inp-spacing') as HTMLInputElement;
    const sldOpacity = document.getElementById('sld-opacity') as HTMLInputElement;
    const inpOpacity = document.getElementById('inp-opacity') as HTMLInputElement;

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

    // Populate font select
    fontSelect.innerHTML = '';
    for (const font of fonts) {
      const opt = document.createElement('option');
      opt.value = font.family;
      opt.textContent = font.family;
      fontSelect.appendChild(opt);
    }

    // Replace the three native <select>s with custom themable dropdowns.
    // The <select> stays in the DOM (hidden) as source of truth for value,
    // options, and change events — so existing listeners and Playwright's
    // selectOption keep working unchanged.
    const ddTheme = Dropdown.fromSelect(themeSelect);
    const ddColours = Dropdown.fromSelect(coloursSelect);
    const ddFont = Dropdown.fromSelect(fontSelect);
    ddTheme.element.style.flex = '1';
    ddColours.element.style.flex = '1';
    ddFont.element.style.flex = '1';

    const getSettings = (): SessionSettings => {
      const live = this.opts.getLiveSettings();
      return loadSessionSettings(this.sessionName, live, { defaults: DEFAULT_SESSION_SETTINGS });
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
    const refreshAllSliderFills = (): void => {
      updateSliderFill(sldSize);
      updateSliderFill(sldHeight);
      updateSliderFill(sldOpacity);
    };
    sldSize.addEventListener('input', () => updateSliderFill(sldSize));
    sldHeight.addEventListener('input', () => updateSliderFill(sldHeight));
    sldOpacity.addEventListener('input', () => updateSliderFill(sldOpacity));

    const syncUi = (s: SessionSettings) => {
      ddTheme.setValue(s.theme);
      ddColours.setValue(s.colours);
      ddFont.setValue(s.fontFamily);
      sldSize.value = inpSize.value = String(s.fontSize);
      sldHeight.value = inpHeight.value = String(s.spacing);
      sldOpacity.value = inpOpacity.value = String(s.opacity);
      refreshAllSliderFills();
    };
    // Expose so updateSession() can refresh the visible controls when tmux
    // switches sessions underneath us.
    this.syncSettingsUi = syncUi;

    syncUi(getSettings());

    const commit = (patch: Partial<SessionSettings>) => {
      const current = getSettings();
      const updated: SessionSettings = { ...current, ...patch };
      saveSessionSettings(this.sessionName, updated);
      this.opts.onSettingsChange?.(updated);
    };

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
      const current = getSettings();
      const updated = applyThemeDefaults({ ...current, theme: name }, td);
      saveSessionSettings(this.sessionName, updated);
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

    sldSize.addEventListener('input', () => { inpSize.value = sldSize.value; commit({ fontSize: parseFloat(sldSize.value) }); });
    inpSize.addEventListener('change', () => { sldSize.value = inpSize.value; updateSliderFill(sldSize); commit({ fontSize: parseFloat(inpSize.value) }); });

    sldHeight.addEventListener('input', () => { inpHeight.value = sldHeight.value; commit({ spacing: parseFloat(sldHeight.value) }); });
    inpHeight.addEventListener('change', () => { sldHeight.value = inpHeight.value; updateSliderFill(sldHeight); commit({ spacing: parseFloat(inpHeight.value) }); });

    sldOpacity.addEventListener('input', () => { inpOpacity.value = sldOpacity.value; commit({ opacity: parseInt(sldOpacity.value, 10) }); });
    inpOpacity.addEventListener('change', () => { sldOpacity.value = inpOpacity.value; updateSliderFill(sldOpacity); commit({ opacity: parseInt(inpOpacity.value, 10) }); });
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

  private setupAutoHide(): void {
    this.autohide = getTopbarAutohide();
    this.autohideChk.checked = this.autohide;
    this.applyPinnedClass();
    this.autohideChk.addEventListener('change', () => {
      this.autohide = this.autohideChk.checked;
      setTopbarAutohide(this.autohide);
      this.applyPinnedClass();
      this.opts.onAutohideChange?.();
      if (!this.autohide) {
        if (this.hideTimer) clearTimeout(this.hideTimer);
        this.hideTimer = null;
        this.topbar.classList.remove('hidden');
      } else {
        this.show();
      }
    });

    document.addEventListener('mousemove', (ev) => {
      if (ev.clientY < 28 * 3) this.show();
    });
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
        if (dropdown) dropdown.hidden = true;
      }, 1000);
    } else {
      this.hideTimer = null;
    }
  }

  get currentSession(): string {
    return location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
  }

  updateWindows(windows: Array<{ index: string; name: string; active: boolean }>): void {
    const activeWin = windows.find(w => w.active);
    const activeIdx = activeWin ? activeWin.index : null;
    const windowChanged = activeIdx !== this.lastActiveWindowIndex;
    if (windowChanged) {
      if (this.lastActiveWindowIndex !== null) this.show();
      this.lastActiveWindowIndex = activeIdx;
      this.tbTitle.textContent = '';
    }
    // All window actions go through typed WS messages that the server
    // runs via the tmux binary directly. This avoids depending on the
    // user's tmux prefix binding (which may not be C-s) or the PTY's
    // current input mode.
    const sendWindowMsg = (
      msg: { action: string; index?: string; name?: string },
    ): void => {
      this.opts.send(JSON.stringify({ type: 'window', ...msg }));
    };

    this.winTabs.innerHTML = '';
    for (const w of windows) {
      const btn = document.createElement('button');
      btn.className = 'win-tab' + (w.active ? ' active' : '');
      btn.textContent = w.index + ':' + w.name;
      btn.addEventListener('click', () => {
        sendWindowMsg({ action: 'select', index: w.index });
      });
      btn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        showContextMenu({
          x: ev.clientX,
          y: ev.clientY,
          className: 'tw-dd-context-win',
          input: {
            label: 'Name:',
            defaultValue: w.name,
            onSubmit: (name) => {
              if (name !== w.name) {
                sendWindowMsg({ action: 'rename', index: w.index, name });
              }
            },
          },
          items: [{ value: 'close', label: 'Close window', separator: true }],
          onSelect: (action) => {
            if (action === 'close') {
              sendWindowMsg({ action: 'close', index: w.index });
            }
          },
        });
      });
      this.winTabs.appendChild(btn);
    }

    // Add [+] button to create a new window. Left-click creates an unnamed
    // window; right-click opens a small input popup to name it first.
    const addBtn = document.createElement('button');
    addBtn.className = 'tb-btn tb-btn-new-window';
    addBtn.textContent = '+';
    addBtn.title = 'New Window';
    addBtn.addEventListener('click', () => {
      sendWindowMsg({ action: 'new' });
    });
    addBtn.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      showContextMenu({
        x: ev.clientX,
        y: ev.clientY,
        className: 'tw-dd-context-new-window',
        input: {
          label: 'New window:',
          placeholder: 'name',
          onSubmit: (name) => sendWindowMsg({ action: 'new', name }),
        },
      });
    });
    this.winTabs.appendChild(addBtn);
  }

  updateTitle(title: string): void {
    this.tbTitle.textContent = title;
  }

  updateSession(session: string): void {
    const prevPath = location.pathname;
    const newPath = '/' + session;
    const switched = prevPath !== newPath;
    if (switched) {
      history.replaceState(null, '', newPath);
    }
    document.title = 'tmux-web \u2014 ' + session;
    this.sessionName.textContent = session;

    // When tmux changes the active session underneath us (via a tmux
    // keyboard shortcut, not the web UI), load the target session's
    // persisted settings and re-apply them: otherwise the new session
    // would inherit the previous session's theme, colours, font, etc.
    if (switched) {
      const liveFromPrev = getLiveSessionSettings(session);
      const newSettings = loadSessionSettings(session, liveFromPrev, {
        defaults: DEFAULT_SESSION_SETTINGS,
      });
      setLastActiveSession(session);
      saveSessionSettings(session, newSettings);
      this.syncSettingsUi?.(newSettings);
      void this.opts.onSettingsChange?.(newSettings);
    }
  }
}
