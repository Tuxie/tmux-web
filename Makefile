BUN := bun

# Install prefix for `make install`.
PREFIX   ?= /usr/local
BINDIR    = $(PREFIX)/bin
SHAREDIR  = $(PREFIX)/share/tmux-web

SRCS_CLIENT := $(shell find src/client src/shared -name "*.ts") bun-build.ts
SRCS_SERVER := $(shell find src/server src/shared -name "*.ts")

.PHONY: all dev build build-client build-server tmux-term \
        vendor \
        test typecheck test-unit test-e2e test-e2e-headed \
        bench fuzz install clean distclean

all: tmux-web

# --- Development ---

dev:
	$(BUN) bun-build.ts --watch &
	$(BUN) --watch src/server/index.ts --no-auth

# --- Build ---

dist/client/xterm.js: $(SRCS_CLIENT)
	$(BUN) bun-build.ts

build: dist/client/xterm.js

build-client: dist/client/xterm.js

build-server: tmux-web

tmux-term:
	$(BUN) run scripts/build-desktop-prereqs.ts
	$(BUN) run desktop:build
	$(BUN) run scripts/verify-electrobun-bundle.ts

# --- Testing ---

test: typecheck test-unit test-e2e

test-unit:
	sh scripts/test-unit-files.sh $(BUN)

typecheck: src/server/assets-embedded.ts
	$(BUN) x tsc --noEmit -p tsconfig.json
	$(BUN) x tsc --noEmit -p tsconfig.client.json
	$(BUN) x tsc --noEmit -p tsconfig.electrobun.json

test-e2e: dist/client/xterm.js
	$(BUN) x playwright test

test-e2e-headed: dist/client/xterm.js
	$(BUN) x playwright test --headed

# --- Benchmarks ---

bench:
	$(BUN) run scripts/bench-render-math.ts

# --- Property / fuzz tests ---
# Not part of `make test` (the release path) — bunfig.toml pins the
# default test root to tests/unit, so these are excluded unless invoked
# explicitly. Run locally before tagging a release, after `act` has
# verified the release workflow.
fuzz:
	$(BUN) test ./tests/fuzz/

# --- Production binary ---

src/server/assets-embedded.ts: dist/client/xterm.js tmux.conf bun-build.ts scripts/generate-assets.ts
	$(BUN) run scripts/generate-assets.ts

tmux-web: dist/client/vendor-xterm.js dist/client/vendor-xterm-addon-fit.js $(SRCS_SERVER) src/server/assets-embedded.ts
	$(BUN) build src/server/index.ts --compile --minify --sourcemap --bytecode --outfile tmux-web

install: tmux-web
	mkdir -p $(DESTDIR)$(BINDIR)
	mkdir -p $(DESTDIR)$(SHAREDIR)
	install -m 755 tmux-web $(DESTDIR)$(BINDIR)/
	cp -rf dist fonts tmux.conf $(DESTDIR)$(SHAREDIR)/
	mkdir -p $(DESTDIR)$(SHAREDIR)/src/client
	cp src/client/index.html $(DESTDIR)$(SHAREDIR)/src/client/

# --- Vendor: xterm.js ---

VENDOR_XTERM_HEAD := $(wildcard .git/modules/vendor/xterm.js/HEAD)

# $(wildcard ...) returns empty string if the submodule is not yet initialised,
# so the stamp has no prerequisites and is simply rebuilt when missing.
# Once the submodule exists the HEAD file is a real dependency, triggering a
# reinstall whenever the submodule commit changes.
tmp/.vendor-xterm-built: $(VENDOR_XTERM_HEAD)
	git submodule update --init vendor/xterm.js
	cd vendor/xterm.js && bun install && rm -f bun.lock
	@# xterm.js DI uses legacy TS parameter decorators. bun does not follow
	@# tsconfig "extends", so vendor's per-dir tsconfigs (which rely on
	@# tsconfig-library-base for experimentalDecorators) get the flag dropped
	@# and bun falls back to TC39 stage-3, producing a runtime crash
	@# ("Cannot read properties of undefined (reading 'value')"). Inline the
	@# flag directly into each per-dir tsconfig that bun actually reads.
	@for f in vendor/xterm.js/src/browser/tsconfig.json vendor/xterm.js/src/common/tsconfig.json vendor/xterm.js/src/headless/tsconfig.json; do \
		bun -e "const fs=require('fs');const p='$$f';const r=fs.readFileSync(p,'utf8');if(r.includes('\"experimentalDecorators\"'))process.exit(0);const o=r.replace(/\"compilerOptions\"\s*:\s*\{/, '\"compilerOptions\": {\n    \"experimentalDecorators\": true,');if(o===r)throw new Error('patch failed: '+p);fs.writeFileSync(p,o)"; \
	done
	@mkdir -p tmp
	@touch $@

dist/client/vendor-xterm.js: tmp/.vendor-xterm-built
	cd vendor/xterm.js && bun build src/browser/public/Terminal.ts --outdir lib --minify --target browser --entry-naming xterm.mjs
	@mkdir -p dist/client
	cp vendor/xterm.js/lib/xterm.mjs $@

dist/client/vendor-xterm-addon-fit.js: tmp/.vendor-xterm-built
	cd vendor/xterm.js && bun build addons/addon-fit/src/FitAddon.ts --outdir addons/addon-fit/lib --minify --target browser --entry-naming addon-fit.mjs
	@mkdir -p dist/client
	cp vendor/xterm.js/addons/addon-fit/lib/addon-fit.mjs $@

vendor: dist/client/vendor-xterm.js dist/client/vendor-xterm-addon-fit.js

# --- Cleanup ---

clean:
	rm -rf dist build tmux-web banner.cjs pkg.config.json _bundle.cjs src/server/assets-embedded.ts tmp/.vendor-xterm-built
	rm -f coverage/.lcov.info.*.tmp

distclean: clean
	rm -rf build
