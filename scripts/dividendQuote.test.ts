import test from 'node:test';
import assert from 'node:assert/strict';
import { isDividendMarketQuote, isExchangeTradedFundCode, mainlandQuoteSymbol, parseDividendMarketQuote } from '../src/lib/dividendQuote.ts';
import { defaultDividendFundPlan, dividendFundEntry, isDividendFund, type DividendFund } from '../src/lib/dividendFundPlan.ts';

function row(symbol: string, code: string, price = '1.234', stamp = '20261013161454') {
  const fields = Array(50).fill('');
  fields[2] = code; fields[3] = price; fields[30] = stamp; fields[32] = '-0.49';
  return `v_${symbol}="${fields.join('~')}";`;
}

test('quotes distinguish Shanghai ETF, Shenzhen ETF/LOF and mainland stock venues', () => {
  for (const [code, symbol] of Object.entries({ '512890': 'sh512890', '563020': 'sh563020', '159581': 'sz159581', '161716': 'sz161716', '601398': 'sh601398', '000651': 'sz000651', '920001': 'bj920001' })) {
    assert.equal(mainlandQuoteSymbol(code), symbol);
  }
  for (const code of ['512890', '563020', '159581', '161716', '180301']) assert.equal(isExchangeTradedFundCode(code), true);
  for (const code of ['005561', '100032', '090010', '601398', '000651', '00700', undefined]) assert.equal(isExchangeTradedFundCode(code), false);
  assert.throws(() => mainlandQuoteSymbol('512890,usAAPL'));
});

test('ETF quote parsing retains fractional precision and the provider time', () => {
  const quote = parseDividendMarketQuote(row('sh512890', '512890'), '512890', 100);
  assert.deepEqual(quote, { priceMicros: 1234000, date: '2026-10-13 16:14', changePercent: -0.49, fetchedAt: 100 });
  assert.equal(parseDividendMarketQuote(row('sz159581', '159581', '1.000001'), '159581').priceMicros, 1000001);
  assert.equal(isDividendMarketQuote(quote), true);
});

test('quote parser rejects missing/mismatched prices and invalid calendar/clock times', () => {
  for (const [price, stamp] of [['0', '20261013161454'], ['-1', '20261013161454'], ['bad', '20261013161454'], ['1000001', '20261013161454'], ['1', '20260230161454'], ['1', '20261013241454'], ['1', '20261013166054'], ['1', '20261013161460']]) {
    assert.throws(() => parseDividendMarketQuote(row('sh512890', '512890', price, stamp), '512890'));
  }
  assert.throws(() => parseDividendMarketQuote(row('sz512890', '512890'), '512890'));
  assert.throws(() => parseDividendMarketQuote(row('sh512890', '563020'), '512890'));
  assert.equal(isDividendMarketQuote({ priceMicros: 1.1, date: '2026-10-13 16:14', fetchedAt: 100 }), false);
});

test('automatic fund prices drive drawdown without redating manual high/yield observations', () => {
  const plan = defaultDividendFundPlan();
  const fund: DividendFund = { id: 'f', name: 'ETF', code: '512890', indexKind: 'low_volatility', weightBps: 0,
    reference: { priceMicros: 1000000, highMicros: 1000000, indexYieldBps: 500, asOf: '2026-10-13' },
    quote: { priceMicros: 900000, date: '2026-10-13 16:14', fetchedAt: 100 },
  };
  assert.equal(isDividendFund(fund), true);
  assert.equal(dividendFundEntry(plan, fund, '2026-10-13').status, 'met');
  assert.equal(dividendFundEntry(plan, fund, '2026-10-13').drawdownBps, 1000);
  assert.equal(dividendFundEntry(plan, { ...fund, reference: { ...fund.reference!, asOf: '2026-10-12' } }, '2026-10-13').status, 'update');
  assert.equal(dividendFundEntry(plan, { ...fund, quote: { ...fund.quote!, date: '2026-10-12 16:14' } }, '2026-10-13').status, 'update');
  assert.equal(dividendFundEntry(plan, { ...fund, quoteFailedAt: 101 }, '2026-10-13').status, 'update');
  assert.equal(isDividendFund({ ...fund, code: '005561' }), false);
  assert.equal(isDividendFund({ ...fund, quoteFailedAt: -1 }), false);
});
