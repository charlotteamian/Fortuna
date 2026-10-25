import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASSIC_DIVIDEND_BUY_YIELDS, CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS, CLASSIC_DIVIDEND_SELL_YIELDS,
  DIVIDEND_PRICING_CALCULATION_VERSION, calculateDividendPricing, defaultDividendPricingMethod,
  dividendPricingMarketComparison, dividendPricingReadable, dividendPricingTrailingDividend,
  dividendPricingYieldHistory, humanizeDividendPricingIssues, invalidateOutdatedDividendPricing, isDividendPricingMethod,
  type DividendPricingInput, type DividendPricingResult, type DividendPricingTrailingDividend,
} from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';

const asOf = '2026-10-23', code = '600000';
const source = (data: Record<string, unknown>[], pages = 1) => ({ success: true, result: { data, pages } });
function event(ex: string, cashPerTen: number | null, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { SECURITY_CODE: code, REPORT_DATE: `${Number(ex.slice(0,4))-1}-12-31`, EX_DIVIDEND_DATE: ex,
    NOTICE_DATE: ex, ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: cashPerTen, BONUS_RATIO: null, IT_RATIO: null, ...patch };
}
const firstObserved = event('2024-06-01', 2);
function trailing(dpsMicros = 609000): DividendPricingTrailingDividend {
  return { dpsMicros, asOf, windowStart: '2025-10-23', capitalActionsVerified: true,
    cashDistributionsComplete: true, sourceUrls: ['https://example.com/implemented-cash'] };
}
function input(patch: Partial<DividendPricingInput> = {}): DividendPricingInput {
  return { code, name: 'Test bank', financialSector: true, method: defaultDividendPricingMethod(), annuals: [],
    trailingDividend: trailing(), asOf, priceMinor: 1120, priceDate: asOf, ...patch };
}
const prices = (pricing: DividendPricingResult) => ({ neutral: pricing.theoreticalPriceMinor,
  buys: pricing.grid.map(row => row.priceMinor), sells: dividendPricingPlan(pricing)?.sellLevels.map(row => row.priceMinor) });

test('captured Ping An implemented cash is exactly 0.609 and creates the selected four-by-four classic plan', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
  const cash = dividendPricingTrailingDividend(fixture.sources.distribution.data, '000001', asOf)!;
  assert.equal(cash.dpsMicros, 609000);
  assert.equal(cash.asOf, asOf); assert.equal(cash.windowStart, '2025-10-23');
  assert.equal(cash.capitalActionsVerified, true); assert.equal(cash.cashDistributionsComplete, true);
  const p = calculateDividendPricing(input({ code: '000001', name: '平安银行', trailingDividend: cash }));
  assert.equal(DIVIDEND_PRICING_CALCULATION_VERSION, 4);
  assert.equal(p.calculationVersion, 4); assert.equal(p.pricingBasis, 'classic_ttm'); assert.equal(p.canApply, true);
  assert.equal(p.d1Micros, 609000); assert.equal(p.earningsDividendMicros, undefined);
  assert.equal(p.anchors.selectedBps, 500); assert.equal(p.anchors.selection, 'fixed_classic');
  assert.deepEqual(prices(p), { neutral: 1218, buys: [1107,1059,1015,936], sells: [1268,1353,1450,1522] });
  const plan = dividendPricingPlan(p)!;
  assert.deepEqual(plan.buyLevels.map(row => row.yieldBps), [550,575,600,650]);
  assert.deepEqual(plan.sellLevels.map(row => row.yieldBps), [480,450,420,400]);
  assert.deepEqual([...plan.buyLevels,...plan.sellLevels].map(row => row.portionBps), Array(8).fill(2500));
  assert.deepEqual(p.grid.map(row => row.cumulativePortionBps), [2500,5000,7500,10000]);
  assert.deepEqual(dividendPricingMarketComparison(p).reachedBuyLevels, []);
});

