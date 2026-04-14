#!/usr/bin/env bun
/**
 * Post-compile verification: the compiled tmux-web binary MUST serve a
 * xterm.js bundle built from vendor/xterm.js (git submodule HEAD), NEVER
 * from the npm @xterm/xterm package.
 *
 * This has regressed multiple times. The check works by:
 *   1. reading the vendor submodule HEAD SHA at verify time
 *   2. starting the compiled binary on a random localhost port (--test
 *      mode, no auth, no TLS) — embedded assets are served from the binary
 *   3. fetching /dist/client/xterm.js from the running binary
 *   4. asserting it contains the sentinel line appended by bun-build.ts:
 *        `tmux-web: vendor xterm.js rev <SHA>`
 *      with SHA matching the submodule HEAD.
 *
 * Run locally via `bun scripts/verify-vendor-xterm.ts ./tmux-web` or, in
 * CI, by the release workflow after `bun build --compile ...`.
 *
 * Exits non-zero on any mismatch so the release is blocked.
 */
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import path from "node:path";

const binary = path.resolve(process.argv[2] ?? "./tmux-web");
const port = 14099 + Math.floor(Math.random() * 1000);

const rev = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: path.resolve(import.meta.dir, "..", "vendor/xterm.js"),
  encoding: "utf8",
}).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(rev)) {
  console.error(`verify-vendor-xterm: could not read vendor/xterm.js HEAD (got "${rev}")`);
  process.exit(2);
}

console.log(`verify-vendor-xterm: expected vendor rev ${rev}`);
console.log(`verify-vendor-xterm: starting ${binary} on 127.0.0.1:${port}`);

const proc = spawn(
  binary,
  ["--test", "--listen", `127.0.0.1:${port}`, "--no-auth", "--no-tls"],
  { stdio: ["ignore", "inherit", "inherit"] }
);

const cleanup = () => { try { proc.kill("SIGTERM"); } catch {} };
process.on("exit", cleanup);

async function waitFor(url: string, timeoutMs: number): Promise<Response> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${url}`);
}

try {
  const res = await waitFor(`http://127.0.0.1:${port}/dist/client/xterm.js`, 10_000);
  const body = await res.text();
  const expected = `tmux-web: vendor xterm.js rev ${rev}`;
  if (!body.includes(expected)) {
    console.error(`verify-vendor-xterm: FAIL — served xterm.js does NOT contain "${expected}".`);
    console.error(`  This means the compiled binary is serving the npm @xterm/xterm bundle, not vendor/xterm.js.`);
    console.error(`  Fix bun-build.ts / Makefile / release.yml so vendor/xterm.js is bundled.`);
    cleanup();
    process.exit(1);
  }
  console.log(`verify-vendor-xterm: OK — served xterm.js contains vendor rev ${rev}`);
} catch (e) {
  console.error(`verify-vendor-xterm: ${(e as Error).message}`);
  cleanup();
  process.exit(3);
}

cleanup();
process.exit(0);
