import { verifiedDividendBase } from './helpers/dividendPricingFixture.ts';
import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../src/lib/dividendPricing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dividendResearchAdvice as evaluateDividendResearchAdvice } from '../src/lib/dividendResearchAdvice.ts';
import type { DividendIndexResearch, DividendStockResearch, DividendTechnicalResearch } from '../src/lib/dividendResearch.ts';
import type { DividendPricingResult } from '../src/lib/dividendPricing.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';

const technical: DividendTechnicalResearch = { asOf: '2026-10-21', fetchedAt: 1, priceBasis: 'qfq', currentUsable: true,
  lastCloseMinor: 1000, ma5Minor: 1000, ma10Minor: 990, ma30Minor: 980, ma30SlopePercent: 1, rsi6: 55,
  change5Percent: 1, change10Percent: 2, change30Percent: 3, previous5Percent: 1, drawdown60Percent: -2, state: 'rising', pacing: 'observe' };
const market: DividendIndexResearch[] = [{ code: 'sh000300', name: 'CSI 300', technical, sources: [], issues: [] }];
const pricing: DividendPricingResult = { calculationVersion: DIVIDEND_PRICING_CALCULATION_VERSION, pricingBasis: 'recent_batches', status: 'ready', canApply: true, riskClass: 'other', blockers: [], warnings: [], annuals: [],
  dividendBase: verifiedDividendBase(660000, '2026-10-21'),
  trailingDividend: { dpsMicros:660000, asOf:'2026-10-21', windowStart:'2025-10-21', capitalActionsVerified:true, cashDistributionsComplete:true,
    quoteComparisonSafeFrom:'2026-10-21', sourceUrls:['https://example.com/implemented-cash'] },
  d1Micros:660000, theoreticalPriceMinor:1320, normalizationBasis: 'three_year_adjusted_eps_mean', taxBps: 0,
  anchors: { selectedBps:500, selection:'fixed_classic' }, gordonYieldBps: 800,
  grid: [550,575,600,650].map((yieldBps, index) => ({ priceMinor:Math.floor(660000/yieldBps), discountBps:Math.round(500/yieldBps*10000),
    yieldBps, cumulativePortionBps:(index+1)*2500, meetsSafetyMargin:true })),
  sourceUrls: [], currentPriceMinor: 1150, priceDate: '2026-10-21', marginPriceMinor: 1050 };
const stock: DividendStockResearch = { code: '000333', name: 'Fixture', technical, pricing, checks: [{ rule: 'roe', status: 'pass' }], status: 'pass', sources: [], issues: [] };
const dividendResearchAdvice = (value: DividendStockResearch, indices: DividendIndexResearch[], notes?: string, savedStock?: DividendStock) =>
  evaluateDividendResearchAdvice(value, indices, notes, savedStock, '2026-10-21');

test('the first reached grid is actionable even above the separate safety-margin reference', () => {
  const advice = dividendResearchAdvice(stock, market);
  assert.equal(advice.decision, 'eligible');
  assert.equal(advice.firstBuyPriceMinor, 1200);
  assert.deepEqual(advice.triggeredBuyLevels, [1]);
  assert.equal(dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 1000 } }, market).triggeredBuyLevels.length, 4);
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

test('saved current quotes keep fixed-grid triggers visible when financial downloads cannot produce pricing', () => {
  const saved: DividendStock = { code: stock.code, name: stock.name, group: 'core', weightBps: 1000, shareMode: 'manual', manualShares: 100, lotSize: 100,
    buyPaused: true, buyLevels: [{ yieldBps: 500, portionBps: 10000, priceMinor: 1000 }],
    quote: { priceMinor: 1000, date: '2026-10-21 10:00', fetchedAt: 1 } };
  const missingFinancial = { ...stock, pricing: undefined, checks: [{ rule: 'roe' as const, status: 'unknown' as const }] };
  const advice = dividendResearchAdvice(missingFinancial, market, undefined, saved);
  assert.equal(advice.decision, 'eligible'); assert.deepEqual(advice.triggeredBuyLevels, [1]);
  assert.equal(advice.currentPriceMinor, 1000); assert.equal(advice.currentPriceDate, saved.quote!.date);
  assert.deepEqual(advice.missingRules, ['roe']); assert.equal(advice.quoteUsable, true);
  const highQuote = dividendResearchAdvice(missingFinancial, market, undefined, { ...saved, quote: { ...saved.quote!, priceMinor: 1121 } });
  assert.equal(highQuote.decision, 'wait_price'); assert.deepEqual(highQuote.triggeredBuyLevels, []);
  for (const altered of [{ ...saved, quote: undefined }, { ...saved, quoteFailedAt: 2 },
    ...['2026-10-10', '2026-10-22', 'invalid'].map(date => ({ ...saved, quote: { ...saved.quote!, date } })),
    { ...saved, quote: { ...saved.quote!, priceMinor: 0 } }, { ...saved, quote: { ...saved.quote!, priceMinor: 800.5 } }]) {
    const invalid = dividendResearchAdvice(missingFinancial, market, undefined, altered);
    assert.equal(invalid.decision, 'evidence'); assert.equal(invalid.quoteUsable, false); assert.deepEqual(invalid.triggeredBuyLevels, []);
  }
});