test('TTM includes implemented ex-date cash once, excludes the lower boundary, plans and future disclosures', () => {
  const recent = event('2026-06-12', 3.6);
  const data = [firstObserved, event('2025-10-23', 9), recent, { ...recent }, event(asOf, 2.49),
    event('2026-10-24', 8), event('2026-09-01', 7, { ASSIGN_PROGRESS: '董事会预案' }),
    event('2026-09-02', 6, { ASSIGN_PROGRESS: '取消分配' }),
    event('2026-09-03', 5, { NOTICE_DATE: '2026-10-24' })];
  assert.equal(dividendPricingTrailingDividend(source(data), code, asOf)?.dpsMicros, 609000);
  const revised = event('2026-06-12', 3.7, { NOTICE_DATE: '2026-06-13' });
  assert.equal(dividendPricingTrailingDividend(source([...data,revised]), code, asOf)?.dpsMicros, 619000);
  assert.equal(dividendPricingTrailingDividend(source([...data].reverse()), code, asOf)?.dpsMicros, 609000);
});

test('cash numerator is independent of the quote and cannot be reconstructed from a rounded yield', () => {
  const raw = source([firstObserved,event('2026-06-01', 1.234567)]);
  const cash = dividendPricingTrailingDividend(raw, code, asOf)!;
  assert.equal(cash.dpsMicros, 123457);
  const history = dividendPricingYieldHistory([{ date: asOf, priceMinor: 1123 }], raw, code)!;
  assert.equal(history.samples[0].yieldBps, 110);
  assert.notEqual(history.samples[0].yieldBps * 1123, cash.dpsMicros);
  const withoutQuote = calculateDividendPricing(input({ trailingDividend: cash, priceMinor: undefined, priceDate: undefined }));
  assert.equal(withoutQuote.d1Micros, 123457); assert.equal(withoutQuote.canApply, true);
  assert.equal(dividendPricingPlan(withoutQuote)?.buyLevels[0].priceMinor, 224);
});

test('current TTM and history share the same cash-and-bonus and later capital-action conversion', () => {
  const raw = source([firstObserved, event('2026-01-01', 10),
    event('2026-06-01', 10, { BONUS_RATIO: 10 }), event('2026-09-01', 0, { IT_RATIO: 10 })]);
  const cash = dividendPricingTrailingDividend(raw, code, asOf)!;
  assert.equal(cash.dpsMicros, 500000); // Each one-yuan payment is on one quarter of today's share basis.
  const history = dividendPricingYieldHistory([{ date: asOf, priceMinor: 1000 }], raw, code)!;
  assert.equal(history.samples[0].yieldBps, 500);
  assert.equal(cash.capitalActionsVerified, history.capitalActionsVerified);
});

test('a leap-day window clamps to 28 February and shares the exact historical boundary', () => {
  const raw = source([event('2022-01-01', 1), event('2023-02-28', 9), event('2023-03-01', 2), event('2024-02-29', 3)]);
  const cash = dividendPricingTrailingDividend(raw, code, '2024-02-29')!;
  assert.equal(cash.windowStart, '2023-02-28'); assert.equal(cash.dpsMicros, 500000);
  assert.equal(dividendPricingYieldHistory([{ date: '2024-02-29', priceMinor: 1000 }], raw, code)?.samples[0].yieldBps, 500);
  for (const badDate of ['2026-02-29','2026-13-01','2026-10-23-extra','']) {
    assert.equal(dividendPricingTrailingDividend(raw, code, badDate), undefined);
  }
});

test('an incomplete observation window is unknown, while an observed zero remains zero and cannot create positive prices', () => {
  assert.equal(dividendPricingTrailingDividend(source([event('2026-06-01', 5)]), code, asOf), undefined);
  assert.equal(dividendPricingTrailingDividend(source([]), code, asOf), undefined);
  const missing = calculateDividendPricing(input({ trailingDividend: undefined }));
  assert.equal(missing.canApply, false); assert.ok(missing.blockers.includes('trailing_dividend_missing'));
  const cash = dividendPricingTrailingDividend(source([firstObserved]), code, asOf)!;
  assert.equal(cash.dpsMicros, 0);
  const zero = calculateDividendPricing(input({ trailingDividend: cash }));
  assert.equal(zero.d1Micros, 0); assert.equal(zero.canApply, false); assert.deepEqual(zero.grid, []);
  assert.ok(zero.blockers.includes('trailing_dividend_zero')); assert.equal(dividendPricingPlan(zero), null);
  assert.equal(dividendPricingYieldHistory([{ date: asOf, priceMinor: 1000 }], source([firstObserved]), code)?.samples[0].yieldBps, 0);
});

