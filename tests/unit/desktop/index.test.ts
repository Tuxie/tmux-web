import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  desktopExtraArgs,
} from '../../../src/desktop/tmux-path.ts';

const originalPath = process.env.PATH;
const originalTmux = process.env.TMUX_TERM_TMUX_BIN;
const originalThemes = process.env.TMUX_TERM_THEMES_DIR;

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalTmux === undefined) delete process.env.TMUX_TERM_TMUX_BIN;
  else process.env.TMUX_TERM_TMUX_BIN = originalTmux;
  if (originalThemes === undefined) delete process.env.TMUX_TERM_THEMES_DIR;
  else process.env.TMUX_TERM_THEMES_DIR = originalThemes;
});

function makeExecutable(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-term-path-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

describe('desktop entrypoint helpers', () => {
  test('desktopExtraArgs leaves default tmux lookup to the tmux-web server PATH', () => {
    const tmux = makeExecutable('tmux');
    process.env.PATH = path.dirname(tmux);
    delete process.env.TMUX_TERM_TMUX_BIN;

    expect(desktopExtraArgs()).toEqual([]);
  });

  test('desktopExtraArgs lets TMUX_TERM_TMUX_BIN override PATH', () => {
    const tmux = makeExecutable('tmux');
    process.env.PATH = path.dirname(tmux);
    process.env.TMUX_TERM_TMUX_BIN = '/custom/tmux';

    expect(desktopExtraArgs()).toEqual(['--tmux', '/custom/tmux']);
  });

  test('desktopExtraArgs does not fall back to a sibling bundled tmux', () => {
    const tmux = makeExecutable('tmux');
    const bun = path.join(path.dirname(tmux), 'bun');
    fs.writeFileSync(bun, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = '';
    delete process.env.TMUX_TERM_TMUX_BIN;

    expect(desktopExtraArgs()).toEqual([]);
  });
});
