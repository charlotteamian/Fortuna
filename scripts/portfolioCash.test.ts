import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { calculatePortfolioCash } from '../src/lib/portfolioCash.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { db, initializeSettings } = await import('../src/db.ts');
const { addHoldingTxn, createHolding, getHoldingsWithPositions, setCalculatedCashBalance, setCashBalance, updateHoldingPositions, updatePrices, setAccountPortfolioMode } = await import('../src/services/holdingService.ts');
const { formatLocalDate } = await import('../src/lib/localDate.ts');

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.accounts.add({ id: 'stocks', name: 'Strategy', category: '股票/ETF', type: 'asset', currency: 'CNY', portfolio: true, cashBalance: 100, sortOrder: 0, createdAt: 1 });
});
after(() => db.close());

async function latestTotal() {
  return (await db.records.where('accountId').equals('stocks').toArray())
    .filter(record => record.date === formatLocalDate())[0]?.amount;
}

test('reverse cash follows realised gains and losses, changed quotes, and fully closed holdings', async () => {
  const holdingId = await createHolding('stocks', { name: 'ETF', symbol: '510300', lastPrice: 10 });
  await addHoldingTxn('stocks', holdingId, { date: '2000-01-01', kind: 'buy', shares: 40, price: 10 });
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 100, 'existing manual cash remains unchanged');
  await setCalculatedCashBalance('stocks', 100000);
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 600);
  assert.equal(await latestTotal(), 1000);

  await addHoldingTxn('stocks', holdingId, { date: '2000-01-02', kind: 'sell', shares: 10, price: 12 });
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 660, '1000 + 20 realised gain - 360 market value');
  assert.equal(await latestTotal(), 1020);
  await addHoldingTxn('stocks', holdingId, { date: '2000-01-03', kind: 'sell', shares: 10, price: 8 });
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 840, '1000 + 20 gain - 20 loss - 160 market value');
  await updatePrices('stocks', { [holdingId]: 9 }, '2000-01-04');
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 820);
  assert.equal(await latestTotal(), 1000);

  await addHoldingTxn('stocks', holdingId, { date: '2000-01-05', kind: 'sell', shares: 20, price: 11 });
  assert.equal((await getHoldingsWithPositions('stocks'))[0].position.shares, 0);
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 1020, 'closed holdings retain their realised P&L');
  assert.equal(await latestTotal(), 1020);
});

test('reverse cash may be negative and follows quantity corrections; manual mode can be restored', async () => {
  const holdingId = await createHolding('stocks', { name: 'ETF', symbol: '510300', lastPrice: 20 });
  await addHoldingTxn('stocks', holdingId, { date: '2000-01-01', kind: 'buy', shares: 100, price: 20 });
  await setCalculatedCashBalance('stocks', 10000);
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, -1900);
  assert.equal(await latestTotal(), 100);
  await updateHoldingPositions('stocks', [{ holdingId, shares: 50, price: 10 }], '2000-01-02');
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, -400);
  assert.equal(await latestTotal(), 100);
  await setCashBalance('stocks', 123.45);
  await updatePrices('stocks', { [holdingId]: 15 }, '2000-01-03');
  assert.equal((await db.accounts.get('stocks'))?.cashCalculationMode, 'manual');
  assert.equal((await db.accounts.get('stocks'))?.cashBalance, 123.45);
  assert.equal(await latestTotal(), 873.45);
});

test('reverse-cash initial amount is persisted as integer minor units and invalid inputs do not change it', async () => {
  await setCalculatedCashBalance('stocks', 123456);
  const before = await db.accounts.get('stocks');
  assert.equal(before?.cashInitialAmountMinor, 123456);
  for (const value of [-1, 1.2, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(setCalculatedCashBalance('stocks', value), /PORTFOLIO_CASH_INVALID/);
    assert.deepEqual(await db.accounts.get('stocks'), before);
  }
  await db.accounts.update('stocks', { category: '银行存款' });
  await assert.rejects(setCalculatedCashBalance('stocks', 100), /PORTFOLIO_CASH_UNSUPPORTED/);
});

test('minor-unit arithmetic rounds totals once and disabling the portfolio preserves its total only', async () => {
  const account = (await db.accounts.get('stocks'))!;
  const result = calculatePortfolioCash({ ...account, cashCalculationMode: 'initial-minus-holdings', cashInitialAmountMinor: 100 }, [
    { marketValue: 0.1, position: { realizedPnl: 0.1 } },
    { marketValue: 0.2, position: { realizedPnl: 0.2 } },
  ]);
  assert.equal(result.cashMinor, 100);
  assert.equal(result.marketValueMinor, 30);
  assert.equal(result.realizedPnlMinor, 30);
  await setCalculatedCashBalance('stocks', 10000);
  await setAccountPortfolioMode('stocks', false);
  const saved = await db.accounts.get('stocks');
  assert.equal(saved?.portfolio, undefined);
  assert.equal(saved?.cashInitialAmountMinor, undefined);
  assert.equal(saved?.cashCalculationMode, undefined);
  assert.equal(await latestTotal(), 100);
});

test('a failed account snapshot rolls back the initial amount, mode, and cached cash together', async () => {
  const before = await db.accounts.get('stocks');
  const originalAdd = db.records.add;
  db.records.add = async () => { throw new Error('SYNTHETIC_CASH_SNAPSHOT_FAILURE'); };
  try {
    await assert.rejects(setCalculatedCashBalance('stocks', 100000), /SYNTHETIC_CASH_SNAPSHOT_FAILURE/);
    assert.deepEqual(await db.accounts.get('stocks'), before);
    assert.equal(await db.records.count(), 0);
  } finally { db.records.add = originalAdd; }
});
