import test from 'node:test';
import assert from 'node:assert/strict';
import { dividendCheckSummary, dividendFundCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { dividendQuoteUsability } from '../src/lib/dividendQuoteUsability.ts';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan, dividendPricingProvenance } from '../src/lib/dividendPricingPlan.ts';
import { defaultDividendFundPlan, buildDividendFundHomePlan, type DividendFund } from '../src/lib/dividendFundPlan.ts';
import type { DividendStockResearch } from '../src/lib/dividendResearch.ts';
import { BUY_LEVELS, type DividendStock } from '../src/lib/dividendWorkbench.ts';
import { pingAnOfficialLedger } from './helpers/dividendPricingFixture.ts';

const asOf = '2026-10-30', now = Date.parse('2026-10-30T03:00:00Z');
const ledger = pingAnOfficialLedger(asOf), method = defaultDividendPricingMethod();
const pricing = calculateDividendPricing({ code: '000001', name: 'Synthetic bank', asOf, ledger, method, financialSector: true,
  annuals: [{ year: 2025, reportDate: '2025-12-31', epsMicros: 2030000, payoutBps: 3000, dividendMicros: 609000 }],
  priceMinor: 900, priceDate: `${asOf} 10:00` });
assert.equal(pricing.canApply, true);
const plan = dividendPricingPlan(pricing)!;
const stock: DividendStock = { code: '000001', name: 'Synthetic bank', group: 'core', weightBps: 10000, shareMode: 'manual', manualShares: 200, lotSize: 100,
  ...plan, gridProvenance: dividendPricingProvenance(pricing, now - 1000), quote: { priceMinor: 900, date: `${asOf} 10:00`, fetchedAt: now } };
const research: DividendStockResearch = { code: stock.code, name: stock.name, status: 'pass', checks: [{ rule: 'roe', status: 'pass', value: 1000, threshold: 800, period: '2025-12-31' }],
  sources: [], issues: [], pricing };
const summarize = (patch: Partial<Parameters<typeof dividendCheckSummary>[0]> = {}) => dividendCheckSummary({ stock, research,
  totalBudgetMinor: 1000000, researchGeneratedAt: now, asOf, now, ...patch });

test('missing research time and a failed current source do not inherit a passing cached result', () => {
  assert.equal(summarize({ researchGeneratedAt: undefined }).eligibility.status, 'unknown');
  const failed = summarize({ basis: { ...pricing.dividendBase!, verified: false, evidenceStatus: 'failed', evidenceIssues: ['ANNOUNCEMENT_REFRESH_FAILED'] } });
  assert.equal(failed.eligibility.status, 'unknown'); assert.equal(failed.grid.status, 'saved_unverified');
  assert.notEqual(failed.actionCheck.buy.status, 'confirmation_candidate');
  const failedCash = summarize({ research: { ...research, issues: [{ kind: 'dividend', reason: 'request_failed' }] } });
  assert.equal(failedCash.grid.status, 'saved_unverified'); assert.equal(failedCash.currentPlan, null);
  assert.equal(failedCash.eligibility.status, 'unknown');
  const cachedFailed = summarize({ ledger, research: { ...research, pricing: { ...pricing,
    ledger: { ...ledger, complete: false, issues: ['CNINFO_HTTP_503'] } } } });
  assert.equal(cachedFailed.grid.status, 'verified', 'structured cash evidence stays verified despite a failed announcement refresh');
});

test('a missing earlier tier keeps original tier numbers and cannot invent cumulative quantities', () => {
  const value = summarize({ stock: { ...stock, buyLevels: [{ yieldBps: 550, portionBps: 2500 }, { yieldBps: 575, portionBps: 7500, priceMinor: 1000 }] } });
  assert.deepEqual(value.grid.buyTierIndices, [2]); assert.deepEqual(value.trigger.buyLevels, [2]);
  assert.equal(value.displayPlan.buyTriggeredLevel, 2); assert.equal(value.displayPlan.buy[0].targetShares, undefined);
  assert.equal(value.displayPlan.buy[0].cumulative, 10000, 'missing price tiers still retain their saved allocation in the cumulative label');
  assert.equal(value.displayPlan.additionalBuyShares, 0); assert.equal(value.actionCheck.buy.status, 'review');
  assert.deepEqual(value.grid.nextBuy, { index: 2, priceMinor: 1000, basis: 'price_reference' });
  assert.equal(value.grid.nextBuyState, 'unknown');
});

