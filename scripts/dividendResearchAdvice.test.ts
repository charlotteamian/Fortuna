import test from 'node:test';
import assert from 'node:assert/strict';
import { dividendResearchAdvice } from '../src/lib/dividendResearchAdvice.ts';
import type { DividendIndexResearch, DividendStockResearch, DividendTechnicalResearch } from '../src/lib/dividendResearch.ts';
import type { DividendPricingResult } from '../src/lib/dividendPricing.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';

const technical: DividendTechnicalResearch = { asOf: '2026-10-21', fetchedAt: 1, priceBasis: 'qfq', currentUsable: true,
  lastCloseMinor: 1000, ma5Minor: 1000, ma10Minor: 990, ma30Minor: 980, ma30SlopePercent: 1, rsi6: 55,
  change5Percent: 1, change10Percent: 2, change30Percent: 3, previous5Percent: 1, drawdown60Percent: -2, state: 'rising', pacing: 'observe' };
const market: DividendIndexResearch[] = [{ code: 'sh000300', name: 'CSI 300', technical, sources: [], issues: [] }];
const pricing: DividendPricingResult = { status: 'ready', canApply: true, riskClass: 'other', blockers: [], warnings: [], annuals: [],
  normalizationBasis: 'three_year_adjusted_eps_mean', taxBps: 0, anchors: {}, gordonYieldBps: 800,
  grid: [1200, 1100, 1000].map((priceMinor, index) => ({ priceMinor, discountBps: [9500, 8500, 7500][index] as 9500 | 8500 | 7500,
    yieldBps: 500, cumulativePortionBps: [3333, 6666, 10000][index], meetsSafetyMargin: index > 1 })),
  sourceUrls: [], currentPriceMinor: 1150, marginPriceMinor: 1050 };
const stock: DividendStockResearch = { code: '000333', name: 'Fixture', technical, pricing, checks: [{ rule: 'roe', status: 'pass' }], status: 'pass', sources: [], issues: [] };

test('the first reached grid is actionable even above the separate safety-margin reference', () => {
  const advice = dividendResearchAdvice(stock, market);
  assert.equal(advice.decision, 'eligible');
  assert.equal(advice.firstBuyPriceMinor, 1200);
  assert.deepEqual(advice.triggeredBuyLevels, [1]);
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 1000 } }, market).triggeredBuyLevels.length, 3);
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 1201 } }, market).decision, 'wait_price');
});

test('risks and missing evidence remain separate advisory lists without overriding the price grid', () => {
  const advice = dividendResearchAdvice({ ...stock, checks: [{ rule: 'payout', status: 'risk' }, { rule: 'financialSector', status: 'unknown' }],
    pricing: { ...pricing, pauseReasons: ['payout_above_100', 'fcf_below_150', 'dividend_continuity_missing'] } }, [], '核实关联交易');
  assert.equal(advice.decision, 'eligible');
  assert.deepEqual(advice.failedRules, ['payout']); assert.deepEqual(advice.missingRules, ['financialSector']);
  assert.deepEqual(advice.pricingRiskReasons, ['payout_above_100', 'fcf_below_150']);
  assert.deepEqual(advice.pricingMissingReasons, ['dividend_continuity_missing']);
  assert.equal(advice.marketMissing, true); assert.equal(advice.additionalRulesUnverified, true);
  assert.equal(dividendResearchAdvice({ ...stock, technical: undefined }, market).decision, 'eligible');
});

test('falling or accelerating stock and market trends are visible context rather than automatic vetoes', () => {
  const falling = { ...technical, pacing: 'review_grid', state: 'falling' } as const;
  const accelerating = { ...technical, pacing: 'pause_add', state: 'accelerating_down' } as const;
  const advice = dividendResearchAdvice({ ...stock, technical: falling }, [{ ...market[0], technical: accelerating }]);
  assert.equal(advice.decision, 'eligible'); assert.equal(advice.marketPacing, 'pause_add');
  assert.equal(dividendResearchAdvice(stock, [{ ...market[0], code: 'sz399006' }]).marketMissing, true);
});

test('a stale quote or uncalculable candidate grid leaves price trigger unknown', () => {
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, pauseReasons: ['quote_missing'] } }, market).decision, 'evidence');
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: undefined } }, market).decision, 'evidence');
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, canApply: false, blockers: ['fcf_missing'] } }, market).decision, 'evidence');
});

test('a configured stock compares with its saved grid rather than a fresh replacement proposal', () => {
  const saved: DividendStock = { code: stock.code, name: stock.name, group: 'core', weightBps: 1000, shareMode: 'manual', manualShares: 100, lotSize: 100,
    buyPaused: true, buyLevels: [{ yieldBps: 500, portionBps: 10000, priceMinor: 1000 }] };
  const advice = dividendResearchAdvice(stock, market, undefined, saved);
  assert.equal(advice.decision, 'wait_price'); assert.deepEqual(advice.triggeredBuyLevels, []); assert.equal(advice.firstBuyPriceMinor, 1000);
  const triggered = dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 1000, canApply: false, blockers: ['fcf_missing'] } }, market, undefined, saved);
  assert.equal(triggered.decision, 'eligible', 'missing inputs for a new valuation do not erase the valid saved grid');
});
