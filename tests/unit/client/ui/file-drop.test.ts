import { describe, test, expect, beforeEach } from 'bun:test';
import { filesFromClipboard, uploadFile } from '../../../../src/client/ui/file-drop.ts';

function fakeFile(name: string, body = 'x'): File {
  // bun supports global File via undici. Fall back to a minimal shim.
  if (typeof File !== 'undefined') return new File([body], name, { type: 'text/plain' });
  return { name, size: body.length, type: 'text/plain' } as unknown as File;
}

describe('filesFromClipboard', () => {
  test('returns cd.files when populated', () => {
    const a = fakeFile('a.txt');
    const b = fakeFile('b.txt');
    const cd = { files: [a, b], items: [] as any[] } as unknown as DataTransfer;
    expect(filesFromClipboard(cd)).toEqual([a, b]);
  });

  test('takes items[] when it has more files than cd.files (multi-file regression)', () => {
    // Some browsers expose all N pasted files via items[] but only the
    // first in cd.files. Make sure we pick the larger set.
    const a = fakeFile('a.png');
    const b = fakeFile('b.png');
    const c = fakeFile('c.png');
    const cd = {
      files: [a],
      items: [
        { kind: 'file', getAsFile: () => a },
        { kind: 'file', getAsFile: () => b },
        { kind: 'file', getAsFile: () => c },
      ],
    } as unknown as DataTransfer;
    expect(filesFromClipboard(cd)).toEqual([a, b, c]);
  });

  test('falls back to items[] of kind=file when cd.files is empty', () => {
    const f = fakeFile('img.png');
    const cd = {
      files: [] as any as FileList,
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => f },
      ],
    } as unknown as DataTransfer;
    expect(filesFromClipboard(cd)).toEqual([f]);
  });

  test('returns [] when no files and only string items', () => {
    const cd = {
      files: [] as any as FileList,
      items: [{ kind: 'string', getAsFile: () => null }],
    } as unknown as DataTransfer;
    expect(filesFromClipboard(cd)).toEqual([]);
  });
});

describe('uploadFile', () => {
  let lastUrl: string;
  let lastInit: RequestInit | undefined;

  beforeEach(() => {
    lastUrl = ''; lastInit = undefined;
  });

  test('POSTs to /api/drop with session query, X-Filename header, and file body', async () => {
    const fakeFetch = (async (url: any, init?: RequestInit) => {
      lastUrl = String(url); lastInit = init;
      return {
        ok: true,
        json: async () => ({ filename: 'hello world.png', size: 7, path: '/run/x/hello world.png' }),
      } as any;
    }) as typeof fetch;

    const f = fakeFile('hello world.png', 'PNGDATA');
    const info = await uploadFile('main', f, fakeFetch);

    expect(lastUrl).toBe('/api/drop?session=main');
    expect(lastInit?.method).toBe('POST');
    expect((lastInit?.headers as any)['X-Filename']).toBe(encodeURIComponent('hello world.png'));
    expect(lastInit?.body).toBe(f);
    expect(info.filename).toBe('hello world.png');
    expect(info.size).toBe(7);
  });

  test('URL-encodes session names with special chars', async () => {
    const fakeFetch = (async (url: any) => {
      lastUrl = String(url);
      return { ok: true, json: async () => ({}) } as any;
    }) as typeof fetch;
    await uploadFile('weird name/with slash', fakeFile('a'), fakeFetch);
    expect(lastUrl).toBe(`/api/drop?session=${encodeURIComponent('weird name/with slash')}`);
  });

  test('throws on non-ok response so callers can report an error', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 413, json: async () => ({}) } as any)) as typeof fetch;
    await expect(uploadFile('main', fakeFile('a'), fakeFetch)).rejects.toThrow(/413/);
  });
});
