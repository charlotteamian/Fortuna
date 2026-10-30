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
import { buildDividendLedger, dividendLedgerBase, type DividendOfficialEvent } from '../src/lib/dividendLedger.ts';
import { pingAnOfficialLedger, verifiedDividendBase } from './helpers/dividendPricingFixture.ts';

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
    dividendBase: verifiedDividendBase(609000, asOf), asOf, priceMinor: 1120, priceDate: asOf, ...patch };
}

function shift(date: string, offset: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
function ledgerRow(report: string, ex: string, cash: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { SECURITY_CODE: code, REPORT_DATE: report, EX_DIVIDEND_DATE: ex, EQUITY_RECORD_DATE: shift(ex, -1), NOTICE_DATE: shift(ex, -7),
    PRETAX_BONUS_RMB: cash, BONUS_RATIO: 0, IT_RATIO: 0, ASSIGN_PROGRESS: '实施分配', ...patch };
}
function ledger(rows: Record<string, unknown>[], at = asOf) {
  const officialEvents: DividendOfficialEvent[] = rows.filter(row => row.ASSIGN_PROGRESS === '实施分配').map(row => ({
    code, reportDate: String(row.REPORT_DATE), period: String(row.REPORT_DATE).endsWith('-06-30') ? 'interim' : 'annual',
    announcementDate: String(row.NOTICE_DATE), recordDate: String(row.EQUITY_RECORD_DATE), exDate: String(row.EX_DIVIDEND_DATE),
    cashPer10Micros: Math.round(Number(row.PRETAX_BONUS_RMB) * 1e6), bonusPer10Bps: Number(row.BONUS_RATIO) * 1000, transferPer10Bps: Number(row.IT_RATIO) * 1000,
    sourceUrl: 'https://static.cninfo.com.cn/finalpage/2026-01-01/synthetic-test-only.PDF', verifiedAt: at,
  }));
  return buildDividendLedger(source(rows), code, at, { officialEvents });
}

const prices = (pricing: DividendPricingResult) => ({ neutral: pricing.theoreticalPriceMinor,
  buys: pricing.grid.map(row => row.priceMinor), sells: dividendPricingPlan(pricing)?.sellLevels.map(row => row.priceMinor) });

test('captured official Ping An final and interim announcements create the default ten-percent-tax recent-batch plan', () => {
  const value = pingAnOfficialLedger(asOf), base = dividendLedgerBase(value, asOf);
  assert.equal(base.dpsMicros, 609000); assert.equal(base.verified, true);
  assert.equal(base.frequency, 'semiannual'); assert.equal(base.requiredBatches, 2);
  assert.deepEqual(base.reportPeriods, ['2026-06-30', '2025-12-31']);
  assert.ok(base.sourceUrls.some(url => url.includes('1225352449'))); assert.ok(base.sourceUrls.some(url => url.includes('1225568476')));
  const p = calculateDividendPricing(input({ code: '000001', name: '平安银行', ledger: value, dividendBase: undefined }));
  assert.equal(DIVIDEND_PRICING_CALCULATION_VERSION, 5);
  assert.equal(p.calculationVersion, 5); assert.equal(p.pricingBasis, 'recent_batches'); assert.equal(p.canApply, true);
  assert.equal(p.dividendBase?.dpsMicros, 609000); assert.equal(p.taxBps, 1000); assert.equal(p.d1Micros, 548100); assert.equal(p.earningsDividendMicros, undefined);
  assert.equal(p.anchors.selectedBps, 500); assert.equal(p.anchors.selection, 'fixed_classic');
  assert.deepEqual(prices(p), { neutral: 1096, buys: [996, 953, 913, 843], sells: [1142, 1218, 1305, 1371] });
  const plan = dividendPricingPlan(p)!;
  assert.deepEqual(plan.buyLevels.map(row => row.yieldBps), [550,575,600,650]);
  assert.deepEqual(plan.sellLevels.map(row => row.yieldBps), [480,450,420,400]);
  assert.deepEqual([...plan.buyLevels,...plan.sellLevels].map(row => row.portionBps), Array(8).fill(2500));
  assert.deepEqual(p.grid.map(row => row.cumulativePortionBps), [2500,5000,7500,10000]);
  assert.deepEqual(dividendPricingMarketComparison(p).reachedBuyLevels, []);
});

test('historical TTM parser includes implemented ex-date cash once, excludes the lower boundary, plans and future disclosures', () => {
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
  const withoutQuote = calculateDividendPricing(input({ dividendBase: verifiedDividendBase(cash.dpsMicros, asOf), method: { ...defaultDividendPricingMethod(), holdingPeriod: 'over_year' }, priceMinor: undefined, priceDate: undefined }));
  assert.equal(withoutQuote.d1Micros, 123457); assert.equal(withoutQuote.canApply, true);
  assert.equal(dividendPricingPlan(withoutQuote)?.buyLevels[0].priceMinor, 224);
});

test('historical TTM and history share the same cash-and-bonus and later capital-action conversion', () => {
  const raw = source([firstObserved, event('2026-01-01', 10),
    event('2026-06-01', 10, { BONUS_RATIO: 10 }), event('2026-09-01', 0, { IT_RATIO: 10 })]);
  const cash = dividendPricingTrailingDividend(raw, code, asOf)!;
  assert.equal(cash.dpsMicros, 500000); // Each one-yuan payment is on one quarter of today's share basis.
  const history = dividendPricingYieldHistory([{ date: asOf, priceMinor: 1000 }], raw, code)!;
  assert.equal(history.samples[0].yieldBps, 500);
  assert.equal(cash.capitalActionsVerified, history.capitalActionsVerified);
});

test('the historical leap-day window clamps to 28 February and shares the exact historical boundary', () => {
  const raw = source([event('2022-01-01', 1), event('2023-02-28', 9), event('2023-03-01', 2), event('2024-02-29', 3)]);
  const cash = dividendPricingTrailingDividend(raw, code, '2024-02-29')!;
  assert.equal(cash.windowStart, '2023-02-28'); assert.equal(cash.dpsMicros, 500000);
  assert.equal(dividendPricingYieldHistory([{ date: '2024-02-29', priceMinor: 1000 }], raw, code)?.samples[0].yieldBps, 500);
  for (const badDate of ['2026-02-29','2026-13-01','2026-10-23-extra','']) {
    assert.equal(dividendPricingTrailingDividend(raw, code, badDate), undefined);
  }
});

test('legacy trailing cash alone is not a verified batch base, while a verified zero cannot create positive prices', () => {
  assert.equal(dividendPricingTrailingDividend(source([event('2026-06-01', 5)]), code, asOf), undefined);
  assert.equal(dividendPricingTrailingDividend(source([]), code, asOf), undefined);
  const missing = calculateDividendPricing(input({ dividendBase: undefined, trailingDividend: trailing() }));
  assert.equal(missing.canApply, false); assert.ok(missing.blockers.includes('dividend_ledger_missing'));
  const cash = dividendPricingTrailingDividend(source([firstObserved]), code, asOf)!;
  assert.equal(cash.dpsMicros, 0);
  const zero = calculateDividendPricing(input({ dividendBase: verifiedDividendBase(0, asOf) }));
  assert.equal(zero.d1Micros, 0); assert.equal(zero.canApply, false); assert.deepEqual(zero.grid, []);
  assert.ok(zero.blockers.includes('trailing_dividend_zero')); assert.equal(dividendPricingPlan(zero), null);
  assert.equal(dividendPricingYieldHistory([{ date: asOf, priceMinor: 1000 }], source([firstObserved]), code)?.samples[0].yieldBps, 0);
});

test('unverified capital actions, missing cash, duplicate conflicts and paginated cash cannot produce a ready batch plan', () => {
  const missingBonus = event('2026-06-01', 3.6); delete missingBonus.BONUS_RATIO;
  const malformedBonus = event('2026-06-01', 3.6, { IT_RATIO: 'unknown' });
  for (const row of [missingBonus,malformedBonus]) {
    const cash = dividendPricingTrailingDividend(source([firstObserved,row]), code, asOf)!;
    assert.equal(cash.capitalActionsVerified, false);
    const p = calculateDividendPricing(input({ dividendBase: verifiedDividendBase(609000, asOf, { verified: false, flags: ['CAPITAL_OR_CASH_UNVERIFIED'] }) }));
    assert.equal(p.canApply, false); assert.ok(p.blockers.includes('dividend_base_unverified'));
  }
  for (const raw of [source([firstObserved,event('2026-06-01', null)]),
    source([firstObserved,event('2026-06-01', 3.6),event('2026-06-01', 3.7)]),
    source([firstObserved,event('2026-06-01', 3.6)], 2)]) {
    const cash = dividendPricingTrailingDividend(raw, code, asOf)!;
    assert.equal(cash.cashDistributionsComplete, false);
    assert.equal(calculateDividendPricing(input({ dividendBase: undefined, ledger: buildDividendLedger(raw, code, asOf) })).canApply, false);
  }
  for (const [flag, blocker] of [['INCOMPLETE', 'dividend_base_incomplete'], ['SOURCE_PAGES_INCOMPLETE', 'dividend_base_incomplete'], ['SOURCE_CONFLICT', 'dividend_source_conflict']] as const) {
    const p = calculateDividendPricing(input({ dividendBase: verifiedDividendBase(609000, asOf, { verified: false, flags: [flag] }) }));
    assert.ok(p.blockers.includes(blocker)); assert.equal(dividendPricingPlan(p), null);
  }
  assert.throws(() => dividendPricingTrailingDividend(source([event('2026-06-01', 1, { SECURITY_CODE: '000001' })]), code, asOf), /PRICING_SOURCE_INVALID/);
});

test('verified annual issuer cash cannot certify unverified individual CATL batches or fill a new base silently', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-catl-2026-10-23.json', import.meta.url), 'utf8'));
  const cash = dividendPricingTrailingDividend(fixture.sources.distribution.data, '300750', asOf)!;
  assert.equal(cash.cashDistributionsComplete, false);
  const p = calculateDividendPricing(input({ code: '300750', name: '宁德时代', financialSector: false, dividendBase: undefined,
    ledger: buildDividendLedger(fixture.sources.distribution.data, '300750', asOf) }));
  assert.equal(p.canApply, false); assert.equal(p.d1Micros, undefined);
  assert.ok(p.blockers.includes('dividend_base_unverified'));
});

