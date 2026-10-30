import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:5186', output = new URL('./', import.meta.url).pathname;
const fixture = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
const official = await Promise.all(['pingan-2025-final', 'pingan-2026-interim'].map(name => readFile(new URL(`../../scripts/fixtures/dividend-official/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const result = { success: false, environment: 'Fresh isolated Chrome; synthetic ledger, archived arithmetic fixtures, mocked quotes and research transport; no real user database or external AI.', checks: [], errors: [], layouts: [], screenshots: [] };
const check = name => result.checks.push({ name, passed: true });
page.on('pageerror', error => result.errors.push(error.message));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname.startsWith('/qt-api/')) {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const previous = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
    const rows = [['000001', 8], ['000002', 8], ['000003', 8], ['000004', 8], ['000005', 8], ['600036', 8], ['512890', 1.2]].map(([code, price]) => {
      const day = ['600036', '000005'].includes(code) ? previous : today;
      const fields = Array(40).fill(''); fields[1] = 'Synthetic'; fields[2] = code; fields[3] = String(price); fields[30] = day.replaceAll('-', '') + '100000'; fields[32] = '0';
      return `v_${code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'}${code}="${fields.join('~')}";`;
    }).join('\n');
    return route.fulfill({ body: rows });
  }
  if (url.pathname.startsWith('/src/services/dividendResearchService.ts')) return route.fulfill({ contentType: 'text/javascript', body: `import { loadDividendResearchCache } from '/src/services/dividendResearchCacheService.ts'; export async function fetchDividendResearch(stocks) { const cache=await loadDividendResearchCache();return {...cache.snapshot,stocks:cache.snapshot.stocks.filter(s=>stocks.some(x=>x.code===s.code))}; }` });
  if (/api\//.test(url.pathname)) return route.abort();
  return route.continue();
});
const capture = async (name, target) => { if (target) { await target.scrollIntoViewIfNeeded(); await target.screenshot({ path: `${output}${name}.png` }); } else await page.screenshot({ path: `${output}${name}.png` }); result.screenshots.push(`${name}.png`); };
const card = code => page.locator('.div-stock-reading').filter({ has: page.locator(`.div-stock-title span`, { hasText: code }) });
const goHome = async () => { await page.goto(origin); await page.locator('.tab-bar').getByRole('button', { name: /红利/ }).click(); await page.locator('.div-stock-reading').first().waitFor(); };
try {
  await page.goto(origin);
  await page.evaluate(async ({ fixture, official }) => {
    const { db, initializeSettings, updateSettings, CURRENT_ONBOARDING_VERSION, CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } = await import('/src/db.ts');
    const { dateInChina } = await import('/src/lib/dividendWorkbench.ts');
    const { defaultDividendPricingMethod, calculateDividendPricing, dividendPricingAnnuals } = await import('/src/lib/dividendPricing.ts');
    const { defaultDividendSelectionPrinciples, parseDividendFinancialResearch } = await import('/src/lib/dividendResearch.ts');
    const { buildDividendLedger, parseDividendOfficialAnnouncementText } = await import('/src/lib/dividendLedger.ts');
    const { dividendPricingPlan, dividendPricingProvenance } = await import('/src/lib/dividendPricingPlan.ts');
    const { saveDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    await initializeSettings(); const now = Date.now(), asOf = dateInChina(), method = defaultDividendPricingMethod();
    const principles = { ...defaultDividendSelectionPrinciples(), minRoeBps: 1000 };
    await updateSettings({ language: 'zh', amountVisible: false, onboardingVersion: CURRENT_ONBOARDING_VERSION, automaticSnapshotSchemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
      dividendWorkbenchInitialized: true, dividendBudgetMinor: 3000000, dividendPricingMethod: method, dividendSelectionPrinciples: principles, themeMode: 'dark',
      dividendFundPlan: { budgetMinor: 1000000, mode: 'swing', entryRule: 'both', drawdownBps: 1000, indexYieldBps: 500, funds: [
        { id: 'fund-manual', name: '模拟手工参考基金', code: '515450', indexKind: 'low_volatility', weightBps: 5000, reference: { asOf, priceMicros: 1000000, highMicros: 1200000, indexYieldBps: 550, source: 'Synthetic manual reference' } },
        { id: 'fund-live', name: '模拟行情基金', code: '512890', indexKind: 'low_volatility_100', weightBps: 5000, reference: { asOf, highMicros: 1200000, indexYieldBps: 450, source: 'Synthetic reference' } },
      ] } });
    const officialEvents = official.map(({ text, ...metadata }) => parseDividendOfficialAnnouncementText(text, metadata));
    const originalLedger = buildDividendLedger(fixture.sources.distribution.data, '000001', asOf, { officialEvents });
    const annuals = dividendPricingAnnuals(fixture.sources.financial.data, undefined, fixture.sources.distribution.data, '000001', asOf);
    const store = new Dexie('FortunaDividendLedger'); store.version(1).stores({ documents: 'url', ledgers: 'code' });
    const stocks = [], research = [];
    for (const code of ['000001', '600036', '000002', '000003', '000004', '000005']) {
      const ledger = structuredClone(originalLedger); ledger.code = code;
      ledger.events.forEach(event => { event.code = code; event.id = event.id.replace('000001', code); event.batchId = event.batchId.replace('000001', code); });
      if (code === '000005') ledger.events[0].exDate = asOf;
      const pricing = calculateDividendPricing({ code, name: `模拟${code}`, asOf, ledger, annuals, method, financialSector: true });
      const savedPricing = code === '000004' ? calculateDividendPricing({ code, name: `模拟${code}`, asOf, ledger, annuals, method: { ...method, holdingPeriod: 'over_year' }, financialSector: true }) : pricing;
      stocks.push({ code, name: `模拟${code}`, group: 'core', weightBps: 1000, shareMode: 'manual', manualShares: code === '000001' ? 200 : 0, lotSize: 100,
        buyPaused: code === '000001', manualDpsMicros: 609000,
        ...(code === '000002' ? {} : { ...dividendPricingPlan(savedPricing), gridProvenance: dividendPricingProvenance(savedPricing, now - 1000) }),
        dividend: { schemaVersion: 2, dpsMicros: 0, asOf, windowStart: asOf, payments: [], announcements: [], fetchedAt: now } });
      if (code !== '000002') await store.table('ledgers').put(code === '000003' ? { code, asOf, events: null, issues: [], complete: true } : ledger);
      if (code === '000001' || code === '000004' || code === '000005' || code === '600036') research.push({ code, name: `模拟${code}`, pricing, yieldBps: 544,
        financial: parseDividendFinancialResearch(fixture.sources.financial.data, '000001', asOf), checks: [], status: 'unknown', sources: [], issues: [] });
    }
    await db.dividendStocks.bulkPut(stocks); store.close();
    await saveDividendResearchCache({ scope: 'plan', candidateInput: '', snapshot: { generatedAt: now, principles, pricingMethod: method, stocks: research, indices: [] } });
    window.__stage1Ledger = originalLedger;
  }, { fixture, official });
  await goHome(); await page.waitForFunction(() => !document.querySelector('.div-quote-status button')?.disabled);
  assert.equal(await page.locator('.div-stock-reading').count(), 6); assert.equal(result.errors.length, 0);
  assert.match(await card('000001').innerText(), /不符合规则/); assert.match(await card('000001').innerText(), /手动暂停新增买入/); check('failed eligibility, observed price touch and manual pause are distinct');
  assert.equal(await card('000002').locator('.div-grid-table tbody tr').count(), 0); assert.match(await card('000002').innerText(), /无法可靠定价/); check('manual dividend without saved explicit grid produces no old seven-tier prices');
  assert.match(await card('600036').innerText(), /当日到价待核实/); assert.equal(await card('600036').locator('.div-grid-row-triggered').count(), 0); check('previous-day quotes never produce current triggered table rows');
  assert.match(await card('000004').innerText(), /税率|税/); assert.match(await card('000004').innerText(), /历史保存价/); check('current tax change marks historical grid pending without replacing its prices');
  assert.equal(await card('000005').locator('.div-grid-row-triggered').count(), 0); check('pre-ex-date quotes do not trigger a new-basis grid');
  assert.match(await card('000003').innerText(), /台账|缓存/); assert.equal(await card('000001').locator('.div-grid-table tbody tr').count(), 8); check('one malformed ledger does not hide other stock plans');
  const manual = page.locator('.div-fund-home-card').filter({ hasText: '模拟手工参考基金' });
  assert.match(await manual.innerText(), /手工参考价/); assert.match(await manual.innerText(), /待核实|未知/); assert.doesNotMatch(await manual.innerText(), /已满足你设定/); check('manual fund reference price is not an executable market trigger');
  assert.equal(await page.evaluate(async () => (await (await import('/src/db.ts')).db.settings.get('main')).amountVisible), false);
  assert.match(await card('000001').locator('.div-home-plan-budget').innerText(), /3,000/); check('dividend amounts remain visible independently of hidden global asset amounts');
  for (const width of [390, 320]) for (const scale of [1, 1.3]) {
    await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: `html { font-size: ${16 * scale}px !important; }` });
    await page.locator('.app-content').evaluate(element => { element.scrollTop = 0; });
    await capture(`home-${width}-${scale}`);
    await capture(`stock-${width}-${scale}`, card('000001').locator('.div-check-status'));
    await capture(`fund-${width}-${scale}`, manual.locator('.div-check-status'));
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.dividend-page *')].filter(element => element.getClientRects().length && element.getBoundingClientRect().right > innerWidth + 1).map(element => element.className).slice(0, 10));
    result.layouts.push({ width, scale, overflow }); assert.deepEqual(overflow, []);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.addStyleTag({ content: 'html { font-size:16px !important; }' });
  await page.getByRole('button', { name: /选股检查/ }).first().click();
  await page.locator('.div-ai-research-card').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.div-ai-research-card .div-check-status')?.textContent.includes('手动暂停'));
  const selection = page.locator('.div-ai-research-card').filter({ hasText: '模拟000001' }).first();
  assert.match(await selection.innerText(), /不符合规则/); assert.match(await selection.innerText(), /手动暂停/);
  await capture('selection-390', selection.locator('.div-check-status')); check('Stock Checks consumes the same eligibility and pause result as home');
  await capture('selection-page-390');
  await goHome();
  const sourceFailure = await page.evaluate(async ({ fixture }) => {
    const { db } = await import('/src/db.ts');
    const { researchDividendLedger, loadSavedDividendLedger } = await import('/src/services/dividendLedgerEvidenceService.ts');
    const { dateInChina } = await import('/src/lib/dividendWorkbench.ts');
    const saved = await loadSavedDividendLedger('000001'), stock = await db.dividendStocks.get('000001');
    await researchDividendLedger(fixture.sources.distribution.data, '000001', dateInChina(), { post: async () => { throw new Error('CNINFO_HTTP_503_SYNTHETIC'); } });
    window.dispatchEvent(new Event('focus'));
    return { saved, unchangedLedger: JSON.stringify(saved) === JSON.stringify(await loadSavedDividendLedger('000001')), stock };
  }, { fixture });
  assert.equal(sourceFailure.unchangedLedger, true);
  await page.waitForFunction(() => [...document.querySelectorAll('.div-stock-reading')].find(e => e.textContent.includes('模拟000001'))?.querySelector('.div-check-status')?.textContent.includes('历史保存价'));
  assert.equal(await card('000001').locator('.div-grid-table tbody tr').count(), 8);
  await capture('failed-refresh-390', card('000001').locator('.div-check-status')); check('same-day official refresh failure downgrades trust while retaining all saved prices and original successful evidence');

  await card('000001').locator('.div-home-plan-heading button').click();
  const manager = page.locator('.div-plan-manager-list > details[open]').first();
  await manager.getByRole('button', { name: '编辑红利标的', exact: true }).click();
  const dialog = page.locator('dialog.div-dialog'); await dialog.waitFor({ state: 'visible' });
  await dialog.locator('.div-form-note textarea').fill('旧表单草稿，只改备注');
  const newer = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts'); const stock = await db.dividendStocks.get('000001');
    const next = { ...stock, manualShares: 300, buyPaused: false, note: '并发保存的新备注', buyLevels: stock.buyLevels.map((row, index) => index === 0 ? { ...row, priceMinor: row.priceMinor - 50 } : row) };
    await db.dividendStocks.put(next); return next;
  });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '计划已被其他操作修改或删除' }).waitFor();
  assert.equal(await dialog.isVisible(), true); assert.equal(await dialog.locator('.div-form-note textarea').inputValue(), '旧表单草稿，只改备注');
  const afterConflict = await page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.get('000001'));
  assert.deepEqual(afterConflict, newer); await capture('editor-conflict-390', dialog);
  await page.setViewportSize({ width: 320, height: 844 }); await page.addStyleTag({ content: 'html { font-size:20.8px !important; }' });
  await capture('editor-conflict-320-font130', dialog.getByRole('alert'));
  const dialogOverflow = await dialog.evaluate(element => [...element.querySelectorAll('*')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.tagName));
  assert.deepEqual(dialogOverflow, []); check('stale editor rejects overwrite, keeps the draft and protects newer grid, pause, manual shares and note');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await manager.getByRole('button', { name: '编辑红利标的', exact: true }).click();
  assert.equal(await dialog.locator('.div-form-note textarea').inputValue(), '并发保存的新备注');
  await dialog.locator('.div-form-note textarea').fill('基于最新记录正常保存');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const normalSave = await page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.get('000001'));
  assert.deepEqual(normalSave, { ...newer, note: '基于最新记录正常保存' }); check('reopening after conflict loads the latest record and a normal guarded note save preserves every other field');
  result.success = true;
} catch (cause) {
  result.failure = cause.message; await page.screenshot({ path: `${output}browser-failure.png` }); throw cause;
} finally {
  await writeFile(`${output}browser-validation.json`, JSON.stringify(result, null, 2) + '\n'); await browser.close();
}
console.log(JSON.stringify(result, null, 2));
