import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

const TERM_X = 640;
const TERM_Y = 400;

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
});

test('click sends SGR mouse press \\x1b[<0;...M and release \\x1b[<0;...m', async ({ page }) => {
  await page.mouse.click(TERM_X, TERM_Y);
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(m => m.startsWith('\x1b[<0;') && m.endsWith('M'))).toBe(true);
  expect(sent.some(m => m.startsWith('\x1b[<0;') && m.endsWith('m'))).toBe(true);
});

test('drag sends SGR motion sequence \\x1b[<32;...M', async ({ page }) => {
  await page.mouse.move(TERM_X, TERM_Y);
  await page.mouse.down();
  await page.mouse.move(TERM_X + 30, TERM_Y + 15);
  await page.mouse.up();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(m => m.startsWith('\x1b[<32;') && m.endsWith('M'))).toBe(true);
});

test('scroll up sends SGR wheel-up \\x1b[<64;...M', async ({ page }) => {
  await page.mouse.move(TERM_X, TERM_Y);
  await page.mouse.wheel(0, -100);
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(m => m.startsWith('\x1b[<64;') && m.endsWith('M'))).toBe(true);
});

test('scroll down sends SGR wheel-down \\x1b[<65;...M', async ({ page }) => {
  await page.mouse.move(TERM_X, TERM_Y);
  await page.mouse.wheel(0, 100);
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(m => m.startsWith('\x1b[<65;') && m.endsWith('M'))).toBe(true);
});

test('Shift+click does not send any SGR sequence (native selection bypass)', async ({ page }) => {
  const sgrBefore: number = await page.evaluate(() =>
    (window as any).__wsSent.filter((m: string) => m.startsWith('\x1b[<')).length
  );
  await page.keyboard.down('Shift');
  await page.mouse.click(TERM_X, TERM_Y);
  await page.keyboard.up('Shift');
  const sgrAfter: number = await page.evaluate(() =>
    (window as any).__wsSent.filter((m: string) => m.startsWith('\x1b[<')).length
  );
  expect(sgrAfter).toBe(sgrBefore);
});
