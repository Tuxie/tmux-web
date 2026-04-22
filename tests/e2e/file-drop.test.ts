/**
 * E2E tests for the file-drop server pipeline.
 *
 * Tests what is testable at the server layer without a real browser
 * drag-and-drop or a real tmux session. Uses --test mode so the PTY is
 * `cat` and the IP/Origin allowlists do not apply.
 *
 * Port: 4115 (see PORTS.md)
 */
import { test, expect } from '@playwright/test';
import type { ChildProcess } from 'child_process';
import { startServer, killServer } from './helpers.js';

const PORT = 4115;
let server: ChildProcess | undefined;

test.beforeAll(async () => {
  server = await startServer('bun', [
    'src/server/index.ts',
    '--test',
    `--listen=127.0.0.1:${PORT}`,
    '--no-auth',
    '--no-tls',
  ]);
});

test.afterAll(() => {
  killServer(server);
  server = undefined;
});

test.describe('file-drop upload pipeline', () => {
  test('POST /api/drop returns 200 with path and filename', async ({ request }) => {
    const content = Buffer.from('hello drop world');
    const res = await request.post(`http://127.0.0.1:${PORT}/api/drop?session=main`, {
      data: content,
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': encodeURIComponent('test-drop.txt'),
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.path).toBe('string');
    expect(typeof body.filename).toBe('string');
    expect(body.size).toBe(content.length);
  });

  test('GET /api/drops lists uploaded file', async ({ request }) => {
    // Upload a file first
    const content = Buffer.from('file for listing');
    const uploadRes = await request.post(`http://127.0.0.1:${PORT}/api/drop?session=main`, {
      data: content,
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': encodeURIComponent('listed-file.txt'),
      },
      failOnStatusCode: false,
    });
    expect(uploadRes.status()).toBe(200);
    const uploaded = await uploadRes.json();

    // List drops and verify the uploaded file appears. `/api/drops`
    // intentionally omits `absolutePath` (cluster 06 hardening) — match
    // by filename + size instead.
    const listRes = await request.get(`http://127.0.0.1:${PORT}/api/drops`, {
      failOnStatusCode: false,
    });
    expect(listRes.status()).toBe(200);
    const { drops } = await listRes.json();
    expect(Array.isArray(drops)).toBe(true);
    const found = drops.some(
      (d: { filename?: string; size?: number }) =>
        d.filename === uploaded.filename && d.size === uploaded.size,
    );
    expect(found).toBe(true);
  });

  test('DELETE /api/drops?id= removes the drop', async ({ request }) => {
    // Upload a file to delete
    const content = Buffer.from('file to delete');
    const uploadRes = await request.post(`http://127.0.0.1:${PORT}/api/drop?session=main`, {
      data: content,
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': encodeURIComponent('delete-me.txt'),
      },
      failOnStatusCode: false,
    });
    expect(uploadRes.status()).toBe(200);
    const uploaded = await uploadRes.json();

    // Get the dropId from the listing. `/api/drops` omits `absolutePath`
    // (cluster 06 hardening); match by filename + size.
    const listRes = await request.get(`http://127.0.0.1:${PORT}/api/drops`, {
      failOnStatusCode: false,
    });
    const { drops } = await listRes.json();
    const drop = drops.find(
      (d: { filename?: string; size?: number }) =>
        d.filename === uploaded.filename && d.size === uploaded.size,
    );
    expect(drop).toBeTruthy();

    // Delete it
    const delRes = await request.delete(
      `http://127.0.0.1:${PORT}/api/drops?id=${encodeURIComponent(drop.dropId)}`,
      { failOnStatusCode: false },
    );
    expect(delRes.status()).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.deleted).toBe(true);

    // Confirm it's gone from the listing
    const listRes2 = await request.get(`http://127.0.0.1:${PORT}/api/drops`, {
      failOnStatusCode: false,
    });
    const { drops: drops2 } = await listRes2.json();
    const stillThere = drops2.some(
      (d: { filename?: string; size?: number }) =>
        d.filename === uploaded.filename && d.size === uploaded.size,
    );
    expect(stillThere).toBe(false);
  });
});
