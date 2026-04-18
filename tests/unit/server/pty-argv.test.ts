import { describe, test, expect } from 'bun:test';
import { buildPtyCommand, buildPtyEnv, sanitizeSession } from '../../../src/server/pty.js';

describe('sanitizeSession (additional edge cases)', () => {
  test('multiple special characters removed', () => {
    expect(sanitizeSession('foo;bar`baz$qux')).toBe('foobarbazqux');
  });
  test('only special characters returns main', () => {
    expect(sanitizeSession(';;;$$$```')).toBe('main');
  });
  test('leading slash stripped', () => {
    expect(sanitizeSession('/foo')).toBe('foo');
  });
  test('trailing slash stripped', () => {
    expect(sanitizeSession('foo/')).toBe('foo');
  });
  test('multiple leading/trailing slashes stripped', () => {
    expect(sanitizeSession('///foo///')).toBe('foo');
  });
  test('percent-encoded special chars decoded and removed', () => {
    expect(sanitizeSession('foo%3Bbar')).toBe('foobar');
  });
  test('allows slashes in middle of path', () => {
    expect(sanitizeSession('path/to/session')).toBe('path/to/session');
  });
});

describe('buildPtyCommand (additional env/path cases)', () => {
  test('preserves absolute path in tmuxBin', () => {
    const cmd = buildPtyCommand({
      testMode: false,
      session: 'dev',
      tmuxConfPath: '/etc/tmux.conf',
      tmuxBin: '/usr/bin/tmux',
    });
    expect(cmd.file).toBe('/usr/bin/tmux');
  });
  test('relative tmuxBin preserved as-is', () => {
    const cmd = buildPtyCommand({
      testMode: false,
      session: 'test',
      tmuxConfPath: '/tmp/t.conf',
      tmuxBin: 'tmux',
    });
    expect(cmd.file).toBe('tmux');
  });
  test('sanitizes multiple dangerous chars in session', () => {
    const cmd = buildPtyCommand({
      testMode: false,
      session: 'dev;rm -rf',
      tmuxConfPath: '/t.conf',
      tmuxBin: 'tmux',
    });
    const sessionName = cmd.args[cmd.args.length - 1];
    expect(sessionName).toBe('devrm-rf');
  });
});

describe('buildPtyEnv (comprehensive env scrubbing)', () => {
  test('scrubs LANG variable', () => {
    const prev = process.env.LANG;
    process.env.LANG = 'en_US.UTF-8';
    const env = buildPtyEnv();
    expect(env.LANG).toBeUndefined();
    process.env.LANG = prev;
  });
  test('scrubs LANGUAGE variable', () => {
    const prev = process.env.LANGUAGE;
    process.env.LANGUAGE = 'en:fr';
    const env = buildPtyEnv();
    expect(env.LANGUAGE).toBeUndefined();
    process.env.LANGUAGE = prev;
  });
  test('sets TERM_PROGRAM to xterm', () => {
    const env = buildPtyEnv();
    expect(env.TERM_PROGRAM).toBe('xterm');
  });
  test('preserves other environment variables', () => {
    const prev = process.env.TEST_VAR;
    process.env.TEST_VAR = 'test_value';
    const env = buildPtyEnv();
    expect(env.TEST_VAR).toBe('test_value');
    process.env.TEST_VAR = prev;
  });
  test('all required env vars are set', () => {
    const env = buildPtyEnv();
    expect(env.TERM).toBeDefined();
    expect(env.TERM_PROGRAM).toBeDefined();
    expect(env.COLORTERM).toBeDefined();
    expect(env.LC_ALL).toBeDefined();
  });
});
