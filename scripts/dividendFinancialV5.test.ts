import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { reviewDividendFinancialSector, type DividendBankReportEvidence } from '../src/lib/dividendFinancialSector.ts';
import { defaultDividendSelectionPrinciples, evaluateDividendResearch, parseDividendFinancialResearch, type DividendStockResearch } from '../src/lib/dividendResearch.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const asOf = '2026-10-29';
const annual = { SECURITY_CODE: '000001', SECURITY_NAME_ABBR: 'Test bank', ORG_TYPE: '银行', REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-03-21',
  ROEJQ: 10, NET_INTEREST_MARGIN: 1.8, EPSJB: 2, NEWCAPITALADER: 13.5, HXYJBCZL: 10, NONPERLOAN: 1.2, BLDKBBL: 200 };
const current = { ...annual, REPORT_DATE: '2026-09-30', NOTICE_DATE: '2026-10-24', ROEJQ: 8.1, TOTALOPERATEREVETZ: -1, PARENTNETPROFITTZ: -2 };
const prior = { ...annual, REPORT_DATE: '2025-09-30', NOTICE_DATE: '2025-10-24', NET_INTEREST_MARGIN: 1.85 };
const rows = [current, annual, prior];
const envelope = (data: Record<string, unknown>[]) => ({ success: true, result: { data } });
const evidence = (reportDate: string, values: Partial<DividendBankReportEvidence>): DividendBankReportEvidence => ({
  code: '000001', reportDate, publishedAt: reportDate === '2026-09-30' ? '2026-10-24' : reportDate === '2025-12-31' ? '2026-03-21' : reportDate === '2025-09-30' ? '2025-10-24' : '2025-03-21',
  verifiedAt: '2026-10-29', sourceUrls: ['https://example.com/verified-original-bank-report.pdf'], verified: true, ...values,
});
const complete = () => [
  evidence('2026-09-30', { specialMentionLoansBps: 150, overdue90DaysLoansMinor: 80000, nonPerformingLoansMinor: 100000 }),
  evidence('2025-09-30', { specialMentionLoansBps: 170 }),
  evidence('2025-12-31', { payoutBps: 3000, riskWeightedAssetsMinor: 1050000 }),
  evidence('2024-12-31', { riskWeightedAssetsMinor: 1000000 }),
];

test('annual screens use completed annual ROE while quarterly display annualises its actual cumulative period once', () => {
  const financial = parseDividendFinancialResearch(envelope([
    current, { ...current, REPORT_DATE: '2026-06-30', ROEJQ: 5.22 }, { ...current, REPORT_DATE: '2026-03-31', ROEJQ: 2.83 }, annual,
  ]), '000001', asOf);
  assert.equal(financial.latest.roeBps, 810, 'keep the reported nine-month source observation');
  assert.equal(financial.latest.annualizedRoeBps, 1080);
  assert.equal(financial.latest.roeBasis, 'annualised_ytd');
  assert.equal(financial.latest.roePeriodMonths, 9);
  assert.equal(financial.periods[1].annualizedRoeBps, 1044);
  assert.equal(financial.periods[2].annualizedRoeBps, 1132);
  assert.equal(financial.annual?.annualizedRoeBps, 1000);
  assert.equal(financial.annual?.roeBasis, 'annual');
  const stock: DividendStockResearch = { code: '000001', name: 'Test bank', financial, checks: [], status: 'unknown', sources: [], issues: [] };
  const result = evaluateDividendResearch(stock, { ...defaultDividendSelectionPrinciples(), minRoeBps: 1050 }, Date.parse(`${asOf}T00:00:00Z`));
  assert.equal(result.checks.find(check => check.rule === 'roe')?.value, 1000, 'the higher annualised quarter must not replace the annual screen');
  assert.equal(result.checks.find(check => check.rule === 'roe')?.status, 'risk');
});

test('new growth defaults flag shrinkage while explicitly saved negative thresholds remain effective', () => {
  const defaults = defaultDividendSelectionPrinciples();
  assert.equal(defaults.minRevenueGrowthBps, 0); assert.equal(defaults.minProfitGrowthBps, 0);
  const stock: DividendStockResearch = { code: '000001', name: 'Test bank', financial: parseDividendFinancialResearch(envelope(rows), '000001', asOf), checks: [], status: 'unknown', sources: [], issues: [] };
  const currentChecks = evaluateDividendResearch(stock, defaults, Date.parse(`${asOf}T00:00:00Z`)).checks;
  assert.equal(currentChecks.find(check => check.rule === 'revenueGrowth')?.status, 'risk');
  assert.equal(currentChecks.find(check => check.rule === 'profitGrowth')?.status, 'risk');
  const savedChecks = evaluateDividendResearch(stock, { ...defaults, minRevenueGrowthBps: -1000, minProfitGrowthBps: -1000 }, Date.parse(`${asOf}T00:00:00Z`)).checks;
  assert.equal(savedChecks.find(check => check.rule === 'revenueGrowth')?.status, 'pass');
  assert.equal(savedChecks.find(check => check.rule === 'profitGrowth')?.status, 'pass');
});

