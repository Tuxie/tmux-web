import { describe, it, test, expect } from 'bun:test';
import { buildPtyCommand, buildPtyEnv, sanitizeSession } from '../../../src/server/pty.js';

describe('sanitizeSession', () => {
  it('strips dangerous characters', () => {
    expect(sanitizeSession('foo;rm -rf /')).toBe('foorm-rf');
  });
  it('strips multiple special characters in one input', () => {
    expect(sanitizeSession('foo;bar`baz$qux')).toBe('foobarbazqux');
  });
  it('collapses double dots', () => {
    const result = sanitizeSession('../../../etc');
    expect(result).not.toContain('..');
  });
  it('collapses a single dot-dot segment even when mixed with slash', () => {
    expect(sanitizeSession('../etc')).not.toContain('..');
  });
  it('defaults empty session to "main"', () => {
    expect(sanitizeSession('')).toBe('main');
  });
  it('defaults only-special-character session to "main"', () => {
    expect(sanitizeSession(';;;$$$```')).toBe('main');
  });
  it('strips leading slashes', () => {
    expect(sanitizeSession('/foo')).toBe('foo');
  });
  it('strips trailing slashes', () => {
    expect(sanitizeSession('foo/')).toBe('foo');
  });
  it('strips multiple leading/trailing slashes', () => {
    expect(sanitizeSession('///foo///')).toBe('foo');
  });
  it('allows alphanumeric, dash, underscore, dot, slash', () => {
    expect(sanitizeSession('my-project_v2.0/branch')).toBe('my-project_v2.0/branch');
  });
  it('allows slashes in middle of path', () => {
    expect(sanitizeSession('path/to/session')).toBe('path/to/session');
  });
  it('decodes URI components', () => {
    expect(sanitizeSession('hello%20world')).toBe('helloworld');
  });
  it('decodes percent-encoded special chars and then strips them', () => {
    expect(sanitizeSession('foo%3Bbar')).toBe('foobar');
  });

  it('does not throw on malformed percent-escapes (regression for %, %X, %%)', () => {
    // These used to throw via the internal decodeURIComponent — caught by
    // the fuzz pass under tests/fuzz/sanitize-session.test.ts.
    expect(sanitizeSession('%')).toBe('main');
    expect(sanitizeSession('%X')).toBe('X');
    expect(sanitizeSession('%%')).toBe('main');
    expect(sanitizeSession('foo%bar')).toBe('foobar');
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
  it('preserves absolute path in tmuxBin', () => {
    const cmd = buildPtyCommand({
      testMode: false, session: 'dev', tmuxConfPath: '/etc/tmux.conf', tmuxBin: '/usr/bin/tmux',
    });
    expect(cmd.file).toBe('/usr/bin/tmux');
  });
  it('preserves relative tmuxBin as-is', () => {
    const cmd = buildPtyCommand({
      testMode: false, session: 'test', tmuxConfPath: '/tmp/t.conf', tmuxBin: 'tmux',
    });
    expect(cmd.file).toBe('tmux');
  });
  it('sanitizes session name in argv', () => {
    const cmd = buildPtyCommand({ testMode: false, session: 'foo;rm', tmuxConfPath: '/tmp/t.conf', tmuxBin: 'tmux' });
    expect(cmd.args.at(-1)).toBe('foorm');
  });
  it('sanitizes multiple dangerous chars in session', () => {
    const cmd = buildPtyCommand({
      testMode: false, session: 'dev;rm -rf', tmuxConfPath: '/t.conf', tmuxBin: 'tmux',
    });
    expect(cmd.args.at(-1)).toBe('devrm-rf');
  });
  it('defaults empty session to "main"', () => {
    const cmd = buildPtyCommand({ testMode: false, session: '', tmuxConfPath: '/tmp/t.conf', tmuxBin: 'tmux' });
    expect(cmd.args.at(-1)).toBe('main');
  });
});

describe('buildPtyEnv', () => {
  it('sets TERM to xterm-256color', () => {
    expect(buildPtyEnv().TERM).toBe('xterm-256color');
  });
  it('sets COLORTERM to truecolor', () => {
    expect(buildPtyEnv().COLORTERM).toBe('truecolor');
  });
  it('sets LC_ALL to C.UTF-8', () => {
    expect(buildPtyEnv().LC_ALL).toBe('C.UTF-8');
  });
  it('sets TERM_PROGRAM to xterm', () => {
    expect(buildPtyEnv().TERM_PROGRAM).toBe('xterm');
  });
  it('all required env vars are set', () => {
    const env = buildPtyEnv();
    expect(env.TERM).toBeDefined();
    expect(env.TERM_PROGRAM).toBeDefined();
    expect(env.COLORTERM).toBeDefined();
    expect(env.LC_ALL).toBeDefined();
  });
  it('passes EDITOR and VISUAL through unchanged (cluster 15 / F4)', () => {
    // Previous behaviour wholesale-stripped EDITOR/VISUAL with no
    // documented rationale; that broke `:!vim file` inside shells
    // running under tmux-web. Pass-through is the documented current
    // behaviour. Cluster 15 / F4 — docs/code-analysis/2026-04-26.
    const prev = { EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };
    process.env.EDITOR = 'vim';
    process.env.VISUAL = 'code';
    const env = buildPtyEnv();
    expect(env.EDITOR).toBe('vim');
    expect(env.VISUAL).toBe('code');
    process.env.EDITOR = prev.EDITOR;
    process.env.VISUAL = prev.VISUAL;
  });
  it('strips LANG', () => {
    const prev = process.env.LANG;
    process.env.LANG = 'en_US.UTF-8';
    const env = buildPtyEnv();
    expect(env.LANG).toBeUndefined();
    process.env.LANG = prev;
  });
  it('strips LANGUAGE', () => {
    const prev = process.env.LANGUAGE;
    process.env.LANGUAGE = 'en:fr';
    const env = buildPtyEnv();
    expect(env.LANGUAGE).toBeUndefined();
    process.env.LANGUAGE = prev;
  });
  it('preserves unrelated environment variables', () => {
    const prev = process.env.TEST_VAR;
    process.env.TEST_VAR = 'test_value';
    const env = buildPtyEnv();
    expect(env.TEST_VAR).toBe('test_value');
    process.env.TEST_VAR = prev;
  });
});
