import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../src/lib/dividendPricing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dividendReviewSummary } from '../src/lib/dividendReviewSummary.ts';
import { dividendResearchAdvice } from '../src/lib/dividendResearchAdvice.ts';
import { calculateDividendPricing, defaultDividendPricingMethod, type DividendPricingAnnual, type DividendPricingResult } from '../src/lib/dividendPricing.ts';
import type { DividendResearchCheck, DividendStockResearch, DividendTechnicalResearch } from '../src/lib/dividendResearch.ts';

const technical: DividendTechnicalResearch = { asOf: '2026-10-23', fetchedAt: 1, priceBasis: 'qfq', currentUsable: true,
  lastCloseMinor: 1000, ma5Minor: 1000, ma10Minor: 990, ma30Minor: 980, ma30SlopePercent: 1, rsi6: 55,
  change5Percent: 1, change10Percent: 2, change30Percent: 3, previous5Percent: 1, drawdown60Percent: -2,
  state: 'rising', pacing: 'observe' };
const pricing: DividendPricingResult = { calculationVersion: DIVIDEND_PRICING_CALCULATION_VERSION, pricingBasis:'classic_ttm', status: 'ready', canApply: true, riskClass: 'other', blockers: [], warnings: [], annuals: [],
  normalizationBasis: 'three_year_adjusted_eps_mean', taxBps: 0, anchors: {}, gordonYieldBps: 800,
  grid: [{ priceMinor: 1200, discountBps: 9500, yieldBps: 500, cumulativePortionBps: 3333, meetsSafetyMargin: false }],
  sourceUrls: [], currentPriceMinor: 1000, priceDate: '2026-10-23' };
function research(checks: DividendResearchCheck[], pricingChanges: Partial<DividendPricingResult> = {}): DividendStockResearch {
  return { code: '000333', name: 'Fixture', technical: { ...technical }, pricing: { ...pricing, ...pricingChanges },
    checks, status: 'pass', sources: [], issues: [] };
}
function summarize(stock: DividendStockResearch) {
  return dividendReviewSummary(stock, dividendResearchAdvice(stock,
    [{ code: 'sh000300', name: 'CSI 300', technical, sources: [], issues: [] }], undefined, undefined, '2026-10-23'));
}
function cashAnnuals(basis: 'cash' | 'coverage'): DividendPricingAnnual[] {
  return Array.from({ length: 5 }, (_, index) => ({ year: 2025 - index, reportDate: `${2025 - index}-12-31`,
    noticeDate: `${2026 - index}-03-20`, epsMicros: 1000000, adjustedEpsMicros: 1000000, payoutBps: 5000,
    dividendMicros: 500000, ...(basis === 'cash'
      ? { operatingCashMinor: 10000, capitalExpenditureMinor: 2000, totalShares: 100 }
      : { fcfCoverageBps: 20000 }) }));
}
function priceCashEvidence(annuals: DividendPricingAnnual[]) {
  return calculateDividendPricing({ code: '000333', name: 'Fixture', financialSector: false,
    method: defaultDividendPricingMethod(), annuals, trailingDividend: { dpsMicros:500000, asOf:'2026-10-23', windowStart:'2025-10-23', capitalActionsVerified:true, cashDistributionsComplete:true, sourceUrls:['https://example.com/dividend'] }, asOf: '2026-10-23', priceMinor: 1000, priceDate: '2026-10-23',
    treasury: { yieldBps: 200, asOf: '2026-10-23', fetchedAt: 1, sourceUrl: 'https://example.com/treasury', history: [] } });
}

