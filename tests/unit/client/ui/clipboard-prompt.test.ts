import { describe, test, expect, beforeEach } from 'bun:test';
import { setupDocument } from '../_dom.ts';
import { showClipboardPrompt } from '../../../../src/client/ui/clipboard-prompt.ts';

beforeEach(() => {
  setupDocument();
});

function findButtonByText(text: string): any {
  const backdrop = (document.body as any).children[0];
  const card = backdrop.children[0];
  const btnRow = card.children[card.children.length - 1];
  return btnRow.children.find((b: any) => b.textContent === text);
}

describe('showClipboardPrompt', () => {
  test('Deny → { allow:false, persist:true }', async () => {
    const p = showClipboardPrompt({ exePath: '/bin/cat', commandName: 'cat' });
    const denyBtn = findButtonByText('Deny');
    denyBtn.dispatch('click', {});
    const decision = await p;
    expect(decision).toEqual({ allow: false, persist: true, pinHash: false, expiresAt: null });
    // Backdrop removed → body has no children
    expect((document.body as any).children.length).toBe(0);
  });

  test('Allow once → { allow:true, persist:false }', async () => {
    const p = showClipboardPrompt({ exePath: null, commandName: 'claude' });
    findButtonByText('Allow once').dispatch('click', {});
    expect(await p).toEqual({ allow: true, persist: false, pinHash: false, expiresAt: null });
  });

  test('Allow always with exePath and pin checked → pinHash:true', async () => {
    const p = showClipboardPrompt({ exePath: '/usr/bin/claude', commandName: 'claude' });
    findButtonByText('Allow always').dispatch('click', {});
    expect(await p).toEqual({ allow: true, persist: true, pinHash: true, expiresAt: null });
  });

  test('Allow always without exePath → pinHash:false (checkbox not shown)', async () => {
    const p = showClipboardPrompt({ exePath: null, commandName: null });
    findButtonByText('Allow always').dispatch('click', {});
    expect(await p).toEqual({ allow: true, persist: true, pinHash: false, expiresAt: null });
  });

  test('Allow always with pin unchecked → pinHash:false', async () => {
    const p = showClipboardPrompt({ exePath: '/bin/x', commandName: 'x' });
    // uncheck the pin
    const backdrop = (document.body as any).children[0];
    const card = backdrop.children[0];
    // pinRow is appended when exePath present; find its checkbox
    for (const row of card.children) {
      if (row.tagName === 'LABEL') {
        const cb = row.children[0];
        cb.checked = false;
      }
    }
    findButtonByText('Allow always').dispatch('click', {});
    expect(await p).toEqual({ allow: true, persist: true, pinHash: false, expiresAt: null });
  });

  test('Escape key cancels with { allow:false, persist:false }', async () => {
    const p = showClipboardPrompt({ exePath: null, commandName: 'c' });
    let prevented = false;
    (document as any).dispatch('keydown', {
      key: 'Escape',
      preventDefault() { prevented = true; },
      stopPropagation() {},
    });
    const decision = await p;
    expect(prevented).toBe(true);
    expect(decision).toEqual({ allow: false, persist: false, pinHash: false, expiresAt: null });
  });

  test('Non-Escape keys are ignored', async () => {
    const p = showClipboardPrompt({ exePath: null, commandName: 'c' });
    (document as any).dispatch('keydown', { key: 'a', preventDefault() {}, stopPropagation() {} });
    // Prompt still active
    expect((document.body as any).children.length).toBe(1);
    // Clean up
    findButtonByText('Deny').dispatch('click', {});
    await p;
  });

  test('Second prompt replaces the first', async () => {
    const p1 = showClipboardPrompt({ exePath: null, commandName: 'a' });
    const p2 = showClipboardPrompt({ exePath: null, commandName: 'b' });
    // Only the newest backdrop should be in the body
    expect((document.body as any).children.length).toBe(1);
    findButtonByText('Deny').dispatch('click', {});
    await p2;
    // First promise will never resolve — that's the documented semantics;
    // we intentionally don't await p1. Mark it used to silence lint-style issues.
    void p1;
  });

  test('uses commandName label when exePath is null', async () => {
    const p = showClipboardPrompt({ exePath: null, commandName: 'vim' });
    const backdrop = (document.body as any).children[0];
    const bodyDiv = backdrop.children[0].children[1];
    expect(bodyDiv.textContent).toBe('vim wants to read your clipboard.');
    findButtonByText('Deny').dispatch('click', {});
    await p;
  });

  test('uses (unknown process) label when both null', async () => {
    const p = showClipboardPrompt({ exePath: null, commandName: null });
    const backdrop = (document.body as any).children[0];
    const bodyDiv = backdrop.children[0].children[1];
    expect(bodyDiv.textContent).toBe('(unknown process) wants to read your clipboard.');
    findButtonByText('Deny').dispatch('click', {});
    await p;
  });
});
