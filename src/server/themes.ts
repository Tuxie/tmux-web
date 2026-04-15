import fs from 'fs';
import path from 'path';

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
  author?: string;
  version?: string;
  source: 'user' | 'bundled';
};

export type PackManifest = {
  author?: string;
  version?: string;
  fonts?: { file: string; family: string }[];
  themes?: { name: string; css: string; defaultFont?: string }[];
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

export function resolveTheme(name: string, packs: PackInfo[]): ThemeInfo | null {
  return listThemes(packs).find(theme => theme.name === name) ?? null;
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
  const root = path.resolve(pack.fullPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  if (!fs.existsSync(resolved)) return null;
  return { fullPath: resolved };
}
