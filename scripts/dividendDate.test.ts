import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDividendHomePlan, dateInChina, defaultDividendStocks, trailingYearStart } from '../src/lib/dividendWorkbench.ts';

test('research date uses the Shanghai calendar and a stable ISO key across locale layouts', t => {
  const original = Intl.DateTimeFormat;
  t.mock.method(Intl, 'DateTimeFormat', function (locale, options) {
    const formatter = new original(locale, options);
    return { format: () => '10/21/2026', formatToParts: formatter.formatToParts.bind(formatter) } as Intl.DateTimeFormat;
  });
  assert.equal(dateInChina(new Date('2026-10-20T16:01:00Z')), '2026-10-21');
  assert.equal(dateInChina(new Date('2026-12-31T16:01:00Z')), '2027-01-01');
  assert.equal(trailingYearStart(dateInChina(new Date('2024-02-29T04:00:00Z'))), '2023-02-28');
});

test('home price checks reject failed, future and dated quotes without hiding saved levels', () => {
  const stock = { ...defaultDividendStocks()[0], quote: { priceMinor: 100, date: '2026-10-21', fetchedAt: 1 },
    buyLevels: [{ priceMinor: 200, yieldBps: 500, portionBps: 10000 }],
    sellLevels: [{ priceMinor: 50, yieldBps: 400, portionBps: 10000 }] };
  assert.equal(buildDividendHomePlan(stock, 1000000, 100, '2026-10-21').buyState, 'triggered');
  for (const value of [{ ...stock, quoteFailedAt: 2 }, { ...stock, quote: { ...stock.quote, date: '2026-10-01' } },
    { ...stock, quote: { ...stock.quote, date: '2026-10-22' } }]) {
    const plan = buildDividendHomePlan(value, 1000000, 100, '2026-10-21');
    assert.equal(plan.buyState, 'quote_missing'); assert.equal(plan.sellState, 'quote_missing');
    assert.equal(plan.buy[0].priceMinor, 200); assert.equal(plan.buy[0].touched, false); assert.equal(plan.sell[0].touched, false);
  }
});
