import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendPricingGuide } from '../src/lib/dividendPricingGuide.ts';
import { verifiedDividendBase } from './helpers/dividendPricingFixture.ts';
import { dividendCheckSummary } from '../src/lib/dividendCheckSummary.ts';

const asOf = '2026-11-04';
function pricing() {
  return calculateDividendPricing({ code: '000001', name: 'Arithmetic fixture', financialSector: true,
    method: defaultDividendPricingMethod(), annuals: [], asOf,
    dividendBase: verifiedDividendBase(609000, asOf, { frequency: 'semiannual', requiredBatches: 2,
      selectedBatchIds: ['annual', 'interim'], reportPeriods: ['2025-12-31', '2026-06-30'] }) });
}

test('pricing explanation uses the verified cash base and taxes it once with the actual rounded buy price', () => {
  const guide = dividendPricingGuide(pricing());
  assert.equal(guide.status, 'ready');
  assert.equal(guide.grossDpsMicros, 609000);
  assert.equal(guide.taxBps, 1000);
  assert.equal(guide.netDpsMicros, 548100);
  assert.equal(guide.exampleBuyPriceMinor, 996);
  assert.deepEqual(guide.periods, ['2025-12-31', '2026-06-30']);
  assert.equal(guide.frequency, 'semiannual');
  assert.ok(guide.advisoryCount > 0, 'missing business/comparison evidence stays separate from valid price arithmetic');
  assert.deepEqual(guide.gaps, []);
});

test('duplicate cash-evidence failures become one recovery topic while actual source conflicts stay explicit', () => {
  const source = pricing();
  source.status = 'blocked'; source.canApply = false;
  source.blockers = ['dividend_base_unverified', 'dividend_ledger_missing', 'dividend_base_incomplete', 'dividend_source_conflict', 'dividend_base_unverified'];
  const guide = dividendPricingGuide(source);
  assert.equal(guide.status, 'conflict');
  assert.deepEqual(guide.gaps.map(gap => gap.kind), ['conflict', 'cash']);
  assert.equal(guide.gaps[1].reasons.length, 3);
  assert.equal(guide.exampleBuyPriceMinor, undefined);
  assert.equal(guide.netDpsMicros, undefined);
});

test('old calculation outputs never appear as new usable prices in the guide', () => {
  const source = pricing(), before = structuredClone(source);
  source.calculationVersion = 4;
  const guide = dividendPricingGuide(source);
  assert.equal(guide.status, 'waiting');
  assert.equal(guide.exampleBuyPriceMinor, undefined);
  assert.ok(guide.gaps.some(gap => gap.kind === 'calculation'));
  assert.deepEqual(source.grid, before.grid, 'explaining a historical calculation never replaces its evidence or prices');
});

test('unverified cash is never presented as the first completed formula step', () => {
  const source = pricing();
  source.dividendBase!.verified = false;
  source.status = 'blocked'; source.canApply = false;
  source.blockers = ['dividend_base_unverified', 'dividend_crosscheck_mismatch'];
  const guide = dividendPricingGuide(source);
  assert.equal(guide.status, 'conflict');
  assert.equal(guide.grossDpsMicros, undefined);
  assert.equal(guide.netDpsMicros, undefined);
  assert.deepEqual(guide.gaps.map(gap => gap.kind), ['crosscheck', 'cash']);
});

test('a valid cached calculation cannot overrule a newer local check that lacks matching current evidence', () => {
  const source = pricing();
  const check = dividendCheckSummary({ stock: { code: '000001', name: 'Arithmetic fixture', group: 'watch', weightBps: 0,
    shareMode: 'manual', manualShares: 0, lotSize: 100 }, asOf: '2026-11-05',
    research: { code: '000001', name: 'Arithmetic fixture', status: 'unknown', checks: [], sources: [], issues: [], pricing: source } });
  assert.equal(check.currentPlan, null);
  const guide = dividendPricingGuide(source, check);
  assert.equal(guide.status, 'waiting');
  assert.equal(guide.grossDpsMicros, undefined);
  assert.equal(guide.exampleBuyPriceMinor, undefined);
  assert.deepEqual(guide.gaps.map(gap => gap.kind), ['refresh']);
});

test('a feed report-period recognition failure is distinct from missing cash and share-change amounts', () => {
  const source = pricing();
  source.status = 'blocked'; source.canApply = false; source.blockers = ['dividend_base_unverified'];
  source.dividendBase = { ...source.dividendBase!, verified: false, frequency: 'unknown', flags: ['FREQUENCY_UNKNOWN'] };
  source.ledger = { code: source.code, asOf, complete: true, issues: [], sourceUrls: [], events: [{ id: 'quarter-label', batchId: 'quarter-label', code: source.code,
    reportDate: '2025-09-30', period: 'quarterly', implemented: true, verification: 'unverified', sources: [], issues: [], cashPer10Micros: 2100000, bonusPer10Bps: 0, transferPer10Bps: 0 }] };
  assert.deepEqual(dividendPricingGuide(source).gaps.map(gap => gap.kind), ['source_period']);
});
