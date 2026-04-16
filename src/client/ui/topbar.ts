import { getTopbarAutohide, setTopbarAutohide } from '../prefs.js';
import { applyTheme, listFonts, listThemes } from '../theme.js';
import { fetchColours } from '../colours.js';
import {
  loadSessionSettings,
  saveSessionSettings,
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
  private sessionSelect!: HTMLSelectElement;
  private winTabs!: HTMLElement;
  private tbTitle!: HTMLElement;
  private autohideChk!: HTMLInputElement;
  private autohide = true;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActiveWindowIndex: string | null = null;
  private opts: TopbarOptions;

  constructor(opts: TopbarOptions) {
    this.opts = opts;
  }

  async init(): Promise<void> {
    this.topbar = document.getElementById('topbar')!;
    this.sessionSelect = document.getElementById('session-select') as HTMLSelectElement;
    this.winTabs = document.getElementById('win-tabs')!;
    this.tbTitle = document.getElementById('tb-title')!;
    this.autohideChk = document.getElementById('chk-autohide') as HTMLInputElement;

    this.setupSessionDropdown();
    this.setupNewSessionButton();
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

  private setupSessionDropdown(): void {
    this.sessionSelect.addEventListener('change', () => {
      const newSession = this.sessionSelect.value;
      if (newSession && newSession !== this.currentSession) {
        location.href = '/' + encodeURIComponent(newSession);
      }
    });
    this.sessionSelect.addEventListener('mousedown', () => this.refreshSessionList());
    this.sessionSelect.addEventListener('focus', () => this.refreshSessionList());
    this.sessionSelect.addEventListener('change', () => this.opts.focus());
  }

  private setupNewSessionButton(): void {
    document.getElementById('btn-new-session')!.addEventListener('click', () => {
      const name = prompt('New session name:');
      if (!name?.trim()) return;
      const clean = name.trim().replace(/[^a-zA-Z0-9_\-./]/g, '');
      if (!clean) return;
      location.href = '/' + encodeURIComponent(clean);
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

    menuBtn.addEventListener('click', (ev) => {
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
    });

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

    const getSettings = (): SessionSettings => {
      const live = this.opts.getLiveSettings();
      return loadSessionSettings(this.sessionName, live, { defaults: DEFAULT_SESSION_SETTINGS });
    };

    const syncUi = (s: SessionSettings) => {
      themeSelect.value = s.theme;
      coloursSelect.value = s.colours;
      fontSelect.value = s.fontFamily;
      sldSize.value = inpSize.value = String(s.fontSize);
      sldHeight.value = inpHeight.value = String(s.spacing);
      sldOpacity.value = inpOpacity.value = String(s.opacity);
    };

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
        coloursSelect.value = theme.defaultColours;
        patch.colours = theme.defaultColours;
      }
      if (theme?.defaultOpacity !== undefined) {
        sldOpacity.value = inpOpacity.value = String(theme.defaultOpacity);
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
        fontSelect.value = theme.defaultFont;
        patch.fontFamily = theme.defaultFont;
      }
      if (theme?.defaultFontSize !== undefined) {
        sldSize.value = inpSize.value = String(theme.defaultFontSize);
        patch.fontSize = theme.defaultFontSize;
      }
      if (theme?.defaultSpacing !== undefined) {
        sldHeight.value = inpHeight.value = String(theme.defaultSpacing);
        patch.spacing = theme.defaultSpacing;
      }
      if (Object.keys(patch).length) commit(patch);
    });

    sldSize.addEventListener('input', () => { inpSize.value = sldSize.value; commit({ fontSize: parseFloat(sldSize.value) }); });
    inpSize.addEventListener('change', () => { sldSize.value = inpSize.value; commit({ fontSize: parseFloat(inpSize.value) }); });

    sldHeight.addEventListener('input', () => { inpHeight.value = sldHeight.value; commit({ spacing: parseFloat(sldHeight.value) }); });
    inpHeight.addEventListener('change', () => { sldHeight.value = inpHeight.value; commit({ spacing: parseFloat(inpHeight.value) }); });

    sldOpacity.addEventListener('input', () => { inpOpacity.value = sldOpacity.value; commit({ opacity: parseInt(sldOpacity.value, 10) }); });
    inpOpacity.addEventListener('change', () => { sldOpacity.value = inpOpacity.value; commit({ opacity: parseInt(inpOpacity.value, 10) }); });
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

    this.topbar.classList.remove('hidden');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.autohide && !dropdownOpen) {
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

  async refreshSessionList(): Promise<void> {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const sessions: string[] = await res.json();
      this.sessionSelect.innerHTML = '';
      for (const s of sessions) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === this.currentSession) opt.selected = true;
        this.sessionSelect.appendChild(opt);
      }
      if (!sessions.includes(this.currentSession)) {
        const opt = document.createElement('option');
        opt.value = this.currentSession;
        opt.textContent = this.currentSession;
        opt.selected = true;
        this.sessionSelect.appendChild(opt);
      }
    } catch { /* ignore */ }
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
    this.winTabs.innerHTML = '';
    for (const w of windows) {
      const btn = document.createElement('button');
      btn.className = 'win-tab' + (w.active ? ' active' : '');
      btn.textContent = w.index + ':' + w.name;
      btn.addEventListener('click', () => {
        this.opts.send('\x13' + w.index);
      });
      this.winTabs.appendChild(btn);
    }

    // Add [+] button to create a new window
    const addBtn = document.createElement('button');
    addBtn.className = 'tb-btn';
    addBtn.textContent = '+';
    addBtn.title = 'New Window';
    addBtn.style.marginLeft = '2px';
    addBtn.style.fontWeight = 'bold';
    addBtn.addEventListener('click', () => {
      this.opts.send('\x13\x03'); // Ctrl-S Ctrl-C (Prefix + C-c)
    });
    this.winTabs.appendChild(addBtn);
  }

  updateTitle(title: string): void {
    this.tbTitle.textContent = title;
  }

  updateSession(session: string): void {
    const newPath = '/' + session;
    if (location.pathname !== newPath) {
      history.replaceState(null, '', newPath);
    }
    document.title = 'tmux-web \u2014 ' + session;
    if (this.sessionSelect.value !== session) {
      this.refreshSessionList();
    }
  }
}
