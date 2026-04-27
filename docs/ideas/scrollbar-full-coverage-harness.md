# Full unit coverage for `src/client/ui/scrollbar.ts`

## What we want

Bring `src/client/ui/scrollbar.ts` to the project's standard 95% line /
90% function coverage gate. After the v1.10.0 Workbench-scrollbar
expansion the file sits around 22% line / 87% function under the
existing harness in `tests/unit/client/ui/scrollbar.test.ts`.

## Why it isn't already there

`createScrollbarController` is dominated by closure-based event
handlers and timer state machines that the current `_dom.ts` stub
cannot trigger end-to-end:

- Drag rAF coalescing: `flushDragSend` runs on
  `requestAnimationFrame`, with de-duplication against the last sent
  position. Need a fake-rAF harness that lets a test step "one frame
  forward" deterministically.
- Hold-to-repeat arrows: `mousedown` on `.tw-scrollbar-up` /
  `.tw-scrollbar-down` schedules `arrowDelayTimer` (320 ms initial
  delay) then `arrowRepeatTimer` (60 ms cadence). Want fake timers
  that advance virtual time and assert send count vs. duration.
- Autohide reveal: `setVisible(true) → scheduleHide() → setVisible(
  false)` fires off `setTimeout(AUTOHIDE_HIDE_MS)`. Same fake-timer
  needed.
- Resize gadget: anchored at the page bottom with a clip-path
  triangle, currently a no-op for left-clicks but exposes a hover
  rectangle. Coverage needs a hover-to-cursor stub.
- Dispose teardown: removes mouse / wheel listeners, clears all
  three timers, releases the rAF handle, drops the `dragging` /
  `visible` classes. Want a leak-check that asserts every
  `addEventListener` call has a matching `removeEventListener`.

## Cost vs. value

Probably ~30 mechanical cases (see topbar-full-coverage-harness.md
for the precedent). The closure-heavy structure means a single fake-
timer + fake-rAF helper unlocks most of them at once, but the
upfront helper itself is the bulk of the work. Until that lands
the file is in `EXCLUDES` in `scripts/check-coverage.ts` so the
unrelated 1.10.x work isn't gated on this harness.
