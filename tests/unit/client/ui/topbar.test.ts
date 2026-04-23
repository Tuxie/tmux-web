import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { setupDocument, el as stubEl, stubFetch, type StubDoc, type StubElement } from '../_dom.js';
import {
  DEFAULT_SESSION_SETTINGS,
  loadSessionSettings,
  _resetSessionStore,
  type SessionSettings,
} from '../../../../src/client/session-settings.ts';
import { DEFAULT_BACKGROUND_HUE, DEFAULT_THEME_HUE } from '../../../../src/client/background-hue.ts';
import { DEFAULT_FG_CONTRAST_STRENGTH } from '../../../../src/client/fg-contrast.ts';
import { clearCaches, type ThemeInfo } from '../../../../src/client/theme.ts';

/** Topbar orchestration tests.
 *
 *  The Topbar class owns ~1,000 lines of DOM wiring, an async
 *  init() that fetches themes / fonts / colours, a slider table of 17
 *  rows (see cluster 11), and a windows-menu render path that depends
 *  on the dropdown module (separately tested). This file focuses on
 *  the testable behavioural surface that doesn't require a WebGL
 *  context or a full settings-menu mock:
 *    - currentSession path parsing
 *    - updateTitle / updateSession / updateWindows
 *    - renderWinTabs output in both `tabs-shown` and compact modes
 *    - sendWindowMsg via opts.send
 *    - toggleFullscreen wiring
 *    - show() auto-hide behaviour
 *
 *  The settings-input + slider-wiring path is exercised indirectly
 *  through init(), which is allowed to complete against stubbed
 *  `/api/themes`, `/api/fonts`, `/api/colours`, and `/api/session-
 *  settings` responses. A per-file line-coverage override in
 *  `scripts/check-coverage.ts` acknowledges that the WebGL-adjacent
 *  lifecycle paths are not fully unit-testable today.
 */

const origSetTimeout = globalThis.setTimeout;
const origClearTimeout = globalThis.clearTimeout;
const origLocation = (globalThis as any).location;
const origHistory = (globalThis as any).history;
const origFetch = (globalThis as any).fetch;
const origEvent = (globalThis as any).Event;
const origWindow = (globalThis as any).window;
const origMO = (globalThis as any).MutationObserver;

afterAll(() => {
  (globalThis as any).setTimeout = origSetTimeout;
  (globalThis as any).clearTimeout = origClearTimeout;
  (globalThis as any).location = origLocation;
  (globalThis as any).history = origHistory;
  (globalThis as any).fetch = origFetch;
  (globalThis as any).Event = origEvent;
  (globalThis as any).window = origWindow;
  (globalThis as any).MutationObserver = origMO;
});

function ext(e: StubElement): any {
  const any = e as any;
  if (!('dataset' in any)) any.dataset = {};
  if (!('hidden' in any)) any.hidden = false;
  if (!('offsetWidth' in any)) any.offsetWidth = 120;
  if (!('offsetHeight' in any)) any.offsetHeight = 80;
  if (!('nextSibling' in any)) any.nextSibling = null;
  if (!('title' in any)) any.title = '';
  if (!('value' in any)) any.value = '';
  if (!('checked' in any)) any.checked = false;
  if (!any.style.setProperty) any.style.setProperty = (k: string, v: string) => { any.style[k] = v; };
  if (!any.getBoundingClientRect) {
    any.getBoundingClientRect = () => ({
      top: 0, left: 0, right: 120, bottom: 80, width: 120, height: 80,
      x: 0, y: 0, toJSON() { return this; },
    });
  }
  Object.defineProperty(any, 'parentElement', {
    get() { return any.parentNode ?? null; },
    configurable: true,
  });
  Object.defineProperty(any, 'innerHTML', {
    set(v: string) { if (v === '') any.children.length = 0; },
    get() { return ''; },
    configurable: true,
  });
  const origAppend = any.appendChild;
  any.appendChild = (child: StubElement) => {
    ext(child);
    return origAppend.call(any, child);
  };
  any.insertBefore = (child: StubElement, ref: StubElement | null) => {
    ext(child);
    const parent = any;
    const idx = ref ? parent.children.indexOf(ref) : parent.children.length;
    parent.children.splice(idx < 0 ? parent.children.length : idx, 0, child);
    (child as any).parentNode = parent;
    return child;
  };
  if (!any.blur) any.blur = () => {};
  if (!any.select) any.select = () => {};
  if (!any.dispatchEvent) any.dispatchEvent = (ev: any) => any.dispatch(ev.type, ev);
  if (!any.replaceChildren) any.replaceChildren = (...kids: any[]) => {
    any.children.length = 0;
    for (const k of kids) any.appendChild(k);
  };
  return any;
}

