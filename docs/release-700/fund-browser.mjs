import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isolate, seed, origin, captureTarget } from '../dividend-stage2/fixture.mjs';

const output = new URL('./', import.meta.url).pathname;
const result = { success: false, scope: 'Isolated Chrome and synthetic fund data; external traffic blocked; no real user data, service or device.', checks: [], layouts: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => result.errors.push(error.message));
const check = name => result.checks.push({ name, passed: true });
const openHome = async () => {
  await page.goto(origin);
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-wb-segment').getByRole('button', { name: '红利基金计划', exact: true }).click();
  await page.locator('.div-fund-home-card').first().waitFor();
};
const fundPlan = () => page.evaluate(async () => (await (await import('/src/db.ts')).db.settings.get('main')).dividendFundPlan);
const overflow = () => page.locator('.div-fund-home').evaluate(element => [...element.querySelectorAll('*')].filter(item => {
  const rect = item.getBoundingClientRect();
  return item.getClientRects().length && (rect.right > innerWidth + 1 || rect.left < -1);
}).map(item => ({ tag: item.tagName, class: item.className, width: item.getBoundingClientRect().width })));
try {
  await isolate(page);
  await seed(page);
  await openHome();
  await page.waitForFunction(() => document.querySelector('.df-focus-price strong')?.textContent.includes('1.2'));
  assert.equal(await page.locator('.div-fund-home-card').count(), 2);
  assert.equal(await page.locator('.div-fund-home .div-check-status:visible').count(), 0);
  assert.equal(await page.locator('.div-fund-home .div-check-status-evidence:visible').count(), 0);
  const saved = await fundPlan();
  check('Two funds show price, allocation and entry/exit plans with all diagnostic checks hidden by default');
  const live = page.locator('.div-fund-home-card').filter({ hasText: '模拟行情基金' });
  assert.match(await live.locator('.df-focus-price').innerText(), /1\.2/);
  assert.match(await live.locator('.df-focus-amount').innerText(), /6,000/);
  assert.match(await live.locator('.df-focus-targets').innerText(), /1\.08/);
  assert.match(await live.locator('.df-focus-targets').innerText(), /等待买入条件/);
  const manual = page.locator('.div-fund-home-card').filter({ hasText: '模拟未知持仓基金' });
  assert.match(await manual.locator('.df-focus-price').innerText(), /手工/);
  assert.match(await manual.locator('.df-focus-targets').innerText(), /数据不足/);
  check('Current quote, manual reference, unmet entry and unknown entry remain distinct');

  for (const width of [320, 390]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, scale);
    const overflowing = await overflow();
    assert.deepEqual(overflowing, [], `fund overflow at ${width}/${scale}`);
    assert.equal(await page.locator('.div-fund-home .df-focus-plan:visible').count(), 2);
    assert.equal(await page.locator('.div-fund-home .div-check-status:visible').count(), 0);
    await captureTarget(page, page.locator('.div-fund-home'), `${output}fund-${width}-${scale}.png`);
    result.layouts.push({ width, scale, overflow: overflowing.length, visibleDiagnostics: 0 });
  }
  assert.deepEqual(await fundPlan(), saved);
  check('320/390 px and 1x/1.3x font layouts have no overflow; reading does not modify the fund plan');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
  await live.getByRole('button', { name: /依据与数据/ }).click();
  assert.equal(await live.locator('.div-check-status:visible').count(), 1);
  await live.getByRole('button', { name: /依据与数据/ }).click();
  assert.equal(await live.locator('.div-check-status:visible').count(), 0);
  check('A single evidence entrance expands and fully hides the complete check');
  await page.locator('.div-wb-header button').click();
  assert.equal(await live.locator('.df-focus-price strong').innerText(), '••••');
  assert.equal(await live.locator('.df-focus-amount strong').innerText(), '••••');
  await page.locator('.div-wb-header button').click();
  check('Dividend amount visibility also masks fund prices and allocations');

  await page.locator('.div-fund-home .div-section-heading').getByRole('button', { name: '调整计划' }).click();
  const manager = page.locator('.div-wb-dialog[open]');
  await manager.locator('.df-fund-list').waitFor();
  assert.equal(await manager.locator('.df-fund-list .div-check-status:visible').count(), 0);
  assert.equal(await manager.locator('.df-focus-plan:visible').count(), 2);
  await manager.getByText('编辑预算与持有方式', { exact: true }).click();
  await manager.getByLabel('基金策略总预算（元）', { exact: true }).fill('12500');
  await manager.getByRole('button', { name: '保存基金策略', exact: true }).click();
  await page.waitForFunction(async () => (await (await import('/src/db.ts')).db.settings.get('main')).dividendFundPlan.budgetMinor === 1250000);
  await page.waitForFunction(() => document.querySelector('.div-wb-dialog[open] .df-focus-amount')?.textContent.includes('7,500'));
  assert.match(await manager.locator('.df-focus-amount').first().innerText(), /7,500/);
  assert.deepEqual((await fundPlan()).funds, saved.funds);
  await manager.locator('.div-wb-dialog-header button').click();
  await page.reload();
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-fund-home-card').first().waitFor();
  assert.match(await page.locator('.df-focus-amount').first().innerText(), /7,500/);
  check('Budget edits save and survive reload, recalculate allocation, and preserve every fund input');

  for (const mode of ['hold', 'rebalance']) {
    await page.evaluate(async mode => {
      const { db } = await import('/src/db.ts');
      const { saveDividendFundConfig } = await import('/src/services/dividendFundService.ts');
      const { funds: _funds, ...config } = (await db.settings.get('main')).dividendFundPlan;
      await saveDividendFundConfig({ ...config, mode });
    }, mode);
    await page.reload();
    await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
    await page.locator('.div-fund-home-card').first().waitFor();
    assert.match(await page.locator('.df-focus-targets').first().innerText(), mode === 'hold' ? /长期持有/ : /年度再平衡/);
    if (mode === 'rebalance') assert.match(await page.locator('.df-focus-amount').first().innerText(), /5,250/);
  }
  check('Long-term and rebalancing modes state their own exit arrangement; 70:30 allocation remains exact');
  assert.deepEqual(result.errors, []);
  result.success = true;
} catch (error) {
  result.failure = error.stack;
  await page.screenshot({ path: `${output}fund-failure.png` });
  throw error;
} finally {
  await writeFile(`${output}fund-browser.json`, JSON.stringify(result, null, 2) + '\n');
  await browser.close();
}
