/** Themable confirmation modal — replaces `window.confirm()` for the
 *  destructive tmux actions in the topbar (kill session, close window).
 *
 *  Native `confirm()` blocks the JS thread, isn't themable (Amiga /
 *  Scene 2000 themes look out of place when it pops), and on some
 *  desktop-wrapper webviews is suppressed entirely — in which case the
 *  destructive action would have gone through unconfirmed. Cluster 13
 *  flagged the desktop-suppression case after the original 2026-04-17
 *  audit's UX-1 decision was made; this module is the resulting fix.
 *
 *  Reuses the structural CSS classes from `clipboard-prompt.ts`
 *  (`tw-clip-prompt-backdrop` / `tw-clip-prompt-card` / `…-title` /
 *  `…-body` / `…-btns`) so themes that already style the clipboard
 *  modal pick this up for free; only the buttons get a fresh
 *  `tw-confirm-modal-btn` class so destructive variants can be styled
 *  separately. ARIA + focus-trap mirror the clipboard prompt (see
 *  cluster 09 audit).
 */

export type ConfirmButtonKind = 'default' | 'destructive' | 'primary';

export interface ConfirmButtonSpec<V> {
  label: string;
  value: V;
  kind?: ConfirmButtonKind;
  /** When true, this button is the initial focus / Enter-key default.
   *  Exactly one button should set this; if none do, the last button
   *  in the list is focused. */
  defaultFocus?: boolean;
}

export interface ConfirmModalOpts<V> {
  title: string;
  body: string;
  /** First button is left-most. The promise resolves with the chosen
   *  button's `value`. Escape resolves with `escapeValue` (defaults to
   *  the value of the first button, conventionally Cancel). */
  buttons: ConfirmButtonSpec<V>[];
  /** Returned when the user dismisses the modal via the Escape key.
   *  If absent, Escape resolves with the first button's value (Cancel
   *  by convention). */
  escapeValue?: V;
}

let active: HTMLElement | null = null;

/** Show a confirmation modal and resolve with the chosen button's value.
 *  A second call while one is up replaces the existing modal (matches
 *  `clipboard-prompt.ts` semantics — rare but possible if two
 *  destructive UI paths fire fast). */
export function showConfirmModal<V>(opts: ConfirmModalOpts<V>): Promise<V> {
  return new Promise((resolve) => {
    active?.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'tw-clip-prompt-backdrop';

    const card = document.createElement('div');
    card.className = 'tw-clip-prompt-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'tw-clip-prompt-title';
    title.textContent = opts.title;
    title.id = 'tw-confirm-modal-title';
    card.setAttribute('aria-labelledby', title.id);
    card.appendChild(title);

    const body = document.createElement('div');
    body.className = 'tw-clip-prompt-body';
    body.textContent = opts.body;
    card.appendChild(body);

    const btnRow = document.createElement('div');
    btnRow.className = 'tw-clip-prompt-btns';

    const buttons: HTMLButtonElement[] = [];
    let defaultBtn: HTMLButtonElement | null = null;

    const finish = (value: V): void => {
      backdrop.remove();
      active = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };

    for (const spec of opts.buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = spec.label;
      // tw-confirm-modal-btn is the new structural class; we keep the
      // tw-clip-prompt-btn padding/border on top so existing themes
      // pick up the dialog button style without a separate rule.
      b.className = 'tw-clip-prompt-btn tw-confirm-modal-btn'
        + (spec.kind === 'destructive' ? ' tw-confirm-modal-btn-destructive'
           : spec.kind === 'primary' ? ' tw-confirm-modal-btn-primary'
           : '');
      b.addEventListener('click', () => finish(spec.value));
      btnRow.appendChild(b);
      buttons.push(b);
      if (spec.defaultFocus) defaultBtn = b;
    }

    // Tab cycles focus among modal buttons. Mirrors the clipboard-prompt
    // focus-trap (cluster 09): without this, tabbing past the last
    // button walks back into the terminal underneath.
    const escapeValue: V = (opts.escapeValue !== undefined
      ? opts.escapeValue
      : opts.buttons[0]?.value as V);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(escapeValue);
        return;
      }
      if (ev.key === 'Tab') {
        ev.stopPropagation();
        const focused = document.activeElement;
        const idx = buttons.indexOf(focused as HTMLButtonElement);
        if (idx === -1) {
          ev.preventDefault();
          (ev.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();
          return;
        }
        if (ev.shiftKey && idx === 0) {
          ev.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (!ev.shiftKey && idx === buttons.length - 1) {
          ev.preventDefault();
          buttons[0].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);

    card.appendChild(btnRow);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    active = backdrop;

    // Default focus: defaultFocus button if any, else the last button
    // (typically the destructive action — matches kill-session UX where
    // the user clicked through specifically to confirm).
    (defaultBtn ?? buttons[buttons.length - 1])?.focus();
  });
}