const REQUIRED_IDS = [
  'topbar', 'tb-session-name', 'win-tabs', 'tb-title', 'chk-autohide',
  'btn-session-menu', 'btn-session-plus', 'menu-wrap', 'btn-menu',
  'menu-dropdown', 'menu-footer', 'menu-footer-left', 'menu-footer-right',
  'chk-fullscreen', 'inp-theme', 'inp-colours', 'inp-font-bundled',
  'btn-reset-colours', 'btn-reset-font', 'chk-subpixel-aa',
  'sld-fontsize', 'inp-fontsize', 'sld-spacing', 'inp-spacing',
  'sld-tui-bg-opacity', 'inp-tui-bg-opacity',
  'sld-tui-fg-opacity', 'inp-tui-fg-opacity',
  'sld-opacity', 'inp-opacity',
  'sld-theme-hue', 'inp-theme-hue', 'sld-theme-sat', 'inp-theme-sat',
  'sld-theme-ltn', 'inp-theme-ltn', 'sld-theme-contrast', 'inp-theme-contrast',
  'sld-depth', 'inp-depth',
  'sld-background-hue', 'inp-background-hue',
  'sld-background-saturation', 'inp-background-saturation',
  'sld-background-brightest', 'inp-background-brightest',
  'sld-background-darkest', 'inp-background-darkest',
  'sld-fg-contrast-strength', 'inp-fg-contrast-strength',
  'sld-fg-contrast-bias', 'inp-fg-contrast-bias',
  'sld-tui-saturation', 'inp-tui-saturation',
  'drops-list', 'drops-count', 'btn-drops-refresh', 'btn-drops-purge',
];

function makeDoc(): StubDoc {
  const doc = setupDocument();
  ext(doc.body);
  const origCreate = doc.createElement;
  doc.createElement = (tag: string) => ext(origCreate.call(doc, tag));
  (doc as any).querySelectorAll = () => [];
  (doc as any).querySelector = () => null;
  for (const id of REQUIRED_IDS) {
    const e = ext(doc.createElement(id.startsWith('sld') ? 'input' : 'div'));
    (e as any).id = id;
    (e as any).min = '0';
    (e as any).max = '100';
    if (id.startsWith('sld')) (e as any).type = 'range';
    if (id.startsWith('inp-') && !id.startsWith('inp-theme') && !id.startsWith('inp-colours') && !id.startsWith('inp-font')) {
      (e as any).type = 'number';
    }
    if (id === 'inp-theme' || id === 'inp-colours' || id === 'inp-font-bundled') {
      (e as any).tagName = 'SELECT';
      (e as any).options = [];
      Object.defineProperty(e, 'selectedOptions', { get() { return []; }, configurable: true });
    }
    doc.__byId[id] = e as any;
    doc.body.appendChild(e);
  }
  return doc;
}

function installGlobals() {
  (globalThis as any).setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;
  (globalThis as any).clearTimeout = () => {};
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  (globalThis as any).location = {
    protocol: 'http:',
    host: 'localhost',
    pathname: '/main',
  };
  const historyCalls: Array<{ state: any; title: string; path: string }> = [];
  (globalThis as any).history = {
    replaceState: (state: any, title: string, path: string) => {
      (globalThis as any).location.pathname = path;
      historyCalls.push({ state, title, path });
    },
  };
  (globalThis as any).__historyCalls = historyCalls;
  (globalThis as any).Event = class { type: string; constructor(t: string) { this.type = t; } };
  (globalThis as any).window = { innerWidth: 1024, innerHeight: 800 };
  (globalThis as any).MutationObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

async function mountTopbar(overrides: Partial<Parameters<typeof freshTopbarCtor>[0]> = {}) {
  installGlobals();
  makeDoc();
  // Responses keyed by URL prefix. listThemes / listFonts / fetchColours
  // / initSessionStore all cache on success, so returning [] / empty
  // sessions config is a stable starting state.
  stubFetch(async (url) => {
    if (url.startsWith('/api/themes')) return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/fonts')) return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/colours')) return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/session-settings')) {
      return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
    }
    if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/drops')) return { ok: true, json: async () => ({ drops: [] }) } as any;
    return { ok: true, json: async () => ({}) } as any;
  });
  return await freshTopbarCtor(overrides);
}

