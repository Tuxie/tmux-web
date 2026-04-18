import { beforeEach, describe, expect, test } from 'bun:test';
import {
  applyTheme,
  listThemes,
  listFonts,
  loadAllFonts,
  getActiveTheme,
  clearCaches,
} from '../../../src/client/theme.ts';

interface Link {
  tagName: string;
  id?: string;
  rel?: string;
  href?: string;
  __listeners: Record<string, (() => void)[]>;
  setAttribute(k: string, v: string): void;
  addEventListener(ev: string, fn: () => void, opts?: any): void;
  remove?: () => void;
}

function setupDom(opts: { autoLoad?: 'load' | 'error' | 'none' } = {}) {
  const appended: Link[] = [];
  const byId: Record<string, any> = {};
  (globalThis as any).__appended = appended;
  (globalThis as any).__byId = byId;
  (globalThis as any).document = {
    head: {
      appendChild(n: Link) {
        appended.push(n);
        const evt = opts.autoLoad ?? 'load';
        if (evt !== 'none') n.__listeners?.[evt]?.forEach(fn => fn());
      },
    },
    createElement: (tag: string) => ({
      tagName: tag.toUpperCase(),
      __listeners: {} as Record<string, (() => void)[]>,
      setAttribute(k: string, v: string) { (this as any)[k] = v; },
      addEventListener(ev: string, fn: () => void) {
        (this as any).__listeners[ev] ??= [];
        (this as any).__listeners[ev].push(fn);
      },
    }),
    getElementById: (id: string) => byId[id] ?? null,
    documentElement: { style: {} as Record<string, string> },
    fonts: {
      _added: [] as any[],
      add(ff: any) { this._added.push(ff); },
    },
  };
  return { appended, byId };
}

function stubFetch(handler: (url: string) => { ok: boolean; json: () => Promise<any> } | Promise<{ ok: boolean; json: () => Promise<any> }>) {
  (globalThis as any).fetch = async (u: string) => handler(u);
}

function defaultThemes() {
  return [
    { name: 'Default', pack: 'default', css: 'default.css', source: 'bundled' },
    { name: 'Amiga', pack: 'amiga', css: 'amiga.css', source: 'bundled' },
  ];
}

beforeEach(() => {
  clearCaches();
  setupDom();
  stubFetch((u) => ({
    ok: true,
    json: async () => u.endsWith('/api/themes') ? defaultThemes() : [],
  }));
  // Stub FontFace
  (globalThis as any).FontFace = class {
    family: string;
    url: string;
    constructor(f: string, u: string) { this.family = f; this.url = u; }
    async load() { return this; }
  };
});

describe('theme module', () => {
  test('applyTheme injects link tag with correct href', async () => {
    await applyTheme('Default');
    const link = (globalThis as any).__appended.find((n: Link) => n.tagName === 'LINK');
    expect(link).toBeDefined();
    expect(link.id).toBe('theme-css');
    expect(link.href).toBe('/themes/default/default.css');
    expect(getActiveTheme()).toBe('Default');
  });

  test('applyTheme replaces existing link', async () => {
    const existing = { tagName: 'LINK', id: 'theme-css', removed: false, remove() { this.removed = true; } };
    (globalThis as any).__byId['theme-css'] = existing;
    await applyTheme('Default');
    expect(existing.removed).toBe(true);
  });

  test('applyTheme falls back to Default when theme missing', async () => {
    await applyTheme('Nope');
    expect(getActiveTheme()).toBe('Default');
    const link = (globalThis as any).__appended.find((n: Link) => n.tagName === 'LINK');
    expect(link.href).toBe('/themes/default/default.css');
  });

  test('applyTheme returns silently when neither theme nor Default exists', async () => {
    stubFetch(() => ({ ok: true, json: async () => [] }));
    clearCaches();
    await applyTheme('Nope');
    expect((globalThis as any).__appended.length).toBe(0);
  });

  test('applyTheme resolves via error handler too', async () => {
    setupDom({ autoLoad: 'error' });
    await applyTheme('Default');
    // No throw = pass
  });

  test('listThemes returns empty array on non-ok fetch', async () => {
    stubFetch(() => ({ ok: false, json: async () => { throw new Error('nope'); } }));
    clearCaches();
    expect(await listThemes()).toEqual([]);
  });

  test('listThemes caches result', async () => {
    let calls = 0;
    stubFetch(() => { calls++; return { ok: true, json: async () => defaultThemes() }; });
    clearCaches();
    await listThemes();
    await listThemes();
    expect(calls).toBe(1);
  });

  test('listFonts returns empty on non-ok', async () => {
    stubFetch(() => ({ ok: false, json: async () => [] }));
    clearCaches();
    expect(await listFonts()).toEqual([]);
  });

  test('listFonts returns parsed body and caches', async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      return { ok: true, json: async () => [{ family: 'Iosevka', file: 'i.woff2', pack: 'default' }] };
    });
    clearCaches();
    const fonts = await listFonts();
    expect(fonts).toEqual([{ family: 'Iosevka', file: 'i.woff2', pack: 'default' }]);
    await listFonts();
    expect(calls).toBe(1);
  });

  test('loadAllFonts adds each font and tolerates load errors', async () => {
    stubFetch((u) => ({
      ok: true,
      json: async () => u.endsWith('/api/fonts')
        ? [
            { family: 'Good', file: 'g.woff2', pack: 'default' },
            { family: 'Bad', file: 'b.woff2', pack: 'default' },
          ]
        : defaultThemes(),
    }));
    clearCaches();
    let count = 0;
    (globalThis as any).FontFace = class {
      family: string;
      constructor(f: string) { this.family = f; count++; }
      async load() {
        if (this.family === 'Bad') throw new Error('cannot load');
        return this;
      }
    };
    const warnings: any[] = [];
    const origWarn = console.warn;
    console.warn = (...a: any[]) => { warnings.push(a); };
    try {
      await loadAllFonts();
    } finally {
      console.warn = origWarn;
    }
    expect(count).toBe(2);
    expect((document as any).fonts._added.length).toBe(1);
    expect(warnings.length).toBe(1);
  });

  test('getActiveTheme returns current theme name', async () => {
    await applyTheme('Amiga');
    expect(getActiveTheme()).toBe('Amiga');
  });

  test('clearCaches forces a refetch', async () => {
    let calls = 0;
    stubFetch(() => { calls++; return { ok: true, json: async () => defaultThemes() }; });
    clearCaches();
    await listThemes();
    clearCaches();
    await listThemes();
    expect(calls).toBe(2);
  });
});
