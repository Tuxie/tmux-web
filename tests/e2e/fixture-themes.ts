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
    /**
     * Third fixture theme: a gradient-body theme (body.css is
     * `radial-gradient(...)` so `getComputedStyle(body).backgroundColor`
     * returns `rgba(0,0,0,0)`). Its CSS also sets `--tw-antialias-bg` on
     * :root so the client can pick it up for glyph-halo AA.
     */
    gradient: 'E2E Gradient Body',
    gradientCss: '/themes/e2e/gradient.css',
    gradientHaloBgRgb: [20, 40, 20] as const, // must match --tw-antialias-bg in gradient.css
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
  /** Fixture-default `defaultTuiBgOpacity` on the alt theme. */
  altDefaultTuiBgOpacity: 70,
  altDefaultTuiFgOpacity: 80,
  altDefaultOpacity: 50,
  altDefaultFontSize: 18,
  altDefaultSpacing: 0.9,
} as const;

/** Canonical `SessionSettings` with fixture values, used in mocked storage. */
export function fixtureSessionSettings(overrides: Partial<{
  theme: string; colours: string; fontFamily: string;
  fontSize: number; spacing: number; opacity: number;
  tuiBgOpacity: number; tuiFgOpacity: number;
  fgContrastStrength: number; fgContrastBias: number;
  tuiSaturation: number;
  backgroundHue: number;
  themeHue: number;
}> = {}) {
  return {
    theme: FX.themes.primary,
    colours: FX.colours.a,
    fontFamily: FX.fonts.primary,
    fontSize: 18,
    spacing: 0.85,
    opacity: 0,
    tuiBgOpacity: 100,
    tuiFgOpacity: 100,
    fgContrastStrength: 0,
    fgContrastBias: 0,
    tuiSaturation: 0,
    backgroundHue: 183,
    themeHue: 222,
    ...overrides,
  };
}
