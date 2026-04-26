import { defineConfig } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';

// Isolate the per-session settings store so tests never read or write the
// developer's real ~/.config/tmux-web/sessions.json. Persisted sessions
// from prior local use would otherwise leak into tests (e.g. forcing a
// non-default theme on tests that goto('/') without mockApis).
const sessionsStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-store-'));
const sessionsStoreFile = path.join(sessionsStoreDir, 'sessions.json');

// Isolate file-drop uploads too. Without this, file-drop tests POST
// into $XDG_RUNTIME_DIR/tmux-web/drop which the developer's running
// tmux-web instance watches and surfaces in its drops panel.
const dropsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-drops-'));

// Point the test server at a stable fixture theme pack instead of the
// real bundled themes in `./themes`. Tests reference `E2E Primary Theme`
// / `E2E Alt Theme` / `E2E Red` / etc., so renaming a real bundled
// theme or tweaking its `defaultColours` no longer breaks tests that
// simply happen to boot the server.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const bundledThemesFixtureDir = path.resolve(configDir, 'tests/fixtures/themes-bundled');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    baseURL: 'http://127.0.0.1:4023',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'bun src/server/index.ts --test --listen 127.0.0.1:4023 --no-auth --no-tls',
    env: {
      TMUX_WEB_SESSIONS_FILE: sessionsStoreFile,
      TMUX_WEB_BUNDLED_THEMES_DIR: bundledThemesFixtureDir,
      TMUX_WEB_DROP_ROOT: dropsRootDir,
    },
    url: 'http://127.0.0.1:4023',
    // reuseExistingServer: false is intentional for fixture-isolation
    // (each run owns a fresh ~/.config/tmux-web/sessions.json under
    // sessionsStoreDir and a fresh themes-bundled fixture). Contributors
    // hitting EADDRINUSE on 4023 should kill stray bun servers
    // (`pkill -f 'src/server/index.ts.*4023'`) — `make dev` defaults to
    // 4022 so it shouldn't conflict.
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
