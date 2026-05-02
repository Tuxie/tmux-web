# Editor integration

tmux-web's default `tmux.conf` sets `set -s set-clipboard external`, so tmux forwards OSC 52 clipboard sequences from pane applications to the browser. Some editors need explicit configuration so their normal editor commands use that tmux/OSC 52 path.

Mouse settings matter too. tmux-web forwards mouse events to fullscreen alternative-screen TUIs, so when an editor enables mouse support, clicks, drags, and wheel events are handled by the editor instead of being treated as tmux copy-mode selection.

## Vim

Standard Vim needs an explicit clipboard provider. Use Vim 9.2 or newer built with `+clipboard_provider`, then add this to your `~/.vimrc`:

```vim
" tmux-web clipboard provider for standard Vim.
" Requires Vim with +clipboard_provider and tmux with set-clipboard external.
set clipboard=unnamedplus
set mouse=a

let g:tmux_web_clipboard_cache = ''

function! TmuxWebClipboardAvailable() abort
  return v:true
endfunction

function! TmuxWebClipboardCopy(reg, type, lines) abort
  let l:text = join(a:lines, "\n")
  if a:type ==# 'V'
    let l:text .= "\n"
  endif
  let g:tmux_web_clipboard_cache = l:text
  if exists('$TMUX') && executable('tmux')
    call system(['tmux', 'load-buffer', '-w', '-'], l:text)
  endif
endfunction

function! TmuxWebClipboardPaste(reg) abort
  if exists('$TMUX') && executable('tmux')
    let l:text = system(['tmux', 'save-buffer', '-'])
    if !v:shell_error
      return ['v', split(l:text, "\n", 1)]
    endif
  endif
  return ['v', split(g:tmux_web_clipboard_cache, "\n", 1)]
endfunction

let v:clipproviders['tmux-web'] = {
      \ 'available': function('TmuxWebClipboardAvailable'),
      \ 'copy': {
      \   '+': function('TmuxWebClipboardCopy'),
      \   '*': function('TmuxWebClipboardCopy'),
      \ },
      \ 'paste': {
      \   '+': function('TmuxWebClipboardPaste'),
      \   '*': function('TmuxWebClipboardPaste'),
      \ },
      \ }
set clipmethod^=tmux-web
```

- `set clipboard=unnamedplus` makes plain `y` and `p` use the `+` register.
- `set mouse=a` lets Vim handle clicks, drags, and wheel events in all modes.
- `clipmethod^=tmux-web` tells Vim to use the custom provider for `+` and `*`.
- Inside tmux, copy uses `tmux load-buffer -w -` so tmux also emits the OSC 52 clipboard write that tmux-web mirrors to the browser/OS clipboard.
- Inside tmux, paste uses `tmux save-buffer -` so `p`, `"+p`, and `"*p` read the current tmux buffer.
- Outside tmux, the small in-process cache keeps normal same-Vim `y` then `p` behavior working instead of breaking direct Vim users.

## Emacs

Terminal Emacs also needs explicit clipboard plumbing. Add this to your Emacs init file:

```elisp
;; tmux-web clipboard provider for terminal Emacs.
;; Uses tmux buffers inside tmux and keeps same-Emacs kill/yank working outside tmux.
(setq select-enable-clipboard t)
(setq tmux-web-clipboard-cache "")

(defun tmux-web-copy (text)
  (setq tmux-web-clipboard-cache text)
  (when (and (getenv "TMUX") (executable-find "tmux"))
    (let ((process-connection-type nil))
      (with-temp-buffer
        (insert text)
        (call-process-region (point-min) (point-max)
                             "tmux" nil nil nil
                             "load-buffer" "-w" "-")))))

(defun tmux-web-paste ()
  (if (and (getenv "TMUX") (executable-find "tmux"))
      (with-temp-buffer
        (let ((status (call-process "tmux" nil t nil "save-buffer" "-")))
          (if (eq status 0)
              (buffer-string)
            tmux-web-clipboard-cache)))
    tmux-web-clipboard-cache))

(setq interprogram-cut-function #'tmux-web-copy)
(setq interprogram-paste-function #'tmux-web-paste)
```

