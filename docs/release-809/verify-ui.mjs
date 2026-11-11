import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

process.env.FORTUNA_STAGE2_ORIGIN = process.env.FORTUNA_809_ORIGIN ?? 'http://127.0.0.1:5210';
const { isolate, seed, origin, captureTarget, stockCodes } = await import('../dividend-stage2/fixture.mjs');
const output = new URL('./', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const targetCode = '000005', targetName = '模拟高价股票', asOf = '2026-11-01';
const expectedBuy = [13693, 13097, 12552, 11586], expectedSell = [15690, 16736, 17932, 18828];
const oldBuy = [12554, 12008, 11508, 10623];
const distributionFixture = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8')).sources.distribution.data;
const smoke = process.argv.includes('--smoke');
const screenshotsOnly = process.argv.includes('--screenshots');
const result = { success: false, mode: screenshotsOnly ? 'representative screenshot workflows' : smoke ? 'focused workflow' : 'eight width/font/theme combinations',
  scope: 'Isolated synthetic Chrome contexts and mocked HTTP responses. The real research, cache, validation and apply modules execute. No user database, live service or physical device.',
  checks: [], layouts: [], screenshots: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

function currentDistribution(code) {
  if (code === targetCode) return { success: true, result: { pages: 1, data: [{ SECURITY_CODE: code, REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-07-10',
    EQUITY_RECORD_DATE: '2026-07-16', EX_DIVIDEND_DATE: '2026-07-17', PRETAX_BONUS_RMB: 83.68, BONUS_RATIO: 0, IT_RATIO: 0, ASSIGN_PROGRESS: '实施' }] } };
  const raw = structuredClone(distributionFixture);
  raw.result.data.forEach(row => { row.SECURITY_CODE = code; });
  raw.result.pages = 1;
  return raw;
}

async function prepare(page, theme) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => result.errors.push(error.message));
  await isolate(page);
  await page.route('**/src/services/dividendResearchService.ts*', route => route.continue());
  await page.route('**/qt-api/**', route => route.fulfill({ body: [...stockCodes, '512890'].map(code => {
    const fields = Array(40).fill('');
    fields[1] = code === targetCode ? targetName : 'Synthetic'; fields[2] = code;
    fields[3] = code === targetCode ? '247.13' : code === '512890' ? '1.2' : '8';
    fields[30] = '20261101100000'; fields[32] = '0';
    return `v_${code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'}${code}="${fields.join('~')}";`;
  }).join('\n') }));
  await seed(page, { preferences: true });
  await page.evaluate(async ({ theme, targetCode, targetName }) => {
    const { db, updateSettings } = await import('/src/db.ts');
    const { calculateDividendPricing, defaultDividendPricingMethod } = await import('/src/lib/dividendPricing.ts');
    const { buildDividendLedger } = await import('/src/lib/dividendLedger.ts');
    const { dividendPricingPlan, dividendPricingProvenance } = await import('/src/lib/dividendPricingPlan.ts');
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const priorDate = '2026-10-31', priorGeneratedAt = Date.now() - 86400000, method = defaultDividendPricingMethod();
    const ledger = buildDividendLedger({ success: true, result: { pages: 1, data: [{ SECURITY_CODE: targetCode, REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-07-10',
      EQUITY_RECORD_DATE: '2026-07-16', EX_DIVIDEND_DATE: '2026-07-17', PRETAX_BONUS_RMB: 76.723, BONUS_RATIO: 0, IT_RATIO: 0, ASSIGN_PROGRESS: '实施' }] } }, targetCode, priorDate);
    const pricing = calculateDividendPricing({ code: targetCode, name: targetName, asOf: priorDate, ledger, method, financialSector: true,
      annuals: [{ year: 2025, reportDate: '2025-12-31', epsMicros: 15344600, payoutBps: 5000, dividendMicros: 7672300 }], priceMinor: 24713, priceDate: priorDate });
    const plan = dividendPricingPlan(pricing), provenance = dividendPricingProvenance(pricing, priorGeneratedAt);
    if (!plan || !provenance) throw new Error('SYNTHETIC_OLD_PLAN_UNAVAILABLE');
    delete provenance.officialParserVersion;
    const saved = await db.dividendStocks.get(targetCode);
    await db.dividendStocks.put({ ...saved, name: targetName, manualShares: 0, buyPaused: theme === 'dark', ...plan, gridProvenance: provenance,
      quote: { priceMinor: 24713, date: '2026-11-01 10:00', fetchedAt: Date.now() } });
    const ledgers = new Dexie('FortunaDividendLedger'); ledgers.version(1).stores({ documents: 'url', ledgers: 'code' });
    await ledgers.table('ledgers').put(ledger); ledgers.close();
    const cache = new Dexie('FortunaDividendResearchCache'); cache.version(1).stores({ results: 'id' });
    const record = await cache.table('results').get('latest');
    record.snapshot.stocks = record.snapshot.stocks.map(stock => stock.code === targetCode ? { ...stock, name: targetName, pricing, issues: [] } : stock);
    record.stockContexts[targetCode] = { ...record.stockContexts[targetCode], generatedAt: priorGeneratedAt };
    // Start with a legacy cache: its financial context is yesterday and it has
    // no separate pricing context yet.
    if (record.pricingContexts) delete record.pricingContexts[targetCode];
    await cache.table('results').put(record); cache.close();
    await updateSettings({ themeMode: theme, amountVisible: true, dividendStrategy: 'stocks', dividendBudgetMinor: 20830000 });
  }, { theme, targetCode, targetName });
  const requests = { distributionSuccess: 0, auxiliaryFailures: 0 };
  // The cash feed succeeds; financial, cash-flow, technical and comparison feeds
  // fail with HTTP 503. These are source-boundary mocks, not a research-module stub.
  await page.route('**/dividend-api/**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('type') === 'RPT_SHAREBONUS_DET') {
      const code = url.searchParams.get('filter')?.match(/\d{6}/)?.[0];
      assert.ok(code && stockCodes.includes(code), 'research distribution scope');
      requests.distributionSuccess++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(currentDistribution(code)) });
    }
    requests.auxiliaryFailures++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' });
  });
  for (const pattern of ['**/dividend-trend-api/**', '**/dividend-tencent-api/**', '**/dividend-index-api/**']) {
    await page.route(pattern, route => {
      requests.auxiliaryFailures++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' });
    });
  }
  return requests;
}

