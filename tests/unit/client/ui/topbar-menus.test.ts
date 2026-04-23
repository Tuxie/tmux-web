import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { setupDocument, el as stubEl, stubFetch, type StubDoc, type StubElement } from '../_dom.js';
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
