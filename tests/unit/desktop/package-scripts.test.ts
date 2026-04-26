import { describe, expect, test } from 'bun:test';
import pkg from '../../../package.json';

describe('desktop package scripts', () => {
  test('desktop:dev builds tmux-web before launching Electrobun', () => {
    const script = pkg.scripts['desktop:dev'];

    expect(script).toContain('bun run scripts/build-desktop-prereqs.ts');
    expect(script).toContain('electrobun dev');
    expect(script).not.toContain('TMUX_TERM_TMUX_WEB=./tmux-web');
  });
});