async function openSelection(page) {
  await page.goto(origin);
  await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click();
  await page.locator('.div-wb-stocks').waitFor();
  await page.locator('.div-home-advisor').getByRole('button', { name: /选股与计划/ }).click();
  const reader = page.locator('.div-advisor-reader');
  await reader.locator('.div-ai-research-card').first().waitFor();
  return reader;
}

function targetCard(page, reader) {
  return reader.locator('.div-ai-research-card').filter({ has: page.getByText(targetName, { exact: true }) });
}

async function pendingUpdate(card) {
  const banner = card.locator('.div-price-update');
  await banner.getByText('新价格待确认', { exact: true }).waitFor();
  assert.match(await banner.innerText(), /买入第 1 档：¥125.54 → ¥136.93/);
  assert.match(await card.locator('.div-compact-targets').innerText(), /已保存买入目标/);
  assert.match(await card.locator('.div-compact-targets').innerText(), /¥125.54/);
  await card.locator('.div-check-data-date').getByText(/分红 2026-11-01/).waitFor();
  assert.match(await card.locator('.div-check-data-date').innerText(), /行情 2026-11-01 10:00 · 分红 2026-11-01/);
  await banner.getByRole('button', { name: '查看并确认更新', exact: true }).click({ trial: true });
  return banner;
}

