import assert from 'node:assert/strict';
import test from 'node:test';
import { dividendFundCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { defaultDividendFundPlan, type DividendFund, type DividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { dividendFundTodayAction } from '../src/lib/dividendFundToday.ts';

const today = '2026-11-04';
const now = Date.parse(`${today}T16:00:00+08:00`);
const fund: DividendFund = {
  id: 'fund-a', name: 'Fund A', code: '512890', indexKind: 'low_volatility', weightBps: 10000,
  quote: { priceMicros: 900000, date: `${today} 15:00`, fetchedAt: now },
  reference: { highMicros: 1000000, indexYieldBps: 500, asOf: today },
};
const plan: DividendFundPlan = { ...defaultDividendFundPlan(), budgetMinor: 1000000, funds: [fund] };
const check = (value = fund, settings = plan, shares?: number) => dividendFundCheckSummary({ plan: settings, fund: value, asOf: today, now, shares });

test('today separates entry conditions and allocated targets from an executable order', () => {
  const result = check();
  assert.equal(dividendFundTodayAction(result, plan.mode), 'buy');
  assert.equal(result.actionCheck.shares, null);
  assert.equal(result.actionCheck.buy.status, 'unknown');
  assert.equal(result.actionCheck.budgetMinor, 1000000);
  for (const budgetMinor of [0, undefined]) {
    assert.equal(dividendFundTodayAction(check(fund, { ...plan, budgetMinor }), plan.mode), 'allocate');
  }
});

test('today never reports a fresh trigger from stale, missing, failed or manual-only quotes', () => {
  for (const value of [
    { ...fund, quote: { ...fund.quote!, date: '2026-11-03 15:00' } },
    { ...fund, quote: undefined },
    { ...fund, quoteFailedAt: now },
    { ...fund, quote: undefined, reference: { ...fund.reference!, priceMicros: 800000 } },
  ]) {
    assert.equal(dividendFundTodayAction(check(value), plan.mode), 'update');
  }
});

test('today uses price-only entry conditions regardless of legacy index-yield settings', () => {
  const aboveEntry = { ...fund, quote: { ...fund.quote!, priceMicros: 950000 }, reference: { ...fund.reference!, asOf: '2026-11-03' } };
  assert.equal(dividendFundTodayAction(check(aboveEntry), plan.mode), 'wait');
  assert.equal(dividendFundTodayAction(check(aboveEntry, { ...plan, entryRule: 'either' }), plan.mode), 'wait');
  const drawdownOnly = { ...fund, reference: { ...fund.reference!, indexYieldBps: undefined } };
  assert.equal(dividendFundTodayAction(check(drawdownOnly, { ...plan, entryRule: 'either' }), plan.mode), 'buy');
});

test('today prioritises a swing exit reference without inventing shares or sell rules', () => {
  const atHigh = { ...fund, quote: { ...fund.quote!, priceMicros: 1000000 } };
  const swing = { ...plan, mode: 'swing' as const };
  assert.equal(dividendFundTodayAction(check(atHigh, swing), 'swing'), 'sell');
  assert.equal(dividendFundTodayAction(check(atHigh, swing, 0), 'swing'), 'wait');
  for (const mode of ['hold', 'rebalance'] as const) {
    assert.equal(dividendFundTodayAction(check(atHigh, { ...plan, mode }), mode), 'wait');
  }
  const original = structuredClone(plan);
  dividendFundTodayAction(check(), plan.mode);
  assert.deepEqual(plan, original);
});
