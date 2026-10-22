import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGrid, defaultDividendStocks, effectiveDps, forecastHoldingYearDividends, gridAnnualDps, isDividendStock, latestReportDividend, parseDividendResponse } from '../src/lib/dividendWorkbench.ts';
import { enrichDividendPaymentDates } from '../src/lib/dividendForecast.ts';

const annual = { SECURITY_CODE: '601398', REPORT_DATE: '2025-12-31', PRETAX_BONUS_RMB: 1.689, ASSIGN_PROGRESS: '实施分配', NOTICE_DATE: '2026-05-07', PLAN_NOTICE_DATE: '2026-03-28', EX_DIVIDEND_DATE: '2026-05-13', EQUITY_RECORD_DATE: '2026-05-12' };
const interim = { SECURITY_CODE: '601398', REPORT_DATE: '2026-06-30', PRETAX_BONUS_RMB: 1.511, ASSIGN_PROGRESS: '实施分配', NOTICE_DATE: '2026-10-15', PLAN_NOTICE_DATE: '2026-08-29', EX_DIVIDEND_DATE: '2026-10-21', EQUITY_RECORD_DATE: '2026-10-20' };
const oldInterim = { ...interim, REPORT_DATE: '2025-06-30', PRETAX_BONUS_RMB: 1.414, NOTICE_DATE: '2025-12-09', PLAN_NOTICE_DATE: '2025-08-30', EX_DIVIDEND_DATE: '2025-12-15', EQUITY_RECORD_DATE: '2025-12-12' };
function stock(rows: Record<string, unknown>[], asOf = '2026-10-21') {
  return { ...defaultDividendStocks()[0], dividend: parseDividendResponse({ success: true, result: { data: rows, pages: 1 } }, '601398', asOf, 100) };
}

test('latest disclosed report displays its own DPS, never TTM or annualised interim', () => {
  const s = stock([oldInterim, annual, interim]);
  assert.equal(s.dividend.dpsMicros, 461400); // Audit history is deliberately a separate number.
  assert.equal(effectiveDps(s), 151100);
  assert.equal(latestReportDividend(s)?.reportDate, '2026-06-30');
  assert.equal(latestReportDividend(s)?.period, 'H1');
  assert.equal(latestReportDividend(s)?.annualized, false);
  assert.equal(latestReportDividend(s)?.announcedAt, '2026-10-15');
  assert.ok(isDividendStock(s));
});

test('one-year forecast uses upcoming annual and interim periods once each after today ex-date', () => {
  const f = forecastHoldingYearDividends(stock([annual, oldInterim, interim]), '2026-10-21', 1000);
  assert.equal(f.dpsMicros, 320000);
  assert.equal(f.amountMinor, 32000);
  assert.equal(f.announcedDpsMicros, 0);
  assert.equal(f.historicalDpsMicros, 320000);
  assert.deepEqual(f.events.map(e => [e.reportDate, e.expectedExDate]), [['2026-12-31', '2027-05-13'], ['2027-06-30', '2027-10-21']]);
  assert.ok(f.events.every(e => e.dateEstimated));
});

test('future announced distribution replaces same historical season, while keeping other seasons', () => {
  const f = forecastHoldingYearDividends(stock([annual, oldInterim, interim], '2026-10-20'), '2026-10-20', 1000);
  assert.equal(f.dpsMicros, 320000);
  assert.equal(f.announcedDpsMicros, 151100);
  assert.equal(f.historicalDpsMicros, 168900);
  assert.deepEqual(f.events.map(e => e.reportDate), ['2026-06-30', '2026-12-31']);
  assert.equal(f.events[0].dateEstimated, false);
});

test('passing record date disqualifies new buyer even when ex-date is still future', () => {
  const s = stock([annual, oldInterim, { ...interim, EQUITY_RECORD_DATE: '2026-10-19' }], '2026-10-20');
  const f = forecastHoldingYearDividends(s, '2026-10-20');
  assert.equal(f.announcedDpsMicros, 0);
  assert.ok(f.events.every(e => e.reportDate !== '2026-06-30'));
});

