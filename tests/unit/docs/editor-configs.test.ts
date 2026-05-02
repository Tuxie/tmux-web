import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const DOCS = readFileSync('docs/editors.md', 'utf8');
const CLIPBOARD_MATRIX = readFileSync('tests/e2e/clipboard-matrix.test.ts', 'utf8');

const EXPECTED_CONFIGS = [
  { name: 'Vim', constant: 'VIM_INIT', fence: 'vim' },
  { name: 'Emacs', constant: 'EMACS_INIT', fence: 'elisp' },
  { name: 'Helix', constant: 'HELIX_CONFIG', fence: 'toml' },
  { name: 'Kakoune', constant: 'KAKOUNE_CONFIG', fence: 'kak' },
  { name: 'Neovim', constant: 'NVIM_INIT', fence: 'lua' },
] as const;

function sectionForHeading(markdown: string, heading: string): string {
  const headingMarker = `## ${heading}`;
  const start = markdown.indexOf(headingMarker);
  expect(start, `missing ${headingMarker}`).toBeGreaterThanOrEqual(0);

  const next = markdown.indexOf('\n## ', start + headingMarker.length);
  return markdown.slice(start, next === -1 ? undefined : next);
}

function fencedBlock(markdown: string, heading: string, fence: string): string {
  const section = sectionForHeading(markdown, heading);
  const match = section.match(new RegExp('```' + fence + '\\n([\\s\\S]*?)\\n```'));
  expect(match, `missing ${fence} block under ${heading}`).not.toBeNull();
  return `${match![1]}\n`;
}

function matrixTemplateConstant(source: string, constant: string): string {
  const match = source.match(new RegExp(`const ${constant} = \`([\\s\\S]*?)\`;`));
  expect(match, `missing ${constant}`).not.toBeNull();
  expect(match![1], `${constant} must not use template interpolation`).not.toMatch(/(?<!\\)\$\{/);

  return Function(`"use strict"; return \`${match![1]}\`;`)();
}

test('clipboard matrix editor configs are byte-for-byte identical to docs/editors.md', () => {
  for (const config of EXPECTED_CONFIGS) {
    expect(matrixTemplateConstant(CLIPBOARD_MATRIX, config.constant), config.name)
      .toBe(fencedBlock(DOCS, config.name, config.fence));
  }
});
