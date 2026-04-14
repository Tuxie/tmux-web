PLATFORM := $(shell bun -e "process.stdout.write(process.platform)")
ARCH     := $(shell bun -e "process.stdout.write(process.arch)")
BUN      := bun

PREFIX   ?= /usr/local
BINDIR    = $(PREFIX)/bin
SHAREDIR  = $(PREFIX)/share/tmux-web

SRCS_CLIENT := $(shell find src/client src/shared -name "*.ts") bun-build.ts
SRCS_SERVER := $(shell find src/server src/shared -name "*.ts")

.PHONY: all dev clean test test-unit test-e2e test-e2e-headed vendor install build build-client build-server

all: tmux-web

# --- Development ---

dev:
	$(BUN) bun-build.ts --watch &
	$(BUN) --watch src/server/index.ts --no-auth

# --- Build ---

dist/client/ghostty.js: $(SRCS_CLIENT)
	$(BUN) bun-build.ts

build: dist/client/ghostty.js

build-client: dist/client/ghostty.js

build-server: tmux-web

# --- Testing ---

test: test-unit test-e2e

test-unit:
	$(BUN) test

test-e2e: dist/client/ghostty.js
	node node_modules/.bin/playwright test

test-e2e-headed: dist/client/ghostty.js
	node node_modules/.bin/playwright test --headed

# --- Production binary ---

src/server/assets-embedded.ts: dist/client/ghostty.js tmux.conf bun-build.ts scripts/generate-assets.ts
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
	# Install ghostty-web assets if available
	@if [ -d node_modules/ghostty-web ]; then \
		cp node_modules/ghostty-web/ghostty-vt.wasm $(DESTDIR)$(SHAREDIR)/; \
		cp -rf node_modules/ghostty-web/dist/* $(DESTDIR)$(SHAREDIR)/dist/; \
	fi

# --- Vendor (optional: xterm.js from git HEAD) ---
VENDOR_XTERM_HEAD := $(wildcard .git/modules/vendor/xterm.js/HEAD)

# $(wildcard ...) returns empty string if submodule not yet initialised, so
# the stamp has no prerequisites and is simply rebuilt when missing.
# Once the submodule exists the HEAD file is tracked as a real dependency,
# triggering a reinstall whenever the submodule commit changes.
tmp/.vendor-xterm-built: $(VENDOR_XTERM_HEAD)
	git submodule update --init vendor/xterm.js
	cd vendor/xterm.js && bun install && rm -f bun.lock
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
	rm -rf dist tmux-web banner.cjs pkg.config.json _bundle.cjs src/server/assets-embedded.ts tmp/.vendor-xterm-built
