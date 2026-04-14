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
    "addons/addon-fit/tsconfig.json",
  ];
  for (const rel of patchTargets) {
    const p = path.join(vendorDir, rel);
    if (!fs.existsSync(p)) continue;
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    cfg.compilerOptions ??= {};
    if (!cfg.compilerOptions.experimentalDecorators) {
      cfg.compilerOptions.experimentalDecorators = true;
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
    }
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

  const plugins: BunPlugin[] = [];

  if (hasVendorSrc) {
    // Build vendor bundle if not yet built or stale
    if (!fs.existsSync(vendorXtermMjs) || !fs.existsSync(vendorFitMjs)) {
      console.log("Building vendor/xterm.js with bun...");
      buildVendorXterm(vendorXtermDir);
    }
    console.log("Using vendor/xterm.js pre-built bundles");
    plugins.push({
      name: "vendor-xterm",
      setup(builder) {
        builder.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({
          path: vendorXtermMjs,
        }));
        builder.onResolve({ filter: /^@xterm\/addon-fit$/ }, () => ({
          path: vendorFitMjs,
        }));
      }
    });
  } else {
    console.log("Using npm @xterm/xterm for xterm.js bundle");
  }

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

  // Copy xterm.css — prefer vendor copy, fall back to npm
  const vendorCss = path.join(vendorXtermDir, "css/xterm.css");
  const cssSrc = fs.existsSync(vendorCss)
    ? vendorCss
    : "node_modules/@xterm/xterm/css/xterm.css";
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