async function state(page) {
  return page.evaluate(async targetCode => {
    const { db } = await import('/src/db.ts');
    const { loadDividendResearchCache, dividendResearchSnapshotForStock } = await import('/src/services/dividendResearchCacheService.ts');
    const [stocks, settings, holdings, txns] = await Promise.all([db.dividendStocks.toArray(), db.settings.get('main'), db.holdings.toArray(), db.holdingTxns.toArray()]);
    const cache = await loadDividendResearchCache(), research = cache?.snapshot.stocks.find(stock => stock.code === targetCode);
    const target = stocks.find(stock => stock.code === targetCode), context = cache && dividendResearchSnapshotForStock(cache, targetCode);
    return { target: { buy: target.buyLevels.map(level => level.priceMinor), sell: target.sellLevels.map(level => level.priceMinor), provenance: target.gridProvenance },
      protected: { budgetMinor: settings.dividendBudgetMinor, stocks: stocks.map(stock => ({ code: stock.code, weightBps: stock.weightBps,
        shareMode: stock.shareMode, manualShares: stock.manualShares, lotSize: stock.lotSize, buyPaused: stock.buyPaused ?? false })).sort((a, b) => a.code.localeCompare(b.code)), holdings, txns },
      otherPlans: stocks.filter(stock => stock.code !== targetCode).map(stock => ({ code: stock.code, buy: stock.buyLevels, sell: stock.sellLevels, origin: stock.gridProvenance })).sort((a, b) => a.code.localeCompare(b.code)),
      research: research && { generatedAt: context.generatedAt, grossDpsMicros: research.pricing?.dividendBase?.dpsMicros, canApply: research.pricing?.canApply,
        blockers: research.pricing?.blockers, issues: research.issues, buy: research.pricing?.grid.map(level => level.priceMinor) } };
  }, targetCode);
}

async function layout(page, scope, phase, width, scale, theme) {
  const overflow = await scope.evaluate(root => [...root.querySelectorAll('*')].filter(element => {
    if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.right > innerWidth + 1 || rect.left < -1;
  }).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 80) })));
  assert.deepEqual(overflow, [], `${phase} overflow ${width}/${scale}/${theme}`);
  assert.doesNotMatch(await scope.innerText(), /\b(?:df_|div_)[a-z_]+\b/);
  result.layouts.push({ phase, width, scale, theme, overflow });
}

async function capture(page, card, name, width, scale, theme) {
  if (!(width === 320 && scale === 1.3 && theme === 'light' || width === 390 && scale === 1 && theme === 'dark' || smoke)) return;
  const filename = `${name}-${width}-${scale}-${theme}.png`;
  await captureTarget(page, card, `${output}${filename}`); result.screenshots.push(filename);
}

