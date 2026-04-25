import { composeBgColor, composeTheme, type ITheme } from './colours.js';
import type { SessionSettings } from './session-settings.js';

export interface ColourInfo {
  name: string;
  variant?: string;
  theme: ITheme;
}

interface ColourControlsRuntime {
  page: HTMLElement;
  setTheme: (theme: ITheme) => void;
  getBodyBg: () => string;
  send: (data: string) => void;
}

type ColourSettings = Pick<SessionSettings, 'colours' | 'opacity'>;

const DEFAULT_THEME: ITheme = { foreground: '#d4d4d4', background: '#1e1e1e' };

export function createColourControls(colours: ColourInfo[], runtime: ColourControlsRuntime) {
  const colourByName = new Map(colours.map(c => [c.name, c.theme] as const));
  const variantByName = new Map(colours.map(c => [c.name, c.variant] as const));

  const themeFor = (name: string): ITheme => colourByName.get(name) ?? DEFAULT_THEME;
  const pageBgFor = (settings: ColourSettings): string =>
    composeBgColor(themeFor(settings.colours), settings.opacity);
  const terminalThemeFor = (settings: ColourSettings): ITheme =>
    composeTheme(themeFor(settings.colours), settings.opacity, runtime.getBodyBg());

  return {
    themeFor,
    pageBgFor,
    terminalThemeFor,
    apply(settings: ColourSettings): void {
      runtime.page.style.setProperty('--tw-page-bg', pageBgFor(settings));
      runtime.setTheme(terminalThemeFor(settings));
    },
    sendVariant(colourName: string): void {
      const variant = variantByName.get(colourName);
      if (variant === 'dark' || variant === 'light') {
        runtime.send(JSON.stringify({ type: 'colour-variant', variant }));
      }
    },
  };
}
