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
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '9999',
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'inherit',
    } as Partial<CSSStyleDeclaration>);

    const card = document.createElement('div');
    Object.assign(card.style, {
      minWidth: '340px', maxWidth: '520px',
      background: '#262626', color: '#d4d4d4',
      border: '1px solid #555', borderRadius: '4px',
      padding: '14px 16px',
      boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
      fontSize: '13px',
    } as Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = 'Allow clipboard read?';
    Object.assign(title.style, { fontWeight: 'bold', marginBottom: '8px' });
    card.appendChild(title);

    const label = opts.exePath ?? opts.commandName ?? '(unknown process)';
    const body = document.createElement('div');
    body.style.marginBottom = '10px';
    body.style.wordBreak = 'break-all';
    body.textContent = `${label} wants to read your clipboard.`;
    card.appendChild(body);

    const pinRow = document.createElement('label');
    Object.assign(pinRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      marginBottom: '12px', fontSize: '12px', color: '#aaa',
    });
    const pinCheckbox = document.createElement('input');
    pinCheckbox.type = 'checkbox';
    pinCheckbox.checked = true;
    pinRow.appendChild(pinCheckbox);
    pinRow.appendChild(document.createTextNode('Pin to this exact binary (hash)'));
    if (opts.exePath) card.appendChild(pinRow);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '6px', justifyContent: 'flex-end' });

    const makeBtn = (text: string, variant: 'deny' | 'allow-once' | 'allow-always'): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        padding: '4px 10px', border: '1px solid #555',
        borderRadius: '3px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px',
        background: variant === 'allow-always' ? '#2a6a2a'
                  : variant === 'allow-once' ? '#3a3a3a'
                  : '#5a2a2a',
        color: '#eee',
      } as Partial<CSSStyleDeclaration>);
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

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish({ allow: false, persist: false, pinHash: false, expiresAt: null });
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