test('unverified capital actions, missing cash, duplicate conflicts and paginated cash cannot produce a ready plan', () => {
  const missingBonus = event('2026-06-01', 3.6); delete missingBonus.BONUS_RATIO;
  const malformedBonus = event('2026-06-01', 3.6, { IT_RATIO: 'unknown' });
  for (const row of [missingBonus,malformedBonus]) {
    const cash = dividendPricingTrailingDividend(source([firstObserved,row]), code, asOf)!;
    assert.equal(cash.capitalActionsVerified, false);
    assert.ok(calculateDividendPricing(input({ trailingDividend: cash })).blockers.includes('capital_actions_unverified'));
  }
  for (const raw of [source([firstObserved,event('2026-06-01', null)]),
    source([firstObserved,event('2026-06-01', 3.6),event('2026-06-01', 3.7)]),
    source([firstObserved,event('2026-06-01', 3.6)], 2)]) {
    const cash = dividendPricingTrailingDividend(raw, code, asOf)!;
    assert.equal(cash.cashDistributionsComplete, false);
    assert.ok(calculateDividendPricing(input({ trailingDividend: cash })).blockers.includes('cash_distributions_incomplete'));
  }
  assert.throws(() => dividendPricingTrailingDividend(source([event('2026-06-01', 1, { SECURITY_CODE: '000001' })]), code, asOf), /PRICING_SOURCE_INVALID/);
});

test('verified issuer cash omissions remain blocking instead of turning an incomplete CATL feed into TTM', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-catl-2026-10-23.json', import.meta.url), 'utf8'));
  const cash = dividendPricingTrailingDividend(fixture.sources.distribution.data, '300750', asOf)!;
  assert.equal(cash.cashDistributionsComplete, false);
  const p = calculateDividendPricing(input({ code: '300750', name: '宁德时代', financialSector: false, trailingDividend: cash }));
  assert.equal(p.canApply, false); assert.equal(p.d1Micros, undefined);
  assert.ok(p.blockers.includes('cash_distributions_incomplete'));
});

test('only an exact same-date, sourced, complete annual window supplies the grid numerator', () => {
  for (const patch of [{ dpsMicros: -1 }, { dpsMicros: 1.5 }, { dpsMicros: Number.MAX_SAFE_INTEGER+1 },
    { dpsMicros: NaN }, { windowStart: '2025-10-22' }, { sourceUrls: [] }, { sourceUrls: [''] }]) {
    const p = calculateDividendPricing(input({ trailingDividend: { ...trailing(), ...patch } }));
    assert.equal(p.canApply, false); assert.equal(p.d1Micros, undefined); assert.ok(p.blockers.includes('trailing_dividend_invalid'));
  }
  for (const [observation,start] of [['2026-10-22','2025-10-22'],['2026-10-24','2025-10-24']]) {
    const p = calculateDividendPricing(input({ trailingDividend: { ...trailing(), asOf: observation, windowStart: start } }));
    assert.equal(p.canApply, false); assert.ok(p.blockers.includes('trailing_dividend_stale'));
  }
});

test('holding-period tax is applied to cash once and every buy and sell uses the same adjusted amount', () => {
  for (const [holdingPeriod,taxBps,dps,firstBuy] of [
    ['over_year',0,609000,1107],['month_to_year',1000,548100,996],['up_to_month',2000,487200,885],
  ] as const) {
    const p = calculateDividendPricing(input({ method: { ...defaultDividendPricingMethod(), holdingPeriod } }));
    assert.equal(p.taxBps, taxBps); assert.equal(p.d1Micros, dps); assert.equal(p.trailingDividend?.dpsMicros, 609000);
    assert.equal(p.grid[0].priceMinor, firstBuy);
    const plan = dividendPricingPlan(p)!;
    assert.deepEqual(plan.buyLevels.map(row => row.priceMinor), CLASSIC_DIVIDEND_BUY_YIELDS.map(y => Math.floor(dps/y)));
    assert.deepEqual(plan.sellLevels.map(row => row.priceMinor), CLASSIC_DIVIDEND_SELL_YIELDS.map(y => Math.floor(dps/y)));
    assert.equal(p.theoreticalPriceMinor, Math.floor(dps / CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS));
  }
});