- `kill-ring-save` / `M-w` calls `interprogram-cut-function`, which loads the tmux buffer with `tmux load-buffer -w -`; tmux then emits the OSC 52 clipboard write that tmux-web mirrors to the browser/OS clipboard.
- `yank` / `C-y` calls `interprogram-paste-function`, which reads the current tmux buffer with `tmux save-buffer -`.
- Outside tmux, the in-process cache keeps normal same-Emacs kill/yank behavior working instead of breaking direct Emacs users.

## Helix

Helix needs a custom clipboard provider if you want plain `y` and `p` to use the tmux-web/tmux clipboard path consistently. Add this to `~/.config/helix/config.toml`:

```toml
[editor]
default-yank-register = "+"
mouse = true

[editor.clipboard-provider.custom]
yank = { command = "sh", args = ["-c", 'cache=${XDG_CACHE_HOME:-$HOME/.cache}/tmux-web-helix-clipboard; if [ -n "$TMUX" ] && tmux save-buffer - 2>/dev/null; then :; else cat "$cache" 2>/dev/null || true; fi'] }
paste = { command = "sh", args = ["-c", 'cache=${XDG_CACHE_HOME:-$HOME/.cache}/tmux-web-helix-clipboard; mkdir -p "${cache%/*}"; cat > "$cache"; if [ -n "$TMUX" ]; then tmux load-buffer -w "$cache" >/dev/null 2>&1 || true; fi'] }
primary-yank = { command = "sh", args = ["-c", 'cache=${XDG_CACHE_HOME:-$HOME/.cache}/tmux-web-helix-clipboard; if [ -n "$TMUX" ] && tmux save-buffer - 2>/dev/null; then :; else cat "$cache" 2>/dev/null || true; fi'] }
primary-paste = { command = "sh", args = ["-c", 'cache=${XDG_CACHE_HOME:-$HOME/.cache}/tmux-web-helix-clipboard; mkdir -p "${cache%/*}"; cat > "$cache"; if [ -n "$TMUX" ]; then tmux load-buffer -w "$cache" >/dev/null 2>&1 || true; fi'] }
```

- `default-yank-register = "+"` makes plain `y` and `p` use Helix's clipboard register instead of the internal yank register.
- `mouse = true` lets Helix handle clicks, drags, and wheel events.
- In Helix custom providers, `paste` receives text from editor yanks, while `yank` prints text back for editor pastes.
- Inside tmux, copy uses `tmux load-buffer -w` so tmux emits the OSC 52 clipboard write that tmux-web mirrors to the browser/OS clipboard.
- Inside tmux, paste uses `tmux save-buffer -` so `p` reads the current tmux buffer.
- Outside tmux, the cache file keeps normal same-Helix `y` then `p` behavior working instead of breaking direct Helix users.

## Kakoune

Kakoune can handle tmux-web mouse events when terminal mouse support is enabled. Add this to your Kakoune config, for example `~/.config/kak/kakrc`:

```kak
set-option global terminal_enable_mouse true
```

- `terminal_enable_mouse true` lets Kakoune handle clicks, drags, and wheel events.
- Kakoune's default `"` register is used by normal `y` and `p` operations.

## Neovim

Neovim 0.10 or newer has built-in OSC 52 clipboard support in TUI mode. Add this to `~/.config/nvim/init.lua`:

```lua
vim.opt.clipboard = 'unnamedplus'
vim.opt.mouse = 'a'
```

Or to `~/.config/nvim/init.vim`:

```vim
set clipboard=unnamedplus
set mouse=a
```

- `clipboard=unnamedplus` makes plain `y` and `p` use the `+` register.
- `mouse=a` lets Neovim handle clicks, drags, and wheel events in all modes.

No plugins or custom autocmds needed. Neovim detects the `Ms` terminfo capability that tmux-web provides and emits/receives OSC 52 sequences natively for both yank and paste.
