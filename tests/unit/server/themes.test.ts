import { describe, expect, test } from 'bun:test';
import path from 'path';
import {
  listPacks,
  listThemes,
  listFonts,
  resolveTheme,
  readPackFile,
} from '../../../src/server/themes';

const FIX = path.resolve(import.meta.dir, '../../fixtures/themes');

describe('themes module', () => {
  test('listPacks finds valid packs and skips malformed', () => {
    const packs = listPacks(FIX, null);
    const names = packs.map(p => p.dir).sort();
    expect(names).toContain('font-only');
    expect(names).toContain('multi');
    expect(names).not.toContain('malformed');
  });

  test('listThemes flattens variants across packs, font-only contributes none', () => {
    const packs = listPacks(FIX, null);
    const themes = listThemes(packs).map(t => t.name).sort();
    expect(themes).toEqual(['Foo Brown', 'Foo Green']);
  });

  test('listFonts dedupes by family across packs', () => {
    const packs = listPacks(FIX, null);
    const families = listFonts(packs).map(f => f.family).sort();
    expect(families).toEqual(['FontOnly', 'Shared']);
  });

  test('resolveTheme returns the correct pack and css', () => {
    const packs = listPacks(FIX, null);
    const t = resolveTheme('Foo Brown', packs);
    expect(t).not.toBeNull();
    expect(t!.pack).toBe('multi');
    expect(t!.css).toBe('brown.css');
    expect(t!.defaultFont).toBe('Shared');
  });

  test('resolveTheme returns null for unknown name', () => {
    const packs = listPacks(FIX, null);
    expect(resolveTheme('Nope', packs)).toBeNull();
  });

  test('user dir wins over bundled on name collision', () => {
    const userDir = path.join(FIX, '__user_override');
    const packs = listPacks(userDir, FIX);
    const t = resolveTheme('Foo Brown', packs);
    expect(t).not.toBeNull();
    expect(t!.source).toBe('user');
  });

  test('readPackFile rejects path traversal', () => {
    const packs = listPacks(FIX, null);
    expect(readPackFile('multi', '../malformed/theme.json', packs)).toBeNull();
    expect(readPackFile('multi', 'sub/file', packs)).toBeNull();
    expect(readPackFile('multi', '.hidden', packs)).toBeNull();
    expect(readPackFile('multi', 'brown.css', packs)).not.toBeNull();
  });
});
