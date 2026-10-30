/** Stage 0 audit only. Archived/synthetic facts, no network, fake IndexedDB only.
 * Run: node docs/dividend-stage0/reproduce-pricing.ts
 * Assertions record current behaviour, including confirmed defects; they are not
 * acceptance of the defective behaviour or changes to production calculation.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import type { DividendOfficialEvent } from '../../src/lib/dividendLedger.ts';
import type { DividendStock } from '../../src/lib/dividendWorkbench.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const { buildDividendLedger, dividendLedgerBase, parseDividendOfficialAnnouncementText } = await import('../../src/lib/dividendLedger.ts');
const { calculateDividendPricing, defaultDividendPricingMethod, dividendPricingAnnuals } = await import('../../src/lib/dividendPricing.ts');
const { dividendPricingPlan, dividendPricingProvenance } = await import('../../src/lib/dividendPricingPlan.ts');
const { reviewDividendGrid } = await import('../../src/lib/dividendGridProvenance.ts');
const { buildDividendHomePlan, parseDividendResponse } = await import('../../src/lib/dividendWorkbench.ts');
const { researchDividendLedger, closeDividendLedgerEvidence } = await import('../../src/services/dividendLedgerEvidenceService.ts');
const at = '2026-10-30', code = '000001';
const fixture = JSON.parse(readFileSync(new URL('../../scripts/fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8'));
const officialFixtures = ['pingan-2025-final', 'pingan-2026-interim'].map(name => JSON.parse(readFileSync(new URL(`../../scripts/fixtures/dividend-official/${name}.json`, import.meta.url), 'utf8')));
const officialEvents = officialFixtures.map(source => parseDividendOfficialAnnouncementText(source.text, source)!);
assert.ok(officialEvents.every(Boolean));
const ledger = buildDividendLedger(fixture.sources.distribution.data, code, at, { officialEvents });
const annuals = dividendPricingAnnuals(fixture.sources.financial.data, undefined, fixture.sources.distribution.data, code, at);
const samples: object[] = [];
const summarize = (base: ReturnType<typeof dividendLedgerBase>) => ({ baseMicros: base.dpsMicros ?? null, frequency: base.frequency, selectedBatchIds: base.selectedBatchIds, verified: base.verified, flags: base.flags });

for (const [holdingPeriod, tax, expectedBuy, expectedSell] of [
  ['over_year', 0, [1107, 1059, 1015, 936], [1269, 1354, 1450, 1523]],
  ['month_to_year', 1000, [996, 953, 913, 843], [1142, 1218, 1305, 1371]],
  ['up_to_month', 2000, [885, 847, 812, 749], [1015, 1083, 1160, 1218]],
] as const) {
  const pricing = calculateDividendPricing({ code, name: '平安银行（历史算术样本）', financialSector: true, asOf: at,
    annuals, ledger, method: { ...defaultDividendPricingMethod(), holdingPeriod } });
  const plan = dividendPricingPlan(pricing)!;
  assert.equal(pricing.dividendBase?.dpsMicros, 609000);
  assert.equal(pricing.taxBps, tax);
  assert.deepEqual(plan.buyLevels.map(level => level.priceMinor), expectedBuy);
  assert.deepEqual(plan.sellLevels.map(level => level.priceMinor), expectedSell);
  samples.push({ id: `PA-tax-${tax}`, scope: 'archived-input-arithmetic-only', grossMicros: 609000, netMicros: pricing.d1Micros, taxBps: tax,
    buyMinor: expectedBuy, sellMinor: expectedSell, portionBps: 2500,
    provenanceKeys: Object.keys(dividendPricingProvenance(pricing, Date.parse(`${at}T08:00:00+08:00`))!) });
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const row = (report: string, ex: string, cash: number, extra: Record<string, unknown> = {}) => ({ SECURITY_CODE: code, REPORT_DATE: report, NOTICE_DATE: shift(ex, -7),
  EX_DIVIDEND_DATE: ex, EQUITY_RECORD_DATE: shift(ex, -1), PRETAX_BONUS_RMB: cash, BONUS_RATIO: 0, IT_RATIO: 0, ASSIGN_PROGRESS: '实施分配', ...extra });
type Row = ReturnType<typeof row>;
const official = (value: Row, period: DividendOfficialEvent['period'] = value.REPORT_DATE.endsWith('-06-30') ? 'interim' : 'annual'): DividendOfficialEvent => ({
  code, reportDate: value.REPORT_DATE, period, announcementDate: value.NOTICE_DATE, recordDate: value.EQUITY_RECORD_DATE, exDate: value.EX_DIVIDEND_DATE,
  cashPer10Micros: Math.round(value.PRETAX_BONUS_RMB * 1e6), bonusPer10Bps: Number(value.BONUS_RATIO) * 1000, transferPer10Bps: Number(value.IT_RATIO) * 1000,
  sourceUrl: `https://static.cninfo.com.cn/finalpage/${value.NOTICE_DATE}/SYNTHETIC-${period}.PDF`, verifiedAt: at });
const raw = (data: Row[], pages = 1) => ({ success: true, result: { data, pages } });
const build = (data: Row[], events = data.map(value => official(value)), pages = 1) => buildDividendLedger(raw(data, pages), code, at, { officialEvents: events });
const baseSample = (id: string, data: Row[], expected: number | undefined, events = data.map(value => official(value)), pages = 1) => {
  const base = dividendLedgerBase(build(data, events, pages), at);
  assert.equal(base.dpsMicros, expected);
  samples.push({ id, scope: 'synthetic', ...summarize(base) });
  return base;
};
const semi = [row('2026-06-30', '2026-09-24', 2.49), row('2025-12-31', '2026-06-12', 3.6), row('2025-06-30', '2025-10-15', 2.36)];
baseSample('semiannual-deduplicate', [...semi, semi[0]], 609000);
const conflict = baseSample('conflicting-latest-must-not-fall-back', [...semi, { ...semi[0], PRETAX_BONUS_RMB: 2.5 }], undefined, semi.map(value => official(value)));
assert.ok(conflict.flags.includes('SOURCE_CONFLICT'));
const missing = baseSample('unverified-latest', semi, undefined, semi.slice(1).map(value => official(value)));
assert.ok(missing.flags.includes('ANNOUNCEMENT_UNVERIFIED'));
const annualRows = [row('2025-12-31', '2026-06-10', 5), row('2024-12-31', '2025-06-10', 4)];
baseSample('annual-one-batch', annualRows, 500000);
baseSample('annual-frequency-insufficient-history', annualRows.slice(0, 1), undefined);
baseSample('incomplete-source-pages', semi, undefined, semi.map(value => official(value)), 2);
const bonus = [row('2025-12-31', '2025-10-10', 0, { IT_RATIO: 5 }), row('2025-06-30', '2025-09-10', 2), row('2024-12-31', '2025-06-10', 10, { BONUS_RATIO: 8 })];
baseSample('same-day-and-later-bonus-normalization', bonus, 503703);
const exactBoundary = dividendLedgerBase(ledger, at, { epsMicros: 609000, payoutBps: 7500 });
const aboveBoundary = dividendLedgerBase(ledger, at, { epsMicros: 456749, payoutBps: 10000 });
assert.equal(exactBoundary.verified, true); assert.equal(aboveBoundary.verified, false);
samples.push({ id: 'crosscheck-25-percent-boundary', scope: 'synthetic', atBoundary: summarize(exactBoundary), aboveBoundaryByOneMicro: summarize(aboveBoundary) });

// Rule ambiguity: frequency ignores special distributions but N-batch selection includes them.
const special = row('2026-06-30', '2026-10-20', 20, { IMPL_PLAN_PROFILE: '特别分红' });
const specialBase = baseSample('special-replaces-annual-batch', [special, ...annualRows], 2000000, [official(special, 'special'), ...annualRows.map(value => official(value))]);
assert.equal(specialBase.frequency, 'annual');
assert.ok(specialBase.selectedBatchIds[0].endsWith(':special'));
const specialSource = officialFixtures[1];
const specialParsed = parseDividendOfficialAnnouncementText(specialSource.text.replaceAll('半年度权益分派', '特别权益分派'), specialSource);
assert.equal(specialParsed, undefined);
samples.push({ id: 'special-title-extraction-unavailable', scope: 'modified-archived-text', parsed: specialParsed ?? null });

const noExplicitPlan: DividendStock = { code, name: 'Synthetic without explicit grid', group: 'core', weightBps: 10000,
  shareMode: 'manual', manualShares: 0, lotSize: 100, manualDpsMicros: 609000, quote: { priceMinor: 800, date: at, fetchedAt: 1 } };
const fallbackReview = reviewDividendGrid(noExplicitPlan, undefined, { asOf: at, parameterVersion: 5, basisKind: 'recent_batches' });
const fallbackPlan = buildDividendHomePlan(noExplicitPlan, 1000000, 0, at);
assert.equal(fallbackReview.basisState, 'unavailable'); assert.equal(fallbackReview.hasSavedGrid, false);
assert.equal(fallbackPlan.buy.length, 7); assert.equal(fallbackPlan.buy[0].priceMinor, 1218);
assert.equal(fallbackPlan.buyState, 'triggered');
samples.push({ id: 'no-saved-grid-but-old-fallback-prices', scope: 'synthetic', headerBasisState: fallbackReview.basisState,
  hasSavedGrid: fallbackReview.hasSavedGrid, buyMinor: fallbackPlan.buy.map(level => level.priceMinor), buyState: fallbackPlan.buyState,
  buyTriggeredLevel: fallbackPlan.buyTriggeredLevel, additionalBuyShares: fallbackPlan.additionalBuyShares });
const forecastFallback = buildDividendHomePlan({ ...noExplicitPlan, manualDpsMicros: undefined,
  dividend: parseDividendResponse(fixture.sources.distribution.data, code, at, 1) }, 1000000, 0, at);
assert.deepEqual(forecastFallback.buy.map(level => level.priceMinor), fallbackPlan.buy.map(level => level.priceMinor));
assert.equal(forecastFallback.buyState, 'triggered');
samples.push({ id: 'no-saved-grid-forecast-also-enters-old-formula', scope: 'archived-input-synthetic-plan',
  buyMinor: forecastFallback.buy.map(level => level.priceMinor), buyState: forecastFallback.buyState });

const preExPricing = calculateDividendPricing({ code, name: 'Synthetic', financialSector: true, asOf: at, annuals, ledger,
  method: defaultDividendPricingMethod(), priceMinor: 800, priceDate: '2026-09-23' });
// Keep the basis amount but simulate a newly implemented cash/share event yesterday.
const quoteBoundaryBasis = { ...dividendLedgerBase(ledger, at), latestExDate: '2026-10-29' };
const quoteBoundaryPlan = dividendPricingPlan(preExPricing)!;
const quoteBoundaryReview = reviewDividendGrid({ ...quoteBoundaryPlan,
  gridProvenance: dividendPricingProvenance(preExPricing, Date.parse(`${at}T08:00:00+08:00`)),
  quote: { priceMinor: 800, date: '2026-10-28', fetchedAt: 1 } }, quoteBoundaryBasis,
  { asOf: at, parameterVersion: 5, taxBps: 1000, basisKind: 'recent_batches' });
assert.equal(quoteBoundaryReview.quoteUsable, true); assert.equal(quoteBoundaryReview.basisState, 'verified');
assert.equal(quoteBoundaryReview.buyState, 'triggered');
samples.push({ id: 'home-accepts-pre-ex-date-quote', scope: 'synthetic', quoteDate: '2026-10-28', latestExDate: '2026-10-29',
  quoteUsable: quoteBoundaryReview.quoteUsable, basisState: quoteBoundaryReview.basisState, buyState: quoteBoundaryReview.buyState });

// Defect reproduction: cached events keep their original verifiedAt, but a failed
// current CNinfo query still gives the reconstructed ledger today's asOf/verified.
const transport = {
  post: async (path: string) => path.includes('topSearch') ? [{ code, orgId: 'SYNTHETIC-org' }] : { hasMore: false,
    announcements: officialFixtures.map(source => ({ announcementTitle: '权益分派实施公告', adjunctUrl: new URL(source.sourceUrl).pathname.slice(1),
      announcementTime: Date.parse(`${source.announcementDate}T00:00:00+08:00`) })) },
  readPdf: async (url: string) => new TextEncoder().encode(`%PDF-SYNTHETIC:${url}`),
  extractPdf: async (bytes: Uint8Array) => officialFixtures.find(source => source.sourceUrl === new TextDecoder().decode(bytes).replace('%PDF-SYNTHETIC:', ''))!.text,
};
try {
  await researchDividendLedger(fixture.sources.distribution.data, code, '2026-10-29', transport);
  const failed = await researchDividendLedger(fixture.sources.distribution.data, code, at, { post: async () => { throw new Error('CNINFO_HTTP_503_SYNTHETIC'); } });
  const failedBase = dividendLedgerBase(failed, at, { epsMicros: annuals[0].epsMicros, payoutBps: annuals[0].payoutBps });
  assert.equal(failed.asOf, at); assert.equal(failedBase.verified, true);
  assert.ok(failed.issues.includes('CNINFO_HTTP_503_SYNTHETIC'));
  const dates = failed.events.flatMap(event => event.sources.flatMap(source => source.verifiedAt ? [source.verifiedAt] : []));
  assert.ok(dates.every(value => value === '2026-10-29'));
  const method = defaultDividendPricingMethod();
  const pricing = calculateDividendPricing({ code, name: 'Synthetic', financialSector: true, asOf: at, annuals, ledger: failed, method });
  assert.equal(pricing.canApply, true);
  const plan = dividendPricingPlan(pricing)!;
  const review = reviewDividendGrid({ ...plan, gridProvenance: dividendPricingProvenance(pricing, Date.parse(`${at}T08:00:00+08:00`)) }, failedBase,
    { asOf: at, parameterVersion: 5, taxBps: 1000, basisKind: 'recent_batches' });
  assert.equal(review.basisState, 'verified');
  samples.push({ id: 'failed-official-refresh-relabelled-current', scope: 'mocked-failure-in-memory-only', ledgerAsOf: failed.asOf,
    documentVerifiedDates: [...new Set(dates)], ledgerIssues: failed.issues, baseVerified: failedBase.verified, newDraftCanApply: pricing.canApply, homepageBasisState: review.basisState });
} finally { closeDividendLedgerEvidence(); await Dexie.delete('FortunaDividendLedger'); }

const output = JSON.stringify({ asOf: at, dataBoundary: 'Archived and synthetic input only; fake IndexedDB; no real quote, AI request, user database or trade.', samples }, null, 2);
writeFileSync(new URL('./pricing-samples.json', import.meta.url), output + '\n');
console.log(output);
