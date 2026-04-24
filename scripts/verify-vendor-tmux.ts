#!/usr/bin/env bun
/**
 * Post-compile verification: the compiled tmux-web binary MUST contain
 * the vendored static tmux (built by `make vendor-tmux` and embedded by
 * `scripts/generate-assets.ts`). Without it the binary silently falls
 * back to system tmux at runtime, defeating the "self-contained release"
 * goal.
 *
 * The check works by:
 *   1. running the binary's `tmux` passthrough subcommand
 *      (`tmux-web tmux -V`) with PATH cleared so the system tmux fallback
 *      cannot satisfy the request;
 *   2. asserting the subprocess exits 0 and prints a `tmux <version>`
 *      line — proving an embedded tmux was extracted and invoked.
 *
 * Run locally via `bun scripts/verify-vendor-tmux.ts ./tmux-web` or, in
 * CI, by the release workflow after `bun build --compile ...`.
 *
 * Exits non-zero on any mismatch so the release is blocked.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const binary = path.resolve(process.argv[2] ?? "./tmux-web");

console.log(`verify-vendor-tmux: running ${binary} tmux -V with empty PATH`);

const env = { ...process.env, PATH: "" };
const result = spawnSync(binary, ["tmux", "-V"], { env, encoding: "utf8" });

if (result.error) {
  console.error(`verify-vendor-tmux: spawn failed: ${result.error.message}`);
  process.exit(2);
}
if (result.status !== 0) {
  console.error(`verify-vendor-tmux: FAIL — exit ${result.status}.`);
  console.error(`  stdout: ${result.stdout?.trim() || "(empty)"}`);
  console.error(`  stderr: ${result.stderr?.trim() || "(empty)"}`);
  console.error(`  This means no embedded tmux was bundled — the binary fell through to PATH lookup, which we cleared.`);
  console.error(`  Fix: ensure release.yml runs \`make vendor-tmux\` before \`scripts/generate-assets.ts\`.`);
  process.exit(1);
}
const out = (result.stdout ?? "").trim();
if (!/^tmux\s+\S+/i.test(out)) {
  console.error(`verify-vendor-tmux: FAIL — unexpected output: ${out}`);
  process.exit(1);
}
console.log(`verify-vendor-tmux: OK — embedded tmux reports: ${out}`);
process.exit(0);
