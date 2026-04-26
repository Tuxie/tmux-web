import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('Makefile test-unit uses the stable isolated unit runner', () => {
  const makefile = readFileSync('Makefile', 'utf8');
  const target = makefile.match(/^test-unit:\n((?:\t.*\n)+)/m)?.[1] ?? '';

  expect(target).toContain('sh scripts/test-unit-files.sh $(BUN)');
  expect(target).not.toContain('--parallel');
});

test('Makefile has no bundled tmux build targets', () => {
  const makefile = readFileSync('Makefile', 'utf8');

  expect(makefile).not.toContain('vendor-tmux');
  expect(makefile).not.toContain('dist/bin/tmux');
  expect(makefile).not.toContain('vendor/tmux');
  expect(makefile).not.toContain('vendor/libevent');
  expect(makefile).not.toContain('vendor/utf8proc');
});
