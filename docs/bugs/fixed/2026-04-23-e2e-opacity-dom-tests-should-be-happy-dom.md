# Move opacity CSS-variable E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/opacity.test.ts`

## Problem

The opacity slider test only changes a number input and reads the `--tw-page-bg` custom property from `#page.style`. That is direct DOM state and does not require Playwright.

## Migrate

- `opacity slider sets rgba background-color on #page`

Suggested unit shape:

- Mount `#page`, `#btn-menu`, `#inp-opacity`, and the relevant settings DOM in happy-dom.
- Initialize the settings handler with fake theme/session data.
- Fill/change `#inp-opacity` to `50`.
- Assert `document.getElementById('page')!.style.getPropertyValue('--tw-page-bg')` ends in alpha `0.5`.

## Keep in Playwright

Keep `xterm internal elements have transparent background` in Playwright or move it only to a CSS-focused test that uses a real browser CSS engine. It checks computed style on xterm-created DOM, which is closer to browser/CSS integration than the first test.
