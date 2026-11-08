import assert from 'node:assert/strict';
import test from 'node:test';
import { isDividendTradingDay, latestTradingDayOnOrBefore } from '../src/lib/dividendTradingCalendar.ts';
import { dividendQuoteUsability } from '../src/lib/dividendQuoteUsability.ts';
import { dividendFundCheckSummary } from '../src/lib/dividendCheckSummary.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';

test('exchange closures include weekday holidays while adjusted working weekends remain closed', () => {
  for (const date of ['2026-02-23', '2026-05-05', '2026-09-25', '2026-10-07', '2026-10-10', '2025-10-08']) assert.equal(isDividendTradingDay(date), false, date);
  assert.equal(isDividendTradingDay('2026-10-08'), true);
  assert.equal(latestTradingDayOnOrBefore('2026-10-07'), '2026-09-30');
});

test('only non-trading days accept the 36-hour fetch window, with the same rule for funds', () => {
  for (const asOf of ['2026-11-08', '2026-10-05']) {
    const now = Date.parse(`${asOf}T16:00:00+08:00`);
    const date = `${latestTradingDayOnOrBefore(asOf)} 15:00`;
    const quote = { date, priceMicros: 800000, fetchedAt: now - 36 * 3600000 };
    const fund = { id: 'a', name: 'Synthetic', code: '512890', indexKind: 'other' as const, weightBps: 10000, quote, reference: { highMicros: 1000000, asOf } };
    const plan = { ...defaultDividendFundPlan(), budgetMinor: 1000000, funds: [fund] };
    const result = dividendFundCheckSummary({ plan, fund, asOf, now, shares: 0 });
    assert.equal(result.trigger.quote.status, 'current'); assert.equal(result.fundPlan.entry.status, 'met');
    assert.equal(result.trigger.buy, 'triggered'); assert.equal(result.trigger.quote.sessionConfirmed, false);
    const expired = dividendFundCheckSummary({ plan, fund: { ...fund, quote: { ...quote, fetchedAt: quote.fetchedAt - 1 } }, asOf, now });
    assert.equal(expired.trigger.quote.status, 'last_available'); assert.equal(expired.trigger.buy, 'unknown');
    assert.ok(expired.risk.evidenceInsufficient.some(item => item.reason === 'quote_prior_date'));
  }
  const asOf = '2026-11-09', now = Date.parse(`${asOf}T16:00:00+08:00`);
  assert.equal(dividendQuoteUsability({ quote: { date: '2026-11-06 15:00', priceMinor: 900, fetchedAt: now }, asOf, now }).status, 'last_available');
  assert.equal(dividendQuoteUsability({ quote: { date: `${asOf} 15:00`, priceMinor: 900 }, asOf, now }).status, 'current');
});

test('non-trading-day refreshes cannot promote invalid, future or over-ten-day-old quote facts', () => {
  const asOf = '2026-11-08', now = Date.parse(`${asOf}T16:00:00+08:00`);
  for (const quote of [
    { date: '2026-10-28 15:00', priceMinor: 900, fetchedAt: now },
    { date: '2026-11-09 15:00', priceMinor: 900, fetchedAt: now },
    { date: '2026-11-06 25:00', priceMinor: 900, fetchedAt: now },
    { date: '2026-11-06 15:00', priceMinor: 900, fetchedAt: now + 1 },
  ]) assert.notEqual(dividendQuoteUsability({ quote, asOf, now }).status, 'current');
});
