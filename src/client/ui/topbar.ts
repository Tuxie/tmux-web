import {
  getTopbarAutohide, setTopbarAutohide,
  getShowWindowTabs, setShowWindowTabs,
} from '../prefs.js';
import { applyTheme, listFonts, listThemes } from '../theme.js';
import { fetchColours } from '../colours.js';
import { Dropdown, showContextMenu, type DropdownItem } from './dropdown.js';
import {
  loadSessionSettings,
  saveSessionSettings,
  deleteSessionSettings,
  getLiveSessionSettings,
  getStoredSessionNames,
  initSessionStore,
  setLastActiveSession,
  applyThemeDefaults,
  DEFAULT_SESSION_SETTINGS,
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

export interface TopbarOptions {
  send: (data: string) => void;
  focus: () => void;
  getLiveSettings: () => SessionSettings | null;
  onAutohideChange?: () => void;
  onSettingsChange?: (s: SessionSettings) => void | Promise<void>;
  /** Switch to a different (or new) session without a full page reload —
   *  caller is expected to update the URL and reconnect the WebSocket. */
  onSwitchSession?: (name: string) => void;
}

export class Topbar {
  private topbar!: HTMLElement;
  private sessionNameEl!: HTMLElement;
  private winTabs!: HTMLElement;
  private tbTitle!: HTMLElement;
  private autohideChk!: HTMLInputElement;
  private autohide = true;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActiveWindowIndex: string | null = null;
  private syncSettingsUi?: (s: SessionSettings) => void;
  private cachedWindows: Array<{ index: string; name: string; active: boolean }> = [];
  private lastWinTabsKey = '';
  private menuBtn?: HTMLButtonElement;
  private menuDropdown?: HTMLElement;
  private opts: TopbarOptions;

  constructor(opts: TopbarOptions) {
    this.opts = opts;
  }

  async init(): Promise<void> {
    this.topbar = document.getElementById('topbar')!;
    this.sessionNameEl = document.getElementById('tb-session-name')!;
    this.sessionNameEl.textContent = this.currentSession;
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

  private cachedSessions: Array<{ id: string; name: string }> = [];

  private async refreshCachedSessions(): Promise<void> {
    try {
      const [running] = await Promise.all([
        fetch('/api/sessions').then(r =>
          r.ok ? r.json() as Promise<Array<{ id: string; name: string }>> : null
        ),
        initSessionStore(),
      ]);
      if (running) this.cachedSessions = running;
    } catch { /* keep previous cache */ }
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
      label.classList.add('menu-label-clickable');
      label.addEventListener('click', submit);
    }
    row.appendChild(input);
    return row;
  }

  private setupSessionMenu(): void {
    const btn = document.getElementById('btn-session-menu') as HTMLButtonElement;
    const btnPlus = document.getElementById('btn-session-plus') as HTMLButtonElement | null;
    const renderContent = (menu: HTMLElement, close: () => void): void => {
        const current = this.currentSession;

        // Union of running tmux sessions + persisted ones from sessions.json,
        // sorted case-insensitively by name.
        const runningByName = new Map(this.cachedSessions.map(s => [s.name, s]));
        const stored = getStoredSessionNames();
        const ordered: Array<{ id: string | null; name: string }> = [
          ...this.cachedSessions.map(s => ({ id: s.id, name: s.name })),
          ...stored
            .filter(n => !runningByName.has(n))
            .map(n => ({ id: null as string | null, name: n })),
        ].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

        // Each row: [ ✓ gutter | name | tmux session id | status dot ].
        // The id sits in muted grey to the left of the status dot so it's
        // unobtrusive but discoverable; stored-but-stopped sessions leave
        // that slot empty. Stopped sessions also get a trashcan that
        // deletes the stored settings entry from sessions.json.
        for (const s of ordered) {
          const isCurrent = s.name === current;
          const isRunning = runningByName.has(s.name);
          const el = document.createElement('div');
          el.className = 'tw-dropdown-item tw-dd-session-item' + (isCurrent ? ' current' : '');
          const name = document.createElement('span');
          name.className = 'tw-dd-session-name';
          name.textContent = s.name;
          el.appendChild(name);
          if (!isRunning) {
            const del = document.createElement('button');
            del.type = 'button';
            // `tb-btn drops-revoke` mirror the drops-section trashcan — themes
            // that style those classes (e.g. Amiga) pick up the same look.
            del.className = 'tb-btn drops-revoke tw-dd-session-delete';
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
          if (s.id !== null) {
            const id = document.createElement('span');
            id.className = 'tw-dd-session-id';
            id.textContent = s.id;
            id.title = 'session id: ' + s.id;
            el.appendChild(id);
          }
          const dot = document.createElement('span');
          dot.className = 'tw-dd-session-status ' + (isRunning ? 'running' : 'stopped');
          dot.title = isRunning ? 'Running' : 'Not running';
          el.appendChild(dot);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            close();
            if (!isCurrent) this.opts.onSwitchSession?.(s.name);
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

        // Create new session (no separator — Name and New session share a block)
        menu.appendChild(this.buildMenuInputRow({
          label: 'New session:',
          placeholder: 'name',
          onSubmit: (name) => {
            close();
            const clean = name.replace(/[^a-zA-Z0-9_\-./]/g, '');
            if (!clean) return;
            this.opts.onSwitchSession?.(clean);
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
          // Native confirm() is intentional here — destructive tmux actions are
          // infrequent and a custom modal would duplicate the clipboard-prompt
          // code path for marginal UX gain. See 2026-04-17 code-analysis UX-1.
          if (!confirm(`Kill session "${current}"?`)) return;
          this.opts.send(JSON.stringify({ type: 'session', action: 'kill' }));
        });
        menu.appendChild(killItem);
    };

    const sessionDropdown = Dropdown.custom(btn, {
      className: 'tw-dd-sessions',
      beforeOpen: () => this.refreshCachedSessions(),
      renderContent,
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

    // Plus button is intentionally decoupled from the session dropdown —
    // it's a separate topbar button and will get its own action wired up
    // in a follow-up change.
    void btnPlus;
  }

  private setupMenu(): void {
    const menuWrap = document.getElementById('menu-wrap') as HTMLElement;
    const menuBtn = document.getElementById('btn-menu') as HTMLButtonElement;
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    const dropdown = document.getElementById('menu-dropdown') as HTMLElement;
    const footerLeft = document.getElementById('menu-footer-left');
    const footerRight = document.getElementById('menu-footer-right');
    if (footerLeft && footerRight) {
      const version = (window as any).__TMUX_WEB_CONFIG?.version ?? '';
      // Anchor to the project repo. .menu-footer-link inherits colour /
      // text-decoration from #menu-footer so appearance is unchanged.
      const link = document.createElement('a');
      link.href = 'https://github.com/tuxie/tmux-web';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'menu-footer-link';
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

    if ((window as any).__menuReopen) {
      (window as any).__menuReopen = false;
      this.setConfigMenuOpen(true);
      const chkFs = document.getElementById('chk-fullscreen') as HTMLInputElement;
      if (chkFs) chkFs.checked = !!document.fullscreenElement;
    }

    const toggleConfigMenu = (ev: Event): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const nextOpen = dropdown.hidden;
      this.setConfigMenuOpen(nextOpen);
      if (nextOpen) {
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
        this.setConfigMenuOpen(false);
        this.opts.focus();
        this.show();
      }
    });
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
    const chkFs = document.getElementById('chk-fullscreen') as HTMLInputElement;
    chkFs.addEventListener('change', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => {
      chkFs.checked = !!document.fullscreenElement;
      this.show();
    });
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
    const sldTuiBgOpacity = document.getElementById('sld-tui-bg-opacity') as HTMLInputElement;
    const inpTuiBgOpacity = document.getElementById('inp-tui-bg-opacity') as HTMLInputElement;
    const sldTuiFgOpacity = document.getElementById('sld-tui-fg-opacity') as HTMLInputElement;
    const inpTuiFgOpacity = document.getElementById('inp-tui-fg-opacity') as HTMLInputElement;
    const sldOpacity = document.getElementById('sld-opacity') as HTMLInputElement;
    const inpOpacity = document.getElementById('inp-opacity') as HTMLInputElement;
    const sldThemeHue = document.getElementById('sld-theme-hue') as HTMLInputElement;
    const inpThemeHue = document.getElementById('inp-theme-hue') as HTMLInputElement;
    const sldThemeSat = document.getElementById('sld-theme-sat') as HTMLInputElement;
    const inpThemeSat = document.getElementById('inp-theme-sat') as HTMLInputElement;
    const sldThemeLtn = document.getElementById('sld-theme-ltn') as HTMLInputElement;
    const inpThemeLtn = document.getElementById('inp-theme-ltn') as HTMLInputElement;
    const sldThemeContrast = document.getElementById('sld-theme-contrast') as HTMLInputElement;
    const inpThemeContrast = document.getElementById('inp-theme-contrast') as HTMLInputElement;
    const sldDepth = document.getElementById('sld-depth') as HTMLInputElement;
    const inpDepth = document.getElementById('inp-depth') as HTMLInputElement;
    const sldBackgroundHue = document.getElementById('sld-background-hue') as HTMLInputElement;
    const inpBackgroundHue = document.getElementById('inp-background-hue') as HTMLInputElement;
    const sldBackgroundSaturation = document.getElementById('sld-background-saturation') as HTMLInputElement;
    const inpBackgroundSaturation = document.getElementById('inp-background-saturation') as HTMLInputElement;
    const sldBackgroundBrightest = document.getElementById('sld-background-brightest') as HTMLInputElement;
    const inpBackgroundBrightest = document.getElementById('inp-background-brightest') as HTMLInputElement;
    const sldBackgroundDarkest = document.getElementById('sld-background-darkest') as HTMLInputElement;
    const inpBackgroundDarkest = document.getElementById('inp-background-darkest') as HTMLInputElement;
    const sldFgContrastStrength = document.getElementById('sld-fg-contrast-strength') as HTMLInputElement;
    const inpFgContrastStrength = document.getElementById('inp-fg-contrast-strength') as HTMLInputElement;
    const sldFgContrastBias = document.getElementById('sld-fg-contrast-bias') as HTMLInputElement;
    const inpFgContrastBias = document.getElementById('inp-fg-contrast-bias') as HTMLInputElement;
    const sldTuiSaturation = document.getElementById('sld-tui-saturation') as HTMLInputElement;
    const inpTuiSaturation = document.getElementById('inp-tui-saturation') as HTMLInputElement;

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
    // Flex is applied via `#menu-dropdown .tw-dropdown { flex: 1 }` in base.css.

    const getSettings = (): SessionSettings => {
      const live = this.opts.getLiveSettings();
      return loadSessionSettings(this.currentSession, live, { defaults: DEFAULT_SESSION_SETTINGS });
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
      updateSliderFill(sldTuiBgOpacity);
      updateSliderFill(sldTuiFgOpacity);
      updateSliderFill(sldOpacity);
      updateSliderFill(sldBackgroundHue);
      updateSliderFill(sldBackgroundSaturation);
      updateSliderFill(sldBackgroundBrightest);
      updateSliderFill(sldBackgroundDarkest);
      updateSliderFill(sldFgContrastStrength);
      updateSliderFill(sldFgContrastBias);
      updateSliderFill(sldTuiSaturation);
      updateSliderFill(sldThemeHue);
      updateSliderFill(sldThemeSat);
      updateSliderFill(sldThemeLtn);
      updateSliderFill(sldThemeContrast);
      updateSliderFill(sldDepth);
    };
    sldSize.addEventListener('input', () => updateSliderFill(sldSize));
    sldHeight.addEventListener('input', () => updateSliderFill(sldHeight));
    sldTuiBgOpacity.addEventListener('input', () => updateSliderFill(sldTuiBgOpacity));
    sldTuiFgOpacity.addEventListener('input', () => updateSliderFill(sldTuiFgOpacity));
    sldOpacity.addEventListener('input', () => updateSliderFill(sldOpacity));
    sldBackgroundHue.addEventListener('input', () => updateSliderFill(sldBackgroundHue));
    sldBackgroundSaturation.addEventListener('input', () => updateSliderFill(sldBackgroundSaturation));
    sldBackgroundBrightest.addEventListener('input', () => updateSliderFill(sldBackgroundBrightest));
    sldBackgroundDarkest.addEventListener('input', () => updateSliderFill(sldBackgroundDarkest));
    sldFgContrastStrength.addEventListener('input', () => updateSliderFill(sldFgContrastStrength));
    sldFgContrastBias.addEventListener('input', () => updateSliderFill(sldFgContrastBias));
    sldTuiSaturation.addEventListener('input', () => updateSliderFill(sldTuiSaturation));
    sldThemeHue.addEventListener('input', () => updateSliderFill(sldThemeHue));
    sldThemeSat.addEventListener('input', () => updateSliderFill(sldThemeSat));
    sldThemeLtn.addEventListener('input', () => updateSliderFill(sldThemeLtn));
    sldThemeContrast.addEventListener('input', () => updateSliderFill(sldThemeContrast));
    sldDepth.addEventListener('input', () => updateSliderFill(sldDepth));

    const syncUi = (s: SessionSettings) => {
      ddTheme.setValue(s.theme);
      ddColours.setValue(s.colours);
      ddFont.setValue(s.fontFamily);
      sldSize.value = inpSize.value = String(s.fontSize);
      sldHeight.value = inpHeight.value = String(s.spacing);
      sldTuiBgOpacity.value = inpTuiBgOpacity.value = String(s.tuiBgOpacity);
      sldTuiFgOpacity.value = inpTuiFgOpacity.value = String(s.tuiFgOpacity);
      sldOpacity.value = inpOpacity.value = String(s.opacity);
      sldBackgroundHue.value = inpBackgroundHue.value = String(s.backgroundHue);
      sldBackgroundSaturation.value = inpBackgroundSaturation.value = String(s.backgroundSaturation);
      sldBackgroundBrightest.value = inpBackgroundBrightest.value = String(s.backgroundBrightest);
      sldBackgroundDarkest.value = inpBackgroundDarkest.value = String(s.backgroundDarkest);
      sldFgContrastStrength.value = inpFgContrastStrength.value = String(s.fgContrastStrength);
      sldFgContrastBias.value = inpFgContrastBias.value = String(s.fgContrastBias);
      sldTuiSaturation.value = inpTuiSaturation.value = String(s.tuiSaturation);
      sldThemeHue.value = inpThemeHue.value = String(s.themeHue);
      sldThemeSat.value = inpThemeSat.value = String(s.themeSat);
      sldThemeLtn.value = inpThemeLtn.value = String(s.themeLtn);
      sldThemeContrast.value = inpThemeContrast.value = String(s.themeContrast);
      sldDepth.value = inpDepth.value = String(s.depth);
      refreshAllSliderFills();
    };
    // Expose so updateSession() can refresh the visible controls when tmux
    // switches sessions underneath us.
    this.syncSettingsUi = syncUi;

    syncUi(getSettings());

    const commit = (patch: Partial<SessionSettings>) => {
      const current = getSettings();
      const updated: SessionSettings = { ...current, ...patch };
      saveSessionSettings(this.currentSession, updated);
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
      if (theme?.defaultTuiBgOpacity !== undefined) td.tuiBgOpacity = theme.defaultTuiBgOpacity;
      if (theme?.defaultTuiFgOpacity !== undefined) td.tuiFgOpacity = theme.defaultTuiFgOpacity;
      if (theme?.defaultTuiSaturation !== undefined) td.tuiSaturation = theme.defaultTuiSaturation;
      if (theme?.defaultThemeHue !== undefined) td.themeHue = theme.defaultThemeHue;
      if (theme?.defaultThemeSat !== undefined) td.themeSat = theme.defaultThemeSat;
      if (theme?.defaultThemeLtn !== undefined) td.themeLtn = theme.defaultThemeLtn;
      if (theme?.defaultThemeContrast !== undefined) td.themeContrast = theme.defaultThemeContrast;
      if (theme?.defaultDepth !== undefined) td.depth = theme.defaultDepth;
      if (theme?.defaultBackgroundHue !== undefined) td.backgroundHue = theme.defaultBackgroundHue;
      if (theme?.defaultBackgroundSaturation !== undefined) td.backgroundSaturation = theme.defaultBackgroundSaturation;
      if (theme?.defaultBackgroundBrightest !== undefined) td.backgroundBrightest = theme.defaultBackgroundBrightest;
      if (theme?.defaultBackgroundDarkest !== undefined) td.backgroundDarkest = theme.defaultBackgroundDarkest;
      const current = getSettings();
      const updated = applyThemeDefaults({ ...current, theme: name }, td);
      saveSessionSettings(this.currentSession, updated);
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

    sldSize.addEventListener('input', () => { inpSize.value = sldSize.value; commit({ fontSize: parseFloat(sldSize.value) }); });
    inpSize.addEventListener('change', () => { sldSize.value = inpSize.value; updateSliderFill(sldSize); commit({ fontSize: parseFloat(inpSize.value) }); });

    sldHeight.addEventListener('input', () => { inpHeight.value = sldHeight.value; commit({ spacing: parseFloat(sldHeight.value) }); });
    inpHeight.addEventListener('change', () => { sldHeight.value = inpHeight.value; updateSliderFill(sldHeight); commit({ spacing: parseFloat(inpHeight.value) }); });

    sldTuiBgOpacity.addEventListener('input', () => { inpTuiBgOpacity.value = sldTuiBgOpacity.value; commit({ tuiBgOpacity: parseInt(sldTuiBgOpacity.value, 10) }); });
    inpTuiBgOpacity.addEventListener('change', () => { sldTuiBgOpacity.value = inpTuiBgOpacity.value; updateSliderFill(sldTuiBgOpacity); commit({ tuiBgOpacity: parseInt(inpTuiBgOpacity.value, 10) }); });

    sldTuiFgOpacity.addEventListener('input', () => { inpTuiFgOpacity.value = sldTuiFgOpacity.value; commit({ tuiFgOpacity: parseInt(sldTuiFgOpacity.value, 10) }); });
    inpTuiFgOpacity.addEventListener('change', () => { sldTuiFgOpacity.value = inpTuiFgOpacity.value; updateSliderFill(sldTuiFgOpacity); commit({ tuiFgOpacity: parseInt(inpTuiFgOpacity.value, 10) }); });

    sldOpacity.addEventListener('input', () => { inpOpacity.value = sldOpacity.value; commit({ opacity: parseInt(sldOpacity.value, 10) }); });
    inpOpacity.addEventListener('change', () => { sldOpacity.value = inpOpacity.value; updateSliderFill(sldOpacity); commit({ opacity: parseInt(inpOpacity.value, 10) }); });

    sldBackgroundHue.addEventListener('input', () => {
      const hue = clampBackgroundHue(parseInt(sldBackgroundHue.value, 10));
      inpBackgroundHue.value = String(hue);
      commit({ backgroundHue: hue });
    });
    inpBackgroundHue.addEventListener('change', () => {
      const hue = clampBackgroundHue(parseInt(inpBackgroundHue.value, 10));
      sldBackgroundHue.value = inpBackgroundHue.value = String(hue);
      updateSliderFill(sldBackgroundHue);
      commit({ backgroundHue: hue });
    });

    sldBackgroundSaturation.addEventListener('input', () => {
      const v = clampBackgroundSaturation(parseInt(sldBackgroundSaturation.value, 10));
      inpBackgroundSaturation.value = String(v);
      commit({ backgroundSaturation: v });
    });
    inpBackgroundSaturation.addEventListener('change', () => {
      const v = clampBackgroundSaturation(parseInt(inpBackgroundSaturation.value, 10));
      sldBackgroundSaturation.value = inpBackgroundSaturation.value = String(v);
      updateSliderFill(sldBackgroundSaturation);
      commit({ backgroundSaturation: v });
    });

    sldBackgroundBrightest.addEventListener('input', () => {
      const v = clampBackgroundBrightest(parseInt(sldBackgroundBrightest.value, 10));
      inpBackgroundBrightest.value = String(v);
      commit({ backgroundBrightest: v });
    });
    inpBackgroundBrightest.addEventListener('change', () => {
      const v = clampBackgroundBrightest(parseInt(inpBackgroundBrightest.value, 10));
      sldBackgroundBrightest.value = inpBackgroundBrightest.value = String(v);
      updateSliderFill(sldBackgroundBrightest);
      commit({ backgroundBrightest: v });
    });

    sldBackgroundDarkest.addEventListener('input', () => {
      const v = clampBackgroundDarkest(parseInt(sldBackgroundDarkest.value, 10));
      inpBackgroundDarkest.value = String(v);
      commit({ backgroundDarkest: v });
    });
    inpBackgroundDarkest.addEventListener('change', () => {
      const v = clampBackgroundDarkest(parseInt(inpBackgroundDarkest.value, 10));
      sldBackgroundDarkest.value = inpBackgroundDarkest.value = String(v);
      updateSliderFill(sldBackgroundDarkest);
      commit({ backgroundDarkest: v });
    });

    sldFgContrastStrength.addEventListener('input', () => {
      const v = clampFgContrastStrength(parseInt(sldFgContrastStrength.value, 10));
      inpFgContrastStrength.value = String(v);
      commit({ fgContrastStrength: v });
    });
    inpFgContrastStrength.addEventListener('change', () => {
      const v = clampFgContrastStrength(parseInt(inpFgContrastStrength.value, 10));
      sldFgContrastStrength.value = inpFgContrastStrength.value = String(v);
      updateSliderFill(sldFgContrastStrength);
      commit({ fgContrastStrength: v });
    });

    sldFgContrastBias.addEventListener('input', () => {
      const v = clampFgContrastBias(parseInt(sldFgContrastBias.value, 10));
      inpFgContrastBias.value = String(v);
      commit({ fgContrastBias: v });
    });
    inpFgContrastBias.addEventListener('change', () => {
      const v = clampFgContrastBias(parseInt(inpFgContrastBias.value, 10));
      sldFgContrastBias.value = inpFgContrastBias.value = String(v);
      updateSliderFill(sldFgContrastBias);
      commit({ fgContrastBias: v });
    });

    sldTuiSaturation.addEventListener('input', () => {
      const v = clampTuiSaturation(parseInt(sldTuiSaturation.value, 10));
      inpTuiSaturation.value = String(v);
      commit({ tuiSaturation: v });
    });
    inpTuiSaturation.addEventListener('change', () => {
      const v = clampTuiSaturation(parseInt(inpTuiSaturation.value, 10));
      sldTuiSaturation.value = inpTuiSaturation.value = String(v);
      updateSliderFill(sldTuiSaturation);
      commit({ tuiSaturation: v });
    });

    sldThemeHue.addEventListener('input', () => {
      const v = clampThemeHue(parseInt(sldThemeHue.value, 10));
      inpThemeHue.value = String(v);
      commit({ themeHue: v });
    });
    inpThemeHue.addEventListener('change', () => {
      const v = clampThemeHue(parseInt(inpThemeHue.value, 10));
      sldThemeHue.value = inpThemeHue.value = String(v);
      updateSliderFill(sldThemeHue);
      commit({ themeHue: v });
    });

    sldThemeSat.addEventListener('input', () => {
      const v = clampThemeSat(parseInt(sldThemeSat.value, 10));
      inpThemeSat.value = String(v);
      commit({ themeSat: v });
    });
    inpThemeSat.addEventListener('change', () => {
      const v = clampThemeSat(parseInt(inpThemeSat.value, 10));
      sldThemeSat.value = inpThemeSat.value = String(v);
      updateSliderFill(sldThemeSat);
      commit({ themeSat: v });
    });

    sldThemeLtn.addEventListener('input', () => {
      const v = clampThemeLtn(parseInt(sldThemeLtn.value, 10));
      inpThemeLtn.value = String(v);
      commit({ themeLtn: v });
    });
    inpThemeLtn.addEventListener('change', () => {
      const v = clampThemeLtn(parseInt(inpThemeLtn.value, 10));
      sldThemeLtn.value = inpThemeLtn.value = String(v);
      updateSliderFill(sldThemeLtn);
      commit({ themeLtn: v });
    });

    sldThemeContrast.addEventListener('input', () => {
      const v = clampThemeContrast(parseInt(sldThemeContrast.value, 10));
      inpThemeContrast.value = String(v);
      commit({ themeContrast: v });
    });
    inpThemeContrast.addEventListener('change', () => {
      const v = clampThemeContrast(parseInt(inpThemeContrast.value, 10));
      sldThemeContrast.value = inpThemeContrast.value = String(v);
      updateSliderFill(sldThemeContrast);
      commit({ themeContrast: v });
    });

    sldDepth.addEventListener('input', () => {
      const v = clampDepth(parseInt(sldDepth.value, 10));
      inpDepth.value = String(v);
      commit({ depth: v });
    });
    inpDepth.addEventListener('change', () => {
      const v = clampDepth(parseInt(inpDepth.value, 10));
      sldDepth.value = inpDepth.value = String(v);
      updateSliderFill(sldDepth);
      commit({ depth: v });
    });

    // Double-click-to-reset wiring. Each entry maps a slider / number
    // input pair to a function that resolves the *current* default
    // (some defaults track the active theme, so we look them up lazily
    // rather than capturing a value at setup time).
    type SliderReset = {
      slider: HTMLInputElement;
      input: HTMLInputElement;
      getDefault: () => number;
      key: keyof SessionSettings;
    };
    const activeTheme = () => themes.find(t => t.name === getSettings().theme);
    const resets: SliderReset[] = [
      { slider: sldSize, input: inpSize, key: 'fontSize',
        getDefault: () => activeTheme()?.defaultFontSize ?? DEFAULT_SESSION_SETTINGS.fontSize },
      { slider: sldHeight, input: inpHeight, key: 'spacing',
        getDefault: () => activeTheme()?.defaultSpacing ?? DEFAULT_SESSION_SETTINGS.spacing },
      { slider: sldTuiBgOpacity, input: inpTuiBgOpacity, key: 'tuiBgOpacity',
        getDefault: () => activeTheme()?.defaultTuiBgOpacity ?? DEFAULT_SESSION_SETTINGS.tuiBgOpacity },
      { slider: sldTuiFgOpacity, input: inpTuiFgOpacity, key: 'tuiFgOpacity',
        getDefault: () => activeTheme()?.defaultTuiFgOpacity ?? DEFAULT_SESSION_SETTINGS.tuiFgOpacity },
      { slider: sldOpacity, input: inpOpacity, key: 'opacity',
        getDefault: () => activeTheme()?.defaultOpacity ?? DEFAULT_SESSION_SETTINGS.opacity },
      { slider: sldFgContrastStrength, input: inpFgContrastStrength, key: 'fgContrastStrength',
        getDefault: () => DEFAULT_FG_CONTRAST_STRENGTH },
      { slider: sldFgContrastBias, input: inpFgContrastBias, key: 'fgContrastBias',
        getDefault: () => DEFAULT_FG_CONTRAST_BIAS },
      { slider: sldTuiSaturation, input: inpTuiSaturation, key: 'tuiSaturation',
        getDefault: () => activeTheme()?.defaultTuiSaturation ?? DEFAULT_TUI_SATURATION },
      { slider: sldThemeHue, input: inpThemeHue, key: 'themeHue',
        getDefault: () => activeTheme()?.defaultThemeHue ?? DEFAULT_THEME_HUE },
      { slider: sldThemeSat, input: inpThemeSat, key: 'themeSat',
        getDefault: () => activeTheme()?.defaultThemeSat ?? DEFAULT_THEME_SAT },
      { slider: sldThemeLtn, input: inpThemeLtn, key: 'themeLtn',
        getDefault: () => activeTheme()?.defaultThemeLtn ?? DEFAULT_THEME_LTN },
      { slider: sldThemeContrast, input: inpThemeContrast, key: 'themeContrast',
        getDefault: () => activeTheme()?.defaultThemeContrast ?? DEFAULT_THEME_CONTRAST },
      { slider: sldDepth, input: inpDepth, key: 'depth',
        getDefault: () => activeTheme()?.defaultDepth ?? DEFAULT_DEPTH },
      { slider: sldBackgroundHue, input: inpBackgroundHue, key: 'backgroundHue',
        getDefault: () => activeTheme()?.defaultBackgroundHue ?? DEFAULT_BACKGROUND_HUE },
      { slider: sldBackgroundSaturation, input: inpBackgroundSaturation, key: 'backgroundSaturation',
        getDefault: () => activeTheme()?.defaultBackgroundSaturation ?? DEFAULT_BACKGROUND_SATURATION },
      { slider: sldBackgroundBrightest, input: inpBackgroundBrightest, key: 'backgroundBrightest',
        getDefault: () => activeTheme()?.defaultBackgroundBrightest ?? DEFAULT_BACKGROUND_BRIGHTEST },
      { slider: sldBackgroundDarkest, input: inpBackgroundDarkest, key: 'backgroundDarkest',
        getDefault: () => activeTheme()?.defaultBackgroundDarkest ?? DEFAULT_BACKGROUND_DARKEST },
    ];
    for (const { slider, input, getDefault, key } of resets) {
      const reset = () => {
        const def = getDefault();
        slider.value = input.value = String(def);
        updateSliderFill(slider);
        commit({ [key]: def } as Partial<SessionSettings>);
      };
      slider.addEventListener('dblclick', reset);
      input.addEventListener('dblclick', reset);
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
    return location.pathname.replace(/^\/+|\/+$/g, '') || 'main';
  }

  private sendWindowMsg(msg: { action: string; index?: string; name?: string }): void {
    // All window actions go through typed WS messages that the server
    // runs via the tmux binary directly. This avoids depending on the
    // user's tmux prefix binding (which may not be C-s) or the PTY's
    // current input mode.
    this.opts.send(JSON.stringify({ type: 'window', ...msg }));
  }

  /** Build a `.menu-row` containing a labelled checkbox. */
  private buildMenuCheckboxRow(opts: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }): HTMLElement {
    const row = document.createElement('label');
    row.className = 'menu-row';
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
      el.textContent = w.index + ': ' + w.name;
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
        // Native confirm() is intentional here — destructive tmux actions are
        // infrequent and a custom modal would duplicate the clipboard-prompt
        // code path for marginal UX gain. See 2026-04-17 code-analysis UX-1.
        if (!confirm(`Close window "${activeName}"?`)) return;
        this.sendWindowMsg({ action: 'close', index: activeIdx });
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
        btn.className = 'win-tab' + (w.active ? ' active' : '');
        btn.textContent = w.index + ':' + w.name;
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
      this.tbTitle.textContent = '';
    }
    this.cachedWindows = windows.slice();
    this.renderWinTabs();
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
    this.sessionNameEl.textContent = session;

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