test('bank reviews retain real net interest margins and never turn total overdue loans or implied RWA into verified specialist evidence', () => {
  const review = reviewDividendFinancialSector(rows.map(row => ({ ...row, OVERDUE_LOANS: 80000, NON_PERFORMING_LOAN: 100000, NZBJE: 5000000 })), '000001', asOf)!;
  const margin = review.metrics.find(metric => metric.key === 'netInterestMargin')!;
  assert.equal(margin.valueBps, 180); assert.equal(margin.thresholdBps, 185); assert.equal(margin.status, 'risk');
  assert.equal(margin.comparisonReportDate, '2025-09-30');
  for (const key of ['specialMentionLoans', 'overdue90DaysDeviation', 'internalCapitalCapacity']) {
    assert.equal(review.metrics.find(metric => metric.key === key)?.status, 'unknown');
    assert.ok(review.missing.includes(key));
  }
});

test('verified same-period bank observations calculate classification coverage and retained annual capital against actual RWA growth', () => {
  const review = reviewDividendFinancialSector(rows, '000001', asOf, complete())!;
  assert.equal(review.metrics.find(metric => metric.key === 'specialMentionLoans')?.status, 'pass');
  assert.equal(review.metrics.find(metric => metric.key === 'specialMentionLoans')?.thresholdBps, 170);
  assert.equal(review.metrics.find(metric => metric.key === 'overdue90DaysDeviation')?.valueBps, 8000);
  assert.equal(review.metrics.find(metric => metric.key === 'overdue90DaysDeviation')?.status, 'pass');
  const capital = review.metrics.find(metric => metric.key === 'internalCapitalCapacity')!;
  assert.equal(capital.valueBps, 700); assert.equal(capital.thresholdBps, 500); assert.equal(capital.status, 'pass');
  assert.deepEqual(capital.capitalInputs, { roeBps: 1000, payoutBps: 3000, rwaGrowthBps: 500, priorReportDate: '2024-12-31' });
  assert.equal(capital.reportDate, '2025-12-31');
  assert.deepEqual(review.missing, []);
  assert.equal(review.status, 'risk', 'declining margin still remains a separate risk');
});

test('bank evidence from another issuer, unverified/future announcements and conflicting values cannot create a passing calculation', () => {
  const values = complete();
  values[0] = { ...values[0], code: '600036' };
  values[2] = { ...values[2], verified: false };
  const review = reviewDividendFinancialSector(rows, '000001', asOf, values)!;
  assert.equal(review.metrics.find(metric => metric.key === 'overdue90DaysDeviation')?.status, 'unknown');
  assert.equal(review.metrics.find(metric => metric.key === 'internalCapitalCapacity')?.status, 'unknown');
  const future = complete().map(value => ({ ...value, verifiedAt: '2026-10-30' }));
  assert.equal(reviewDividendFinancialSector(rows, '000001', asOf, future)?.metrics.find(metric => metric.key === 'internalCapitalCapacity')?.status, 'unknown');
  const conflict = [...complete(), evidence('2025-12-31', { payoutBps: 5000 })];
  const conflicting = reviewDividendFinancialSector(rows, '000001', asOf, conflict)!;
  assert.equal(conflicting.metrics.find(metric => metric.key === 'internalCapitalCapacity')?.status, 'unknown');
  assert.ok(conflicting.missing.includes('bankReportConflict'));
});

test('internal capital comparison uses exact ratios even when displayed rounded rates coincide', () => {
  const values = complete(); values[2] = evidence('2025-12-31', { payoutBps: 4000, riskWeightedAssetsMinor: 1060080 });
  const review = reviewDividendFinancialSector(rows.map(row => row.REPORT_DATE === '2025-12-31' ? { ...row, ROEJQ: 10.01 } : row), '000001', asOf, values)!;
  const capital = review.metrics.find(metric => metric.key === 'internalCapitalCapacity')!;
  assert.equal(capital.valueBps, 601); assert.equal(capital.thresholdBps, 601);
  assert.equal(capital.status, 'risk', '600.6bp retained return cannot fund 600.8bp actual RWA expansion');
});
