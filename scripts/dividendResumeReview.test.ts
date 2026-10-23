import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../src/lib/dividendPricing.ts';
import 'fake-indexeddb/auto';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import type { DividendResearchSnapshot, DividendTechnicalResearch } from '../src/lib/dividendResearch.ts';
import type { DividendPricingResult } from '../src/lib/dividendPricing.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { db, initializeSettings, updateSettings } = await import('../src/db.ts');
const { defaultDividendSelectionPrinciples } = await import('../src/lib/dividendResearch.ts');
const { defaultDividendPricingMethod } = await import('../src/lib/dividendPricing.ts');
const { dividendPricingPlan } = await import('../src/lib/dividendPricingPlan.ts');
const { reviewDividendResume, assertDividendResumeReviewCurrent, DIVIDEND_RESUME_REVIEW_MAX_AGE_MS } = await import('../src/services/dividendResumeReviewService.ts');
const { previewDividendPlanChange, applyDividendPlanChange } = await import('../src/services/dividendAdvisorActionsService.ts');
const now = Date.parse('2026-10-22T04:00:00Z');
const stock: DividendStock = { code: '600036', name: '招商银行', group: 'core', weightBps: 1000, shareMode: 'manual', manualShares: 100,
  lotSize: 100, buyPaused: true, buyLevels: [{ yieldBps: 500, portionBps: 10000, priceMinor: 1000 }], sellLevels: [{ yieldBps: 300, portionBps: 10000, priceMinor: 2000 }] };
const technical: DividendTechnicalResearch = { asOf: '2026-10-22', fetchedAt: now, priceBasis: 'qfq', currentUsable: true,
  lastCloseMinor: 1000, ma5Minor: 1000, ma10Minor: 990, ma30Minor: 980, ma30SlopePercent: 1, rsi6: 55,
  change5Percent: 1, change10Percent: 2, change30Percent: 3, previous5Percent: 1, drawdown60Percent: -2, state: 'rising', pacing: 'observe' };
const pricing: DividendPricingResult = { calculationVersion: DIVIDEND_PRICING_CALCULATION_VERSION, status: 'ready', canApply: true, riskClass: 'bank', blockers: [], pauseReasons: [], warnings: [], annuals: [],
  normalizationBasis: 'three_year_adjusted_eps_mean', taxBps: 0, anchors: { selectedBps: 413 }, d1Micros: 1980400, gordonYieldBps: 800,
  grid: [4555, 4075, 3596].map((priceMinor, index) => ({ discountBps: [9500, 8500, 7500][index] as 9500 | 8500 | 7500, priceMinor,
    yieldBps: Math.round(1980400 / priceMinor), cumulativePortionBps: [3333, 6666, 10000][index], meetsSafetyMargin: index > 0 })),
  sourceUrls: [], currentPriceMinor: 1000, priceDate: '2026-10-22', marginPriceMinor: 1100 };
function snapshot(): DividendResearchSnapshot {
  return { generatedAt: now, principles: defaultDividendSelectionPrinciples(), pricingMethod: defaultDividendPricingMethod(),
    stocks: [{ code: stock.code, name: stock.name, technical: structuredClone(technical), pricing: structuredClone(pricing),
      checks: [{ rule: 'roe', status: 'pass' }], status: 'pass', sources: [], issues: [] }],
    indices: [{ code: 'sh000001', name: '上证指数', technical: structuredClone(technical), sources: [], issues: [] },
      { code: 'sh000300', name: '沪深300', technical: structuredClone(technical), sources: [], issues: [] }] };
}
async function review(data = snapshot()) {
  return reviewDividendResume(stock, { now: () => now, fetchResearch: async () => data });
}
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings(); await db.dividendStocks.put(structuredClone(stock));
});
after(() => db.close());

