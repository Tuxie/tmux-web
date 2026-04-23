BUN := bun

# Install prefix for `make install`.
PREFIX   ?= /usr/local
BINDIR    = $(PREFIX)/bin
SHAREDIR  = $(PREFIX)/share/tmux-web

# Isolated build tree for vendored C libraries and the static tmux binary.
# Kept separate from PREFIX so the two targets never interfere.
VENDOR_PREFIX  := $(PWD)/build
VENDOR_CFLAGS   = -I$(VENDOR_PREFIX)/include
VENDOR_LDFLAGS  = -L$(VENDOR_PREFIX)/lib
STAMPDIR        = tmp/vendor-stamps

SRCS_CLIENT := $(shell find src/client src/shared -name "*.ts") bun-build.ts
SRCS_SERVER := $(shell find src/server src/shared -name "*.ts")

# Present only after `make vendor-tmux`; included as an optional dep so that
# regenerating assets-embedded.ts (and thus tmux-web) is triggered whenever
# the binary changes, but the build doesn't hard-require it.
BUNDLED_TMUX := $(wildcard dist/bin/tmux)

.PHONY: all dev build build-client build-server \
        vendor vendor-tmux \
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

# --- Testing ---

test: typecheck test-unit test-e2e

test-unit:
	$(BUN) test --parallel

typecheck: src/server/assets-embedded.ts
	$(BUN) x tsc --noEmit -p tsconfig.json
	$(BUN) x tsc --noEmit -p tsconfig.client.json

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

src/server/assets-embedded.ts: dist/client/xterm.js $(BUNDLED_TMUX) tmux.conf bun-build.ts scripts/generate-assets.ts
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

# --- Vendor: static tmux binary ---

$(STAMPDIR):
	mkdir -p $@

vendor/libevent/configure:
	cd vendor/libevent && ./autogen.sh

vendor/libevent/config.h: vendor/libevent/configure
	cd vendor/libevent && ./configure --enable-shared=no --prefix="$(VENDOR_PREFIX)"

$(STAMPDIR)/libevent: vendor/libevent/config.h | $(STAMPDIR)
	cd vendor/libevent && $(MAKE) -j install
	touch $@

$(STAMPDIR)/utf8proc: vendor/utf8proc/utf8proc.c | $(STAMPDIR)
	cd vendor/utf8proc && $(MAKE) -j libutf8proc.a prefix="$(VENDOR_PREFIX)"
	install -d $(VENDOR_PREFIX)/lib $(VENDOR_PREFIX)/include
	install vendor/utf8proc/libutf8proc.a $(VENDOR_PREFIX)/lib/
	install vendor/utf8proc/utf8proc.h $(VENDOR_PREFIX)/include/
	touch $@

# jemalloc is intentionally omitted: its malloc/free/realloc symbols conflict
# with glibc's libc.a when linking a fully static binary (glibc defines them
# as strong symbols). This is a glibc limitation; jemalloc works fine with
# dynamic linking or with musl.
vendor/tmux/config.h: $(STAMPDIR)/libevent $(STAMPDIR)/utf8proc
	cd vendor/tmux && ./configure \
	  --enable-static --enable-optimizations \
	  --enable-utf8proc --enable-sixel \
	  --prefix="$(VENDOR_PREFIX)" \
	  CFLAGS="$(VENDOR_CFLAGS)" LDFLAGS="$(VENDOR_LDFLAGS)"

$(STAMPDIR)/tmux: vendor/tmux/config.h | $(STAMPDIR)
	cd vendor/tmux && $(MAKE) -j install
	touch $@

dist/bin/tmux: $(STAMPDIR)/tmux
	install -d dist/bin
	install -m 755 $(VENDOR_PREFIX)/bin/tmux dist/bin/tmux

vendor-tmux: dist/bin/tmux

# --- Cleanup ---

clean:
	rm -rf dist build tmux-web banner.cjs pkg.config.json _bundle.cjs src/server/assets-embedded.ts tmp/.vendor-xterm-built
	rm -f coverage/.lcov.info.*.tmp

distclean: clean
	cd vendor/libevent && $(MAKE) distclean || true
	cd vendor/utf8proc && $(MAKE) clean || true
	cd vendor/tmux && $(MAKE) distclean || true
	rm -rf build $(STAMPDIR)
