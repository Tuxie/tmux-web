import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const html = readFileSync(resolve(import.meta.dir, '../../../src/client/index.html'), 'utf-8');

describe('index.html does not expose removed backend-selection UI', () => {
  it('has no #inp-terminal element', () => {
    expect(html).not.toContain('id="inp-terminal"');
  });
});

describe('index.html Electrobun titlebar affordance', () => {
  it('marks the topbar title as a native window drag region', () => {
    expect(html).toContain('id="tb-title" class="electrobun-webkit-app-region-drag"');
  });
});

describe('index.html scrollbar DOM contract', () => {
  it('includes scrollbar autohide control and scrollbar shell', () => {
    expect(html).toContain('id="chk-scrollbar-autohide"');
    expect(html).toContain('id="tmux-scrollbar"');
    expect(html).toContain('class="tw-scrollbar');
  });
});
