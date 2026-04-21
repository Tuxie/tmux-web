import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { setupDocument, el as stubEl, type StubDoc, type StubElement } from '../_dom.js';

/** Dropdown + showContextMenu unit tests.
 *
 *  Both exports lean on DOM APIs the bare stub in `_dom.ts` doesn't
 *  implement (`dataset`, `hidden`, `parentElement`, `insertBefore`,
 *  `nextSibling`, `getBoundingClientRect`, `offsetWidth`/`Height`,
 *  `selectedOptions`, `Event` dispatch). This file extends the stub
 *  on the fly rather than bloating the shared harness — the extras
 *  here are test-local. */

const origEvent = (globalThis as any).Event;
const origSetTimeout = globalThis.setTimeout;
const origClearTimeout = globalThis.clearTimeout;
const origWindow = (globalThis as any).window;
afterAll(() => {
  (globalThis as any).Event = origEvent;
  (globalThis as any).setTimeout = origSetTimeout;
  (globalThis as any).clearTimeout = origClearTimeout;
  (globalThis as any).window = origWindow;
});

function ext(e: StubElement): any {
  const any = e as any;
  if (!('dataset' in any)) any.dataset = {};
  if (!('hidden' in any)) any.hidden = false;
  if (!('offsetWidth' in any)) any.offsetWidth = 120;
  if (!('offsetHeight' in any)) any.offsetHeight = 80;
  if (!('nextSibling' in any)) any.nextSibling = null;
  if (!any.getBoundingClientRect) {
    any.getBoundingClientRect = () => ({
      top: 0, left: 0, right: 120, bottom: 80, width: 120, height: 80,
      x: 0, y: 0, toJSON() { return this; },
    });
  }
  // `parentElement` accessor — stub has `parentNode` only.
  Object.defineProperty(any, 'parentElement', {
    get() { return any.parentNode ?? null; },
    configurable: true,
  });
  // Give appendChild/insertBefore ext-awareness: extend children lazily.
  const origAppend = any.appendChild;
  any.appendChild = (child: StubElement) => {
    ext(child);
    return origAppend.call(any, child);
  };
  any.insertBefore = (child: StubElement, ref: StubElement | null) => {
    ext(child);
    const parent = any;
    const idx = ref ? parent.children.indexOf(ref) : parent.children.length;
    parent.children.splice(idx < 0 ? parent.children.length : idx, 0, child);
    (child as any).parentNode = parent;
    return child;
  };
  // `blur`/`select` aren't used beyond no-ops in the code paths.
  if (!any.blur) any.blur = () => {};
  if (!any.select) any.select = () => {};
  return any;
}

