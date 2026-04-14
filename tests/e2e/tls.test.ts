import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import { killServer } from './helpers.js';

test.describe('TLS default', () => {
  let server: ChildProcess | undefined;

  test.afterEach(() => {
    if (server) {
      killServer(server);
      server = undefined;
    }
  });

  test('starts in HTTPS mode by default', async () => {
    await new Promise<void>((resolve, reject) => {
      // Start server with default args (will use HTTPS)
      // We use a different port to avoid conflicts
      const proc = spawn('bun', ['src/server/index.ts', '--test', '--listen=127.0.0.1:4099', '--no-auth'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });
      server = proc;

      let output = '';
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('https://127.0.0.1:4099')) {
          proc.stdout?.off('data', onData);
          proc.stderr?.off('data', onData);
          resolve();
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('error', reject);

      // Timeout if it doesn't report HTTPS
      setTimeout(() => {
        reject(new Error(`Server failed to report HTTPS. Output: ${output}`));
      }, 10000);
    });
  });

  test('starts in HTTP mode with --no-tls', async () => {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('bun', ['src/server/index.ts', '--test', '--listen=127.0.0.1:4098', '--no-auth', '--no-tls'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      });
      server = proc;

      let output = '';
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('http://127.0.0.1:4098')) {
          proc.stdout?.off('data', onData);
          proc.stderr?.off('data', onData);
          resolve();
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('error', reject);

      setTimeout(() => {
        reject(new Error(`Server failed to report HTTP. Output: ${output}`));
      }, 10000);
    });
  });
});
