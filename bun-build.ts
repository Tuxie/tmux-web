import { build, type BuildOptions } from "bun";
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
  external: ["/dist/ghostty-web.js", "/dist/client/vendor-xterm.js", "/dist/client/vendor-xterm-addon-fit.js"],
};

async function buildClient() {
  const configs = [
    { name: "ghostty", outfile: "ghostty.js" },
  ];

  const vendorXtermDir = path.join(import.meta.dir, "vendor/xterm.js");
  const hasVendorXterm = fs.existsSync(vendorXtermDir);

  // Build xterm.js
  configs.push({ name: "xterm", outfile: "xterm.js" });

  for (const { name, outfile } of configs) {
    const result = await build({
      ...commonOpts,
      naming: outfile,
      // If it's the xterm bundle and we have vendor, we might need special handling
      // but src/client/adapters/xterm.ts already handles the import fallback.
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

  // Copy xterm.css
  try {
    const xtermCss = await Bun.file("node_modules/@xterm/xterm/css/xterm.css").bytes();
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
