import { describe, expect, test } from 'bun:test';
import config from '../../../electrobun.config';

describe('desktop Electrobun config', () => {
  test('macOS desktop build uses GPU-backed CEF rendering for smooth gradients', () => {
    expect(config.build.mac?.bundleCEF).toBe(true);
    expect(config.build.mac?.defaultRenderer).toBe('cef');
    expect(config.build.mac?.chromiumFlags?.['disable-gpu']).toBe(false);
  });

  test('linux desktop build uses GPU-backed CEF rendering for smooth gradients', () => {
    expect(config.build.linux?.bundleCEF).toBe(true);
    expect(config.build.linux?.defaultRenderer).toBe('cef');
    expect(config.build.linux?.chromiumFlags?.['disable-gpu']).toBe(false);
  });
});
