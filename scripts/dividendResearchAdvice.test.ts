import test from 'node:test';
import assert from 'node:assert/strict';
import { dividendResearchAdvice } from '../src/lib/dividendResearchAdvice.ts';
import type { DividendIndexResearch, DividendStockResearch, DividendTechnicalResearch } from '../src/lib/dividendResearch.ts';
import type { DividendPricingResult } from '../src/lib/dividendPricing.ts';

const technical: DividendTechnicalResearch = { asOf: '2026-10-21', fetchedAt: 1, priceBasis: 'qfq', currentUsable: true,
  lastCloseMinor: 1000, ma5Minor: 1000, ma10Minor: 990, ma30Minor: 980, ma30SlopePercent: 1, rsi6: 55,
  change5Percent: 1, change10Percent: 2, change30Percent: 3, previous5Percent: 1, drawdown60Percent: -2, state: 'rising', pacing: 'observe' };
const market: DividendIndexResearch[] = [{ code: 'sh000300', name: 'CSI 300', technical, sources: [], issues: [] }];
const pricing: DividendPricingResult = { status: 'ready', canApply: true, riskClass: 'other', blockers: [], warnings: [], annuals: [],
  normalizationBasis: 'three_year_adjusted_eps_mean', taxBps: 0, anchors: {}, gordonYieldBps: 800, grid: [], sourceUrls: [], currentPriceMinor: 1000, marginPriceMinor: 1100 };
const stock: DividendStockResearch = { code: '000333', name: 'Fixture', technical, pricing, checks: [{ rule: 'roe', status: 'pass' }], status: 'pass', sources: [], issues: [] };

test('a usable price requires current stock and broad-market evidence and verified thresholds', () => {
  assert.equal(dividendResearchAdvice(stock, market).decision, 'eligible');
  assert.equal(dividendResearchAdvice({ ...stock, technical: undefined }, market).decision, 'evidence');
  assert.equal(dividendResearchAdvice(stock, []).decision, 'evidence');
  assert.equal(dividendResearchAdvice(stock, [{ ...market[0], code: 'sz399006' }]).decision, 'evidence');
  assert.equal(dividendResearchAdvice({ ...stock, checks: [{ rule: 'financialSector', status: 'unknown' }] }, market).decision, 'evidence');
  assert.equal(dividendResearchAdvice({ ...stock, checks: [{ rule: 'financialSector', status: 'risk' }] }, market).decision, 'risk');
  assert.equal(dividendResearchAdvice(stock, market, 'Check related-party transactions').decision, 'evidence');
  assert.equal(dividendResearchAdvice(stock, market, '  ').decision, 'eligible');
});

test('cheap prices never override verified risks, acceleration or a falling broad market', () => {
  assert.equal(dividendResearchAdvice({ ...stock, checks: [{ rule: 'payout', status: 'risk' }] }, market).decision, 'risk');
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, blockers: ['fcf_below_150'], canApply: false } }, market).decision, 'risk');
  assert.equal(dividendResearchAdvice(stock, [{ ...market[0], technical: { ...technical, pacing: 'pause_add', state: 'accelerating_down' } }]).decision, 'pause');
  assert.equal(dividendResearchAdvice(stock, [{ ...market[0], technical: { ...technical, pacing: 'review_grid', state: 'falling' } }]).decision, 'wait_stable');
  assert.equal(dividendResearchAdvice(stock, [{ ...market[0], technical: { ...technical, currentUsable: false, pacing: 'pause_add' } }]).decision, 'evidence');
});

test('price above the safety boundary waits, and anchor conflict cannot create an actionable conclusion', () => {
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 1101 } }, market).decision, 'wait_price');
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 1100 } }, market).decision, 'eligible');
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, canApply: false, blockers: ['anchors_conflict'] } }, market).decision, 'evidence');
});