test('a future fund quote cannot supply current either/both price evidence while a valid independent index condition remains visible', () => {
  const fund: DividendFund = { id: 'test', name: 'Synthetic fund', code: '515450', indexKind: 'other', weightBps: 10000,
    quote: { priceMicros: 900000, date: `${asOf} 12:00`, fetchedAt: now }, reference: { asOf, highMicros: 1200000, indexYieldBps: 600 } };
  for (const entryRule of ['both', 'either'] as const) {
    const value = dividendFundCheckSummary({ plan: { ...defaultDividendFundPlan(), entryRule, funds: [fund], budgetMinor: 100000 }, fund, asOf, now });
    assert.equal(value.trigger.buy, 'unknown'); assert.notEqual(value.actionCheck.buy.status, 'confirmation_candidate');
    assert.equal(value.eligibility.status, 'unknown', 'index yield never substitutes for a valid price');
  }
});

test('a current verified numerator keeps the existing v5 four-buy/four-sell prices and leaves every input intact', () => {
  const input = { stock: structuredClone(stock), research: structuredClone(research), ledger: structuredClone(ledger), pricingMethod: structuredClone(method),
    totalBudgetMinor: 1000000, researchGeneratedAt: now, asOf, now };
  const before = structuredClone(input);
  const result = dividendCheckSummary(input);
  assert.equal(result.grid.status, 'verified'); assert.equal(result.grid.origin, 'saved');
  assert.deepEqual(result.grid.buyLevels, plan.buyLevels); assert.deepEqual(result.grid.sellLevels, plan.sellLevels);
  assert.equal(result.grid.taxBps, 1000); assert.equal(result.grid.grossDpsMicros, 609000); assert.equal(result.grid.netDpsMicros, 548100);
  assert.deepEqual(input, before);
});

test('pass plus a verified current grid above the buy price waits, while a reached price remains distinct from execution', () => {
  const waiting = summarize({ stock: { ...stock, quote: { ...stock.quote!, priceMinor: 1100 } }, research: { ...research, pricing: { ...pricing, currentPriceMinor: 1100 } } });
  assert.equal(waiting.eligibility.status, 'pass'); assert.equal(waiting.trigger.buy, 'not_triggered'); assert.equal(waiting.actionCheck.buy.status, 'wait');
  const reached = summarize();
  assert.equal(reached.trigger.buy, 'triggered'); assert.equal(reached.actionCheck.buy.status, 'review');
  assert.ok(reached.actionCheck.buy.reasons.includes('execution_session_unverified'));
  assert.ok(!reached.actionCheck.buy.reasons.includes('saved_evidence_snapshot_missing'));
  assert.equal(reached.risk.evidenceInsufficient.find(item => item.reason === 'saved_evidence_snapshot_missing')?.impact, 'information');
});

test('screening observations never restrict buying while a manual pause still blocks it', () => {
  const failed = { ...research, status: 'risk' as const, checks: [{ rule: 'roe' as const, status: 'risk' as const, value: 500, threshold: 800 }] };
  const result = summarize({ research: failed, quoteSession: 'confirmed' });
  assert.equal(result.eligibility.status, 'fail'); assert.equal(result.trigger.buy, 'triggered'); assert.equal(result.actionCheck.buy.status, 'confirmation_candidate');
  assert.ok(!result.actionCheck.buy.reasons.includes('eligibility_fail'));
  assert.equal(result.risk.attention.find(item => item.reason === 'rule_roe')?.impact, 'information');
  assert.equal(result.risk.attention.find(item => item.reason === 'rule_roe')?.verifiedAt, undefined,
    'cash-announcement verification must never be attached to an unverified financial rule');
  const paused = summarize({ stock: { ...stock, buyPaused: true }, research: failed });
  assert.equal(paused.trigger.buy, 'triggered'); assert.equal(paused.actionCheck.buy.status, 'blocked'); assert.deepEqual(paused.actionCheck.buy.reasons, ['manual_pause']);
});

test('failed buying eligibility never blocks an independently reached sell price', () => {
  const result = summarize({ stock: { ...stock, buyPaused: true, quote: { ...stock.quote!, priceMinor: 1500 } }, quoteSession: 'confirmed',
    research: { ...research, checks: [{ rule: 'roe', status: 'risk' }], status: 'risk', pricing: { ...pricing, currentPriceMinor: 1500 } } });
  assert.equal(result.actionCheck.buy.status, 'blocked'); assert.equal(result.trigger.sell, 'triggered');
  assert.equal(result.actionCheck.sell.status, 'confirmation_candidate');
  assert.ok(!result.actionCheck.sell.reasons.includes('eligibility_fail'));
});