test('cash-flow and payout warnings count each user concern once while preserving their evidence sources', () => {
  const summary = summarize(research([
    { rule: 'fcfCoverage', status: 'risk', value: 12664, threshold: 15000 },
    { rule: 'payout', status: 'risk', value: 10021, threshold: 10000 },
    { rule: 'fiveYearPayout', status: 'risk', value: 10021, threshold: 10000 },
  ], { pauseReasons: ['payout_above_100', 'fcf_below_150'], warnings: ['fcf_below_150', 'fcf_dividend_capped'] }));
  assert.equal(summary.risks.length, 2);
  assert.deepEqual(summary.risks.find(item => item.topic === 'cashflow'), {
    topic: 'cashflow', labelKey: 'div_v4_topic_cashflow', rules: ['fcfCoverage'],
    pricingIssues: ['fcf_below_150', 'fcf_dividend_capped'],
    comparison: { value: 12664, threshold: 15000, unit: 'percent', direction: 'below' },
  });
  assert.deepEqual(summary.risks.find(item => item.topic === 'payout')?.rules, ['payout', 'fiveYearPayout']);
  assert.deepEqual(summary.risks.find(item => item.topic === 'payout')?.pricingIssues, ['payout_above_100']);
  assert.deepEqual(summary.risks.find(item => item.topic === 'payout')?.comparison,
    { value: 10021, threshold: 10000, unit: 'percent', direction: 'above' });
  assert.deepEqual(summary.missing, []);
});

test('dividend history, report dates and specialist financial evidence each combine their screening and pricing observations', () => {
  const summary = summarize(research([
    { rule: 'dividendYears', status: 'unknown' }, { rule: 'reportFreshness', status: 'unknown', reason: 'stale' },
    { rule: 'financialSector', status: 'unknown' },
  ], { pauseReasons: ['dividend_continuity_missing', 'annual_stale', 'financial_sector_review'] }));
  assert.deepEqual(summary.risks, []);
  assert.equal(summary.missing.length, 3);
  assert.deepEqual(summary.missing.map(item => [item.topic, item.rules, item.pricingIssues]), [
    ['dividend_history', ['dividendYears'], ['dividend_continuity_missing']],
    ['report', ['reportFreshness'], ['annual_stale']],
    ['financial_sector', ['financialSector'], ['financial_sector_review']],
  ]);
});

test('a known shortfall and missing evidence on the same topic remain independent and retain their sources', () => {
  // Latest-year coverage can be known while another year needed for pricing is absent.
  const summary = summarize(research([
    { rule: 'fcfCoverage', status: 'risk', value: 12000 },
    { rule: 'payout', status: 'risk', value: 11000 }, { rule: 'fiveYearPayout', status: 'unknown' },
  ], { blockers: ['fcf_missing', 'annual_payout_missing'], warnings: ['fcf_below_150'] }));
  const riskCash = summary.risks.find(item => item.topic === 'cashflow');
  const missingCash = summary.missing.find(item => item.topic === 'cashflow');
  assert.deepEqual(riskCash?.rules, ['fcfCoverage']);
  assert.deepEqual(riskCash?.pricingIssues, ['fcf_below_150']);
  assert.deepEqual(missingCash?.rules, []);
  assert.deepEqual(missingCash?.pricingIssues, ['fcf_missing']);
  assert.deepEqual(summary.risks.find(item => item.topic === 'payout')?.rules, ['payout']);
  assert.deepEqual(summary.missing.find(item => item.topic === 'payout')?.rules, ['fiveYearPayout']);
  assert.deepEqual(summary.missing.find(item => item.topic === 'payout')?.pricingIssues, ['annual_payout_missing']);
});

test('a fully evidenced nonpositive cash year keeps its derived pricing gap with the risk rather than reporting missing data', () => {
  for (const basis of ['cash', 'coverage'] as const) {
    const annuals = cashAnnuals(basis);
    if (basis === 'cash') annuals[0].operatingCashMinor = 1000;
    else annuals[0].fcfCoverageBps = 0;
    const calculated = priceCashEvidence(annuals);
    assert.ok(calculated.pauseReasons?.includes('fcf_non_positive'), basis);
    assert.equal(calculated.canApply, true, 'a historical cash-flow risk does not replace verified TTM');
    assert.ok(calculated.pauseReasons?.includes('fcf_missing'), 'the reference calculation gap is reproduced before summary grouping');
    const summary = summarize(research([], calculated));
    assert.deepEqual(summary.risks.find(item => item.topic === 'cashflow')?.pricingIssues,
      ['fcf_non_positive', 'fcf_missing'], basis);
    assert.equal(summary.risks.find(item => item.topic === 'cashflow')?.factKey, 'div_v4_fact_fcf_non_positive', basis);
    assert.equal(summary.missing.some(item => item.topic === 'cashflow'), false, basis);
    assert.ok(calculated.pauseReasons?.includes('fcf_missing'), 'grouping preserves the original reference evidence');
  }
});

