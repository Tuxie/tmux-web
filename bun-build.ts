import { build, type BuildOptions, type BunPlugin } from "bun";
import fs from "node:fs";
import path from "node:path";
import { watch } from "node:fs";

const isWatch = Bun.argv.includes("--watch");

const commonOpts: BuildOptions = {
  entrypoints: ["src/client/index.ts"],
  root: "src",
  target: "browser",
  outdir: "dist/client",
  sourcemap: "external",
  minify: !isWatch,
  external: ["/dist/ghostty-web.js"],
};

/**
 * Build vendor/xterm.js bundles using bun from the vendor directory.
 * xterm.js uses legacy TypeScript parameter decorators for its DI system.
 * Without experimentalDecorators bun applies TC39 stage-3 transforms that
 * call decorators with (target, context) instead of (target, key, descriptor),
 * causing a runtime crash: "Cannot read properties of undefined (reading 'value')".
 *
 * bun does NOT follow tsconfig "extends", so vendor's per-dir tsconfigs (which
 * inherit experimentalDecorators via tsconfig-library-base) lose the flag.
 * Patch each per-dir tsconfig bun actually reads to inline the flag.
 */
function buildVendorXterm(vendorDir: string): void {
  const patchTargets = [
    "src/browser/tsconfig.json",
    "src/common/tsconfig.json",
    "src/headless/tsconfig.json",
  ];
  for (const rel of patchTargets) {
    const p = path.join(vendorDir, rel);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf8");
    if (raw.includes('"experimentalDecorators"')) continue;
    // Textual insert (not JSON.parse) because tsconfigs contain JSONC comments
    // and path strings like "common/*" that break naive comment stripping.
    const patched = raw.replace(
      /"compilerOptions"\s*:\s*\{/,
      '"compilerOptions": {\n    "experimentalDecorators": true,'
    );
    if (patched === raw) throw new Error(`failed to patch ${p}`);
    fs.writeFileSync(p, patched);
  }

  const buildEntry = (entry: string, outdir: string, name: string) => {
    const result = Bun.spawnSync(
      ["bun", "build", entry, "--outdir", outdir, "--minify", "--target", "browser", "--entry-naming", name],
      { cwd: vendorDir, stdio: ["ignore", "inherit", "inherit"] }
    );
    if (result.exitCode !== 0) {
      throw new Error(`vendor xterm build failed: ${entry}`);
    }
  };

  buildEntry(
    "src/browser/public/Terminal.ts",
    "lib",
    "xterm.mjs"
  );
  buildEntry(
    "addons/addon-fit/src/FitAddon.ts",
    "addons/addon-fit/lib",
    "addon-fit.mjs"
  );
}

async function buildClient() {
  const configs = [
    { name: "ghostty", outfile: "ghostty.js" },
  ];

  const vendorXtermDir = path.join(import.meta.dir, "vendor/xterm.js");
  const vendorXtermEntry = path.join(vendorXtermDir, "src/browser/public/Terminal.ts");
  const vendorXtermMjs = path.join(vendorXtermDir, "lib/xterm.mjs");
  const vendorFitMjs = path.join(vendorXtermDir, "addons/addon-fit/lib/addon-fit.mjs");
  const hasVendorSrc = fs.existsSync(vendorXtermEntry);

  if (!hasVendorSrc) {
    throw new Error(
      "vendor/xterm.js submodule is missing. The release binary MUST use the vendored xterm.js, not the npm version. " +
      "Run `git submodule update --init vendor/xterm.js` and try again."
    );
  }

  if (!fs.existsSync(vendorXtermMjs) || !fs.existsSync(vendorFitMjs)) {
    console.log("Building vendor/xterm.js with bun...");
    buildVendorXterm(vendorXtermDir);
  }

  const vendorRev = Bun.spawnSync(
    ["git", "rev-parse", "HEAD"],
    { cwd: vendorXtermDir, stdout: "pipe" }
  ).stdout.toString().trim();
  if (!/^[0-9a-f]{40}$/.test(vendorRev)) {
    throw new Error(`failed to read vendor/xterm.js git HEAD: ${vendorRev}`);
  }
  console.log(`Using vendor/xterm.js pre-built bundles (rev ${vendorRev})`);

  const plugins: BunPlugin[] = [{
    name: "vendor-xterm",
    setup(builder) {
      builder.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({ path: vendorXtermMjs }));
      builder.onResolve({ filter: /^@xterm\/addon-fit$/ }, () => ({ path: vendorFitMjs }));
    },
  }];

  // Build xterm.js
  configs.push({ name: "xterm", outfile: "xterm.js" });

  for (const { name, outfile } of configs) {
    const result = await build({
      ...commonOpts,
      naming: outfile,
      plugins,
    });
    if (!result.success) {
      console.error(`Build failed for ${name} client:`);
      for (const message of result.logs) {
        console.error(message);
      }
    } else {
      console.log(`Built dist/client/${outfile}`);
    }
  }

  // Append a marker with the vendor xterm.js git rev to the xterm bundle.
  // scripts/verify-vendor-xterm.ts (and the release workflow) greps for this
  // sentinel to confirm the compiled binary embeds the vendored xterm — not
  // the npm version — matching the commit recorded in the submodule pointer.
  const xtermBundle = "dist/client/xterm.js";
  const marker = `\n/* tmux-web: vendor xterm.js rev ${vendorRev} */\n`;
  fs.appendFileSync(xtermBundle, marker);

  // Copy vendor xterm.css (npm fallback removed — vendor is mandatory).
  const cssSrc = path.join(vendorXtermDir, "css/xterm.css");
  try {
    const xtermCss = await Bun.file(cssSrc).bytes();
    await Bun.write("dist/client/xterm.css", xtermCss);
    console.log("Copied xterm.css to dist/client/xterm.css");
  } catch (e) {
    console.error("Failed to copy xterm.css:", e);
  }
}

async function runBuild() {
  await buildClient();
}

if (isWatch) {
  await runBuild();
  console.log("Watching for changes...");
  const watcher = watch(path.join(import.meta.dir, "src"), { recursive: true }, async (event, filename) => {
    if (filename) {
      console.log(`File ${filename} changed, rebuilding...`);
      await runBuild();
    }
  });
} else {
  await runBuild();
}
