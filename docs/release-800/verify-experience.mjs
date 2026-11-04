import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

process.env.FORTUNA_STAGE2_ORIGIN = process.env.FORTUNA_EXPERIENCE_ORIGIN ?? 'http://127.0.0.1:5200';
const { isolate, seed, origin, captureTarget } = await import('../dividend-stage2/fixture.mjs');
const output = new URL('./', import.meta.url).pathname;
const result = {
  success: false,
  origin,
  scope: 'Isolated Chrome profiles and synthetic data. External API traffic is blocked. No real user database, live market/research service, APK installation or physical device is exercised.',
  checks: [], layouts: [], errors: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => result.errors.push(error.message));
const check = name => result.checks.push({ name, passed: true });
const reader = page.locator('.div-advisor-reader');
const stockCard = code => reader.locator('.div-ai-research-card').filter({ has: page.locator('header small', { hasText: code }) });
const stocks = () => page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.toArray());
const weightless = rows => rows.map(({ weightBps: _weight, ...rest }) => rest);
const topDialog = () => page.locator('dialog[open]').last();
const assertTranslated = async scope => {
  const raw = (await scope.innerText()).match(/\b(?:div|df)_[a-z][a-z0-9_]+\b/g) ?? [];
  assert.deepEqual(raw, [], 'User-visible untranslated dividend keys');
};
const layout = async (scope, name, width, scale) => {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(value => { document.documentElement.style.fontSize = `${value * 16}px`; }, scale);
  const measured = await scope.evaluate(root => {
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const elements = [root, ...root.querySelectorAll('*')].filter(visible);
    const outside = elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.right > innerWidth + 1 || rect.left < -1;
    }).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.trim().slice(0, 90), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
    const clippedButtons = elements.filter(element => element.tagName === 'BUTTON' && element.scrollWidth > element.clientWidth + 1)
      .map(element => ({ text: element.textContent.trim(), width: element.clientWidth, scrollWidth: element.scrollWidth }));
    const toolbar = [...root.querySelectorAll('.div-selection-actions button')].filter(visible).map(element => ({ text: element.textContent.trim(), rect: element.getBoundingClientRect().toJSON() }));
    const overlaps = toolbar.flatMap((a, index) => toolbar.slice(index + 1).filter(b => a.rect.right > b.rect.left + 1 && b.rect.right > a.rect.left + 1 && a.rect.bottom > b.rect.top + 1 && b.rect.bottom > a.rect.top + 1).map(b => [a.text, b.text]));
    return { outside, clippedButtons, overlaps };
  });
  result.layouts.push({ name, width, scale, ...measured });
  assert.deepEqual(measured.outside, [], `${name} horizontal overflow at ${width}px / ${scale}x font`);
  assert.deepEqual(measured.clippedButtons, [], `${name} clipped button text at ${width}px / ${scale}x font`);
  assert.deepEqual(measured.overlaps, [], `${name} overlapping toolbar buttons at ${width}px / ${scale}x font`);
  await assertTranslated(scope);
};
const sizes = [[320, 1], [320, 1.3], [390, 1], [390, 1.3], [1280, 1]];
const openHome = async () => {
  await page.goto(origin);
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-wb-stocks').waitFor();
  await page.waitForFunction(() => !document.querySelector('.div-focus-top-tools button')?.disabled);
};
const openSelection = async () => {
  await page.locator('.div-home-advisor').getByRole('button', { name: /选股与计划/ }).click();
  await reader.locator('.div-ai-research-card').first().waitFor();
  await page.waitForFunction(() => !!document.querySelector('.div-advisor-reader .div-ai-research-card .div-compact-targets'));
};

