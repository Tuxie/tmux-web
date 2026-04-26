import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');

describe('release workflow desktop artifacts', () => {
  test('does not build or verify a vendored tmux binary', () => {
    expect(workflow).not.toContain('vendor-tmux');
    expect(workflow).not.toContain('verify-vendor-tmux');
    expect(workflow).not.toContain('dist/bin/tmux');
  });

  test('builds and uploads tmux-term Electrobun artifacts', () => {
    expect(workflow).toContain('Build tmux-term desktop app');
    expect(workflow).toContain('Package tmux-term desktop app');
    expect(workflow).toContain('tmux-term-${{ github.ref_name }}-${{ matrix.name }}-artifact');
    expect(workflow).toContain('artifacts/${PREFIX}*');
  });

  test('skips tmux-term Electrobun artifacts on macOS until signing is available', () => {
    const tmuxTermStepCount = (workflow.match(/if: matrix\.desktop_platform != 'macos'/g) ?? []).length;

    expect(tmuxTermStepCount).toBe(4);
  });

  test('attaches tmux-term artifacts to the GitHub release', () => {
    expect(workflow).toContain("pattern: '*-${{ github.ref_name }}-*-artifact'");
    expect(workflow).toContain('artifacts/*');
  });
});
