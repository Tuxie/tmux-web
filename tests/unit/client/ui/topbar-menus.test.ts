import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { setupDocument, stubFetch, type StubDoc, type StubElement } from '../_dom.js';
import { _resetSessionStore } from '../../../../src/client/session-settings.ts';

/**
 * Focused tests for the three UI surfaces that show current tmux state:
 *   1. Window tabs strip (#win-tabs)
 *   2. Windows dropdown menu (renderWindowsMenu)
 *   3. Sessions dropdown menu (renderSessionsMenu)
 *
 * Verifies item visibility, correct names, active/current marking, and
 * running vs stopped session state.
 */

const origSetTimeout = globalThis.setTimeout;
const origClearTimeout = globalThis.clearTimeout;
const origLocation = (globalThis as any).location;
const origHistory = (globalThis as any).history;
const origFetch = (globalThis as any).fetch;
const origEvent = (globalThis as any).Event;
const origWindow = (globalThis as any).window;
const origMO = (globalThis as any).MutationObserver;
const origLS = (globalThis as any).localStorage;

afterAll(() => {
  (globalThis as any).setTimeout = origSetTimeout;
  (globalThis as any).clearTimeout = origClearTimeout;
  (globalThis as any).location = origLocation;
  (globalThis as any).history = origHistory;
  (globalThis as any).fetch = origFetch;
  (globalThis as any).Event = origEvent;
  (globalThis as any).window = origWindow;
  (globalThis as any).MutationObserver = origMO;
  (globalThis as any).localStorage = origLS;
  _resetSessionStore();
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
  any.appendChild = (child: StubElement) => { ext(child); return origAppend.call(any, child); };
  any.insertBefore = (child: StubElement, ref: StubElement | null) => {
    ext(child);
    const idx = ref ? any.children.indexOf(ref) : any.children.length;
    any.children.splice(idx < 0 ? any.children.length : idx, 0, child);
    (child as any).parentNode = any;
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

function installGlobals(session = 'main') {
  // Fresh localStorage per test so prefs (showWindowTabs etc.) don't leak.
  const lsStore: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => lsStore[k] ?? null,
    setItem: (k: string, v: string) => { lsStore[k] = v; },
    removeItem: (k: string) => { delete lsStore[k]; },
  };
  (globalThis as any).setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;
  (globalThis as any).clearTimeout = () => {};
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  (globalThis as any).location = { protocol: 'http:', host: 'localhost', pathname: `/${session}` };
  (globalThis as any).history = {
    replaceState: (_: any, __: string, path: string) => { (globalThis as any).location.pathname = path; },
  };
  (globalThis as any).Event = class { type: string; constructor(t: string) { this.type = t; } };
  (globalThis as any).window = { innerWidth: 1024, innerHeight: 800 };
  (globalThis as any).MutationObserver = class {
    observe() {} disconnect() {} takeRecords() { return []; }
  };
}

async function mountTopbar(opts: { session?: string; send?: (s: string) => void } = {}) {
  installGlobals(opts.session ?? 'main');
  makeDoc();
  stubFetch(async (url: string) => {
    if (url.startsWith('/api/themes'))           return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/fonts'))            return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/colours'))          return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/session-settings')) return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
    if (url.startsWith('/api/sessions'))         return { ok: true, json: async () => [] } as any;
    if (url.startsWith('/api/drops'))            return { ok: true, json: async () => ({ drops: [] }) } as any;
    return { ok: true, json: async () => ({}) } as any;
  });
  const { Topbar } = await import('../../../../src/client/ui/topbar.ts');
  const t = new Topbar({
    send: opts.send ?? (() => {}),
    focus: () => {},
    getLiveSettings: () => null,
  });
  await t.init();
  return t;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function winTabsEl() {
  return (globalThis.document as any).getElementById('win-tabs') as any;
}

/** All .tw-win-tab elements in the strip (excludes the compact button). */
function tabs(container: any): any[] {
  return container.children.filter((c: any) => typeof c.className === 'string' && c.className.includes('tw-win-tab'));
}

/** All .tw-dd-session-item rows inside a rendered dropdown menu. */
function sessionRows(menu: any): any[] {
  return menu.children.filter((c: any) => typeof c.className === 'string' && c.className.includes('tw-dd-session-item'));
}

/** Status-dot child of a session/window row. */
function statusDot(row: any): any {
  return row.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tw-dd-session-status')) ?? null;
}

/** Delete button child of a session row (stopped sessions only). */
function deleteBtn(row: any): any {
  return row.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tw-dd-session-delete')) ?? null;
}

/** Find the row in a rendered menu whose session-name span equals `name`. */
function rowByName(rows: any[], name: string): any {
  return rows.find((r: any) => r.children.some((c: any) => typeof c.className === 'string' && c.className.includes('tw-dd-session-name') && c.textContent === name)) ?? null;
}

// ─── window tabs strip ───────────────────────────────────────────────────────

describe('window tabs: visibility and active state', () => {
  beforeEach(() => { _resetSessionStore(); });

  it('renders one tab per window with the correct name text', async () => {
    const t = await mountTopbar();
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    (t as any).lastWinTabsKey = '';
    t.updateWindows([
      { index: '1', name: 'editor', active: true },
      { index: '2', name: 'shell', active: false },
      { index: '3', name: 'logs', active: false },
    ]);
    const ts = tabs(winTabsEl());
    expect(ts.length).toBe(3);
    expect(ts[0].textContent).toBe('1:editor');
    expect(ts[1].textContent).toBe('2:shell');
    expect(ts[2].textContent).toBe('3:logs');
  });

  it('only the active window tab has the .active class', async () => {
    const t = await mountTopbar();
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    (t as any).lastWinTabsKey = '';
    t.updateWindows([
      { index: '1', name: 'editor', active: false },
      { index: '2', name: 'shell', active: true },
      { index: '3', name: 'logs', active: false },
    ]);
    const ts = tabs(winTabsEl());
    // className is set as a plain string; check the string directly.
    expect(ts[0].className).not.toContain('active');
    expect(ts[1].className).toContain('active');
    expect(ts[2].className).not.toContain('active');
  });

  it('compact button label shows "index: name" for the active window', async () => {
    const t = await mountTopbar();
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    (t as any).lastWinTabsKey = '';
    t.updateWindows([
      { index: '1', name: 'editor', active: false },
      { index: '2', name: 'shell', active: true },
    ]);
    const wt = winTabsEl();
    const compact = wt.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tb-btn-window-compact'));
    const labelSpan = compact.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tb-window-compact-label'));
    expect(labelSpan.textContent).toBe('2: shell');
  });

  it('compact button label shows ellipsis when there are no windows', async () => {
    const t = await mountTopbar();
    (t as any).lastWinTabsKey = '';
    t.updateWindows([]);
    const wt = winTabsEl();
    const compact = wt.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tb-btn-window-compact'));
    const labelSpan = compact.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tb-window-compact-label'));
    expect(labelSpan.textContent).toBe('…');
  });

  it('in compact mode (tabs hidden) no .tw-win-tab elements are rendered', async () => {
    const t = await mountTopbar();
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(false);
    (t as any).lastWinTabsKey = '';
    t.updateWindows([
      { index: '1', name: 'editor', active: true },
      { index: '2', name: 'shell', active: false },
    ]);
    expect(tabs(winTabsEl()).length).toBe(0);
  });
});

// ─── windows dropdown menu ───────────────────────────────────────────────────

describe('windows menu: content and current/active marker', () => {
  beforeEach(() => { _resetSessionStore(); });

  it('lists all windows with correct "index: name" text', async () => {
    const t = await mountTopbar();
    t.updateWindows([
      { index: '1', name: 'editor', active: true },
      { index: '2', name: 'shell', active: false },
      { index: '3', name: 'logs', active: false },
    ]);
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderWindowsMenu(menu, () => {});
    const rows = sessionRows(menu);
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toBe('1: editor');
    expect(rows[1].textContent).toBe('2: shell');
    expect(rows[2].textContent).toBe('3: logs');
  });

  it('active window row has .current class and aria-selected=true; others do not', async () => {
    const t = await mountTopbar();
    t.updateWindows([
      { index: '1', name: 'editor', active: false },
      { index: '2', name: 'shell', active: true },
      { index: '3', name: 'logs', active: false },
    ]);
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderWindowsMenu(menu, () => {});
    const rows = sessionRows(menu);
    // className is set as a string ('tw-dropdown-item tw-dd-session-item current').
    expect(rows[0].className).not.toContain('current');
    expect(rows[0].attrs['aria-selected']).toBe('false');
    expect(rows[1].className).toContain('current');
    expect(rows[1].attrs['aria-selected']).toBe('true');
    expect(rows[2].className).not.toContain('current');
    expect(rows[2].attrs['aria-selected']).toBe('false');
  });

  it('clicking an inactive window row sends a window select message', async () => {
    const sent: string[] = [];
    const t = await mountTopbar({ send: (s) => sent.push(s) });
    t.updateWindows([
      { index: '1', name: 'editor', active: true },
      { index: '2', name: 'shell', active: false },
    ]);
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderWindowsMenu(menu, () => {});
    sessionRows(menu)[1].click();
    expect(sent).toContain(JSON.stringify({ type: 'window', action: 'select', index: '2' }));
  });

  it('clicking the already-active window row sends no message', async () => {
    const sent: string[] = [];
    const t = await mountTopbar({ send: (s) => sent.push(s) });
    t.updateWindows([{ index: '1', name: 'editor', active: true }]);
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderWindowsMenu(menu, () => {});
    sessionRows(menu)[0].click();
    expect(sent.filter(s => s.includes('"select"'))).toHaveLength(0);
  });
});

// ─── sessions dropdown menu ──────────────────────────────────────────────────

describe('sessions menu: running/stopped states and current marker', () => {
  beforeEach(() => { _resetSessionStore(); });

  it('running sessions have a status dot with class .running and aria-label "Running"', async () => {
    const t = await mountTopbar({ session: 'main' });
    (t as any).cachedSessions = [
      { id: '1', name: 'main' },
      { id: '2', name: 'dev' },
    ];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const dot = statusDot(row);
      expect(dot).not.toBeNull();
      // dot.className is a plain string: 'tw-dd-session-status running'.
      expect(dot.className).toContain('running');
      expect(dot.className).not.toContain('stopped');
      expect(dot.attrs['aria-label']).toBe('Running');
    }
  });

  it('stopped (stored-only) sessions have a status dot with class .stopped and aria-label "Not running"', async () => {
    const t = await mountTopbar({ session: 'main' });
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    _resetSessionStore({ sessions: { archived: {} as any } });
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    const archivedRow = rowByName(rows, 'archived');
    expect(archivedRow).not.toBeNull();
    const dot = statusDot(archivedRow);
    expect(dot).not.toBeNull();
    expect(dot.className).toContain('stopped');
    expect(dot.className).not.toContain('running');
    expect(dot.attrs['aria-label']).toBe('Not running');
  });

  it('stopped sessions have a delete button; running sessions do not', async () => {
    const t = await mountTopbar({ session: 'main' });
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    _resetSessionStore({ sessions: { archived: {} as any } });
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    const mainRow = rowByName(rows, 'main');
    const archivedRow = rowByName(rows, 'archived');
    expect(deleteBtn(mainRow)).toBeNull();
    expect(deleteBtn(archivedRow)).not.toBeNull();
    expect(deleteBtn(archivedRow).className).toContain('tw-dd-session-delete');
  });

  it('current session row has .current class and aria-selected=true; others do not', async () => {
    const t = await mountTopbar({ session: 'dev' });
    (t as any).cachedSessions = [
      { id: '1', name: 'main' },
      { id: '2', name: 'dev' },
      { id: '3', name: 'work' },
    ];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    const devRow  = rowByName(rows, 'dev');
    const mainRow = rowByName(rows, 'main');
    const workRow = rowByName(rows, 'work');
    // className is a plain string — check it directly.
    expect(devRow.className).toContain('current');
    expect(devRow.attrs['aria-selected']).toBe('true');
    expect(mainRow.className).not.toContain('current');
    expect(mainRow.attrs['aria-selected']).toBe('false');
    expect(workRow.className).not.toContain('current');
    expect(workRow.attrs['aria-selected']).toBe('false');
  });

  it('sessions are sorted case-insensitively regardless of API return order', async () => {
    const t = await mountTopbar({ session: 'main' });
    (t as any).cachedSessions = [
      { id: '3', name: 'Zebra' },
      { id: '1', name: 'main' },
      { id: '2', name: 'Alpha' },
    ];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    const names = rows.map((r: any) => {
      const nameSpan = r.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tw-dd-session-name'));
      return nameSpan?.textContent;
    });
    expect(names).toEqual(['Alpha', 'main', 'Zebra']);
  });

  it('shows both running and stored-only sessions together, deduplicating by name', async () => {
    const t = await mountTopbar({ session: 'main' });
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    _resetSessionStore({ sessions: { old: {} as any, backup: {} as any } });
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    const names = rows.map((r: any) => {
      const nameSpan = r.children.find((c: any) => typeof c.className === 'string' && c.className.includes('tw-dd-session-name'));
      return nameSpan?.textContent;
    });
    // 'main' (running) + 'backup' + 'old' (stored-only), sorted.
    expect(names).toContain('main');
    expect(names).toContain('old');
    expect(names).toContain('backup');
    expect(rows.length).toBe(3);
  });
});

