# Move window menu/tab E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/windows.test.ts`

## Problem

Every test in this file renders window tabs/menus, clicks custom controls, and checks DOM classes or captured WebSocket messages. None of the assertions require browser rendering, xterm behavior, or a live server.

## Migrate

- `window tabs render with correct labels`
- `active window tab has class "active", inactive does not`
- `clicking a window tab sends a select-window message for that tab`
- `right-click on the windows button sends a new-window message`
- `left-click on the windows button opens the rich windows menu`
- `New window input in the menu creates a named window`
- `Name input in the menu renames the current window`
- `unchecking Show windows as tabs hides the tab buttons`
- `right-click on a window tab opens a Name input + Close window item`
- `editing the Name input and pressing Enter sends rename-window`
- `pressing Enter with the name unchanged does not send rename`
- `Close window from context menu sends a close-window message for that tab`
- `context menu closes on Escape and on outside click`

Suggested unit shape:

- Mount `#win-tabs` and any required topbar/menu roots in happy-dom.
- Initialize the window UI module with fixture windows and a fake WebSocket send callback.
- Dispatch click/contextmenu/input/keydown events.
- Assert DOM rows, labels, classes, checkbox state, menu removal, and exact outbound payloads.

The Playwright file should be removable after equivalent unit coverage exists.
