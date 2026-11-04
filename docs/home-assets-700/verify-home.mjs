import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const output = new URL('./', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const result = { scope: 'Isolated synthetic Chrome profile; external requests blocked; no user data or device.', checks: [], errors: [], layouts: [] };
page.on('pageerror', error => result.errors.push(error.message));
await page.route('**/*', route => /^https?:\/\/127\.0\.0\.1:5177\//.test(route.request().url()) ? route.continue() : route.abort());
try {
  await page.goto('http://127.0.0.1:5177');
  await page.evaluate(async () => {
    const { db, initializeSettings, updateSettings } = await import('/src/db.ts');
    await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
    await initializeSettings();
    await updateSettings({ language: 'zh', primaryCurrency: 'CNY', amountVisible: true, onboardingVersion: 1, automaticSnapshotSchemaVersion: 2 });
    await db.accounts.bulkPut([
      { id: 'bank-1', name: '常用存款一', category: '银行存款', type: 'asset', currency: 'CNY', createdAt: 1, sortOrder: 0 },
      { id: 'stock', name: '常用证券', category: '股票/ETF', type: 'asset', currency: 'CNY', createdAt: 2, sortOrder: 1 },
      { id: 'bank-2', name: '常用存款二', category: '银行存款', type: 'asset', currency: 'CNY', createdAt: 3, sortOrder: 2 },
    ]);
    await db.records.put({ id: 'balance', accountId: 'bank-1', date: '2026-11-04', amount: 12345.67, note: 'Keep balance', createdAt: 1 });
  });
  await page.reload();
  await page.getByRole('button', { name: '调整顺序', exact: true }).waitFor();
  assert.equal(await page.locator('.home-monitors .price-monitor-panel').count(), 2);
  assert.equal(await page.locator('.price-monitor-panel').count(), 2);
  assert.ok(await page.locator('.home-monitors').evaluate(element => element.compareDocumentPosition(document.querySelector('.page-header')) & Node.DOCUMENT_POSITION_FOLLOWING));
  result.checks.push('Both monitors appear once together before asset summary and categories.');
  await page.getByRole('button', { name: '调整顺序', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '上移 股票/ETF', exact: true }).click();
  await dialog.getByRole('button', { name: '上移 常用存款二', exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.locator('.entry-category').allTextContents(), ['常用证券', '常用存款二', '常用存款一']);
  await page.reload();
  await page.getByRole('button', { name: '调整顺序', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.entry-category').allTextContents(), ['常用证券', '常用存款二', '常用存款一']);
  assert.equal(await page.evaluate(async () => (await (await import('/src/db.ts')).db.records.get('balance')).amount), 12345.67);
  result.checks.push('Category/account reorder survives reload with balance and record unchanged.');
  for (const width of [390, 320]) for (const fontSize of [16, 20.8]) {
    await page.setViewportSize({ width, height: 844 });
    await page.addStyleTag({ content: `html { font-size: ${fontSize}px !important; }` });
    await page.getByRole('button', { name: '调整顺序', exact: true }).click();
    const overflow = await dialog.evaluate(element => [...element.querySelectorAll('*')].filter(item => item.getClientRects().length && item.getBoundingClientRect().right > innerWidth + 1).map(item => item.className));
    assert.deepEqual(overflow, []);
    const bounds = await dialog.boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 845);
    result.layouts.push({ width, fontSize, overflow: 0 });
    await page.screenshot({ path: `${output}order-${width}-${fontSize}.png` });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  assert.deepEqual(result.errors, []);
  result.success = true;
} finally { await writeFile(`${output}browser-verification.json`, JSON.stringify(result, null, 2)); await browser.close(); }
console.log(JSON.stringify(result));
