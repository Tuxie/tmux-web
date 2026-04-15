export type ThemeInfo = {
  name: string;
  pack: string;
  css: string;
  defaultFont?: string;
  author?: string;
  version?: string;
  source: 'user' | 'bundled';
};

export type FontInfo = {
  family: string;
  file: string;
  pack: string;
};

export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
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
  document.head.appendChild(link);
  activeTheme = name;
}

export function readBorderInsets(): Insets {
  const styles = getComputedStyle(document.documentElement);
  const px = (key: string) => parseFloat(styles.getPropertyValue(key)) || 0;
  return {
    top: px('--tw-border-top'),
    right: px('--tw-border-right'),
    bottom: px('--tw-border-bottom'),
    left: px('--tw-border-left'),
  };
}

export function clearCaches(): void {
  cachedThemes = null;
  cachedFonts = null;
}
