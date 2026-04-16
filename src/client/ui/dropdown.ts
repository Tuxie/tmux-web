/**
 * Themable custom dropdown component.
 *
 * Three entry points:
 *
 *  1. `Dropdown.fromSelect(select)` — wraps an existing `<select>`. The
 *     `<select>` stays in the DOM as source of truth (hidden via the
 *     `tw-dd-hidden-select` CSS class). Picks write the new value into the
 *     `<select>` and dispatch a `change` event, so existing listeners and
 *     Playwright's `selectOption` keep working.
 *
 *  2. `Dropdown.menu(container, opts)` — standalone dropdown that builds its
 *     own trigger button. Items rebuilt on open via `opts.getItems()`.
 *
 *  3. `Dropdown.attachTo(trigger, opts)` — reuses an *existing* element as
 *     the trigger (e.g. an existing tb-btn). Caller must ensure the trigger's
 *     parent is `position: relative` so the menu anchors correctly.
 *
 * Styling hooks:
 *   .tw-dropdown                wrapper (modes 1 and 2)
 *   .tw-dropdown-trigger        built-in trigger button
 *   .tw-dropdown-value          span holding the selected label
 *   .tw-dropdown-arrow          span holding the ▾ glyph
 *   .tw-dropdown-menu           the popup list
 *   .tw-dropdown-item           an item inside the popup (+ .selected)
 *   .tw-dropdown-sep            separator line between items
 *   .tw-dd-hidden-select        applied to the wrapped <select> in mode 1
 */

export interface DropdownItem {
  value: string;
  label: string;
  /** When true, render a separator line immediately above this item. */
  separator?: boolean;
}

export interface MenuDropdownOptions {
  getItems: () => DropdownItem[];
  onSelect: (value: string) => void;
  /** Extra class on the wrapper / menu for theming hooks. */
  className?: string;
  /**
   * Awaited before the menu is rendered on open. Lets callers refresh async
   * data (e.g. fetch sessions) right before the user sees it.
   */
  beforeOpen?: () => void | Promise<void>;
}

function createTriggerShell(className: string | undefined): {
  wrap: HTMLDivElement;
  trigger: HTMLButtonElement;
  valueEl: HTMLSpanElement;
} {
  const wrap = document.createElement('div');
  wrap.className = 'tw-dropdown' + (className ? ' ' + className : '');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tw-dropdown-trigger';

  const valueEl = document.createElement('span');
  valueEl.className = 'tw-dropdown-value';

  const arrow = document.createElement('span');
  arrow.className = 'tw-dropdown-arrow';
  arrow.textContent = '\u25BE'; // ▾

  trigger.appendChild(valueEl);
  trigger.appendChild(arrow);
  wrap.appendChild(trigger);
  return { wrap, trigger, valueEl };
}

function createMenu(className: string | undefined): HTMLDivElement {
  const menu = document.createElement('div');
  menu.className = 'tw-dropdown-menu' + (className ? ' ' + className + '-menu' : '');
  menu.hidden = true;
  return menu;
}

function renderItems(
  menu: HTMLElement,
  items: DropdownItem[],
  selectedValue: string | null,
  onPick: (value: string) => void,
): void {
  menu.innerHTML = '';
  for (const item of items) {
    if (item.separator) {
      const hr = document.createElement('hr');
      hr.className = 'tw-dropdown-sep';
      menu.appendChild(hr);
    }
    const el = document.createElement('div');
    el.className = 'tw-dropdown-item';
    if (selectedValue !== null && item.value === selectedValue) {
      el.classList.add('selected');
    }
    el.textContent = item.label;
    el.dataset.value = item.value;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onPick(item.value);
    });
    menu.appendChild(el);
  }
}

/**
 * One-shot context popup positioned at viewport coordinates (typically
 * mouse cursor from a contextmenu event). Shares the `.tw-dropdown-menu`
 * styling so themes apply automatically. Dismisses on outside click,
 * Escape, input submit, or item selection.
 *
 * The popup can contain either / both:
 *   - A single labelled input row at the top (submits trimmed value on
 *     Enter via `input.onSubmit`). Receives focus when shown.
 *   - Clickable items below (pick fires `onSelect(value)`).
 */