test('unknown announcement schedule uses prior season for timing and keeps amount labelled announced', () => {
  const s = stock([annual, oldInterim, { ...interim, EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null, ASSIGN_PROGRESS: '董事会预案', NOTICE_DATE: '2026-08-29' }]);
  const f = forecastHoldingYearDividends(s, '2026-10-21');
  assert.equal(f.dpsMicros, 320000);
  assert.equal(f.events[0].expectedExDate, '2026-12-15');
  assert.equal(f.events[0].basis, 'announced');
  assert.equal(f.events[0].stage, 'proposal');
  assert.equal(f.events[0].dateEstimated, true);
  assert.equal(f.events[0].expectedPaymentDate, undefined);
});

test('latest quarter cannot silently fall back to earlier annual DPS and quarters are not annualised', () => {
  const q3 = { ...interim, REPORT_DATE: '2026-09-30', NOTICE_DATE: '2026-10-20', PLAN_NOTICE_DATE: '2026-10-20', PRETAX_BONUS_RMB: 0.3, ASSIGN_PROGRESS: '预案', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null };
  const s = stock([annual, interim, q3]);
  assert.equal(effectiveDps(s), 30000);
  assert.equal(latestReportDividend(s)?.period, 'Q3');
  assert.equal(forecastHoldingYearDividends(s, '2026-10-21').events.filter(e => e.reportDate === '2026-09-30').length, 1);
});

test('latest policy stays unknown while its forecast explicitly estimates the exact prior-year period', () => {
  const policy = { ...interim, PRETAX_BONUS_RMB: null, IMPL_PLAN_PROFILE: '现金分红金额占半年度归属于普通股股东净利润的比例为35%', NOTICE_DATE: '2026-08-29', ASSIGN_PROGRESS: '预披露', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null };
  const s = stock([annual, oldInterim, policy]);
  assert.equal(latestReportDividend(s)?.reportDate, '2026-06-30');
  assert.equal(effectiveDps(s), undefined);
  const f = forecastHoldingYearDividends(s, '2026-10-21');
  assert.equal(f.dpsMicros, 310300);
  assert.equal(f.amountMinor, 31);
  assert.deepEqual(f.incompleteReportDates, []);
  assert.equal(f.missingReason, undefined);
  assert.equal(f.announcedDpsMicros, 0);
  assert.equal(f.historicalDpsMicros, 310300);
  const estimated = f.events.find(event => event.reportDate === '2026-06-30')!;
  assert.equal(estimated.dpsMicros, 141400);
  assert.equal(estimated.basis, 'historical');
  assert.equal(estimated.basisReportDate, '2025-06-30');
  assert.equal(estimated.basisDate, '2025-12-09');
  assert.equal(estimated.amountUnannounced, true);
  assert.equal(estimated.expectedExDate, '2026-12-15');
  assert.equal(estimated.stage, latestReportDividend(s)?.stage);
  assert.equal(estimated.dpsMicros === 2 * 168900, false);
  const brokenImplemented = forecastHoldingYearDividends(stock([annual, { ...interim, PRETAX_BONUS_RMB: null }]), '2026-10-21');
  assert.equal(brokenImplemented.dpsMicros, undefined);
  assert.deepEqual(brokenImplemented.incompleteReportDates, ['2027-06-30']);
});

test('an undisclosed annual amount uses last annual period, never doubles the latest interim', () => {
  const priorAnnual = { ...annual, REPORT_DATE: '2024-12-31', NOTICE_DATE: '2025-04-01', PLAN_NOTICE_DATE: '2025-04-01', EX_DIVIDEND_DATE: '2025-07-01', EQUITY_RECORD_DATE: '2025-06-30', PRETAX_BONUS_RMB: 1.25 };
  const pendingAnnual = { ...annual, PRETAX_BONUS_RMB: null, ASSIGN_PROGRESS: '董事会预案', NOTICE_DATE: '2026-03-28', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null };
  const s = stock([priorAnnual, oldInterim, pendingAnnual], '2026-04-01');
  const f = forecastHoldingYearDividends(s, '2026-04-01', 1000);
  const estimate = f.events.find(event => event.reportDate === '2025-12-31')!;
  assert.equal(effectiveDps(s), undefined);
  assert.equal(f.dpsMicros, 266400);
  assert.equal(f.amountMinor, 26640);
  assert.equal(estimate.dpsMicros, 125000);
  assert.equal(estimate.basisReportDate, '2024-12-31');
  assert.equal(estimate.amountUnannounced, true);
  assert.equal(estimate.dpsMicros === 2 * 141400, false);
});

