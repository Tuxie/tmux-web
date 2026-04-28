import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applySettingsPatch,
  emptySettings,
  loadSettings,
  mergeSettings,
} from '../../../src/server/settings-store.js';

describe('settings-store', () => {
  test('loads known remote servers from settings.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-web-settings-'));
    const file = path.join(tmp, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      knownServers: ['dev', 'prod.example.com', 'dev', '-Jbad', '../host'],
    }));

    expect(loadSettings(file)).toEqual({
      version: 1,
      knownServers: ['dev', 'prod.example.com'],
    });
  });

  test('merges known remote servers without dropping existing entries', () => {
    expect(mergeSettings(
      { version: 1, knownServers: ['dev'] },
      { knownServers: ['prod', 'dev'] },
    )).toEqual({
      version: 1,
      knownServers: ['dev', 'prod'],
    });
  });

  test('writes settings.json atomically', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-web-settings-'));
    const file = path.join(tmp, 'nested', 'settings.json');

    await applySettingsPatch(file, { knownServers: ['dev'] });

    expect(loadSettings(file)).toEqual({ version: 1, knownServers: ['dev'] });
    expect(fs.existsSync(file + '.part')).toBe(false);
  });

  test('emptySettings returns no known remote servers', () => {
    expect(emptySettings()).toEqual({ version: 1, knownServers: [] });
  });
});