export interface ContextMenuOptions {
  x: number;
  y: number;
  className?: string;
  input?: {
    label: string;
    placeholder?: string;
    defaultValue?: string;
    onSubmit: (value: string) => void;
  };
  items?: DropdownItem[];
  onSelect?: (value: string) => void;
  /**
   * Fully custom menu body. When provided, `input` and `items` are ignored
   * and the callback owns everything inside the menu. Receives the empty
   * menu element plus a `close()` function for row click handlers to
   * dismiss the menu on selection.
   */
  renderContent?: (menu: HTMLElement, close: () => void) => void;
  /** Invoked after the menu is torn down (selection, outside click, Escape). */
  onClose?: () => void;
  /**
   * When true, treat `x` as the menu's right edge (not its left edge).
   * The menu is shifted left by its own measured width after mount so
   * its right border lines up with the anchor's right edge.
   */
  alignRight?: boolean;
  /**
   * Minimum width in CSS pixels. The base `.tw-dropdown-menu` sets
   * `min-width: 100%` which is useless for position:fixed (resolves to
   * viewport width), so the context menu strips it via `.tw-dd-context`;
   * pass `minWidth` to restore a sensible width — typically the trigger's
   * measured width so the menu lines up visually with what opened it.
   */
  minWidth?: number;
}

export function showContextMenu(opts: ContextMenuOptions): void {
  // Only one context menu at a time — close any lingering ones.
  document.querySelectorAll('.tw-dropdown-menu.tw-dd-context')
    .forEach(m => m.remove());

  const menu = document.createElement('div');
  // Append '-menu' suffix to `className` to match Dropdown.custom /
  // Dropdown.menu conventions (createMenu does the same). This lets
  // theme CSS target e.g. `.tw-dd-windows-menu` with the same naming it
  // uses for `.tw-dd-sessions-menu` without a separate case for context
  // menus.
  const extra = opts.className ? ' ' + opts.className + '-menu' : '';
  menu.className = 'tw-dropdown-menu tw-dd-context' + extra;
  menu.style.position = 'fixed';
  menu.style.top = opts.y + 'px';
  menu.style.left = opts.x + 'px';
  if (opts.minWidth !== undefined) {
    menu.style.minWidth = opts.minWidth + 'px';
  }

  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onEsc, true);
    opts.onClose?.();
  };
  const outside = (ev: PointerEvent) => {
    if (!menu.contains(ev.target as Node)) close();
  };
  const onEsc = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };

  let inputEl: HTMLInputElement | null = null;
  if (opts.renderContent) {
    opts.renderContent(menu, close);
  } else if (opts.input) {
    const inputConfig = opts.input;
    const row = document.createElement('div');
    row.className = 'menu-row menu-row-static';
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = inputConfig.label;
    row.appendChild(label);

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'tw-dd-input';
    if (inputConfig.placeholder) inputEl.placeholder = inputConfig.placeholder;
    if (inputConfig.defaultValue) inputEl.value = inputConfig.defaultValue;
    inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const value = inputEl!.value.trim();
        close();
        if (value) inputConfig.onSubmit(value);
      }
    });
    row.appendChild(inputEl);
    menu.appendChild(row);
  }

  if (!opts.renderContent && opts.items?.length) {
    // Append items directly — don't use renderItems(), which would wipe the
    // input row above.
    for (const item of opts.items) {
      if (item.separator) {
        const hr = document.createElement('hr');
        hr.className = 'tw-dropdown-sep';
        menu.appendChild(hr);
      }
      const el = document.createElement('div');
      el.className = 'tw-dropdown-item';
      el.textContent = item.label;
      el.dataset.value = item.value;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        close();
        opts.onSelect?.(item.value);
      });
      menu.appendChild(el);
    }
  }

  document.body.appendChild(menu);

  // Right-align: x was the anchor's right edge, shift the menu left by its
  // own width so its right border lands exactly there.
  if (opts.alignRight) {
    menu.style.left = Math.max(0, opts.x - menu.offsetWidth) + 'px';
  }

  // Clamp to viewport — avoid overflowing the right/bottom edge.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = Math.max(0, window.innerWidth - rect.width - 4) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = Math.max(0, window.innerHeight - rect.height - 4) + 'px';
  }

  // contextmenu fires after pointerdown, so attaching synchronously is safe.
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onEsc, true);

  if (inputEl) {
    inputEl.focus();
    inputEl.select();
  }
}