test('later disclosure replaces the matching same-period estimate without changing other periods', () => {
  const pending = { ...interim, PRETAX_BONUS_RMB: null, NOTICE_DATE: '2026-08-29', ASSIGN_PROGRESS: '董事会预案', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null };
  const disclosed = { ...pending, PRETAX_BONUS_RMB: 1.7, NOTICE_DATE: '2026-10-22', ASSIGN_PROGRESS: '股东大会决议通过' };
  const f = forecastHoldingYearDividends(stock([annual, oldInterim, pending, disclosed], '2026-10-22'), '2026-10-22');
  assert.equal(f.dpsMicros, 338900);
  assert.equal(f.announcedDpsMicros, 170000);
  assert.equal(f.historicalDpsMicros, 168900);
  assert.equal(f.events.filter(event => event.reportDate === '2026-06-30').length, 1);
  const event = f.events.find(item => item.reportDate === '2026-06-30')!;
  assert.equal(event.basis, 'announced');
  assert.equal(event.basisReportDate, undefined);
  assert.equal(event.amountUnannounced, undefined);
});

test('unknown amount stays incomplete without exact last-year implemented recurring evidence', () => {
  const pending = { ...interim, PRETAX_BONUS_RMB: null, NOTICE_DATE: '2026-08-29', ASSIGN_PROGRESS: '董事会预案', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null };
  for (const prior of [undefined,
    { ...oldInterim, REPORT_DATE: '2024-06-30', NOTICE_DATE: '2024-08-29', EX_DIVIDEND_DATE: '2024-12-15', EQUITY_RECORD_DATE: '2024-12-12' },
    { ...oldInterim, ASSIGN_PROGRESS: '董事会预案' },
    { ...oldInterim, IMPL_PLAN_PROFILE: '一次性特别分红' },
    { ...oldInterim, PRETAX_BONUS_RMB: null }]) {
    const f = forecastHoldingYearDividends(stock([annual, pending, ...(prior ? [prior] : [])]), '2026-10-21');
    assert.equal(f.dpsMicros, undefined);
    assert.equal(f.missingReason, 'amount-unannounced');
    assert.deepEqual(f.incompleteReportDates, ['2026-06-30']);
  }
  const special = forecastHoldingYearDividends(stock([annual, oldInterim, { ...pending, IMPL_PLAN_PROFILE: '特别分红' }]), '2026-10-21');
  assert.equal(special.dpsMicros, undefined);
});

test('a prior reporting period with several payments is summed once for one unknown current announcement', () => {
  const extra = { ...oldInterim, NOTICE_DATE: '2026-01-15', EX_DIVIDEND_DATE: '2026-02-01', EQUITY_RECORD_DATE: '2026-01-30', PRETAX_BONUS_RMB: 0.2 };
  const pending = { ...interim, PRETAX_BONUS_RMB: null, NOTICE_DATE: '2026-08-29', ASSIGN_PROGRESS: '董事会预案', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null };
  const f = forecastHoldingYearDividends(stock([annual, oldInterim, extra, pending]), '2026-10-21');
  assert.equal(f.events.find(event => event.reportDate === '2026-06-30')?.dpsMicros, 161400);
  assert.equal(f.dpsMicros, 330300);
  const secondPending = { ...pending, EX_DIVIDEND_DATE: '2027-02-01', EQUITY_RECORD_DATE: '2027-01-30', NOTICE_DATE: '2026-10-20' };
  const firstPending = { ...pending, EX_DIVIDEND_DATE: '2026-12-15', EQUITY_RECORD_DATE: '2026-12-12' };
  const ambiguous = forecastHoldingYearDividends(stock([annual, oldInterim, extra, firstPending, secondPending]), '2026-10-21');
  assert.equal(ambiguous.dpsMicros, undefined);
});

