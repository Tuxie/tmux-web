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
  // addon-image imports `sixel` and `xterm-wasm-parts` which live in
  // vendor/xterm.js's own node_modules (declared as devDependencies in the
  // submodule's addons/addon-image/package.json). A top-level `bun install`
  // only populates /node_modules at the repo root, so CI checkouts don't
  // have them and `bun build addon-image/src/ImageAddon.ts` fails to
  // resolve them. Install once, lazily, when the sentinel is missing.
  const sentinelDep = path.join(vendorDir, "node_modules/sixel");
  if (!fs.existsSync(sentinelDep)) {
    console.log("Installing vendor/xterm.js dependencies with bun...");
    const install = Bun.spawnSync(
      ["bun", "install"],
      { cwd: vendorDir, stdio: ["ignore", "inherit", "inherit"] }
    );
    if (install.exitCode !== 0) {
      throw new Error("vendor xterm `bun install` failed");
    }
  }

  const patchTargets = [
    "src/browser/tsconfig.json",
    "src/common/tsconfig.json",
    "src/headless/tsconfig.json",
    "addons/addon-webgl/src/TextureAtlas.ts",
  ];
  // Snapshot originals so we can restore after the build. This keeps the
  // vendor submodule's working tree clean — `git status` inside
  // vendor/xterm.js stays empty even after `make build`. The patches are
  // idempotent (skip already-patched files), so restore-then-rebuild is
  // safe on every run.
  const originals = new Map<string, string>();
  for (const rel of patchTargets) {
    const p = path.join(vendorDir, rel);
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf8");
    originals.set(p, raw);

    // 1. tsconfig.json files — inject experimentalDecorators (see above).
    if (rel.endsWith("tsconfig.json")) {
      if (raw.includes('"experimentalDecorators"')) continue;
      // Textual insert (not JSON.parse) because tsconfigs contain JSONC
      // comments and path strings like "common/*" that break naive comment
      // stripping.
      const patched = raw.replace(
        /"compilerOptions"\s*:\s*\{/,
        '"compilerOptions": {\n    "experimentalDecorators": true,'
      );
      if (patched === raw) throw new Error(`failed to patch ${p}`);
      fs.writeFileSync(p, patched);
      continue;
    }

    // 2. WebGL TextureAtlas: force `color.opaque(result)` unconditionally in
    //    `_getForegroundColor`. Upstream only applies it when
    //    `allowTransparency: true`, contradicting its own comment. With
    //    tmux-web's opacity trick (`theme.background` = `rgba(r,g,b,0)` so
    //    the WebGL canvas clear stays transparent), cells with INVERSE +
    //    CM_DEFAULT fg/bg resolve the glyph color to `colors.background`,
    //    which ends up with alpha=0. The `fillStyle` becomes fully
    //    transparent, the glyph is never painted, and `clearColor()`
    //    classifies the whole tile as empty → NULL_RASTERIZED_GLYPH →
    //    bash/zsh's bracketed-paste active-region highlight (SGR 7 on
    //    default colors) renders as an invisible line.
    if (rel.endsWith("addon-webgl/src/TextureAtlas.ts")) {
      const needle =
        "    // Always use an opaque color regardless of allowTransparency\n" +
        "    if (this._config.allowTransparency) {\n" +
        "      result = color.opaque(result);\n" +
        "    }";
      if (!raw.includes(needle)) {
        if (raw.includes("// tmux-web: unconditional opaque foreground")) continue;
        throw new Error(
          `failed to locate TextureAtlas opaque-foreground needle — upstream likely changed; ` +
          `re-check the patch`
        );
      }
      const patched = raw.replace(
        needle,
        "    // Always use an opaque color regardless of allowTransparency.\n" +
        "    // tmux-web: unconditional opaque foreground — see bun-build.ts.\n" +
        "    result = color.opaque(result);"
      );
      fs.writeFileSync(p, patched);
      continue;
    }
  }

  const restoreOriginals = () => {
    for (const [p, raw] of originals) {
      try { fs.writeFileSync(p, raw); } catch { /* best-effort */ }
    }
  };

  const buildEntry = (entry: string, outdir: string, name: string) => {
    const result = Bun.spawnSync(
      ["bun", "build", entry, "--outdir", outdir, "--minify", "--target", "browser", "--entry-naming", name],
      { cwd: vendorDir, stdio: ["ignore", "inherit", "inherit"] }
    );
    if (result.exitCode !== 0) {
      throw new Error(`vendor xterm build failed: ${entry}`);
    }
  };

  try {
    buildEntry(
      "src/browser/public/Terminal.ts",
      "lib",
      "xterm.mjs"
    );
    for (const [dir, entry] of [
      ["addon-fit", "FitAddon"],
      ["addon-webgl", "WebglAddon"],
      ["addon-unicode-graphemes", "UnicodeGraphemesAddon"],
      ["addon-web-links", "WebLinksAddon"],
      ["addon-web-fonts", "WebFontsAddon"],
      ["addon-image", "ImageAddon"],
    ]) {
      buildEntry(
        `addons/${dir}/src/${entry}.ts`,
        `addons/${dir}/lib`,
        `${dir}.mjs`,
      );
    }
  } finally {
    restoreOriginals();
  }
}

async function buildClient() {
  const configs: Array<{ name: string; outfile: string }> = [];

  const vendorXtermDir = path.join(import.meta.dir, "vendor/xterm.js");
  const vendorXtermEntry = path.join(vendorXtermDir, "src/browser/public/Terminal.ts");
  const vendorXtermMjs = path.join(vendorXtermDir, "lib/xterm.mjs");
  const addonDirs = [
    "addon-fit",
    "addon-webgl",
    "addon-unicode-graphemes",
    "addon-web-links",
    "addon-web-fonts",
    "addon-image",
  ];
  const addonMjs = Object.fromEntries(addonDirs.map(d =>
    [d, path.join(vendorXtermDir, `addons/${d}/lib/${d}.mjs`)]
  ));
  const hasVendorSrc = fs.existsSync(vendorXtermEntry);

  if (!hasVendorSrc) {
    throw new Error(
      "vendor/xterm.js submodule is missing. The release binary MUST use the vendored xterm.js, not the npm version. " +
      "Run `git submodule update --init vendor/xterm.js` and try again."
    );
  }

  if (!fs.existsSync(vendorXtermMjs) || addonDirs.some(d => !fs.existsSync(addonMjs[d]!))) {
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
      for (const d of addonDirs) {
        const re = new RegExp(`^@xterm/${d}$`);
        builder.onResolve({ filter: re }, () => ({ path: addonMjs[d]! }));
      }
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

  // Copy base.css to dist
  try {
    const baseCss = await Bun.file(path.join(import.meta.dir, 'src/client/base.css')).bytes();
    await Bun.write('dist/client/base.css', baseCss);
    console.log('Copied base.css to dist/client/base.css');
  } catch (e) {
    console.error('Failed to copy base.css:', e);
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
