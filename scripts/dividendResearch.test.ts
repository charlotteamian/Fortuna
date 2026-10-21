import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import {
  defaultDividendSelectionPrinciples, dividendResearchReadableSnapshot, evaluateDividendResearch, isDividendSelectionPrinciples,
  parseDividendDistributionResearch, parseDividendFinancialResearch, parseDividendResearchCodes,
  parseDividendTechnicalResearch, type DividendStockResearch,
} from '../src/lib/dividendResearch.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const now = new Date('2026-10-21T08:00:00Z').getTime();
const principles = defaultDividendSelectionPrinciples();
const liveFixtures = JSON.parse(readFileSync(new URL('./fixtures/dividend-research-sources.json', import.meta.url), 'utf8')).fixtures;
const envelope = (data: Record<string, unknown>[]) => ({ success: true, result: { pages: 1, data } });
function financialRow(overrides: Record<string, unknown> = {}) {
  return { SECURITY_CODE: '600036', SECURITY_NAME_ABBR: 'Fixture company', ORG_TYPE: '一般企业',
    REPORT_DATE: '2026-06-30 00:00:00', NOTICE_DATE: '2026-08-30 00:00:00',
    TOTALOPERATEREVETZ: 5, PARENTNETPROFITTZ: 7, ROEJQ: 6, ZCFZL: 40,
    NETCASH_OPERATE_PK: 150, PARENTNETPROFIT: 100, EPSJB: 1, ...overrides };
}
function research(overrides: Partial<DividendStockResearch> = {}): DividendStockResearch {
  return { code: '600036', name: 'Fixture', checks: [], status: 'unknown', sources: [], issues: [], ...overrides };
}
function dividendRow(report: string, exDate: string, bonus = 5) {
  return { SECURITY_CODE: '600036', REPORT_DATE: report, EX_DIVIDEND_DATE: exDate,
    PRETAX_BONUS_RMB: bonus, ASSIGN_PROGRESS: '实施' };
}

test('principles are bounded integer configuration and code input cannot inject a source query', () => {
  assert.equal(isDividendSelectionPrinciples(principles), true);
  assert.equal(isDividendSelectionPrinciples({ ...principles, minYieldBps: 1.5 }), false);
  assert.equal(isDividendSelectionPrinciples({ ...principles, maxPayoutBps: -1 }), false);
  assert.equal(isDividendSelectionPrinciples({ ...principles, notes: 'a'.repeat(4001) }), false);
  assert.deepEqual(parseDividendResearchCodes('600036，SZ000001 600036'), ['600036', '000001']);
  assert.throws(() => parseDividendResearchCodes('600036)(REPORT_DATE>0)'));
  assert.throws(() => parseDividendResearchCodes('512890'));
});

test('technical acceleration compares two separate five-day windows and requires an established fall', () => {
  const closes = Array.from({ length: 60 }, (_, i) => i < 50 ? 12 - i * 0.015 : i < 55 ? 11.25 - (i - 50) * 0.04 : 11.05 - (i - 55) * 0.22);
  const rows = closes.map((close, i) => [new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), String(close), String(close), String(close), String(close)]);
  const parsed = parseDividendTechnicalResearch({ code: 0, data: { sh600036: { qfqday: rows } } }, '600036', 'sh600036', now);
  assert.throws(() => parseDividendTechnicalResearch({ code: 0, data: { sh600036: { qfqday: rows.slice(-31) } } }, '600036', 'sh600036', now), /HISTORY_INCOMPLETE/);
  assert.equal(parsed.state, 'accelerating_down');
  assert.equal(parsed.pacing, 'pause_add');
  assert.ok(parsed.change5Percent < parsed.previous5Percent - 1);
  assert.equal(parsed.priceBasis, 'qfq');
  const rising = rows.map((row, i) => [row[0], String(10 + i / 10), String(10 + i / 10), String(10 + i / 10), String(10 + i / 10)]);
  assert.equal(parseDividendTechnicalResearch({ code: 0, data: { sh000300: { day: rising } } }, '000300', 'sh000300', now).state, 'rising');
});