test('zero/non-distribution is real zero, not missing data and not the previous interim amount', () => {
  const zero = { ...interim, PRETAX_BONUS_RMB: null, ASSIGN_PROGRESS: '董事会预案', IMPL_PLAN_PROFILE: '不分配不转增', NOTICE_DATE: '2026-08-29', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null };
  const s = stock([oldInterim, zero]);
  assert.equal(effectiveDps(s), 0);
  assert.equal(latestReportDividend(s)?.stage, 'none');
  // No interim dividend is not evidence that a whole year's dividends are zero.
  assert.equal(forecastHoldingYearDividends(s, '2026-10-21').dpsMicros, undefined);
});

test('revised and cancelled plans replace older versions with one period, never double-count', () => {
  const proposal = { ...interim, ASSIGN_PROGRESS: '董事会预案', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null, NOTICE_DATE: '2026-08-29', PRETAX_BONUS_RMB: 2 };
  const revised = { ...proposal, NOTICE_DATE: '2026-09-20', PRETAX_BONUS_RMB: 1.5, ASSIGN_PROGRESS: '股东大会决议通过' };
  const cancel = { ...revised, NOTICE_DATE: '2026-10-20', PRETAX_BONUS_RMB: null, ASSIGN_PROGRESS: '取消分配' };
  const s = stock([proposal, proposal, revised, cancel, oldInterim]);
  assert.equal(s.dividend.announcements?.length, 2);
  assert.equal(latestReportDividend(s)?.stage, 'cancelled');
  assert.equal(effectiveDps(s), 0);
  assert.equal(forecastHoldingYearDividends(s, '2026-10-21').dpsMicros, undefined);
  const beforeCancel = stock([proposal, revised, cancel, oldInterim], '2026-10-19');
  assert.equal(effectiveDps(beforeCancel), 150000);
});

test('future report/announcement and absent disclosure date never leak into current display', () => {
  const futureNotice = { ...interim, NOTICE_DATE: '2026-10-22' };
  const unpublished = { ...interim, REPORT_DATE: '2026-12-31', NOTICE_DATE: '2026-10-01' };
  const noDate = { ...interim, NOTICE_DATE: undefined, PLAN_NOTICE_DATE: undefined };
  const s = stock([annual, futureNotice, unpublished, noDate]);
  assert.equal(effectiveDps(s), 168900);
  assert.equal(s.dividend.announcements?.length, 1);
  const futurePublication = { ...interim, NOTICE_DATE: '2026-03-28', PLAN_NOTICE_DATE: '2026-03-28', PUBLISH_DATE: '2026-10-22' };
  assert.equal(stock([futurePublication]).dividend.announcements?.length, 0);
});

test('legacy Excel cache is accepted but must be refreshed before latest report or annual forecast', () => {
  const s = { ...defaultDividendStocks()[0], dividend: { asOf: '2026-10-20', windowStart: '2025-10-20', dpsMicros: 9990000, payments: [], fetchedAt: 1 } };
  assert.ok(isDividendStock(s));
  assert.equal(effectiveDps(s), undefined);
  assert.equal(latestReportDividend(s), undefined);
  assert.equal(forecastHoldingYearDividends(s, '2026-10-21').missingReason, 'refresh-required');
  s.manualDpsMicros = 350000;
  assert.equal(effectiveDps(s), undefined);
  assert.equal(latestReportDividend(s), undefined);
  assert.equal(gridAnnualDps(s), 350000);
  assert.equal(forecastHoldingYearDividends(s, '2026-10-21').dpsMicros, undefined);
});

