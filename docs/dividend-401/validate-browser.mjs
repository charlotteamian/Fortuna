import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const output = new URL('./', import.meta.url).pathname;
const fixture = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const result = { environment: 'Isolated Chrome; synthetic ledger, archived dividend fixture, mocked quotes/research/model transport', checks: [], errors: [], screenshots: [], limitations: ['No real provider request or physical-device installation is represented.'] };
const check = name => result.checks.push({ name, passed: true });
page.on('pageerror', error => result.errors.push(error.message));
let mode = 'success', answerNumber = 0, releasePending, lastRequest;
await page.route('https://model.example/**', async route => {
  lastRequest = route.request().postDataJSON();
  if (mode === 'failure') return route.fulfill({ status: 503, body: '{}' });
  if (mode === 'pending') await new Promise(resolve => { releasePending = resolve; });
  const answer = `今日建议第${++answerNumber}次：先核对基金触发条件，股票按已保存网格等待。\n\n- 平安银行：结合已有200股与手动暂停状态核对。\n- 红利基金：核对入场条件与已有份额。`;
  await route.fulfill({ json: { choices: [{ message: { content: answer } }] } }).catch(() => undefined);
});
await page.route('**/qt-api/**', route => {
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '') + '150000';
  const rows = [['sz000001', '000001', '11.20'], ['sh515450', '515450', '1.00'], ['sh512890', '512890', '1.02']].map(([symbol, code, price]) => {
    const f = Array(40).fill(''); f[1] = 'Synthetic'; f[2] = code; f[3] = price; f[30] = stamp; f[32] = '0';
    return `v_${symbol}="${f.join('~')}";`;
  }).join('\n');
  return route.fulfill({ body: rows });
});
await page.route('**/src/services/dividendResearchService.ts*', route => route.fulfill({ contentType: 'text/javascript', body: `import { loadDividendResearchCache } from '/src/services/dividendResearchCacheService.ts'; export async function fetchDividendResearch(stocks, principles, options={}) { const cached=await loadDividendResearchCache(); return { ...cached.snapshot, generatedAt:Date.now(), principles, pricingMethod:options.pricingMethod, stocks:cached.snapshot.stocks.filter(s=>stocks.some(x=>x.code===s.code)) }; }` }));
await page.route('**/dividend-*-api/**', route => route.abort());
await page.route('**/dividend-api/**', route => route.abort());
const readStock = () => page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.get('000001'));
const preserved = stock => ({ buyLevels: stock.buyLevels, sellLevels: stock.sellLevels, manualShares: stock.manualShares, buyPaused: stock.buyPaused, weightBps: stock.weightBps });
const capture = async (name, target) => {
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: `${output}${name}.png` }); result.screenshots.push(`${name}.png`);
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll('.dividend-page *, .div-advisor-reader *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => ({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,100),right:e.getBoundingClientRect().right})).slice(0, 8) }));
  assert.ok(overflow.scroll <= overflow.width + 1 && !overflow.outside.length, JSON.stringify(overflow)); check(`${name}: no horizontal overflow`);
};
const goHome = async () => { await page.goto('http://127.0.0.1:5173'); await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click(); await page.locator('.div-fund-home-card').first().waitFor(); };
try {
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async fixture => {
    const { db, initializeSettings, updateSettings, CURRENT_ONBOARDING_VERSION, CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } = await import('/src/db.ts');
    const { dateInChina } = await import('/src/lib/dividendWorkbench.ts');
    const { defaultDividendPricingMethod, calculateDividendPricing, dividendPricingTrailingDividend, dividendPricingAnnuals } = await import('/src/lib/dividendPricing.ts');
    const { defaultDividendSelectionPrinciples } = await import('/src/lib/dividendResearch.ts');
    const { saveDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
    const { saveDividendAdvisorConfig } = await import('/src/services/dividendAdvisorService.ts');
    await initializeSettings(); const date = dateInChina(), now = Date.now(), method = defaultDividendPricingMethod(), principles = defaultDividendSelectionPrinciples();
    await updateSettings({ language: 'zh', amountVisible: true, onboardingVersion: CURRENT_ONBOARDING_VERSION, automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
      themeMode: 'light', colorTheme: 'rose-olive', dividendWorkbenchInitialized: true, dividendBudgetMinor: 3000000, dividendStrategy: 'stocks', dividendSelectionPrinciples: principles, dividendPricingMethod: method,
      dividendFundPlan: { budgetMinor: 1000000, mode: 'swing', entryRule: 'both', drawdownBps: 1000, indexYieldBps: 500, funds: [
        { id: 'fund-one', name: '红利低波基金', code: '515450', indexKind: 'low_volatility', weightBps: 5000, reference: { asOf: date, priceMicros: 1000000, highMicros: 1200000, indexYieldBps: 550, source: 'Synthetic reference' } },
        { id: 'fund-two', name: '前高触发基金', code: '512890', indexKind: 'low_volatility_100', weightBps: 5000, reference: { asOf: date, priceMicros: 1020000, highMicros: 1000000, indexYieldBps: 450 } },
      ] } });
    await db.dividendStocks.clear();
    await db.dividendStocks.put({ code: '000001', name: '平安银行', group: 'core', weightBps: 10000, shareMode: 'manual', manualShares: 200, lotSize: 100,
      buyPaused: true, manualDpsMicros: 609000, buyLevels: [1400, 1200, 1100].map((priceMinor, i) => ({ priceMinor, yieldBps: 400 + i * 100, portionBps: [3333, 3333, 3334][i] })),
      sellLevels: [1600, 1800, 2000, 2400].map((priceMinor, i) => ({ priceMinor, yieldBps: 350 - i * 50, portionBps: 2500 })),
      dividend: { schemaVersion: 2, asOf: date, windowStart: date, payments: [], fetchedAt: now }, quote: { priceMinor: 1120, date, fetchedAt: now } });
    const pricing = calculateDividendPricing({ code: '000001', name: '平安银行', financialSector: true, method, asOf: date,
      annuals: dividendPricingAnnuals(fixture.sources.financial.data, undefined, fixture.sources.distribution.data, '000001', date),
      trailingDividend: dividendPricingTrailingDividend(fixture.sources.distribution.data, '000001', date), priceMinor: 1120, priceDate: date, currentCashYieldBps: 544 });
    await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: now, principles, pricingMethod: method, indices: [], stocks: [{ code: '000001', name: '平安银行', pricing,
      financial: { sector: 'bank', periods: [{ reportDate: '2025-12-31', noticeDate: '2026-03-21', revenueGrowthBps: 100, profitGrowthBps: 200, roeBps: 915 }] }, checks: [{ rule: 'roe', status: 'risk', value: 915, threshold: 1000, period: '2025-12-31' }], status: 'risk', sources: [], issues: [] }] } });
    await saveDividendAdvisorConfig({ protocol: 'openai', baseUrl: 'https://model.example', model: 'isolated-test', apiKey: 'SYNTHETIC-NOT-A-REAL-KEY' });
  }, fixture);
  await goHome();
  assert.equal(await page.locator('.div-fund-home-card').count(), 2);
  assert.equal(await page.locator('.div-stock-reading .div-home-plan').count(), 1);
  assert.match(await page.locator('.div-fund-home-card').first().innerText(), /计划金额.*5,000/s);
  assert.match(await page.locator('.div-fund-home-card').first().innerText(), /1\.08/);
  assert.match(await page.locator('.div-fund-home-card').first().innerText(), /已满足你设定/);
  assert.match(await page.locator('.div-fund-home-card').nth(1).innerText(), /已达到卖出参考/);
  assert.equal(await page.locator('.div-advisor-entry-actions').getByRole('button', { name: /计划管理/ }).count(), 0);
  check('home shows stock and both fund plans together, target amounts and independent entry/sell triggers');
  await page.locator('.div-stock-toggle').first().click();
  assert.equal(await page.locator('.div-stock-reading .div-home-plan').isVisible(), true); check('collapsing dividend detail leaves the stock execution plan visible');
  for (const width of [390, 320]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: `html { font-size: ${16 * scale}px !important; }` });
    await capture(`fund-${width}-${scale}`, page.locator('.div-fund-home-card').first());
  }
  await page.locator('.div-daily-heading').getByRole('button', { name: '查看今日建议', exact: true }).click();
  await page.locator('.div-daily-result').getByText(/今日建议第1次/).waitFor();
  assert.equal(await page.locator('.div-advisor-reader').count(), 0);
  assert.match(lastRequest.messages.at(-1).content, /同时查看.*股票计划.*基金计划/s);
  assert.match(lastRequest.messages.at(-1).content, /515450/); assert.match(lastRequest.messages.at(-1).content, /000001/);
  check('one-click daily advice refreshes context and answers inline with both plans without opening chat');
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await capture(`daily-${width}-1.3`, page.locator('.div-home-advisor')); }
  mode = 'failure'; await page.locator('.div-daily-heading button').click();
  await page.locator('.div-daily-advice [role=alert]').waitFor(); assert.match(await page.locator('.div-daily-result').innerText(), /第1次/);
  check('failed regeneration keeps the last completed recommendation');
  mode = 'pending'; await page.locator('.div-daily-heading button').click();
  await page.waitForFunction(() => document.querySelector('.div-daily-progress')?.textContent.includes('思考') || document.querySelector('.div-daily-progress'));
  await page.waitForTimeout(100);
  await page.locator('.div-daily-progress button').click();
  releasePending?.(); await page.waitForTimeout(100);
  assert.match(await page.locator('.div-daily-result').innerText(), /第1次/); check('cancelled generation cannot replace the last completed answer');
  mode = 'success'; await goHome(); assert.match(await page.locator('.div-daily-result').innerText(), /第1次/); check('daily answer survives reload in Dexie');
  await page.evaluate(async () => { const { db } = await import('/src/db.ts'); await db.dividendStocks.update('000001', { manualShares: 300 }); });
  await goHome(); await page.getByText('计划、持仓或语言已变化，请重新生成建议。', { exact: true }).waitFor(); check('stock holdings changes flag the saved answer as outdated');
  await page.locator('.div-daily-heading button').click(); await page.locator('.div-daily-advice [role=alert]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('.div-daily-progress'));
  const dailyText = await page.locator('.div-daily-result').innerText(); assert.match(dailyText, /今日建议/);
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts');
    await db.accounts.put({ id: 'test-fund-account', name: 'Synthetic fund account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, createdAt: 1, sortOrder: 0 });
    await db.holdings.put({ id: 'test-fund-holding', accountId: 'test-fund-account', name: 'Synthetic fund', symbol: '515450', createdAt: 1, sortOrder: 0 });
    await db.holdingTxns.put({ id: 'test-fund-buy', holdingId: 'test-fund-holding', accountId: 'test-fund-account', date: new Date().toLocaleDateString('sv-SE'), kind: 'buy', shares: 1000, price: 1, fee: 0, createdAt: 1 });
  });
  await goHome(); await page.getByText('计划、持仓或语言已变化，请重新生成建议。', { exact: true }).waitFor(); check('fund ledger trades also invalidate the saved recommendation');
  const scopeChecks = await page.evaluate(async () => {
    const { db, updateSettings } = await import('/src/db.ts');
    const { loadDividendWorkbench } = await import('/src/services/dividendService.ts');
    const { loadDividendDailyAdvicePlanKey } = await import('/src/services/dividendDailyAdviceScopeService.ts');
    const key = async () => loadDividendDailyAdvicePlanKey(await loadDividendWorkbench());
    const initial = await key(); const settings = await db.settings.get('main'); const saved = await db.dividendStocks.get('000001');
    await db.dividendStocks.update('000001', { quote: { ...saved.quote, fetchedAt: Date.now() + 1 } });
    const quoteUnchanged = await key() === initial;
    await updateSettings({ dividendPricingMethod: { ...settings.dividendPricingMethod, holdingPeriod: 'month_to_year' } });
    const taxChanged = await key() !== initial;
    await updateSettings({ dividendPricingMethod: settings.dividendPricingMethod, dividendSelectionPrinciples: { ...settings.dividendSelectionPrinciples, notes: 'Changed principle' } });
    const principlesChanged = await key() !== initial;
    await updateSettings({ dividendSelectionPrinciples: settings.dividendSelectionPrinciples });
    await db.accounts.put({ id: 'excluded-fund-account', name: 'Archived synthetic account', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, archivedAt: 1, createdAt: 1, sortOrder: 0 });
    await db.holdings.put({ id: 'excluded-fund-holding', accountId: 'excluded-fund-account', name: 'Excluded fund', symbol: '515450', createdAt: 1, sortOrder: 0 });
    await db.holdingTxns.put({ id: 'excluded-fund-buy', holdingId: 'excluded-fund-holding', accountId: 'excluded-fund-account', date: new Date().toLocaleDateString('sv-SE'), kind: 'buy', shares: 2000, price: 1, fee: 0, createdAt: 1 });
    return { quoteUnchanged, taxChanged, principlesChanged, archivedExcluded: await key() === initial };
  });
  assert.deepEqual(scopeChecks, { quoteUnchanged: true, taxChanged: true, principlesChanged: true, archivedExcluded: true });
  check('advice scope tracks tax and principles, ignores quote-download time and excludes archived fund positions');

  await page.evaluate(async () => { const service = await import('/src/services/dividendDailyAdviceService.ts'); const value = await service.loadDividendDailyAdvice(); await service.saveDividendDailyAdvice({ ...value, generatedAt: '2026-10-27T01:30:00.000Z' }); });
  await goHome(); await page.getByText('这是之前日期的建议，请重新生成今日建议。', { exact: true }).waitFor(); check('prior-date advice keeps its original date and asks for a fresh result');
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click(); assert.equal(await page.locator('.div-daily-result').count(), 0); check('hiding amounts hides daily advice');
  await page.getByRole('button', { name: '显示金额', exact: true }).click();
  await page.locator('.div-advisor-entry-actions').getByRole('button', { name: /选股检查/ }).click();
  await page.locator('.div-ai-research-card').waitFor();
  const stock = page.locator('.div-ai-research-card').first(), pricing = stock.locator('.div-ai-pricing-card');
  assert.equal(await page.locator('.div-advisor-workspace-tabs button[aria-current=page]').innerText(), '选股检查');
  assert.equal(await stock.locator('details').count(), 1); assert.equal(await stock.locator('.div-ai-research-details').getAttribute('open'), null);
  assert.equal(await pricing.locator('tbody tr').count(), 4);
  assert.equal(await stock.getByRole('button', { name: '预览买卖价格计划', exact: true }).count(), 1);
  assert.equal(await pricing.getByRole('button', { name: '预览买卖价格计划', exact: true }).isVisible(), true);
  assert.equal(await stock.getByText('经营、价格与技术复核', { exact: true }).count(), 0);
  check('home opens Stock Checks directly; generated grid and the sole price preview are visible above a single evidence disclosure');
  for (const width of [390, 320]) for (const scale of [1, 1.3]) { await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: `html { font-size: ${16 * scale}px !important; }` }); await capture(`checks-${width}-${scale}`, stock); }
  const before = await readStock(); await pricing.getByRole('button', { name: '预览买卖价格计划', exact: true }).click();
  await pricing.locator('.div-ai-grid-proposed').waitFor(); assert.equal(await pricing.locator('.div-ai-grid-proposed tbody tr').count(), 8);
  assert.deepEqual(preserved(await readStock()), preserved(before)); check('preview includes all eight replacement levels and does not write the plan');
  await capture('preview-320-1.3', pricing);
  await pricing.getByRole('button', { name: '确认写入网格计划', exact: true }).click(); await pricing.getByText('已写入网格计划。', { exact: true }).waitFor();
  const after = await readStock(); assert.deepEqual(after.buyLevels.map(x => x.priceMinor), [1107, 1059, 1015, 936]); assert.deepEqual(after.sellLevels.map(x => x.priceMinor), [1268, 1353, 1450, 1522]);
  assert.equal(after.manualShares, before.manualShares); assert.equal(after.buyPaused, before.buyPaused); assert.equal(after.weightBps, before.weightBps); check('confirmation writes both verified sides while retaining holdings, weight and manual pause');
  await stock.locator('.div-ai-research-details > summary').click(); assert.equal(await stock.locator('.div-ai-research-details details').count(), 0);
  assert.match(await stock.locator('.div-ai-research-details').innerText(), /原则检查.*技术位置.*经营/s); await capture('evidence-320-1.3', stock); check('all supporting evidence is available after one expansion with no nested evidence menus');
  const resume = stock.locator('.div-review-refresh-card');
  await resume.getByRole('button', { name: '更新复核', exact: true }).click();
  await resume.getByRole('checkbox').waitFor();
  assert.equal(await resume.getByRole('button', { name: '预览恢复加仓', exact: true }).isEnabled(), false);
  await resume.getByRole('checkbox').check(); await resume.getByRole('button', { name: '预览恢复加仓', exact: true }).click();
  await resume.getByRole('button', { name: '确认写入网格计划', exact: true }).click();
  await page.waitForFunction(async () => !(await (await import('/src/db.ts')).db.dividendStocks.get('000001')).buyPaused);
  const resumed = await readStock(); assert.deepEqual(resumed.buyLevels, after.buyLevels); assert.deepEqual(resumed.sellLevels, after.sellLevels);
  check('restoring a paused grid requires displayed fresh evidence, acknowledgement, preview and confirmation and keeps both price ladders');
  await page.locator('.div-advisor-workspace-tabs').getByRole('button', { name: '聊天', exact: true }).click();
  await page.getByRole('button', { name: /现在可以怎么做/ }).waitFor(); check('chat retains the original quick question for next steps');
  assert.deepEqual(result.errors, []);
} catch (error) { result.failure = error.stack; await page.screenshot({ path: `${output}failure.png`, fullPage: true }); throw error; }
finally { await writeFile(`${output}browser-validation.json`, JSON.stringify(result, null, 2) + '\n'); await browser.close(); }
