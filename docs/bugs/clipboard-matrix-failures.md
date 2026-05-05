# 4 clipboard-matrix tests fail on nvim (pre-existing)

Tests/e2e/clipboard-matrix.test.ts, all nvim-specific, all "tmux-web pty" mode.
Fails identically with original code (commit 0c369bb) and with sleep optimization
changes. NOT caused by sleep reduction.

## Failing tests

1. **Test: "copy in nvim with visual select and y, paste in OS"** — 60s timeout.
   Hangs after `connectTmuxWeb` → `copyFromEditorWeb`. Never reaches the
   `expect.poll` for show-buffer. Possibly `page.click('#terminal')` hangs
   because terminal still rendering initial content when keyboard interaction
   starts immediately. Tests 1+2 pass because `mirrorOsClipboardToTmuxBuffer`
   (5-10s) runs between connect and keyboard ops, giving terminal time to settle.

2. **Test: "tmux-web pty: copy in tmux copy-mode, paste in nvim in another
   tmux session with p"** — `expect.poll` timeout (5s). Browser keyboard sends
   keys to `source` session page but wants to paste in `target` session. The
   `normalPasteWeb` focuses terminal on current page (connected to `source`),
   so keys go to wrong session. Direct tmux mode equivalent passes because
   `editor.normalPaste(iso, target)` uses direct tmux socket targeting.

3. **Test: "tmux-web pty: copy in nvim with visual select and y, paste in
   same nvim using tmux paste-buffer"** — `expect.poll` timeout (5s). Race
   condition: `pasteTmuxBufferMode` web path sends browser Escape then
   immediately calls `expectEditorBufferContains` → `writeBuffer` (direct
   tmux socket). Direct keys reach PTY before browser Escape, causing write
   before paste text fully inserted.

4. **Test: "tmux-web pty: copy in nvim with visual select and y, paste in
   nvim in a different tmux session using paste-buffer"** — Same cross-session
   + race condition as #2 and #3 combined. Two bugs: wrong session for
   keyboard, plus browser/direct key race in `pasteTmuxBufferMode`.