test('annual grid numerator never uses one interim amount and explicit prices survive incomplete data', () => {
  const s = stock([annual, oldInterim, interim]);
  assert.equal(gridAnnualDps(s, '2026-10-21'), 320000);
  assert.equal(effectiveDps(s), 151100);
  assert.equal(buildGrid(s, 100000, 0, 'buy', '2026-10-21')[0].priceMinor, 640);
  s.manualDpsMicros = 500000;
  assert.equal(buildGrid(s, 100000, 0, 'buy', '2026-10-21')[0].priceMinor, 1000);
  assert.equal(effectiveDps(s), 151100);
  const incomplete = stock([{ ...interim, PRETAX_BONUS_RMB: null, ASSIGN_PROGRESS: '预披露', EX_DIVIDEND_DATE: null, EQUITY_RECORD_DATE: null }]);
  assert.equal(buildGrid(incomplete, 100000, 0, 'buy', '2026-10-21')[0].priceMinor, undefined);
  incomplete.buyLevels = [{ yieldBps: 500, portionBps: 10000, priceMinor: 700 }];
  assert.equal(buildGrid(incomplete, 100000, 0, 'buy', '2026-10-21')[0].priceMinor, 700);
  assert.equal(buildGrid(incomplete, 100000, 0, 'buy', '2026-10-21')[0].displayYieldBps, undefined);
});

test('expired seasons are not rolled forward indefinitely; empty source is unknown', () => {
  const expired = { ...annual, REPORT_DATE: '2020-12-31', NOTICE_DATE: '2021-06-01', PLAN_NOTICE_DATE: '2021-03-01', EX_DIVIDEND_DATE: '2021-06-10' };
  assert.equal(forecastHoldingYearDividends(stock([expired]), '2026-10-21').dpsMicros, undefined);
  assert.equal(forecastHoldingYearDividends(stock([{ ...expired, PRETAX_BONUS_RMB: 0, ASSIGN_PROGRESS: '不分配' }]), '2026-10-21').dpsMicros, undefined);
  assert.equal(forecastHoldingYearDividends(stock([]), '2026-10-21').missingReason, 'no-history');
});

test('cash payment dates are merged by symbol and ex-date and govern receipt horizon', () => {
  const s = stock([annual, interim]);
  s.dividend = enrichDividendPaymentDates(s.dividend, { fhyx: [{ SECURITY_CODE: '601398', NOTICE_DATE: '2026-10-15', EX_DIVIDEND_DATE: '2026-10-21', PAY_CASH_DATE: '2026-10-22' }] }, '601398', 200);
  assert.equal(latestReportDividend(s)?.paymentDate, '2026-10-22');
  assert.equal(s.dividend.scheduleFetchedAt, 200);
  const f = forecastHoldingYearDividends(s, '2026-10-21');
  assert.ok(f.events.every(e => e.expectedPaymentDate !== '2027-10-22'));
  assert.equal(f.dpsMicros, 168900);
  assert.throws(() => enrichDividendPaymentDates(s.dividend, { fhyx: [{ SECURITY_CODE: '000001' }] }, '601398'), /SYMBOL_MISMATCH/);
  assert.throws(() => enrichDividendPaymentDates(s.dividend, {}, '601398'), /SCHEDULE_INVALID/);
});

test('leap-year and cross-year schedules stay within a calendar holding year', () => {
  const leap = { ...annual, REPORT_DATE: '2023-12-31', NOTICE_DATE: '2024-02-20', PLAN_NOTICE_DATE: '2024-02-20', EX_DIVIDEND_DATE: '2024-02-29', EQUITY_RECORD_DATE: '2024-02-28', PRETAX_BONUS_RMB: 1 };
  const f = forecastHoldingYearDividends(stock([leap], '2024-02-29'), '2024-02-29', 100);
  assert.equal(f.through, '2025-02-28');
  assert.equal(f.events[0].expectedExDate, '2025-02-28');
  assert.equal(f.amountMinor, 1000);
  assert.throws(() => forecastHoldingYearDividends(stock([]), '2026-02-30'), /INVALID_DIVIDEND_FORECAST/);
});