test('a nonpositive cash year does not conceal another year with genuinely unavailable per-share cash support', () => {
  const missingYear = cashAnnuals('coverage');
  missingYear[0].fcfCoverageBps = -1000;
  delete missingYear[1].fcfCoverageBps;
  const missingShares = cashAnnuals('cash');
  missingShares[0].operatingCashMinor = 1000;
  delete missingShares[1].totalShares;
  const unusableDividend = cashAnnuals('coverage');
  unusableDividend[0].fcfCoverageBps = -1000;
  unusableDividend[1].dividendMicros = 0;
  const shortHistory = cashAnnuals('coverage').slice(0, 2);
  shortHistory[0].fcfCoverageBps = -1000;
  for (const [label, annuals] of [
    ['missing coverage year', missingYear], ['cash flow without a share count', missingShares],
    ['coverage without a positive per-share dividend', unusableDividend], ['fewer than three years', shortHistory],
  ] as const) {
    const summary = summarize(research([], priceCashEvidence(annuals)));
    assert.deepEqual(summary.risks.find(item => item.topic === 'cashflow')?.pricingIssues, ['fcf_non_positive'], label);
    assert.deepEqual(summary.missing.find(item => item.topic === 'cashflow')?.pricingIssues, ['fcf_missing'], label);
  }
});

test('financial-sector metrics retain both observed risk and missing evidence even when the aggregate review is risk', () => {
  const review: NonNullable<DividendPricingResult['financialReview']> = {
    sector: 'bank', status: 'risk', asOf: '2026-06-30', basis: 'dividend_screen', sourceUrl: 'https://example.com/bank',
    policySourceUrls: [], missing: ['nonPerformingLoan'], metrics: [
      { key: 'coreTier1', status: 'risk', valueBps: 600, thresholdBps: 900, direction: 'minimum', reportDate: '2026-06-30' },
      { key: 'nonPerformingLoan', status: 'unknown', thresholdBps: 300, direction: 'maximum', reportDate: '2026-06-30' },
    ],
  };
  for (const source of ['financial', 'pricing'] as const) {
    const stock = research([{ rule: 'financialSector', status: 'risk' }],
      { pauseReasons: ['financial_sector_review'], ...(source === 'pricing' ? { financialReview: review } : {}) });
    if (source === 'financial') stock.financial = { name: stock.name, sector: '银行', financialSector: true,
      latest: { reportDate: '2026-06-30', loss: false }, periods: [], sectorReview: review };
    const summary = summarize(stock);
    assert.deepEqual(summary.risks.find(item => item.topic === 'financial_sector')?.rules, ['financialSector'], source);
    assert.deepEqual(summary.risks.find(item => item.topic === 'financial_sector')?.pricingIssues, ['financial_sector_review'], source);
    assert.equal(summary.risks.find(item => item.topic === 'financial_sector')?.factKey, 'div_v4_fact_sector_risk', source);
    assert.equal(summary.missing.filter(item => item.topic === 'financial_sector').length, 1, source);
  }
});

test('absence of screening checks is shown as unavailable financial evidence rather than an all-clear', () => {
  const summary = summarize(research([]));
  assert.deepEqual(summary.risks, []);
  assert.deepEqual(summary.missing.map(item => item.topic), ['financial_evidence']);
});

test('numeric risk facts preserve threshold direction and distinguish years from percentage values', () => {
  const summary = summarize(research([
    { rule: 'dividendYears', status: 'risk', value: 2, threshold: 5 },
    { rule: 'debtAsset', status: 'risk', value: 8000, threshold: 7000 },
  ]));
  assert.deepEqual(summary.risks.find(item => item.topic === 'dividend_history')?.comparison,
    { value: 2, threshold: 5, unit: 'years', direction: 'below' });
  assert.deepEqual(summary.risks.find(item => item.topic === 'debt')?.comparison,
    { value: 8000, threshold: 7000, unit: 'percent', direction: 'above' });
});