test('a complete replacement uses one sustainable dividend, three buys and four increasing non-crossing sells', () => {
  const plan = dividendPricingPlan(pricing)!;
  assert.ok(plan);
  assert.deepEqual(plan.buyLevels.map(level => level.priceMinor), [4555, 4075, 3596]);
  assert.equal(plan.buyLevels.reduce((sum, level) => sum + level.portionBps, 0), 10000);
  assert.deepEqual(plan.sellLevels.map(level => level.yieldBps), [371, 330, 289, 247]);
  assert.deepEqual(plan.sellLevels.map(level => level.priceMinor), [5338, 6001, 6852, 8017]);
  assert.ok(plan.sellLevels.every((level, index) => level.portionBps === 2500 && Number.isSafeInteger(level.priceMinor)
    && level.priceMinor! > Math.max(...plan.buyLevels.map(row => row.priceMinor!)) && (!index || level.priceMinor! > plan.sellLevels[index - 1].priceMinor!)));
  assert.equal(dividendPricingPlan({ ...pricing, d1Micros: undefined }), null);
  assert.equal(dividendPricingPlan({ ...pricing, anchors: {} }), null);
  assert.equal(dividendPricingPlan({ ...pricing, canApply: false }), null);
  assert.equal(dividendPricingPlan({ ...pricing, anchors: { selectedBps: 1 } }), null, 'rounding cannot produce duplicate sell levels');
});

test('fresh review uses saved user assumptions and only a later confirmed preview resumes the unchanged plan', async () => {
  const principles = { ...defaultDividendSelectionPrinciples(), minRoeBps: 900 };
  const method = { ...defaultDividendPricingMethod(), safetyMarginBps: 2000 };
  await updateSettings({ dividendSelectionPrinciples: principles, dividendPricingMethod: method });
  let requests = 0;
  const result = await reviewDividendResume(stock, { now: () => now, fetchResearch: async (stocks, usedPrinciples, options) => {
    requests++; assert.deepEqual(stocks, [{ ...stock }]); assert.deepEqual(usedPrinciples, principles); assert.deepEqual(options?.pricingMethod, method); return snapshot();
  } });
  assert.equal(requests, 1); assert.ok(result.operationsPass && result.pricePass && result.technicalPass);
  assert.equal(result.proposal?.buyPaused, false);
  assert.deepEqual(await db.dividendStocks.get(stock.code), stock, 'review alone cannot resume or overwrite prices');
  await assertDividendResumeReviewCurrent(result, undefined, () => now);
  const preview = await previewDividendPlanChange(result.proposal!);
  await applyDividendPlanChange(result.proposal!, preview.fingerprint);
  assert.deepEqual(await db.dividendStocks.get(stock.code), { ...stock, buyPaused: false });
});

test('financial risks, missing evidence and weak markets remain advisory and never write a pause or require every check to pass', async () => {
  const fixtures: [string, (data: DividendResearchSnapshot) => void][] = [
    ['operating risk', data => { data.stocks[0].checks[0].status = 'risk'; }],
    ['missing operating evidence', data => { data.stocks[0].checks[0].status = 'unknown'; }],
    ['empty checks', data => { data.stocks[0].checks = []; }],
    ['cash coverage', data => { data.stocks[0].pricing!.pauseReasons = ['fcf_below_150']; }],
    ['price above safety reference', data => { data.stocks[0].pricing!.currentPriceMinor = 1101; }],
    ['missing quote', data => { data.stocks[0].pricing!.pauseReasons = ['quote_missing']; }],
    ['falling stock', data => { data.stocks[0].technical!.pacing = 'review_grid'; }],
    ['accelerating market', data => { data.indices[1].technical!.pacing = 'pause_add'; }],
    ['one broad index missing', data => { data.indices[0].technical = undefined; }],
  ];
  for (const [name, edit] of fixtures) {
    const data = snapshot(); edit(data); const result = await review(data); assert.equal(result.proposal?.buyPaused, false, name);
  }
  assert.equal((await db.dividendStocks.get(stock.code))?.buyPaused, true);
  await updateSettings({ dividendSelectionPrinciples: { ...defaultDividendSelectionPrinciples(), notes: '核实关联交易' } });
  const additional = await review();
  assert.equal(additional.advice.additionalRulesUnverified, true);
  assert.equal(additional.proposal?.buyPaused, false, 'unverified supplementary rules remain visible without forbidding the user’s choice');
});