async function existingEvidenceWorkflow() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage(), requests = await prepare(page, 'light'), before = await state(page);
  const contexts = await page.evaluate(async ({ targetCode, targetName }) => {
    const { fetchDividendResearch } = await import('/src/services/dividendResearchService.ts');
    const { loadDividendResearchCache, saveDividendResearchCache, dividendResearchSnapshotForStock, dividendPricingSnapshotForStock } = await import('/src/services/dividendResearchCacheService.ts');
    const previous = await loadDividendResearchCache();
    const today = await fetchDividendResearch([{ code: targetCode, name: targetName }], previous.snapshot.principles,
      { pricingMethod: previous.snapshot.pricingMethod, marketContext: { indices: [] } });
    const saved = await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: today, reviewedCodes: [targetCode], collapsedCodes: previous.collapsedCodes },
      { preserveFailedSources: true });
    const financial = dividendResearchSnapshotForStock(saved, targetCode), pricing = dividendPricingSnapshotForStock(saved, targetCode);
    return { financialGeneratedAt: financial.generatedAt, pricingGeneratedAt: pricing.generatedAt, context: saved.pricingContexts?.[targetCode],
      currentPriceReady: pricing.stocks[0].pricing.canApply, grossDpsMicros: pricing.stocks[0].pricing.dividendBase.dpsMicros,
      issues: pricing.stocks[0].issues.map(issue => ({ kind: issue.kind, reason: issue.reason })) };
  }, { targetCode, targetName });
  assert.equal(contexts.financialGeneratedAt, Date.parse('2026-10-31T03:00:00Z'), 'yesterday financial evidence must retain its date');
  assert.equal(contexts.pricingGeneratedAt, Date.parse('2026-11-01T03:00:00Z'), 'current valid cash has its own today context');
  assert.equal(contexts.context.usable, true); assert.equal(contexts.currentPriceReady, true);
  assert.equal(contexts.grossDpsMicros, 8368000);
  assert.ok(contexts.issues.some(issue => issue.kind === 'financial' && issue.reason === 'request_failed'));
  let reader = await openSelection(page), card = targetCard(page, reader);
  const banner = await pendingUpdate(card);
  await banner.getByRole('button', { name: '查看并确认更新', exact: true }).click();
  const pricing = card.locator('.div-ai-pricing-card');
  await pricing.getByText(/每股分红 8.368 元/).waitFor();
  const confirm = pricing.getByRole('button', { name: '确认写入网格计划', exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('.div-ai-pricing-card button')].find(button => button.textContent === '确认写入网格计划')?.disabled === false);
  assert.equal(await confirm.isEnabled(), true, 'the retained yesterday financial context must not disable today cash pricing');
  await captureTarget(page, card, `${output}existing-evidence-ready-390-light.png`); result.screenshots.push('existing-evidence-ready-390-light.png');
  await confirm.click();
  await page.waitForFunction(async ({ code, expectedBuy, expectedSell }) => {
    const { db } = await import('/src/db.ts'); const stock = await db.dividendStocks.get(code);
    return JSON.stringify(stock.buyLevels.map(level => level.priceMinor)) === JSON.stringify(expectedBuy)
      && JSON.stringify(stock.sellLevels.map(level => level.priceMinor)) === JSON.stringify(expectedSell);
  }, { code: targetCode, expectedBuy, expectedSell });
  await card.locator('.div-price-update').getByText('重算完成，8 档价格与已保存一致', { exact: true }).waitFor();
  const applied = await state(page);
  assert.deepEqual(applied.protected, before.protected); assert.deepEqual(applied.otherPlans, before.otherPlans);
  await page.reload(); reader = await openSelection(page); card = targetCard(page, reader);
  await card.locator('.div-compact-targets').getByText(/¥136.93/).waitFor();
  await card.locator('.div-price-update').getByText('重算完成，8 档价格与已保存一致', { exact: true }).waitFor();
  const restored = await state(page);
  assert.deepEqual(restored.target, applied.target); assert.deepEqual(restored.protected, before.protected);
  result.checks.push({ name: 'Existing-evidence daily merge preserves old financial date while current cash enables UI confirmation and persisted eight-price reload',
    passed: true, contexts, persistedBuy: restored.target.buy, persistedSell: restored.target.sell,
    protectedStatePreserved: true, freshDividendDataDate: asOf, auxiliaryFailureCount: requests.auxiliaryFailures, cashSuccessCount: requests.distributionSuccess });
  await context.close();
}