test('only a same-date, sourced, verified and complete recent-batch contract supplies the grid numerator', () => {
  for (const patch of [{ dpsMicros: -1 }, { dpsMicros: 1.5 }, { dpsMicros: Number.MAX_SAFE_INTEGER+1 }, { dpsMicros: NaN },
    { sourceUrls: [] }, { sourceUrls: [''] }, { verified: false }, { requiredBatches: 2 }, { selectedBatchIds: [] },
    { frequency: 'unknown' as const }, { asOf: '2026-10-22' }, { asOf: '2026-10-24' }]) {
    const p = calculateDividendPricing(input({ dividendBase: { ...verifiedDividendBase(609000, asOf), ...patch } }));
    assert.equal(p.canApply, false); assert.equal(p.d1Micros, undefined); assert.ok(p.blockers.includes('dividend_base_unverified'));
  }
});

test('holding-period tax is applied to cash once and every buy and sell uses the same adjusted amount', () => {
  for (const [holdingPeriod,taxBps,dps,firstBuy] of [
    ['over_year',0,609000,1107],['month_to_year',1000,548100,996],['up_to_month',2000,487200,885],
  ] as const) {
    const p = calculateDividendPricing(input({ method: { ...defaultDividendPricingMethod(), holdingPeriod } }));
    assert.equal(p.taxBps, taxBps); assert.equal(p.d1Micros, dps); assert.equal(p.dividendBase?.dpsMicros, 609000);
    assert.equal(p.grid[0].priceMinor, firstBuy);
    const plan = dividendPricingPlan(p)!;
    assert.deepEqual(plan.buyLevels.map(row => row.priceMinor), CLASSIC_DIVIDEND_BUY_YIELDS.map(y => Math.floor(dps/y)));
    assert.deepEqual(plan.sellLevels.map(row => row.priceMinor), CLASSIC_DIVIDEND_SELL_YIELDS.map(y => Math.ceil(dps/y)));
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

test('a cash ex-date between a recent quote and research prevents cross-basis triggers but preserves the dated quote cash yield', () => {
  const base = verifiedDividendBase(609000, asOf, { latestExDate: '2026-10-22' });
  const p = calculateDividendPricing(input({ dividendBase: base, priceDate: '2026-10-21',
    currentCashYieldBps: 500, treasury: { yieldBps: 200, asOf, fetchedAt: 1, history: [], sourceUrl: 'https://example.com/treasury' } }));
  assert.equal(p.canApply, true); assert.equal(p.d1Micros, 548100);
  assert.deepEqual(p.grid.map(row => row.priceMinor), [996,953,913,843]);
  assert.ok(p.grid.every(row => row.changeFromCurrentBps === undefined)); assert.ok(p.pauseReasons?.includes('quote_missing'));
  assert.equal(dividendPricingMarketComparison(p).quoteUsable, false); assert.equal(dividendPricingMarketComparison(p).sustainableYieldAtQuoteBps, undefined);
  assert.equal(p.currentCashYieldBps, 500); assert.equal(p.currentSpreadBps, 300);
  assert.equal(p.currentPriceMinor, 1120); assert.equal(p.priceDate, '2026-10-21');
  for (const priceDate of ['2026-10-22', asOf]) assert.equal(dividendPricingMarketComparison(calculateDividendPricing(input({ dividendBase: base, priceDate }))).quoteUsable, true);
});

test('a zero-cash bonus event invalidates a pre-bonus quote comparison without blocking the verified new-share cash grid', () => {
  const value = ledger([ledgerRow('2024-12-31', '2025-06-01', 5), ledgerRow('2025-12-31', '2026-06-01', 6), ledgerRow('2026-12-31', '2026-10-22', 0, { BONUS_RATIO: 10 })]);
  const base = dividendLedgerBase(value, asOf);
  assert.equal(base.dpsMicros, 300000); assert.equal(base.latestExDate, '2026-10-22');
  const before = calculateDividendPricing(input({ ledger: value, dividendBase: undefined, priceDate: '2026-10-21', priceMinor: 1000 }));
  const after = calculateDividendPricing(input({ ledger: value, dividendBase: undefined, priceDate: '2026-10-22', priceMinor: 500 }));
  assert.equal(before.canApply, true); assert.deepEqual(prices(before), prices(after));
  assert.equal(dividendPricingMarketComparison(before).quoteUsable, false); assert.equal(dividendPricingMarketComparison(after).quoteUsable, true);
});

test('verified older quotes remain comparable while the selected batches and share basis are unchanged', () => {
  const base = verifiedDividendBase(609000, asOf, { latestExDate: '2026-06-01' });
  const p = calculateDividendPricing(input({ dividendBase: base, priceDate: '2026-10-13' }));
  assert.equal(dividendPricingMarketComparison(p).quoteUsable, true, 'the ten-day boundary remains supported');
  assert.deepEqual(dividendPricingMarketComparison(p).reachedBuyLevels, []);
});

test('a semiannual base does not lose the preceding interim payment after its anniversary while the next one is only proposed', () => {
  const value = ledger([ledgerRow('2025-06-30', '2025-10-15', 2.36), ledgerRow('2025-12-31', '2026-06-12', 3.6),
    ledgerRow('2026-06-30', '2026-11-10', 2.49, { ASSIGN_PROGRESS: '股东大会通过', NOTICE_DATE: '2026-09-17' })], '2026-10-29');
  const before = dividendLedgerBase(value, '2026-10-14'), after = dividendLedgerBase(value, '2026-10-16');
  assert.equal(before.dpsMicros, 596000); assert.equal(after.dpsMicros, 596000); assert.equal(after.frequency, 'semiannual');
  assert.ok(after.flags.includes('PROPOSAL_NOT_COUNTED')); assert.equal(after.selectedBatchIds.length, 2);
  const first = calculateDividendPricing(input({ asOf: '2026-10-14', dividendBase: before, priceDate: '2026-10-14' }));
  const next = calculateDividendPricing(input({ asOf: '2026-10-16', dividendBase: after, priceDate: '2026-10-16' }));
  assert.equal(first.canApply, true); assert.deepEqual(prices(first), prices(next)); assert.equal(next.d1Micros, 536400);
});

test('the EPS-payout crosscheck blocks only a deviation strictly greater than twenty-five percent without rounding it away', () => {
  const value = ledger([ledgerRow('2024-12-31', '2025-06-10', 2), ledgerRow('2025-12-31', '2026-06-12', 3), ledgerRow('2026-06-30', '2026-09-24', 3)]);
  const boundary = dividendLedgerBase(value, asOf, { epsMicros: 450000, payoutBps: 10000 });
  const above = dividendLedgerBase(value, asOf, { epsMicros: 449999, payoutBps: 10000 });
  assert.equal(boundary.dpsMicros, 600000); assert.equal(boundary.verified, true); assert.ok(!boundary.flags.includes('CROSSCHECK_MISMATCH'));
  assert.equal(above.dpsMicros, 600000); assert.equal(above.verified, false); assert.ok(above.flags.includes('CROSSCHECK_MISMATCH'));
  const pricing = calculateDividendPricing(input({ dividendBase: above }));
  assert.equal(pricing.canApply, false); assert.ok(pricing.blockers.includes('dividend_crosscheck_mismatch'));
});

test('the historical leap-day TTM rollover stays reproducible but no longer reduces the recent annual-batch grid', () => {
  const raw = source([event('2022-01-01',1),event('2024-02-29',3),event('2024-06-01',6)]);
  const february = dividendPricingTrailingDividend(raw,code,'2025-02-28')!, march = dividendPricingTrailingDividend(raw,code,'2025-03-01')!;
  assert.equal(february.dpsMicros,900000); assert.equal(february.quoteComparisonSafeFrom,'2024-06-01');
  assert.equal(march.dpsMicros,600000); assert.equal(march.quoteComparisonSafeFrom,'2025-03-01');
  const value = ledger([ledgerRow('2022-12-31','2023-06-01',4),ledgerRow('2023-12-31','2024-06-01',6)], '2025-03-01');
  const before = dividendLedgerBase(value,'2025-02-28'), after = dividendLedgerBase(value,'2025-03-01');
  assert.equal(before.dpsMicros,600000); assert.equal(after.dpsMicros,600000);
  const old = calculateDividendPricing(input({ asOf:'2025-03-01',dividendBase:after,priceDate:'2025-02-28' }));
  const sameDay = calculateDividendPricing(input({ asOf:'2025-03-01',dividendBase:after,priceDate:'2025-03-01' }));
  assert.equal(old.canApply,true); assert.deepEqual(prices(old),prices(sameDay));
  assert.equal(dividendPricingMarketComparison(old).quoteUsable,true); assert.equal(dividendPricingMarketComparison(sameDay).quoteUsable,true);
});

test('a recent-batch base without a valid latest effective date cannot create a supposedly current grid', () => {
  for (const latestExDate of [undefined, '2026-10-24', '2026-02-30', '2026-10-22-invalid']) {
    const p = calculateDividendPricing(input({ dividendBase: verifiedDividendBase(609000, asOf, { latestExDate }) }));
    assert.equal(p.canApply, false); assert.ok(p.blockers.includes('dividend_base_unverified'));
    assert.equal(dividendPricingMarketComparison(p).quoteUsable, false);
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
    assert.equal(p.d1Micros, 548100); assert.equal(p.fcfCapApplied, false); assert.equal(p.anchors.selection, 'fixed_classic');
    assert.ok(p.pauseReasons?.includes('non_positive_earnings')); assert.ok(p.pauseReasons?.includes('fcf_non_positive'));
    assert.ok(p.pauseReasons?.includes('growth_return_conflict')); assert.ok(!p.warnings.includes('anchors_conflict'));
  }
});

test('legacy method settings remain loadable but every new calculation explicitly uses recent verified batches', () => {
  const method = defaultDividendPricingMethod(); delete method.strategy;
  assert.equal(isDividendPricingMethod(method), true);
  const p = calculateDividendPricing(input({ method }));
  assert.equal(p.pricingBasis, 'recent_batches'); assert.equal(p.grid.length, 4);
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
    (v: DividendPricingResult) => { v.taxBps = 0; },
    (v: DividendPricingResult) => { v.dividendBase!.dpsMicros! += 10; },
    (v: DividendPricingResult) => { v.blockers.push('dividend_base_unverified'); },
  ]) {
    const altered = structuredClone(p); corrupt(altered); assert.equal(dividendPricingPlan(altered), null, String(corrupt));
  }
  const historic = { ...p, calculationVersion: 3 }, historicBefore = structuredClone(historic);
  const invalidated = invalidateOutdatedDividendPricing(historic);
  assert.equal(invalidated.canApply, false); assert.ok(invalidated.blockers.includes('pricing_calculation_stale'));
  assert.deepEqual(invalidated.grid, historic.grid); assert.equal(dividendPricingPlan(invalidated), null);
  assert.deepEqual(historic, historicBefore); assert.deepEqual(p, before);
  assert.equal(invalidateOutdatedDividendPricing({ ...p, pricingBasis: undefined }).canApply, false);
  const tooSmall = calculateDividendPricing(input({ dividendBase: verifiedDividendBase(800, asOf) }));
  assert.equal(tooSmall.canApply, false); assert.equal(dividendPricingPlan(tooSmall), null);
});

test('model-readable evidence describes recent implemented batches and labels gross and net cash separately', () => {
  const p = calculateDividendPricing(input()), readable = dividendPricingReadable(p), text = JSON.stringify(readable);
  assert.equal(readable['Pricing basis'], 'recent_batches');
  assert.equal(p.dividendBase?.dpsMicros, 609000); assert.equal(p.d1Micros, 548100);
  assert.equal(readable['Neutral 5 percent reference price CNY'], 10.96);
  assert.equal(readable['Four fixed-yield buy prices'].length, 4);
  assert.match(text, /0\.609/); assert.match(text, /0\.5481/);
  assert.doesNotMatch(text, /preceding 12 months|Tax-adjusted TTM|Sustainable D1|Primary three-anchor valuation|Three exact grid prices/);
  assert.doesNotMatch(humanizeDividendPricingIssues('dividend_ledger_missing dividend_base_unverified', 'zh'), /dividend_ledger_missing|dividend_base_unverified/);
});
