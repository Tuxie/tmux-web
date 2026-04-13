PLATFORM := $(shell bun -e "process.stdout.write(process.platform)")
ARCH     := $(shell bun -e "process.stdout.write(process.arch)")
BUN      := bun

PREFIX   ?= /usr/local
BINDIR    = $(PREFIX)/bin
SHAREDIR  = $(PREFIX)/share/tmux-web

SRCS_CLIENT := $(shell find src/client src/shared -name "*.ts") bun-build.ts
SRCS_SERVER := $(shell find src/server src/shared -name "*.ts")

.PHONY: all dev clean test test-unit test-e2e test-e2e-headed vendor install

all: tmux-web

# --- Development ---

dev:
	$(BUN) bun-build.ts --watch &
	$(BUN) --watch src/server/index.ts

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

test-e2e: build
	node node_modules/.bin/playwright test

test-e2e-headed: build
	node node_modules/.bin/playwright test --headed

# --- Production binary ---

tmux-web: $(SRCS_SERVER) dist/client/ghostty.js
	$(BUN) build src/server/index.ts --compile --minify --outfile tmux-web

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

vendor:
	git submodule update --init vendor/xterm.js
	cd vendor/xterm.js && bun install
	cd vendor/xterm.js && bun build src/browser/public/Terminal.ts --outdir lib --minify --target browser --naming xterm.mjs
	cd vendor/xterm.js && bun build addons/addon-fit/src/FitAddon.ts --outdir addons/addon-fit/lib --minify --target browser --naming addon-fit.mjs
	mkdir -p dist/client
	cp vendor/xterm.js/lib/xterm.mjs dist/client/vendor-xterm.js
	cp vendor/xterm.js/addons/addon-fit/lib/addon-fit.mjs dist/client/vendor-xterm-addon-fit.js

# --- Cleanup ---

clean:
	rm -rf dist tmux-web banner.cjs pkg.config.json _bundle.cjs pkg.config.json banner.cjs
