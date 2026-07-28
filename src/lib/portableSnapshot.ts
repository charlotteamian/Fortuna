import type {
  Account,
  AccountRecord,
  ExchangeRate,
  Holding,
  HoldingTxn,
  Settings,
} from '../db';
import { CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION } from './snapshotSchema.ts';
import type { AccountWithLatest } from '../services/assetService';
import type { PlanStatus } from '../services/planService';
import {
  computeBalanceHoldingPosition,
  computeHoldingPnl,
  computeHoldingPosition,
} from './holdingPosition.ts';
import { getHoldingMode } from './productPortfolio.ts';
import { minorToMajor } from './allocationPlan.ts';
import { getHoldingContractMultiplier, resolveUsOptionContract, toUsOptionSymbol } from './usOption.ts';

export const AUTOMATIC_SNAPSHOT_FILE = 'fortuna_asset_snapshot.json';

export interface PortableSnapshotInput {
  accounts: AccountWithLatest[];
  records: AccountRecord[];
  holdings: Holding[];
  transactions: HoldingTxn[];
  exchangeRates: ExchangeRate[];
  planStatus: PlanStatus;
  settings: Pick<Settings, 'primaryCurrency' | 'snapshotFocusAccountIds'>;
  generatedAt?: Date;
  trigger?: string;
}

