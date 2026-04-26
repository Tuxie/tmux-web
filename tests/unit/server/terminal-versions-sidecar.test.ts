/**
 * Cluster 16 / F2 + F3 — docs/code-analysis/2026-04-26.
 *
 * F2: `getTerminalVersions` reads the `dist/client/xterm-version.json`
 *     sidecar emitted by `bun-build.ts`, NOT the 1.5 MB `xterm.js` bundle.
 *     The previous implementation regex-grepped the bundle on every server
 *     boot to recover a 7-char SHA the build already knew.
 *
 * F3: `materializeBundledThemes` registers a `process.on('exit')` cleanup
 *     hook. Repeated handler construction in the same process (tests
 *     re-mounting `createHttpHandler`) must not stack listeners — the
 *     prior listener is removed before the next is registered.
 */
import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpHandler } from '../../../src/server/http.ts';
import { callHandler } from './_harness/call-handler.ts';
import type { ServerConfig } from '../../../src/shared/types.ts';

function baseConfig(): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowedIps: new Set(['127.0.0.1']),
    allowedOrigins: [],
    tls: false,
    testMode: true,
    debug: false,
    tmuxBin: '/bin/true',
    tmuxConf: '',
    auth: { enabled: false },
  } as ServerConfig;
}

describe('terminal-versions sidecar (cluster 16 / F2)', () => {
  test('getTerminalVersions reflects the sidecar JSON\'s rev', async () => {
    // The repo build step writes dist/client/xterm-version.json; the
    // bun:test runner re-imports `assets-embedded.ts` which pins the
    // sidecar via `with { type: 'file' }`. Read the on-disk JSON and
    // assert the API response surfaces the same `rev`.
    const projectRoot = path.resolve(import.meta.dir, '../../..');
    const sidecarPath = path.join(projectRoot, 'dist/client/xterm-version.json');
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(typeof sidecar.rev).toBe('string');
    expect(sidecar.rev).toMatch(/^[0-9a-f]{7}$/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tv-'));
    const sessionsStorePath = path.join(tmpDir, 'sessions.json');
    fs.writeFileSync(sessionsStorePath, '{"version":1,"sessions":{}}');
    const dropRoot = path.join(tmpDir, 'drops');
    fs.mkdirSync(dropRoot, { recursive: true, mode: 0o700 });

    const handler = await createHttpHandler({
      config: baseConfig(),
      htmlTemplate: '<html></html>',
      distDir: projectRoot,
      themesUserDir: tmpDir,
      themesBundledDir: tmpDir,
      projectRoot,
      isCompiled: false,
      sessionsStorePath,
      dropStorage: { root: dropRoot, maxFilesPerSession: 20, ttlMs: 60_000, autoUnlinkOnClose: false },
      tmuxControl: {
        attachSession: async () => {},
        detachSession: () => {},
        run: async () => '',
        on: () => () => {},
        hasSession: () => false,
        close: async () => {},
      },
    });
    const r = await callHandler(handler, { method: 'GET', url: '/api/terminal-versions' });
    expect(r.status).toBe(200);
    const parsed = JSON.parse(r.body);
    expect(parsed.xterm).toBe(`xterm.js (HEAD, ${sidecar.rev})`);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('getTerminalVersions does not read the 1.5 MB xterm.js bundle', async () => {
    // The post-fix implementation reads the small JSON sidecar instead of
    // regex-scanning the bundle. Assert the bundle path is never passed to
    // fs.readFileSync during handler construction.
    const origReadFileSync = fs.readFileSync;
    const observedReads: string[] = [];
    (fs as any).readFileSync = function (p: any, ...rest: any[]) {
      if (typeof p === 'string') observedReads.push(p);
      return (origReadFileSync as any).apply(this, [p, ...rest]);
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tv-'));
    try {
      const sessionsStorePath = path.join(tmpDir, 'sessions.json');
      fs.writeFileSync(sessionsStorePath, '{"version":1,"sessions":{}}');
      const dropRoot = path.join(tmpDir, 'drops');
      fs.mkdirSync(dropRoot, { recursive: true, mode: 0o700 });

      const projectRoot = path.resolve(import.meta.dir, '../../..');
      const handler = await createHttpHandler({
        config: baseConfig(),
        htmlTemplate: '<html></html>',
        distDir: projectRoot,
        themesUserDir: tmpDir,
        themesBundledDir: tmpDir,
        projectRoot,
        isCompiled: false,
        sessionsStorePath,
        dropStorage: { root: dropRoot, maxFilesPerSession: 20, ttlMs: 60_000, autoUnlinkOnClose: false },
        tmuxControl: {
          attachSession: async () => {},
          detachSession: () => {},
          run: async () => '',
          on: () => () => {},
          hasSession: () => false,
          close: async () => {},
        },
      });
      // Drive the endpoint to make sure the cached value was actually
      // computed during construction (it is — terminalVersionsCache is
      // populated synchronously in createHttpHandler).
      const r = await callHandler(handler, { method: 'GET', url: '/api/terminal-versions' });
      expect(r.status).toBe(200);

      // No call should have referenced the xterm bundle path. Match by
      // basename so this is robust to embeddedAssets resolving the
      // sidecar through a $bunfs/.../dist/client/xterm-version.json
      // virtual path on the compiled binary.
      const readBundle = observedReads.some(
        p => path.basename(p) === 'xterm.js' && p.includes('dist/client'),
      );
      expect(readBundle).toBe(false);

      // The sidecar must have been read at least once.
      const readSidecar = observedReads.some(
        p => path.basename(p) === 'xterm-version.json',
      );
      expect(readSidecar).toBe(true);
    } finally {
      (fs as any).readFileSync = origReadFileSync;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('materializeBundledThemes exit-listener (cluster 16 / F3)', () => {
  test('repeated createHttpHandler with isCompiled does not stack process exit listeners', async () => {
    const before = process.listenerCount('exit');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-mb-'));
    try {
      const sessionsStorePath = path.join(tmpDir, 'sessions.json');
      fs.writeFileSync(sessionsStorePath, '{"version":1,"sessions":{}}');
      const dropRoot = path.join(tmpDir, 'drops');
      fs.mkdirSync(dropRoot, { recursive: true, mode: 0o700 });

      const projectRoot = path.resolve(import.meta.dir, '../../..');

      const buildOnce = () => createHttpHandler({
        config: baseConfig(),
        htmlTemplate: '<html></html>',
        distDir: projectRoot,
        themesUserDir: tmpDir,
        themesBundledDir: tmpDir,
        projectRoot,
        isCompiled: true,
        sessionsStorePath,
        dropStorage: { root: dropRoot, maxFilesPerSession: 20, ttlMs: 60_000, autoUnlinkOnClose: false },
        tmuxControl: {
          attachSession: async () => {},
          detachSession: () => {},
          run: async () => '',
          on: () => () => {},
          hasSession: () => false,
          close: async () => {},
        },
      });

      // First mount should add at most one listener.
      await buildOnce();
      const afterFirst = process.listenerCount('exit');
      expect(afterFirst).toBeLessThanOrEqual(before + 1);

      // Subsequent mounts must not increase the count — the prior listener
      // is removed before the new one registers.
      for (let i = 0; i < 5; i++) {
        await buildOnce();
      }
      const afterMany = process.listenerCount('exit');
      expect(afterMany).toBe(afterFirst);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
