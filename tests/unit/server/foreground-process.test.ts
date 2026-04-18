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
  test('happy path: resolves exePath via injected readlink', async () => {
    const deps = {
      exec: async () => ({ stdout: '123\tbash\n', stderr: '' }),
      readFile: (_p: string) => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: (_p: string) => '/usr/bin/bash',
    };
    const got = await getForegroundProcess('tmux', 'main', deps);
    expect(got).toEqual({ exePath: '/usr/bin/bash', commandName: 'bash', pid: 999 });
  });

  test('exec failure → all null', async () => {
    const deps = {
      exec: async () => { throw new Error('tmux not running'); },
      readFile: () => { throw new Error('unused'); },
      readlink: () => { throw new Error('unused'); },
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: null, commandName: null, pid: null });
  });

  test('readlink failure → exePath null, pid preserved', async () => {
    const deps = {
      exec: async () => ({ stdout: '123\tbash', stderr: '' }),
      readFile: () => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: () => { throw new Error('ENOENT'); },
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: null, commandName: 'bash', pid: 999 });
  });

  test('readFile failure → exePath null, commandName preserved', async () => {
    const deps = {
      exec: async () => ({ stdout: '123\tbash', stderr: '' }),
      readFile: () => { throw new Error('EACCES'); },
      readlink: () => '/never-called',
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: null, commandName: 'bash', pid: 123 });
  });

  test('tpgid zero falls back to panePid for exe lookup', async () => {
    const deps = {
      exec: async () => ({ stdout: '500\tzsh', stderr: '' }),
      readFile: () => '500 (zsh) S 1 1 1 34816 0 ...',
      readlink: (p: string) => (p.includes('/500/') ? '/bin/zsh' : (() => { throw new Error(); })()),
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: '/bin/zsh', commandName: 'zsh', pid: 500 });
  });

  test('empty exec stdout → commandName null, pid null', async () => {
    const deps = {
      exec: async () => ({ stdout: '', stderr: '' }),
      readFile: () => { throw new Error('unused'); },
      readlink: () => { throw new Error('unused'); },
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: null, commandName: null, pid: null });
  });
});
