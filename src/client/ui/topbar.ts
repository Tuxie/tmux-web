import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  getTopbarAutohide,
  setTopbarAutohide,
  getActiveThemeName,
  setActiveThemeName,
  isThemeFontTouched,
  markThemeFontTouched,
} from '../settings.js';
import type { TerminalSettings } from '../settings.js';
import { applyTheme, getActiveTheme, listFonts, listThemes } from '../theme.js';

export interface TopbarOptions {
  send: (data: string) => void;
  focus: () => void;
  onAutohideChange?: () => void;
  onThemeChange?: () => void;
  onSettingsChange?: (s: TerminalSettings) => void | Promise<void>;
}

export class Topbar {
  private topbar!: HTMLElement;
  private sessionSelect!: HTMLSelectElement;
  private winTabs!: HTMLElement;
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

  // Returns a Promise that resolves once the async font list fetch completes.
  // All event listeners are wired synchronously before the fetch, so UI events
  // fired during the fetch are handled correctly.
  private async setupSettingsInputs(): Promise<void> {
    const settings = loadSettings();
    const lineHeightPerFont = settings.lineHeightPerFont || {};

    const themeSelect = document.getElementById('inp-theme') as HTMLSelectElement;
    const fontSelect = document.getElementById('inp-font-bundled') as HTMLSelectElement;
    const sldSize = document.getElementById('sld-fontsize') as HTMLInputElement;
    const inpSize = document.getElementById('inp-fontsize') as HTMLInputElement;
    const sldHeight = document.getElementById('sld-lineheight') as HTMLInputElement;
    const inpHeight = document.getElementById('inp-lineheight') as HTMLInputElement;

    sldSize.value = inpSize.value = String(settings.fontSize);
    sldHeight.value = inpHeight.value = String(settings.lineHeight);

    const updateLineHeightFromHistory = (fontName: string) => {
      const savedHeight = lineHeightPerFont[fontName];
      if (savedHeight !== undefined) {
        sldHeight.value = inpHeight.value = String(savedHeight);
      }
    };

    const commit = () => {
      const fontFamily = fontSelect.value || DEFAULT_SETTINGS.fontFamily;
      const lineHeight = parseFloat(inpHeight.value) || DEFAULT_SETTINGS.lineHeight;
      if (fontFamily) {
        lineHeightPerFont[fontFamily] = lineHeight;
      }

      const s: TerminalSettings = {
        fontFamily,
        fontSize: parseFloat(inpSize.value) || DEFAULT_SETTINGS.fontSize,
        lineHeight,
        lineHeightPerFont,
      };
      settings.fontFamily = s.fontFamily;
      settings.fontSize = s.fontSize;
      settings.lineHeight = s.lineHeight;
      settings.lineHeightPerFont = lineHeightPerFont;
      saveSettings(s);
      this.opts.onSettingsChange?.(s);
    };

    fontSelect.addEventListener('change', () => {
      const font = fontSelect.value;
      updateLineHeightFromHistory(font);
      markThemeFontTouched(getActiveTheme());
      commit();
    });

    sldSize.addEventListener('input', () => { inpSize.value = sldSize.value; commit(); });
    inpSize.addEventListener('change', () => { sldSize.value = inpSize.value; commit(); });

    sldHeight.addEventListener('input', () => { inpHeight.value = sldHeight.value; commit(); });
    inpHeight.addEventListener('change', () => { sldHeight.value = inpHeight.value; commit(); });

    const [fonts, themes] = await Promise.all([listFonts(), listThemes()]);

    fontSelect.innerHTML = '';
    for (const font of fonts) {
      const opt = document.createElement('option');
      opt.value = font.family;
      opt.textContent = font.family;
      fontSelect.appendChild(opt);
    }
    const availableFonts = new Set(fonts.map(font => font.family));
    const initialFont = availableFonts.has(settings.fontFamily)
      ? settings.fontFamily
      : (availableFonts.has(DEFAULT_SETTINGS.fontFamily) ? DEFAULT_SETTINGS.fontFamily : (fonts[0]?.family ?? DEFAULT_SETTINGS.fontFamily));
    fontSelect.value = initialFont;
    if (initialFont !== settings.fontFamily) {
      settings.fontFamily = initialFont;
      saveSettings({ ...settings, lineHeightPerFont });
    }
    updateLineHeightFromHistory(initialFont);

    themeSelect.innerHTML = '';
    for (const theme of themes) {
      const opt = document.createElement('option');
      opt.value = theme.name;
      opt.textContent = theme.name;
      themeSelect.appendChild(opt);
    }
    const currentTheme = themes.some(theme => theme.name === getActiveThemeName())
      ? getActiveThemeName()
      : getActiveTheme();
    themeSelect.value = currentTheme;

    themeSelect.addEventListener('change', async () => {
      const name = themeSelect.value;
      setActiveThemeName(name);
      await applyTheme(name);
      const theme = themes.find(candidate => candidate.name === name);
      if (theme?.defaultFont && !isThemeFontTouched(name)) {
        const font = fonts.find(candidate => candidate.family === theme.defaultFont);
        if (font) {
          fontSelect.value = font.family;
          updateLineHeightFromHistory(font.family);
          commit();
        }
      }
      this.opts.onThemeChange?.();
    });

    // Reset the select after listeners are attached so a fallback font is persisted.
    if (fontSelect.value !== initialFont) {
      fontSelect.value = initialFont;
    }
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
    if (activeIdx !== this.lastActiveWindowIndex) {
      if (this.lastActiveWindowIndex !== null) this.show();
      this.lastActiveWindowIndex = activeIdx;
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
