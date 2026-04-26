import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import fs from 'fs';

/** BLAKE3 digest (hex) of a file on disk.
 *
 *  Streaming the file keeps memory bounded for large binaries — BLAKE3 is a
 *  streaming tree-hash so incremental .update() is straight-forward. When Bun
 *  grows a native `Bun.hash('blake3', …)` we can replace this module's guts
 *  without touching callers. */
export async function hashFile(filePath: string): Promise<string> {
  const hasher = blake3.create();
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hasher.update(chunk as Uint8Array);
  }
  return bytesToHex(hasher.digest());
}

/** mtime-keyed cache for `hashFile`. The OSC 52 read decision in
 *  `clipboard-policy.ts:resolvePolicy` runs on every read request; for a
 *  100 MB Claude Code-sized binary, an uncached BLAKE3 walk costs
 *  50–100 ms per request. Caching by `(path → {mtimeMs, blake3})` and
 *  invalidating on mtime mismatch amortises the cost without weakening
 *  the security model: the BLAKE3 pin's job is "binary swap revokes
 *  the grant", and a swap necessarily changes mtime (`renameat2` /
 *  `mv` /  `cp`). The stat itself is cheap (~µs).
 *
 *  Cache lifetime is process lifetime; tests can clear it via
 *  `_resetHashCache`. Cluster 15 / F8 — docs/code-analysis/2026-04-26. */
const _hashCache = new Map<string, { mtimeMs: number; blake3: string }>();

export async function hashFileCached(filePath: string): Promise<string> {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    // Stat failed — fall through to hashFile, which will throw the same
    // ENOENT/EACCES the caller already handles. We deliberately do NOT
    // serve a stale cache entry on stat failure: the file is gone, the
    // cached hash is meaningless.
    _hashCache.delete(filePath);
    return hashFile(filePath);
  }
  const cached = _hashCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.blake3;
  const fresh = await hashFile(filePath);
  _hashCache.set(filePath, { mtimeMs, blake3: fresh });
  return fresh;
}

/** Clear the hashFileCached cache. Test hook. */
export function _resetHashCache(): void {
  _hashCache.clear();
}