test('missing and stale quotes only remove trigger comparisons, never a valid cash price plan', () => {
  const expected = prices(calculateDividendPricing(input()));
  for (const quote of [{ priceMinor: undefined, priceDate: undefined },{ priceMinor: 1120, priceDate: '2026-01-01' },
    { priceMinor: 0, priceDate: asOf },{ priceMinor: 100, priceDate: '2026-10-24' }]) {
    const p = calculateDividendPricing(input(quote));
    assert.equal(p.canApply, true); assert.deepEqual(prices(p), expected);
    assert.ok(p.pauseReasons?.includes('quote_missing')); assert.ok(p.grid.every(row => row.changeFromCurrentBps === undefined));
    assert.equal(dividendPricingMarketComparison(p).quoteUsable, false);
    assert.deepEqual(dividendPricingMarketComparison(p).reachedBuyLevels, []);
  }
});

test('a cash ex-date between a recent quote and research prevents cross-window triggers but preserves the quote cash yield', () => {
  const raw = source([firstObserved,event('2026-06-01', 3.6),event('2026-10-22', 2.49)]);
  const cash = dividendPricingTrailingDividend(raw, code, asOf)!;
  assert.equal(cash.quoteComparisonSafeFrom, '2026-10-22');
  const p = calculateDividendPricing(input({ trailingDividend:cash, priceDate:'2026-10-21',
    currentCashYieldBps:500, treasury:{ yieldBps:200, asOf, fetchedAt:1, history:[], sourceUrl:'https://example.com/treasury' } }));
  assert.equal(p.canApply, true); assert.equal(p.d1Micros,609000);
  assert.deepEqual(p.grid.map(row=>row.priceMinor),[1107,1059,1015,936]);
  assert.ok(p.grid.every(row=>row.changeFromCurrentBps === undefined));
  assert.ok(p.pauseReasons?.includes('quote_missing'));
  assert.equal(dividendPricingMarketComparison(p).quoteUsable,false);
  assert.equal(dividendPricingMarketComparison(p).sustainableYieldAtQuoteBps,undefined);
  assert.equal(p.currentCashYieldBps,500); assert.equal(p.currentSpreadBps,300);
  assert.equal(p.currentPriceMinor,1120); assert.equal(p.priceDate,'2026-10-21');
  for (const priceDate of ['2026-10-22',asOf]) {
    const matching = calculateDividendPricing(input({ trailingDividend:cash,priceDate }));
    assert.equal(dividendPricingMarketComparison(matching).quoteUsable,true);
  }
});

test('a zero-cash bonus event invalidates a pre-bonus quote comparison without blocking the new-share cash grid', () => {
  const raw = source([firstObserved,event('2026-06-01',6),event('2026-10-22',0,{ BONUS_RATIO:10 })]);
  const cash = dividendPricingTrailingDividend(raw,code,asOf)!;
  assert.equal(cash.dpsMicros,300000); assert.equal(cash.quoteComparisonSafeFrom,'2026-10-22');
  const before = calculateDividendPricing(input({ trailingDividend:cash,priceDate:'2026-10-21',priceMinor:1000 }));
  const after = calculateDividendPricing(input({ trailingDividend:cash,priceDate:'2026-10-22',priceMinor:500 }));
  assert.equal(before.canApply,true); assert.deepEqual(prices(before),prices(after));
  assert.equal(dividendPricingMarketComparison(before).quoteUsable,false);
  assert.equal(dividendPricingMarketComparison(after).quoteUsable,true);
});

test('verified older quotes remain comparable while cash window and share basis are unchanged', () => {
  const raw = source([firstObserved,event('2026-06-01',6.09),event('2026-10-22',0)]);
  const cash = dividendPricingTrailingDividend(raw,code,asOf)!;
  assert.equal(cash.quoteComparisonSafeFrom,'2026-06-01','an explicit zero cash event with no share change does not alter the basis');
  const p = calculateDividendPricing(input({ trailingDividend:cash,priceDate:'2026-10-13' }));
  assert.equal(dividendPricingMarketComparison(p).quoteUsable,true,'the ten-day boundary remains supported');
  assert.deepEqual(dividendPricingMarketComparison(p).reachedBuyLevels,[]);
});

