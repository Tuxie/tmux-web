# E2E port registry

Playwright's current config runs test files serially per project (no `fullyParallel: true`), but several e2e suites start their own dedicated server on a fixed port alongside the shared playwright-managed server. To prevent collision if parallelism is enabled later, keep each fixed port unique across files.

| Port  | File                                       | Notes |
|-------|--------------------------------------------|-------|
| 4023  | shared Playwright server                   | `playwright.config.ts` |
| 4050  | tests/e2e/font-selection.test.ts           |       |
| 4060  | tests/e2e/menu-settings-open.test.ts       |       |
| 4098  | tests/e2e/tls.test.ts                      | HTTP (no-TLS) variant |
| 4099  | tests/e2e/tls.test.ts                      | HTTPS (TLS) variant |
| 4100  | tests/e2e/terminal-selection.test.ts       |       |
| 4115  | tests/e2e/file-drop.test.ts                | file-drop upload pipeline |
| 4116  | reserved                                   | OSC 52 read-consent E2E (deferred) |
| 4117  | tests/e2e/control-mode-notifications.spec.ts | real-tmux rename-session push |
| 4118  | tests/e2e/control-mode-window-size.spec.ts | control client window-size regression guard |
| 4119  | tests/e2e/menu-session-switch-content.spec.ts | real-tmux repeated menu session switches |
| 4120+ | new tests                                  | pick the next unused port here |

If you add a new e2e test that spawns its own server, append a row and use the next free port.