const round = (value: number, digits = 6) => {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

const allocationAction = (gap: number, tolerance: number) => {
  if (Math.abs(gap) <= tolerance) return 'on_track' as const;
  return gap > 0 ? 'increase' as const : 'reduce' as const;
};

export function isSnapshotFocusCandidate(account: Account): boolean {
  return !account.archivedAt;
}

/** A new installation starts without special labels; the full snapshot still includes every active account. */
export function getDefaultSnapshotFocusAccountIds(): string[] {
  return [];
}

export function getSnapshotFocusAccountIds(
  accounts: Account[],
  configuredIds: string[] | undefined,
): string[] {
  const allowed = new Set(accounts.filter(isSnapshotFocusCandidate).map(account => account.id));
  const selected = configuredIds ?? getDefaultSnapshotFocusAccountIds();
  return selected.filter(id => allowed.has(id));
}

export function buildPortableSnapshot(input: PortableSnapshotInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const activeAccounts = input.accounts
    .filter(account => !account.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  const focusAccountIds = new Set(getSnapshotFocusAccountIds(
    activeAccounts,
    input.settings.snapshotFocusAccountIds,
  ));
  const holdingById = new Map(input.holdings.map(holding => [holding.id, holding]));
  const currencyTotalsWork: Record<string, {
    knownAssets: number;
    knownLiabilities: number;
    missingAssetCount: number;
    missingLiabilityCount: number;
  }> = {};
  const warnings: string[] = [];

  const accounts = activeAccounts.map(account => {
    const accountHoldings = input.holdings
      .filter(holding => holding.accountId === account.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    const accountTransactions = input.transactions
      .filter(txn => txn.accountId === account.id && holdingById.has(txn.holdingId));
    const accountRecords = input.records
      .filter(record => record.accountId === account.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

    const holdings = accountHoldings.map(holding => {
      const holdingTransactions = accountTransactions.filter(txn => txn.holdingId === holding.id);
      const mode = getHoldingMode(account.category, holding);
      const multiplier = getHoldingContractMultiplier(holding);
      const optionContract = resolveUsOptionContract(holding);
      const position = mode === 'balance'
        ? computeBalanceHoldingPosition(holdingTransactions)
        : computeHoldingPosition(holdingTransactions, multiplier);
      const marketValue = mode === 'balance' ? position.shares : position.shares * multiplier * (holding.lastPrice || 0);
      const pnl = computeHoldingPnl(position, marketValue);
      const status = position.shares > 1e-9 ? 'active' as const : 'closed' as const;
      if (status === 'active' && !holding.priceDate) {
        warnings.push(`${account.name}/${holding.name}: active holding has no priceDate`);
      }

      return {
        id: holding.id,
        name: holding.name,
        symbol: holding.symbol ?? null,
        market: holding.market ?? null,
        instrumentType: holding.instrumentType ?? null,
        optionContract: optionContract ? {
          underlying: optionContract.underlying,
          expiration: optionContract.expiration,
          right: optionContract.right,
          strike: round(optionContract.strikeMilli / 1000, 3),
          multiplier,
          standardSymbol: toUsOptionSymbol(optionContract),
        } : null,
        mode,
        status,
        shares: round(position.shares),
        averageCost: round(position.avgCost),
        dilutedCost: round(position.dilutedCost),
        costBasis: round(position.costBasis),
        netInvested: round(position.netInvested),
        lastPrice: round(holding.lastPrice || 0),
        priceDate: holding.priceDate ?? null,
        marketValue: round(marketValue),
        unrealizedPnl: round(pnl.unrealizedPnl),
        realizedPnl: round(position.realizedPnl),
        totalPnl: round(pnl.totalPnl),
        totalPnlRate: pnl.totalPnlRate == null ? null : round(pnl.totalPnlRate),
        productData: holding.productData ?? null,
      };
    });

    const cashBalance = round(account.cashBalance || 0);
    const holdingsValue = round(holdings.reduce((sum, holding) => sum + holding.marketValue, 0));
    const conversionUnavailable = Boolean(account.conversionUnavailable);
    const nativeValueUnavailable = conversionUnavailable && account.unit === 'gram';
    const nativeMonetaryValue = nativeValueUnavailable
      ? null
      : account.portfolio
        ? round(cashBalance + holdingsValue)
        : round(account.metalValueInCurrency ?? account.latestAmount);
    const convertedValue = conversionUnavailable ? null : round(account.convertedAmount);
    const currencyTotals = currencyTotalsWork[account.currency] ?? {
      knownAssets: 0,
      knownLiabilities: 0,
      missingAssetCount: 0,
      missingLiabilityCount: 0,
    };
    if (account.type === 'asset') {
      if (nativeMonetaryValue == null) currencyTotals.missingAssetCount += 1;
      else currencyTotals.knownAssets = round(currencyTotals.knownAssets + nativeMonetaryValue);
    } else if (nativeMonetaryValue == null) {
      currencyTotals.missingLiabilityCount += 1;
    } else {
      currencyTotals.knownLiabilities = round(currencyTotals.knownLiabilities + nativeMonetaryValue);
    }
    currencyTotalsWork[account.currency] = currencyTotals;

    if (account.latestDate === '-') warnings.push(`${account.name}: no account snapshot record`);
    if (conversionUnavailable) warnings.push(`${account.name}: converted value unavailable because no valid cached rate or quote exists`);
    if (account.portfolio && nativeMonetaryValue != null && account.latestAmount > 0 && Math.abs(account.latestAmount - nativeMonetaryValue) > 0.01) {
      warnings.push(`${account.name}: portfolio snapshot differs from current cash plus holdings`);
    }

    const transactions = accountTransactions
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .map(txn => {
        const holding = holdingById.get(txn.holdingId);
        return {
          id: txn.id,
          date: txn.date,
          kind: txn.kind,
          holdingId: txn.holdingId,
          holdingName: holding?.name ?? null,
          symbol: holding?.symbol ?? null,
          shares: txn.balanceSnapshot == null ? round(txn.shares) : null,
          price: txn.balanceSnapshot == null ? round(txn.price) : null,
          balanceSnapshot: txn.balanceSnapshot == null ? null : round(txn.balanceSnapshot),
          amount: txn.balanceSnapshot == null
            ? round(txn.shares * txn.price * (holding ? getHoldingContractMultiplier(holding) : 1))
            : round(txn.balanceSnapshot),
          currency: account.currency,
          note: txn.note ?? null,
          recordedAt: new Date(txn.createdAt).toISOString(),
        };
      });

    const records = accountRecords.map(record => ({
      id: record.id,
      date: record.date,
      amount: round(record.amount),
      kind: record.kind ?? null,
      deltaAmount: record.deltaAmount == null ? null : round(record.deltaAmount),
      balanceAdjustment: Boolean(record.balanceAdjustment),
      deltaGrams: record.deltaGrams == null ? null : round(record.deltaGrams),
      pricePerGram: record.pricePerGram == null ? null : round(record.pricePerGram),
      note: record.note ?? null,
      recordedAt: new Date(record.createdAt).toISOString(),
    }));

    return {
      id: account.id,
      name: account.name,
      institution: account.institution ?? null,
      category: account.category,
      type: account.type,
      currency: account.currency,
      isFocusAccount: focusAccountIds.has(account.id),
      portfolio: Boolean(account.portfolio),
      unit: account.unit ?? 'currency',
      metalType: account.metalType ?? null,
      productData: account.productData ?? null,
      latestRecordDate: account.latestDate === '-' ? null : account.latestDate,
      latestAmount: round(account.latestAmount),
      nativeMonetaryValue,
      convertedValue,
      conversionStatus: conversionUnavailable ? 'unavailable' as const : 'available' as const,
      cashBalance,
      holdingsValue,
      activeHoldingCount: holdings.filter(holding => holding.status === 'active').length,
      holdings,
      transactions,
      records,
    };
  });

  const knownAssets = round(accounts.filter(a => a.type === 'asset').reduce((sum, a) => sum + (a.convertedValue ?? 0), 0));
  const knownLiabilities = round(accounts.filter(a => a.type === 'liability').reduce((sum, a) => sum + (a.convertedValue ?? 0), 0));
  const missingAssetCount = accounts.filter(a => a.type === 'asset' && a.convertedValue == null).length;
  const missingLiabilityCount = accounts.filter(a => a.type === 'liability' && a.convertedValue == null).length;
  const totalAssets = missingAssetCount > 0 ? null : knownAssets;
  const totalLiabilities = missingLiabilityCount > 0 ? null : knownLiabilities;
  const categoryMap = new Map<string, {
    category: string;
    type: 'asset' | 'liability';
    knownValue: number;
    missingAccountCount: number;
  }>();
  for (const account of accounts) {
    const key = `${account.type}:${account.category}`;
    const current = categoryMap.get(key) ?? {
      category: account.category,
      type: account.type,
      knownValue: 0,
      missingAccountCount: 0,
    };
    if (account.convertedValue == null) current.missingAccountCount += 1;
    else current.knownValue = round(current.knownValue + account.convertedValue);
    categoryMap.set(key, current);
  }
  const categorySummary = [...categoryMap.values()]
    .map(row => ({
      ...row,
      value: row.missingAccountCount > 0 ? null : row.knownValue,
      percentOfAssets: row.type === 'asset' && totalAssets != null && totalAssets > 0 && row.missingAccountCount === 0
        ? round((row.knownValue / totalAssets) * 100)
        : null,
    }))
    .sort((a, b) => (a.type === b.type ? b.knownValue - a.knownValue : a.type.localeCompare(b.type)));
  const totalsByCurrency = Object.fromEntries(Object.entries(currencyTotalsWork).map(([currency, row]) => {
    const assets = row.missingAssetCount > 0 ? null : row.knownAssets;
    const liabilities = row.missingLiabilityCount > 0 ? null : row.knownLiabilities;
    return [currency, {
      assets,
      liabilities,
      netWorth: assets == null || liabilities == null ? null : round(assets - liabilities),
      knownAssets: row.knownAssets,
      knownLiabilities: row.knownLiabilities,
      missingAssetCount: row.missingAssetCount,
      missingLiabilityCount: row.missingLiabilityCount,
      isComplete: row.missingAssetCount + row.missingLiabilityCount === 0,
    }];
  }));
  const allocationTolerance = round(input.planStatus.base * 0.01);
  const allocationUnavailableCount = input.planStatus.unavailableValuationCount ?? (missingAssetCount + missingLiabilityCount);
  const allocationValuationComplete = allocationUnavailableCount === 0;
  const allocationTargetValuesComplete = allocationValuationComplete || input.planStatus.targetTotal != null;
  if (Math.abs(input.planStatus.targetPercentSum - 100) > 0.01) {
    warnings.push(`allocation target total is ${round(input.planStatus.targetPercentSum, 2)}%, not 100%`);
  }
  if (input.planStatus.unplanned.length > 0) warnings.push('some assets are not assigned to an allocation bucket');
  if (input.planStatus.allocationWarnings.length > 0) {
    warnings.push(`${input.planStatus.allocationWarnings.length} allocation link(s) were constrained to prevent double counting`);
  }
  if (!allocationValuationComplete) {
    warnings.push(`${allocationUnavailableCount} allocation value(s) are unavailable; current allocation totals and gaps are null`);
  }

  const allocationPlan = {
    valuationComplete: allocationValuationComplete,
    unavailableValuationCount: allocationUnavailableCount,
    totalAssets: allocationValuationComplete ? round(input.planStatus.totalAssets) : null,
    knownTotalAssets: round(input.planStatus.totalAssets),
    base: allocationTargetValuesComplete ? round(input.planStatus.base) : null,
    knownBase: round(input.planStatus.base),
    targetTotal: input.planStatus.targetTotal == null ? null : round(input.planStatus.targetTotal),
    targetPercentSum: round(input.planStatus.targetPercentSum),
    onTrackTolerancePrimary: allocationTolerance,
    items: input.planStatus.items.map(item => ({
      id: item.id,
      name: item.name,
      scopes: item.categories,
      targetPercent: round(item.targetPercent),
      currentPercent: allocationValuationComplete ? round(item.currentPercent) : null,
      knownCurrentPercent: round(item.currentPercent),
      targetValue: allocationTargetValuesComplete ? round(item.targetValue) : null,
      currentValue: allocationValuationComplete ? round(item.currentValue) : null,
      knownCurrentValue: round(item.currentValue),
      gapValue: allocationValuationComplete && allocationTargetValuesComplete ? round(item.gapValue) : null,
      gapPercent: allocationValuationComplete ? round(item.gapPercent) : null,
      action: allocationValuationComplete && allocationTargetValuesComplete
        ? allocationAction(item.gapValue, allocationTolerance)
        : null,
      resourceAllocations: (item.allocations ?? []).map(allocation => ({
        refKey: allocation.refKey,
        mode: allocation.amountMinor === undefined ? 'remainder' : 'amount',
        amountMinor: allocation.amountMinor ?? null,
        amount: minorToMajor(allocation.amountMinor) ?? null,
      })),
      targets: item.targets.map(target => {
        const tolerance = target.targetAmount * 0.01;
        return {
          id: target.id,
          label: target.name,
          refKey: target.refKeys.length === 1 ? target.refKeys[0] : null,
          refKeys: target.refKeys,
          currency: target.currency,
          targetPercent: round(target.targetPercent),
          targetAmount: allocationTargetValuesComplete ? round(target.targetAmount) : null,
          currentValue: allocationValuationComplete ? round(target.currentValue) : null,
          knownCurrentValue: round(target.currentValue),
          gapValue: allocationValuationComplete && allocationTargetValuesComplete ? round(target.gapValue) : null,
          action: allocationValuationComplete && allocationTargetValuesComplete
            ? allocationAction(target.gapValue, tolerance)
            : null,
          resourceAllocations: (target.allocations ?? []).map(allocation => ({
            refKey: allocation.refKey,
            mode: allocation.amountMinor === undefined ? 'remainder' : 'amount',
            amountMinor: allocation.amountMinor ?? null,
            amount: minorToMajor(allocation.amountMinor) ?? null,
          })),
          linkedProducts: target.linkedProducts.map(product => ({
            refKey: product.refKey,
            name: product.name,
            kind: product.kind,
            accountId: product.accountId,
            currency: product.currency,
            currentValue: round(product.currentValue),
            primaryValue: allocationValuationComplete ? round(product.primaryValue) : null,
            knownPrimaryValue: round(product.primaryValue),
            sourceCurrentValue: round(product.sourceCurrentValue),
            sourcePrimaryValue: allocationValuationComplete ? round(product.sourcePrimaryValue) : null,
            knownSourcePrimaryValue: round(product.sourcePrimaryValue),
            requestedValue: product.requestedValue == null ? null : round(product.requestedValue),
            usesRemainder: product.usesRemainder,
            overAllocated: product.overAllocated,
          })),
        };
      }),
    })),
    allocationWarnings: input.planStatus.allocationWarnings,
    unplanned: input.planStatus.unplanned.map(entry => ({
      category: entry.category,
      market: entry.market ?? null,
      value: allocationValuationComplete ? round(entry.value) : null,
      knownValue: round(entry.value),
    })),
  };

  return {
    schemaVersion: CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION,
    source: 'Fortuna',
    scope: 'all active accounts, liabilities, allocation plan, holdings, and ledgers',
    generatedAt: generatedAt.toISOString(),
    trigger: input.trigger ?? 'unspecified',
    primaryCurrency: input.settings.primaryCurrency,
    fileName: AUTOMATIC_SNAPSHOT_FILE,
    accountCount: accounts.length,
    focusAccountCount: accounts.filter(account => account.isFocusAccount).length,
    totals: {
      assets: totalAssets,
      liabilities: totalLiabilities,
      netWorth: totalAssets == null || totalLiabilities == null ? null : round(totalAssets - totalLiabilities),
      knownAssets,
      knownLiabilities,
      knownNetWorth: round(knownAssets - knownLiabilities),
      missingAssetCount,
      missingLiabilityCount,
      isComplete: missingAssetCount + missingLiabilityCount === 0,
    },
    totalsByCurrency,
    categorySummary,
    allocationPlan,
    exchangeRates: input.exchangeRates
      .sort((a, b) => a.base.localeCompare(b.base) || a.quote.localeCompare(b.quote))
      .map(rate => ({
        base: rate.base,
        quote: rate.quote,
        rate: round(rate.rate, 10),
        date: rate.date,
        updatedAt: new Date(rate.updatedAt).toISOString(),
      })),
    accounts,
    dataQualityWarnings: warnings,
    dataBoundary: {
      ledger: 'All active Fortuna accounts and ledgers at generatedAt; archived accounts are excluded.',
      currentValues: 'Account latestRecordDate and holding priceDate are independent freshness boundaries.',
      exchangeRates: 'Converted values use Fortuna cached exchange rates. A null converted value or total is unknown, never zero; inspect conversionStatus, missing counts, and each rate date.',
      allocation: 'Allocation targets are user-defined comparisons, not investment advice or trade instructions. Current values and gaps are null whenever cached valuation is incomplete.',
      externalUse: 'This portable file may be read by tools the user chooses. Verify record dates, quote dates, and exchange-rate dates independently; generatedAt is not a market price timestamp.',
    },
  };
}
