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
import { clearCaches, type ThemeInfo, type FontInfo } from '../../../../src/client/theme.ts';

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
  'topbar', 'tb-session-name', 'win-tabs', 'tb-title', 'chk-autohide', 'chk-scrollbar-autohide',
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
  // applyTheme() awaits a 'load' event on the <link> it appends to head.
  // Auto-fire it so theme-switch handlers can complete in unit tests.
  const headAppendOrig = doc.head.appendChild.bind(doc.head);
  (doc.head as any).appendChild = (child: any) => {
    const result = headAppendOrig(child);
    if ((child.tagName ?? '').toUpperCase() === 'LINK') {
      Promise.resolve().then(() => (child as any).dispatch?.('load', {}));
    }
    return result;
  };
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
  fonts?: FontInfo[];
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
    if (url.startsWith('/api/fonts')) return { ok: true, json: async () => opts.fonts ?? [] } as any;
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

  it('clicking the top-left button asks Electrobun to close the window', async () => {
    const hostMessages: unknown[] = [];
    installGlobals();
    (globalThis.window as any).__electrobunSendToHost = (message: unknown) => {
      hostMessages.push(message);
    };
    makeDoc();
    stubFetch(async (url) => {
      if (url.startsWith('/api/themes')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/fonts')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/colours')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/session-settings')) return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/drops')) return { ok: true, json: async () => ({ drops: [] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    });

    const t = await freshTopbarCtor();
    await t.init();
    ((globalThis.document as any).getElementById('btn-session-plus') as any).click();

    expect(hostMessages).toEqual([{ type: 'tmux-term:close-window' }]);
  });

  it('double-clicking the title asks Electrobun to toggle maximize', async () => {
    const hostMessages: unknown[] = [];
    installGlobals();
    (globalThis.window as any).__electrobunSendToHost = (message: unknown) => {
      hostMessages.push(message);
    };
    makeDoc();
    stubFetch(async (url) => {
      if (url.startsWith('/api/themes')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/fonts')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/colours')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/session-settings')) return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/drops')) return { ok: true, json: async () => ({ drops: [] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    });

    const t = await freshTopbarCtor();
    await t.init();
    ((globalThis.document as any).getElementById('tb-title') as any).dispatch('dblclick', {
      target: (globalThis.document as any).getElementById('tb-title'),
      preventDefault() {},
      stopPropagation() {},
    });

    expect(hostMessages).toEqual([{ type: 'tmux-term:toggle-maximize' }]);
  });

  it('single-clicking the title does not ask Electrobun to restore', async () => {
    const hostMessages: unknown[] = [];
    installGlobals();
    (globalThis.window as any).__electrobunSendToHost = (message: unknown) => {
      hostMessages.push(message);
    };
    makeDoc();
    stubFetch(async (url) => {
      if (url.startsWith('/api/themes')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/fonts')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/colours')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/session-settings')) return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/drops')) return { ok: true, json: async () => ({ drops: [] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    });

    const t = await freshTopbarCtor();
    await t.init();
    ((globalThis.document as any).getElementById('tb-title') as any).dispatch('mousedown', {
      target: (globalThis.document as any).getElementById('tb-title'),
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {},
    });
    (globalThis.document as any).dispatch('mouseup', {
      button: 0,
      preventDefault() {},
      stopPropagation() {},
    });

    expect(hostMessages).toEqual([]);
  });

  it('moving the pressed title less than the drag threshold does not restore', async () => {
    const hostMessages: unknown[] = [];
    installGlobals();
    (globalThis.window as any).__electrobunSendToHost = (message: unknown) => {
      hostMessages.push(message);
    };
    makeDoc();
    stubFetch(async (url) => {
      if (url.startsWith('/api/themes')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/fonts')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/colours')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/session-settings')) return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/drops')) return { ok: true, json: async () => ({ drops: [] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    });

    const t = await freshTopbarCtor();
    await t.init();
    ((globalThis.document as any).getElementById('tb-title') as any).dispatch('mousedown', {
      target: (globalThis.document as any).getElementById('tb-title'),
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {},
    });
    (globalThis.document as any).dispatch('mousemove', {
      button: 0,
      clientX: 12,
      clientY: 13,
      preventDefault() {},
      stopPropagation() {},
    });

    expect(hostMessages).toEqual([]);
  });

  it('dragging the title past the threshold asks Electrobun to restore once', async () => {
    const hostMessages: unknown[] = [];
    installGlobals();
    (globalThis.window as any).__electrobunSendToHost = (message: unknown) => {
      hostMessages.push(message);
    };
    makeDoc();
    stubFetch(async (url) => {
      if (url.startsWith('/api/themes')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/fonts')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/colours')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/session-settings')) return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
      if (url.startsWith('/api/drops')) return { ok: true, json: async () => ({ drops: [] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    });

    const t = await freshTopbarCtor();
    await t.init();
    ((globalThis.document as any).getElementById('tb-title') as any).dispatch('mousedown', {
      target: (globalThis.document as any).getElementById('tb-title'),
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {},
    });
    (globalThis.document as any).dispatch('mousemove', {
      button: 0,
      clientX: 16,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {},
    });
    (globalThis.document as any).dispatch('mousemove', {
      button: 0,
      clientX: 30,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {},
    });

    expect(hostMessages).toEqual([{ type: 'tmux-term:titlebar-drag' }]);
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

  it('loads each target session stored theme when switching among three sessions', async () => {
    const settingsSet: SessionSettings[] = [];
    const t = await mountTopbarWithSettings({
      sessions: {
        main: { ...DEFAULT_SESSION_SETTINGS, theme: 'Default' },
        amiga: { ...DEFAULT_SESSION_SETTINGS, theme: 'AmigaOS 3.1', colours: 'Nord' },
        scene: { ...DEFAULT_SESSION_SETTINGS, theme: 'Amiga Scene 2000', colours: 'Gruvbox Dark' },
      },
      onSettingsChange: (s) => { settingsSet.push(s); },
    });

    t.updateSession('amiga');
    await new Promise((r) => setImmediate(r as any));
    expect(settingsSet.at(-1)?.theme).toBe('AmigaOS 3.1');
    expect(settingsSet.at(-1)?.colours).toBe('Nord');
    expect(((globalThis.document as any).getElementById('inp-theme') as any).value).toBe('AmigaOS 3.1');

    t.updateSession('scene');
    await new Promise((r) => setImmediate(r as any));
    expect(settingsSet.at(-1)?.theme).toBe('Amiga Scene 2000');
    expect(settingsSet.at(-1)?.colours).toBe('Gruvbox Dark');
    expect(((globalThis.document as any).getElementById('inp-theme') as any).value).toBe('Amiga Scene 2000');
  });

  it('syncs runtime autohide state from target session settings', async () => {
    const t = await mountTopbarWithSettings({
      sessions: {
        main: { ...DEFAULT_SESSION_SETTINGS, topbarAutohide: true },
        pinned: { ...DEFAULT_SESSION_SETTINGS, topbarAutohide: false },
      },
    });
    const chk = (globalThis.document as any).getElementById('chk-autohide');
    const tb = (globalThis.document as any).getElementById('topbar');
    tb.classList.add('hidden');

    expect((t as any).autohide).toBe(true);
    expect(chk.checked).toBe(true);
    expect((globalThis.document as any).body.classList.has('topbar-pinned')).toBe(false);

    t.updateSession('pinned');

    expect((t as any).autohide).toBe(false);
    expect(chk.checked).toBe(false);
    expect((globalThis.document as any).body.classList.has('topbar-pinned')).toBe(true);
    expect(tb.classList.has('hidden')).toBe(false);
  });

  it('schedules hide when target session enables autohide', async () => {
    const t = await mountTopbarWithSettings({
      sessions: {
        main: { ...DEFAULT_SESSION_SETTINGS, topbarAutohide: false },
        auto: { ...DEFAULT_SESSION_SETTINGS, topbarAutohide: true },
      },
    });
    const chk = (globalThis.document as any).getElementById('chk-autohide');
    const tb = (globalThis.document as any).getElementById('topbar');
    const menu = (globalThis.document as any).getElementById('menu-dropdown');
    menu.hidden = true;

    expect((t as any).autohide).toBe(false);
    expect(chk.checked).toBe(false);
    expect((globalThis.document as any).body.classList.has('topbar-pinned')).toBe(true);

    const timers: Array<() => void> = [];
    (globalThis as any).setTimeout = (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    };
    (globalThis as any).clearTimeout = () => {};

    t.updateSession('auto');

    expect((t as any).autohide).toBe(true);
    expect(chk.checked).toBe(true);
    expect((globalThis.document as any).body.classList.has('topbar-pinned')).toBe(false);
    expect(tb.classList.has('hidden')).toBe(false);

    timers.forEach(fn => fn());
    expect(tb.classList.has('hidden')).toBe(true);
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

  it('initializes autohide from live session settings', async () => {
    const live = { ...DEFAULT_SESSION_SETTINGS, topbarAutohide: true };
    const t = await mountTopbar({ getLiveSettings: () => live });
    await t.init();
    const chk = (globalThis.document as any).getElementById('chk-autohide');
    expect((t as any).autohide).toBe(true);
    expect(chk.checked).toBe(true);
    expect((globalThis.document as any).body.classList.has('topbar-pinned')).toBe(false);
  });

  it('commits autohide checkbox changes through session settings', async () => {
    const live = { ...DEFAULT_SESSION_SETTINGS, topbarAutohide: false };
    const captured: SessionSettings[] = [];
    const t = await mountTopbar({
      getLiveSettings: () => live,
      onSettingsChange: (s) => { captured.push(s); },
    });
    await t.init();
    const chk = (globalThis.document as any).getElementById('chk-autohide');

    chk.checked = true;
    chk.dispatch('change', { target: chk });

    expect(captured).toHaveLength(1);
    expect(captured[0].topbarAutohide).toBe(true);
    expect(captured[0].scrollbarAutohide).toBe(false);
    expect((globalThis.document as any).body.classList.has('topbar-pinned')).toBe(false);
  });

  it('syncs per-session toolbar and scrollbar autohide checkboxes', async () => {
    const live = { ...DEFAULT_SESSION_SETTINGS, topbarAutohide: true, scrollbarAutohide: true };
    const changes: SessionSettings[] = [];
    let autohideChanges = 0;
    const t = await mountTopbar({
      getLiveSettings: () => live,
      onSettingsChange: (s) => { changes.push(s); },
      onAutohideChange: () => { autohideChanges++; },
    });
    await t.init();
    const toolbarChk = (globalThis.document as any).getElementById('chk-autohide');
    const scrollbarChk = (globalThis.document as any).getElementById('chk-scrollbar-autohide');

    expect(toolbarChk.checked).toBe(true);
    expect(scrollbarChk.checked).toBe(true);

    scrollbarChk.checked = false;
    scrollbarChk.dispatch('change', { target: scrollbarChk });
    expect(changes.at(-1)?.scrollbarAutohide).toBe(false);
    expect(autohideChanges).toBe(1);

    scrollbarChk.checked = true;
    scrollbarChk.dispatch('change', { target: scrollbarChk });
    expect(changes.at(-1)?.scrollbarAutohide).toBe(true);
    expect(autohideChanges).toBe(2);
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

// ─── theming: dropdown population and reset ───────────────────────────────────

const FX_PRIMARY: ThemeInfo = { name: 'Default', pack: 'e2e', css: 'primary.css', source: 'bundled' };
const FX_ALT: ThemeInfo = {
  name: 'E2E Alt Theme', pack: 'e2e', css: 'alt.css', source: 'bundled',
  defaultFont: 'E2E Secondary Font',
  defaultColours: 'E2E Green',
  defaultTuiBgOpacity: 70,
  defaultTuiFgOpacity: 80,
  defaultOpacity: 50,
};
const FX_FONT_PRIMARY: FontInfo = { family: 'E2E Primary Font', file: 'PrimaryFont.woff2', pack: 'e2e' };

async function flushAsync(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('Theming: dropdown population and reset', () => {
  function input(id: string): any {
    return (globalThis.document as any).getElementById(id);
  }

  function storedMain(): SessionSettings {
    return loadSessionSettings('main', null, { defaults: DEFAULT_SESSION_SETTINGS });
  }

  it('Theme dropdown lists fixture themes after init', async () => {
    await mountTopbarWithSettings({ themes: [FX_PRIMARY, FX_ALT] });
    const themeEl = input('inp-theme');
    const names = (themeEl.children as any[]).map((c: any) => c.textContent);
    expect(names).toContain('Default');
    expect(names).toContain('E2E Alt Theme');
  });

  it('font picker is populated from the fixture after init', async () => {
    await mountTopbarWithSettings({ fonts: [FX_FONT_PRIMARY] });
    const fontEl = input('inp-font-bundled');
    const names = (fontEl.children as any[]).map((c: any) => c.textContent);
    expect(names).toContain('E2E Primary Font');
  });

  it('reset colours resets background hue and TUI opacity to alt-theme defaults', async () => {
    await mountTopbarWithSettings({
      themes: [FX_PRIMARY, FX_ALT],
      sessions: { main: { theme: 'E2E Alt Theme', backgroundHue: 240, tuiBgOpacity: 30 } },
    });
    input('inp-background-hue').value = '240';
    input('inp-tui-bg-opacity').value = '30';

    input('btn-reset-colours').click();

    expect(input('inp-tui-bg-opacity').value).toBe('70');
    expect(input('inp-background-hue').value).toBe(String(DEFAULT_BACKGROUND_HUE));
    expect(storedMain().tuiBgOpacity).toBe(70);
    expect(storedMain().backgroundHue).toBe(DEFAULT_BACKGROUND_HUE);
  });
});

describe('Session inheritance: theme switch updates session settings', () => {
  function input(id: string): any {
    return (globalThis.document as any).getElementById(id);
  }

  function storedMain(): SessionSettings {
    return loadSessionSettings('main', null, { defaults: DEFAULT_SESSION_SETTINGS });
  }

  it('theme switch overwrites colours and font in active session', async () => {
    await mountTopbarWithSettings({ themes: [FX_PRIMARY, FX_ALT] });

    const themeEl = input('inp-theme');
    themeEl.value = 'E2E Alt Theme';
    themeEl.dispatch('change', { target: themeEl });
    await flushAsync(10);

    const stored = storedMain();
    expect(stored.colours).toBe('E2E Green');
    expect(stored.fontFamily).toBe('E2E Secondary Font');
  });
});