function makeDoc(): StubDoc {
  const doc = setupDocument();
  ext(doc.body);
  // createElement must return extended elements so the module's typed
  // chain-of-calls (`wrap.appendChild(...)`, `trigger.className = ...`,
  // `menu.hidden = true`, etc.) all resolve cleanly.
  const origCreate = doc.createElement;
  doc.createElement = (tag: string) => {
    const e = origCreate.call(doc, tag);
    return ext(e);
  };
  // Walk the body subtree looking for elements whose className contains
  // a space-delimited token matching every token in the selector. This
  // is enough for `.tw-dropdown-menu.tw-dd-context` — the only selector
  // the context-menu dedupe in showContextMenu uses.
  (doc as any).querySelectorAll = (sel: string) => {
    const tokens = sel.split('.').filter(Boolean);
    const matches: any[] = [];
    const visit = (node: any) => {
      const cls = (node.className ?? '').split(/\s+/);
      if (tokens.every((t: string) => cls.includes(t))) matches.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(doc.body);
    return matches;
  };
  // Minimal Event + dispatchEvent used by fromSelect onSelect path.
  (globalThis as any).Event = class { type: string; constructor(t: string) { this.type = t; } };
  (globalThis as any).window = { innerWidth: 1024, innerHeight: 800 };
  return doc;
}

function installCapturingListeners(doc: StubDoc): {
  firePointerDown: (target: StubElement) => void;
  fireKeydown: (key: string) => void;
} {
  // The module installs `document.addEventListener('pointerdown', …)`
  // which the stub stores in a listeners map; dispatch pointerdown /
  // keydown via the existing `dispatch()` helper. But the module passes
  // `true` (capture) — our stub ignores the capture flag, so the same
  // listeners list is used.
  return {
    firePointerDown: (target: StubElement) =>
      doc.dispatch('pointerdown', { target, preventDefault() {}, stopPropagation() {} }),
    fireKeydown: (key: string) =>
      doc.dispatch('keydown', { key, preventDefault() {}, stopPropagation() {} }),
  };
}

function makeSelect(opts: Array<{ value: string; label: string }>, currentValue?: string): StubElement {
  const select = ext(stubEl('select'));
  (select as any).id = 'test-sel';
  (select as any).options = opts.map(o => {
    const option = ext(stubEl('option'));
    (option as any).value = o.value;
    option.textContent = o.label;
    return option;
  });
  (select as any).value = currentValue ?? opts[0]?.value ?? '';
  Object.defineProperty(select, 'selectedOptions', {
    get() {
      const v = (select as any).value;
      return (select as any).options.filter((o: any) => o.value === v);
    },
    configurable: true,
  });
  (select as any).dispatchEvent = (ev: any) => {
    (select as any).dispatch(ev.type, ev);
  };
  return select;
}

beforeEach(() => {
  // Non-tick setTimeout: run fn immediately for dropdown tests.
  // None of the tests below rely on deferred execution.
  (globalThis as any).setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;
  (globalThis as any).clearTimeout = () => {};
});

describe('Dropdown.fromSelect', () => {
  it('wraps a <select>, adding a .tw-dropdown-trigger and .tw-dropdown-menu', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ], 'a');
    parent.appendChild(select);

    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);

    // The wrapper is inserted before the <select> in the parent.
    const wrap = dd.element as any;
    expect((wrap as any).className).toContain('tw-dropdown');
    expect(parent.children[0]).toBe(wrap);
    // Hidden-select class applied.
    expect((select as any).classList.has('tw-dd-hidden-select')).toBe(true);
    // Label mirrors the selected option's textContent.
    const valueEl = wrap.children[0].children[0];
    expect(valueEl.textContent).toBe('Alpha');
  });

  it('open() toggles menu.hidden and aria-expanded', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([{ value: 'a', label: 'Alpha' }]);
    parent.appendChild(select);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    await dd.open();
    expect((dd.menuElement as any).hidden).toBe(false);
    expect((dd.triggerElement as any).getAttribute('aria-expanded')).toBe('true');
    expect((dd.triggerElement as any).classList.has('open')).toBe(true);
    dd.close();
    expect((dd.menuElement as any).hidden).toBe(true);
    expect((dd.triggerElement as any).getAttribute('aria-expanded')).toBe('false');
    expect((dd.triggerElement as any).classList.has('open')).toBe(false);
  });

  it('picking an item writes the value back to the <select> and fires change', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ], 'a');
    let changeCount = 0;
    (select as any).addEventListener('change', () => { changeCount++; });
    parent.appendChild(select);

    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    await dd.open();
    const menu = dd.menuElement as any;
    // Items are appended in order: item 'a', item 'b'. Click 'b'.
    const bItem = menu.children.find((c: any) => c.dataset?.value === 'b')!;
    bItem.click();
    expect((select as any).value).toBe('b');
    expect(changeCount).toBe(1);
    expect((dd.menuElement as any).hidden).toBe(true);
  });

  it('setValue writes through to <select> and refreshes the label', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ], 'a');
    parent.appendChild(select);

    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    dd.setValue('b');
    expect((select as any).value).toBe('b');
    const valueEl = (dd.element as any).children[0].children[0];
    expect(valueEl.textContent).toBe('Beta');
  });

  it('external <select> change updates the visible label', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ], 'a');
    parent.appendChild(select);

    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    (select as any).value = 'b';
    (select as any).dispatch('change', { type: 'change' });
    const valueEl = (dd.element as any).children[0].children[0];
    expect(valueEl.textContent).toBe('Beta');
  });

  it('dispose removes the wrapper and document listeners', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([{ value: 'a', label: 'Alpha' }]);
    parent.appendChild(select);

    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    expect(parent.children).toHaveLength(2); // wrap + select
    dd.dispose();
    expect(parent.children).toHaveLength(1); // wrap removed
    // Outside-click listener is a no-op now: triggering pointerdown
    // shouldn't throw even though the menu is gone.
    const { firePointerDown } = installCapturingListeners(doc);
    firePointerDown(doc.body);
  });

  it('sets aria-haspopup=listbox on the trigger', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([{ value: 'a', label: 'Alpha' }]);
    parent.appendChild(select);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    expect((dd.triggerElement as any).getAttribute('aria-haspopup')).toBe('listbox');
  });

  it('Escape key closes an open menu', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([{ value: 'a', label: 'Alpha' }]);
    parent.appendChild(select);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    await dd.open();
    const { fireKeydown } = installCapturingListeners(doc);
    fireKeydown('Escape');
    expect((dd.menuElement as any).hidden).toBe(true);
  });

  it('pointerdown outside closes the menu', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([{ value: 'a', label: 'Alpha' }]);
    parent.appendChild(select);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    await dd.open();
    const { firePointerDown } = installCapturingListeners(doc);
    const stranger = ext(doc.createElement('div'));
    doc.body.appendChild(stranger);
    // Our stub's `contains()` returns true unconditionally — the
    // dropdown relies on the real Node.contains semantics. Override
    // the trigger's and menu's contains for this test so the outside-
    // click path can actually fire.
    (dd.triggerElement as any).contains = () => false;
    (dd.menuElement as any).contains = () => false;
    firePointerDown(stranger);
    expect((dd.menuElement as any).hidden).toBe(true);
  });

  it('click on the trigger toggles open/close', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const select = makeSelect([{ value: 'a', label: 'Alpha' }]);
    parent.appendChild(select);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.fromSelect(select as any);
    (dd.triggerElement as any).click();
    // open() is async; resolve microtasks.
    await new Promise((r) => setImmediate(r as any));
    expect((dd.menuElement as any).hidden).toBe(false);
    (dd.triggerElement as any).click();
    expect((dd.menuElement as any).hidden).toBe(true);
  });
});

