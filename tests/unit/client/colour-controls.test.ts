import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createColourControls } from '../../../src/client/colour-controls.js';
import type { ITheme } from '../../../src/client/colours.js';

describe('client colour controls', () => {
  test('switching #inp-colours applies the composed terminal background live', () => {
    const dom = new JSDOM('<!doctype html><body><main id="page"></main><select id="inp-colours"></select></body>');
    const document = dom.window.document;
    const page = document.getElementById('page') as HTMLElement;
    const select = document.getElementById('inp-colours') as HTMLSelectElement;
    select.add(new dom.window.Option('E2E Red', 'E2E Red'));
    select.add(new dom.window.Option('E2E Green', 'E2E Green'));

    const appliedThemes: ITheme[] = [];
    const controls = createColourControls(fixtureColours, {
      page,
      setTheme: (theme) => appliedThemes.push(theme),
      getBodyBg: () => 'rgb(10, 20, 30)',
      send: () => {},
    });
    select.addEventListener('change', () => {
      controls.apply({ colours: select.value, opacity: 0 });
    });

    select.value = 'E2E Green';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(appliedThemes).toHaveLength(1);
    expect(appliedThemes[0]!.background).toMatch(/^rgba\(\d+,\d+,\d+,0\)$/);
    expect(page.style.getPropertyValue('--tw-page-bg')).toBe('rgba(224,255,224,0)');
  });

  test('sends colour-variant message on connect and on colour change', () => {
    const dom = new JSDOM('<!doctype html><body><main id="page"></main><select id="inp-colours"></select></body>');
    const document = dom.window.document;
    const page = document.getElementById('page') as HTMLElement;
    const select = document.getElementById('inp-colours') as HTMLSelectElement;
    select.add(new dom.window.Option('E2E Red', 'E2E Red'));
    select.add(new dom.window.Option('E2E Green', 'E2E Green'));

    const sent: string[] = [];
    const controls = createColourControls(fixtureColours, {
      page,
      setTheme: () => {},
      getBodyBg: () => 'rgb(10, 20, 30)',
      send: (data) => sent.push(data),
    });
    select.addEventListener('change', () => {
      controls.sendVariant(select.value);
    });

    controls.sendVariant('E2E Red');
    expect(JSON.parse(sent.at(-1)!)).toEqual({ type: 'colour-variant', variant: 'dark' });

    select.value = 'E2E Green';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(JSON.parse(sent.at(-1)!)).toEqual({ type: 'colour-variant', variant: 'light' });
  });
});

const fixtureColours: Array<{ name: string; variant?: string; theme: ITheme }> = [
  { name: 'E2E Red', variant: 'dark', theme: { foreground: '#fff0f0', background: '#800000' } },
  { name: 'E2E Green', variant: 'light', theme: { foreground: '#102010', background: '#e0ffe0' } },
];
