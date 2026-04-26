import { describe, test, expect, beforeEach } from 'bun:test';
import { setupDocument } from '../_dom.ts';
import { showConfirmModal } from '../../../../src/client/ui/confirm-modal.ts';

beforeEach(() => {
  setupDocument();
});

function getBackdrop(): any {
  return (document.body as any).children[0];
}

function getCard(): any {
  return getBackdrop().children[0];
}

function getButtons(): any[] {
  const card = getCard();
  const btnRow = card.children[card.children.length - 1];
  return btnRow.children;
}

function findButtonByText(text: string): any {
  return getButtons().find((b: any) => b.textContent === text);
}

describe('showConfirmModal', () => {
  test('Cancel returns false (or first-button value)', async () => {
    const p = showConfirmModal<boolean>({
      title: 'Kill session?',
      body: 'Kill session "main"?',
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'Kill session', value: true, kind: 'destructive', defaultFocus: true },
      ],
    });
    findButtonByText('Cancel').dispatch('click', {});
    const decision = await p;
    expect(decision).toBe(false);
    // Backdrop removed
    expect((document.body as any).children.length).toBe(0);
  });

  test('Destructive button returns its value', async () => {
    const p = showConfirmModal<boolean>({
      title: 'Kill session?',
      body: 'Kill session "main"?',
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'Kill session', value: true, kind: 'destructive' },
      ],
    });
    findButtonByText('Kill session').dispatch('click', {});
    expect(await p).toBe(true);
  });

  test('Escape resolves with escapeValue when provided', async () => {
    const p = showConfirmModal<string>({
      title: 'X?',
      body: 'Confirm?',
      buttons: [
        { label: 'No', value: 'no' },
        { label: 'Yes', value: 'yes', kind: 'primary' },
      ],
      escapeValue: 'esc',
    });
    (document as any).dispatch('keydown', {
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {},
    });
    expect(await p).toBe('esc');
  });

  test('Escape resolves with first-button value when escapeValue absent', async () => {
    const p = showConfirmModal<string>({
      title: 'X?',
      body: 'Confirm?',
      buttons: [
        { label: 'No', value: 'no' },
        { label: 'Yes', value: 'yes' },
      ],
    });
    (document as any).dispatch('keydown', {
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {},
    });
    expect(await p).toBe('no');
  });

  test('ARIA dialog attributes set on the card', async () => {
    const p = showConfirmModal<boolean>({
      title: 'Hello?',
      body: 'Body text',
      buttons: [{ label: 'OK', value: true }],
    });
    const card = getCard();
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    // aria-labelledby points at the title id
    const labelId = card.getAttribute('aria-labelledby');
    expect(typeof labelId).toBe('string');
    findButtonByText('OK').dispatch('click', {});
    await p;
  });

  test('destructive button gets the variant class', async () => {
    const p = showConfirmModal<boolean>({
      title: 'X?',
      body: 'b',
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'Kill', value: true, kind: 'destructive' },
      ],
    });
    const killBtn = findButtonByText('Kill');
    expect(String(killBtn.className)).toContain('tw-confirm-modal-btn-destructive');
    findButtonByText('Cancel').dispatch('click', {});
    await p;
  });

  test('Tab cycles focus from last to first button', async () => {
    const p = showConfirmModal<boolean>({
      title: 'X?',
      body: 'b',
      buttons: [
        { label: 'A', value: false },
        { label: 'B', value: true },
      ],
    });
    const btns = getButtons();
    // Simulate that the last button has focus by setting document.activeElement
    Object.defineProperty(document, 'activeElement', {
      value: btns[1],
      configurable: true,
    });
    let prevented = false;
    (document as any).dispatch('keydown', {
      key: 'Tab',
      shiftKey: false,
      preventDefault() { prevented = true; },
      stopPropagation() {},
    });
    expect(prevented).toBe(true);
    findButtonByText('A').dispatch('click', {});
    await p;
  });

  test('Shift+Tab from first wraps to last', async () => {
    const p = showConfirmModal<boolean>({
      title: 'X?',
      body: 'b',
      buttons: [
        { label: 'A', value: false },
        { label: 'B', value: true },
      ],
    });
    const btns = getButtons();
    Object.defineProperty(document, 'activeElement', {
      value: btns[0],
      configurable: true,
    });
    let prevented = false;
    (document as any).dispatch('keydown', {
      key: 'Tab',
      shiftKey: true,
      preventDefault() { prevented = true; },
      stopPropagation() {},
    });
    expect(prevented).toBe(true);
    findButtonByText('A').dispatch('click', {});
    await p;
  });

  test('A second showConfirmModal replaces the first', async () => {
    const p1 = showConfirmModal<string>({
      title: 'A?',
      body: 'a',
      buttons: [{ label: 'OK', value: 'a' }],
    });
    const p2 = showConfirmModal<string>({
      title: 'B?',
      body: 'b',
      buttons: [{ label: 'OK', value: 'b' }],
    });
    expect((document.body as any).children.length).toBe(1);
    findButtonByText('OK').dispatch('click', {});
    expect(await p2).toBe('b');
    void p1;
  });
});
