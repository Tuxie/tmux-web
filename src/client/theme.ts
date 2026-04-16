export type ThemeInfo = {
  name: string;
  pack: string;
  css: string;
  defaultFont?: string;
  defaultFontSize?: number;
  defaultSpacing?: number;
  defaultColours?: string;
  defaultOpacity?: number;
  author?: string;
  version?: string;
  source: 'user' | 'bundled';
};

export type FontInfo = {
  family: string;
  file: string;
  pack: string;
};


let cachedThemes: ThemeInfo[] | null = null;
let cachedFonts: FontInfo[] | null = null;
let activeTheme = 'Default';

export async function listThemes(): Promise<ThemeInfo[]> {
  if (!cachedThemes) {
    const response = await fetch('/api/themes');
    cachedThemes = response.ok ? await response.json() : [];
  }
  return cachedThemes;
}

export async function listFonts(): Promise<FontInfo[]> {
  if (!cachedFonts) {
    const response = await fetch('/api/fonts');
    cachedFonts = response.ok ? await response.json() : [];
  }
  return cachedFonts;
}

export function getActiveTheme(): string {
  return activeTheme;
}

export async function loadAllFonts(): Promise<void> {
  const fonts = await listFonts();
  for (const font of fonts) {
    try {
      const ff = new FontFace(
        font.family,
        `url(/themes/${encodeURIComponent(font.pack)}/${encodeURIComponent(font.file)})`
      );
      await ff.load();
      (document as any).fonts.add(ff);
    } catch (error) {
      console.warn(`[theme] failed to load font ${font.family}:`, error);
    }
  }
}

export async function applyTheme(name: string): Promise<void> {
  const themes = await listThemes();
  let theme = themes.find(candidate => candidate.name === name);
  if (!theme) {
    console.error(`[theme] theme "${name}" not found, falling back to Default`);
    theme = themes.find(candidate => candidate.name === 'Default');
    if (!theme) return;
    name = 'Default';
  }

  const old = document.getElementById('theme-css') as { remove(): void } | null;
  if (old) old.remove();

  const link = document.createElement('link') as HTMLLinkElement;
  link.id = 'theme-css';
  link.rel = 'stylesheet';
  link.href = `/themes/${encodeURIComponent(theme.pack)}/${encodeURIComponent(theme.css)}`;
  const loaded = new Promise<void>((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
  document.head.appendChild(link);
  activeTheme = name;
  // Wait until the stylesheet has parsed and applied so callers that read
  // computed styles (e.g. body backgroundColor for WebGL atlas blending)
  // see the new theme, not the previous one.
  await loaded;
}


export function clearCaches(): void {
  cachedThemes = null;
  cachedFonts = null;
}
