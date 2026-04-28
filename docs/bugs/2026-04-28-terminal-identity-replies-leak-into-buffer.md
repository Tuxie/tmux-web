# Terminal identity replies intermittently leak into visible terminal text

## Context

On 2026-04-28, while testing remote tmux/stdout-agent work, the visible
terminal buffer repeatedly showed terminal identity reply fragments as text:

```text
0;276;0c>|xterm.js(6.0.0)0;276;0c>|xterm.js(6.0.0)0;276;0c>|xterm.js(6.0.0)0;276;0c>|xterm.js(6.0.0)0;276;0c>|xterm.js(6.0.0)
```

The user noted this also happened occasionally before the stdio-agent change,
so do not assume the new remote transport caused it. Treat the remote path as
one reproduction surface, not necessarily the root cause.

The fragments correspond to terminal identity replies:

- Secondary DA: `ESC [ > 0 ; 276 ; 0 c` from xterm.js.
- XTVERSION: `ESC P > | xterm.js(6.0.0) ESC \`.

The expected behavior is that replies to terminal identity probes are sent
back to the PTY/application as input, not painted in the visible terminal
buffer as printable text.

## Existing relevant tests

`tests/e2e/terminal-identity.test.ts` already covers the intended behavior:

- In test mode, the `cat` PTY echoes probes back to xterm.js, and xterm.js
  answers Secondary DA / XTVERSION probes on the input WebSocket path.
- In a real isolated tmux pane, tmux itself answers those identity probes:
  Secondary DA is expected to be `ESC [ > 84 ; 0 ; 0 c`, and XTVERSION is
  expected to report `tmux -V`.

That means a fix should preserve the current tmux-vs-xterm split. Do not
change the tests to expect xterm.js identity inside real tmux.

## Why this matters

When identity replies leak into the screen, applications running inside tmux
see confusing terminal garbage and the user sees repeated protocol fragments
in the shell or TUI. Since the symptom is intermittent, it is likely timing or
routing related rather than a simple deterministic parser failure.

## Suggested investigation path

Start by reproducing on the normal local path before blaming remote stdio:

1. Open a normal tmux-web session.
2. Run an application or shell sequence that sends Secondary DA (`ESC [ > c`)
   and XTVERSION (`ESC [ > q`) probes.
3. Watch both the visible terminal buffer and the outbound WebSocket input
   messages.

Then repeat on `/r/<host>/<session>` once the local path is understood.

Likely areas to inspect:

- `src/client/adapters/xterm.ts`: xterm.js input/output event wiring.
- `src/client/connection.ts` and `src/client/index.ts`: whether terminal
  replies from xterm.js are always sent to the WebSocket and never written
  back into the terminal.
- `src/server/ws.ts`: whether PTY output and client input can be crossed,
  replayed, or echoed in unusual timing windows.
- `src/server/stdio-agent.ts` / `src/server/remote-agent-manager.ts`: for the
  remote reproduction only, check that `pty-in` frames never come back as
  `pty-out` unless the remote PTY/tmux actually echoed them.
- `tests/e2e/terminal-identity.test.ts`: extend with a regression that asserts
  the visible buffer does not contain `0;276;0c`, `>|xterm.js(`, or raw
  identity reply fragments after probes are answered.

The most useful regression test would assert both sides at once: identity
reply bytes are observed on the input path to the server, while the terminal's
visible buffer remains free of the printable fragments.
