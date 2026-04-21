import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { setupDocument, el, stubFetch, type StubDoc, type StubElement } from '../_dom.js';

// Save globals we mutate so other test files' tests see the real APIs.
const origSetTimeout = globalThis.setTimeout;
const origClearTimeout = globalThis.clearTimeout;
const origRAF = (globalThis as any).requestAnimationFrame;
const origMO = (globalThis as any).MutationObserver;
const origFetch = (globalThis as any).fetch;
afterAll(() => {
  (globalThis as any).setTimeout = origSetTimeout;
  (globalThis as any).clearTimeout = origClearTimeout;
  (globalThis as any).requestAnimationFrame = origRAF;
  (globalThis as any).MutationObserver = origMO;
  (globalThis as any).fetch = origFetch;
});

type FetchImpl = (url: string, init?: RequestInit) => Promise<any>;

function okJson(body: any) {
  return { ok: true, status: 200, json: async () => body } as any;
}
function notOk(status: number) {
  return { ok: false, status, json: async () => ({}) } as any;
}

interface MoObserveCall { target: StubElement; options: MutationObserverInit }
let moObserveCalls: MoObserveCall[];
let moDisconnectCount: number;
let moCallback: ((records: unknown[]) => void) | null;

function installMutationObserver() {
  moObserveCalls = [];
  moDisconnectCount = 0;
  moCallback = null;
  (globalThis as any).MutationObserver = class {
    constructor(cb: (records: unknown[]) => void) { moCallback = cb; }
    observe(target: StubElement, options: MutationObserverInit) {
      moObserveCalls.push({ target, options });
    }
    disconnect() { moDisconnectCount++; }
    takeRecords() { return []; }
  };
}

function setupPanelDom(doc: StubDoc): {
  list: StubElement;
  count: StubElement;
  refreshBtn: StubElement;
  purgeBtn: StubElement;
  menu: StubElement;
} {
  const list = el('div');
  const count = el('span');
  const refreshBtn = el('button');
  const purgeBtn = el('button');
  const menu = el('div');
  (menu as any).hidden = true;
  doc.__byId['drops-list'] = list;
  doc.__byId['drops-count'] = count;
  doc.__byId['btn-drops-refresh'] = refreshBtn;
  doc.__byId['btn-drops-purge'] = purgeBtn;
  doc.__byId['menu-dropdown'] = menu;
  // Give the `list` container an innerHTML setter the real module writes to
  // by assigning an empty-string on each render. The stub doesn't support
  // innerHTML natively; model it by clearing children on write.
  Object.defineProperty(list, 'innerHTML', {
    set(v: string) {
      if (v === '') list.children.length = 0;
    },
    get() { return ''; },
    configurable: true,
  });
  return { list, count, refreshBtn, purgeBtn, menu };
}

async function freshModule() {
  // Module exports a single factory; no module-level state to reset.
  // Plain import keeps Bun's coverage instrumentation unified with the
  // canonical path.
  return await import('../../../../src/client/ui/drops-panel.ts');
}

beforeEach(() => {
  // requestAnimationFrame / setTimeout may be hit by the transitively-
  // loaded toast module. Provide no-op stubs so tests don't hang.
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 0; };
  (globalThis as any).setTimeout = ((fn: () => void) => { void fn; return 0; }) as any;
  (globalThis as any).clearTimeout = () => {};
  installMutationObserver();
});

describe('installDropsPanel — missing DOM', () => {
  it('returns inert handles when required elements are absent', async () => {
    setupDocument();
    stubFetch(async () => okJson({ drops: [] }));
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    expect(typeof h.refresh).toBe('function');
    expect(typeof h.dispose).toBe('function');
    // Should complete cleanly without throwing.
    await h.refresh();
    h.dispose();
  });
});

describe('installDropsPanel — render', () => {
  it('renders empty-state row when server returns no drops', async () => {
    const doc = setupDocument();
    const { list, count } = setupPanelDom(doc);
    stubFetch(async () => okJson({ drops: [] }));
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    expect(count.textContent).toBe('0');
    expect(list.children).toHaveLength(1);
    expect((list.children[0] as any).className).toBe('tw-drops-empty');
    expect(list.children[0]!.textContent).toContain('No files');
  });

  it('renders one row per drop, with label / meta / revoke children', async () => {
    const doc = setupDocument();
    const { list, count } = setupPanelDom(doc);
    const drops = [
      { dropId: 'a', filename: 'foo.txt', absolutePath: '/tmp/foo.txt', size: 42, mtime: '2026-04-21T10:00:00Z' },
      { dropId: 'b', filename: 'bar.log', absolutePath: '/tmp/bar.log', size: 2048, mtime: '2026-04-21T10:01:00Z' },
    ];
    stubFetch(async () => okJson({ drops }));
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    expect(count.textContent).toBe('2');
    expect(list.children).toHaveLength(2);
    const firstRow = list.children[0] as any;
    expect(firstRow.className).toBe('tw-drops-row');
    // Three children: label, meta, revoke.
    expect(firstRow.children).toHaveLength(3);
    expect((firstRow.children[0] as any).className).toBe('tw-drops-row-label');
    expect(firstRow.children[0]!.textContent).toBe('foo.txt');
    expect((firstRow.children[1] as any).className).toBe('tw-drops-row-meta');
    expect(firstRow.children[1]!.textContent).toBe('42 B');
    expect((firstRow.children[2] as any).className).toContain('tw-drops-revoke');
  });
});

