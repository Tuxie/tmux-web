# Emacs `send-string-to-terminal` OSC 52 not captured by tmux with `external`

## Symptoms

`clipboard-emacs.test.ts` test 1 ("C-x o copies region to browser clipboard")
fails: Emacs' custom `osc52-copy` function (bound to `C-x o`) calls
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

Fixed in the e2e fixture. The root cause was not Bun PTY or tmux's
OSC 52 path:

- The TypeScript template literal used `"\e"` and `"\a"` for the
  Emacs Lisp copy command. JavaScript treated those as ordinary
  escaped characters, so the generated `init.el` printed visible
  `e]52;...a` text instead of an ESC/BEL-delimited OSC 52 frame.
- Emacs also started on the startup screen, so the intended
  `EMACS_COPY` payload was not in the editable scratch buffer.
- The e2e server now receives the sanitized isolated tmux config via
  `--tmux-conf`, matching the helper's intended `set-clipboard on`
  setup.

The focused Playwright spec now passes:

```bash
bun x playwright test tests/e2e/clipboard-emacs.test.ts
```
