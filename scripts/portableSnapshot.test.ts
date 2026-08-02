import test from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRecord, Holding, HoldingTxn } from '../src/db.ts';
import type { AccountWithLatest } from '../src/services/assetService.ts';
import type { PlanStatus } from '../src/services/planService.ts';
import {
  buildPortableSnapshot as buildAutomaticSnapshot,
  getDefaultSnapshotFocusAccountIds,
  getSnapshotFocusAccountIds,
} from '../src/lib/portableSnapshot.ts';

const focusAccount: AccountWithLatest = {
  id: 'focus-account',
  name: '日常投资账户',
  category: '股票/ETF',
  type: 'asset',
  currency: 'CNY',
  portfolio: true,
  cashBalance: 40,
  createdAt: 1,
  sortOrder: 0,
  latestAmount: 700,
  latestDate: '2026-07-13',
  convertedAmount: 700,
};

const reserveAccount: AccountWithLatest = {
  id: 'reserve-account',
  name: '定期储蓄',
  category: '银行存款',
  type: 'asset',
  currency: 'CNY',
  productData: { rate: '2.0%', maturity: '2026-12-31' },
  createdAt: 2,
  sortOrder: 1,
  latestAmount: 300,
  latestDate: '2026-07-13',
  convertedAmount: 300,
};

const archivedAccount: AccountWithLatest = {
  ...reserveAccount,
  id: 'archived-account',
  name: '已归档账户',
  archivedAt: 3,
};

const holding: Holding = {
  id: 'holding-1',
  accountId: focusAccount.id,
  name: '宽基指数基金',
  symbol: 'INDEX',
  market: 'A股',
  lastPrice: 110,
  priceDate: '2026-07-10',
  sortOrder: 0,
  createdAt: 10,
};

const transactions: HoldingTxn[] = [
  { id: 'buy', accountId: focusAccount.id, holdingId: holding.id, date: '2026-07-01', kind: 'buy', shares: 10, price: 100, createdAt: 11 },
  { id: 'sell', accountId: focusAccount.id, holdingId: holding.id, date: '2026-07-12', kind: 'sell', shares: 4, price: 120, createdAt: 12 },
];

const records: AccountRecord[] = [
  { id: 'focus-record', accountId: focusAccount.id, date: '2026-07-13', amount: 700, createdAt: 20 },
  { id: 'reserve-record', accountId: reserveAccount.id, date: '2026-07-13', amount: 300, kind: 'sell', deltaAmount: 50, createdAt: 21 },
];

const planStatus: PlanStatus = {
  totalAssets: 1000,
  base: 1000,
  targetPercentSum: 100,
  allocationWarnings: [],
  unavailableValuationCount: 0,
  unplanned: [],
  equityAccounts: [],
  items: [
    {
      id: 'plan-growth', name: '成长配置', targetPercent: 60, categories: [`acct:${focusAccount.id}`],
      allocations: [{ refKey: 'h:holding', amountMinor: 60_000 }], sortOrder: 0, createdAt: 1,
      currentValue: 700, currentPercent: 70, targetValue: 600, gapValue: -100, gapPercent: -10,
      targets: [{
        id: 'target-index', planItemId: 'plan-growth', label: '指数配置', name: '指数配置', refKeys: ['h:holding'],
        allocations: [{ refKey: 'h:holding', amountMinor: 50_000 }],
        targetPercent: 50, targetAmount: 500, currency: 'CNY', currentValue: 660, gapValue: -160,
        linkedProducts: [{
          refKey: 'h:holding', name: '指数基金', kind: 'holding', accountId: focusAccount.id, currency: 'CNY',
          currentValue: 660, primaryValue: 660, sourceCurrentValue: 660, sourcePrimaryValue: 660,
          usesRemainder: true, overAllocated: false,
        }],
        sortOrder: 0, createdAt: 3,
      }],
      targetPercentSum: 50, candidates: [],
    },
    {
      id: 'plan-reserve', name: '稳健配置', targetPercent: 40, categories: [`acct:${reserveAccount.id}`], sortOrder: 1, createdAt: 2,
      currentValue: 300, currentPercent: 30, targetValue: 400, gapValue: 100, gapPercent: 10,
      targets: [], targetPercentSum: 0, candidates: [],
    },
  ],
};

const emptyPlanStatus = (totalAssets: number, unavailableValuationCount = 0): PlanStatus => ({
  items: [],
  totalAssets,
  base: totalAssets,
  targetPercentSum: 0,
  allocationWarnings: [],
  unavailableValuationCount,
  unplanned: [],
  equityAccounts: [],
});

test('snapshot focus labels are optional and only accept active accounts', () => {
  assert.deepEqual(getDefaultSnapshotFocusAccountIds(), []);
  assert.deepEqual(
    getSnapshotFocusAccountIds(
      [focusAccount, reserveAccount, archivedAccount],
      [focusAccount.id, archivedAccount.id, 'missing-account'],
    ),
    [focusAccount.id],
  );
});

