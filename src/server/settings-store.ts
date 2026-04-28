import fs from 'fs';
import path from 'path';
import { isValidRemoteHostAlias } from './remote-route.js';
import { serialiseFileWrite } from './sessions-store.js';

export interface ServerSettings {
  version: 1;
  knownServers: string[];
}

export interface ServerSettingsPatch {
  knownServers?: string[];
}

export function emptySettings(): ServerSettings {
  return { version: 1, knownServers: [] };
}

function sanitizeKnownServers(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== 'string') continue;
    if (!isValidRemoteHostAlias(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function loadSettings(filePath: string): ServerSettings {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptySettings();
    return {
      version: 1,
      knownServers: sanitizeKnownServers((parsed as { knownServers?: unknown }).knownServers),
    };
  } catch {
    return emptySettings();
  }
}

export function mergeSettings(current: ServerSettings, patch: ServerSettingsPatch): ServerSettings {
  const knownServers = [...current.knownServers];
  const seen = new Set(knownServers);
  for (const host of sanitizeKnownServers(patch.knownServers)) {
    if (seen.has(host)) continue;
    seen.add(host);
    knownServers.push(host);
  }
  return { version: 1, knownServers };
}

export function saveSettings(filePath: string, settings: ServerSettings): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.part';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, filePath);
}

export function applySettingsPatch(filePath: string, patch: ServerSettingsPatch): Promise<ServerSettings> {
  return serialiseFileWrite(filePath, () => {
    const current = loadSettings(filePath);
    const next = mergeSettings(current, patch);
    saveSettings(filePath, next);
    return next;
  });
}