test('missing new evidence preserves saved explicit prices and returns no manufactured price when none were saved', () => {
  const history = summarize({ research: undefined });
  assert.equal(history.grid.status, 'saved_unverified'); assert.deepEqual(history.grid.buyLevels, plan.buyLevels);
  assert.equal(history.actionCheck.buy.status, 'review');
  const empty = summarize({ stock: { ...stock, buyLevels: undefined, sellLevels: undefined, manualDpsMicros: 609000 }, research: undefined });
  assert.equal(empty.grid.status, 'unavailable'); assert.deepEqual(empty.grid.buyLevels, []); assert.deepEqual(empty.grid.sellLevels, []);
  assert.deepEqual(empty.displayPlan.buy, []); assert.deepEqual(empty.displayPlan.sell, []); assert.equal(empty.trigger.status, 'unknown');
});

test('legacy yield-only seven-tier defaults never escape as new calculated prices', () => {
  const result = summarize({ stock: { ...stock, buyLevels: BUY_LEVELS, sellLevels: undefined, manualDpsMicros: 609000 }, research: undefined });
  assert.equal(result.grid.status, 'unavailable'); assert.equal(result.grid.buyLevels.length, 0); assert.equal(result.displayPlan.buy.length, 0);
});

test('an unsaved candidate can display only the current v5 plan and requires saving before execution review', () => {
  const result = summarize({ stock: { ...stock, buyLevels: BUY_LEVELS, sellLevels: undefined, gridProvenance: undefined } });
  assert.equal(result.grid.status, 'verified'); assert.equal(result.grid.origin, 'current');
  assert.deepEqual(result.grid.buyLevels, plan.buyLevels); assert.deepEqual(result.grid.sellLevels, plan.sellLevels);
  assert.ok(result.actionCheck.buy.reasons.includes('current_grid_not_saved'));
});

test('partial historical grids keep their explicit prices and never fill missing tiers with a dividend forecast', () => {
  const result = summarize({ stock: { ...stock, buyLevels: [{ yieldBps: 550, portionBps: 2500, priceMinor: 1000 }, { yieldBps: 575, portionBps: 7500 }], manualDpsMicros: 99999999 } });
  assert.equal(result.grid.status, 'saved_unverified'); assert.deepEqual(result.grid.buyLevels.map(level => level.priceMinor), [1000]);
  assert.equal(result.displayPlan.buy.length, 1); assert.ok(result.grid.reasons.includes('grid_partial'));
});

test('up to ten days of old observations remain historical comparisons, never a current trigger', () => {
  for (const date of ['2026-10-30', '2026-10-29 15:00', '2026-10-20 15:00']) {
    const result = summarize({ stock: { ...stock, quote: { ...stock.quote!, date } } });
    assert.equal(result.trigger.buy, 'unknown', date); assert.equal(result.trigger.lastAvailable?.buy, 'triggered', date);
    assert.equal(result.displayPlan.quoteUsable, false); assert.ok(result.displayPlan.buy.every(row => !row.touched && !row.priceTouched));
    assert.equal(result.displayPlan.buyTriggeredLevel, 0); assert.equal(result.displayPlan.additionalBuyShares, 0);
    assert.notEqual(result.actionCheck.buy.status, 'confirmation_candidate');
  }
  const tooOld = summarize({ stock: { ...stock, quote: { ...stock.quote!, date: '2026-10-19 15:00' } } });
  assert.equal(tooOld.trigger.lastAvailable, undefined); assert.equal(tooOld.trigger.status, 'unknown');
});

test('a failed primary refresh cannot be bypassed by a current research quote', () => {
  const result = summarize({ stock: { ...stock, quoteFailedAt: now } });
  assert.equal(result.trigger.buy, 'unknown'); assert.equal(result.trigger.quote.status, 'last_available');
  assert.ok(result.trigger.quote.reasons.includes('quote_refresh_failed')); assert.equal(result.trigger.lastAvailable?.buy, 'triggered');
});

test('future timestamps, incompatible ex-date basis and same-time source conflicts remain unknown', () => {
  const future = summarize({ stock: { ...stock, quote: { ...stock.quote!, date: `${asOf} 12:00` } } });
  assert.equal(future.trigger.buy, 'unknown'); assert.ok(future.trigger.quote.reasons.includes('quote_future'));
  const conflict = summarize({ comparisonQuote: { date: stock.quote!.date, priceMinor: 901 } });
  assert.equal(conflict.trigger.buy, 'unknown'); assert.equal(conflict.trigger.lastAvailable, undefined);
  assert.ok(conflict.trigger.quote.reasons.includes('quote_source_conflict'));
  const beforeEx = summarize({ basis: { ...pricing.dividendBase!, latestExDate: '2026-10-31' } });
  assert.equal(beforeEx.trigger.buy, 'unknown'); assert.ok(beforeEx.trigger.quote.reasons.includes('quote_before_ex'));
});