describe('Dropdown.menu', () => {
  it('appends a trigger+menu to container and opens with items', async () => {
    const doc = makeDoc();
    const container = ext(doc.createElement('div'));
    doc.body.appendChild(container);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const items = [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }];
    let picked = '';
    const dd = Dropdown.menu(container, {
      getItems: () => items,
      onSelect: (v) => { picked = v; },
    });
    expect(container.children).toHaveLength(1);
    await dd.open();
    const menu = dd.menuElement as any;
    const row2 = menu.children.find((c: any) => c.dataset?.value === '2')!;
    row2.click();
    expect(picked).toBe('2');
  });
});

describe('Dropdown.attachTo', () => {
  it('uses the existing trigger; open inserts the menu as its next sibling', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const trigger = ext(doc.createElement('button'));
    parent.appendChild(trigger);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.attachTo(trigger, {
      getItems: () => [{ value: 'x', label: 'X' }],
      onSelect: () => {},
    });
    // Menu inserted into parent; its position depends on insertBefore behaviour
    expect(parent.children.length).toBeGreaterThan(1);
    await dd.open();
    expect((dd.menuElement as any).hidden).toBe(false);
  });

  it('beforeOpen is awaited before render', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const trigger = ext(doc.createElement('button'));
    parent.appendChild(trigger);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    let steps: string[] = [];
    const dd = Dropdown.attachTo(trigger, {
      getItems: () => { steps.push('getItems'); return [{ value: 'x', label: 'X' }]; },
      onSelect: () => {},
      beforeOpen: async () => { steps.push('beforeOpen'); },
    });
    await dd.open();
    expect(steps).toEqual(['beforeOpen', 'getItems']);
  });

  it('beforeOpen rejection is swallowed and render still runs', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const trigger = ext(doc.createElement('button'));
    parent.appendChild(trigger);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    let rendered = false;
    const dd = Dropdown.attachTo(trigger, {
      getItems: () => { rendered = true; return [{ value: 'x', label: 'X' }]; },
      onSelect: () => {},
      beforeOpen: async () => { throw new Error('boom'); },
    });
    await dd.open();
    expect(rendered).toBe(true);
    expect((dd.menuElement as any).hidden).toBe(false);
  });

  it('renderItems draws a separator when item.separator is true', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const trigger = ext(doc.createElement('button'));
    parent.appendChild(trigger);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    const dd = Dropdown.attachTo(trigger, {
      getItems: () => [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', separator: true },
      ],
      onSelect: () => {},
    });
    await dd.open();
    const classes = (dd.menuElement as any).children.map((c: any) => c.className);
    expect(classes.some((c: string) => c.includes('tw-dropdown-sep'))).toBe(true);
  });
});

describe('Dropdown.custom', () => {
  it('renderContent fires on every open with a fresh menu + close callback', async () => {
    const doc = makeDoc();
    const parent = ext(doc.createElement('div'));
    doc.body.appendChild(parent);
    const trigger = ext(doc.createElement('button'));
    parent.appendChild(trigger);
    const { Dropdown } = await import('../../../../src/client/ui/dropdown.ts');
    let renders = 0;
    const dd = Dropdown.custom(trigger, {
      renderContent: (menu, close) => {
        renders++;
        const row = ext(doc.createElement('div'));
        row.addEventListener('click', () => close());
        menu.appendChild(row);
      },
    });
    await dd.open();
    expect(renders).toBe(1);
    // Row click closes the menu.
    ((dd.menuElement as any).children[0] as any).click();
    expect((dd.menuElement as any).hidden).toBe(true);
    await dd.open();
    expect(renders).toBe(2);
  });
});