export class Dropdown {
  private trigger: HTMLElement;
  private menu: HTMLDivElement;
  private wrap: HTMLElement | null;     // null in attachTo mode
  private valueEl: HTMLElement | null;  // null in attachTo mode
  private select: HTMLSelectElement | null;
  private getItems: () => DropdownItem[];
  private onSelect: (value: string) => void;
  private outsideHandler: (ev: PointerEvent) => void;
  private keyHandler: (ev: KeyboardEvent) => void;
  private selectChangeHandler: (() => void) | null = null;

  private beforeOpen: (() => void | Promise<void>) | undefined;
  /** Custom content renderer for `Dropdown.custom`. When set, it takes
   *  priority over the items-based rendering. */
  private renderContent: ((menu: HTMLElement, close: () => void) => void) | undefined;

  private constructor(args: {
    trigger: HTMLElement;
    menu: HTMLDivElement;
    wrap: HTMLElement | null;
    valueEl: HTMLElement | null;
    select: HTMLSelectElement | null;
    getItems: () => DropdownItem[];
    onSelect: (value: string) => void;
    beforeOpen?: () => void | Promise<void>;
    renderContent?: (menu: HTMLElement, close: () => void) => void;
  }) {
    this.trigger = args.trigger;
    this.menu = args.menu;
    this.wrap = args.wrap;
    this.valueEl = args.valueEl;
    this.select = args.select;
    this.getItems = args.getItems;
    this.onSelect = args.onSelect;
    this.beforeOpen = args.beforeOpen;
    this.renderContent = args.renderContent;

    this.trigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this.menu.hidden) void this.open();
      else this.close();
    });

    this.outsideHandler = (ev) => {
      if (this.menu.hidden) return;
      const target = ev.target as Node;
      if (this.trigger.contains(target) || this.menu.contains(target)) return;
      this.close();
    };
    this.keyHandler = (ev) => {
      if (!this.menu.hidden && ev.key === 'Escape') {
        this.close();
        (this.trigger as HTMLElement).blur();
      }
    };
    document.addEventListener('pointerdown', this.outsideHandler);
    document.addEventListener('keydown', this.keyHandler);

    if (this.select) {
      this.selectChangeHandler = () => this.syncLabelFromSelect();
      this.select.addEventListener('change', this.selectChangeHandler);
      this.syncLabelFromSelect();
    }
  }

  /**
   * Wrap an existing `<select>`. Options and value are read live from the
   * `<select>`; picks write through and dispatch `change`.
   */
  static fromSelect(select: HTMLSelectElement, className?: string): Dropdown {
    const shell = createTriggerShell(className);
    const menu = createMenu(className);
    shell.wrap.appendChild(menu);
    select.classList.add('tw-dd-hidden-select');
    select.parentElement!.insertBefore(shell.wrap, select);
    // Mirror the <select>'s id on the new visible elements so tests can target
    // them without guessing structure (e.g. #inp-font-bundled-btn).
    if (select.id) {
      shell.wrap.id = select.id + '-dd';
      shell.trigger.id = select.id + '-btn';
    }

    return new Dropdown({
      trigger: shell.trigger,
      menu,
      wrap: shell.wrap,
      valueEl: shell.valueEl,
      select,
      getItems: () => Array.from(select.options).map(opt => ({
        value: opt.value,
        label: opt.textContent ?? opt.value,
      })),
      onSelect: (value) => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      },
    });
  }

  /**
   * Create a standalone dropdown (trigger + menu) and append to `container`.
   */
  static menu(container: HTMLElement, opts: MenuDropdownOptions): Dropdown {
    const shell = createTriggerShell(opts.className);
    const menu = createMenu(opts.className);
    shell.wrap.appendChild(menu);
    container.appendChild(shell.wrap);

    return new Dropdown({
      trigger: shell.trigger,
      menu,
      wrap: shell.wrap,
      valueEl: shell.valueEl,
      select: null,
      getItems: opts.getItems,
      onSelect: opts.onSelect,
      beforeOpen: opts.beforeOpen,
    });
  }

  /**
   * Attach a dropdown menu to an *existing* element. The caller keeps full
   * control over the trigger's markup and styling. The menu is inserted as
   * the trigger's next sibling; the caller must ensure the trigger's parent
   * is `position: relative` so the menu anchors correctly.
   */
  static attachTo(trigger: HTMLElement, opts: MenuDropdownOptions): Dropdown {
    const menu = createMenu(opts.className);
    trigger.parentElement!.insertBefore(menu, trigger.nextSibling);

    return new Dropdown({
      trigger,
      menu,
      wrap: null,
      valueEl: null,
      select: null,
      getItems: opts.getItems,
      onSelect: opts.onSelect,
      beforeOpen: opts.beforeOpen,
    });
  }

  /**
   * Like attachTo but with fully custom menu content rendered by the caller.
   * The Dropdown class still handles click-toggle, outside-click / Escape
   * dismissal, and the `.open` class on the trigger; the caller just owns
   * the menu body. `renderContent` is invoked on every open with an empty
   * menu element and a `close()` callback so items/rows can dismiss on
   * selection.
   */
  static custom(
    trigger: HTMLElement,
    opts: {
      renderContent: (menu: HTMLElement, close: () => void) => void;
      className?: string;
      beforeOpen?: () => void | Promise<void>;
    },
  ): Dropdown {
    const menu = createMenu(opts.className);
    trigger.parentElement!.insertBefore(menu, trigger.nextSibling);

    return new Dropdown({
      trigger,
      menu,
      wrap: null,
      valueEl: null,
      select: null,
      getItems: () => [],
      onSelect: () => { /* unused */ },
      beforeOpen: opts.beforeOpen,
      renderContent: opts.renderContent,
    });
  }

  /**
   * The outer wrapper for `fromSelect` / `menu` modes. In `attachTo` mode
   * there is no wrapper (the caller owns the trigger), and this returns the
   * trigger itself so callers can still query/size the visible element.
   */
  get element(): HTMLElement { return this.wrap ?? this.trigger; }
  get menuElement(): HTMLElement { return this.menu; }
  get triggerElement(): HTMLElement { return this.trigger; }

  /**
   * Programmatically set the selected value. For `fromSelect` mode this
   * writes to the wrapped <select> and refreshes the visible label —
   * necessary because setting `<select>.value` does not fire a `change`
   * event. No-op in standalone / attachTo modes.
   */
  setValue(value: string): void {
    if (!this.select) return;
    this.select.value = value;
    this.syncLabelFromSelect();
  }

  private syncLabelFromSelect(): void {
    if (!this.select || !this.valueEl) return;
    const opt = this.select.selectedOptions[0];
    this.valueEl.textContent = opt?.textContent ?? this.select.value;
  }

  private currentValue(): string | null {
    return this.select ? this.select.value : null;
  }

  private handlePick(value: string): void {
    this.close();
    this.onSelect(value);
  }

  async open(): Promise<void> {
    if (this.beforeOpen) {
      try { await this.beforeOpen(); } catch { /* ignore */ }
    }
    if (this.renderContent) {
      this.menu.innerHTML = '';
      this.renderContent(this.menu, () => this.close());
    } else {
      renderItems(this.menu, this.getItems(), this.currentValue(), (v) => this.handlePick(v));
    }
    this.menu.hidden = false;
    this.trigger.classList.add('open');
    if (this.wrap) this.wrap.classList.add('open');
  }

  close(): void {
    this.menu.hidden = true;
    this.trigger.classList.remove('open');
    if (this.wrap) this.wrap.classList.remove('open');
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.outsideHandler);
    document.removeEventListener('keydown', this.keyHandler);
    if (this.select && this.selectChangeHandler) {
      this.select.removeEventListener('change', this.selectChangeHandler);
    }
    if (this.wrap) this.wrap.remove();
    else this.menu.remove();
  }
}