test('automatic snapshot v7 exports all active accounts and marks optional focus accounts', () => {
  const snapshot = buildAutomaticSnapshot({
    accounts: [focusAccount, reserveAccount, archivedAccount],
    records,
    holdings: [holding],
    transactions,
    exchangeRates: [{ id: 'CNY_USD', base: 'CNY', quote: 'USD', rate: 0.14, date: '2026-07-13', updatedAt: Date.parse('2026-07-13T01:00:00Z') }],
    planStatus,
    settings: { primaryCurrency: 'CNY', snapshotFocusAccountIds: [focusAccount.id] },
    generatedAt: new Date('2026-07-13T02:00:00.000Z'),
    trigger: 'test',
  });

  assert.equal(snapshot.schemaVersion, 7);
  assert.equal(snapshot.accountCount, 2);
  assert.equal(snapshot.focusAccountCount, 1);
  assert.deepEqual(snapshot.totals, {
    assets: 1000,
    liabilities: 0,
    netWorth: 1000,
    knownAssets: 1000,
    knownLiabilities: 0,
    knownNetWorth: 1000,
    missingAssetCount: 0,
    missingLiabilityCount: 0,
    isComplete: true,
  });
  assert.deepEqual(snapshot.categorySummary.map(row => [row.category, row.value]), [['股票/ETF', 700], ['银行存款', 300]]);
  assert.equal(snapshot.generatedAt, '2026-07-13T02:00:00.000Z');
  assert.equal(snapshot.accounts[0].isFocusAccount, true);
  assert.equal(snapshot.accounts[0].includedInTotals, true);
  assert.equal(snapshot.accounts[0].hiddenInApp, false);
  assert.equal(snapshot.accounts[1].isFocusAccount, false);
  assert.equal(snapshot.accounts[1].productData?.maturity, '2026-12-31');
  assert.equal(snapshot.allocationPlan.items[0].action, 'reduce');
  assert.equal(snapshot.allocationPlan.items[0].targets[0].targetPercent, 50);
  assert.equal(snapshot.allocationPlan.items[0].targets[0].targetAmount, 500);
  assert.deepEqual(snapshot.allocationPlan.items[0].targets[0].refKeys, ['h:holding']);
  assert.equal(snapshot.allocationPlan.items[0].resourceAllocations[0].amount, 600);
  assert.equal(snapshot.allocationPlan.items[0].targets[0].resourceAllocations[0].amount, 500);
  assert.equal(snapshot.allocationPlan.items[0].targets[0].linkedProducts[0].name, '指数基金');
  assert.equal(snapshot.allocationPlan.items[1].action, 'increase');
  assert.equal(snapshot.accounts[0].transactions[0].id, 'sell');
  assert.equal(snapshot.accounts[1].records[0].amount, 300);
  assert.equal(snapshot.accounts[1].records[0].deltaAmount, 50);
  assert.equal(snapshot.accounts[1].records[0].balanceAdjustment, false);

  const position = snapshot.accounts[0].holdings[0];
  assert.equal(position.status, 'active');
  assert.equal(position.shares, 6);
  assert.equal(position.averageCost, 100);
  assert.equal(position.dilutedCost, 86.666667);
  assert.equal(position.netInvested, 520);
  assert.equal(position.marketValue, 660);
  assert.equal(position.unrealizedPnl, 60);
  assert.equal(position.realizedPnl, 80);
  assert.equal(position.totalPnl, 140);
  assert.equal(position.totalPnlRate, 26.923077);
  assert.equal(position.priceDate, '2026-07-10');

  assert.doesNotMatch(JSON.stringify(snapshot), /哨兵|GPT|Claude|快账户/i);
});

test('hidden accounts still count in totals while excluded accounts do not', () => {
  const hiddenAccount: AccountWithLatest = { ...reserveAccount, hidden: true };
  const excludedAccount: AccountWithLatest = { ...focusAccount, includeInTotals: false };
  const snapshot = buildAutomaticSnapshot({
    accounts: [hiddenAccount, excludedAccount],
    records: [],
    holdings: [],
    transactions: [],
    exchangeRates: [],
    planStatus: emptyPlanStatus(300),
    settings: { primaryCurrency: 'CNY', snapshotFocusAccountIds: [] },
  });

  assert.equal(snapshot.accountCount, 2);
  assert.equal(snapshot.includedAccountCount, 1);
  assert.equal(snapshot.hiddenAccountCount, 1);
  assert.equal(snapshot.totals.assets, 300);
  assert.deepEqual(snapshot.categorySummary.map(row => [row.category, row.value]), [['银行存款', 300]]);
  assert.equal(snapshot.accounts.find(account => account.id === hiddenAccount.id)?.includedInTotals, true);
  assert.equal(snapshot.accounts.find(account => account.id === hiddenAccount.id)?.hiddenInApp, true);
  assert.equal(snapshot.accounts.find(account => account.id === excludedAccount.id)?.includedInTotals, false);
  assert.equal(snapshot.accounts.find(account => account.id === excludedAccount.id)?.hiddenInApp, false);
});

