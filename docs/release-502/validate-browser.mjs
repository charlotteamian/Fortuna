import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

process.env.FORTUNA_STAGE2_ORIGIN = process.env.FORTUNA_RELEASE_ORIGIN ?? 'http://127.0.0.1:5192';
const { isolate, seed, home, captureTarget } = await import('../dividend-stage2/fixture.mjs');
const output = new URL('./', import.meta.url).pathname;
const result = { success: false, scope: 'Fresh isolated Chrome, fixed synthetic data and mocked services; no real user database, external services or device installation.', checks: [], errors: [], layouts: [] };
const check = name => result.checks.push({ name, passed: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', error => result.errors.push(error.message));
const readStock = code => page.evaluate(async code => (await import('/src/db.ts')).db.dividendStocks.get(code), code);
const weights = () => page.evaluate(async () => (await (await import('/src/db.ts')).db.dividendStocks.toArray()).map(({ code, weightBps }) => ({ code, weightBps })));
const capture = async (name, target) => {
  const path = `${output}${name}.png`;
  if (await target.evaluate(element => element.tagName === 'DIALOG')) await target.screenshot({ path });
  else await captureTarget(page, target, path);
};
const layouts = async (name, target) => {
  for (const width of [320, 390]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(scale => document.documentElement.style.fontSize = `${16 * scale}px`, scale);
    const overflow = await target.evaluate(element => [...element.querySelectorAll('*')].filter(item => item.getClientRects().length && item.getBoundingClientRect().right > innerWidth + 1).map(item => item.className));
    assert.deepEqual(overflow, [], `${name} ${width}/${scale}`);
    result.layouts.push({ name, width, scale, overflow });
    await capture(`${name}-${width}-${scale}`, target);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.style.fontSize = '16px');
};
try {
  await isolate(page);
  await seed(page);
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    await db.dividendStocks.update('000002', { weightBps: 0 });
    await db.dividendStocks.put({ code: '000009', name: '模拟可移除标的', group: 'watch', weightBps: 0, shareMode: 'manual', manualShares: 0, lotSize: 100 });
  });
  await home(page);
  const tabs = page.locator('.div-home-tabs');
  assert.equal(await tabs.getByRole('tab', { selected: true }).count(), 1);
  assert.equal(await page.locator('.div-fund-home-card').count(), 0);
  await tabs.getByRole('tab').nth(1).click();
  await page.locator('.div-fund-home-card').first().waitFor();
  assert.equal(await page.locator('.div-stock-home').count(), 0);
  assert.equal(await page.locator('.div-fund-home-card').count(), 2);
  assert.equal(await page.locator('.div-daily-generate').count(), 1);
  await tabs.getByRole('tab').first().click();
  await page.locator('.div-stock-home').waitFor();
  check('stock/fund tabs switch the saved view while keeping the unified daily-check entry');
  const expectedCounts = await page.evaluate(async () => {
    const { loadDividendWorkbenchReadOnly } = await import('/src/services/dividendService.ts');
    const { loadDividendCheckSummaries } = await import('/src/services/dividendCheckSummaryService.ts');
    const workbench = await loadDividendWorkbenchReadOnly(), checks = await loadDividendCheckSummaries(workbench);
    const held = workbench.stocks.filter(stock => (stock.shareMode === 'manual' ? stock.manualShares : workbench.positions.get(stock.code)?.shares ?? 0) > 0);
    return [held.length, held.filter(stock => checks.stocks[stock.code].trigger.buy === 'triggered').length, held.filter(stock => checks.stocks[stock.code].trigger.sell === 'triggered').length].map(String);
  });
  assert.deepEqual(await page.locator('.div-summary-strip strong').allTextContents(), expectedCounts);
  check('holding and trigger totals use the same verified quote summaries as the existing checks');
  await layouts('stock-home', page.locator('.dividend-page'));

  const savedGrid = await readStock('000001');
  await page.getByRole('button', { name: /选股检查/ }).first().click();
  const selection = page.locator('.div-ai-research-card').filter({ hasText: '模拟000001' }).first();
  await selection.waitFor();
  if (await selection.locator('.div-ai-research-toggle').getAttribute('aria-expanded') === 'false') await selection.locator('.div-ai-research-toggle').click();
  const anchor = selection.locator('.div-pricing-anchor');
  await anchor.waitFor();
  assert.match(await anchor.innerText(), /0\.609000/);
  assert.match(await anchor.innerText(), /0\.548100/);
  assert.match(await anchor.innerText(), /5%/);
  assert.equal(await selection.locator('.div-check-grid-table tbody tr').count(), 8);
  assert.equal(await selection.locator('.div-pricing-reference').getAttribute('open'), null);
  await selection.locator('.div-pricing-reference > summary').click();
  assert.match(await selection.locator('.div-pricing-reference').innerText(), /不参与买卖价格计算/);
  const afterReading = await readStock('000001');
  for (const key of ['buyLevels', 'sellLevels', 'gridProvenance', 'weightBps', 'manualShares', 'buyPaused']) assert.deepEqual(afterReading[key], savedGrid[key]);
  check('pricing formula shows gross/net dividend and the 5% reference; four buy/four sell levels and folded reference metrics preserve the saved plan');
  await layouts('pricing', selection.locator('.div-check-grid'));

  await home(page);
  await page.locator('.div-stock-home > .div-section-heading button').click();
  const manager = page.locator('.div-plan-manager');
  await manager.waitFor();
  const stockManager = manager.locator(':scope > details').nth(2);
  if (await stockManager.getAttribute('open') === null) await stockManager.locator(':scope > summary').click();
  await manager.locator('.div-unfunded-stocks > summary').click();
  const row = manager.locator('.div-unfunded-stock-row').filter({ hasText: '000002' });
  const original = await readStock('000002');
  await row.locator('input').fill('11');
  await row.getByRole('button', { name: '分配', exact: true }).click();
  await row.getByRole('alert').waitFor();
  assert.deepEqual(await readStock('000002'), original);
  await row.locator('input').fill('5');
  await row.getByRole('button', { name: '分配', exact: true }).click();
  await page.waitForFunction(async () => (await (await import('/src/db.ts')).db.dividendStocks.get('000002'))?.weightBps === 500);
  assert.deepEqual(await readStock('000002'), { ...original, weightBps: 500 });
  check('inline allocation rejects excess weight, then updates only the selected stock weight');
  const removable = manager.locator('.div-unfunded-stock-row').filter({ hasText: '000009' });
  const beforeRemoval = await weights();
  await removable.getByRole('button', { name: '删除', exact: true }).click();
  assert.ok(await readStock('000009'));
  await removable.getByRole('button', { name: '确认移除？', exact: true }).click();
  await page.waitForFunction(async () => !(await (await import('/src/db.ts')).db.dividendStocks.get('000009')));
  assert.deepEqual(await weights(), beforeRemoval.filter(stock => stock.code !== '000009'));
  check('list removal requires two clicks and removing an unfunded stock preserves other allocations');

  const heldManager = manager.locator('.div-plan-manager-list > details').filter({ hasText: '模拟000001' }).first();
  await heldManager.locator(':scope > summary').click();
  const protectedStock = await readStock('000001');
  await heldManager.getByRole('button', { name: '删除', exact: true }).click();
  await heldManager.getByRole('button', { name: '确认移除？', exact: true }).click();
  await manager.getByRole('alert').filter({ hasText: /持仓/ }).waitFor();
  assert.deepEqual(await readStock('000001'), protectedStock);
  check('the existing holding guard still blocks removal from the new list shortcut');
  await heldManager.getByRole('button', { name: '编辑红利标的', exact: true }).click();
  const dialog = page.locator('dialog.div-dialog');
  await dialog.waitFor();
  await dialog.locator('textarea').fill('尚未保存的两步草稿');
  const newer = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    await db.dividendStocks.update('000001', { note: '另一操作保存的新备注' });
    return db.dividendStocks.get('000001');
  });
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: /计划已被其他操作修改或删除/ }).waitFor();
  assert.deepEqual(await readStock('000001'), newer);
  check('the two-step editor preserves conflict rejection and cannot overwrite a newer plan');
  await layouts('editor', dialog);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await heldManager.getByRole('button', { name: '编辑红利标的', exact: true }).click();
  await dialog.locator('textarea').fill('正常保存的新备注');
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  await dialog.getByRole('button', { name: '上一步', exact: true }).click();
  assert.equal(await dialog.locator('textarea').inputValue(), '正常保存的新备注');
  await dialog.getByRole('button', { name: '下一步', exact: true }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await readStock('000001'), { ...newer, note: '正常保存的新备注' });
  check('back/next retains the draft and a normal save preserves grids, quote, shares and pause');
  assert.deepEqual(result.errors, []);
  result.success = true;
} catch (error) {
  result.failure = error.stack;
  await page.screenshot({ path: `${output}failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}browser-validation.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ success: result.success, checks: result.checks.length, errors: result.errors, layouts: result.layouts.length, failure: result.failure }, null, 2));
  await browser.close();
}