test('captured Tencent and Eastmoney responses preserve verified field meaning for banks, companies and indices', () => {
  const bank = parseDividendFinancialResearch(liveFixtures.bankFinancial.data, '600036', '2026-10-21');
  const company = parseDividendFinancialResearch(liveFixtures.industrialFinancial.data, '000333', '2026-10-21');
  assert.equal(bank.name, '招商银行');
  assert.equal(bank.financialSector, true);
  assert.equal(bank.latest.noticeDate, '2026-08-29');
  assert.equal(bank.latest.debtAssetBps, 9018);
  assert.equal(company.financialSector, false);
  assert.equal(company.latest.profitGrowthBps, 166);
  const distributions = parseDividendDistributionResearch(liveFixtures.bankDistributions.data, '600036', '2026-10-21');
  assert.equal(distributions.annualDpsMicros['2025'], 2016000);
  assert.equal(distributions.dpsMicros, 2016000);
  const index = parseDividendTechnicalResearch(liveFixtures.indexDaily.data, '000300', 'sh000300', now);
  assert.equal(index.priceBasis, 'index');
  assert.equal(index.asOf, '2026-10-21');
  assert.equal(index.currentUsable, true);
});

test('dated technical series stays historical, cannot establish a current yield trigger, and future series is rejected', () => {
  const technical = parseDividendTechnicalResearch(liveFixtures.indexDaily.data, '000300', 'sh000300', now + 11 * 86400000);
  assert.equal(technical.currentUsable, false);
  const checked = evaluateDividendResearch(research({ technical, yieldBps: 600 }), principles, now + 11 * 86400000);
  assert.equal(checked.checks.find(check => check.rule === 'yield')?.status, 'unknown');
  const readable = dividendResearchReadableSnapshot({ generatedAt: now, principles, stocks: [checked], indices: [] });
  const position = readable['Stocks actually downloaded or explicitly deferred'][0]['Daily technical position'];
  assert.match(position!['Current technical reading'], /Unknown/);
  assert.match(position!['Pacing suggestion'], /Wait for recent daily data/);
  assert.throws(() => parseDividendTechnicalResearch(liveFixtures.indexDaily.data, '000300', 'sh000300', now - 86400000));
});

test('readable research converts percentage and money units, preserves URLs, and marks custom criteria unverified', () => {
  const financial = parseDividendFinancialResearch(liveFixtures.bankFinancial.data, '600036', '2026-10-21');
  const data = evaluateDividendResearch(research({ financial, yieldBps: 500,
    sources: [{ kind: 'financial', provider: 'Eastmoney', url: liveFixtures.bankFinancial.url, fetchedAt: now, asOf: financial.latest.reportDate }] }), principles, now);
  const readable = dividendResearchReadableSnapshot({ generatedAt: now, principles: { ...principles, notes: 'Exclude uncertain governance' }, stocks: [data], indices: [] });
  const text = JSON.stringify(readable);
  assert.doesNotMatch(text, /minYieldBps|epsMicros|lastCloseMinor/);
  assert.equal(readable['Editable screening principles']['Minimum trailing cash dividend yield percent'], 4);
  assert.equal(readable['Editable screening principles']['Additional personal screening criteria automatically verified'], false);
  assert.equal(readable['Stocks actually downloaded or explicitly deferred'][0]['Latest cumulative report']!['Basic earnings per share in CNY'], 2.98);
  assert.ok(text.includes(liveFixtures.bankFinancial.url));
  assert.match(text, /No original financial-report text/);
});

