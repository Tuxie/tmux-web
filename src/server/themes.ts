import fs from 'fs';
import path from 'path';
import { alacrittyTomlToITheme, type ITheme } from './colours.js';

export type FontInfo = {
  family: string;
  file: string;
  pack: string;
  packDir: string;
};

export type ThemeInfo = {
  name: string;
  pack: string;
  css: string;
  defaultFont?: string;
  defaultFontSize?: number;
  defaultSpacing?: number;
  defaultColours?: string;
  defaultOpacity?: number;
  defaultTuiBgOpacity?: number;
  defaultTuiFgOpacity?: number;
  defaultTuiSaturation?: number;
  defaultThemeHue?: number;
  author?: string;
  version?: string;
  source: 'user' | 'bundled';
};

export type ColourInfo = {
  name: string;
  variant?: 'dark' | 'light';
  pack: string;
  source: 'user' | 'bundled';
  theme: ITheme;
};

export type PackManifest = {
  author?: string;
  version?: string;
  fonts?: { file: string; family: string }[];
  colours?: { file: string; name: string; variant?: 'dark' | 'light' }[];
  themes?: {
    name: string; css: string;
    defaultFont?: string;
    defaultFontSize?: number;
    defaultSpacing?: number;
    defaultColours?: string;
    defaultOpacity?: number;
    defaultTuiBgOpacity?: number;
  defaultTuiFgOpacity?: number;
  defaultTuiSaturation?: number;
  defaultThemeHue?: number;
  }[];
};

export type PackInfo = {
  dir: string;
  fullPath: string;
  source: 'user' | 'bundled';
  manifest: PackManifest;
};

function readManifest(packPath: string): PackManifest | null {
  const file = path.join(packPath, 'theme.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const manifest = JSON.parse(raw);
    if (typeof manifest !== 'object' || manifest === null) return null;
    return manifest as PackManifest;
  } catch {
    return null;
  }
}

function scanDir(dir: string, source: 'user' | 'bundled'): PackInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: PackInfo[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const manifest = readManifest(full);
    if (!manifest) {
      console.warn(`[themes] skipping pack '${entry}' in ${dir}: invalid theme.json`);
      continue;
    }
    out.push({ dir: entry, fullPath: full, source, manifest });
  }
  return out;
}

export function listPacks(userDir: string | null, bundledDir: string | null): PackInfo[] {
  const user = userDir ? scanDir(userDir, 'user') : [];
  const bundled = bundledDir ? scanDir(bundledDir, 'bundled') : [];
  return [...user, ...bundled];
}

export function listThemes(packs: PackInfo[]): ThemeInfo[] {
  const seen = new Map<string, ThemeInfo>();
  for (const pack of packs) {
    for (const theme of pack.manifest.themes ?? []) {
      if (!theme.name || !theme.css) continue;
      if (seen.has(theme.name)) {
        console.warn(`[themes] duplicate theme name '${theme.name}' in pack '${pack.dir}' (${pack.source}); ignoring`);
        continue;
      }
      seen.set(theme.name, {
        name: theme.name,
        pack: pack.dir,
        css: theme.css,
        defaultFont: theme.defaultFont,
        defaultFontSize: theme.defaultFontSize,
        defaultSpacing: theme.defaultSpacing,
        defaultColours: theme.defaultColours,
        defaultOpacity: theme.defaultOpacity,
        defaultTuiBgOpacity: theme.defaultTuiBgOpacity,
        defaultTuiFgOpacity: theme.defaultTuiFgOpacity,
        defaultTuiSaturation: theme.defaultTuiSaturation,
        defaultThemeHue: theme.defaultThemeHue,
        author: pack.manifest.author,
        version: pack.manifest.version,
        source: pack.source,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function listFonts(packs: PackInfo[]): FontInfo[] {
  const seen = new Map<string, FontInfo>();
  for (const pack of packs) {
    for (const font of pack.manifest.fonts ?? []) {
      if (!font.family || !font.file) continue;
      if (seen.has(font.family)) continue;
      seen.set(font.family, {
        family: font.family,
        file: font.file,
        pack: pack.dir,
        packDir: pack.fullPath,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.family.localeCompare(b.family));
}

export function listColours(packs: PackInfo[]): ColourInfo[] {
  const seen = new Map<string, ColourInfo>();
  for (const pack of packs) {
    for (const entry of pack.manifest.colours ?? []) {
      if (!entry.name || !entry.file) continue;
      if (!isValidPackRelPath(entry.file)) {
        console.warn(`[themes] pack '${pack.dir}': colour '${entry.name}' has invalid file path '${entry.file}'`);
        continue;
      }
      if (seen.has(entry.name)) {
        console.warn(`[themes] duplicate colour name '${entry.name}' in pack '${pack.dir}' (${pack.source}); overwriting`);
      }
      const fullPath = path.join(pack.fullPath, entry.file);
      let theme: ITheme;
      try {
        const src = fs.readFileSync(fullPath, 'utf8');
        theme = alacrittyTomlToITheme(src);
      } catch (e) {
        console.warn(`[themes] pack '${pack.dir}': failed to parse colour '${entry.name}' from '${entry.file}': ${e}`);
        continue;
      }
      seen.set(entry.name, {
        name: entry.name,
        variant: entry.variant,
        pack: pack.dir,
        source: pack.source,
        theme,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findPack(packDir: string, packs: PackInfo[]): PackInfo | null {
  return packs.find(pack => pack.dir === packDir) ?? null;
}

export function isValidPackRelPath(rel: string): boolean {
  if (!rel) return false;
  if (rel.startsWith('/') || rel.startsWith('\\')) return false;
  if (rel.includes('\\')) return false;
  const segments = rel.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return false;
    if (seg.startsWith('.')) return false;
  }
  return true;
}

export function readPackFile(packDir: string, file: string, packs: PackInfo[]): { fullPath: string } | null {
  if (!isValidPackRelPath(file)) return null;
  const pack = findPack(packDir, packs);
  if (!pack) return null;
  const fullPath = path.join(pack.fullPath, file);
  const resolved = path.resolve(fullPath);
  // Use realpathSync to resolve symlinks and prevent symlink-escape attacks.
  // realpathSync throws if the path does not exist; treat that as not-found.
  let realResolved: string;
  let realRoot: string;
  try {
    realResolved = fs.realpathSync(resolved);
    realRoot = fs.realpathSync(pack.fullPath);
  } catch {
    return null;
  }
  if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) return null;
  // Containment is checked against the realpath-resolved form, but the
  // returned path is the non-realpath'd `resolved` so callers see the
  // same string shape they passed in (e.g. /var/... on macOS instead of
  // the /private/var/... canonical form realpathSync returns).
  return { fullPath: resolved };
}
