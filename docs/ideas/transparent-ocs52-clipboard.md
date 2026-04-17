# Transparent OSC 52 clipboard inside tmux

## Status

**Not built.** The DCS-wrapped per-binary-consent path is live
(`src/server/protocol.ts`, `clipboard-policy.ts`, `osc52-reply.ts`).
This doc captures what we'd do to make OSC 52 reads work transparently
for unmodified clients running inside tmux — something several users
will expect given the product is "tmux-web".

## Problem statement

OSC 52 has two directions:

- **Write** (`ESC ] 52 ; c ; <base64> BEL`) — app pushes text into the
  terminal's clipboard.
- **Read** (`ESC ] 52 ; c ; ? BEL`) — app asks the terminal for the
  current clipboard; terminal replies with the same shape as a write.

Inside tmux:

- Writes flow through cleanly. With our `set-clipboard external` in the
  default `tmux.conf`, tmux forwards OSC 52 writes from a pane out to
  the outer terminal (tmux-web). Our server intercepts, decodes, and
  ships the content to the browser via a TT message; the browser calls
  `navigator.clipboard.writeText()`. No client-side special handling
  required.
- Reads do **not** flow through. tmux 3.6 has no `set-clipboard` value
  that forwards OSC 52 read queries to the outer terminal. With `on`
  tmux answers reads from its own paste buffer; with `external` / `off`
  tmux drops them. Either way, the client's plain `ESC ] 52 ; c ; ? BEL`
  never reaches us.

Current workaround: the client wraps its read in tmux's DCS passthrough
(`ESC P tmux ; <ESCs doubled> ESC \`), tmux forwards the opaque payload,
our server sees the unwrapped read, prompts the user for consent, asks
the browser for `navigator.clipboard.readText()`, and injects the OSC 52
reply into the focused pane via `tmux send-keys -H`. This works
(`/tmp/test-clipboard.sh` demonstrates the round-trip) but requires
client cooperation. Vim 9.2's bundled `osc52` package, for instance,
does not wrap, so vim-over-tmux-web `"+p` doesn't work out of the box.

## Option space

1. **Require client-side wrapping.** Status quo. Users configure their
   tool (custom `v:clipproviders` provider for Vim, `OSC52Yank`-style
   plugin variant for paste, etc.) to prepend / append the DCS frame
   when `$TMUX` is set. Strongest trust model (per-binary consent
   modal, pinnable to a blake3 digest), but not transparent.

2. **Mirror browser clipboard → tmux paste buffer.** Recommended
   transparent path. tmux's `set-clipboard on` answers OSC 52 reads
   from buffer 0. If we keep buffer 0 mirrored with the browser
   clipboard, any pane's unmodified OSC 52 read is answered with fresh
   content — no client cooperation needed. Details below.

3. **Fork tmux / patch tmux's OSC 52 handling.** Not acceptable —
   tmux-web is supposed to run against any stock tmux ≥ 3.3.

4. **Inject a shim per shell (`LD_PRELOAD` / `write()` wrapper) that
   auto-wraps OSC 52 reads in DCS.** Works in principle, fragile in
   practice, hostile to users who run unusual binaries.

5. **Ship a user-space helper the client shells out to**
   (`tmux-web-paste` that talks to the server over a unix socket and
   prints clipboard bytes). Transparent to the script; not transparent
   to apps.

## Mirror approach (option 2) design

### tmux side

- `tmux.conf` default: `set -s set-clipboard on` (revert from
  `external`). With `on`, writes still forward outward to us — tmux
  updates its own buffer *and* emits the `Ms` sequence.
- Confirm over `man tmux` for target version: reads with `on` are
  answered from "the most recently created paste buffer". That's the
  invariant we rely on.

### Server side

- New WS message type `{type: 'clipboard-mirror', text: string}` from
  client.
- On receipt: run `tmux set-buffer -b tw-mirror -- <text>`. Using a
  stable buffer name keeps tmux's buffer list from growing unbounded;
  `set-buffer` on an existing buffer is a replace + promote-to-top.
  Size cap before calling tmux (1 MiB of text — same as the
  DCS-wrapped path).
- No policy lookup, no consent prompt, no foreground-process query.
  The model is: "the browser user has approved the site's clipboard
  permission → every pane they run can read the browser clipboard."
  Matches every other terminal emulator's OSC 52 behaviour.

### Client side

- Permission-gated `navigator.clipboard.readText()` calls on:
  - `focus` event (tab regains focus — transient activation usually
    present, permission prompt fires at most once).
  - `copy` and `cut` events on the page itself (catches in-browser
    edits).
  - A low-frequency poll while the tab is visible + focused (e.g.,
    2 s) as a catch-all for user copies in other apps while the
    tab is still focused.
- Diff against last-sent content to avoid spamming the WS.
- On permission denial: silently stop trying. tmux's buffer falls
  back to whatever the user's tmux sessions already produced; vim
  `"+p` still works, just with tmux-buffer semantics.

### Coexistence with the DCS path

The two paths are orthogonal and both should remain supported:

- Mirror path: unmodified clients, no prompt, weaker trust boundary
  (browser-permission-only).
- DCS path: tmux-wrapping-aware clients (our test script, custom vim
  providers, future `kitten transfer`-style helpers), per-binary
  blake3-pinned consent persisted in `sessions.json`.

A client that emits DCS-wrapped reads always hits our server
directly, bypassing tmux's buffer entirely, so the mirror doesn't
interfere.

## Trade-offs

| Concern | Mirror | DCS path (today) |
|---|---|---|
| Transparent to stock vim / helix / etc. | Yes | No |
| Per-binary consent / audit | No | Yes |
| Hash-pinned grants | No | Yes |
| Stale on external-app copy without focus | Yes | N/A |
| Browser permission prompt | Yes (once per origin) | Yes (once per origin) |
| Works for huge clipboards | Tmux buffer limit | 1 MiB cap today |
| Binary / image clipboards | No (tmux buffers are text) | No |

## Open questions

- Does tmux's response to OSC 52 read under `set-clipboard on`
  actually always use buffer 0, or does it hit whichever buffer was
  most recently created? Needs a quick empirical check against the
  version we target.
- Does Firefox's permission flow block the background-focus polling
  path? Chromium is known-good; Firefox may need a user-visible "enable
  clipboard sync" toggle to satisfy its heuristics.
- Should we debounce / coalesce `clipboard-mirror` sends? A tight loop
  of copies in the browser could produce dozens of tmux shell-outs per
  second. Probably yes — 100 ms trailing debounce.
- Do we want a user-visible indicator ("clipboard mirrored") in the
  topbar the first time sync succeeds? Low priority.

## Files that would change

- `tmux.conf` — `set-clipboard on`, comment explaining the mirror
  semantics.
- `src/shared/types.ts` — add `clipboard-mirror` client→server message.
- `src/server/ws.ts` — handler that shells out to `tmux set-buffer -b
  tw-mirror -- <text>`. Probably a small helper in a new
  `src/server/clipboard-mirror.ts`.
- `src/client/index.ts` — focus / copy / poll listeners that read
  `navigator.clipboard.readText()` and send the message.
- Probably a new `src/client/ui/clipboard-mirror.ts` to own the
  listener lifecycle + debouncing.

## Scope estimate

~100 LOC across the files above, plus unit tests for the mirror helper
(same shape as the existing `osc52-reply` tests — mock `execFile`,
assert the `tmux set-buffer` invocation).
