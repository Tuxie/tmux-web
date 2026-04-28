import { test, expect } from '@playwright/test';
import { injectWsSpy, mockApis, waitForWsOpen } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  let settings = {
    version: 1,
    knownServers: [],
    servers: [
      {
        id: 'dev',
        name: 'Dev',
        host: 'dev.example.com',
        port: 22,
        protocol: 'ssh',
        username: 'per',
        savePassword: false,
        compression: true,
      },
    ],
  };
  await page.route('**/api/settings', async route => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const patch = JSON.parse(req.postData() ?? '{}');
      if (Array.isArray(patch.servers)) settings = { ...settings, servers: patch.servers };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settings) });
  });
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.mouse.move(640, 10);
});

test('configuration window manages remote servers', async ({ page }) => {
  await page.click('#btn-menu');
  await page.click('#btn-config-window');

  const dialog = page.locator('.tw-config-window');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.tw-config-nav')).toContainText('General');
  await expect(dialog.locator('.tw-config-nav')).toContainText('Servers');
  await expect(dialog.locator('.tw-config-nav')).toContainText('Sessions');
  const box = await dialog.boundingBox();
  expect(Math.round(box!.width)).toBeCloseTo(Math.round(page.viewportSize()!.width * 0.9), 1);
  expect(Math.round(box!.height)).toBeCloseTo(Math.round(page.viewportSize()!.height * 0.9), 1);
  await expect(dialog.locator('.tw-config-server-row')).toContainText('Dev');
  await expect(dialog.locator('.tw-config-server-row')).toContainText('dev.example.com');

  await dialog.locator('button', { hasText: 'Add server' }).click();
  await dialog.locator('[name="name"]').fill('Prod');
  await dialog.locator('[name="host"]').fill('prod.example.com');
  await dialog.locator('[name="port"]').fill('443');
  await dialog.locator('[name="protocol"]').selectOption('https');
  await dialog.locator('[name="username"]').fill('admin');
  await dialog.locator('[name="password"]').fill('do-not-save');
  await dialog.locator('[name="savePassword"]').setChecked(false);
  await dialog.locator('[name="compression"]').setChecked(true);
  await dialog.locator('button', { hasText: 'Save server' }).click();

  const prodRow = dialog.locator('.tw-config-server-row', { hasText: 'Prod' });
  await expect(prodRow).toContainText('prod.example.com');
  const storedServers = await page.evaluate(async () => {
    const res = await fetch('/api/settings');
    return (await res.json()).servers;
  });
  expect(storedServers.at(-1)).toEqual({
    id: 'prod.example.com',
    name: 'Prod',
    host: 'prod.example.com',
    port: 443,
    protocol: 'https',
    username: 'admin',
    savePassword: false,
    compression: true,
  });
});