try {
  await isolate(page);
  await seed(page, { preferences: true });
  await page.evaluate(async () => {
    const { db, updateSettings } = await import('/src/db.ts');
    await updateSettings({ amountVisible: true, themeMode: 'light', dividendStrategy: 'stocks' });
    await db.dividendStocks.update('000001', { weightBps: 2000 });
    await db.dividendStocks.update('000005', { weightBps: 0 });
  });
  await openHome();
  await assertTranslated(page.locator('.dividend-page'));
  await page.locator('.div-wb-overview').getByRole('button', { name: '预算与分配', exact: true }).click();
  await topDialog().getByRole('button', { name: '一键重新分配预算', exact: true }).click();
  const allocation = topDialog();
  await allocation.locator('#div-allocation-title').waitFor();
  assert.match(await allocation.innerText(), /0%/);
  const before = await stocks();
  assert.equal(before.find(stock => stock.code === '000005').weightBps, 0);
  assert.equal(before.find(stock => stock.code === '000001').weightBps, 2000);
  assert.deepEqual(await stocks(), before, 'Opening allocation preview must not write weights');
  await allocation.screenshot({ path: `${output}budget-preview-390.png` });
  check('Equal allocation is available even at 100% total and opens a before/after preview without changing saved weights');

  await page.evaluate(async () => (await import('/src/db.ts')).db.settings.update('main', { dividendBudgetMinor: 3100000 }));
  await allocation.getByRole('button', { name: '确认重新分配', exact: true }).click();
  await allocation.getByRole('alert').waitFor();
  assert.match(await allocation.getByRole('alert').innerText(), /已变化/);
  assert.deepEqual(await stocks(), before);
  await allocation.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(async () => (await import('/src/db.ts')).db.settings.update('main', { dividendBudgetMinor: 3000000 }));
  check('A concurrent budget edit refuses the stale preview with an actionable message and no weight writes');

  await topDialog().getByRole('button', { name: '一键重新分配预算', exact: true }).click();
  const ledgerBefore = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return { holdings: await db.holdings.toArray(), trades: await db.holdingTxns.toArray(), fundPlan: (await db.settings.get('main')).dividendFundPlan };
  });
  await topDialog().getByRole('button', { name: '确认重新分配', exact: true }).click();
  await page.waitForFunction(async () => (await (await import('/src/db.ts')).db.dividendStocks.toArray()).every(stock => stock.weightBps === 1000));
  const equal = await stocks();
  assert.deepEqual(weightless(equal), weightless(before));
  assert.deepEqual(await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    return { holdings: await db.holdings.toArray(), trades: await db.holdingTxns.toArray(), fundPlan: (await db.settings.get('main')).dividendFundPlan };
  }), ledgerBefore);
  await page.locator('.div-wb-dialog[open] .div-wb-dialog-header button').click();
  check('Confirming equal allocation funds the previously zero-weight stock and preserves prices, grids, pause status, fund plan and holdings');

  await page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.update('000005', { weightBps: 0 }));
  await openHome();
  await page.locator('.div-wb-overview').getByRole('button', { name: '预算与分配', exact: true }).click();
  await topDialog().getByRole('button', { name: '分配剩余预算', exact: true }).click();
  const proportional = topDialog();
  await proportional.locator('#div-allocation-title').waitFor();
  const proportionalBefore = await stocks();
  assert.deepEqual(await stocks(), proportionalBefore, 'Opening a proportional preview must not write weights');
  await page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.update('000001', { weightBps: 0 }));
  const concurrentWeights = await stocks();
  await proportional.getByRole('button', { name: '确认重新分配', exact: true }).click();
  await proportional.getByRole('alert').waitFor();
  assert.match(await proportional.getByRole('alert').innerText(), /已变化/);
  assert.deepEqual(await stocks(), concurrentWeights, 'A stale proportional preview must preserve the concurrent user edit');
  await proportional.screenshot({ path: `${output}budget-proportional-conflict-390.png` });
  await proportional.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.div-wb-dialog[open] .div-wb-dialog-header button').click();
  await page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.update('000001', { weightBps: 1000 }));
  await openHome();
  check('A concurrent weight edit refuses the frozen proportional allocation preview and preserves the newer weights without reallocating');

  await page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.update('000005', { weightBps: 0 }));
  await openSelection();
  assert.equal(await reader.getByRole('button', { name: '自动补齐资料并检查', exact: true }).count(), 1);
  assert.equal(await reader.locator('.div-selection-actions').getByRole('button', { name: '一键重新分配预算', exact: true }).count(), 1);
  await stockCard('000004').getByRole('button', { name: '状态 / 编辑 / 删除', exact: true }).click();
  await topDialog().getByRole('button', { name: '删除', exact: true }).click();
  const deletion = topDialog().locator('.div-delete-preview');
  await deletion.waitFor();
  assert.equal(await deletion.getByRole('checkbox').isChecked(), true);
  assert.match(await deletion.innerText(), /0%/);
  await deletion.locator('.btn-danger').click();
  await page.waitForFunction(async () => !(await (await import('/src/db.ts')).db.dividendStocks.get('000004')));
  const deleted = await stocks();
  assert.ok(deleted.find(stock => stock.code === '000005').weightBps > 0);
  assert.equal(deleted.reduce((sum, stock) => sum + stock.weightBps, 0), 9000);
  check('Deleting with redistribution selected gives released allocation to zero-weight stocks and retains the previous 10% unallocated share');

  for (const [width, scale] of sizes) {
    await layout(reader, 'selection', width, scale);
    if (width < 1000) {
      await reader.locator('.div-advisor-reader-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: `${output}selection-${width}-${scale}.png` });
      await reader.locator('.div-selection-actions').screenshot({ path: `${output}selection-toolbar-${width}-${scale}.png` });
    }
  }
  check('Selection controls and collapsed cards fit 320/390px, enlarged fonts and a desktop viewport without overlap, clipping or raw translation keys');

  const blocked = stockCard('000003');
  await blocked.getByRole('button', { name: '查看定价方案', exact: true }).click();
  await blocked.locator('.div-ai-pricing-card').waitFor({ state: 'visible' });
  const pricing = blocked.locator('.div-ai-pricing-card');
  await pricing.locator('.div-price-guide.is-waiting').waitFor();
  assert.equal(await pricing.getByRole('button', { name: '自动补齐并重算', exact: true }).count(), 1);
  assert.equal(await blocked.locator('.div-ai-pricing-card').getByRole('button', { name: /div_cs_apply_single_btn/ }).count(), 0);
  assert.equal(await blocked.locator('.div-ai-pricing-card .div-ai-plan-actions').count(), 0);
  const applyLabels = await blocked.locator('.div-ai-pricing-card button:visible').allTextContents();
  assert.ok(!applyLabels.some(label => /应用|采用|apply|save/i.test(label)), `Blocked fallback must not have an apply action: ${applyLabels.join(', ')}`);
  assert.ok((await pricing.innerText()).length > 0);
  check('A stock with malformed current ledger evidence displays its blocked pricing state without a fallback apply action');

  await pricing.getByText('价格是怎么算出来的', { exact: true }).click();
  assert.match(await pricing.innerText(), /1 · 取已实施分红/);
  assert.match(await pricing.innerText(), /2 · 只扣一次税/);
  assert.match(await pricing.innerText(), /3 · 除以固定股息率/);
  assert.match(await pricing.innerText(), /原计划保留/);
  assert.match(await pricing.innerText(), /预览.*确认/);
  for (const [width, scale] of sizes.filter(([width]) => width < 1000)) {
    await layout(reader, 'pricing explanation', width, scale);
    await pricing.screenshot({ path: `${output}pricing-blocked-${width}-${scale}.png` });
  }
  check('Blocked pricing offers a single automatic retry, explains the dividend/tax/yield calculation and retains preview/confirmation before saving');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
  await blocked.locator('.div-check-status-evidence > summary').click();
  const ordinaryEvidence = await blocked.locator('.div-check-status-evidence').evaluate(element => ({
    height: element.getBoundingClientRect().height,
    sourceListsVisible: [...element.querySelectorAll('.div-check-status-sources')].filter(item => item.getClientRects().length).length,
    sourceDisclosures: [...element.querySelectorAll('details > summary')].filter(item => item.textContent.includes('原始来源与日期')).length,
  }));
  result.ordinaryEvidence = ordinaryEvidence;
  assert.equal(ordinaryEvidence.sourceListsVisible, 0);
  assert.equal(ordinaryEvidence.sourceDisclosures, 1);
  assert.ok(ordinaryEvidence.height < 5000, `Ordinary evidence unexpectedly long: ${ordinaryEvidence.height}px`);
  await blocked.locator('.div-check-status-evidence > summary').screenshot({ path: `${output}evidence-entry-390.png` });
  check('Opening the main evidence keeps repeated source links collapsed under one entrance and keeps ordinary content below 5000 CSS pixels');
  // Nested sources/history disclosures are opened as real user controls to exercise their longest content.
  const nestedSummaries = blocked.locator('details:not([open]) > summary');
  const disclosureCount = await blocked.locator('details').count();
  for (let attempt = 0; attempt < disclosureCount; attempt++) {
    const visible = nestedSummaries.filter({ visible: true });
    if (!await visible.count()) break;
    await visible.first().click();
  }
  assert.equal(await nestedSummaries.filter({ visible: true }).count(), 0, 'Every visible nested evidence disclosure must be expanded for layout checks');
  result.expandedDisclosures = { total: disclosureCount, open: await blocked.locator('details[open]').count() };
  for (const [width, scale] of sizes) {
    await layout(reader, 'expanded evidence and pricing', width, scale);
    if (width === 320 || width === 390) await captureTarget(page, blocked, `${output}expanded-${width}-${scale}.png`);
  }
  check('Expanded evidence, source links, historical prices and pricing grids fit narrow and enlarged-font layouts with no untranslated keys');

  const beforeRetry = await stocks();
  await pricing.getByRole('button', { name: '自动补齐并重算', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.div-advisor-reader .div-selection-actions > button')?.disabled);
  await pricing.locator('.div-price-guide.is-waiting').waitFor();
  assert.deepEqual(await stocks(), beforeRetry);
  assert.equal(await reader.locator('.div-ai-research-card').count(), 9);
  await assertTranslated(reader);
  check('The single-stock retry completes with synthetic research, preserves saved prices/budgets/holdings and keeps the other plans visible');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
  await reader.getByRole('button', { name: '返回', exact: true }).click();
  await page.locator('.div-wb-segment').getByRole('button', { name: '红利基金计划', exact: true }).click();
  await page.locator('.df-today-overview').waitFor();
  assert.equal(await page.locator('.div-home-advisor .div-daily-check:visible').count(), 0);
  assert.doesNotMatch(await page.locator('.div-home-advisor').innerText(), /今日检查|检查阶段|批次 [a-z0-9]|检查完成|需处理 · 先复核/);
  assert.equal(await page.locator('.div-fund-home-card .df-today-action').count(), 2);
  assert.equal(await page.locator('.div-fund-home .div-check-status:visible').count(), 0);
  const fundBefore = await page.evaluate(async () => (await (await import('/src/db.ts')).db.settings.get('main')).dividendFundPlan);
  for (const [width, scale] of sizes) {
    await layout(page.locator('.dividend-page'), 'fund today', width, scale);
    if (width < 1000) await captureTarget(page, page.locator('.dividend-page'), `${output}fund-today-${width}-${scale}.png`);
  }
  check('Fund home presents Today’s actions and per-fund arrangements with the old daily batch audit hidden');
  await page.locator('.div-fund-home-card').first().getByRole('button', { name: /依据与数据/ }).click();
  assert.equal(await page.locator('.div-fund-home .div-check-status:visible').count(), 1);
  for (const [width, scale] of sizes.filter(([width]) => width < 1000)) await layout(page.locator('.dividend-page'), 'fund expanded evidence', width, scale);
  assert.deepEqual(await page.evaluate(async () => (await (await import('/src/db.ts')).db.settings.get('main')).dividendFundPlan), fundBefore);
  check('Fund evidence remains available on demand; reading and changing viewport do not modify the plan');

  const specialMetadata = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const { loadDividendWorkbench } = await import('/src/services/dividendService.ts');
    const { loadDividendCheckSummaries } = await import('/src/services/dividendCheckSummaryService.ts');
    const evidenceStore = new Dexie('FortunaDividendLedger');
    evidenceStore.version(1).stores({ documents: 'url', ledgers: 'code' });
    const ledger = await evidenceStore.table('ledgers').get('000001');
    const first = { ...ledger.events[0], id: 'browser-special-one', batchId: 'browser-special-one', period: 'special',
      reportDate: '2026-09-30', announcementDate: '2026-10-01', exDate: '2026-10-02', implemented: true, shareFactor: 1.1,
      verification: 'verified', sources: [{ provider: 'issuer', url: 'https://example.com/browser-special-one', verifiedAt: '2026-10-03' }] };
    const second = { ...first, id: 'browser-special-two', batchId: 'browser-special-two', reportDate: '2026-10-01',
      announcementDate: '2026-10-04', exDate: '2026-10-05',
      sources: [{ provider: 'issuer', url: 'https://example.com/browser-special-two', verifiedAt: '2026-10-06' }] };
    await evidenceStore.table('ledgers').put({ ...ledger, events: [...ledger.events, first, second] });
    evidenceStore.close();
    await db.settings.update('main', { dividendStrategy: 'stocks' });
    const inspection = await loadDividendCheckSummaries(await loadDividendWorkbench());
    return inspection.stocks['000001'].risk.evidenceInsufficient.filter(item => item.reason === 'special_dividend_review')
      .map(item => ({ id: item.id, sources: item.sources, period: item.reportPeriod, published: item.publishedAt, verified: item.verifiedAt }));
  });
  assert.deepEqual(specialMetadata, [
    { id: 'special_dividend_review:browser-special-one', sources: ['https://example.com/browser-special-one'], period: '2026-09-30', published: '2026-10-01', verified: '2026-10-03' },
    { id: 'special_dividend_review:browser-special-two', sources: ['https://example.com/browser-special-two'], period: '2026-10-01', published: '2026-10-04', verified: '2026-10-06' },
  ], 'The real check engine must retain both supported special-event records before testing their UI');
  await openHome(); await openSelection();
  const specialCard = stockCard('000001');
  await specialCard.locator('.div-check-status-evidence > summary').click();
  const specialEvidence = specialCard.locator('.div-check-status-evidence');
  await specialEvidence.getByText(/查看全部观察与资料缺口/).click();
  const eventRows = specialEvidence.locator('li').filter({ hasText: '本次基数或比较涉及特别分红' });
  assert.equal(await eventRows.count(), 2, 'Distinct special events must retain separate metadata rows');
  assert.match(await eventRows.nth(0).innerText(), /2026-09-30[\s\S]*2026-10-01[\s\S]*2026-10-03/);
  assert.match(await eventRows.nth(1).innerText(), /2026-10-01[\s\S]*2026-10-04[\s\S]*2026-10-06/);
  await specialEvidence.getByText('原始来源与日期', { exact: true }).click();
  assert.equal(await specialEvidence.locator('a[href="https://example.com/browser-special-one"]').count(), 1);
  assert.equal(await specialEvidence.locator('a[href="https://example.com/browser-special-two"]').count(), 1);
  await assertTranslated(specialEvidence);
  await captureTarget(page, specialEvidence, `${output}distinct-special-event-evidence-390.png`);
  result.specialEventMetadata = specialMetadata;
  check('Two distinct special-dividend events keep their own report, announcement and verification dates and both original source links in the UI');

  assert.deepEqual(result.errors, []);
  result.success = true;
} catch (error) {
  result.failure = error.stack;
  await page.screenshot({ path: `${output}experience-failure.png` }).catch(() => {});
} finally {
  await writeFile(`${output}experience-verification.json`, JSON.stringify(result, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