test('an old parameter version, changed tax or newer numerator never silently replaces an explicit saved grid', () => {
  const changed = summarize({ pricingMethod: { ...method, holdingPeriod: 'over_year' } });
  assert.equal(changed.grid.status, 'saved_unverified'); assert.ok(changed.grid.reasons.includes('tax_changed')); assert.deepEqual(changed.grid.buyLevels, plan.buyLevels);
  const oldVersion = summarize({ stock: { ...stock, gridProvenance: { ...stock.gridProvenance!, parameterVersion: 4 } } });
  assert.ok(oldVersion.grid.reasons.includes('parameters_changed'));
  const candidate = summarize({ stock: { ...stock, buyLevels: undefined, sellLevels: undefined }, basis: { ...pricing.dividendBase!, dpsMicros: 999000 } });
  assert.equal(candidate.grid.status, 'unavailable'); assert.ok(candidate.grid.reasons.includes('pricing_basis_changed'));
  const changedLadder = summarize({ pricingMethod: { ...method, buyYieldBps: [700, 800, 900, 1000], sellYieldBps: [600, 500, 400, 300] } });
  assert.equal(changedLadder.grid.status, 'saved_unverified'); assert.ok(changedLadder.grid.reasons.includes('parameters_changed'));
  assert.deepEqual(changedLadder.grid.buyLevels, plan.buyLevels); assert.deepEqual(changedLadder.grid.sellLevels, plan.sellLevels);
});

test('source refresh failure and incomplete pagination no longer downgrade structured cash evidence', () => {
  const before = structuredClone(ledger), oldDates = ledger.events.flatMap(event => event.sources.map(source => source.verifiedAt));
  for (const patch of [{ issues: ['ANNOUNCEMENT_REFRESH_FAILED'] }, { complete: false, issues: ['SOURCE_PAGES_INCOMPLETE'] }]) {
    const result = summarize({ ledger: { ...ledger, ...patch } });
    assert.equal(result.grid.status, 'verified'); assert.deepEqual(result.grid.buyLevels, plan.buyLevels);
    assert.deepEqual(result.freshness.evidenceVerifiedDates, [...new Set(oldDates.filter((value): value is string => !!value && pricing.dividendBase!.selectedBatchIds.some(id => ledger.events.find(event => event.batchId === id)?.sources.some(source => source.verifiedAt === value))))].sort());
  }
  assert.deepEqual(ledger, before);
});

test('cross-check, special-distribution and missing saved-snapshot observations do not restrict new buys', () => {
  const selectedId = pricing.dividendBase!.selectedBatchIds[0];
  const result = summarize({ basis: { ...pricing.dividendBase!, flags: ['CROSSCHECK_MISSING'] },
    ledger: { ...ledger, events: ledger.events.map(event => event.batchId === selectedId ? { ...event, period: 'special' as const } : event) } });
  for (const reason of ['crosscheck_missing', 'special_dividend_review', 'saved_evidence_snapshot_missing']) {
    assert.ok(result.risk.evidenceInsufficient.some(item => item.reason === reason && item.impact === 'information'));
    assert.ok(!result.actionCheck.buy.reasons.includes(reason));
  }
  assert.equal(result.grid.status, 'verified'); assert.equal(pricing.canApply, true); assert.deepEqual(result.grid.buyLevels, plan.buyLevels);
});

test('next buy uses the first uncovered original cumulative target for zero, partial and fully covered holdings', () => {
  const zero = summarize({ shares: 0 });
  assert.equal(zero.grid.nextBuy?.index, 1); assert.equal(zero.grid.nextBuyState, 'pending');
  assert.equal(zero.grid.nextBuy?.basis, 'cumulative_target');
  assert.equal(zero.grid.nextBuy?.targetShares, zero.displayPlan.buy[0].targetShares);
  const firstTarget = zero.displayPlan.buy[0].targetShares!;
  const partial = summarize({ shares: firstTarget });
  assert.equal(partial.grid.nextBuy?.index, 2); assert.equal(partial.grid.nextBuyState, 'pending');
  assert.equal(partial.grid.nextBuy?.targetShares, partial.displayPlan.buy[1].targetShares);
  for (const shares of [zero.displayPlan.buy.at(-1)!.targetShares!, zero.displayPlan.buy.at(-1)!.targetShares! + 100]) {
    const covered = summarize({ shares });
    assert.equal(covered.grid.nextBuy, undefined); assert.equal(covered.grid.nextBuyState, 'covered');
  }
});

