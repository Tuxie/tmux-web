import { test, expect } from '@playwright/test';

/**
 * E2E for the OSC 52 clipboard-read consent modal.
 *
 * Rather than drive a real OSC 52 read sequence through cat's echo (brittle
 * timing), we inject the clipboardPrompt TT message directly via the
 * window.__twInjectMessage backdoor that the server exposes in --test mode.
 * This exercises the real modal code; unit tests cover the server-side
 * decode / encode / policy flows.
 */

const PROMPT = {
  reqId: 'e2e-test-1',
  exePath: '/usr/bin/ssh',
  commandName: 'ssh',
};

const TT = (body: unknown) => '\x00TT:' + JSON.stringify(body);

async function openPrompt(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  // Wait for the test backdoor to be installed (connection is up + config
  // was marked testMode on the server side).
  await page.waitForFunction(() => typeof (window as any).__twInjectMessage === 'function');
  const payload = TT({ clipboardPrompt: PROMPT });
  await page.evaluate((p) => (window as any).__twInjectMessage(p), payload);
  await page.locator('.tw-clip-prompt-card').waitFor({ state: 'visible' });
}

test.describe('OSC 52 clipboard-read consent modal', () => {
  test('renders with program name and three buttons', async ({ page }) => {
    await openPrompt(page);
    const card = page.locator('.tw-clip-prompt-card');
    await expect(card.locator('.tw-clip-prompt-title')).toHaveText('Allow clipboard read?');
    await expect(card.locator('.tw-clip-prompt-body')).toContainText('/usr/bin/ssh');
    await expect(card.locator('.tw-clip-prompt-btn-deny')).toHaveText('Deny');
    await expect(card.locator('.tw-clip-prompt-btn-once')).toHaveText('Allow once');
    await expect(card.locator('.tw-clip-prompt-btn-always')).toHaveText('Allow always');
  });

  test('Escape dismisses the modal', async ({ page }) => {
    await openPrompt(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tw-clip-prompt-card')).toHaveCount(0);
  });

  test('clicking Deny sends a deny clipboard-decision message', async ({ page }) => {
    // Spy on outbound WS messages before triggering the prompt.
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__twInjectMessage === 'function');
    await page.evaluate(() => {
      const out: string[] = [];
      (window as any).__twSendSpy = out;
      const origSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data: any) {
        if (typeof data === 'string') out.push(data);
        return origSend.apply(this, arguments as any);
      };
    });

    await page.evaluate(
      (p) => (window as any).__twInjectMessage(p),
      TT({ clipboardPrompt: PROMPT }),
    );
    await page.locator('.tw-clip-prompt-btn-deny').click();
    await expect(page.locator('.tw-clip-prompt-card')).toHaveCount(0);

    const outbound = await page.evaluate(() => (window as any).__twSendSpy as string[]);
    const decisions = outbound.map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter(x => x && x.type === 'clipboard-decision');
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    const last = decisions[decisions.length - 1];
    expect(last.reqId).toBe(PROMPT.reqId);
    expect(last.allow).toBe(false);
  });

  test('clicking Allow once sends an allow-once clipboard-decision', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as any).__twInjectMessage === 'function');
    await page.evaluate(() => {
      const out: string[] = [];
      (window as any).__twSendSpy = out;
      const origSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data: any) {
        if (typeof data === 'string') out.push(data);
        return origSend.apply(this, arguments as any);
      };
    });
    await page.evaluate(
      (p) => (window as any).__twInjectMessage(p),
      TT({ clipboardPrompt: PROMPT }),
    );
    await page.locator('.tw-clip-prompt-btn-once').click();
    await expect(page.locator('.tw-clip-prompt-card')).toHaveCount(0);

    const outbound = await page.evaluate(() => (window as any).__twSendSpy as string[]);
    const decisions = outbound.map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter(x => x && x.type === 'clipboard-decision');
    const last = decisions[decisions.length - 1];
    expect(last.reqId).toBe(PROMPT.reqId);
    expect(last.allow).toBe(true);
    expect(last.persist).toBe(false);
  });
});
