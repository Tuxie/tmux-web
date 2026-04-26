export type PromptDecision = {
  allow: boolean;
  persist: boolean;
  pinHash: boolean;
  expiresAt: string | null;
};

export interface PromptOpts {
  exePath: string | null;
  commandName: string | null;
}

let active: HTMLElement | null = null;

/** Show a modal asking whether to allow a program to read the clipboard.
 *  Resolves with the user's decision. A visible modal replaces any
 *  currently-shown one (rare but possible if reads queue up fast). */
export function showClipboardPrompt(opts: PromptOpts): Promise<PromptDecision> {
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
    title.textContent = 'Allow clipboard read?';
    title.id = 'tw-clip-prompt-title';
    card.setAttribute('aria-labelledby', title.id);
    card.appendChild(title);

    const label = opts.exePath ?? opts.commandName ?? '(unknown process)';
    const body = document.createElement('div');
    body.className = 'tw-clip-prompt-body';
    body.textContent = `${label} wants to read your clipboard.`;
    card.appendChild(body);

    const pinRow = document.createElement('label');
    pinRow.className = 'tw-clip-prompt-pin';
    const pinCheckbox = document.createElement('input');
    pinCheckbox.type = 'checkbox';
    pinCheckbox.checked = true;
    pinRow.appendChild(pinCheckbox);
    pinRow.appendChild(document.createTextNode('Pin to this exact binary (hash)'));
    if (opts.exePath) card.appendChild(pinRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'tw-clip-prompt-btns';

    const makeBtn = (text: string, variant: 'deny' | 'allow-once' | 'allow-always'): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.className = 'tw-clip-prompt-btn tw-clip-prompt-btn-'
        + (variant === 'allow-always' ? 'always'
           : variant === 'allow-once' ? 'once'
           : 'deny');
      return b;
    };

    const denyBtn = makeBtn('Deny', 'deny');
    const onceBtn = makeBtn('Allow once', 'allow-once');
    const alwaysBtn = makeBtn('Allow always', 'allow-always');

    const finish = (decision: PromptDecision) => {
      backdrop.remove();
      active = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(decision);
    };

    denyBtn.addEventListener('click', () =>
      finish({ allow: false, persist: true, pinHash: false, expiresAt: null }));
    onceBtn.addEventListener('click', () =>
      finish({ allow: true, persist: false, pinHash: false, expiresAt: null }));
    alwaysBtn.addEventListener('click', () =>
      finish({ allow: true, persist: true, pinHash: !!opts.exePath && pinCheckbox.checked, expiresAt: null }));

    // Tab/Shift+Tab cycles focus among the three modal buttons. Per WCAG
    // 2.1.2, focus must not leak out of an open modal — without this trap,
    // tabbing past the last button walks back into the terminal / settings
    // menu underneath. We always stop propagation while the modal is up so
    // the document-level "snap focus back to terminal on any keypress"
    // handler in client/index.ts doesn't undo our refocus.
    const focusables = (): HTMLButtonElement[] => [denyBtn, onceBtn, alwaysBtn];
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish({ allow: false, persist: false, pinHash: false, expiresAt: null });
        return;
      }
      if (ev.key === 'Tab') {
        ev.stopPropagation();
        const order = focusables();
        const focused = document.activeElement;
        const idx = order.indexOf(focused as HTMLButtonElement);
        // If focus is somewhere outside the modal entirely, pull it back in.
        if (idx === -1) {
          ev.preventDefault();
          (ev.shiftKey ? order[order.length - 1] : order[0]).focus();
          return;
        }
        if (ev.shiftKey && idx === 0) {
          ev.preventDefault();
          order[order.length - 1].focus();
        } else if (!ev.shiftKey && idx === order.length - 1) {
          ev.preventDefault();
          order[0].focus();
        }
        // Mid-cycle Tab/Shift+Tab (e.g. Deny → Allow once) lets the
        // browser do its native focus advance — we still stopPropagation
        // above to keep the terminal-refocus handler from interfering.
      }
    };
    document.addEventListener('keydown', onKey, true);

    btnRow.appendChild(denyBtn);
    btnRow.appendChild(onceBtn);
    btnRow.appendChild(alwaysBtn);
    card.appendChild(btnRow);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    active = backdrop;

    alwaysBtn.focus();
  });
}