test('cash rolling out of the trailing window invalidates an earlier quote even without a new payment', () => {
  const raw = source([firstObserved,event('2025-10-22',3),event('2026-06-01',6)]);
  const cash = dividendPricingTrailingDividend(raw,code,asOf)!;
  assert.equal(cash.dpsMicros,600000); assert.equal(cash.quoteComparisonSafeFrom,'2026-10-22');
  const old = calculateDividendPricing(input({ trailingDividend:cash,priceDate:'2026-10-21' }));
  const matching = calculateDividendPricing(input({ trailingDividend:cash,priceDate:'2026-10-22' }));
  assert.equal(old.canApply,true); assert.deepEqual(prices(old),prices(matching));
  assert.equal(dividendPricingMarketComparison(old).quoteUsable,false);
  assert.equal(dividendPricingMarketComparison(matching).quoteUsable,true);
});

test('leap-day cash rolls out on 1 March, and comparison boundaries follow the exact window', () => {
  const raw = source([event('2022-01-01',1),event('2024-02-29',3),event('2024-06-01',6)]);
  const february = dividendPricingTrailingDividend(raw,code,'2025-02-28')!;
  const march = dividendPricingTrailingDividend(raw,code,'2025-03-01')!;
  assert.equal(february.dpsMicros,900000); assert.equal(february.quoteComparisonSafeFrom,'2024-06-01');
  assert.equal(march.dpsMicros,600000); assert.equal(march.quoteComparisonSafeFrom,'2025-03-01');
  const old = calculateDividendPricing(input({ asOf:'2025-03-01',trailingDividend:march,priceDate:'2025-02-28' }));
  const sameDay = calculateDividendPricing(input({ asOf:'2025-03-01',trailingDividend:march,priceDate:'2025-03-01' }));
  assert.equal(old.canApply,true); assert.deepEqual(prices(old),prices(sameDay));
  assert.equal(dividendPricingMarketComparison(old).quoteUsable,false);
  assert.equal(dividendPricingMarketComparison(sameDay).quoteUsable,true);
});

test('cash evidence lacking a comparison boundary allows only a same-day quote rather than assuming no intervening changes', () => {
  const p = calculateDividendPricing(input({ priceDate:'2026-10-22' }));
  assert.equal(p.canApply,true); assert.equal(dividendPricingMarketComparison(p).quoteUsable,false);
  assert.equal(dividendPricingMarketComparison(calculateDividendPricing(input())).quoteUsable,true);
  for (const quoteComparisonSafeFrom of ['2026-10-24','2026-02-30','2026-10-22-invalid']) {
    const invalid = calculateDividendPricing(input({ trailingDividend:{...trailing(),quoteComparisonSafeFrom} }));
    assert.ok(invalid.blockers.includes('trailing_dividend_invalid'));
    assert.equal(dividendPricingMarketComparison(invalid).quoteUsable,false);
  }
});

test('reference yields, their 100bp boundary, EPS, FCF, financial risks and safety settings cannot move fixed prices', () => {
  const expected = prices(calculateDividendPricing(input()));
  for (const alternativeBps of [100,600,601,1500]) {
    const method = { ...defaultDividendPricingMethod(), requiredReturnBps: 250, growthBps: 250,
      safetyMarginBps: 3000, riskPremiumBps: { bondlike: 0, bank: 0, cyclical: 0, other: 0 } };
    const p = calculateDividendPricing(input({ financialSector: false, method,
      opportunity: { yieldBps: alternativeBps, asOf, sourceUrl: 'https://example.com/comparison', basis: 'Cash reference only' },
      treasury: { yieldBps: 500, asOf, fetchedAt: 1, history: [], sourceUrl: 'https://example.com/treasury' },
      annuals: Array.from({ length: 5 },(_,i) => ({ year: 2025-i, reportDate: `${2025-i}-12-31`, noticeDate: `${2026-i}-03-01`,
        adjustedEpsMicros: -1000000, epsMicros: -1000000, payoutBps: 12000, dividendMicros: 0,
        operatingCashMinor: -100, capitalExpenditureMinor: 10, fcfCoverageBps: -100 })),
    }));
    assert.equal(p.canApply, true); assert.deepEqual(p.blockers, []); assert.deepEqual(prices(p), expected);
    assert.equal(p.d1Micros, 609000); assert.equal(p.fcfCapApplied, false); assert.equal(p.anchors.selection, 'fixed_classic');
    assert.ok(p.pauseReasons?.includes('non_positive_earnings')); assert.ok(p.pauseReasons?.includes('fcf_non_positive'));
    assert.ok(p.pauseReasons?.includes('growth_return_conflict')); assert.ok(!p.warnings.includes('anchors_conflict'));
  }
});

