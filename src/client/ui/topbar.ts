import { loadSettings, saveSettings, DEFAULT_SETTINGS, getTerminalBackend, setTerminalBackend, getTopbarAutohide, setTopbarAutohide } from '../settings.js';
import type { TerminalSettings, FontSource } from '../settings.js';

export interface TopbarOptions {
  send: (data: string) => void;
  focus: () => void;
  onAutohideChange?: () => void;
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
    this.setupTerminalSelector();
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

    // Reopen the menu if a settings-change reload happened while it was open
    if (sessionStorage.getItem('tmux-web:menu-reopen')) {
      sessionStorage.removeItem('tmux-web:menu-reopen');
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
      }
    });

    // Close dropdown only when the user physically clicks outside the menu wrapper.
    // Use pointerdown (not click) so synthetic events fired during terminal redraws
    // don't inadvertently close the dropdown.
    document.addEventListener('pointerdown', (ev) => {
      if (!dropdown.hidden && !menuWrap.contains(ev.target as Node)) {
        dropdown.hidden = true;
        this.opts.focus();
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

  private setupTerminalSelector(): void {
    const selTerminal = document.getElementById('inp-terminal') as HTMLSelectElement;
    const config = (window as any).__TMUX_WEB_CONFIG;

    // Fetch and display terminal versions
    fetch('/api/terminal-versions')
      .then(r => r.json())
      .then((versions: Record<string, string>) => {
        // Update option labels with versions
        const options = selTerminal.querySelectorAll('option');
        options.forEach(opt => {
          const value = opt.value;
          const version = versions[value];
          if (version) {
            opt.textContent = version;
          }
        });
      })
      .catch(() => {
        // If version fetch fails, keep original labels
      });

    // Set current terminal as selected
    selTerminal.value = config.terminal;

    // Handle terminal selection changes
    selTerminal.addEventListener('change', () => {
      const newTerminal = selTerminal.value;
      // Store preference in cookie
      setTerminalBackend(newTerminal);
      // Reload with the new terminal as query parameter
      const url = new URL(window.location.href);
      url.searchParams.set('terminal', newTerminal);
      window.location.href = url.toString();
    });
  }

  // Returns a Promise that resolves once the async font list fetch completes.
  // All event listeners are wired synchronously before the fetch, so UI events
  // fired during the fetch are handled correctly.
  private setupSettingsInputs(): Promise<void> {
    const settings = loadSettings();
    const fontHistory = settings.lastFontPerSource || {};
    const lineHeightPerFont = settings.lineHeightPerFont || {};

    const selSource = document.getElementById('inp-fontsource') as HTMLSelectElement;
    const selFontBundled = document.getElementById('inp-font-bundled') as HTMLSelectElement;
    const inpFont = document.getElementById('inp-font') as HTMLInputElement;
    const sldSize = document.getElementById('sld-fontsize') as HTMLInputElement;
    const inpSize = document.getElementById('inp-fontsize') as HTMLInputElement;
    const sldHeight = document.getElementById('sld-lineheight') as HTMLInputElement;
    const inpHeight = document.getElementById('inp-lineheight') as HTMLInputElement;

    const applySourceVisibility = (source: FontSource) => {
      selFontBundled.hidden = source !== 'bundled';
      inpFont.hidden = source === 'bundled';
    };

    // Tracks the intended bundled font selection. When switching to 'bundled' source
    // before the async font list has loaded, selFontBundled.value assignment silently
    // fails. We remember the desired value here and apply it once options are available.
    let desiredBundledFont: string =
      settings.fontSource === 'bundled'
        ? settings.fontFamily
        : (fontHistory['bundled'] || DEFAULT_SETTINGS.fontFamily);

    selSource.value = settings.fontSource;
    inpFont.value = settings.fontFamily;
    sldSize.value = inpSize.value = String(settings.fontSize);
    sldHeight.value = inpHeight.value = String(settings.lineHeight);
    applySourceVisibility(settings.fontSource);

    const updateLineHeightFromHistory = (fontName: string) => {
      const savedHeight = lineHeightPerFont[fontName];
      if (savedHeight !== undefined) {
        sldHeight.value = inpHeight.value = String(savedHeight);
      }
    };

    const commit = () => {
      const source = selSource.value as FontSource;
      const fontFamily = source === 'bundled'
        ? (selFontBundled.value || desiredBundledFont || DEFAULT_SETTINGS.fontFamily)
        : (inpFont.value.trim() || DEFAULT_SETTINGS.fontFamily);
      const lineHeight = parseFloat(inpHeight.value) || DEFAULT_SETTINGS.lineHeight;

      // Only update fontHistory for the current source with the actual selected font.
      // This preserves other sources' history even if the current dropdown is empty.
      if (source === 'bundled' && selFontBundled.value) {
        fontHistory['bundled'] = selFontBundled.value;
      } else if (source === 'custom' && inpFont.value.trim()) {
        fontHistory['custom'] = inpFont.value.trim();
      } else if (source === 'google' && inpFont.value.trim()) {
        fontHistory['google'] = inpFont.value.trim();
      }
      // Always update line height for the current font
      if (fontFamily) {
        lineHeightPerFont[fontFamily] = lineHeight;
      }

      const s: TerminalSettings = {
        fontSource: source,
        fontFamily,
        fontSize: parseFloat(inpSize.value) || DEFAULT_SETTINGS.fontSize,
        lineHeight,
        lastFontPerSource: fontHistory,
        lineHeightPerFont,
      };
      saveSettings(s);
      this.opts.onSettingsChange?.(s);
    };

    selSource.addEventListener('change', () => {
      const newSource = selSource.value as FontSource;
      applySourceVisibility(newSource);

      // Restore the last font used with this source
      const lastFont = fontHistory[newSource];
      if (lastFont) {
        if (newSource === 'bundled') {
          desiredBundledFont = lastFont;
          // Apply immediately if options are available; otherwise the fetch
          // completion callback will apply desiredBundledFont once loaded.
          if (selFontBundled.options.length > 0) selFontBundled.value = lastFont;
          updateLineHeightFromHistory(lastFont);
        } else {
          inpFont.value = lastFont;
          updateLineHeightFromHistory(lastFont);
        }
      }
      commit();
    });

    selFontBundled.addEventListener('change', () => {
      const font = selFontBundled.value;
      desiredBundledFont = font;
      updateLineHeightFromHistory(font);
      commit();
    });

    inpFont.addEventListener('change', commit);

    sldSize.addEventListener('input', () => { inpSize.value = sldSize.value; commit(); });
    inpSize.addEventListener('change', () => { sldSize.value = inpSize.value; commit(); });

    sldHeight.addEventListener('input', () => { inpHeight.value = sldHeight.value; commit(); });
    inpHeight.addEventListener('change', () => { sldHeight.value = inpHeight.value; commit(); });

    // Fetch font list last — all event listeners are already wired so any UI
    // events that fire during the fetch are handled correctly.
    return fetch('/api/fonts').then(r => r.json()).then((files: string[]) => {
      selFontBundled.innerHTML = '';
      for (const f of files) {
        const name = f.replace(/\.woff2$/, '');
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        selFontBundled.appendChild(opt);
      }
      // Apply the desired selection now that options exist.
      selFontBundled.value = desiredBundledFont;
    }).catch(() => {});
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
