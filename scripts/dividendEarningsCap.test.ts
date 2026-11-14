import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDividendLedger, dividendLedgerBase, type DividendLedger, type DividendLedgerEvent } from '../src/lib/dividendLedger.ts';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';
import { buildDividendManualBase } from '../src/lib/dividendManualInputs.ts';
import { verifiedDividendBase } from './helpers/dividendPricingFixture.ts';

const code = '000858', asOf = '2026-11-14';
function shift(date: string, offset: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
const row = (report: string, ex: string, cash: number, extra: Record<string, unknown> = {}) => ({ SECURITY_CODE: code, REPORT_DATE: report,
  EX_DIVIDEND_DATE: ex, EQUITY_RECORD_DATE: shift(ex, -1), NOTICE_DATE: shift(ex, -7), PRETAX_BONUS_RMB: cash,
  BONUS_RATIO: 0, IT_RATIO: 0, ASSIGN_PROGRESS: '实施分配', ...extra });
const build = (rows: Record<string, unknown>[]) => buildDividendLedger({ success: true, result: { data: rows, pages: 1 } }, code, asOf);
const semiRows = (eps?: number) => [row('2026-06-30', '2026-09-24', 3), row('2025-12-31', '2026-06-12', 4, eps === undefined ? {} : { BASIC_EPS: eps })];

test('implemented cash above the latest annual EPS is limited to that EPS while the paid amount stays visible', () => {
  const base = dividendLedgerBase(build(semiRows(0.5)), asOf);
  assert.equal(base.implementedDpsMicros, 700000); assert.equal(base.dpsMicros, 500000);
  assert.deepEqual(base.earningsCap, { epsMicros: 500000, reportDate: '2025-12-31' });
  assert.ok(base.flags.includes('CAPPED_AT_EARNINGS')); assert.equal(base.verified, true);
});

test('implemented cash within the latest annual EPS is not adjusted', () => {
  const base = dividendLedgerBase(build(semiRows(2)), asOf);
  assert.equal(base.dpsMicros, 700000); assert.equal(base.implementedDpsMicros, 700000);
  assert.deepEqual(base.earningsCap, { epsMicros: 2000000, reportDate: '2025-12-31' });
  assert.ok(!base.flags.includes('CAPPED_AT_EARNINGS')); assert.ok(!base.flags.includes('EARNINGS_CAP_UNCHECKED'));
});

test('without a latest annual EPS the base keeps implemented cash and flags the unchecked limit', () => {
  const base = dividendLedgerBase(build(semiRows()), asOf);
  assert.equal(base.dpsMicros, 700000); assert.equal(base.earningsCap, undefined);
  assert.ok(base.flags.includes('EARNINGS_CAP_UNCHECKED'));
});

test('a non-positive latest annual EPS zeroes the pricing base but not the implemented record', () => {
  const base = dividendLedgerBase(build(semiRows(-0.5)), asOf);
  assert.equal(base.dpsMicros, 0); assert.equal(base.implementedDpsMicros, 700000);
  assert.ok(base.flags.includes('EARNINGS_NON_POSITIVE')); assert.equal(base.verified, true);
});

test('an annual report older than the latest completed dividend year cannot supply the limit', () => {
  const rows = [row('2024-12-31', '2025-06-12', 4, { BASIC_EPS: 0.3 }), row('2023-12-31', '2024-06-12', 3, { BASIC_EPS: 0.3 })];
  const ledger = build(rows);
  const stale = dividendLedgerBase(ledger, asOf);
  assert.equal(stale.dpsMicros, 400000); assert.equal(stale.earningsCap, undefined);
  assert.ok(stale.flags.includes('EARNINGS_CAP_UNCHECKED'));
  // Before August the 2024 annual is still the latest completed dividend year.
  const current = dividendLedgerBase(ledger, '2026-07-31');
  assert.deepEqual(current.earningsCap, { epsMicros: 300000, reportDate: '2024-12-31' });
  assert.ok(!current.flags.includes('EARNINGS_CAP_UNCHECKED')); assert.equal(current.dpsMicros, 300000);
  assert.ok(current.flags.includes('CAPPED_AT_EARNINGS'));
});

test('the EPS limit is restated to the observation share basis like the cash numerator', () => {
  const capped = dividendLedgerBase(build([row('2025-12-31', '2026-06-10', 5, { IT_RATIO: 10, BASIC_EPS: 0.4 })]), asOf);
  assert.equal(capped.implementedDpsMicros, 250000); assert.equal(capped.dpsMicros, 200000);
  assert.deepEqual(capped.earningsCap, { epsMicros: 200000, reportDate: '2025-12-31' });
  const uncapped = dividendLedgerBase(build([row('2025-12-31', '2026-06-10', 5, { IT_RATIO: 10, BASIC_EPS: 0.6 })]), asOf);
  assert.equal(uncapped.dpsMicros, 250000); assert.ok(!uncapped.flags.includes('CAPPED_AT_EARNINGS'));
});

test('an EPS row announced after the observation date cannot limit that day\'s base', () => {
  const event = (patch: Partial<DividendLedgerEvent>): DividendLedgerEvent => ({ id: 'x', batchId: 'x', code, reportDate: '2025-12-31', period: 'annual',
    announcementDate: '2026-06-05', recordDate: '2026-06-11', exDate: '2026-06-12', cashPer10Micros: 4000000, bonusPer10Bps: 0, transferPer10Bps: 0,
    shareFactor: 1, normalizedDpsMicros: 400000, implemented: true, stage: 'implemented', verification: 'verified', sources: [], issues: [], ...patch });
  const ledger: DividendLedger = { code, asOf: '2026-07-15', complete: true, issues: [], sourceUrls: [], events: [
    event({ id: 'a', batchId: 'a' }),
    // The same fiscal year's EPS arrives with a later special-distribution disclosure.
    event({ id: 'b', batchId: 'b', period: 'special', announcementDate: '2026-07-01', exDate: '2026-07-10',
      cashPer10Micros: 0, normalizedDpsMicros: 0, basicEpsMicros: 300000 }),
  ] };
  const before = dividendLedgerBase(ledger, '2026-06-20');
  assert.equal(before.dpsMicros, 400000); assert.equal(before.earningsCap, undefined);
  assert.ok(before.flags.includes('EARNINGS_CAP_UNCHECKED'));
  const after = dividendLedgerBase(ledger, '2026-07-15');
  assert.equal(after.dpsMicros, 300000); assert.deepEqual(after.earningsCap, { epsMicros: 300000, reportDate: '2025-12-31' });
  assert.ok(after.flags.includes('CAPPED_AT_EARNINGS'));
});

const pricingInput = (base: ReturnType<typeof verifiedDividendBase>, holdingPeriod: 'over_year' | 'month_to_year' = 'month_to_year') => ({
  code, name: 'Test distillery', financialSector: false, method: { ...defaultDividendPricingMethod(), holdingPeriod },
  annuals: [], dividendBase: base, asOf, priceMinor: 900, priceDate: asOf });
const cappedBase = () => verifiedDividendBase(500000, asOf, { implementedDpsMicros: 700000,
  earningsCap: { epsMicros: 500000, reportDate: '2025-12-31' }, flags: ['CAPPED_AT_EARNINGS'] });

test('a capped base prices every level from the EPS limit and pauses with an explicit reason', () => {
  for (const [holdingPeriod, d1, buy1, sell1] of [['month_to_year', 450000, 818, 938], ['over_year', 500000, 909, 1042]] as const) {
    const p = calculateDividendPricing(pricingInput(cappedBase(), holdingPeriod));
    assert.equal(p.canApply, true); assert.equal(p.d1Micros, d1);
    assert.ok(p.pauseReasons?.includes('dividend_capped_at_earnings'));
    const plan = dividendPricingPlan(p)!;
    assert.equal(plan.buyLevels[0].priceMinor, buy1); assert.equal(plan.sellLevels[0].priceMinor, sell1);
    assert.equal(plan.buyLevels[0].yieldBps, 550); assert.equal(plan.sellLevels[0].yieldBps, 480);
  }
});

test('a non-positive latest annual EPS blocks new prices entirely', () => {
  const p = calculateDividendPricing(pricingInput(verifiedDividendBase(0, asOf, { implementedDpsMicros: 700000,
    earningsCap: { epsMicros: -500000, reportDate: '2025-12-31' }, flags: ['EARNINGS_NON_POSITIVE'] })));
  assert.ok(p.blockers.includes('latest_annual_loss')); assert.equal(p.canApply, false);
  assert.equal(dividendPricingPlan(p), null);
});

test('an unchecked earnings limit only pauses with a visible reason', () => {
  const p = calculateDividendPricing(pricingInput(verifiedDividendBase(700000, asOf, { flags: ['EARNINGS_CAP_UNCHECKED'] })));
  assert.equal(p.canApply, true); assert.ok(p.pauseReasons?.includes('earnings_cap_unchecked'));
  assert.equal(p.d1Micros, 630000);
});

test('the restored sustainability prompts appear for payout above 100 percent and thin cash coverage', () => {
  const annuals = [
    { year: 2025, reportDate: '2025-12-31', noticeDate: '2026-03-15', epsMicros: 1000000, payoutBps: 22360, fcfCoverageBps: 12000 },
    { year: 2024, reportDate: '2024-12-31', noticeDate: '2025-03-15', epsMicros: 1000000, payoutBps: 6000, fcfCoverageBps: 20000 },
    { year: 2023, reportDate: '2023-12-31', noticeDate: '2024-03-15', epsMicros: 1000000, payoutBps: 6000, fcfCoverageBps: 20000 },
  ];
  const p = calculateDividendPricing({ ...pricingInput(verifiedDividendBase(700000, asOf)), annuals });
  assert.ok(p.pauseReasons?.includes('payout_above_100')); assert.ok(p.pauseReasons?.includes('fcf_below_150'));
  assert.equal(p.canApply, true);
});

const officialUrl = 'https://static.cninfo.com.cn/finalpage/2026-06-01/synthetic.PDF';
const manualValue = (crosscheck?: { epsMicros: number; payoutBps: number; reportDate: string; sourceUrl: string }) => ({
  code, frequency: 'annual' as const, confirmedAt: '2026-11-01', expiresOn: '2026-11-20',
  coverageConfirmed: true, conflictAcknowledged: false, automaticSignature: 'synthetic',
  batches: [{ reportDate: '2025-12-31', announcementDate: '2026-06-01', recordDate: '2026-06-11', exDate: '2026-06-12',
    cashPer10Micros: 7000000, bonusPer10Bps: 0, transferPer10Bps: 0, sourceUrl: officialUrl }],
  ...(crosscheck ? { crosscheck } : {}) });

test('a user-confirmed base obeys the same earnings limit from the entered comparable EPS', () => {
  const capped = buildDividendManualBase(manualValue({ epsMicros: 500000, payoutBps: 14000, reportDate: '2025-12-31', sourceUrl: officialUrl }), asOf);
  assert.equal(capped.implementedDpsMicros, 700000); assert.equal(capped.dpsMicros, 500000);
  assert.deepEqual(capped.earningsCap, { epsMicros: 500000, reportDate: '2025-12-31' });
  assert.ok(capped.flags.includes('CAPPED_AT_EARNINGS'));
  const unchecked = buildDividendManualBase(manualValue(), asOf);
  assert.equal(unchecked.dpsMicros, 700000); assert.ok(unchecked.flags.includes('EARNINGS_CAP_UNCHECKED'));
});