test('legacy method settings remain loadable but every new calculation explicitly uses classic TTM', () => {
  const method = defaultDividendPricingMethod(); delete method.strategy;
  assert.equal(isDividendPricingMethod(method), true);
  const p = calculateDividendPricing(input({ method }));
  assert.equal(p.pricingBasis, 'classic_ttm'); assert.equal(p.grid.length, 4);
  assert.equal(isDividendPricingMethod({ ...method, strategy: 'three_anchor' }), false);
});

test('a replacement rejects stale, mixed, altered or incoherent grids and never mutates historical results', () => {
  const p = calculateDividendPricing(input()), before = structuredClone(p);
  for (const corrupt of [
    (v: DividendPricingResult) => { v.calculationVersion = 3; },
    (v: DividendPricingResult) => { v.pricingBasis = undefined; },
    (v: DividendPricingResult) => { v.grid.pop(); },
    (v: DividendPricingResult) => { v.grid[0].priceMinor++; },
    (v: DividendPricingResult) => { v.grid[0].yieldBps++; },
    (v: DividendPricingResult) => { v.grid[0].cumulativePortionBps = 3333; },
    (v: DividendPricingResult) => { v.anchors.selectedBps = 389; },
    (v: DividendPricingResult) => { v.anchors.selection = 'median'; },
    (v: DividendPricingResult) => { v.taxBps = 1000; },
    (v: DividendPricingResult) => { v.trailingDividend!.dpsMicros++; },
    (v: DividendPricingResult) => { v.blockers.push('trailing_dividend_stale'); },
  ]) {
    const altered = structuredClone(p); corrupt(altered); assert.equal(dividendPricingPlan(altered), null);
  }
  const historic = { ...p, calculationVersion: 3 }, historicBefore = structuredClone(historic);
  const invalidated = invalidateOutdatedDividendPricing(historic);
  assert.equal(invalidated.canApply, false); assert.ok(invalidated.blockers.includes('pricing_calculation_stale'));
  assert.deepEqual(invalidated.grid, historic.grid); assert.equal(dividendPricingPlan(invalidated), null);
  assert.deepEqual(historic, historicBefore); assert.deepEqual(p, before);
  assert.equal(invalidateOutdatedDividendPricing({ ...p, pricingBasis: undefined }).canApply, false);
  const tooSmall = calculateDividendPricing(input({ trailingDividend: trailing(800) }));
  assert.equal(tooSmall.canApply, false); assert.equal(dividendPricingPlan(tooSmall), null);
});

test('model-readable evidence labels past cash, fixed yields and references without calling TTM sustainable D1', () => {
  const readable = dividendPricingReadable(calculateDividendPricing(input()));
  assert.equal(readable['Pricing basis'], 'classic_ttm');
  assert.equal(readable['Pretax implemented trailing cash in CNY per share'], 0.609);
  assert.equal(readable['Tax-adjusted TTM dividend in CNY per share'], 0.609);
  assert.equal(readable['Neutral 5 percent reference price CNY'], 12.18);
  assert.equal(readable['Four fixed-yield buy prices'].length, 4);
  assert.doesNotMatch(JSON.stringify(readable), /Sustainable D1|Primary three-anchor valuation|Three exact grid prices/);
  assert.doesNotMatch(humanizeDividendPricingIssues('trailing_dividend_missing cash_distributions_incomplete', 'zh'), /trailing_dividend_missing|cash_distributions_incomplete/);
});
