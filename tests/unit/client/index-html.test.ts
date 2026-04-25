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
    expect(html).toContain('<div class="tw-menu-row tw-menu-row-static tw-menu-row-inline">');
    expect(html).toMatch(/<label><input type="checkbox" id="chk-autohide"> Autohide toolbar<\/label>\s*<label><input type="checkbox" id="chk-scrollbar-autohide"> Autohide scrollbar<\/label>/);
    expect(html).toMatch(/<div id="tmux-scrollbar" class="tw-scrollbar tw-scrollbar-pinned" aria-hidden="true">\s*<div class="tw-scrollbar-track">\s*<div class="tw-scrollbar-thumb"><\/div>\s*<\/div>\s*<\/div>\s*<div id="terminal"><\/div>/);
  });
});
