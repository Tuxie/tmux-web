/**
 * E2E tests for OSC 52 clipboard-read consent flow.
 *
 * DEFERRED — see cluster 06 finding 6.
 *
 * The consent flow requires the server to intercept `\x1b]52;c;?\x07` on the
 * PTY→client path and emit a `clipboardPrompt` TT message. In --test mode
 * the PTY is `cat`, so the sequence must round-trip (client → WS → cat →
 * server intercept → client). Testing that end-to-end without a real browser
 * requires a raw WebSocket client with precise timing, which is brittle and
 * prone to false negatives if cat's echo is slow.
 *
 * The pure-function behaviour of the interceptor is already covered at the
 * unit level in `tests/unit/server/protocol-osc52.test.ts`. The UI modal
 * behaviour (showing the consent dialog, recording a grant) is the remaining
 * E2E gap and should be addressed once a lightweight in-process WS test
 * harness is available or via Playwright's `page.evaluate()` approach of
 * directly injecting a `clipboardPrompt` TT message through `__mockWsReceive`.
 *
 * TODO: Implement once a clean injection path exists. Port 4116 is reserved
 * in PORTS.md.
 */

// Placeholder: no tests in this file yet. Remove this comment block and add
// tests when the flow can be exercised cleanly.
export {};
