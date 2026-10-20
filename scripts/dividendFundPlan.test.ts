import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDividendFundPlan, dividendFundAllocation, dividendFundEntry, isDividendFund, isDividendFundPlan, type DividendFund } from '../src/lib/dividendFundPlan.ts';
import { dateInChina } from '../src/lib/dividendWorkbench.ts';

const fund = (id: string, weightBps: number, extra: Partial<DividendFund> = {}): DividendFund => ({ id, name: `Planned fund ${id}`, indexKind: 'low_volatility', weightBps, ...extra });

test('fund allocations account for every cent, zero weights and the unassigned reserve', () => {
  const plan = { ...defaultDividendFundPlan(), budgetMinor: 10001, funds: [fund('a', 3333), fund('b', 3333), fund('c', 3334), fund('zero', 0)] };
  const allocation = dividendFundAllocation(plan);
  assert.equal([...allocation.amounts.values()].reduce((sum, amount) => sum + amount, 0), 10001);
  assert.equal(allocation.unallocatedMinor, 0);
  assert.equal(allocation.amounts.get('zero'), 0);
  const partial = dividendFundAllocation({ ...plan, funds: [fund('a', 6000)] });
  assert.equal(partial.amounts.get('a'), 6001);
  assert.equal(partial.unallocatedMinor, 4000);
  assert.equal(dividendFundAllocation(defaultDividendFundPlan()).fundBudgetMinor, 0);
});

test('70:30 divides the strategy budget and weights divide only the dividend sleeve', () => {
  const allocation = dividendFundAllocation({ ...defaultDividendFundPlan(), budgetMinor: 32000000, mode: 'rebalance', funds: [fund('a', 6000), fund('b', 4000)] });
  assert.equal(allocation.fundBudgetMinor, 22400000);
  assert.equal(allocation.bondBudgetMinor, 9600000);
  assert.equal(allocation.amounts.get('a'), 13440000);
  assert.equal(allocation.amounts.get('b'), 8960000);
  const large = dividendFundAllocation({ ...defaultDividendFundPlan(), budgetMinor: 1e14, mode: 'rebalance', funds: [fund('a', 9999)] });
  assert.equal(large.amounts.get('a')! + large.bondBudgetMinor + large.unallocatedMinor, 1e14);
});

test('entry flags require current observations and distinguish both/either from missing inputs', () => {
  const plan = defaultDividendFundPlan();
  const today = dateInChina();
  const current = fund('a', 10000, { reference: { priceMicros: 900000, highMicros: 1000000, indexYieldBps: 500, asOf: today } });
  assert.equal(dividendFundEntry(plan, current).status, 'met');
  assert.equal(dividendFundEntry(plan, current).targetPriceMicros, 900000);
  assert.equal(dividendFundEntry(plan, current).drawdownBps, 1000);
  assert.equal(dividendFundEntry(plan, { ...current, reference: { ...current.reference!, priceMicros: 900001 } }).status, 'wait');
  const yieldOnly = { ...current, reference: { indexYieldBps: 500, asOf: today } };
  assert.equal(dividendFundEntry(plan, yieldOnly).status, 'incomplete');
  assert.equal(dividendFundEntry({ ...plan, entryRule: 'either' }, yieldOnly).status, 'met');
  assert.equal(dividendFundEntry(plan, { ...current, reference: { ...current.reference!, asOf: '2020-01-01' } }).status, 'update');
  assert.equal(dividendFundEntry(plan, fund('missing', 0)).status, 'incomplete');
  assert.equal(dividendFundEntry(plan, { ...current, reference: { ...current.reference!, priceMicros: 1100000 } }).drawdownBps, 0);
});

