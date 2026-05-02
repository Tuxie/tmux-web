# Emacs `send-string-to-terminal` OSC 52 not captured by tmux with `external`

## Symptoms

A historical standalone Emacs clipboard e2e failed: Emacs' custom
`osc52-copy` function (bound to `C-x o`) calls
`send-string-to-terminal` with a valid OSC 52 escape sequence, but neither
tmux's paste buffer (`show-buffer` empty) nor the browser clipboard
(`navigator.clipboard.writeText` spy empty) receives the content.

Test 2 (paste direction via `C-x p` → OSC 52 read → tmux-web consent →
reply delivery) passes.

## What works

- Manual tmux test with `set-clipboard on` loaded via `-f` at server start:
  buffer populated, `*Messages*` shows function entered.
- Neovim built-in OSC 52 provider works with both `on` and `external`.
- tmux copy-mode keyboard copy works with both `on` and `external`.

## What fails

- Emacs OSC 52 with `set-clipboard external` regardless of when `on` is
  set (before Emacs start, after Emacs start, after `startServer` PTY
  attach).
- The `on` / `external` setting at the time of copy is confirmed as
  `on` (via `show-options -s -g`), yet `show-buffer` returns empty.

## Investigation notes

- Emacs 30.2, tmux 3.6a, Bun PTY.
- Emacs requires `(require 'xterm)` + `(add-to-list 'xterm-extra-capabilities 'setSelection)` + `(terminal-init-xterm)` to register the OSC 52 backend.  Without this, `gui-set-selection` is a no-op in `-nw` mode.
- Even with the backend registered, `gui-set-selection` doesn't reach
  tmux; only raw `send-string-to-terminal` with a hand-built
  `\e]52;c;<base64>\a` sequence works.
- The base64 payload must be unibyte: scratch buffer intro text contains
  Unicode (em-dash, curly quotes) → `base64-encode-string` throws
  "Multibyte character in data for base64 encoding".  Mitigated with
  `(encode-coding-string text 'utf-8 t)`.
- Key binding: `<f5>` not recognised by Emacs in tmux terminal mode
  (shows "f5 is undefined").  `C-c o` and `C-x o` both work (confirmed
  via `*Messages*` output showing function entry).
- The sanitised e2e config strips `source-file` lines and rewrites
  `set-clipboard external` → `on`.  The `buildPtyCommand` in the
  server attaches with `-f production.conf` (which has `external`),
  potentially overriding the server option back to `external` after
  the test set it to `on`.  Passing `--tmux-conf <sanitised>` to the
  server didn't help.
- Setting `on` after `startServer` connects doesn't fix it either.

## Hypothesis

Emacs' `send-string-to-terminal` may use a different I/O path than
Neovim's `writefile` or tmux pane stdout.  In tmux with `external`,
the PTY line discipline or tmux's OSC 52 interception might route
the sequence differently.  With `on`, tmux captures it from the PTY
stream regardless.

The fact that manual standalone tmux with `on` works, but the e2e
test through tmux-web's PTY doesn't, suggests the Bun PTY layer or
the server's PTY read path might not pass the sequence through when
`external` was ever active in the server's lifetime — even after
switching back to `on`.

## Resolution

Fixed by making the clipboard tests match the bundled tmux-web
configuration instead of rewriting it per test.

- The e2e helper no longer rewrites `set-clipboard external` to `on`.
  Clipboard e2e tests now pass the sanitized bundled `tmux.conf` to
  the server and assert `show-options -s -g set-clipboard` is
  `external`.
- Emacs copy uses tmux DCS passthrough OSC 52
  (`ESC Ptmux; ESC ESC ]52;... BEL ESC \`) so `external` remains a
  valid default: tmux passes the sequence to tmux-web, tmux-web writes
  the browser clipboard, and the server mirrors the content into the
  tmux paste buffer.
- Browser/OS clipboard-to-editor paste is covered by Neovim using an
  isolated test `init.lua` whose `+` register reads from the tmux
  paste buffer. tmux-web mirrors the browser clipboard into that buffer
  on connection/focus.
- The redundant/brittle Emacs paste fixture was removed; the Neovim
  paste test is the representative editor `p` path for browser/OS
  clipboard input.

The real-tmux clipboard integration coverage now lives in
`tests/e2e/clipboard-matrix.test.ts`, including Emacs, Neovim, Vim, Helix,
tmux copy-mode, browser paste, OS clipboard mirroring, and browser mouse
selection. The focused matrix passes with:

```bash
bun x playwright test tests/e2e/clipboard-matrix.test.ts
```