try {
  if (!screenshotsOnly) await existingEvidenceWorkflow();
  const combinations = screenshotsOnly ? [[320, 1.3, 'light'], [390, 1, 'dark']] : smoke ? [[390, 1, 'light']] : [320, 390].flatMap(width => [1, 1.3].flatMap(scale => ['light', 'dark'].map(theme => [width, scale, theme])));
  for (const [width, scale, theme] of combinations) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage(), requests = await prepare(page, theme);
    let reader = await openSelection(page), card = targetCard(page, reader);
    await page.evaluate(scale => document.documentElement.style.setProperty('--font-scale', String(scale)), scale);
    const before = await state(page);
    assert.deepEqual(before.target.buy, oldBuy);
    assert.equal(before.research.grossDpsMicros, 7672300);
    await reader.getByRole('button', { name: '更新并重查全部', exact: true }).click();
    await page.waitForFunction(async targetCode => {
      const { loadDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
      const cached = await loadDividendResearchCache();
      return cached?.snapshot.stocks.find(stock => stock.code === targetCode)?.pricing?.dividendBase?.dpsMicros === 8368000;
    }, targetCode);
    await page.waitForFunction(() => !document.querySelector('.div-selection-actions > button')?.disabled);
    const refreshed = await state(page);
    assert.deepEqual(refreshed.protected, before.protected, 'refresh preserves budget, shares, weights, pause, holdings and transactions');
    assert.deepEqual(refreshed.target, before.target, 'refresh preserves saved prices until explicit confirmation');
    assert.deepEqual(refreshed.research.buy, expectedBuy);
    assert.equal(refreshed.research.canApply, true);
    assert.ok(refreshed.research.issues.some(issue => issue.kind === 'financial' && issue.reason === 'request_failed'));
    assert.ok(requests.distributionSuccess >= 10 && requests.auxiliaryFailures > 0);
    await card.locator('.div-compact-targets').waitFor();
    const banner = await pendingUpdate(card);
    await layout(page, reader, 'updated prices awaiting confirmation', width, scale, theme);
    await capture(page, card, 'after-refresh', width, scale, theme);
    await banner.getByRole('button', { name: '查看并确认更新', exact: true }).click();
    const pricing = card.locator('.div-ai-pricing-card');
    await pricing.getByText(/每股分红 8.368 元/).waitFor();
    const confirm = pricing.getByRole('button', { name: '确认写入网格计划', exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll('.div-ai-pricing-card button')].find(button => button.textContent === '确认写入网格计划')?.disabled === false);
    assert.equal(await confirm.isEnabled(), true, 'auxiliary failures cannot disable a valid current cash-price confirmation');
    assert.equal(await pricing.locator('table').count(), 2);
    assert.equal(await pricing.locator('tbody tr').count(), 8);
    await layout(page, reader, 'current cash prices with failed auxiliary feeds', width, scale, theme);
    await capture(page, card, 'ready-to-confirm', width, scale, theme);
    await confirm.click();
    await page.waitForFunction(async ({ code, expectedBuy, expectedSell }) => {
      const { db } = await import('/src/db.ts'); const stock = await db.dividendStocks.get(code);
      return JSON.stringify(stock.buyLevels.map(level => level.priceMinor)) === JSON.stringify(expectedBuy)
        && JSON.stringify(stock.sellLevels.map(level => level.priceMinor)) === JSON.stringify(expectedSell);
    }, { code: targetCode, expectedBuy, expectedSell });
    await card.locator('.div-price-update').getByText('重算完成，8 档价格与已保存一致', { exact: true }).waitFor();
    const applied = await state(page);
    assert.deepEqual(applied.target.buy, expectedBuy); assert.deepEqual(applied.target.sell, expectedSell);
    assert.equal(applied.target.provenance.grossDpsMicros, 8368000);
    assert.deepEqual(applied.protected, before.protected, 'confirmation preserves budgets, shares, pause, holdings and transactions');
    assert.deepEqual(applied.otherPlans, before.otherPlans, 'only the confirmed stock grid changes');
    await page.reload();
    reader = await openSelection(page); card = targetCard(page, reader);
    await page.evaluate(scale => document.documentElement.style.setProperty('--font-scale', String(scale)), scale);
    await card.locator('.div-compact-targets').getByText(/¥136.93/).waitFor();
    await card.locator('.div-price-update').getByText('重算完成，8 档价格与已保存一致', { exact: true }).waitFor();
    const restored = await state(page);
    assert.deepEqual(restored.target, applied.target, 'all eight prices and provenance survive reload and reopening');
    assert.deepEqual(restored.protected, before.protected);
    assert.deepEqual(restored.otherPlans, before.otherPlans);
    assert.equal(await card.locator('.div-check-status-row .div-check-data-date').count(), 1);
    assert.match(await card.locator('.div-check-data-date').innerText(), /行情 2026-11-01 10:00 · 分红 2026-11-01/);
    assert.equal(await card.locator('.div-check-status-row details').count(), 0);
    await layout(page, reader, 'confirmed prices after reload', width, scale, theme);
    await capture(page, card, 'confirmed-after-reload', width, scale, theme);
    result.checks.push({ name: 'Real UI refresh, explicit confirmation and persisted eight-price reload', passed: true, width, scale, theme,
      beforeBuy: before.target.buy, computedBuy: refreshed.research.buy, persistedBuy: restored.target.buy, persistedSell: restored.target.sell,
      budgetMinor: restored.protected.budgetMinor, sharesAndPausePreserved: true, otherPlansPreserved: true, auxiliaryFailureCount: requests.auxiliaryFailures, cashSuccessCount: requests.distributionSuccess });
    await context.close();
  }
  assert.deepEqual(result.errors, []); result.success = true;
} catch (error) { result.errors.push(error.stack ?? String(error)); }
finally {
  await browser.close();
  await writeFile(`${output}${screenshotsOnly ? 'ui-screenshots' : smoke ? 'ui-smoke' : 'ui-verification'}.json`, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