test('captured primary-source fixture verifies report versus forecast and official payment dates', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-forecast-icbc-2026-10-21.json', import.meta.url), 'utf8'));
  const dividend = enrichDividendPaymentDates(parseDividendResponse(fixture.report, '601398', '2026-10-21', 1), fixture.schedule, '601398', 2);
  const s = { ...defaultDividendStocks()[0], dividend };
  assert.equal(effectiveDps(s), 151100);
  assert.equal(latestReportDividend(s)?.recordDate, '2026-10-20');
  assert.equal(latestReportDividend(s)?.exDate, '2026-10-21');
  assert.equal(latestReportDividend(s)?.paymentDate, '2026-10-21');
  assert.equal(forecastHoldingYearDividends(s, '2026-10-21', 1000).amountMinor, 32000);
});

test('captured CMB policy with unknown interim amount uses prior interim plus separate annual, never annual times two', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-forecast-cmb-2026-10-22.json', import.meta.url), 'utf8'));
  const dividend = parseDividendResponse(fixture.report, '600036', '2026-10-22', 1);
  const s = { ...defaultDividendStocks()[0], code: '600036', name: '招商银行', dividend };
  assert.equal(latestReportDividend(s)?.reportDate, '2026-06-30');
  assert.equal(effectiveDps(s), undefined);
  const f = forecastHoldingYearDividends(s, '2026-10-22', 1000);
  assert.equal(f.dpsMicros, 2016000);
  assert.equal(f.amountMinor, 201600);
  assert.equal(f.announcedDpsMicros, 0);
  assert.deepEqual(f.incompleteReportDates, []);
  assert.deepEqual(f.events.map(event => [event.reportDate, event.dpsMicros, event.basisReportDate, event.amountUnannounced]), [
    ['2026-06-30', 1013000, '2025-06-30', true], ['2026-12-31', 1003000, '2025-12-31', undefined],
  ]);
});

test('ordinary and special distributions in one report remain separate events and aggregate once', () => {
  const special={...annual,NOTICE_DATE:'2026-08-01',EX_DIVIDEND_DATE:'2026-08-10',EQUITY_RECORD_DATE:'2026-08-09',PRETAX_BONUS_RMB:1};
  const s=stock([annual,special]);assert.equal(s.dividend.announcements!.length,2);assert.equal(effectiveDps(s),268900);
  const f=forecastHoldingYearDividends(s,'2026-10-21');assert.equal(f.events.length,2);assert.equal(f.dpsMicros,268900);
  assert.equal(new Set(f.events.map(e=>e.expectedExDate)).size,2);
});
test('implemented records lacking entitlement dates and malformed numeric amounts never create invented income', () => {
  const s=stock([{...interim,EX_DIVIDEND_DATE:null,EQUITY_RECORD_DATE:null}]);
  assert.equal(forecastHoldingYearDividends(s,'2026-10-21').dpsMicros,undefined);
  assert.equal(forecastHoldingYearDividends(s,'2026-10-21').events.length,0);
  for (const amount of [true,false,1e308,'1x',{}]) assert.throws(()=>stock([{...interim,PRETAX_BONUS_RMB:amount}]),/AMOUNT_INVALID/);
});

test('an unscheduled cancellation suppresses an older dated proposal, and explicit special dividends are not extrapolated', () => {
  const proposed={...interim,ASSIGN_PROGRESS:'董事会预案',NOTICE_DATE:'2026-08-29'};
  const cancelled={...proposed,NOTICE_DATE:'2026-10-20',ASSIGN_PROGRESS:'取消分配',PRETAX_BONUS_RMB:null,EX_DIVIDEND_DATE:null,EQUITY_RECORD_DATE:null};
  const s=stock([proposed,cancelled]);assert.equal(effectiveDps(s),0);assert.equal(forecastHoldingYearDividends(s,'2026-10-21').announcedDpsMicros,0);
  const special={...annual,NOTICE_DATE:'2026-08-01',EX_DIVIDEND_DATE:'2026-08-10',EQUITY_RECORD_DATE:'2026-08-09',PRETAX_BONUS_RMB:1,IMPL_PLAN_PROFILE:'特别分红10派1元'};
  const f=forecastHoldingYearDividends(stock([annual,special]),'2026-10-21');assert.equal(f.events.length,1);assert.equal(f.dpsMicros,168900);
});
