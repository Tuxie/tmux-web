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
 * One-shot context menu positioned at viewport coordinates (typically
 * mouse cursor from a contextmenu event). Shares the `.tw-dropdown-menu`
 * styling so themes apply automatically. Dismisses on outside click,
 * Escape, or selection.
 */
export interface ContextMenuOptions {
  x: number;
  y: number;
  items: DropdownItem[];
  onSelect: (value: string) => void;
  /** Extra class appended to the menu element, e.g. 'tw-dd-context-win'. */
  className?: string;
}

export function showContextMenu(opts: ContextMenuOptions): void {
  // Only one context menu at a time — close any lingering ones.
  document.querySelectorAll('.tw-dropdown-menu.tw-dd-context')
    .forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'tw-dropdown-menu tw-dd-context'
    + (opts.className ? ' ' + opts.className : '');
  menu.style.position = 'fixed';
  menu.style.top = opts.y + 'px';
  menu.style.left = opts.x + 'px';

  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onEsc, true);
  };
  const outside = (ev: PointerEvent) => {
    if (!menu.contains(ev.target as Node)) close();
  };
  const onEsc = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };

  renderItems(menu, opts.items, null, (v) => {
    close();
    opts.onSelect(v);
  });

  document.body.appendChild(menu);

  // Clamp to viewport — avoid overflowing the right/bottom edge.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = Math.max(0, window.innerWidth - rect.width - 4) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = Math.max(0, window.innerHeight - rect.height - 4) + 'px';
  }

  // contextmenu fires after pointerdown, so attaching synchronously is safe:
  // the right-click's own pointerdown has already been dispatched.
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onEsc, true);
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

  private constructor(args: {
    trigger: HTMLElement;
    menu: HTMLDivElement;
    wrap: HTMLElement | null;
    valueEl: HTMLElement | null;
    select: HTMLSelectElement | null;
    getItems: () => DropdownItem[];
    onSelect: (value: string) => void;
    beforeOpen?: () => void | Promise<void>;
  }) {
    this.trigger = args.trigger;
    this.menu = args.menu;
    this.wrap = args.wrap;
    this.valueEl = args.valueEl;
    this.select = args.select;
    this.getItems = args.getItems;
    this.onSelect = args.onSelect;
    this.beforeOpen = args.beforeOpen;

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
    renderItems(this.menu, this.getItems(), this.currentValue(), (v) => this.handlePick(v));
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