test('automatic snapshot keeps unavailable conversions as unknown instead of zero', () => {
  const foreignAccount: AccountWithLatest = {
    ...reserveAccount,
    id: 'foreign-account',
    name: 'Foreign savings',
    currency: 'USD',
    latestAmount: 100,
    convertedAmount: 0,
    conversionUnavailable: true,
  };
  const metalAccount: AccountWithLatest = {
    ...reserveAccount,
    id: 'metal-account',
    name: 'Gold holding',
    category: '贵金属',
    currency: 'CNY',
    unit: 'gram',
    metalType: 'XAU',
    latestAmount: 5,
    metalValueInCurrency: 0,
    convertedAmount: 0,
    conversionUnavailable: true,
  };
  const snapshot = buildAutomaticSnapshot({
    accounts: [foreignAccount, metalAccount],
    records: [],
    holdings: [],
    transactions: [],
    exchangeRates: [],
    planStatus: emptyPlanStatus(0, 2),
    settings: { primaryCurrency: 'CNY', snapshotFocusAccountIds: [] },
  });

  assert.equal(snapshot.totals.assets, null);
  assert.equal(snapshot.totals.knownAssets, 0);
  assert.equal(snapshot.totals.missingAssetCount, 2);
  assert.equal(snapshot.accounts[0].convertedValue, null);
  assert.equal(snapshot.accounts[0].nativeMonetaryValue, 100);
  assert.equal(snapshot.accounts[0].conversionStatus, 'unavailable');
  assert.equal(snapshot.accounts[1].nativeMonetaryValue, null);
  assert.equal(snapshot.totalsByCurrency.USD.assets, 100);
  assert.equal(snapshot.totalsByCurrency.CNY.assets, null);
  assert.equal(snapshot.categorySummary.find(row => row.category === '银行存款')?.value, null);
  assert.equal(snapshot.allocationPlan.totalAssets, null);
  assert.equal(snapshot.allocationPlan.valuationComplete, false);
  assert.match(snapshot.dataQualityWarnings.join('\n'), /converted value unavailable/);
});

test('automatic snapshot applies an option contract multiplier to transaction amounts', () => {
  const optionAccount: AccountWithLatest = {
    id: 'option-account',
    name: '期权账户',
    category: '股票/ETF',
    type: 'asset',
    currency: 'USD',
    portfolio: true,
    cashBalance: 0,
    createdAt: 30,
    sortOrder: 0,
    latestAmount: 501,
    latestDate: '2026-07-22',
    convertedAmount: 501,
  };
  const optionHolding: Holding = {
    id: 'option-holding',
    accountId: optionAccount.id,
    name: 'ACME 看涨期权',
    symbol: 'ACME280121C00010000',
    market: '美股',
    instrumentType: 'us_option',
    optionUnderlying: 'ACME',
    optionExpiration: '2028-01-21',
    optionRight: 'call',
    optionStrikeMilli: 10_000,
    contractMultiplier: 100,
    lastPrice: 5.01,
    priceDate: '2026-07-22',
    sortOrder: 0,
    createdAt: 31,
  };
  const optionTransactions: HoldingTxn[] = [
    { id: 'option-buy', accountId: optionAccount.id, holdingId: optionHolding.id, date: '2026-07-01', kind: 'buy', shares: 2, price: 4, createdAt: 32 },
    { id: 'option-sell', accountId: optionAccount.id, holdingId: optionHolding.id, date: '2026-07-22', kind: 'sell', shares: 1, price: 5, createdAt: 33 },
  ];

  const snapshot = buildAutomaticSnapshot({
    accounts: [optionAccount],
    records: [],
    holdings: [optionHolding],
    transactions: optionTransactions,
    exchangeRates: [],
    planStatus: emptyPlanStatus(501),
    settings: { primaryCurrency: 'USD', snapshotFocusAccountIds: [] },
  });
  const exportedHolding = snapshot.accounts[0].holdings[0];
  const exportedTransactions = snapshot.accounts[0].transactions;

  assert.equal(exportedHolding.optionContract?.multiplier, 100);
  assert.equal(exportedHolding.marketValue, 501);
  assert.equal(exportedTransactions.find(transaction => transaction.id === 'option-buy')?.amount, 800);
  assert.equal(exportedTransactions.find(transaction => transaction.id === 'option-sell')?.amount, 500);
});
