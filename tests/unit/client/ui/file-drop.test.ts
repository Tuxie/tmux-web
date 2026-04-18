import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupDocument, el, stubFetch } from '../_dom.ts';
import {
  uploadFile, filesFromClipboard, installFileDropHandler,
} from '../../../../src/client/ui/file-drop.ts';

function makeFile(name: string, size = 4): File {
  return { name, size, type: 'application/octet-stream' } as any;
}

describe('uploadFile', () => {
  test('posts to /api/drop with X-Filename', async () => {
    const { calls } = stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'x', size: 4, path: '/tmp/x' }) }));
    const info = await uploadFile('main', makeFile('x'));
    expect(info.path).toBe('/tmp/x');
    expect(calls[0]!.url).toBe('/api/drop?session=main');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as any)['X-Filename']).toBe(encodeURIComponent('x'));
  });
  test('throws on non-ok response', async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(uploadFile('main', makeFile('x'))).rejects.toThrow(/drop upload 500/);
  });
  test('session name is URL-encoded', async () => {
    const { calls } = stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'y', size: 1, path: '/t/y' }) }));
    await uploadFile('a b/c', makeFile('y'));
    expect(calls[0]!.url).toBe('/api/drop?session=a%20b%2Fc');
  });
});

describe('filesFromClipboard', () => {
  test('prefers the larger of files[] vs items[]', () => {
    const f1 = makeFile('a'), f2 = makeFile('b');
    const cd: any = {
      files: [f1],
      items: [
        { kind: 'file', getAsFile: () => f1 },
        { kind: 'file', getAsFile: () => f2 },
      ],
    };
    expect(filesFromClipboard(cd)).toEqual([f1, f2]);
  });
  test('dedupes when same File in both sources', () => {
    const f = makeFile('a');
    const cd: any = {
      files: [f],
      items: [{ kind: 'file', getAsFile: () => f }],
    };
    expect(filesFromClipboard(cd)).toEqual([f]);
  });
  test('ignores non-file items', () => {
    const cd: any = { files: [], items: [{ kind: 'string', getAsFile: () => null }] };
    expect(filesFromClipboard(cd)).toEqual([]);
  });
  test('handles null files and null items', () => {
    expect(filesFromClipboard({ files: null, items: null } as any)).toEqual([]);
  });
});

describe('installFileDropHandler', () => {
  let offs: Array<() => void> = [];
  beforeEach(() => { setupDocument(); offs = []; });
  afterEach(() => { for (const o of offs) o(); });
  const install = (opts: any) => { const o = installFileDropHandler(opts); offs.push(o); return o; };

  test('drag + drop uploads all files and calls onDropped', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'x', size: 4, path: '/tmp/x' }) }));
    install({ terminal: term as any, getSession: () => 'main', onDropped: (i: any) => dropped.push(i) });
    const file = makeFile('a');
    const dt: any = { types: ['Files'], files: [file], dropEffect: '' };
    term.dispatch('dragenter', { dataTransfer: dt, preventDefault() {} });
    term.dispatch('dragover', { dataTransfer: dt, preventDefault() {} });
    term.dispatch('dragleave', { dataTransfer: dt, preventDefault() {} });
    term.dispatch('drop', { dataTransfer: dt, preventDefault() {} });
    await new Promise(r => setTimeout(r, 20));
    expect(dropped).toHaveLength(1);
  });

  test('drop without Files type is a no-op', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    install({ terminal: term as any, getSession: () => 'main', onDropped: (i: any) => dropped.push(i) });
    term.dispatch('drop', { dataTransfer: { types: [], files: [] }, preventDefault() {} });
    await new Promise(r => setTimeout(r, 5));
    expect(dropped).toHaveLength(0);
  });

  test('drop with Files but empty file list is a no-op', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    install({ terminal: term as any, getSession: () => 'main', onDropped: (i: any) => dropped.push(i) });
    term.dispatch('drop', { dataTransfer: { types: ['Files'], files: [] }, preventDefault() {} });
    await new Promise(r => setTimeout(r, 5));
    expect(dropped).toHaveLength(0);
  });

  test('paste with files pre-empts default and uploads', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'x', size: 4, path: '/tmp/x' }) }));
    install({ terminal: term as any, getSession: () => 'main', onDropped: (i: any) => dropped.push(i) });
    let prevented = false;
    (globalThis as any).document.dispatch('paste', {
      clipboardData: {
        files: [makeFile('x')],
        items: [{ kind: 'file', getAsFile: () => makeFile('x') }],
      },
      preventDefault() { prevented = true; },
      stopPropagation() {},
    });
    await new Promise(r => setTimeout(r, 20));
    expect(prevented).toBe(true);
    expect(dropped.length).toBeGreaterThan(0);
  });

  test('paste without files leaves default (no preventDefault)', async () => {
    const term = el('div');
    install({ terminal: term as any, getSession: () => 'main' });
    let prevented = false;
    (globalThis as any).document.dispatch('paste', {
      clipboardData: { files: [], items: [{ kind: 'string', getAsFile: () => null }] },
      preventDefault() { prevented = true; }, stopPropagation() {},
    });
    expect(prevented).toBe(false);
  });

  test('paste with no clipboardData is a no-op', () => {
    const term = el('div');
    install({ terminal: term as any, getSession: () => 'main' });
    expect(() => (globalThis as any).document.dispatch('paste', { clipboardData: null, preventDefault() {}, stopPropagation() {} })).not.toThrow();
  });

  test('onError called on upload failure', async () => {
    const term = el('div');
    const errs: any[] = [];
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    install({ terminal: term as any, getSession: () => 'main', onError: (e: any) => errs.push(e) });
    term.dispatch('drop', { dataTransfer: { types: ['Files'], files: [makeFile('x')] }, preventDefault() {} });
    await new Promise(r => setTimeout(r, 20));
    expect(errs).toHaveLength(1);
  });

  test('uninstall removes listeners and overlay', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'x', size: 4, path: '/tmp/x' }) }));
    const off = installFileDropHandler({ terminal: term as any, getSession: () => 'main', onDropped: (i) => dropped.push(i) });
    off();
    term.dispatch('drop', { dataTransfer: { types: ['Files'], files: [makeFile('x')] }, preventDefault() {} });
    await new Promise(r => setTimeout(r, 10));
    expect(dropped).toHaveLength(0);
  });
});
