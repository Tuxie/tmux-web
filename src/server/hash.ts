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