async function mountTopbarWithSettings(opts: {
  themes?: ThemeInfo[];
  sessions?: Record<string, Partial<SessionSettings>>;
  onSettingsChange?: (s: SessionSettings) => void;
} = {}) {
  installGlobals();
  makeDoc();
  const sessions = opts.sessions ?? {};
  _resetSessionStore({
    sessions: Object.fromEntries(
      Object.entries(sessions).map(([name, settings]) => [
        name,
        { ...DEFAULT_SESSION_SETTINGS, ...settings },
      ]),
    ),
  });
  stubFetch(async (url, init) => {
    if (url.startsWith('/api/themes')) return { ok: true, json: async () => opts.themes ?? [] } as any;
    if (url.startsWith('/api/fonts')) return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/colours')) return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/session-settings')) {
      if (init?.method === 'PUT') return { ok: true, json: async () => ({}) } as any;
      return { ok: true, json: async () => ({ version: 1, sessions }) } as any;
    }
    if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/drops')) return { ok: true, json: async () => ({ drops: [] }) } as any;
    return { ok: true, json: async () => ({}) } as any;
  });
  const t = await freshTopbarCtor({ onSettingsChange: opts.onSettingsChange as any });
  await t.init();
  return t;
}

async function freshTopbarCtor(overrides: {
  send?: (data: string) => void;
  focus?: () => void;
  getLiveSettings?: () => any;
  onAutohideChange?: () => void;
  onSettingsChange?: (s: any) => void | Promise<void>;
  onSwitchSession?: (name: string) => void;
} = {}) {
  const { Topbar } = await import('../../../../src/client/ui/topbar.ts');
  const t = new Topbar({
    send: overrides.send ?? (() => {}),
    focus: overrides.focus ?? (() => {}),
    getLiveSettings: overrides.getLiveSettings ?? (() => null),
    onAutohideChange: overrides.onAutohideChange,
    onSettingsChange: overrides.onSettingsChange,
    onSwitchSession: overrides.onSwitchSession,
  });
  return t;
}

beforeEach(() => {
  _resetSessionStore();
  clearCaches();
  installGlobals();
});

describe('Topbar.currentSession', () => {
  it('reads the session from location.pathname', async () => {
    installGlobals();
    (globalThis as any).location.pathname = '/dev';
    makeDoc();
    const t = await freshTopbarCtor();
    expect(t.currentSession).toBe('dev');
  });

  it('strips leading and trailing slashes', async () => {
    installGlobals();
    (globalThis as any).location.pathname = '///my-session///';
    makeDoc();
    const t = await freshTopbarCtor();
    expect(t.currentSession).toBe('my-session');
  });

  it('falls back to "main" on a bare root path', async () => {
    installGlobals();
    (globalThis as any).location.pathname = '/';
    makeDoc();
    const t = await freshTopbarCtor();
    expect(t.currentSession).toBe('main');
  });
});