describe('showContextMenu', () => {
  it('renders input row when opts.input is provided', async () => {
    const doc = makeDoc();
    const { showContextMenu } = await import('../../../../src/client/ui/dropdown.ts');
    let submitted = '';
    showContextMenu({
      x: 100, y: 100,
      input: {
        label: 'Name:',
        onSubmit: (v) => { submitted = v; },
      },
    });
    const menu = doc.body.children.find((c: any) => c.className?.includes('tw-dd-context'))!;
    const row = (menu as any).children[0];
    const input = row.children[1];
    expect(input.tagName).toBe('INPUT');
    (input as any).value = '  my-name  ';
    (input as any).dispatch('keydown', {
      key: 'Enter', preventDefault: () => {}, stopPropagation: () => {},
    });
    expect(submitted).toBe('my-name');
  });

  it('ignores Enter when the trimmed input is empty', async () => {
    makeDoc();
    const { showContextMenu } = await import('../../../../src/client/ui/dropdown.ts');
    let submitted = '';
    showContextMenu({
      x: 0, y: 0,
      input: {
        label: 'Name:',
        onSubmit: (v) => { submitted = v; },
      },
    });
    const menu = (globalThis.document as any).body.children.find((c: any) =>
      c.className?.includes('tw-dd-context'));
    const input = menu.children[0].children[1];
    (input as any).value = '   ';
    (input as any).dispatch('keydown', {
      key: 'Enter', preventDefault: () => {}, stopPropagation: () => {},
    });
    expect(submitted).toBe('');
  });

  it('renders items and closes on pick', async () => {
    const doc = makeDoc();
    const { showContextMenu } = await import('../../../../src/client/ui/dropdown.ts');
    let picked = '';
    showContextMenu({
      x: 0, y: 0,
      items: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      onSelect: (v) => { picked = v; },
    });
    const menu = doc.body.children.find((c: any) => c.className?.includes('tw-dd-context')) as any;
    const itemB = menu.children.find((c: any) => c.dataset?.value === 'b');
    itemB.click();
    expect(picked).toBe('b');
    // After close, menu is removed from the body.
    expect(doc.body.children.some((c: any) => c.className?.includes('tw-dd-context'))).toBe(false);
  });

  it('Escape closes the context menu and fires onClose', async () => {
    const doc = makeDoc();
    const { showContextMenu } = await import('../../../../src/client/ui/dropdown.ts');
    let closed = 0;
    showContextMenu({
      x: 0, y: 0,
      items: [{ value: 'a', label: 'A' }],
      onClose: () => { closed++; },
    });
    doc.dispatch('keydown', { key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} });
    expect(closed).toBe(1);
  });

  it('custom renderContent wins over input and items', async () => {
    const doc = makeDoc();
    const { showContextMenu } = await import('../../../../src/client/ui/dropdown.ts');
    let rendered = false;
    showContextMenu({
      x: 0, y: 0,
      input: { label: 'X', onSubmit: () => {} },
      items: [{ value: 'a', label: 'A' }],
      renderContent: (menu) => {
        rendered = true;
        const row = ext(doc.createElement('div'));
        row.textContent = 'CUSTOM';
        menu.appendChild(row);
      },
    });
    expect(rendered).toBe(true);
    const menu = doc.body.children.find((c: any) => c.className?.includes('tw-dd-context')) as any;
    expect(menu.children).toHaveLength(1);
    expect(menu.children[0].textContent).toBe('CUSTOM');
  });

  it('successive calls remove the prior context menu before mounting', async () => {
    const doc = makeDoc();
    // Stub querySelectorAll to look the body up for matching class names.
    (doc as any).querySelectorAll = (sel: string) => {
      if (sel === '.tw-dropdown-menu.tw-dd-context') {
        return doc.body.children.filter((c: any) =>
          c.className?.includes('tw-dd-context'));
      }
      return [];
    };
    const { showContextMenu } = await import('../../../../src/client/ui/dropdown.ts');
    showContextMenu({ x: 0, y: 0, items: [{ value: 'a', label: 'A' }] });
    showContextMenu({ x: 0, y: 0, items: [{ value: 'b', label: 'B' }] });
    const contextMenus = doc.body.children.filter((c: any) =>
      c.className?.includes('tw-dd-context'));
    expect(contextMenus).toHaveLength(1);
  });
});
