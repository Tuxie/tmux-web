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
  defaultFgContrastStrength?: number;
  defaultFgContrastBias?: number;
  defaultThemeHue?: number;
  defaultThemeSat?: number;
  defaultThemeLtn?: number;
  defaultThemeContrast?: number;
  defaultDepth?: number;
  defaultBackgroundHue?: number;
  defaultBackgroundSaturation?: number;
  defaultBackgroundBrightest?: number;
  defaultBackgroundDarkest?: number;
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
    const { recordBootError } = await import('./boot-errors.js');
    try {
      const response = await fetch('/api/themes');
      if (!response.ok) {
        recordBootError('themes', `HTTP ${response.status}`);
        cachedThemes = [];
      } else {
        cachedThemes = await response.json();
      }
    } catch (err) {
      recordBootError('themes', err);
      cachedThemes = [];
    }
  }
  return cachedThemes!;
}

export async function listFonts(): Promise<FontInfo[]> {
  if (!cachedFonts) {
    const { recordBootError } = await import('./boot-errors.js');
    try {
      const response = await fetch('/api/fonts');
      if (!response.ok) {
        recordBootError('fonts', `HTTP ${response.status}`);
        cachedFonts = [];
      } else {
        cachedFonts = await response.json();
      }
    } catch (err) {
      recordBootError('fonts', err);
      cachedFonts = [];
    }
  }
  return cachedFonts!;
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
      document.fonts.add(ff);
    } catch (error) {
      console.warn(`[theme] failed to load font ${font.family}:`, error);
    }
  }
}

export async function applyTheme(name: string): Promise<void> {
  const themes = await listThemes();
  let theme = themes.find(candidate => candidate.name === name);
  if (!theme) {
    // First try the baseline "Default" theme (bundled themes always ship
    // one); if even that is missing — e.g. a user-only deployment or an
    // isolated test pack with its own theme names — fall through to the
    // first available theme so the page still renders instead of
    // silently returning.
    theme = themes.find(candidate => candidate.name === 'Default') ?? themes[0];
    if (!theme) return;
    console.error(`[theme] theme "${name}" not found, falling back to "${theme.name}"`);
    name = theme.name;
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
