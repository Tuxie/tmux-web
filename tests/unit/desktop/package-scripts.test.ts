import { describe, expect, test } from 'bun:test';
import pkg from '../../../package.json';

describe('desktop package scripts', () => {
  test('desktop:dev uses the bundled tmux-web binary path', () => {
    const script = pkg.scripts['desktop:dev'];

    expect(script).toContain('make tmux-web');
    expect(script).toContain('electrobun dev');
    expect(script).not.toContain('TMUX_TERM_TMUX_WEB=./tmux-web');
  });
});
