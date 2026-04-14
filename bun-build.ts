import { build, type BuildOptions, type BunPlugin } from "bun";
import path from "node:path";
import { watch } from "node:fs";
import { resolveVendoredXtermBundle } from "./src/build/xterm-source.js";

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

async function buildClient() {
  const configs = [
    { name: "ghostty", outfile: "ghostty.js" },
  ];

  const vendoredXterm = await resolveVendoredXtermBundle(import.meta.dir);

  const plugins: BunPlugin[] = [];
  console.log(`Using vendored xterm.js package artifacts for xterm.js bundle`);
  plugins.push({
    name: "vendor-xterm",
    setup(builder) {
      builder.onResolve({ filter: /^@xterm\/xterm$/ }, () => {
        return { path: vendoredXterm.xtermEntry! };
      });
      builder.onResolve({ filter: /^@xterm\/addon-fit$/ }, () => {
        return { path: vendoredXterm.fitEntry! };
      });
    }
  });

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

  // Copy xterm.css
  try {
    const xtermCss = await Bun.file(vendoredXterm.cssPath).bytes();
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
