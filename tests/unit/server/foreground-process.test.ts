import { describe, test, expect } from 'bun:test';
import { parseForegroundFromProc, getForegroundProcess } from '../../../src/server/foreground-process.ts';

describe('parseForegroundFromProc', () => {
  test('extracts tpgid from canonical /proc/<pid>/stat', () => {
    const stat = '123 (bash) S 100 123 123 34816 456 4194304 0 ...';
    expect(parseForegroundFromProc(stat)).toBe(456);
  });
  test('handles comm containing spaces and parens', () => {
    const stat = '123 (weird )(name) S 100 123 123 34816 789 ...';
    expect(parseForegroundFromProc(stat)).toBe(789);
  });
  test('returns null for tpgid 0 or -1', () => {
    expect(parseForegroundFromProc('1 (x) S 1 1 1 0 0 ...')).toBeNull();
    expect(parseForegroundFromProc('1 (x) S 1 1 1 0 -1 ...')).toBeNull();
  });
  test('returns null for malformed input', () => {
    expect(parseForegroundFromProc('')).toBeNull();
    expect(parseForegroundFromProc('no closing paren here')).toBeNull();
  });
});

describe('getForegroundProcess with injected deps', () => {
  const ok = async (_args: readonly string[]) => '123\tbash\n';

  test('happy path: resolves exePath via injected readlink', async () => {
    const got = await getForegroundProcess(ok, 'main', {
      readFile: () => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: () => '/usr/bin/bash',
    });
    expect(got).toEqual({ exePath: '/usr/bin/bash', commandName: 'bash', pid: 999 });
  });

  test('exec failure → all null', async () => {
    const got = await getForegroundProcess(async () => { throw new Error('nope'); }, 'main');
    expect(got).toEqual({ exePath: null, commandName: null, pid: null });
  });

  test('readlink failure → exePath null, pid preserved', async () => {
    const got = await getForegroundProcess(ok, 'main', {
      readFile: () => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: () => { throw new Error('ENOENT'); },
    });
    expect(got).toEqual({ exePath: null, commandName: 'bash', pid: 999 });
  });

  test('readFile failure → exePath null, commandName preserved', async () => {
    const got = await getForegroundProcess(ok, 'main', {
      readFile: () => { throw new Error('EACCES'); },
      readlink: () => '/never-called',
    });
    expect(got).toEqual({ exePath: null, commandName: 'bash', pid: 123 });
  });

  test('tpgid zero falls back to panePid for exe lookup', async () => {
    const got = await getForegroundProcess(async () => '500\tzsh', 'main', {
      readFile: () => '500 (zsh) S 1 1 1 34816 0 ...',
      readlink: (p) => (p.includes('/500/') ? '/bin/zsh' : (() => { throw new Error(); })()),
    });
    expect(got).toEqual({ exePath: '/bin/zsh', commandName: 'zsh', pid: 500 });
  });

  test('empty exec stdout → commandName null, pid null', async () => {
    const got = await getForegroundProcess(async () => '', 'main', {
      readFile: () => { throw new Error('unused'); },
      readlink: () => { throw new Error('unused'); },
    });
    expect(got).toEqual({ exePath: null, commandName: null, pid: null });
  });
});