describe('Topbar.init + updateTitle / updateWindows / renderWinTabs', () => {
  it('init succeeds against empty-API stubs', async () => {
    const t = await mountTopbar();
    await t.init();
    // No throw = pass. The topbar should have read the expected IDs.
  });

  it('updateTitle writes to the title element', async () => {
    const t = await mountTopbar();
    await t.init();
    t.updateTitle('hello world');
    const title = (globalThis.document as any).getElementById('tb-title');
    expect(title.textContent).toBe('hello world');
  });

  it('updateWindows populates the windows tab strip with an active flag', async () => {
    const t = await mountTopbar();
    await t.init();
    // Force tabs mode by poking the pref storage before render.
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    t.updateWindows([
      { index: '0', name: 'zsh', active: true },
      { index: '1', name: 'vim', active: false },
    ]);
    const winTabs = (globalThis.document as any).getElementById('win-tabs');
    // Two tabs + the windows-menu trailing button.
    expect(winTabs.children.length).toBe(3);
    const first = winTabs.children[0] as any;
    expect(first.className).toContain('tw-win-tab');
    expect(first.className).toContain('active');
  });

  it('renderWinTabs always appends the compact window-menu button as the trailing element', async () => {
    const t = await mountTopbar();
    await t.init();
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    (t as any).lastWinTabsKey = '';
    t.updateWindows([
      { index: '0', name: 'zsh', active: true },
      { index: '1', name: 'vim', active: false },
    ]);
    const winTabs = (globalThis.document as any).getElementById('win-tabs');
    const last = winTabs.children[winTabs.children.length - 1] as any;
    expect(last.className).toContain('tb-btn-window-compact');
  });

  it('clicking a tab sends a window select message via opts.send', async () => {
    const outgoing: string[] = [];
    const t = await mountTopbar({ send: (s) => outgoing.push(s) });
    await t.init();
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    (t as any).lastWinTabsKey = '';
    t.updateWindows([
      { index: '0', name: 'zsh', active: true },
      { index: '1', name: 'vim', active: false },
    ]);
    const winTabs = (globalThis.document as any).getElementById('win-tabs');
    const secondTab = winTabs.children[1] as any;
    secondTab.click();
    expect(outgoing).toContain(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
  });

  it('repeated updateWindows with the same windows + tabs pref is a no-op', async () => {
    const t = await mountTopbar();
    await t.init();
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    (t as any).lastWinTabsKey = '';
    t.updateWindows([{ index: '0', name: 'zsh', active: true }]);
    const winTabs = (globalThis.document as any).getElementById('win-tabs');
    const before = winTabs.children[0];
    t.updateWindows([{ index: '0', name: 'zsh', active: true }]);
    // Same key → no re-render, same element reference.
    expect(winTabs.children[0]).toBe(before);
  });

  it('renderWindowsMenu lists every window from cachedWindows with index + name', async () => {
    // Regression guard for the "windows menu is empty" half of the
    // `tmux -C` cmdnum-mismatch bug: even if the WS push delivered the
    // window list correctly, an empty `cachedWindows` would render a
    // menu with no window rows. Prove the render iterates the cache.
    const t = await mountTopbar();
    await t.init();
    t.updateWindows([
      { index: '0', name: 'zsh', active: true },
      { index: '1', name: 'vim', active: false },
      { index: '2', name: 'logs', active: false },
    ]);
    const menu: any = (globalThis.document as any).createElement('div');
    (t as any).renderWindowsMenu(menu, () => {});
    // First three children must be the per-window rows, in cache order.
    const rows = menu.children.slice(0, 3);
    expect(rows.map((r: any) => r.textContent)).toEqual([
      '0: zsh', '1: vim', '2: logs',
    ]);
    // Active window gets the `current` marker class + aria-selected.
    expect(rows[0].className).toContain('current');
    expect(rows[1].className).not.toContain('current');
  });

  it('renderWindowsMenu with empty cachedWindows renders no window rows (only the input + footer block)', async () => {
    // Mirror of the live-server bug: if the WS push delivered `windows: []`
    // because `tmuxControl.run(list-windows)` rejected, the menu would
    // open with nothing to pick from. Make that observable.
    const t = await mountTopbar();
    await t.init();
    t.updateWindows([]);
    const menu: any = (globalThis.document as any).createElement('div');
    (t as any).renderWindowsMenu(menu, () => {});
    const winRows = menu.children.filter((c: any) =>
      typeof c.className === 'string' && c.className.includes('tw-dd-session-item')
    );
    expect(winRows.length).toBe(0);
  });

  it('renderSessionsMenu does NOT render the tmux session id (id is internal-only, hidden from the user)', async () => {
    const t = await mountTopbar();
    await t.init();
    (t as any).cachedSessions = [
      { id: '0', name: 'main' },
      { id: '7', name: 'dev' },
    ];
    const menu: any = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    // No row contains a `.tw-dd-session-id` child.
    const rows = menu.children.filter((c: any) =>
      typeof c.className === 'string' && c.className.includes('tw-dd-session-item')
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const idChildren = (row.children as any[]).filter((c: any) =>
        typeof c.className === 'string' && c.className.includes('tw-dd-session-id')
      );
      expect(idChildren.length).toBe(0);
    }
  });

  it('clicking a row in the windows menu sends a `window select` message', async () => {
    const outgoing: string[] = [];
    const t = await mountTopbar({ send: (s) => outgoing.push(s) });
    await t.init();
    t.updateWindows([
      { index: '0', name: 'zsh', active: true },
      { index: '1', name: 'vim', active: false },
    ]);
    const menu: any = (globalThis.document as any).createElement('div');
    (t as any).renderWindowsMenu(menu, () => {});
    // Row index 1 == vim; click it.
    const vimRow = menu.children[1];
    vimRow.click();
    expect(outgoing).toContain(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
  });
});

describe('Topbar.updateSession', () => {
  it('writes the path to location via history.replaceState when switching', async () => {
    installGlobals();
    (globalThis as any).location.pathname = '/main';
    makeDoc();
    const t = await freshTopbarCtor();
    await t.init();
    t.updateSession('other');
    expect((globalThis as any).__historyCalls).toEqual([
      { state: null, title: '', path: '/other' },
    ]);
  });

  it('does not push history when the session is unchanged', async () => {
    installGlobals();
    (globalThis as any).location.pathname = '/main';
    makeDoc();
    const t = await freshTopbarCtor();
    await t.init();
    t.updateSession('main');
    expect((globalThis as any).__historyCalls).toEqual([]);
  });

  it('invokes opts.onSettingsChange when switching sessions', async () => {
    let settingsSet: any[] = [];
    const t = await mountTopbar({ onSettingsChange: (s) => { settingsSet.push(s); } });
    await t.init();
    t.updateSession('alpha');
    // Let microtasks settle (onSettingsChange returns void|Promise).
    await new Promise((r) => setImmediate(r as any));
    expect(settingsSet.length).toBeGreaterThan(0);
  });
});

describe('Topbar.show', () => {
  it('removes the hidden class from the topbar', async () => {
    const t = await mountTopbar();
    await t.init();
    const tb = (globalThis.document as any).getElementById('topbar');
    tb.classList.add('hidden');
    t.show();
    expect(tb.classList.has('hidden')).toBe(false);
  });

  it('does not schedule auto-hide when the #menu-dropdown is open', async () => {
    const t = await mountTopbar();
    await t.init();
    const tb = (globalThis.document as any).getElementById('topbar');
    const menu = (globalThis.document as any).getElementById('menu-dropdown');
    (t as any).autohide = true;
    (menu as any).hidden = false;
    tb.classList.add('hidden');
    t.show();
    // Dropdown is open → show() must keep the topbar visible.
    expect(tb.classList.has('hidden')).toBe(false);
  });
});

describe('Topbar menu and autohide DOM behaviour', () => {
  it('right-click on the hamburger toggles the settings menu', async () => {
    const t = await mountTopbar();
    await t.init();
    void t;
    const btn = (globalThis.document as any).getElementById('btn-menu');
    const menu = (globalThis.document as any).getElementById('menu-dropdown');
    menu.hidden = true;

    let prevented = 0;
    let stopped = 0;
    const event = {
      target: btn,
      preventDefault() { prevented++; },
      stopPropagation() { stopped++; },
    };

    btn.dispatch('contextmenu', event);
    expect(menu.hidden).toBe(false);
    expect(btn.classList.has('open')).toBe(true);

    btn.dispatch('contextmenu', event);
    expect(menu.hidden).toBe(true);
    expect(btn.classList.has('open')).toBe(false);
    expect(prevented).toBe(2);
    expect(stopped).toBe(2);
  });

  it('autohide hides the topbar after the scheduled inactivity timer', async () => {
    const t = await mountTopbar();
    await t.init();
    (t as any).autohide = true;
    const tb = (globalThis.document as any).getElementById('topbar');
    const menu = (globalThis.document as any).getElementById('menu-dropdown');
    menu.hidden = true;
    const timers: Array<() => void> = [];
    (globalThis as any).setTimeout = (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    };
    (globalThis as any).clearTimeout = () => {};

    (globalThis.document as any).dispatch('mousemove', { clientY: 10 });
    expect(tb.classList.has('hidden')).toBe(false);

    timers.forEach(fn => fn());
    expect(tb.classList.has('hidden')).toBe(true);
  });

  it('autohide reappears when the mouse moves near the top', async () => {
    const t = await mountTopbar();
    await t.init();
    (t as any).autohide = true;
    const tb = (globalThis.document as any).getElementById('topbar');
    const menu = (globalThis.document as any).getElementById('menu-dropdown');
    menu.hidden = true;
    const timers: Array<() => void> = [];
    (globalThis as any).setTimeout = (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    };
    (globalThis as any).clearTimeout = () => {};
    tb.classList.add('hidden');

    (globalThis.document as any).dispatch('mousemove', { clientY: 50 });

    expect(tb.classList.has('hidden')).toBe(false);
    expect(timers.length).toBe(1);
  });
});

describe('Topbar fullscreen checkbox', () => {
  it('checking the fullscreen checkbox requests fullscreen and syncs checked state', async () => {
    const t = await mountTopbar();
    await t.init();
    const calls: string[] = [];
    let isFullscreen = false;
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => (isFullscreen ? document.documentElement : null),
      configurable: true,
    });
    (document.documentElement as any).requestFullscreen = async () => {
      calls.push('request');
      isFullscreen = true;
      (document as any).dispatch('fullscreenchange', {});
    };

    const chk = (globalThis.document as any).getElementById('chk-fullscreen');
    chk.checked = true;
    chk.dispatch('change', { target: chk });

    expect(calls).toEqual(['request']);
    expect(chk.checked).toBe(true);
  });

  it('unchecking the fullscreen checkbox exits fullscreen and syncs checked state', async () => {
    const t = await mountTopbar();
    await t.init();
    const calls: string[] = [];
    let isFullscreen = true;
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => (isFullscreen ? document.documentElement : null),
      configurable: true,
    });
    (document as any).exitFullscreen = async () => {
      calls.push('exit');
      isFullscreen = false;
      (document as any).dispatch('fullscreenchange', {});
    };

    const chk = (globalThis.document as any).getElementById('chk-fullscreen');
    chk.checked = false;
    chk.dispatch('change', { target: chk });

    expect(calls).toEqual(['exit']);
    expect(chk.checked).toBe(false);
  });
});