test('newer valid quote wins without reviving stale, future or failed quote observations', () => {
  const saved: DividendStock = { code: stock.code, name: stock.name, group: 'core', weightBps: 1000, shareMode: 'manual', manualShares: 100, lotSize: 100,
    buyLevels: [{ yieldBps: 500, portionBps: 10000, priceMinor: 1000 }], quote: { priceMinor: 1121, date: '2026-10-21 10:00', fetchedAt: 1 } };
  const selected = dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 800 } }, market, undefined, saved);
  assert.equal(selected.currentPriceMinor, 1121); assert.equal(selected.decision, 'wait_price');
  const newerResearch = dividendResearchAdvice({ ...stock, pricing: { ...pricing, currentPriceMinor: 800, priceDate: '2026-10-21 11:00' } }, market, undefined, saved);
  assert.equal(newerResearch.currentPriceMinor, 800); assert.equal(newerResearch.decision, 'eligible');
  const fallback = dividendResearchAdvice({ ...stock, pricing: { ...pricing, pauseReasons: ['quote_missing', 'fcf_below_150'] } }, market, undefined, saved);
  assert.equal(fallback.currentPriceMinor, 1121); assert.deepEqual(fallback.pricingRiskReasons, ['fcf_below_150']); assert.deepEqual(fallback.pricingMissingReasons, []);
  for (const priceDate of ['2026-10-10', '2026-10-22', 'invalid', undefined]) {
    const unavailable = dividendResearchAdvice({ ...stock, pricing: { ...pricing, priceDate } }, market);
    assert.equal(unavailable.quoteUsable, false); assert.equal(unavailable.decision, 'evidence');
  }
});


test('a configured candidate without an explicit old grid cannot reuse a pre-ex-date saved quote against the new share basis', () => {
  const saved: DividendStock = { code: stock.code, name: stock.name, group: 'watch', weightBps: 0, shareMode: 'manual', manualShares: 0, lotSize: 100,
    quote: { priceMinor: 1000, date: '2026-10-20 15:00', fetchedAt: 1 } };
  const afterEx: DividendStockResearch = { ...stock, pricing: { ...pricing, dividendBase: { ...pricing.dividendBase!, latestExDate: '2026-10-21' },
    currentPriceMinor: 1000, priceDate: '2026-10-20', pauseReasons: ['quote_missing'] } };
  const oldQuote = dividendResearchAdvice(afterEx, market, undefined, saved);
  assert.equal(oldQuote.decision, 'evidence'); assert.equal(oldQuote.quoteUsable, false); assert.deepEqual(oldQuote.triggeredBuyLevels, []);
  const currentQuote = dividendResearchAdvice(afterEx, market, undefined, { ...saved, quote: { ...saved.quote!, date: '2026-10-21 10:00' } });
  assert.equal(currentQuote.decision, 'eligible'); assert.equal(currentQuote.quoteUsable, true); assert.ok(currentQuote.triggeredBuyLevels.length > 0);
  const explicitOldGrid = dividendResearchAdvice(afterEx, market, undefined, { ...saved, buyLevels: [{ yieldBps: 500, portionBps: 10000, priceMinor: 1200 }] });
  assert.equal(explicitOldGrid.decision, 'eligible'); assert.equal(explicitOldGrid.basisState, 'saved_unverified');
});

test('candidate quote-basis validation does not rely on a producer attaching a quote_missing warning', () => {
  const result = dividendResearchAdvice({ ...stock, pricing: { ...pricing, dividendBase: { ...pricing.dividendBase!, latestExDate: '2026-10-21' }, priceDate: '2026-10-20', pauseReasons: [] } }, market);
  assert.equal(result.quoteUsable, false); assert.equal(result.decision, 'evidence'); assert.deepEqual(result.triggeredBuyLevels, []);
});
