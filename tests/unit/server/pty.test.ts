import { describe, it, expect } from 'vitest';
import { buildPtyCommand, buildPtyEnv, sanitizeSession } from '../../../src/server/pty.js';

describe('sanitizeSession', () => {
  it('strips dangerous characters', () => {
    expect(sanitizeSession('foo;rm -rf /')).toBe('foorm-rf');
  });
  it('collapses double dots', () => {
    const result = sanitizeSession('../../../etc');
    expect(result).not.toContain('..');
  });
  it('defaults empty session to "main"', () => {
    expect(sanitizeSession('')).toBe('main');
  });
  it('allows alphanumeric, dash, underscore, dot, slash', () => {
    expect(sanitizeSession('my-project_v2.0/branch')).toBe('my-project_v2.0/branch');
  });
  it('decodes URI components', () => {
    expect(sanitizeSession('hello%20world')).toBe('helloworld');
  });
});

describe('buildPtyCommand', () => {
  it('returns cat command in test mode', () => {
    const cmd = buildPtyCommand({ testMode: true, session: 'main', tmuxConfPath: '/tmp/tmux.conf', tmuxBin: 'tmux' });
    expect(cmd.file).toBe('cat');
    expect(cmd.args).toEqual([]);
  });
  it('returns tmux command with -f flag in production mode', () => {
    const cmd = buildPtyCommand({ testMode: false, session: 'dev', tmuxConfPath: '/etc/tmux-web.conf', tmuxBin: 'tmux' });
    expect(cmd.file).toBe('tmux');
    expect(cmd.args).toEqual(['-f', '/etc/tmux-web.conf', 'new-session', '-A', '-s', 'dev']);
  });
  it('sanitizes session name', () => {
    const cmd = buildPtyCommand({ testMode: false, session: 'foo;rm', tmuxConfPath: '/tmp/t.conf', tmuxBin: 'tmux' });
    expect(cmd.args.at(-1)).toBe('foorm');
  });
  it('defaults empty session to "main"', () => {
    const cmd = buildPtyCommand({ testMode: false, session: '', tmuxConfPath: '/tmp/t.conf', tmuxBin: 'tmux' });
    expect(cmd.args.at(-1)).toBe('main');
  });
});

describe('buildPtyEnv', () => {
  it('sets TERM to ghostty for ghostty backend', () => {
    expect(buildPtyEnv('ghostty').TERM).toBe('ghostty');
  });
  it('sets TERM to xterm-256color for xterm backend', () => {
    expect(buildPtyEnv('xterm').TERM).toBe('xterm-256color');
  });
  it('sets COLORTERM to truecolor', () => {
    expect(buildPtyEnv('ghostty').COLORTERM).toBe('truecolor');
  });
  it('sets LC_ALL to C.UTF-8', () => {
    expect(buildPtyEnv('ghostty').LC_ALL).toBe('C.UTF-8');
  });
  it('strips EDITOR and VISUAL', () => {
    const prev = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };
    process.env.EDITOR = 'vim';
    process.env.VISUAL = 'code';
    const env = buildPtyEnv('ghostty');
    expect(env.EDITOR).toBeUndefined();
    expect(env.VISUAL).toBeUndefined();
    process.env.EDITOR = prev.EDITOR;
    process.env.VISUAL = prev.VISUAL;
  });
});