describe('Topbar slider double-click reset', () => {
  function input(id: string): any {
    return (globalThis.document as any).getElementById(id);
  }

  function changeValue(id: string, value: string): void {
    const el = input(id);
    el.value = value;
    el.dispatch('change', { target: el });
  }

  function dblclick(id: string): void {
    const el = input(id);
    el.dispatch('dblclick', { target: el });
  }

  function storedMain(): SessionSettings {
    return loadSessionSettings('main', null, { defaults: DEFAULT_SESSION_SETTINGS });
  }

  it('resets a theme-global slider to DEFAULT_THEME_HUE', async () => {
    await mountTopbarWithSettings();

    changeValue('inp-theme-hue', '60');
    expect(storedMain().themeHue).toBe(60);

    dblclick('sld-theme-hue');

    expect(input('inp-theme-hue').value).toBe(String(DEFAULT_THEME_HUE));
    expect(input('sld-theme-hue').value).toBe(String(DEFAULT_THEME_HUE));
    expect(storedMain().themeHue).toBe(DEFAULT_THEME_HUE);
  });

  it('resets a theme-scoped slider to the active theme default', async () => {
    const alt: ThemeInfo = {
      name: 'E2E Alt Theme',
      pack: 'e2e',
      css: 'alt.css',
      source: 'bundled',
      defaultTuiBgOpacity: 70,
    };
    await mountTopbarWithSettings({
      themes: [alt],
      sessions: {
        main: {
          ...DEFAULT_SESSION_SETTINGS,
          theme: alt.name,
          tuiBgOpacity: 25,
        },
      },
    });
    expect(input('inp-tui-bg-opacity').value).toBe('25');

    dblclick('inp-tui-bg-opacity');

    expect(input('inp-tui-bg-opacity').value).toBe('70');
    expect(input('sld-tui-bg-opacity').value).toBe('70');
    expect(storedMain().tuiBgOpacity).toBe(70);
  });

  it('resets the number input half of a pair to the hard-coded default', async () => {
    await mountTopbarWithSettings();

    changeValue('inp-fg-contrast-strength', '80');
    expect(storedMain().fgContrastStrength).toBe(80);

    dblclick('inp-fg-contrast-strength');

    expect(input('inp-fg-contrast-strength').value).toBe(String(DEFAULT_FG_CONTRAST_STRENGTH));
    expect(input('sld-fg-contrast-strength').value).toBe(String(DEFAULT_FG_CONTRAST_STRENGTH));
    expect(storedMain().fgContrastStrength).toBe(DEFAULT_FG_CONTRAST_STRENGTH);
  });

  it('resets background hue to DEFAULT_BACKGROUND_HUE', async () => {
    await mountTopbarWithSettings();

    changeValue('inp-background-hue', '45');
    expect(storedMain().backgroundHue).toBe(45);

    dblclick('sld-background-hue');

    expect(input('inp-background-hue').value).toBe(String(DEFAULT_BACKGROUND_HUE));
    expect(input('sld-background-hue').value).toBe(String(DEFAULT_BACKGROUND_HUE));
    expect(storedMain().backgroundHue).toBe(DEFAULT_BACKGROUND_HUE);
  });
});