test('multiple reached buy tiers preserve the outstanding target separately from the deepest reached total', () => {
  const result = summarize({ shares: 0, stock: { ...stock, quote: { ...stock.quote!, priceMinor: 800 } },
    research: { ...research, pricing: { ...pricing, currentPriceMinor: 800 } } });
  assert.deepEqual(result.trigger.buyLevels, [1, 2, 3, 4]); assert.equal(result.grid.nextBuy?.index, 1);
  assert.equal(result.actionCheck.additionalBuyShares, result.displayPlan.buy[3].targetShares);
  assert.ok(result.actionCheck.additionalBuyShares! > result.grid.nextBuy!.targetShares!);
});

test('pausing does not change next prices or cumulative targets and never unlocks a buy', () => {
  const active = summarize(), paused = summarize({ stock: { ...stock, buyPaused: true } });
  assert.deepEqual(paused.grid.nextBuy, active.grid.nextBuy); assert.deepEqual(paused.grid.nextSell, active.grid.nextSell);
  assert.equal(paused.grid.nextBuyState, active.grid.nextBuyState); assert.equal(paused.actionCheck.buy.status, 'blocked');
});

test('missing budget, empty budget and a sub-lot gap are distinct from fully covered targets', () => {
  const missing = summarize({ totalBudgetMinor: undefined, shares: 0 });
  assert.equal(missing.grid.nextBuyState, 'unknown'); assert.equal(missing.grid.nextBuy?.basis, 'price_reference');
  assert.equal(missing.grid.nextBuy?.targetShares, undefined);
  const empty = summarize({ totalBudgetMinor: 0, shares: 0 });
  assert.equal(empty.grid.nextBuyState, 'budget_empty'); assert.equal(empty.grid.nextBuy, undefined);
  const firstTarget = summarize({ shares: 0 }).displayPlan.buy[0].targetShares!;
  const smallGap = summarize({ shares: firstTarget - 50 });
  assert.equal(smallGap.grid.nextBuyState, 'below_lot'); assert.equal(smallGap.grid.nextBuy?.index, 1);
  const tinyBudget = summarize({ totalBudgetMinor: 1, shares: 0 });
  assert.equal(tinyBudget.grid.nextBuyState, 'below_lot'); assert.equal(tinyBudget.grid.nextBuy, undefined);
});

test('next sell respects current holdings and original lot rounding without inventing executed tier progress', () => {
  const held = summarize({ shares: 1000 });
  assert.deepEqual(held.grid.nextSell, { index: 1, priceMinor: plan.sellLevels[0].priceMinor, basis: 'cumulative_target', sellShares: 200 });
  const oneLot = summarize({ shares: 100 });
  assert.equal(oneLot.grid.nextSell?.index, 4); assert.equal(oneLot.grid.nextSell?.sellShares, 100);
  const noHolding = summarize({ shares: 0, stock: { ...stock, quote: { ...stock.quote!, priceMinor: 2000 } },
    research: { ...research, pricing: { ...pricing, currentPriceMinor: 2000 } } });
  assert.deepEqual(noHolding.trigger.sellLevels, [1, 2, 3, 4]);
  assert.equal(noHolding.grid.nextSell, undefined); assert.equal(noHolding.grid.nextSellState, 'no_holding');
  assert.equal(noHolding.actionCheck.sell.status, 'blocked');
  const allReached = summarize({ shares: 1000, stock: { ...stock, quote: { ...stock.quote!, priceMinor: 2000 } },
    research: { ...research, pricing: { ...pricing, currentPriceMinor: 2000 } } });
  assert.equal(allReached.grid.nextSell?.index, 1); assert.equal(allReached.actionCheck.sellShares, 1000);
});

test('partial sell prices keep the original index only as a quantity-unknown price reference', () => {
  const result = summarize({ stock: { ...stock, sellLevels: [{ yieldBps: 480, portionBps: 2500 }, { yieldBps: 450, portionBps: 7500, priceMinor: 1500 }] } });
  assert.deepEqual(result.grid.nextSell, { index: 2, priceMinor: 1500, basis: 'price_reference' });
  assert.equal(result.grid.nextSellState, 'unknown'); assert.equal(result.grid.nextSell?.sellShares, undefined);
  const unavailable = summarize({ stock: { ...stock, buyLevels: undefined, sellLevels: undefined }, research: undefined });
  assert.equal(unavailable.grid.nextBuy, undefined); assert.equal(unavailable.grid.nextSell, undefined);
  assert.equal(unavailable.grid.nextBuyState, 'unknown'); assert.equal(unavailable.grid.nextSellState, 'unknown');
});