test('price status uses the saved grid and safety margin never becomes another buying threshold', async () => {
  const data = snapshot(); data.stocks[0].pricing!.currentPriceMinor = 1000; data.stocks[0].pricing!.marginPriceMinor = 900;
  const triggered = await review(data);
  assert.equal(triggered.priceState, 'triggered'); assert.deepEqual(triggered.triggeredBuyLevels, [1]); assert.equal(triggered.pricePass, true);
  data.stocks[0].pricing!.currentPriceMinor = 1101;
  const waiting = await review(data);
  assert.equal(waiting.priceState, 'waiting'); assert.equal(waiting.advice.firstBuyPriceMinor, 1000);
  assert.deepEqual(waiting.savedBuyPricesMinor, [1000]); assert.equal(waiting.proposal?.buyPaused, false);
  data.stocks[0].pricing!.pauseReasons = ['quote_missing'];
  assert.equal((await review(data)).priceState, 'unknown');
  await db.dividendStocks.update(stock.code, { buyPaused: false });
  const active = await review(); assert.equal(active.proposal, null); assert.equal(active.wasPaused, false);
});

test('review falls back to a valid saved quote when new financial pricing is absent, preserving separate missing evidence', async () => {
  const quote = { priceMinor: 1000, date: '2026-10-22 10:00', fetchedAt: now };
  await db.dividendStocks.update(stock.code, { quote });
  const data = snapshot(); data.stocks[0].pricing = undefined; data.stocks[0].checks[0].status = 'unknown';
  const result = await review(data);
  assert.equal(result.priceState, 'triggered'); assert.deepEqual(result.triggeredBuyLevels, [1]);
  assert.equal(result.advice.currentPriceDate, quote.date); assert.equal(result.advice.currentPriceMinor, 1000);
  assert.deepEqual(result.advice.missingRules, ['roe']); assert.equal(result.proposal?.buyPaused, false);
  assert.equal((await db.dividendStocks.get(stock.code))?.buyPaused, true);
  for (const updates of [{ quote: undefined }, { quote, quoteFailedAt: now },
    ...['2026-10-11', '2026-10-23', 'invalid'].map(date => ({ quote: { ...quote, date }, quoteFailedAt: undefined })),
    { quote: { ...quote, priceMinor: 0 }, quoteFailedAt: undefined }]) {
    await db.dividendStocks.update(stock.code, { quoteFailedAt: undefined, ...updates });
    const unavailable = await review(data);
    assert.equal(unavailable.priceState, 'unknown'); assert.deepEqual(unavailable.triggeredBuyLevels, []);
  }
});

test('expired reviews and edits to user principles, pricing assumptions or saved plans require another review', async () => {
  const result = await review();
  await assert.rejects(() => assertDividendResumeReviewCurrent(result, undefined, () => now + DIVIDEND_RESUME_REVIEW_MAX_AGE_MS + 1), /DIVIDEND_REVIEW_STALE/);
  await updateSettings({ dividendSelectionPrinciples: { ...defaultDividendSelectionPrinciples(), minRoeBps: 900 } });
  await assert.rejects(() => assertDividendResumeReviewCurrent(result, undefined, () => now), /DIVIDEND_REVIEW_CHANGED/);
  await updateSettings({ dividendSelectionPrinciples: defaultDividendSelectionPrinciples() });
  await updateSettings({ dividendPricingMethod: { ...defaultDividendPricingMethod(), safetyMarginBps: 2000 } });
  await assert.rejects(() => assertDividendResumeReviewCurrent(result, undefined, () => now), /DIVIDEND_REVIEW_CHANGED/);
  await updateSettings({ dividendPricingMethod: defaultDividendPricingMethod() });
  await db.dividendStocks.update(stock.code, { manualShares: 200 });
  await assert.rejects(() => assertDividendResumeReviewCurrent(result, undefined, () => now), /DIVIDEND_REVIEW_CHANGED/);
  await assert.rejects(() => assertDividendResumeReviewCurrent({ ...result, proposal: null }, undefined, () => now), /DIVIDEND_REVIEW_REQUIRED/);
});

test('a saved-plan edit while evidence is downloading invalidates that review without writing', async () => {
  await assert.rejects(() => reviewDividendResume(stock, { now: () => now, fetchResearch: async () => {
    await db.dividendStocks.update(stock.code, { weightBps: 2000 }); return snapshot();
  } }), /DIVIDEND_REVIEW_CHANGED/);
  assert.equal((await db.dividendStocks.get(stock.code))?.buyPaused, true);
});
