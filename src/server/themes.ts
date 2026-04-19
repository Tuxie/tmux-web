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
  defaultBackgroundHue?: number;
  defaultBackgroundSaturation?: number;
  defaultBackgroundBrightest?: number;
  defaultBackgroundDarkest?: number;
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
  defaultBackgroundHue?: number;
  defaultBackgroundSaturation?: number;
  defaultBackgroundBrightest?: number;
  defaultBackgroundDarkest?: number;
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

/**
 * Fields carried along the inheritance chain. Identity / location
 * fields (name, css, pack, source, author, version) are never
 * inherited — every theme gets its own.
 */
const INHERITABLE_FIELDS: Array<keyof ThemeInfo> = [
  'defaultFont',
  'defaultFontSize',
  'defaultSpacing',
  'defaultColours',
  'defaultOpacity',
  'defaultTuiBgOpacity',
  'defaultTuiFgOpacity',
  'defaultTuiSaturation',
  'defaultThemeHue',
  'defaultBackgroundHue',
  'defaultBackgroundSaturation',
  'defaultBackgroundBrightest',
  'defaultBackgroundDarkest',
];

/**
 * Fold `inherited` into `own` — `own` wins wherever it has a
 * defined value, otherwise `inherited` fills in. Only the fields
 * listed in INHERITABLE_FIELDS participate.
 */
function mergeInheritable(
  inherited: Partial<ThemeInfo> | null,
  own: Partial<ThemeInfo>,
): Partial<ThemeInfo> {
  const out: Partial<ThemeInfo> = { ...own };
  if (!inherited) return out;
  for (const key of INHERITABLE_FIELDS) {
    if (out[key] === undefined && inherited[key] !== undefined) {
      (out as any)[key] = inherited[key];
    }
  }
  return out;
}

/**
 * Resolve the inheritance chain:
 *
 *   - The first theme listed in `themes/default/theme.json` is the
 *     root. Its explicit values are the floor for every other theme.
 *   - Within a non-default pack, the first theme inherits from the
 *     root; every subsequent theme inherits from the previous theme
 *     in the same pack.
 *   - Within the default pack itself, later themes inherit from the
 *     previous theme in the same pack.
 */
export function listThemes(packs: PackInfo[]): ThemeInfo[] {
  // Locate the "base" theme — first entry in the `default` pack —
  // before walking the others. Its resolved form is the fallback
  // parent for the first theme in every other pack.
  const defaultPack = packs.find(p => p.dir === 'default');
  const rawDefaultBase = defaultPack?.manifest.themes?.[0];
  const defaultBase: Partial<ThemeInfo> | null = rawDefaultBase
    ? {
        defaultFont: rawDefaultBase.defaultFont,
        defaultFontSize: rawDefaultBase.defaultFontSize,
        defaultSpacing: rawDefaultBase.defaultSpacing,
        defaultColours: rawDefaultBase.defaultColours,
        defaultOpacity: rawDefaultBase.defaultOpacity,
        defaultTuiBgOpacity: rawDefaultBase.defaultTuiBgOpacity,
        defaultTuiFgOpacity: rawDefaultBase.defaultTuiFgOpacity,
        defaultTuiSaturation: rawDefaultBase.defaultTuiSaturation,
        defaultThemeHue: rawDefaultBase.defaultThemeHue,
        defaultBackgroundHue: rawDefaultBase.defaultBackgroundHue,
        defaultBackgroundSaturation: rawDefaultBase.defaultBackgroundSaturation,
        defaultBackgroundBrightest: rawDefaultBase.defaultBackgroundBrightest,
        defaultBackgroundDarkest: rawDefaultBase.defaultBackgroundDarkest,
      }
    : null;

  const seen = new Map<string, ThemeInfo>();
  for (const pack of packs) {
    let prev: Partial<ThemeInfo> | null = null;
    for (const theme of pack.manifest.themes ?? []) {
      if (!theme.name || !theme.css) continue;
      if (seen.has(theme.name)) {
        console.warn(`[themes] duplicate theme name '${theme.name}' in pack '${pack.dir}' (${pack.source}); ignoring`);
        continue;
      }
      // Parent for inheritance: previous theme in this pack if we've
      // seen one; otherwise the default base (but not for the default
      // pack's own first entry, which IS the base).
      const parent = prev ?? (pack.dir === 'default' ? null : defaultBase);
      const own: Partial<ThemeInfo> = {
        defaultFont: theme.defaultFont,
        defaultFontSize: theme.defaultFontSize,
        defaultSpacing: theme.defaultSpacing,
        defaultColours: theme.defaultColours,
        defaultOpacity: theme.defaultOpacity,
        defaultTuiBgOpacity: theme.defaultTuiBgOpacity,
        defaultTuiFgOpacity: theme.defaultTuiFgOpacity,
        defaultTuiSaturation: theme.defaultTuiSaturation,
        defaultThemeHue: theme.defaultThemeHue,
        defaultBackgroundHue: theme.defaultBackgroundHue,
        defaultBackgroundSaturation: theme.defaultBackgroundSaturation,
        defaultBackgroundBrightest: theme.defaultBackgroundBrightest,
        defaultBackgroundDarkest: theme.defaultBackgroundDarkest,
      };
      const resolved = mergeInheritable(parent, own);
      const info: ThemeInfo = {
        name: theme.name,
        pack: pack.dir,
        css: theme.css,
        ...resolved,
        author: pack.manifest.author,
        version: pack.manifest.version,
        source: pack.source,
      };
      seen.set(theme.name, info);
      prev = resolved;
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
