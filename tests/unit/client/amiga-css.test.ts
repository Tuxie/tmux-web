import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const amigaCss = readFileSync(resolve(import.meta.dir, '../../../themes/amiga/amiga.css'), 'utf-8');
const sceneCss = readFileSync(resolve(import.meta.dir, '../../../themes/amiga/scene.css'), 'utf-8');

describe('Amiga theme CSS', () => {
  test('AmigaOS 3.1 uses an 18.5px GUI font size without changing Scene 2000', () => {
    expect(amigaCss).toContain('--tw-amiga-gui-font-size: 18.5px;');
    expect(amigaCss).toContain('font-size: var(--tw-amiga-gui-font-size);');
    expect(sceneCss).not.toContain('--tw-amiga-gui-font-size');
  });
});