describe('Topbar opacity slider wiring', () => {
  function input(id: string): any {
    return (globalThis.document as any).getElementById(id);
  }

  function changeValue(id: string, value: string): void {
    const el = input(id);
    el.value = value;
    el.dispatch('change', { target: el });
  }

  function storedMain(): SessionSettings {
    return loadSessionSettings('main', null, { defaults: DEFAULT_SESSION_SETTINGS });
  }

  it('inp-opacity change persists opacity to session store and fires onSettingsChange', async () => {
    const captured: number[] = [];
    await mountTopbarWithSettings({
      onSettingsChange: (s) => { captured.push(s.opacity); },
    });

    changeValue('inp-opacity', '50');

    expect(captured).toContain(50);
    expect(storedMain().opacity).toBe(50);
  });
});

describe('Topbar font and spacing persistence', () => {
  function input(id: string): any {
    return (globalThis.document as any).getElementById(id);
  }

  function changeValue(id: string, value: string): void {
    const el = input(id);
    el.value = value;
    el.dispatch('change', { target: el });
  }

  function storedMain(): SessionSettings {
    return loadSessionSettings('main', null, { defaults: DEFAULT_SESSION_SETTINGS });
  }

  it('spacing change persists to session store', async () => {
    await mountTopbarWithSettings();
    changeValue('inp-spacing', '1.5');
    expect(storedMain().spacing).toBeCloseTo(1.5, 2);
  });

  it('font and spacing changes both persist to session store', async () => {
    await mountTopbarWithSettings();
    changeValue('inp-font-bundled', 'TestFont');
    changeValue('inp-spacing', '0.85');
    expect(storedMain().fontFamily).toBe('TestFont');
    expect(storedMain().spacing).toBeCloseTo(0.85, 2);
  });

  it('stored font and spacing are reflected in inputs on mount (survives reload)', async () => {
    await mountTopbarWithSettings({
      sessions: { main: { fontFamily: 'StoredFont', spacing: 1.2 } },
    });
    expect(input('inp-font-bundled').value).toBe('StoredFont');
    expect(parseFloat(input('inp-spacing').value)).toBeCloseTo(1.2, 2);
  });
});