describe('installDropsPanel — refresh / error paths', () => {
  it('swallows non-ok refresh without clearing existing render', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    stubFetch(async () => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'a', filename: 'foo', absolutePath: '/tmp/foo', size: 10, mtime: 't1' },
      ] });
      return notOk(500);
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh(); // call 1: populates
    expect(list.children).toHaveLength(1);
    await h.refresh(); // call 2: 500 — previous render retained
    expect(list.children).toHaveLength(1);
  });

  it('swallows thrown fetch error without clearing render', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    stubFetch(async () => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'a', filename: 'foo', absolutePath: '/tmp/foo', size: 10, mtime: 't' },
      ] });
      throw new Error('network');
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    expect(list.children).toHaveLength(1);
    await h.refresh();
    expect(list.children).toHaveLength(1);
  });
});

describe('installDropsPanel — refresh button', () => {
  it('clicking the refresh button triggers a fetch to /api/drops', async () => {
    const doc = setupDocument();
    const { refreshBtn } = setupPanelDom(doc);
    const { calls } = stubFetch(async () => okJson({ drops: [] }));
    const { installDropsPanel } = await freshModule();
    installDropsPanel({ getSession: () => 'main' });
    const beforeCount = calls.length;
    refreshBtn.click();
    // Allow the async fetch to run.
    await new Promise((r) => Promise.resolve().then(r as any));
    expect(calls.length).toBeGreaterThan(beforeCount);
    expect(calls[calls.length - 1]!.url).toBe('/api/drops');
  });
});

describe('installDropsPanel — purge', () => {
  it('sends DELETE /api/drops and refreshes on ok', async () => {
    const doc = setupDocument();
    const { purgeBtn } = setupPanelDom(doc);
    let onChangeCount = 0;
    const { calls } = stubFetch(async (url, init) => {
      if (init?.method === 'DELETE' && url === '/api/drops') {
        return okJson({ purged: 3 });
      }
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    installDropsPanel({ getSession: () => 'main', onChange: () => onChangeCount++ });
    purgeBtn.click();
    // Give both awaited fetches a chance to resolve.
    await new Promise((r) => setImmediate(r as any));
    await new Promise((r) => setImmediate(r as any));
    const deleteCalls = calls.filter(c => c.init?.method === 'DELETE' && c.url === '/api/drops');
    expect(deleteCalls).toHaveLength(1);
    expect(onChangeCount).toBe(1);
  });
});

describe('installDropsPanel — error paths', () => {
  it('revoke server error leaves button enabled', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    stubFetch(async (_url, init) => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'a', filename: 'f', absolutePath: '/t/f', size: 1, mtime: 't' },
      ] });
      if (init?.method === 'DELETE') return notOk(500);
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    const revokeBtn = list.children[0]!.children[2]! as any;
    revokeBtn.click();
    await new Promise((r) => setImmediate(r as any));
    await new Promise((r) => setImmediate(r as any));
    expect(revokeBtn.disabled).toBe(false);
  });

  it('revoke network error leaves button enabled', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    stubFetch(async (_url, init) => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'a', filename: 'f', absolutePath: '/t/f', size: 1, mtime: 't' },
      ] });
      if (init?.method === 'DELETE') throw new Error('no network');
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    const revokeBtn = list.children[0]!.children[2]! as any;
    revokeBtn.click();
    await new Promise((r) => setImmediate(r as any));
    await new Promise((r) => setImmediate(r as any));
    expect(revokeBtn.disabled).toBe(false);
  });

  it('paste returning 5xx does not throw', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    stubFetch(async (url) => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'a', filename: 'f', absolutePath: '/t/f', size: 1, mtime: 't' },
      ] });
      if (url.startsWith('/api/drops/paste')) return notOk(500);
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    list.children[0]!.click();
    await new Promise((r) => setImmediate(r as any));
  });

  it('paste fetch rejection is swallowed', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    stubFetch(async (url) => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'a', filename: 'f', absolutePath: '/t/f', size: 1, mtime: 't' },
      ] });
      if (url.startsWith('/api/drops/paste')) throw new Error('net');
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    list.children[0]!.click();
    await new Promise((r) => setImmediate(r as any));
  });

  it('purge non-ok response still re-enables button', async () => {
    const doc = setupDocument();
    const { purgeBtn } = setupPanelDom(doc);
    stubFetch(async (url, init) => {
      if (init?.method === 'DELETE' && url === '/api/drops') return notOk(500);
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    installDropsPanel({ getSession: () => 'main' });
    const btn = purgeBtn as any;
    btn.click();
    await new Promise((r) => setImmediate(r as any));
    await new Promise((r) => setImmediate(r as any));
    expect(btn.disabled).toBe(false);
  });

  it('purge fetch rejection still re-enables button', async () => {
    const doc = setupDocument();
    const { purgeBtn } = setupPanelDom(doc);
    stubFetch(async (url, init) => {
      if (init?.method === 'DELETE' && url === '/api/drops') throw new Error('net');
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    installDropsPanel({ getSession: () => 'main' });
    const btn = purgeBtn as any;
    btn.click();
    await new Promise((r) => setImmediate(r as any));
    await new Promise((r) => setImmediate(r as any));
    expect(btn.disabled).toBe(false);
  });
});

describe('installDropsPanel — row revoke', () => {
  it('DELETE /api/drops?id=... on revoke click; onChange fires on ok', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let onChangeCount = 0;
    let call = 0;
    const { calls } = stubFetch(async () => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'abc', filename: 'foo', absolutePath: '/tmp/foo', size: 1, mtime: 't' },
      ] });
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main', onChange: () => onChangeCount++ });
    await h.refresh();
    const row = list.children[0]!;
    const revokeBtn = row.children[2]!;
    revokeBtn.click();
    await new Promise((r) => setImmediate(r as any));
    await new Promise((r) => setImmediate(r as any));
    const deleteCalls = calls.filter(c => c.init?.method === 'DELETE' && c.url.startsWith('/api/drops?id='));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.url).toBe('/api/drops?id=abc');
    expect(onChangeCount).toBe(1);
  });

  it('revoke click stops propagation so the row re-paste handler does not fire', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let pastes = 0;
    let call = 0;
    stubFetch(async (url, init) => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'abc', filename: 'foo', absolutePath: '/tmp/foo', size: 1, mtime: 't' },
      ] });
      if (url.startsWith('/api/drops/paste')) { pastes++; return okJson({}); }
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    const row = list.children[0]!;
    const revokeBtn = row.children[2]!;
    revokeBtn.click();
    await new Promise((r) => setImmediate(r as any));
    expect(pastes).toBe(0);
  });
});

