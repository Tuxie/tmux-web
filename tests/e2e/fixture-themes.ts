/**
 * Stable theme/colour/font names for e2e tests.
 *
 * These values come from `tests/fixtures/themes-bundled/e2e/theme.json`.
 * The test harness boots the server with
 * `TMUX_WEB_BUNDLED_THEMES_DIR` pointing at that fixture (see
 * `playwright.config.ts` and `tests/e2e/helpers.ts`), so these names
 * are what the UI actually sees at runtime. Reference these constants
 * from e2e tests instead of hardcoding 'Default' / 'Gruvbox Dark' /
 * 'Iosevka Nerd Font Mono' — changing real bundled themes in `themes/`
 * will then leave the tests untouched.
 */
export const FX = {
  themes: {
    // The primary fixture theme is literally named "Default" so the
    // client's DEFAULT_SESSION_SETTINGS.theme = 'Default' resolves to
    // it on a clean session. Everything else about the theme (CSS,
    // fonts, colours, defaults) is test-owned and stable.
    primary: 'Default',
    primaryCss: '/themes/e2e/primary.css',
    alt: 'E2E Alt Theme',
    altCss: '/themes/e2e/alt.css',
  },
  colours: {
    a: 'E2E Red',
    b: 'E2E Blue',
    c: 'E2E Green',
  },
  fonts: {
    primary: 'E2E Primary Font',
    secondary: 'E2E Secondary Font',
  },
  /** Fixture-default `defaultTuiOpacity` on the alt theme. */
  altDefaultTuiOpacity: 70,
  altDefaultOpacity: 50,
  altDefaultFontSize: 18,
  altDefaultSpacing: 0.9,
} as const;

/** Canonical `SessionSettings` with fixture values, used in mocked storage. */
export function fixtureSessionSettings(overrides: Partial<{
  theme: string; colours: string; fontFamily: string;
  fontSize: number; spacing: number; opacity: number; tuiOpacity: number; backgroundHue: number;
}> = {}) {
  return {
    theme: FX.themes.primary,
    colours: FX.colours.a,
    fontFamily: FX.fonts.primary,
    fontSize: 18,
    spacing: 0.85,
    opacity: 0,
    tuiOpacity: 100,
    backgroundHue: 183,
    ...overrides,
  };
}
