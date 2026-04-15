import { beforeEach, describe, expect, test } from 'bun:test';

function setupDom() {
  (globalThis as any).document = {
    head: { appendChild: (n: any) => { (globalThis as any).__appended?.push(n); } },
    createElement: (tag: string) => ({
      tagName: tag.toUpperCase(),
      setAttribute(k: string, v: string) { (this as any)[k] = v; },
    }),
    getElementById: (id: string) => (globalThis as any).__byId?.[id] ?? null,
    documentElement: { style: {} as Record<string, string> },
    fonts: { add: () => {} },
  };
  (globalThis as any).getComputedStyle = () => ({
    getPropertyValue: (k: string) => ({
      '--tw-border-top': '24px',
      '--tw-border-right': '8px',
      '--tw-border-bottom': '8px',
      '--tw-border-left': '8px',
    } as Record<string, string>)[k] ?? '',
  });
  (globalThis as any).__appended = [];
  (globalThis as any).__byId = {};
  (globalThis as any).fetch = async (u: string) => ({
    ok: true,
    json: async () =>
      u.endsWith('/api/themes')
        ? [{ name: 'Default', pack: 'default', css: 'default.css', source: 'bundled' }]
        : [],
  });
}

beforeEach(setupDom);

describe('theme module', () => {
  test('readBorderInsets parses CSS vars to numbers', async () => {
    const { readBorderInsets } = await import('../../../src/client/theme');
    expect(readBorderInsets()).toEqual({ top: 24, right: 8, bottom: 8, left: 8 });
  });

  test('applyTheme injects link tag with correct href', async () => {
    const { applyTheme } = await import('../../../src/client/theme');
    await applyTheme('Default');
    const link = (globalThis as any).__appended.find((n: any) => n.tagName === 'LINK');
    expect(link).toBeDefined();
    expect(link.id).toBe('theme-css');
    expect(link.href).toBe('/themes/default/default.css');
  });

  test('applyTheme replaces existing link', async () => {
    const existing = {
      tagName: 'LINK',
      id: 'theme-css',
      href: '/themes/old/old.css',
      remove() { (this as any).removed = true; },
    };
    (globalThis as any).__byId['theme-css'] = existing;
    const { applyTheme } = await import('../../../src/client/theme');
    await applyTheme('Default');
    expect((existing as any).removed).toBe(true);
  });
});