describe('Menu stays open during settings changes', () => {
  function el(id: string): any {
    return (globalThis.document as any).getElementById(id);
  }

  function openMenu(): void {
    el('menu-dropdown').hidden = false;
  }

  function dispatchInput(id: string, value: string): void {
    const e = el(id);
    e.value = value;
    e.dispatch('input', { target: e });
  }

  function dispatchChange(id: string, value: string): void {
    const e = el(id);
    e.value = value;
    e.dispatch('change', { target: e });
  }

  it('menu stays open after font size number input change', async () => {
    await mountTopbarWithSettings();
    openMenu();
    dispatchChange('inp-fontsize', '20');
    expect(el('menu-dropdown').hidden).toBe(false);
  });

  it('menu stays open after font size slider change', async () => {
    await mountTopbarWithSettings();
    openMenu();
    dispatchInput('sld-fontsize', '20');
    expect(el('menu-dropdown').hidden).toBe(false);
  });

  it('menu stays open after spacing number input change', async () => {
    await mountTopbarWithSettings();
    openMenu();
    dispatchChange('inp-spacing', '0.9');
    expect(el('menu-dropdown').hidden).toBe(false);
  });

  it('menu stays open after spacing slider change', async () => {
    await mountTopbarWithSettings();
    openMenu();
    dispatchInput('sld-spacing', '0.9');
    expect(el('menu-dropdown').hidden).toBe(false);
  });

  it('menu stays open after switching bundled font', async () => {
    await mountTopbarWithSettings();
    openMenu();
    dispatchChange('inp-font-bundled', 'SomeFont');
    expect(el('menu-dropdown').hidden).toBe(false);
  });
});
