# Editor integration

tmux-web's default `tmux.conf` sets `set -s set-clipboard on`, so tmux accepts OSC 52 clipboard writes from pane applications into its own paste buffer and also forwards them to the browser. The browser clipboard is mirrored back into the tmux paste buffer on connect and focus. Editors still differ in how their normal paste commands read that buffer; the notes below call out where `"+p`, `p`, or `C-y` works and where `tmux paste-buffer` remains the compatible path.

Mouse settings matter too. tmux-web forwards mouse events to fullscreen alternative-screen TUIs, so when an editor enables mouse support, clicks, drags, and wheel events are handled by the editor instead of being treated as tmux copy-mode selection.

## Vim

Standard Vim 9.2 or newer can use its bundled OSC 52 provider. Add this to your `~/.vimrc`:

```vim
" Use Vim's bundled OSC 52 provider.
set clipboard=unnamedplus
set mouse=a
let g:osc52_force_avail = 1
let g:osc52_disable_paste = 1
packadd osc52
set clipmethod=osc52
```

- `set clipboard=unnamedplus` makes plain `y` and `p` use the `+` register.
- `set mouse=a` lets Vim handle clicks, drags, and wheel events in all modes.
- `packadd osc52` loads Vim's bundled OSC 52 provider.
- `clipmethod=osc52` tells Vim to use that provider for `+` and `*`.
- `g:osc52_disable_paste` keeps Vim from issuing OSC 52 read requests; use tmux paste-buffer for tmux-buffer paste in Vim unless you choose to install a custom Vim clipboard provider.
- Same-Vim `"+y` then `"+p` works from Vim's own register state. Pasting a tmux buffer copied elsewhere with `"+p` is a known failure with this minimal config.

## Emacs

Terminal Emacs needs its xterm clipboard capability enabled. Add this to your Emacs init file:

```elisp
;; Use Emacs' terminal clipboard integration.
(setq select-enable-clipboard t)
(require 'term/xterm)
(add-to-list 'xterm-extra-capabilities 'setSelection)
(terminal-init-xterm)
```

- The e2e matrix keeps Emacs tmux-buffer copy and `C-y` round trips as known failures with this minimal config. They require a custom `interprogram-cut-function` / `interprogram-paste-function` bridge, which tmux-web does not recommend as the default path here.

## Helix

Helix detects tmux's clipboard provider. Add this to `~/.config/helix/config.toml` if you want plain `y` and `p` to use the system clipboard register:

```toml
[editor]
default-yank-register = "+"
mouse = true
```

- `default-yank-register = "+"` makes plain `y` and `p` use Helix's clipboard register instead of the internal yank register.
- `mouse = true` lets Helix handle clicks, drags, and wheel events.
- Outside tmux, Helix still needs a platform clipboard provider for the same config to support system-clipboard paste.

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
if vim.env.TMUX then
  vim.g.clipboard = {
    name = 'tmux',
    copy = {
      ['+'] = { 'tmux', 'load-buffer', '-w', '-' },
      ['*'] = { 'tmux', 'load-buffer', '-w', '-' },
    },
    paste = {
      ['+'] = { 'tmux', 'save-buffer', '-' },
      ['*'] = { 'tmux', 'save-buffer', '-' },
    },
    cache_enabled = 0,
  }
  vim.g.termfeatures = { osc52 = false }
end
vim.opt.clipboard = 'unnamedplus'
vim.opt.mouse = 'a'
```

- `clipboard=unnamedplus` makes plain `y` and `p` use the `+` register.
- `mouse=a` lets Neovim handle clicks, drags, and wheel events in all modes.
- The `vim.g.clipboard` command table uses Neovim's clipboard provider API without custom functions.
- `vim.g.termfeatures = { osc52 = false }` keeps Neovim's separate terminal OSC 52 path from bypassing tmux's paste buffer.

No plugins or custom autocmds needed.