test('an unrelated old special dividend neither persists a new-buy restriction nor changes current prices', () => {
  const old = { ...ledger.events[0], id: 'old-special', batchId: 'old-special', period: 'special' as const, reportDate: '2019-12-31',
    announcementDate: '2020-05-01', exDate: '2020-06-01', shareFactor: 1, implemented: true };
  const baseline = summarize(), result = summarize({ ledger: { ...ledger, events: [...ledger.events, old] } });
  assert.ok(!result.risk.evidenceInsufficient.some(item => item.reason === 'special_dividend_review'));
  assert.deepEqual(result.actionCheck.buy.reasons, baseline.actionCheck.buy.reasons);
  assert.deepEqual(result.grid.buyLevels, baseline.grid.buyLevels); assert.deepEqual(result.grid.sellLevels, baseline.grid.sellLevels);
});

test('special dividends selected by current or supplied saved comparison evidence retain their observation', () => {
  const old = { ...ledger.events[0], id: 'old-special', batchId: 'old-special', period: 'special' as const, reportDate: '2019-12-31',
    announcementDate: '2020-05-01', exDate: '2020-06-01', shareFactor: 1, implemented: true };
  const result = summarize({ ledger: { ...ledger, events: [...ledger.events, old] },
    savedEvidenceSnapshot: { sourceUrls: ['https://example.com/synthetic-saved-special'], selectedBatchIds: [old.batchId] } });
  assert.ok(!result.actionCheck.buy.reasons.includes('special_dividend_review'));
  for (const verification of ['unverified', 'conflict'] as const) {
    const selectedId = pricing.dividendBase!.selectedBatchIds[0];
    const unresolved = summarize({ ledger: { ...ledger, events: ledger.events.map(event => event.batchId === selectedId
      ? { ...event, period: 'special', verification } : event) } });
    assert.ok(unresolved.risk.evidenceInsufficient.some(item => item.reason === 'special_dividend_review'));
  }
});

test('a special capital action affecting selected cash or an ex-date affecting current comparison remains relevant', () => {
  const extra = { ...ledger.events[0], id: 'current-special', batchId: 'current-special', period: 'special' as const,
    announcementDate: '2026-10-01', exDate: '2026-10-02', implemented: true, shareFactor: 1.1, bonusPer10Bps: 1000 };
  const capital = summarize({ ledger: { ...ledger, events: [...ledger.events, extra] } });
  assert.ok(capital.risk.evidenceInsufficient.some(item => item.reason === 'special_dividend_review'));
  const priceComparison = summarize({ ledger: { ...ledger, events: [...ledger.events, { ...extra, shareFactor: 1, bonusPer10Bps: 0 }] },
    basis: { ...pricing.dividendBase!, latestExDate: extra.exDate },
    stock: { ...stock, gridProvenance: { ...stock.gridProvenance!, generatedAt: Date.parse('2026-09-30T03:00:00Z') } } });
  assert.ok(priceComparison.grid.reasons.includes('ex_dividend_since_generation'));
  assert.ok(priceComparison.risk.evidenceInsufficient.some(item => item.reason === 'special_dividend_review'));
  const todaySpecial = { ...extra, announcementDate: '2026-10-29', exDate: asOf, shareFactor: 1, bonusPer10Bps: 0 };
  const beforeExQuote = summarize({ ledger: { ...ledger, events: [...ledger.events, todaySpecial] },
    basis: { ...pricing.dividendBase!, latestExDate: asOf },
    stock: { ...stock, quote: { ...stock.quote!, date: '2026-10-29 10:00' } } });
  assert.ok(beforeExQuote.trigger.quote.reasons.includes('quote_before_ex'));
  assert.ok(beforeExQuote.risk.evidenceInsufficient.some(item => item.reason === 'special_dividend_review'));
});

test('an excluded future special proposal is not silently admitted to the current base or execution limits', () => {
  const proposal = { ...ledger.events[0], id: 'future-special', batchId: 'future-special', period: 'special' as const,
    announcementDate: asOf, exDate: '2026-11-10', implemented: false, proposal: true, stage: 'proposal' as const };
  const result = summarize({ ledger: { ...ledger, events: [...ledger.events, proposal] } });
  assert.ok(!result.risk.evidenceInsufficient.some(item => item.reason === 'special_dividend_review'));
  assert.deepEqual(result.grid.selectedBatchIds, pricing.dividendBase!.selectedBatchIds); assert.deepEqual(result.grid.buyLevels, plan.buyLevels);
});

