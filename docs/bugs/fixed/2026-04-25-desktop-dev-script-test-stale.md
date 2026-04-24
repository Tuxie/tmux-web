# desktop:dev package script test is stale

## Context

While investigating Electrobun rendering quality on 2026-04-25, I ran the
focused desktop tests:

```bash
bun test tests/unit/desktop/package-scripts.test.ts tests/unit/desktop/window.test.ts
```

`tests/unit/desktop/window.test.ts` passed, but
`tests/unit/desktop/package-scripts.test.ts` failed before any rendering
changes were made.

## Failure

The test `desktop package scripts > desktop:dev uses the bundled tmux-web binary path`
expects `package.json` script `desktop:dev` to contain `make tmux-web`.

Actual current script:

```json
"desktop:dev": "bun run scripts/build-desktop-prereqs.ts && electrobun dev"
```

Failure excerpt:

```text
Expected to contain: "make tmux-web"
Received: "bun run scripts/build-desktop-prereqs.ts && electrobun dev"
```

## Fix

Updated `tests/unit/desktop/package-scripts.test.ts` to assert the current
contract: `desktop:dev` runs `scripts/build-desktop-prereqs.ts` before
`electrobun dev`, and still does not use the old
`TMUX_TERM_TMUX_WEB=./tmux-web` override.
