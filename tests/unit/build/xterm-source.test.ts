import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  ensureVendorXtermBuild,
  resolveVendoredXtermBundle,
} from '../../../src/build/xterm-source.js';

const projectRoot = path.resolve(import.meta.dir, '../../..');

describe('resolveVendoredXtermBundle', () => {
  it('uses the vendored xterm package artifacts built by xterm itself', async () => {
    await ensureVendorXtermBuild(projectRoot);

    const result = await resolveVendoredXtermBundle(projectRoot);

    expect(result.xtermEntry.endsWith('vendor/xterm.js/lib/xterm.mjs')).toBe(true);
    expect(result.fitEntry.endsWith('vendor/xterm.js/addons/addon-fit/lib/addon-fit.mjs')).toBe(true);
    expect(result.cssPath.endsWith('vendor/xterm.js/css/xterm.css')).toBe(true);
  });
});