test('a relevant unverified special event uses its own source and dates without inheriting regular cash verification', () => {
  const special = { ...ledger.events[0], id: 'unverified-special', batchId: 'unverified-special', period: 'special' as const,
    reportDate: '2026-09-30', announcementDate: '2026-10-01', exDate: '2026-10-02', implemented: true, shareFactor: 1.1,
    verification: 'unverified' as const, sources: [{ provider: 'issuer' as const, url: 'https://example.com/special-source' }] };
  const unrelated = { ...special, id: 'old-special', batchId: 'old-special', reportDate: '2019-12-31', exDate: '2020-06-01',
    announcementDate: '2020-05-01', shareFactor: 1, verification: 'verified' as const,
    sources: [{ provider: 'issuer' as const, url: 'https://example.com/unrelated-old-special', verifiedAt: '2026-10-30' }] };
  const result = summarize({ ledger: { ...ledger, events: [...ledger.events, special, unrelated] } });
  const risks = result.risk.evidenceInsufficient.filter(item => item.reason === 'special_dividend_review');
  assert.equal(risks.length, 1);
  assert.deepEqual(risks[0].sources, ['https://example.com/special-source']);
  assert.equal(risks[0].reportPeriod, '2026-09-30'); assert.equal(risks[0].publishedAt, '2026-10-01');
  assert.equal(risks[0].verifiedAt, undefined);
  assert.ok(!risks[0].sources.some(source => pricing.dividendBase!.sourceUrls.includes(source)));
  assert.ok(!result.actionCheck.buy.reasons.includes('special_dividend_review'));
  const unknownDates = summarize({ ledger: { ...ledger, events: [...ledger.events,
    { ...special, reportDate: undefined, announcementDate: undefined, sources: [] }] } });
  const unknown = unknownDates.risk.evidenceInsufficient.find(item => item.reason === 'special_dividend_review')!;
  assert.equal(unknown.reportPeriod, undefined); assert.equal(unknown.publishedAt, undefined); assert.equal(unknown.verifiedAt, undefined);
  assert.deepEqual(unknown.sources, []);
});

test('multiple relevant special events keep separate original verification metadata', () => {
  const special = { ...ledger.events[0], id: 'verified-special-one', batchId: 'verified-special-one', period: 'special' as const,
    reportDate: '2026-09-30', announcementDate: '2026-10-01', exDate: '2026-10-02', implemented: true, shareFactor: 1.1,
    verification: 'verified' as const,
    sources: [{ provider: 'issuer' as const, url: 'https://example.com/special-one', verifiedAt: '2026-10-03' }] };
  const second = { ...special, id: 'verified-special-two', batchId: 'verified-special-two', reportDate: '2026-10-01',
    announcementDate: '2026-10-04', exDate: '2026-10-05',
    sources: [{ provider: 'issuer' as const, url: 'https://example.com/special-two', verifiedAt: '2026-10-06' }] };
  const result = summarize({ ledger: { ...ledger, events: [...ledger.events, special, second] } });
  const risks = result.risk.evidenceInsufficient.filter(item => item.reason === 'special_dividend_review');
  assert.deepEqual(risks.map(item => ({ id: item.id, sources: item.sources, period: item.reportPeriod, published: item.publishedAt, verified: item.verifiedAt })), [
    { id: 'special_dividend_review:verified-special-one', sources: ['https://example.com/special-one'], period: '2026-09-30', published: '2026-10-01', verified: '2026-10-03' },
    { id: 'special_dividend_review:verified-special-two', sources: ['https://example.com/special-two'], period: '2026-10-01', published: '2026-10-04', verified: '2026-10-06' },
  ]);
  assert.equal(result.actionCheck.buy.reasons.filter(reason => reason === 'special_dividend_review').length, 0);
});

test('eligibility preserves evidence unknown and carries at most three main reasons instead of a risk score', () => {
  const result = summarize({ research: { ...research, checks: [{ rule: 'roe', status: 'unknown' }, { rule: 'yield', status: 'unknown' }, { rule: 'payout', status: 'unknown' }, { rule: 'dividendYears', status: 'unknown' }], status: 'unknown' } });
  assert.equal(result.eligibility.status, 'unknown'); assert.equal(result.eligibility.reasons.length, 3); assert.equal(result.eligibility.checks.length, 4);
  assert.equal(result.risk.attention.length, 0); assert.ok(result.risk.evidenceInsufficient.length >= 4);
});

