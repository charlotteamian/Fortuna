import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

process.env.FORTUNA_STAGE2_ORIGIN = 'http://127.0.0.1:5210';
const { isolate, seed, origin, captureTarget, stockCodes } = await import('../dividend-stage2/fixture.mjs');
const output = new URL('./', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const result = { success: false, scope: 'Isolated Chrome contexts and synthetic fixtures only. External traffic blocked. No real user database, live research or physical device.', checks: [], layouts: [], screenshots: [], errors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const check = (name, detail) => result.checks.push({ name, passed: true, ...(detail ? { detail } : {}) });

async function prepare(page, themeMode) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => result.errors.push(error.message));
  await isolate(page);
  await page.route('**/src/services/dividendResearchService.ts*', route => route.continue());
  await page.route('**/qt-api/**', route => route.fulfill({ body: [...stockCodes, '512890'].map(code => {
    const fields = Array(40).fill('');
    fields[1] = code === '000005' ? '模拟高价股票' : 'Synthetic'; fields[2] = code;
    fields[3] = code === '000005' ? '247.13' : code === '512890' ? '1.2' : '8';
    fields[30] = '20261101100000'; fields[32] = '0';
    return `v_${code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'}${code}="${fields.join('~')}";`;
  }).join('\n') }));
  await seed(page, { preferences: true });
  const synthetic = await page.evaluate(async themeMode => {
    const { db, updateSettings } = await import('/src/db.ts');
    const { calculateDividendPricing, defaultDividendPricingMethod } = await import('/src/lib/dividendPricing.ts');
    const { buildDividendLedger } = await import('/src/lib/dividendLedger.ts');
    const { dividendPricingPlan, dividendPricingProvenance } = await import('/src/lib/dividendPricingPlan.ts');
    const { loadDividendResearchCache, saveDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const code = '000005', asOf = '2026-11-01', now = Date.now(), method = defaultDividendPricingMethod();
    const ledger = buildDividendLedger({ success: true, result: { pages: 1, data: [{ SECURITY_CODE: code, REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-07-10',
      EQUITY_RECORD_DATE: '2026-07-16', EX_DIVIDEND_DATE: '2026-07-17', PRETAX_BONUS_RMB: 83.68, BONUS_RATIO: 0, IT_RATIO: 0, ASSIGN_PROGRESS: '实施' }] } }, code, asOf);
    ledger.events.forEach(event => event.sources.forEach(source => { source.verifiedAt = '2026-10-30'; }));
    const pricing = calculateDividendPricing({ code, name: '模拟高价股票', asOf, ledger, method, financialSector: true,
      annuals: [{ year: 2025, reportDate: '2025-12-31', epsMicros: 16736000, payoutBps: 5000, dividendMicros: 8368000 }], priceMinor: 24713, priceDate: asOf });
    const plan = dividendPricingPlan(pricing);
    if (!plan) throw new Error(`SYNTHETIC_PLAN_UNAVAILABLE:${JSON.stringify(pricing.blockers)}`);
    const oldLedger = structuredClone(ledger);
    oldLedger.events.forEach(event => { event.cashPer10Micros = 76723000; event.normalizedDpsMicros = 7672300; });
    const oldPricing = calculateDividendPricing({ code, name: '模拟高价股票', asOf, ledger: oldLedger, method, financialSector: true,
      annuals: [{ year: 2025, reportDate: '2025-12-31', epsMicros: 15344600, payoutBps: 5000, dividendMicros: 7672300 }], priceMinor: 24713, priceDate: asOf });
    const oldPlan = dividendPricingPlan(oldPricing), oldProvenance = dividendPricingProvenance(oldPricing, now - 1000);
    delete oldProvenance.officialParserVersion;
    const savedStock = await db.dividendStocks.get(code);
    await db.dividendStocks.put({ ...savedStock, name: '模拟高价股票', manualShares: 0, buyPaused: false, ...oldPlan,
      gridProvenance: oldProvenance, quote: { priceMinor: 24713, date: `${asOf} 10:00`, fetchedAt: now } });
    const ledgerStore = new Dexie('FortunaDividendLedger'); ledgerStore.version(1).stores({ documents: 'url', ledgers: 'code' });
    await ledgerStore.table('ledgers').put(ledger); ledgerStore.close();
    const cached = await loadDividendResearchCache();
    await saveDividendResearchCache({ ...cached, snapshot: { ...cached.snapshot, stocks: cached.snapshot.stocks.map(stock => stock.code === code
      ? { ...stock, name: '模拟高价股票', pricing, issues: [] } : stock) } });
    await updateSettings({ themeMode, amountVisible: true, dividendStrategy: 'stocks', dividendBudgetMinor: 20830000 });
    return { code, budgetMinor: 2083000, quoteMinor: 24713, grossDpsMicros: pricing.dividendBase.dpsMicros, firstBuyMinor: plan.buyLevels[0].priceMinor,
      savedGrossDpsMicros: oldPricing.dividendBase.dpsMicros, savedFirstBuyMinor: oldPlan.buyLevels[0].priceMinor };
  }, themeMode);
  return synthetic;
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

async function layout(page, scope, name, width, scale, theme) {
  const overflow = await scope.evaluate(root => [...root.querySelectorAll('*')].filter(element => {
    if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.right > innerWidth + 1 || rect.left < -1;
  }).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 80) })));
  assert.deepEqual(overflow, [], `${name} overflow ${width}/${scale}/${theme}`);
  assert.doesNotMatch(await scope.innerText(), /\b(?:df_|div_)[a-z_]+\b/);
  result.layouts.push({ name, width, scale, theme, overflow });
}

