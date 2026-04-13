import { LOCALHOST_IPS } from '../shared/constants.js';

export function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

export function isAllowed(remoteIp: string, allowedIps: Set<string>): boolean {
  if (LOCALHOST_IPS.has(remoteIp)) return true;
  const normalized = normalizeIp(remoteIp);
  if (LOCALHOST_IPS.has(normalized)) return true;
  if (allowedIps.has(remoteIp)) return true;
  if (allowedIps.has(normalized)) return true;
  return false;
}
