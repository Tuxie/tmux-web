import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  use: {
    baseURL: 'http://127.0.0.1:4023',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'bun src/server/index.ts --test --terminal=ghostty --listen 127.0.0.1:4023 --no-auth --no-tls',
    url: 'http://127.0.0.1:4023',
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
