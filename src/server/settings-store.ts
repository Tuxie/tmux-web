import fs from 'fs';
import path from 'path';
import { isValidRemoteHostAlias } from './remote-route.js';
import { serialiseFileWrite } from './sessions-store.js';

export interface ServerSettings {
  version: 1;
  knownServers: string[];
  servers: RemoteServerConfig[];
}

export interface ServerSettingsPatch {
  knownServers?: string[];
  servers?: RemoteServerConfig[];
}

export type RemoteServerProtocol = 'http' | 'https' | 'ssh' | 'local';

export interface RemoteServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: RemoteServerProtocol;
  username: string;
  password?: string;
  savePassword: boolean;
  compression: boolean;
  socketName?: string;
  socketPath?: string;
}

export function emptySettings(): ServerSettings {
  return { version: 1, knownServers: [], servers: [] };
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

function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}

function sanitizeProtocol(input: unknown): RemoteServerProtocol | null {
  return input === 'http' || input === 'https' || input === 'ssh' || input === 'local' ? input : null;
}

function sanitizePort(input: unknown): number | null {
  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isInteger(value) || value < 0 || value > 65535) return null;
  return value;
}

export function sanitizeRemoteServers(input: unknown): RemoteServerConfig[] {
  if (!Array.isArray(input)) return [];
  const out: RemoteServerConfig[] = [];
  const seen = new Set<string>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const obj = value as Record<string, unknown>;
    const host = sanitizeText(obj.host, 255);
    if (!isValidRemoteHostAlias(host)) continue;
    const protocol = sanitizeProtocol(obj.protocol);
    if (!protocol) continue;
    const port = sanitizePort(obj.port);
    if (port === null) continue;
    if (protocol !== 'local' && port < 1) continue;
    const fallbackId = host;
    const id = sanitizeText(obj.id, 128) || fallbackId;
    if (!isValidRemoteHostAlias(id) || seen.has(id)) continue;
    seen.add(id);
    const savePassword = protocol === 'local' ? false : obj.savePassword === true;
    const password = savePassword ? sanitizeText(obj.password, 4096) : '';
    const server: RemoteServerConfig = {
      id,
      name: sanitizeText(obj.name, 120) || host,
      host,
      port,
      protocol,
      username: sanitizeText(obj.username, 120),
      savePassword,
      compression: protocol === 'local' ? false : obj.compression === true,
    };
    if (protocol === 'local') {
      const socketName = sanitizeText(obj.socketName, 120);
      const socketPath = sanitizeText(obj.socketPath, 4096);
      if (socketName) server.socketName = socketName;
      if (socketPath) server.socketPath = socketPath;
    }
    if (password) server.password = password;
    out.push(server);
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
      servers: sanitizeRemoteServers((parsed as { servers?: unknown }).servers),
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
  const servers = patch.servers === undefined
    ? sanitizeRemoteServers(current.servers)
    : sanitizeRemoteServers(patch.servers);
  return { version: 1, knownServers, servers };
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
