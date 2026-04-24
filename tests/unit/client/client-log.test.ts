import { describe, expect, test } from 'bun:test';
import { clientLog } from '../../../src/client/client-log.ts';

describe('clientLog', () => {
  test('sends a tokenized image beacon', () => {
    const images: any[] = [];
    const originalWindow = (globalThis as any).window;
    const originalImage = (globalThis as any).Image;
    try {
      (globalThis as any).window = {
        __TMUX_WEB_CONFIG: { version: 'test', clientAuthToken: 'client-token' },
        location: { href: 'http://127.0.0.1:4022/', origin: 'http://127.0.0.1:4022' },
      };
      (globalThis as any).Image = class {
        src = '';
        constructor() { images.push(this); }
      };

      clientLog('boot-fetch:start');

      expect(images[0].src).toBe('/api/client-log?message=boot-fetch%3Astart&tw_auth=client-token');
    } finally {
      (globalThis as any).window = originalWindow;
      (globalThis as any).Image = originalImage;
    }
  });
});
