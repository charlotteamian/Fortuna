import { chromium } from '/Users/restartday/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const output = new URL('./', import.meta.url).pathname;
const fixture = JSON.parse(await readFile(new URL('../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width:390, height:844 }, locale:'zh-CN', timezoneId:'Asia/Shanghai' });
const page = await context.newPage();
const result = { environment:'Isolated browser, synthetic ledger and archived Ping An source fixture', checks:[], errors:[], screenshots:[], limitations:['No live quote or physical-device verification; saved-plan changes occur only in this isolated browser.'] };
page.on('pageerror', error => result.errors.push(error.message));
await page.route('**/qt-api/**', route => route.fulfill({ status:503, body:'Synthetic quote transport unavailable' }));
await page.route('**/dividend-*-api/**', route => route.abort());
await page.route('**/dividend-api/**', route => route.abort());
const check = name => result.checks.push({ name, passed:true });
const readStock = () => page.evaluate(async () => (await import('/src/db.ts')).db.dividendStocks.get('000001'));
const savedPlan = stock => ({ buyLevels:stock.buyLevels, sellLevels:stock.sellLevels, manualShares:stock.manualShares, buyPaused:stock.buyPaused, weightBps:stock.weightBps });
const capture = async name => {
  await page.screenshot({ path:`${output}${name}.png`, fullPage:true });
  result.screenshots.push(`${name}.png`);
  const overflow = await page.evaluate(() => ({ viewport:innerWidth, document:document.documentElement.scrollWidth,
    outside:[...document.querySelectorAll('.div-ai-pricing-card *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e=>e.className) }));
  assert.ok(overflow.document <= overflow.viewport + 1 && !overflow.outside.length, JSON.stringify(overflow));
  check(`${name}: no horizontal overflow`);
};
try {
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async fixture => {
    const { db, initializeSettings, updateSettings, CURRENT_ONBOARDING_VERSION, CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } = await import('/src/db.ts');
    const { dateInChina } = await import('/src/lib/dividendWorkbench.ts');
    const { defaultDividendPricingMethod, calculateDividendPricing, dividendPricingTrailingDividend, dividendPricingAnnuals } = await import('/src/lib/dividendPricing.ts');
    const { defaultDividendSelectionPrinciples } = await import('/src/lib/dividendResearch.ts');
    const { saveDividendResearchCache } = await import('/src/services/dividendResearchCacheService.ts');
    await initializeSettings();
    const date = dateInChina(), now = Date.now(), method = defaultDividendPricingMethod(), principles = defaultDividendSelectionPrinciples();
    await updateSettings({ language:'zh', amountVisible:true, onboardingVersion:CURRENT_ONBOARDING_VERSION, automaticSnapshotSchemaVersion:CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
      themeMode:'light', colorTheme:'rose-olive', dividendWorkbenchInitialized:true, dividendBudgetMinor:3000000, dividendStrategy:'stocks', dividendSelectionPrinciples:principles, dividendPricingMethod:method });
    await db.dividendStocks.clear();
    await db.dividendStocks.put({ code:'000001', name:'平安银行', group:'core', weightBps:10000, shareMode:'manual', manualShares:200, lotSize:100,
      buyPaused:true, manualDpsMicros:609000, buyLevels:[1400,1200,1100].map((priceMinor,i)=>({ priceMinor,yieldBps:400+i*100,portionBps:[3333,3333,3334][i] })),
      sellLevels:[1600,1800,2000,2400].map((priceMinor,i)=>({ priceMinor,yieldBps:350-i*50,portionBps:2500 })), quote:{ priceMinor:1120,date,fetchedAt:now } });
    const pricing = calculateDividendPricing({ code:'000001', name:'平安银行', financialSector:true, method, asOf:date,
      annuals:dividendPricingAnnuals(fixture.sources.financial.data, undefined, fixture.sources.distribution.data, '000001', date),
      trailingDividend:dividendPricingTrailingDividend(fixture.sources.distribution.data, '000001', date), priceMinor:1120, priceDate:date, currentCashYieldBps:544 });
    await saveDividendResearchCache({ scope:'plan', candidateInput:'', snapshot:{ generatedAt:now, principles, pricingMethod:method, indices:[], stocks:[{
      code:'000001', name:'平安银行', pricing, checks:[], status:'unknown', sources:[], issues:[],
    }] } });
  }, fixture);
  await page.reload();
  await page.locator('.tab-bar').getByRole('button', { name:/红利/ }).click();
  await page.locator('.div-advisor-entry-actions button').first().click();
  await page.locator('.div-advisor-workspace-tabs').getByRole('button', { name:'选股检查', exact:true }).click();
  const stock = page.locator('.div-ai-research-card').first();
  await stock.waitFor();
  await stock.locator('.div-ai-research-details > summary').click();
  const pricing = stock.locator('.div-ai-pricing-card');
  await pricing.waitFor();
  assert.equal(await pricing.locator('.div-ai-pricing-grid').nth(0).locator(':scope > div').count(), 4);
  assert.equal(await pricing.locator('.div-ai-pricing-grid').nth(1).locator(':scope > div').count(), 4);
  const text = await pricing.innerText();
  for (const price of ['11.07','10.59','10.15','9.36','12.68','13.53','14.5','15.22','12.18','0.609']) assert.ok(text.includes(price), price);
  assert.doesNotMatch(text,/三锚估值|95%|15%安全边际/);
  check('pricing card shows exact TTM, four buys, four sells and neutral reference');
  const before = await readStock();
  for (const width of [390,320]) for (const scale of [1,1.3]) {
    await page.setViewportSize({ width,height:844 });
    await page.addStyleTag({ content:`html { font-size:${16*scale}px !important; }` });
    await pricing.scrollIntoViewIfNeeded();
    await capture(`pricing-${width}-${scale}`);
  }
  await pricing.getByRole('button', { name:'预览买卖价格计划', exact:true }).click();
  const proposed = pricing.locator('.div-ai-grid-proposed');
  await proposed.waitFor();
  assert.equal(await proposed.locator('tbody tr').count(),8);
  assert.equal(await proposed.getByText('25%', { exact:true }).count(),8);
  assert.deepEqual(savedPlan(await readStock()), savedPlan(before));
  check('preview shows all eight 25% rows and does not mutate saved grid, holdings or pause');
  await proposed.scrollIntoViewIfNeeded(); await capture('preview-320-1.3');
  await pricing.getByRole('button', { name:'确认写入网格计划', exact:true }).click();
  await pricing.getByText('已写入网格计划。', { exact:true }).waitFor();
  const after = await readStock();
  assert.deepEqual(after.buyLevels.map(x=>x.priceMinor),[1107,1059,1015,936]);
  assert.deepEqual(after.sellLevels.map(x=>x.priceMinor),[1268,1353,1450,1522]);
  assert.equal(after.manualShares,200); assert.equal(after.buyPaused,true); assert.equal(after.weightBps,10000);
  check('confirmation writes both classic sides while preserving holdings, allocation and manual pause');
  await page.locator('.div-advisor-workspace-tabs').getByRole('button', { name:'选股原则', exact:true }).click();
  const editor = page.locator('.div-ai-pricing-editor'); await editor.waitFor();
  assert.equal(await editor.locator('select').count(),1); assert.equal(await editor.locator('input').count(),0);
  assert.match(await editor.innerText(),/5\.5%.*5\.75%.*6\.0%.*6\.5%/s);
  await editor.scrollIntoViewIfNeeded(); await capture('method-320-1.3');
  check('classic method editor has fixed yields and a holding-period selector without legacy anchor inputs');
  await page.evaluate(async () => {
    const { createPlanItem } = await import('/src/services/planService.ts');
    await createPlanItem({ name:'股票计划录入验证', targetPercent:20, categories:['股票/ETF'], plannedPurchases:'平安银行，等回调；先观察盈利。' });
  });
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.tab-bar').getByRole('button', { name:'计划', exact:true }).click();
  const tags = page.locator('.plan-tag');
  await tags.first().waitFor();
  assert.equal(await tags.count(),1);
  assert.equal(await tags.first().innerText(),'平安银行，等回调；先观察盈利。');
  await tags.first().click();
  const notes = '平安银行，等回调；先观察盈利。\n招商银行、工商银行先比较，再决定。';
  await page.locator('#purchase-notes').fill(notes);
  await page.getByRole('dialog').getByRole('button', { name:'保存', exact:true }).click();
  await page.getByRole('dialog').waitFor({ state:'hidden' });
  assert.deepEqual(await tags.allInnerTexts(),notes.split('\n'));
  const savedNotes = await page.evaluate(async () => (await (await import('/src/db.ts')).db.planItems.toArray()).find(item=>item.name==='股票计划录入验证').plannedPurchases);
  assert.equal(savedNotes,notes);
  await tags.first().scrollIntoViewIfNeeded(); await capture('plan-lines-320');
  check('stock plan notes split only at line breaks and preserve punctuation through editing and saving');
  assert.deepEqual(result.errors,[]);
} finally {
  await writeFile(`${output}browser-validation.json`, JSON.stringify(result,null,2)+'\n');
  await browser.close();
}
