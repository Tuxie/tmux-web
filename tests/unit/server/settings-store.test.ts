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
      servers: [],
    });
  });

  test('loads structured remote servers and strips unsaved passwords', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-web-settings-'));
    const file = path.join(tmp, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      servers: [
        {
          id: 'dev',
          name: 'Dev Box',
          host: 'dev.example.com',
          port: 22,
          protocol: 'ssh',
          username: 'per',
          password: 'secret',
          savePassword: true,
          compression: true,
        },
        {
          id: 'nosave',
          name: 'No Save',
          host: 'nosave.example.com',
          port: 443,
          protocol: 'https',
          username: 'per',
          password: 'discard-me',
          savePassword: false,
          compression: false,
        },
        {
          id: 'bad',
          name: 'Bad',
          host: '../host',
          port: 22,
          protocol: 'ssh',
          username: 'per',
        },
        {
          id: 'local',
          name: 'Local',
          host: 'local',
          port: 0,
          protocol: 'local',
          username: 'per',
          savePassword: false,
          compression: true,
          socketName: 'work',
          socketPath: '/tmp/tmux-web.sock',
        },
      ],
    }));

    expect(loadSettings(file)).toEqual({
      version: 1,
      knownServers: [],
      servers: [
        {
          id: 'dev',
          name: 'Dev Box',
          host: 'dev.example.com',
          port: 22,
          protocol: 'ssh',
          username: 'per',
          password: 'secret',
          savePassword: true,
          compression: true,
        },
        {
          id: 'nosave',
          name: 'No Save',
          host: 'nosave.example.com',
          port: 443,
          protocol: 'https',
          username: 'per',
          savePassword: false,
          compression: false,
        },
        {
          id: 'local',
          name: 'Local',
          host: 'local',
          port: 0,
          protocol: 'local',
          username: 'per',
          savePassword: false,
          compression: false,
          socketName: 'work',
          socketPath: '/tmp/tmux-web.sock',
        },
      ],
    });
  });

  test('merges known remote servers without dropping existing entries', () => {
    expect(mergeSettings(
      { version: 1, knownServers: ['dev'] },
      { knownServers: ['prod', 'dev'] },
    )).toEqual({
      version: 1,
      knownServers: ['dev', 'prod'],
      servers: [],
    });
  });

  test('servers patch replaces structured server list', () => {
    expect(mergeSettings(
      {
        version: 1,
        knownServers: ['legacy'],
        servers: [{
          id: 'old',
          name: 'Old',
          host: 'old.example.com',
          port: 22,
          protocol: 'ssh',
          username: '',
          savePassword: false,
          compression: false,
        }],
      },
      {
        servers: [{
          id: 'new',
          name: 'New',
          host: 'new.example.com',
          port: 4022,
          protocol: 'http',
          username: 'per',
          password: 'do-not-save',
          savePassword: false,
          compression: true,
        }],
      },
    )).toEqual({
      version: 1,
      knownServers: ['legacy'],
      servers: [{
        id: 'new',
        name: 'New',
        host: 'new.example.com',
        port: 4022,
        protocol: 'http',
        username: 'per',
        savePassword: false,
        compression: true,
      }],
    });
  });

  test('writes settings.json atomically', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-web-settings-'));
    const file = path.join(tmp, 'nested', 'settings.json');

    await applySettingsPatch(file, { knownServers: ['dev'] });

    expect(loadSettings(file)).toEqual({ version: 1, knownServers: ['dev'], servers: [] });
    expect(fs.existsSync(file + '.part')).toBe(false);
  });

  test('emptySettings returns no known remote servers', () => {
    expect(emptySettings()).toEqual({ version: 1, knownServers: [], servers: [] });
  });
});
