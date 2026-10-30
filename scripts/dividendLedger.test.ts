import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildDividendLedger, detectDividendLedgerFrequency, dividendLedgerBase, dividendLedgerHistoryDiagnostics,
  parseDividendOfficialAnnouncementText, type DividendOfficialEvent } from '../src/lib/dividendLedger.ts';

const code = '000001', asOf = '2026-10-29';
const officialUrl = 'https://static.cninfo.com.cn/finalpage/2026-06-05/1225352449.PDF';
const row = (report: string, ex: string, cash: number, extra: Record<string, unknown> = {}) => ({ SECURITY_CODE: code, REPORT_DATE: report,
  EX_DIVIDEND_DATE: ex, EQUITY_RECORD_DATE: shift(ex, -1), NOTICE_DATE: shift(ex, -7), PRETAX_BONUS_RMB: cash,
  BONUS_RATIO: 0, IT_RATIO: 0, ASSIGN_PROGRESS: '实施分配', ...extra });
function shift(date: string, offset: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
const payload = (data: Record<string, unknown>[], pages = 1) => ({ success: true, result: { data, pages } });
const official = (value: ReturnType<typeof row>): DividendOfficialEvent => ({ code, reportDate: value.REPORT_DATE, period: value.REPORT_DATE.endsWith('-06-30') ? 'interim' : 'annual',
  announcementDate: value.NOTICE_DATE, recordDate: value.EQUITY_RECORD_DATE, exDate: value.EX_DIVIDEND_DATE,
  cashPer10Micros: Math.round(value.PRETAX_BONUS_RMB * 1e6), bonusPer10Bps: Number(value.BONUS_RATIO) * 1000, transferPer10Bps: Number(value.IT_RATIO) * 1000,
  sourceUrl: officialUrl, verifiedAt: asOf });
const semiRows = () => [row('2026-06-30', '2026-09-24', 2.49), row('2025-12-31', '2026-06-12', 3.6), row('2025-06-30', '2025-10-15', 2.36)];
const build = (rows: ReturnType<typeof row>[], events = rows.map(official), at = asOf) => buildDividendLedger(payload(rows), code, at, { officialEvents: events });

test('verified semiannual events produce the exact latest two batches, distinct from an annual report total', () => {
  const rows = semiRows(), ledger = build([...rows, rows[0]]), base = dividendLedgerBase(ledger, asOf, { epsMicros: 2070000, payoutBps: 2900 });
  assert.equal(ledger.events.length, 3); assert.equal(base.frequency, 'semiannual'); assert.equal(base.requiredBatches, 2);
  assert.equal(base.dpsMicros, 609000); assert.equal(base.verified, true); assert.deepEqual(base.reportPeriods, ['2026-06-30', '2025-12-31']);
  assert.deepEqual(base.flags, []); assert.equal(base.crosscheckDpsMicros, 600300);
  assert.ok(ledger.events.every(event => event.verification === 'verified' && event.sources.length === 2));
});

test('the previous interim batch does not disappear after its anniversary while the next interim remains a proposal', () => {
  const previous = row('2025-06-30', '2025-10-15', 2.36), annual = row('2025-12-31', '2026-06-12', 3.6);
  const future = row('2026-06-30', '2026-11-10', 2.49, { ASSIGN_PROGRESS: '股东大会通过', NOTICE_DATE: '2026-09-17' });
  const ledger = build([future, annual, previous], [annual, previous].map(official));
  const before = dividendLedgerBase(ledger, '2026-10-14'), after = dividendLedgerBase(ledger, '2026-10-16');
  assert.equal(before.dpsMicros, 596000); assert.equal(after.dpsMicros, 596000);
  assert.ok(after.flags.includes('PROPOSAL_NOT_COUNTED')); assert.equal(after.selectedBatchIds.some(id => id.includes('2026-11-10')), false);
});

test('an annual payer uses one latest implemented batch and an ambiguous frequency remains unknown', () => {
  const annuals = [row('2025-12-31', '2026-06-10', 5), row('2024-12-31', '2025-06-10', 4)];
  assert.equal(dividendLedgerBase(build(annuals), asOf).dpsMicros, 500000);
  assert.equal(dividendLedgerBase(build(annuals), asOf).frequency, 'annual');
  const one = build([annuals[0]]); assert.equal(detectDividendLedgerFrequency(one), 'unknown');
  assert.equal(dividendLedgerBase(one, asOf).dpsMicros, undefined); assert.ok(dividendLedgerBase(one, asOf).flags.includes('FREQUENCY_UNKNOWN'));
});

test('semiannual detection requires adjacent complementary fiscal periods in either annual/interim order', () => {
  const interimLatest = [row('2026-06-30', '2026-09-24', 2.49), row('2025-12-31', '2026-06-12', 3.6)];
  const annualLatest = [row('2025-12-31', '2026-06-12', 3.6), row('2025-06-30', '2025-10-15', 2.36)];
  assert.equal(dividendLedgerBase(build(interimLatest), asOf).frequency, 'semiannual');
  assert.equal(dividendLedgerBase(build(interimLatest), asOf).dpsMicros, 609000);
  assert.equal(dividendLedgerBase(build(annualLatest), asOf).frequency, 'semiannual');
  assert.equal(dividendLedgerBase(build(annualLatest), asOf).dpsMicros, 596000);
});

test('a former semiannual payer never adds two full annual distributions into one current base', () => {
  const changedSchedule = [row('2025-12-31', '2026-06-10', 5), row('2024-12-31', '2025-06-10', 4), row('2024-06-30', '2024-10-10', 2)];
  const base = dividendLedgerBase(build(changedSchedule), asOf);
  assert.equal(base.frequency, 'unknown'); assert.equal(base.dpsMicros, undefined); assert.equal(base.verified, false);
  assert.ok(base.flags.includes('FREQUENCY_UNKNOWN')); assert.ok(base.flags.includes('INCOMPLETE'));
});

test('complementary but non-adjacent fiscal periods leave a missing batch explicit instead of summing across a gap', () => {
  const gap = [row('2025-12-31', '2026-06-10', 5), row('2024-06-30', '2024-10-10', 2), row('2023-12-31', '2024-06-10', 4)];
  const base = dividendLedgerBase(build(gap), asOf);
  assert.equal(base.frequency, 'unknown'); assert.equal(base.dpsMicros, undefined); assert.ok(base.flags.includes('FREQUENCY_UNKNOWN'));
});

test('unverified or conflicting latest events cannot silently fall back to older verified batches', () => {
  const rows = semiRows(), incomplete = build(rows, rows.slice(1).map(official));
  const pending = dividendLedgerBase(incomplete, asOf); assert.equal(pending.dpsMicros, undefined); assert.ok(pending.flags.includes('ANNOUNCEMENT_UNVERIFIED'));
  assert.ok(pending.selectedBatchIds[0].includes('2026-09-24'));
  const changed = rows.map(official); changed[0].cashPer10Micros += 10000;
  const conflict = build(rows, changed); assert.equal(conflict.events[0].verification, 'conflict');
  const base = dividendLedgerBase(conflict, asOf); assert.equal(base.dpsMicros, undefined); assert.ok(base.flags.includes('SOURCE_CONFLICT'));
});

test('conflicting provider duplicates and mismatched registration dates are excluded even with an official match', () => {
  const rows = semiRows(); const duplicate = { ...rows[0], PRETAX_BONUS_RMB: 2.5 };
  const ledger = buildDividendLedger(payload([...rows, duplicate]), code, asOf, { officialEvents: rows.map(official) });
  assert.equal(dividendLedgerBase(ledger, asOf).dpsMicros, undefined);
  const dates = rows.map(official); dates[0].recordDate = '2026-09-22';
  assert.equal(build(rows, dates).events[0].verification, 'conflict');
});

test('a provider/announcement ex-date disagreement is one conflicted batch and is never counted twice', () => {
  const rows = semiRows(), off = rows.map(official); off[0].exDate = '2026-09-25'; off[0].recordDate = '2026-09-24';
  const ledger = build(rows, off); assert.equal(ledger.events.length, 3); assert.equal(ledger.events[0].verification, 'conflict');
  assert.equal(dividendLedgerBase(ledger, asOf).dpsMicros, undefined);
});

test('an official implementation can fill absent provider fields but cannot certify another issuer or a future disclosure', () => {
  const rows = semiRows(); const raw = rows.map(value => { const result = { ...value } as Record<string, unknown>; delete result.EQUITY_RECORD_DATE; return result; });
  const ledger = buildDividendLedger(payload(raw), code, asOf, { officialEvents: rows.map(official) });
  assert.equal(dividendLedgerBase(ledger, asOf).dpsMicros, 609000);
  const foreign = rows.map(value => ({ ...official(value), code: '600036' }));
  assert.equal(dividendLedgerBase(build(rows, foreign), asOf).dpsMicros, undefined);
  assert.equal(build(rows, foreign).issues.includes('OFFICIAL_EVIDENCE_INVALID'), true);
});

test('every later effective bonus factor, including the cash event itself, adjusts each historical dividend once', () => {
  const annual = row('2024-12-31', '2025-06-10', 10, { BONUS_RATIO: 8 });
  const interim = row('2025-06-30', '2025-09-10', 2);
  const bonusOnly = row('2025-12-31', '2025-10-10', 0, { IT_RATIO: 5 });
  const ledger = build([bonusOnly, interim, annual]); const base = dividendLedgerBase(ledger, asOf);
  assert.equal(ledger.events.find(event => event.reportDate === '2024-12-31')!.shareFactor, 1.8);
  assert.equal(ledger.events.find(event => event.reportDate === '2024-12-31')!.normalizedDpsMicros, 370370);
  assert.equal(base.latestExDate, '2025-10-10');
  assert.equal(base.dpsMicros, 503703); // 1/(1.8*1.5) + 0.2/1.5; zero-cash action is not a cash batch.
});

test('future capital actions never advance the quote boundary or alter the current-share cash base', () => {
  const rows = semiRows(), future = row('2026-12-31', '2026-12-10', 0, { IT_RATIO: 5, NOTICE_DATE: '2026-10-20' });
  const ledger = build([...rows, future], [...rows.map(official), official(future)]);
  const base = dividendLedgerBase(ledger, asOf); assert.equal(base.latestExDate, '2026-09-24'); assert.equal(base.dpsMicros, 609000);
  assert.throws(() => dividendLedgerBase(ledger, '2026-10-30'), /INVALID_DIVIDEND_LEDGER_DATE/);
});

test('cancelled and explicit non-distribution records are not displayed as pending proposals', () => {
  const rows = semiRows(), cancelled = row('2026-12-31', '2027-06-10', 10, { ASSIGN_PROGRESS: '取消分配', NOTICE_DATE: '2026-10-20' });
  const noDividend = row('2026-09-30', '2026-10-25', 0, { EX_DIVIDEND_DATE: undefined, ASSIGN_PROGRESS: '不分配不转增', NOTICE_DATE: '2026-10-20', EQUITY_RECORD_DATE: undefined });
  const ledger = build([...rows, cancelled, noDividend], rows.map(official));
  assert.equal(ledger.events.find(event => event.reportDate === '2026-12-31')?.stage, 'cancelled');
  assert.equal(ledger.events.find(event => event.reportDate === '2026-09-30')?.stage, 'no_dividend');
  assert.equal(dividendLedgerBase(ledger, asOf).flags.includes('PROPOSAL_NOT_COUNTED'), false);
});

test('missing share-action fields or incomplete source pages prevent a complete cash base', () => {
  const rows = semiRows(), unknown = { ...rows[0] } as Record<string, unknown>; delete unknown.BONUS_RATIO;
  const unverified = buildDividendLedger(payload([unknown, ...rows.slice(1)]), code, asOf, { officialEvents: rows.slice(1).map(official) });
  assert.equal(dividendLedgerBase(unverified, asOf).dpsMicros, undefined);
  const paged = buildDividendLedger(payload(rows, 2), code, asOf, { officialEvents: rows.map(official) });
  assert.ok(dividendLedgerBase(paged, asOf).flags.includes('SOURCE_PAGES_INCOMPLETE'));
});

test('EPS payout crosschecks flag a strict >25% mismatch without replacing the factual cash base', () => {
  const ledger = build(semiRows());
  const base = dividendLedgerBase(ledger, asOf, { epsMicros: 1000000, payoutBps: 1000 });
  assert.equal(base.dpsMicros, 609000); assert.equal(base.verified, false); assert.ok(base.flags.includes('CROSSCHECK_MISMATCH'));
  assert.ok(dividendLedgerBase(ledger, asOf).flags.includes('CROSSCHECK_MISSING'));
  const boundary = dividendLedgerBase(ledger, asOf, { epsMicros: 609000, payoutBps: 7500 });
  assert.equal(boundary.crosscheckDeviationBps, 2500); assert.equal(boundary.flags.includes('CROSSCHECK_MISMATCH'), false);
  const nearBoundary = dividendLedgerBase(ledger, asOf, { epsMicros: 456749, payoutBps: 10000 });
  assert.equal(nearBoundary.crosscheckDeviationBps, 2500); assert.equal(nearBoundary.flags.includes('CROSSCHECK_MISMATCH'), true);
});

test('long price histories report the exact cash-evidence gap, rather than calling their date span insufficient', () => {
  const rows = [];
  for (let year = 2014; year <= 2026; year++) rows.push(row(`${year - 1}-12-31`, `${year}-06-10`, 5));
  const ledger = build(rows, rows.filter(value => value.EX_DIVIDEND_DATE < '2026-01-01').map(official));
  const prices = [];
  for (let year = 2016; year <= 2026; year++) for (let month = 1; month <= 12; month++) {
    const date = `${year}-${String(month).padStart(2, '0')}-28`; if (date < asOf) prices.push({ date, priceMinor: 1000 });
  }
  const coverage = dividendLedgerHistoryDiagnostics(ledger, prices, asOf);
  assert.ok(coverage.priceSampleCount > 100); assert.ok(coverage.sampleCount >= 60); assert.ok(coverage.spanYears >= 4.8);
  assert.ok(coverage.reasons.includes('ANNOUNCEMENT_UNVERIFIED')); assert.ok(coverage.reasons.includes('STALE'));
  assert.equal(coverage.reasons.includes('SAMPLES_INSUFFICIENT'), false); assert.equal(coverage.usable, false);
});

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dividend-official/${name}.json`, import.meta.url), 'utf8'));
test('real Shenzhen implementation PDFs yield the current batch, not the whole-year total or after-tax example', () => {
  const interim = fixture('pingan-2026-interim'), annual = fixture('pingan-2025-final');
  const parsedInterim = parseDividendOfficialAnnouncementText(interim.text, interim)!, parsedAnnual = parseDividendOfficialAnnouncementText(annual.text, annual)!;
  assert.equal(parsedInterim.cashPer10Micros, 2490000); assert.equal(parsedAnnual.cashPer10Micros, 3600000);
  assert.equal(parsedInterim.recordDate, '2026-09-23'); assert.equal(parsedInterim.exDate, '2026-09-24');
  assert.equal(parsedAnnual.recordDate, '2026-06-11'); assert.equal(parsedAnnual.exDate, '2026-06-12');
  assert.deepEqual(Object.keys(parsedInterim).sort(), ['announcementDate', 'bonusPer10Bps', 'cashPer10Micros', 'code', 'exDate', 'period', 'recordDate', 'reportDate', 'sourceUrl', 'transferPer10Bps', 'verifiedAt'].sort());
  const raw = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
  const ledger = buildDividendLedger(raw.sources.distribution.data, code, asOf, { officialEvents: [parsedInterim, parsedAnnual] });
  assert.equal(dividendLedgerBase(ledger, asOf).dpsMicros, 609000);
});

test('real Shanghai cash-only allocation and slash-date table exclude prior interim and annual aggregate amounts', () => {
  const source = fixture('cmb-2025-final'); const parsed = parseDividendOfficialAnnouncementText(source.text, source)!;
  assert.equal(parsed.code, '600036'); assert.equal(parsed.cashPer10Micros, 10030000); // 1.003 per share, not 2.016 annual cash.
  assert.equal(parsed.recordDate, '2026-07-09'); assert.equal(parsed.exDate, '2026-07-10');
  assert.equal(parsed.bonusPer10Bps, 0); assert.equal(parsed.transferPer10Bps, 0);
});

test('unsupported, ambiguous, wrong-code and non-official announcement text stays unverified', () => {
  const source = fixture('pingan-2026-interim');
  assert.equal(parseDividendOfficialAnnouncementText(source.text, { ...source, code: '600036' }), undefined);
  assert.equal(parseDividendOfficialAnnouncementText(source.text, { ...source, sourceUrl: 'https://example.com/not-official.pdf' }), undefined);
  assert.equal(parseDividendOfficialAnnouncementText(source.text.replaceAll('不送红股', '送股方案待定'), source), undefined);
  assert.equal(parseDividendOfficialAnnouncementText(source.text.replaceAll('2026 年 9 月 23 日', '待定'), source), undefined);
});
