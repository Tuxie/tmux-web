import { defineConfig } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Isolate the per-session settings store so tests never read or write the
// developer's real ~/.config/tmux-web/sessions.json. Persisted sessions
// from prior local use would otherwise leak into tests (e.g. forcing a
// non-default theme on tests that goto('/') without mockApis).
const sessionsStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-store-'));
const sessionsStoreFile = path.join(sessionsStoreDir, 'sessions.json');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    baseURL: 'http://127.0.0.1:4023',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'bun src/server/index.ts --test --listen 127.0.0.1:4023 --no-auth --no-tls',
    env: { TMUX_WEB_SESSIONS_FILE: sessionsStoreFile },
    url: 'http://127.0.0.1:4023',
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
