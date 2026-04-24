import { describe, it, expect, beforeEach } from 'bun:test';
import { fetchColours, composeBgColor, composeTheme } from '../../../src/client/colours.ts';

function stubFetch(impl: (url: string) => any): void {
  (globalThis as any).fetch = async (url: string) => impl(url);
}

beforeEach(() => {
  (globalThis as any).console.warn = () => {};
  (globalThis as any).window = { __TMUX_WEB_CONFIG: { version: 'test' } };
});

describe('composeBgColor', () => {
  it('produces rgba with the requested opacity', () => {
    expect(composeBgColor({ background: '#102030' } as any, 50)).toBe('rgba(16,32,48,0.5)');
  });

  it('clamps opacity out of range to 0..1', () => {
    expect(composeBgColor({ background: '#ffffff' } as any, -10)).toBe('rgba(255,255,255,0)');
    expect(composeBgColor({ background: '#000000' } as any, 500)).toBe('rgba(0,0,0,1)');
  });

  it('defaults to black when the theme has no background', () => {
    expect(composeBgColor({} as any, 0)).toBe('rgba(0,0,0,0)');
  });
});

describe('composeTheme', () => {
  it('forces alpha=0 on the output background (xterm atlas contract)', () => {
    const out = composeTheme({ background: '#808080' } as any, 50);
    expect(out.background).toMatch(/,0\)$/);
  });

  it('blends theme bg against bodyBg when opacity < 100', () => {
    const out = composeTheme({ background: '#808080' } as any, 50, 'rgb(0, 0, 0)');
    const m = out.background!.match(/^rgba\((\d+),(\d+),(\d+),/);
    expect(m).not.toBeNull();
    // 0x80 * 0.5 + 0 * 0.5 = 64
    expect(parseInt(m![1]!, 10)).toBe(64);
  });

  it('skips the blend when opacity is 100', () => {
    const out = composeTheme({ background: '#112233' } as any, 100, 'rgb(0, 0, 0)');
    // 0x11 = 17
    expect(out.background).toBe('rgba(17,34,51,0)');
  });
});

describe('fetchColours', () => {
  it('uses injected desktop boot metadata before fetch', async () => {
    let calls = 0;
    const colours = [{ name: 'Injected', theme: { background: '#111' } }];
    (globalThis as any).window.__TMUX_WEB_CONFIG.colours = colours;
    stubFetch(() => {
      calls++;
      return { ok: true, json: async () => [] };
    });

    expect(await fetchColours()).toEqual(colours);
    expect(calls).toBe(0);
  });

  it('returns the server list on ok', async () => {
    stubFetch(() => ({ ok: true, json: async () => [{ name: 'Nord', theme: { background: '#000' } }] }));
    const r = await fetchColours();
    expect(r).toHaveLength(1);
    expect(r[0]!.name).toBe('Nord');
  });

  it('returns [] and records a boot error on non-ok response', async () => {
    stubFetch(() => ({ ok: false, status: 500, json: async () => [] }));
    const { consumeBootErrors } = await import('../../../src/client/boot-errors.ts');
    consumeBootErrors();
    expect(await fetchColours()).toEqual([]);
    expect(consumeBootErrors()).toContain('colours');
  });

  it('returns [] and records a boot error on fetch rejection', async () => {
    stubFetch(() => { throw new Error('network'); });
    const { consumeBootErrors } = await import('../../../src/client/boot-errors.ts');
    consumeBootErrors();
    expect(await fetchColours()).toEqual([]);
    expect(consumeBootErrors()).toContain('colours');
  });
});