describe('installDropsPanel — row re-paste', () => {
  it('POSTs /api/drops/paste with session + id on row click', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    const { calls } = stubFetch(async (url) => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'xyz', filename: 'foo', absolutePath: '/tmp/foo', size: 1, mtime: 't' },
      ] });
      return okJson({});
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'my session' });
    await h.refresh();
    const row = list.children[0]!;
    row.click();
    await new Promise((r) => setImmediate(r as any));
    const paste = calls.find(c => c.url.startsWith('/api/drops/paste'));
    expect(paste).toBeDefined();
    expect(paste!.url).toBe('/api/drops/paste?session=my%20session&id=xyz');
    expect(paste!.init?.method).toBe('POST');
  });

  it('refreshes when server returns 404 (drop gone)', async () => {
    const doc = setupDocument();
    const { list } = setupPanelDom(doc);
    let call = 0;
    const { calls } = stubFetch(async (url) => {
      call++;
      if (call === 1) return okJson({ drops: [
        { dropId: 'z', filename: 'f', absolutePath: '/t/f', size: 1, mtime: 't' },
      ] });
      if (url.startsWith('/api/drops/paste')) return notOk(404);
      return okJson({ drops: [] });
    });
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    await h.refresh();
    list.children[0]!.click();
    await new Promise((r) => setImmediate(r as any));
    await new Promise((r) => setImmediate(r as any));
    // Should have triggered an extra /api/drops refresh after the 404.
    const refreshes = calls.filter(c => c.url === '/api/drops' && !c.init?.method);
    expect(refreshes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('installDropsPanel — MutationObserver wiring', () => {
  it('observes #menu-dropdown for hidden-attribute changes', async () => {
    const doc = setupDocument();
    const { menu } = setupPanelDom(doc);
    stubFetch(async () => okJson({ drops: [] }));
    const { installDropsPanel } = await freshModule();
    installDropsPanel({ getSession: () => 'main' });
    expect(moObserveCalls).toHaveLength(1);
    expect(moObserveCalls[0]!.target).toBe(menu);
    expect(moObserveCalls[0]!.options.attributeFilter).toEqual(['hidden']);
  });

  it('firing the MutationObserver callback when menu is visible triggers a refresh', async () => {
    const doc = setupDocument();
    const { menu } = setupPanelDom(doc);
    const { calls } = stubFetch(async () => okJson({ drops: [] }));
    const { installDropsPanel } = await freshModule();
    installDropsPanel({ getSession: () => 'main' });
    const beforeCount = calls.length;
    (menu as any).hidden = false;
    moCallback?.([]);
    await new Promise((r) => setImmediate(r as any));
    expect(calls.length).toBeGreaterThan(beforeCount);
  });

  it('dispose() disconnects the observer', async () => {
    const doc = setupDocument();
    setupPanelDom(doc);
    stubFetch(async () => okJson({ drops: [] }));
    const { installDropsPanel } = await freshModule();
    const h = installDropsPanel({ getSession: () => 'main' });
    h.dispose();
    expect(moDisconnectCount).toBe(1);
  });
});
