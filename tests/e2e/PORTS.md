# E2E port registry

Several e2e suites start their own dedicated server on a fixed port alongside the shared playwright-managed server. Playwright may run repeated tests or files in parallel workers, so every concurrently startable server in these suites needs its own fixed port.

| Port  | File                                       | Notes |
|-------|--------------------------------------------|-------|
| 4023  | shared Playwright server                   | `playwright.config.ts` |
| 4050  | tests/e2e/font-selection.test.ts           |       |
| 4060  | reserved                                   | menu-settings-open (deferred) |
| 4098  | tests/e2e/tls.test.ts                      | HTTP (no-TLS) variant |
| 4099  | tests/e2e/tls.test.ts                      | HTTPS (TLS) variant |
| 4100  | tests/e2e/terminal-selection.test.ts       |       |
| 4115  | tests/e2e/file-drop.test.ts                | file-drop upload pipeline |
| 4116  | reserved                                   | OSC 52 read-consent E2E (deferred) |
| 4117  | tests/e2e/control-mode-notifications.test.ts | real-tmux rename-session push |
| 4118  | tests/e2e/control-mode-window-size.test.ts | control client window-size regression guard |
| 4119  | tests/e2e/menu-session-switch-content.test.ts | real-tmux repeated menu session switches |
| 4120-5119 | tests/e2e/scrollbar.test.ts         | real-tmux scrollbar wheel; per-worker range |
| 5120-6119 | tests/e2e/scrollbar.test.ts         | real-tmux scrollbar alternate screen; per-worker range |
| 6120  | tests/e2e/terminal-identity.test.ts       | real-tmux Secondary DA reply |
| 6121  | tests/e2e/terminal-identity.test.ts       | real-tmux XTVERSION reply |
| 6122+ | new tests                                  | pick the next unused port here |

If you add a new e2e test that spawns its own server, append a row and use the next free port.

## File-name conventions

- **`*.test.ts` is the canonical extension** for new Playwright e2e
  files. The historical `*.spec.ts` files have been renamed to
  `*.test.ts` (zero `.spec.ts` files remain post-rename); the
  extension is grandfathered only in case future contributors search
  for the old shape. Playwright's default `testMatch` accepts both,
  but please pick `.test.ts` so the suite stays uniform.
- **`*.ts` files in this directory without a `.test.ts` suffix are
  helpers / fixtures, not tests.** `helpers.ts` exports the
  `IsolatedTmux` / `mockApis` / WS-spy helpers; `fixture-themes.ts`
  is a theme-pack fixture. Playwright's default `testMatch` excludes
  them because they don't end in `.test.ts` / `.spec.ts`. If you add
  a third helper module here, give it a non-`.test`/`.spec` suffix
  for the same reason.