try {
  for (const width of [320, 390]) for (const scale of [1, 1.3]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    const synthetic = await prepare(page, theme);
    const reader = await openSelection(page);
    if (!result.fixtureInspection) result.fixtureInspection = await page.evaluate(async () => {
      const { loadDividendWorkbench } = await import('/src/services/dividendService.ts');
      const { loadDividendCheckSummaries } = await import('/src/services/dividendCheckSummaryService.ts');
      const { loadDividendGridBases } = await import('/src/services/dividendGridBasisService.ts');
      const { loadDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
      const workbench = await loadDividendWorkbench(), cache = await loadDividendResearchCache();
      const summaries = await loadDividendCheckSummaries(workbench);
      const basis = (await loadDividendGridBases(['000005'], '2026-11-01'))['000005'];
      const pricing = cache.snapshot.stocks.find(stock => stock.code === '000005').pricing;
      return { basisDpsMicros: basis.dpsMicros, cachedDpsMicros: pricing.dividendBase.dpsMicros, basisVerified: basis.verified, pricingCanApply: pricing.canApply,
        currentFirstBuyMinor: summaries.stocks['000005'].currentPlan?.buyLevels[0].priceMinor,
        savedFirstBuyMinor: summaries.stocks['000005'].grid.buyLevels[0].priceMinor, savedGridReasons: summaries.stocks['000005'].grid.reasons };
    });
    await page.evaluate(value => document.documentElement.style.setProperty('--font-scale', String(value)), scale);
    const cards = reader.locator('.div-ai-research-card');
    assert.equal(await cards.count(), 10);
    const card = cards.filter({ has: page.getByText('模拟高价股票', { exact: true }) });
    await card.locator('.div-compact-targets').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.div-ai-research-card')].find(card => card.textContent.includes('模拟高价股票'))?.textContent.includes('¥247.13'));
    const targets = card.locator('.div-compact-targets');
    const targetText = await targets.innerText();
    assert.match(targetText, /原第1档 · ¥125.54/);
    assert.match(targetText, /该档预算不足 1 手/);
    assert.match(targetText, /未到价/);
    assert.match(targetText, /无持仓/);
    assert.doesNotMatch(targetText, /原第3档|累计持仓目标 0 股|最深触价/);
    assert.match(await card.locator('.div-home-plan-budget').innerText(), /20,830/);
    const row = card.locator('.div-check-status-row');
    assert.equal(await row.locator('.div-check-data-date').count(), 1);
    assert.equal(await row.locator('details').count(), 0);
    assert.doesNotMatch(await row.innerText(), /查看全部依据|检查生成|研究生成|价格依据/);
    await row.getByText('分红提取已修正，原保存价需重新确认', { exact: true }).waitFor();
    assert.match(await row.locator('.div-check-data-date').innerText(), /行情 2026-11-01 10:00 · 分红 2026-10-30/);
    assert.equal(await card.getByRole('button', { name: '进一步请 AI 解读', exact: true }).count(), 1);
    assert.equal(await card.getByRole('button', { name: '状态 / 编辑 / 删除', exact: true }).count(), 1);
    await layout(page, reader, 'selection collapsed', width, scale, theme);
    const prefix = `${width}-${scale}-${theme}`;
    await captureTarget(page, card, `${output}stock-collapsed-${prefix}.png`);
    result.screenshots.push(`stock-collapsed-${prefix}.png`);
    await card.locator('.div-ai-research-toggle').click();
    const pricing = card.locator('.div-ai-pricing-card');
    await pricing.waitFor();
    await pricing.getByText(/每股分红 8.368 元/).waitFor();
    assert.equal(await pricing.locator('table').count(), 2);
    assert.equal(await pricing.locator('tbody tr').count(), 8);
    assert.match(await pricing.innerText(), /每股分红 8.368 元，扣税 10% 后为 7.5312 元；首档按 5.5% 计算为 ¥136.93/);
    assert.match(await pricing.innerText(), /首档比现价低 44.59%/);
    assert.equal(await pricing.getByRole('button', { name: /手动核对分红资料|填写缺少数据/ }).count(), 0);
    await layout(page, reader, 'selection expanded', width, scale, theme);
    await captureTarget(page, card, `${output}stock-expanded-${prefix}.png`);
    result.screenshots.push(`stock-expanded-${prefix}.png`);
    await card.locator('.div-ai-research-toggle').click();
    await pricing.waitFor({ state: 'hidden' });
    assert.equal(await pricing.isVisible(), false);
    if (width === 390 && scale === 1 && theme === 'light') {
      const paused = cards.filter({ has: page.getByText('模拟000001', { exact: true }) });
      await paused.locator('.div-ai-research-toggle').click();
      await paused.locator('.div-review-refresh-card').waitFor();
      assert.equal(await paused.locator('.div-review-refresh-card').isVisible(), true);
      check('Paused stocks keep the resume-review controls in the expanded plan');
      await paused.locator('.div-ai-research-toggle').click();
      await paused.locator('.div-review-refresh-card').waitFor({ state: 'hidden' });
      await card.getByRole('button', { name: '状态 / 编辑 / 删除', exact: true }).click();
      const management = page.locator('dialog[open][aria-labelledby="div-editor-title"]');
      await management.waitFor();
      assert.ok((await management.locator('input').evaluateAll(elements => elements.map(element => element.value))).includes('模拟高价股票'));
      await management.locator('.div-stock-heading button').click();
      check('Manage action opens the synthetic saved stock');
      await card.getByRole('button', { name: '进一步请 AI 解读', exact: true }).click();
      await reader.locator('.div-advisor-reader-compose').waitFor();
      check('Discuss action opens chat from the selected stock');
    }
    result.checks.push({ name: 'Screenshot regression and pricing explanation', passed: true, width, scale, theme, synthetic, nextBuyTier: 1, nextBuyState: 'below_lot' });
    await context.close();
  }
  check('Eight width/font/theme combinations keep one date line, correct first tier, readable layouts and working expand/collapse');
  assert.deepEqual(result.errors, []);
  result.success = true;
} catch (error) {
  result.errors.push(error.stack ?? String(error));
} finally {
  await browser.close();
  await writeFile(`${output}ui-verification.json`, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