// ─── shared interaction helpers ──────────────────────────────────────────────

/** Yield to the microtask queue N times (lets async fetch chains settle). */
async function flushAsync(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/** Recursively find first child with className containing `cls`. */
function deepFind(root: any, cls: string): any {
  for (const child of root.children ?? []) {
    if (typeof child.className === 'string' && child.className.includes(cls)) return child;
    const found = deepFind(child, cls);
    if (found) return found;
  }
  return null;
}

/** Collect all descendants whose className contains `cls`. */
function deepFindAll(root: any, cls: string, acc: any[] = []): any[] {
  for (const child of root.children ?? []) {
    if (typeof child.className === 'string' && child.className.includes(cls)) acc.push(child);
    deepFindAll(child, cls, acc);
  }
  return acc;
}

// ─── windows compact button and tab context-menu interactions ─────────────────

describe('windows: compact button and context-menu wiring', () => {
  beforeEach(() => { _resetSessionStore(); });

  const WINDOWS = [
    { index: '0', name: 'zsh', active: true },
    { index: '1', name: 'vim', active: false },
  ];

  async function setup(send?: (s: string) => void) {
    const t = await mountTopbar({ send });
    const { setShowWindowTabs } = await import('../../../../src/client/prefs.ts');
    setShowWindowTabs(true);
    (t as any).lastWinTabsKey = '';
    t.updateWindows(WINDOWS);
    return t;
  }

  function compact() {
    const wt = winTabsEl();
    return wt.children[wt.children.length - 1] as any;
  }

  function bodyMenu(cls: string) {
    return (globalThis.document as any).body.children.find(
      (c: any) => typeof c.className === 'string' && c.className.includes(cls),
    );
  }

  it('right-click on compact button sends new-window message', async () => {
    const sent: string[] = [];
    await setup(s => sent.push(s));
    compact().dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    expect(sent).toContain(JSON.stringify({ type: 'window', action: 'new' }));
  });

  it('left-click on compact button opens the rich windows menu with window rows', async () => {
    await setup();
    compact().click();
    const menu = bodyMenu('tw-dd-windows-menu');
    expect(menu).toBeDefined();
    const rows = sessionRows(menu);
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe('0: zsh');
    expect(rows[1].textContent).toBe('1: vim');
  });

  it('New window input in the menu sends a new-window-with-name message', async () => {
    const sent: string[] = [];
    await setup(s => sent.push(s));
    compact().click();
    const menu = bodyMenu('tw-dd-windows-menu');
    // Two tw-dd-input elements: [0]=Name, [1]=New window
    const inputs = deepFindAll(menu, 'tw-dd-input');
    inputs[1].value = 'logs';
    inputs[1].dispatch('keydown', { key: 'Enter', preventDefault() {} });
    expect(sent).toContain(JSON.stringify({ type: 'window', action: 'new', name: 'logs' }));
  });

  it('Name input in the menu renames the current window', async () => {
    const sent: string[] = [];
    await setup(s => sent.push(s));
    compact().click();
    const menu = bodyMenu('tw-dd-windows-menu');
    const inputs = deepFindAll(menu, 'tw-dd-input');
    inputs[0].value = 'shell';
    inputs[0].dispatch('keydown', { key: 'Enter', preventDefault() {} });
    expect(sent).toContain(JSON.stringify({ type: 'window', action: 'rename', index: '0', name: 'shell' }));
  });

  it('unchecking Show windows as tabs hides tab buttons', async () => {
    await setup();
    expect(tabs(winTabsEl()).length).toBe(2);
    compact().click();
    const menu = bodyMenu('tw-dd-windows-menu');
    // Find the checkbox (type=checkbox input inside the menu)
    let chk: any;
    function findChk(el: any) {
      for (const c of el.children ?? []) {
        if ((c as any).type === 'checkbox') { chk = c; return; }
        findChk(c);
      }
    }
    findChk(menu);
    expect(chk.checked).toBe(true);
    chk.checked = false;
    chk.dispatch('change', { target: chk });
    expect(tabs(winTabsEl()).length).toBe(0);
  });

  it('right-click on a tab opens context menu with Name input pre-filled and Close item', async () => {
    await setup();
    tabs(winTabsEl())[1].dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    const ctx = bodyMenu('tw-dd-context-win-menu');
    expect(ctx).toBeDefined();
    const labelEl = deepFind(ctx, 'tw-menu-label');
    expect(labelEl?.textContent).toBe('Name:');
    const inputEl = deepFind(ctx, 'tw-dd-input');
    expect(inputEl?.value).toBe('vim');
    const items = deepFindAll(ctx, 'tw-dropdown-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('Close window 1: vim');
  });

  it('editing Name in tab context menu sends rename-window', async () => {
    const sent: string[] = [];
    await setup(s => sent.push(s));
    tabs(winTabsEl())[1].dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    const ctx = bodyMenu('tw-dd-context-win-menu');
    const inputEl = deepFind(ctx, 'tw-dd-input');
    inputEl.value = 'editor';
    inputEl.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    expect(sent).toContain(JSON.stringify({ type: 'window', action: 'rename', index: '1', name: 'editor' }));
  });

  it('pressing Enter with unchanged name in tab context menu does not send rename', async () => {
    const sent: string[] = [];
    await setup(s => sent.push(s));
    tabs(winTabsEl())[1].dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    const ctx = bodyMenu('tw-dd-context-win-menu');
    const inputEl = deepFind(ctx, 'tw-dd-input');
    // value is already 'vim' — don't change it
    inputEl.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    expect(sent.some(s => s.includes('"rename"'))).toBe(false);
  });

  it('clicking Close window item in tab context menu sends close-window message', async () => {
    const sent: string[] = [];
    await setup(s => sent.push(s));
    tabs(winTabsEl())[1].dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    const ctx = bodyMenu('tw-dd-context-win-menu');
    deepFind(ctx, 'tw-dropdown-item').click();
    expect(sent).toContain(JSON.stringify({ type: 'window', action: 'close', index: '1' }));
  });

  it('context menu closes on Escape', async () => {
    await setup();
    tabs(winTabsEl())[0].dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    expect(bodyMenu('tw-dd-context')).toBeDefined();
    (globalThis.document as any).dispatch('keydown', { key: 'Escape' });
    expect(bodyMenu('tw-dd-context')).toBeUndefined();
  });
});

// ─── session button interactions ─────────────────────────────────────────────

describe('session button: click and menu interactions', () => {
  beforeEach(() => { _resetSessionStore(); });

  function sessionBtn() {
    return (globalThis.document as any).getElementById('btn-session-menu') as any;
  }

  function sessMenu() {
    return (globalThis.document as any).body.children.find(
      (c: any) => typeof c.className === 'string' && c.className.includes('tw-dd-sessions-menu'),
    ) as any;
  }

  it('updateSession writes the session name to #tb-session-name', async () => {
    const t = await mountTopbar({ session: 'work' });
    const el = (globalThis.document as any).getElementById('tb-session-name');
    expect(el.textContent).toBe('work');
    t.updateSession('myproject');
    expect(el.textContent).toBe('myproject');
  });

  it('session menu has Kill row plus Name and New session inputs', async () => {
    const t = await mountTopbar({ session: 'main' });
    (t as any).cachedSessions = [{ id: '1', name: 'main' }, { id: '2', name: 'dev' }];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    expect(rows.length).toBe(2);
    // Kill row
    const killItem = menu.children.find(
      (c: any) => typeof c.className === 'string' && c.className.includes('tw-dropdown-item')
        && !c.className.includes('tw-dd-session-item'),
    );
    expect(killItem?.textContent).toContain('Kill session main');
    // Name and New session labels
    const labels = deepFindAll(menu, 'tw-menu-label').map((l: any) => l.textContent);
    expect(labels).toContain('Name:');
    expect(labels).toContain('New session:');
  });

  it('clicking a session row calls onSwitchSession with that name', async () => {
    const switched: string[] = [];
    const t = await mountTopbar({ session: 'main' });
    (t as any).opts.onSwitchSession = (name: string) => switched.push(name);
    (t as any).cachedSessions = [{ id: '1', name: 'main' }, { id: '2', name: 'dev' }];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    rowByName(sessionRows(menu), 'dev').click();
    expect(switched).toContain('dev');
  });

  it('Name input in session menu renames the current session on Enter', async () => {
    const sent: string[] = [];
    const t = await mountTopbar({ session: 'main', send: s => sent.push(s) });
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const inputs = deepFindAll(menu, 'tw-dd-input');
    inputs[0].value = 'project'; // Name input (first)
    inputs[0].dispatch('keydown', { key: 'Enter', preventDefault() {} });
    expect(sent).toContain(JSON.stringify({ type: 'session', action: 'rename', name: 'project' }));
  });

  it('New session input calls onSwitchSession with cleaned name', async () => {
    const switched: string[] = [];
    const t = await mountTopbar({ session: 'main' });
    (t as any).opts.onSwitchSession = (name: string) => switched.push(name);
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const inputs = deepFindAll(menu, 'tw-dd-input');
    inputs[1].value = 'scratch'; // New session input (second)
    inputs[1].dispatch('keydown', { key: 'Enter', preventDefault() {} });
    expect(switched).toContain('scratch');
  });

  it('Kill session row sends kill message after confirm', async () => {
    const sent: string[] = [];
    const t = await mountTopbar({ session: 'main', send: s => sent.push(s) });
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    (globalThis as any).confirm = () => true;
    const killItem = menu.children.find(
      (c: any) => typeof c.className === 'string' && c.className.includes('tw-dropdown-item')
        && !c.className.includes('tw-dd-session-item'),
    );
    killItem.click();
    expect(sent).toContain(JSON.stringify({ type: 'session', action: 'kill' }));
  });

  it('left-click on session button opens the sessions dropdown menu', async () => {
    await mountTopbar({ session: 'main' });
    stubFetch(async (url: string) => {
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [{ id: '1', name: 'main' }] } as any;
      return { ok: true, json: async () => ({}) } as any;
    });
    const menu = sessMenu();
    expect(menu.hidden).toBe(true);
    sessionBtn().click();
    await flushAsync();
    expect(menu.hidden).toBe(false);
  });

  it('session button gets .open class while menu is showing', async () => {
    await mountTopbar({ session: 'main' });
    stubFetch(async (url: string) => {
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [] } as any;
      return { ok: true, json: async () => ({}) } as any;
    });
    const btn = sessionBtn();
    expect(btn.classList.has('open')).toBe(false);
    btn.click();
    await flushAsync();
    expect(btn.classList.has('open')).toBe(true);
  });

  it('right-click on session button opens the same sessions menu', async () => {
    await mountTopbar({ session: 'main' });
    stubFetch(async (url: string) => {
      if (url.startsWith('/api/sessions')) return { ok: true, json: async () => [{ id: '1', name: 'main' }] } as any;
      return { ok: true, json: async () => ({}) } as any;
    });
    const menu = sessMenu();
    expect(menu.hidden).toBe(true);
    sessionBtn().dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    await flushAsync();
    expect(menu.hidden).toBe(false);
    // Second right-click closes
    sessionBtn().dispatch('contextmenu', { preventDefault() {}, stopPropagation() {} });
    expect(menu.hidden).toBe(true);
  });

  it('clicking delete button removes the session via DELETE fetch', async () => {
    const deletedUrls: string[] = [];
    const t = await mountTopbar({ session: 'main' });
    stubFetch(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') deletedUrls.push(url);
      return { ok: true, json: async () => ({}) } as any;
    });
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    _resetSessionStore({ sessions: { archived: {} as any } });
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const rows = sessionRows(menu);
    const archivedRow = rowByName(rows, 'archived');
    expect(archivedRow).not.toBeNull();
    const delBtn = deleteBtn(archivedRow);
    delBtn.click();
    await flushAsync();
    expect(deletedUrls.some(u => u.includes('archived'))).toBe(true);
    // Row removed from menu
    expect(rowByName(sessionRows(menu), 'archived')).toBeNull();
  });

  it('delete button click does not switch to the deleted session', async () => {
    const switched: string[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({}) } as any));
    const t = await mountTopbar({ session: 'main' });
    (t as any).opts.onSwitchSession = (name: string) => switched.push(name);
    (t as any).cachedSessions = [{ id: '1', name: 'main' }];
    _resetSessionStore({ sessions: { archived: {} as any } });
    const menu = (globalThis.document as any).createElement('div');
    (t as any).renderSessionsMenu(menu, () => {});
    const archivedRow = rowByName(sessionRows(menu), 'archived');
    deleteBtn(archivedRow).click();
    await flushAsync();
    expect(switched).not.toContain('archived');
  });
});