test('pricing-only risks use concise concrete facts when a numeric screening comparison is unavailable', () => {
  const summary = summarize(research([{ rule: 'roe', status: 'pass' }],
    { pauseReasons: ['payout_above_100'], warnings: ['fcf_below_150', 'fcf_dividend_capped'] }));
  const cashflow = summary.risks.find(item => item.topic === 'cashflow');
  assert.equal(cashflow?.factKey, 'div_v4_fact_fcf_low');
  assert.equal(cashflow?.comparison, undefined);
  assert.equal(summary.risks.find(item => item.topic === 'payout')?.factKey, 'div_v4_fact_payout_high');
});

test('available annual ROE does not conceal missing data for the separate PB valuation reference', () => {
  const summary = summarize(research([{ rule: 'roe', status: 'risk', value: 500, threshold: 800 }],
    { warnings: ['roe_bps_missing'] }));
  assert.deepEqual(summary.risks.map(item => item.topic), ['roe']);
  assert.deepEqual(summary.missing.map(item => item.topic), ['pb_reference']);
  assert.deepEqual(summary.missing[0].rules, []);
  assert.deepEqual(summary.missing[0].pricingIssues, ['roe_bps_missing']);
});

test('current cash yield and the historical valuation anchor remain distinct concerns', () => {
  const summary = summarize(research([{ rule: 'yield', status: 'unknown' }],
    { warnings: ['yield_history_missing', 'capital_actions_unverified'] }));
  assert.equal(summary.missing.length, 2);
  assert.deepEqual(summary.missing.find(item => item.topic === 'yield')?.rules, ['yield']);
  assert.deepEqual(summary.missing.find(item => item.topic === 'yield_history')?.pricingIssues,
    ['yield_history_missing', 'capital_actions_unverified']);
});

test('repeated observations cannot inflate the topic count or repeat evidence in its details', () => {
  const stock = research([{ rule: 'payout', status: 'risk' }, { rule: 'payout', status: 'risk' }]);
  const advice = dividendResearchAdvice(stock, [{ code: 'sh000300', name: 'CSI 300', technical, sources: [], issues: [] }],
    undefined, undefined, '2026-10-23');
  advice.pricingRiskReasons = ['payout_above_100', 'payout_above_100'];
  const summary = dividendReviewSummary(stock, advice);
  assert.equal(summary.risks.length, 1);
  assert.deepEqual(summary.risks[0].rules, ['payout']);
  assert.deepEqual(summary.risks[0].pricingIssues, ['payout_above_100']);
});

test('technical risks and unavailable evidence are visible once without changing price eligibility', () => {
  const stock = research([{ rule: 'roe', status: 'pass' }]);
  stock.technical = { ...technical, state: 'falling', pacing: 'review_grid' };
  const advice = dividendResearchAdvice(stock, [
    { code: 'sh000001', name: 'SSE', technical: { ...technical, state: 'accelerating_down', pacing: 'pause_add' }, sources: [], issues: [] },
    { code: 'sh000300', name: 'CSI 300', sources: [], issues: [] },
  ], '核实关联交易', undefined, '2026-10-23');
  const summary = dividendReviewSummary(stock, advice);
  assert.equal(advice.decision, 'eligible');
  assert.deepEqual(summary.risks.map(item => item.topic), ['stock_trend', 'market_trend']);
  assert.equal(summary.risks.find(item => item.topic === 'stock_trend')?.factKey, 'div_v4_fact_stock_falling');
  assert.equal(summary.risks.find(item => item.topic === 'market_trend')?.factKey, 'div_v4_fact_market_accelerating');
  assert.deepEqual(summary.missing.map(item => item.topic), ['market_trend', 'additional_rules']);
});


test('missing trailing cash evidence stays distinct from verified zero cash', () => {
  const missing = summarize(research([], { status:'blocked', canApply:false, grid:[], blockers:['trailing_dividend_missing','cash_distributions_incomplete'] }));
  assert.deepEqual(missing.missing.find(item => item.topic === 'trailing_dividend')?.pricingIssues, ['trailing_dividend_missing','cash_distributions_incomplete']);
  assert.equal(missing.risks.some(item => item.topic === 'trailing_dividend'), false);
  const zero = summarize(research([], { status:'blocked', canApply:false, grid:[], blockers:['trailing_dividend_zero'] }));
  assert.deepEqual(zero.risks.find(item => item.topic === 'trailing_dividend')?.pricingIssues, ['trailing_dividend_zero']);
  assert.equal(zero.missing.some(item => item.topic === 'trailing_dividend'), false);
});
