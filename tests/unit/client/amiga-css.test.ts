import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* The Amiga pack was split in 1.10.0: shared rules live in
 * `amiga-common.css` (imported by both variants), with the variant-
 * specific overrides in `amigaos31.css` and `amigascene2k.css`.
 * `--tw-ui-font-size` is the unified GUI font-size variable that
 * replaced the per-variant `--tw-amiga-gui-font-size` knob. */
const commonCss = readFileSync(resolve(import.meta.dir, '../../../themes/amiga/amiga-common.css'), 'utf-8');
const os31Css = readFileSync(resolve(import.meta.dir, '../../../themes/amiga/amigaos31.css'), 'utf-8');
const sceneCss = readFileSync(resolve(import.meta.dir, '../../../themes/amiga/amigascene2k.css'), 'utf-8');

describe('Amiga theme CSS', () => {
  test('common stylesheet defines the unified GUI font-size variable', () => {
    expect(commonCss).toMatch(/--tw-ui-font-size:\s*17px/);
    expect(commonCss).toContain('font-size: var(--tw-ui-font-size);');
  });

  test('both variants @import amiga-common.css', () => {
    expect(os31Css).toContain("@import url('amiga-common.css');");
    expect(sceneCss).toContain("@import url('amiga-common.css');");
  });

  test('variant stylesheets do not redefine the GUI font-size variable', () => {
    /* The variant files are overrides on top of the shared baseline;
     * resetting `--tw-ui-font-size` in either would silently break
     * the 1.10.0 typography unification. */
    expect(os31Css).not.toMatch(/--tw-ui-font-size:/);
    expect(sceneCss).not.toMatch(/--tw-ui-font-size:/);
  });

  test('Scene 2000 uses a brighter muted resize handle triangle', () => {
    expect(commonCss).toMatch(/\.tw-scrollbar-resize::after\s*\{[^}]*background:\s*#fff;/s);
    expect(sceneCss).toMatch(/\.tw-scrollbar-resize::after\s*\{[^}]*background:\s*hsl\(var\(--tw-theme-hue,\s*222\)\s*15%\s*calc\(42%\s*\*\s*1\.2\)\);/s);
  });

  test('inactive window tabs use the same raised bevel as topbar buttons', () => {
    const raisedBevel = /border-color:\s*var\(--tw-bevel-hi\)\s+var\(--tw-bevel-lo\)\s+var\(--tw-bevel-lo\)\s+var\(--tw-bevel-hi\);/;
    expect(commonCss).toMatch(new RegExp(`#topbar \\.tw-win-tab:not\\(\\.active\\)\\s*\\{[^}]*${raisedBevel.source}`, 's'));
  });
});