test('historical highs remain comparison points while current prices and index yields retain their own dates', () => {
  const today = '2026-10-20';
  const plan = defaultDividendFundPlan();
  const dated = fund('a', 10000, {
    code: '512890', reference: { highMicros: 1000000, priceMicros: 850000, indexYieldBps: 500, asOf: '2026-10-08' },
    quote: { priceMicros: 900000, date: `${today} 15:00`, fetchedAt: 10 },
  });
  const result = dividendFundEntry(plan, dated, today);
  assert.equal(result.drawdownBps, 1000);
  assert.equal(result.targetPriceMicros, 900000);
  assert.equal(result.status, 'update');
  assert.deepEqual(result.issues, ['index_yield_prior_date']);
  // The current drawdown alone is sufficient for the OR rule; the historical high is not stale.
  assert.equal(dividendFundEntry({ ...plan, entryRule: 'either' }, dated, today).status, 'met');
  assert.equal(dividendFundEntry({ ...plan, entryRule: 'either' }, { ...dated, reference: { highMicros: 1000000, asOf: '2020-01-01' } }, today).status, 'met');
  // A false current drawdown settles AND without pretending that the old yield was checked.
  assert.equal(dividendFundEntry(plan, { ...dated, quote: { ...dated.quote!, priceMicros: 950000 } }, today).status, 'wait');
  // The same old yield cannot settle OR when the current drawdown is false.
  assert.equal(dividendFundEntry({ ...plan, entryRule: 'either' }, { ...dated, quote: { ...dated.quote!, priceMicros: 950000 } }, today).status, 'update');
  const manualOnly = dividendFundEntry(plan, { ...dated, quote: undefined }, today);
  assert.equal(manualOnly.status, 'update');
  assert.deepEqual(manualOnly.issues, ['price_prior_date', 'index_yield_prior_date']);
  assert.equal(dated.reference?.asOf, '2026-10-08');
});

test('failed or previous-date quotes cannot independently satisfy a drawdown condition', () => {
  const today = '2026-10-20';
  const plan = { ...defaultDividendFundPlan(), entryRule: 'either' as const };
  const current = fund('a', 10000, {
    code: '512890', reference: { highMicros: 1000000, asOf: '2026-10-08' },
    quote: { priceMicros: 900000, date: `${today} 15:00`, fetchedAt: 10 },
  });
  assert.equal(dividendFundEntry(plan, current, today).status, 'met');
  const failed = dividendFundEntry(plan, { ...current, quoteFailedAt: 11 }, today);
  assert.equal(failed.status, 'update');
  assert.ok(failed.issues.includes('quote_refresh_failed'));
  const prior = dividendFundEntry(plan, { ...current, quote: { ...current.quote!, date: '2026-10-19 15:00' } }, today);
  assert.equal(prior.status, 'update');
  assert.ok(prior.issues.includes('price_prior_date'));
});

test('fund validation accepts name-only plans and rejects duplicate, overallocated or malformed data', () => {
  const plan = { ...defaultDividendFundPlan(), funds: [fund('a', 6000), fund('b', 4000, { code: '005827' })] };
  assert.equal(isDividendFundPlan(plan), true);
  for (const invalid of [
    { ...plan, funds: [fund('a', 10001)] }, { ...plan, budgetMinor: 1.5 }, { ...plan, drawdownBps: 0 },
    { ...plan, funds: [fund('a', 7000), fund('b', 4000)] }, { ...plan, funds: [fund('a', 5000), fund('a', 5000)] },
    { ...plan, funds: [fund('a', 5000, { code: '563020' }), fund('b', 5000, { code: '563020' })] },
  ]) assert.equal(isDividendFundPlan(invalid), false);
  for (const invalid of [
    fund('a', 0, { name: ' ' }), { ...fund('a', 0), code: 563020 }, fund('a', 0, { code: 'SH563020' }),
    fund('a', 0, { reference: { asOf: '2026-02-30', priceMicros: 1000000 } }),
    fund('a', 0, { reference: { asOf: '2099-01-01', indexYieldBps: 500 } }),
    fund('a', 0, { reference: { asOf: dateInChina(), priceMicros: 0 } }),
  ]) assert.equal(isDividendFund(invalid), false);
});