test('a pure download timestamp change leaves the semantic fingerprint unchanged; a price event changes it', () => {
  const first = summarize();
  const refreshed = summarize({ stock: { ...stock, quote: { ...stock.quote!, fetchedAt: now + 500 } }, now: now + 500 });
  assert.equal(first.freshness.semanticFingerprint, refreshed.freshness.semanticFingerprint);
  const priceChanged = summarize({ stock: { ...stock, quote: { ...stock.quote!, priceMinor: 1100 } } });
  assert.notEqual(first.freshness.semanticFingerprint, priceChanged.freshness.semanticFingerprint);
});

const fund: DividendFund = { id: 'synthetic-fund', code: '515450', name: 'Synthetic fund', indexKind: 'low_volatility', weightBps: 10000,
  quote: { date: `${asOf} 10:00`, priceMicros: 900000, fetchedAt: now }, reference: { asOf, highMicros: 1100000, indexYieldBps: 550 } };
const fundPlan = { ...defaultDividendFundPlan(), budgetMinor: 1000000, mode: 'swing' as const, funds: [fund] };
test('funds preserve their own drawdown/index-yield/high-price engine and never receive a stock dividend ladder', () => {
  const before = structuredClone(fundPlan), result = dividendFundCheckSummary({ plan: fundPlan, fund, shares: 1000, asOf, now });
  assert.deepEqual(result.fundPlan, buildDividendFundHomePlan(fundPlan, fund, asOf)); assert.deepEqual(fundPlan, before);
  assert.equal(result.trigger.buy, 'triggered'); assert.deepEqual(result.grid.buyLevels, []); assert.deepEqual(result.grid.sellLevels, []);
  assert.equal(result.grid.entryPriceMicros, 990000); assert.equal(result.actionCheck.buy.status, 'review');
});

test('a dated fund index yield and a manual price are never promoted to a current executable quote', () => {
  const oldYield = dividendFundCheckSummary({ plan: fundPlan, fund: { ...fund, reference: { ...fund.reference!, asOf: '2026-10-29' } }, asOf, now });
  assert.equal(oldYield.eligibility.status, 'pass'); assert.equal(oldYield.trigger.buy, 'triggered');
  assert.ok(!oldYield.risk.evidenceInsufficient.some(item => item.reason === 'index_yield_prior_date'));
  const manual = dividendFundCheckSummary({ plan: fundPlan, fund: { ...fund, quote: undefined, reference: { ...fund.reference!, priceMicros: 900000 } }, asOf, now });
  assert.equal(manual.trigger.buy, 'unknown'); assert.ok(manual.risk.evidenceInsufficient.some(item => item.reason === 'quote_missing'));
});

test('legacy either/both settings no longer make informational index yield a price trigger gate', () => {
  const noYield = { ...fund, reference: { ...fund.reference!, indexYieldBps: undefined } };
  const either = dividendFundCheckSummary({ plan: { ...fundPlan, entryRule: 'either' }, fund: noYield, asOf, now });
  assert.equal(either.eligibility.status, 'pass'); assert.equal(either.trigger.buy, 'triggered');
  const both = dividendFundCheckSummary({ plan: fundPlan, fund: noYield, asOf, now });
  assert.equal(both.eligibility.status, 'pass'); assert.equal(both.trigger.buy, 'triggered');
});

test('quote parsing rejects invalid times and preserves a closed-session current-day price fact without pretending it can trade', () => {
  const invalid = dividendQuoteUsability({ quote: { date: `${asOf} 25:00`, priceMinor: 900 }, asOf, now });
  assert.equal(invalid.status, 'unknown');
  const closed = dividendQuoteUsability({ quote: { date: `${asOf} 15:00`, priceMinor: 900 }, asOf, now: Date.parse(`${asOf}T12:00:00Z`) });
  assert.equal(closed.status, 'current'); assert.equal(closed.sessionConfirmed, false);
});

test('malformed evidence and a partial cached financial section downgrade one item instead of crashing the collection', () => {
  const invalidLedger = { ...ledger, events: undefined } as unknown as typeof ledger;
  const malformedResearch = { ...research, financial: { periods: [] } } as unknown as DividendStockResearch;
  const result = summarize({ ledger: invalidLedger, research: malformedResearch });
  assert.equal(result.freshness.evidenceStatus, 'invalid'); assert.equal(result.grid.status, 'saved_unverified');
  assert.equal(result.freshness.reportPeriod, undefined);
  const invalidPricing = summarize({ research: { ...research, pricing: { calculationVersion: 5 } } as unknown as DividendStockResearch });
  assert.ok(invalidPricing.risk.evidenceInsufficient.some(item => item.reason === 'pricing_invalid'));
});
