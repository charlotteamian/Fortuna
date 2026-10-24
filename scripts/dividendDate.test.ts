import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDividendHomePlan, dateInChina, defaultDividendStocks, trailingYearStart } from '../src/lib/dividendWorkbench.ts';
import { dividendPricingAnnuals } from '../src/lib/dividendPricing.ts';
import { parseDividendDistributionResearch } from '../src/lib/dividendResearch.ts';

const envelope = (data: Record<string, unknown>[]) => ({ success: true, result: { pages: 1, data } });
const boundaryCode = '000777';
const boundaryFinancials = envelope(Array.from({ length: 6 }, (_, index) => {
  const year = 2025 - index;
  return { SECURITY_CODE: boundaryCode, REPORT_DATE: `${year}-12-31`, NOTICE_DATE: `${year + 1}-03-30`,
    EPSJB: 1, EPSKCJB: 1, PARENTNETPROFIT: 100 };
}));
const boundaryDistributions = envelope(Array.from({ length: 6 }, (_, index) => {
  const year = 2025 - index;
  return { SECURITY_CODE: boundaryCode, REPORT_DATE: `${year}-12-31`, NOTICE_DATE: `${year + 1}-05-01`,
    EX_DIVIDEND_DATE: `${year + 1}-06-01`, PRETAX_BONUS_RMB: 5, TOTAL_SHARES: 100, ASSIGN_PROGRESS: '实施' };
}));

test('pricing and screening share the August distribution-completion boundary across calendar years', () => {
  for (const [asOf, latestYear] of [
    ['2026-07-31', 2024], ['2026-08-01', 2025], ['2026-12-31', 2025], ['2027-01-01', 2025],
  ] as const) {
    const pricing = dividendPricingAnnuals(boundaryFinancials, undefined, boundaryDistributions, boundaryCode, asOf);
    const screening = parseDividendDistributionResearch(boundaryDistributions, boundaryCode, asOf);
    assert.equal(pricing[0].year, latestYear, asOf);
    assert.equal(screening.latestCompletedYear, latestYear, asOf);
    assert.deepEqual(pricing.map(annual => annual.year), Array.from({ length: 5 }, (_, index) => latestYear - index), asOf);
    for (const annual of pricing) {
      assert.equal(annual.dividendMicros, screening.annualDpsMicros[String(annual.year)], asOf);
    }
  }
});

test('the completion window cannot admit future disclosures, future ex dates or proposed cash', () => {
  const asOf = '2026-08-01';
  const futureFinancials = envelope([{ ...boundaryFinancials.result.data[0], NOTICE_DATE: '2026-08-02' }]);
  const futureDisclosure = envelope([{ ...boundaryDistributions.result.data[0], NOTICE_DATE: '2026-08-02' }]);
  const unpublished = dividendPricingAnnuals(futureFinancials, undefined, futureDisclosure, boundaryCode, asOf)[0];
  assert.equal(unpublished.year, 2025);
  assert.equal(unpublished.epsMicros, undefined);
  assert.equal(unpublished.dividendMicros, undefined);
  assert.equal(unpublished.dividendCashMinor, undefined);
  assert.equal(unpublished.payoutBps, undefined);

  const pendingCash = envelope([
    { ...boundaryDistributions.result.data[0], ASSIGN_PROGRESS: '董事会预案' },
    { ...boundaryDistributions.result.data[0], EX_DIVIDEND_DATE: '2026-08-02' },
  ]);
  const pricing = dividendPricingAnnuals(boundaryFinancials, undefined, pendingCash, boundaryCode, asOf)[0];
  const screening = parseDividendDistributionResearch(pendingCash, boundaryCode, asOf);
  assert.equal(pricing.dividendMicros, undefined);
  assert.equal(pricing.dividendCashMinor, undefined);
  assert.equal(pricing.payoutBps, undefined);
  assert.equal(screening.annualDpsMicros['2025'], undefined);
  assert.equal(screening.dpsMicros, 0);
  assert.equal(screening.consecutiveYears, 0);
});

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