test('financial periods use actual publication dates, retain quarterly metrics and use annual ROE for the annual rule', () => {
  const financial = parseDividendFinancialResearch(envelope([
    financialRow({ REPORT_DATE: '2026-09-30', NOTICE_DATE: '2026-10-28', ROEJQ: 99 }),
    financialRow(), financialRow({ REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-03-30', ROEJQ: 12, EPSJB: 2 }),
  ]), '600036', '2026-10-21');
  assert.equal(financial.periods.length, 2);
  assert.equal(financial.latest.reportDate, '2026-06-30');
  assert.equal(financial.latest.roeBps, 600);
  assert.equal(financial.annual?.roeBps, 1200);
  assert.equal(financial.latest.cashProfitBps, 15000);
  const evaluated = evaluateDividendResearch(research({ financial }), principles, now);
  assert.equal(evaluated.checks.find(check => check.rule === 'roe')?.status, 'pass');
  assert.throws(() => parseDividendFinancialResearch(envelope([financialRow({ SECURITY_CODE: '000001' })]), '600036'));
});

test('only implemented dated cash dividends count, duplicate events and proposed distributions do not', () => {
  const distributions = parseDividendDistributionResearch(envelope([
    dividendRow('2025-12-31', '2026-06-01'), dividendRow('2025-12-31', '2026-06-01'),
    dividendRow('2024-12-31', '2025-06-01'), dividendRow('2023-12-31', '2024-06-01'),
    { ...dividendRow('2026-06-30', '2026-11-01', 20), ASSIGN_PROGRESS: '董事会预案' },
  ]), '600036', '2026-10-21');
  assert.equal(distributions.dpsMicros, 500000);
  assert.equal(distributions.annualDpsMicros['2025'], 500000);
  assert.equal(distributions.consecutiveYears, 3);
  assert.equal(distributions.latestCompletedYear, 2025);
  const incomplete = { success: true, result: { pages: 2, data: [] } };
  assert.throws(() => parseDividendDistributionResearch(incomplete, '600036'));
});

test('matching report-year dividends and EPS establish payout, missing reports never produce a pass', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow(), financialRow({ REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-03-30', ROEJQ: 12, EPSJB: 2 })]), '600036', '2026-10-21');
  const distributions = parseDividendDistributionResearch(envelope([
    dividendRow('2025-12-31', '2026-06-01'), dividendRow('2024-12-31', '2025-06-01'), dividendRow('2023-12-31', '2024-06-01'),
    dividendRow('2022-12-31', '2023-06-01'), dividendRow('2021-12-31', '2022-06-01'),
  ]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial, distributions, yieldBps: 500 }), principles, now);
  assert.equal(result.status, 'pass');
  assert.equal(result.checks.find(check => check.rule === 'payout')?.value, 2500);
  assert.equal(evaluateDividendResearch(research(), principles, now).status, 'unknown');
  const old = { ...financial, latest: { ...financial.latest, reportDate: '2025-12-31' } };
  assert.equal(evaluateDividendResearch(research({ financial: old, distributions, yieldBps: 500 }), principles, now).status, 'unknown');
});

test('banks are exempt from industrial leverage/cashflow thresholds and explicitly need sector-specific checks', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow({ ORG_TYPE: '银行', ZCFZL: 92, NETCASH_OPERATE_PK: -20 })]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial }), principles, now);
  for (const rule of ['debtAsset', 'cashProfit', 'financialSector']) {
    const check = result.checks.find(item => item.rule === rule);
    assert.equal(check?.status, 'unknown');
    assert.equal(check?.reason, 'sector_specific');
  }
});

test('confirmed fundamental breaches remain separate from technical market timing', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow({ PARENTNETPROFITTZ: -25 })]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial }), principles, now);
  assert.equal(result.status, 'risk');
  assert.equal(result.checks.find(check => check.rule === 'profitGrowth')?.value, -2500);
});

test('expired financial breaches become unknown and cannot justify removing a plan stock', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow({ REPORT_DATE: '2024-12-31', NOTICE_DATE: '2025-03-30',
    PARENTNETPROFITTZ: -50, TOTALOPERATEREVETZ: -50, ZCFZL: 95, ROEJQ: 1, NETCASH_OPERATE_PK: -100, PARENTNETPROFIT: -100 })]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial }), principles, now);
  assert.equal(result.status, 'unknown');
  for (const rule of ['profitGrowth', 'revenueGrowth', 'debtAsset', 'cashProfit', 'roe', 'payout']) {
    assert.equal(result.checks.find(check => check.rule === rule)?.status, 'unknown');
    assert.equal(result.checks.find(check => check.rule === rule)?.reason, 'stale');
  }
  assert.ok(!result.checks.some(check => check.status === 'risk'));
});

test('research service keeps individual source failures unknown and bounds candidate requests', async () => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError('offline fixture'); };
  try {
    const result = await fetchDividendResearch([{ code: '600036', name: 'First' }, { code: '000001', name: 'Deferred' }], principles, { maxStocks: 1 });
    assert.equal(requests, 15); // Five company feeds, three indices, six treasury pages and one official index workbook.
    assert.equal(result.stocks[0].status, 'unknown');
    assert.equal(result.stocks[0].issues.length, 5);
    assert.ok(result.stocks[0].issues.every(issue => issue.reason === 'request_failed'));
    assert.ok(result.stocks[1].issues.every(issue => issue.reason === 'deferred'));
    assert.equal(result.indices.length, 3);
    assert.ok(result.indices.every(index => !index.technical));
  } finally { globalThis.fetch = originalFetch; }
});
