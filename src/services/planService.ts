import { v4 as uuidv4 } from 'uuid';
import { db, initializeSettings, type PlanItem, type PlanTarget } from '../db';
import { getAccountsWithLatest } from './assetService';
import { computeBalanceHoldingPosition, computeHoldingPosition } from './holdingService';
import { convertAmountFromCache } from './rateService';
import { getHoldingMode } from '../lib/productPortfolio';
import { getHoldingContractMultiplier } from '../lib/usOption';
import { requestPortableSnapshot } from './portableSnapshotEvents';
import {
  getTargetRefKeys,
  getResourceAllocation,
  minorToMajor,
  resolveResourceClaims,
  sumLinkedProductValues,
  sumTargetPercents,
  targetAmountFromPercent,
  targetPercentFromAmount,
} from '../lib/allocationPlan';

// ---- Scopes ----
// A plan item links scopes at several granularities. Exact holding/cash scopes may
// split one real resource by amount across several items; unallocated value falls
// back through account > market slice > whole category so nothing is counted twice.
// Market keys are canonical so stored data survives language switches.
export type MarketKey = 'a' | 'us' | 'hk' | 'other';
export const MARKET_KEYS: MarketKey[] = ['a', 'us', 'hk', 'other'];
export const MARKET_LABEL_KEYS: Record<MarketKey, string> = {
  a: 'opt_a_share', us: 'opt_us_market', hk: 'opt_hk_market', other: 'opt_other',
};
// Categories whose holdings/accounts carry a market dimension worth splitting on
export const EQUITY_PLAN_CATEGORIES = ['股票/ETF', '场外基金'];

export function canonicalMarket(label?: string): MarketKey {
  if (!label) return 'other';
  if (/A股|A-Share/i.test(label)) return 'a';
  if (/美|US/i.test(label)) return 'us';
  if (/港|HK/i.test(label)) return 'hk';
  return 'other';
}

/** Fallback when no market is set: infer from the account currency (USD broker cash → US bucket). */
function marketFromCurrency(currency: string): MarketKey {
  if (currency === 'USD') return 'us';
  if (currency === 'HKD') return 'hk';
  if (currency === 'CNY') return 'a';
  return 'other';
}

export interface ScopeParts {
  category?: string;
  market?: MarketKey;
  accountId?: string;
  cashAccountId?: string;
  holdingId?: string;
}

export function splitScope(scope: string): ScopeParts {
  if (scope.startsWith('hold:')) return { holdingId: scope.slice(5) };
  if (scope.startsWith('cash:')) return { cashAccountId: scope.slice(5) };
  if (scope.startsWith('acct:')) return { accountId: scope.slice(5) };
  const at = scope.lastIndexOf('@');
  if (at < 0) return { category: scope };
  return { category: scope.slice(0, at), market: scope.slice(at + 1) as MarketKey };
}

export function makeScope(category: string, market?: MarketKey): string {
  return market ? `${category}@${market}` : category;
}

export function makeAccountScope(accountId: string): string {
  return `acct:${accountId}`;
}

export function makeHoldingScope(holdingId: string): string {
  return `hold:${holdingId}`;
}

export function makeCashScope(accountId: string): string {
  return `cash:${accountId}`;
}

// ---- PlanItem CRUD ----
export async function getPlanItems(): Promise<PlanItem[]> {
  const items = await db.planItems.toArray();
  return items.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
}

export async function createPlanItem(data: Pick<PlanItem, 'name' | 'targetPercent' | 'categories' | 'allocations'>): Promise<string> {
  const count = await db.planItems.count();
  const id = uuidv4();
  await db.planItems.add({ ...data, id, sortOrder: count, createdAt: Date.now() });
  requestPortableSnapshot('allocation-plan-item-created');
  return id;
}

export async function updatePlanItem(id: string, updates: Partial<PlanItem>): Promise<void> {
  await db.planItems.update(id, updates);
  requestPortableSnapshot('allocation-plan-item-updated');
}

export async function deletePlanItem(id: string): Promise<void> {
  await db.planTargets.where('planItemId').equals(id).delete();
  await db.planItems.delete(id);
  requestPortableSnapshot('allocation-plan-item-deleted');
}

export async function setPlanTargetTotal(value: number | undefined): Promise<void> {
  const settings = await initializeSettings();
  await db.settings.put({ ...settings, planTargetTotal: value });
  requestPortableSnapshot('allocation-plan-total-updated');
}

// ---- PlanTarget CRUD ----
type CreatePlanTargetData = Pick<PlanTarget, 'planItemId' | 'label' | 'refKeys' | 'allocations'> & { targetPercent: number };

export async function createPlanTarget(data: CreatePlanTargetData): Promise<string> {
  const count = await db.planTargets.where('planItemId').equals(data.planItemId).count();
  const id = uuidv4();
  await db.planTargets.add({ ...data, id, sortOrder: count, createdAt: Date.now() });
  requestPortableSnapshot('allocation-target-created');
  return id;
}

export async function updatePlanTarget(id: string, updates: Partial<PlanTarget>): Promise<void> {
  await db.planTargets.update(id, updates);
  requestPortableSnapshot('allocation-target-updated');
}

export async function deletePlanTarget(id: string): Promise<void> {
  await db.planTargets.delete(id);
  requestPortableSnapshot('allocation-target-deleted');
}

// ---- Status: target vs actual ----
export interface TargetCandidate {
  refKey: string;          // 'h:<holdingId>' | 'c:<accountId>' | 'a:<accountId>'
  name: string;
  kind: 'holding' | 'cash' | 'account';
  accountId: string;
  currency: string;        // product's own currency
  currentValue: number;    // amount available/assigned at this hierarchy level, in `currency`
  primaryValue: number;    // amount available/assigned at this hierarchy level, primary currency
  sourceCurrentValue: number; // full real-world resource value, in `currency`
  sourcePrimaryValue: number; // full real-world resource value, primary currency
  requestedValue?: number; // configured amount before any proportional shortage adjustment
  usesRemainder: boolean;
  overAllocated: boolean;
}

export interface PlanTargetStatus extends PlanTarget {
  name: string;            // second-level subcategory name; never replaced by a linked product
  refKeys: string[];
  currency: string;        // primary currency for the aggregated second-level target
  targetPercent: number;   // share of the plan base; legacy fixed amounts are normalized here
  targetAmount: number;    // derived from targetPercent × base, in primary currency
  currentValue: number;    // sum of linked product values, in primary currency
  gapValue: number;        // derived targetAmount − currentValue, in primary currency
  linkedProducts: TargetCandidate[];
}

export interface PlanItemStatus extends PlanItem {
  currentValue: number;     // primary currency
  currentPercent: number;   // share of current total assets
  targetValue: number;      // targetPercent × base
  gapValue: number;         // targetValue − currentValue (+ = buy more, − = trim)
  gapPercent: number;       // targetPercent − currentPercent
  targets: PlanTargetStatus[];
  targetPercentSum: number; // portfolio percentage assigned to second-level subcategories
  candidates: TargetCandidate[];  // third-level products linkable to those subcategories
}

export interface AllocationWarning {
  level: 'item' | 'target';
  refKey: string;
  ownerId?: string;
  kind: 'over_allocated' | 'multiple_remainders';
}

export interface UnplannedEntry { category: string; market?: MarketKey; value: number; }

export interface PlanStatus {
  items: PlanItemStatus[];
  totalAssets: number;          // current total assets (primary currency)
  base: number;                 // amount the targets are measured against
  targetTotal?: number;         // user-set target total assets, if any
  targetPercentSum: number;
  allocationWarnings: AllocationWarning[];
  unavailableValuationCount: number;
  unplanned: UnplannedEntry[];  // asset value not covered by any item
  // For the scope form. The legacy field name is retained, but all asset accounts
  // are included so any portfolio holding/cash pool can be allocated explicitly.
  equityAccounts: {
    id: string;
    name: string;
    category: string;
    currency: string;
    cash?: { refKey: string; currentValue: number };
    holdings: { id: string; refKey: string; name: string; currentValue: number }[];
  }[];
}

// The smallest unit of asset value the plan can assign: a holding, a portfolio's cash,
// or a whole non-portfolio account.
interface Atom {
  accountId: string;
  category: string;
  market?: MarketKey;      // only for equity categories
  holdingId?: string;      // only for portfolio holdings
  refKey: string;
  currency: string;
  currentValue: number;    // source/account currency
  value: number;           // primary currency
}

export async function getPlanStatus(): Promise<PlanStatus> {
  const [items, allTargets, settings, acctData] = await Promise.all([
    getPlanItems(), db.planTargets.toArray(), initializeSettings(), getAccountsWithLatest(),
  ]);
  const primary = settings.primaryCurrency;
  const assetAccounts = acctData.accounts.filter(a => a.type === 'asset');

  interface ResourceInfo {
    refKey: string;
    name: string;
    kind: TargetCandidate['kind'];
    accountId: string;
    currency: string;
    currentValue: number;
    primaryValue: number;
  }
  interface AssignedResource {
    currentValue: number;
    primaryValue: number;
    requestedValue?: number;
    usesRemainder: boolean;
    overAllocated: boolean;
  }

  const atoms: Atom[] = [];
  const resources = new Map<string, ResourceInfo>();
  const accountCategory = new Map<string, string>();
  const portfolioIds = new Set(assetAccounts.filter(account => account.portfolio).map(account => account.id));
  const accountHoldingOptions: Record<string, { id: string; refKey: string; name: string; currentValue: number }[]> = {};
  const allocationWarnings: AllocationWarning[] = [];
  let unavailableValuationCount = assetAccounts.filter(account => account.conversionUnavailable).length;
  const selectedRefs = new Set([
    ...items.flatMap(item => item.categories.flatMap(scope => {
      const parts = splitScope(scope);
      if (parts.holdingId) return [`h:${parts.holdingId}`];
      if (parts.cashAccountId) return [`c:${parts.cashAccountId}`];
      return [];
    })),
    ...allTargets.flatMap(target => getTargetRefKeys(target)),
  ]);

  for (const account of assetAccounts) {
    accountCategory.set(account.id, account.category);
    const usesMarketScope = EQUITY_PLAN_CATEGORIES.includes(account.category);
    if (account.portfolio) {
      const [holdings, txns] = await Promise.all([
        db.holdings.where('accountId').equals(account.id).toArray(),
        db.holdingTxns.where('accountId').equals(account.id).toArray(),
      ]);
      holdings.sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt);
      for (const holding of holdings) {
        const holdingTxns = txns.filter(txn => txn.holdingId === holding.id);
        const mode = getHoldingMode(account.category, holding);
        const multiplier = getHoldingContractMultiplier(holding);
        const position = mode === 'balance'
          ? computeBalanceHoldingPosition(holdingTxns)
          : computeHoldingPosition(holdingTxns, multiplier);
        const currentValue = mode === 'balance'
          ? position.shares
          : position.shares * multiplier * (holding.lastPrice || 0);
        const convertedHoldingValue = currentValue > 0
          ? await convertAmountFromCache(currentValue, account.currency, primary)
          : 0;
        if (currentValue > 0 && convertedHoldingValue === undefined) unavailableValuationCount += 1;
        const primaryValue = convertedHoldingValue ?? 0;
        const refKey = `h:${holding.id}`;
        resources.set(refKey, {
          refKey,
          name: holding.name,
          kind: 'holding',
          accountId: account.id,
          currency: account.currency,
          currentValue,
          primaryValue,
        });
        if (currentValue > 0 || selectedRefs.has(refKey)) {
          (accountHoldingOptions[account.id] ??= []).push({
            id: holding.id,
            refKey,
            name: holding.name,
            currentValue,
          });
        }
        if (primaryValue > 0) {
          atoms.push({
            accountId: account.id,
            category: account.category,
            market: usesMarketScope
              ? (holding.market ? canonicalMarket(holding.market) : marketFromCurrency(account.currency))
              : undefined,
            holdingId: holding.id,
            refKey,
            currency: account.currency,
            currentValue,
            value: primaryValue,
          });
        }
      }

      const cashCurrentValue = Math.max(0, account.cashBalance ?? 0);
      const convertedCashValue = cashCurrentValue > 0
        ? await convertAmountFromCache(cashCurrentValue, account.currency, primary)
        : 0;
      if (cashCurrentValue > 0 && convertedCashValue === undefined) unavailableValuationCount += 1;
      const cashPrimaryValue = convertedCashValue ?? 0;
      const cashRefKey = `c:${account.id}`;
      resources.set(cashRefKey, {
        refKey: cashRefKey,
        name: account.name,
        kind: 'cash',
        accountId: account.id,
        currency: account.currency,
        currentValue: cashCurrentValue,
        primaryValue: cashPrimaryValue,
      });
      if (cashPrimaryValue > 0) {
        atoms.push({
          accountId: account.id,
          category: account.category,
          market: usesMarketScope ? marketFromCurrency(account.currency) : undefined,
          refKey: cashRefKey,
          currency: account.currency,
          currentValue: cashCurrentValue,
          value: cashPrimaryValue,
        });
      }
    } else {
      const currentValue = account.unit === 'gram'
        ? (account.metalValueInCurrency ?? 0)
        : account.latestAmount;
      const refKey = `a:${account.id}`;
      resources.set(refKey, {
        refKey,
        name: account.name,
        kind: 'account',
        accountId: account.id,
        currency: account.currency,
        currentValue,
        primaryValue: account.convertedAmount,
      });
      if (account.convertedAmount > 0) {
        atoms.push({
          accountId: account.id,
          category: account.category,
          market: usesMarketScope
            ? (account.productData?.market ? canonicalMarket(account.productData.market) : marketFromCurrency(account.currency))
            : undefined,
          refKey,
          currency: account.currency,
          currentValue,
          value: account.convertedAmount,
        });
      }
    }
  }

  const itemIndex = new Map(items.map((item, index) => [item.id, index]));
  const exactClaims = new Map<string, { ownerId: string; amountMinor?: number }[]>();
  const accountOwners = new Map<string, string>();
  const marketOwners = new Map<string, string>();
  const wholeOwners = new Map<string, string>();
  const exactRefForScope = (scope: string): string | undefined => {
    const parts = splitScope(scope);
    if (parts.holdingId) return `h:${parts.holdingId}`;
    if (parts.cashAccountId) return `c:${parts.cashAccountId}`;
    if (parts.accountId && !portfolioIds.has(parts.accountId)) return `a:${parts.accountId}`;
    return undefined;
  };
  for (const item of items) {
    for (const scope of item.categories) {
      const parts = splitScope(scope);
      const exactRef = exactRefForScope(scope);
      if (exactRef) {
        const configured = getResourceAllocation(item.allocations, exactRef);
        const claims = exactClaims.get(exactRef) ?? [];
        claims.push({ ownerId: item.id, amountMinor: configured?.amountMinor });
        exactClaims.set(exactRef, claims);
      } else if (parts.accountId) {
        if (!accountOwners.has(parts.accountId)) accountOwners.set(parts.accountId, item.id);
      } else if (parts.category && parts.market) {
        const key = makeScope(parts.category, parts.market);
        if (!marketOwners.has(key)) marketOwners.set(key, item.id);
      } else if (parts.category && !wholeOwners.has(parts.category)) {
        wholeOwners.set(parts.category, item.id);
      }
    }
  }

  const itemValues = items.map(() => 0);
  const itemResources = items.map(() => new Map<string, AssignedResource>());
  const unclaimed: Atom[] = [];
  for (const atom of atoms) {
    const fallbackOwnerId = accountOwners.get(atom.accountId)
      ?? (atom.market ? marketOwners.get(makeScope(atom.category, atom.market)) : undefined)
      ?? wholeOwners.get(atom.category);
    const claims = exactClaims.get(atom.refKey) ?? [];
    const resolved = resolveResourceClaims(atom.currentValue, claims, fallbackOwnerId);
    if (resolved.overAllocated) {
      allocationWarnings.push({ level: 'item', refKey: atom.refKey, kind: 'over_allocated' });
    }
    if (resolved.residualClaimCount > 1) {
      allocationWarnings.push({ level: 'item', refKey: atom.refKey, kind: 'multiple_remainders' });
    }
    const primaryRate = atom.currentValue > 0 ? atom.value / atom.currentValue : 0;
    for (const [ownerId, currentValue] of resolved.values) {
      const index = itemIndex.get(ownerId);
      if (index === undefined || currentValue <= 0) continue;
      const ownerClaims = claims.filter(claim => claim.ownerId === ownerId);
      const configuredValue = ownerClaims.reduce((sum, claim) => sum + (minorToMajor(claim.amountMinor) ?? 0), 0);
      const usesRemainder = ownerClaims.some(claim => claim.amountMinor === undefined)
        || (ownerClaims.length === 0 && fallbackOwnerId === ownerId);
      const primaryValue = currentValue * primaryRate;
      itemValues[index] += primaryValue;
      itemResources[index].set(atom.refKey, {
        currentValue,
        primaryValue,
        requestedValue: usesRemainder ? undefined : configuredValue,
        usesRemainder,
        overAllocated: resolved.overAllocated,
      });
    }
    if (resolved.unallocatedValue > 0.000001) {
      unclaimed.push({
        ...atom,
        currentValue: resolved.unallocatedValue,
        value: resolved.unallocatedValue * primaryRate,
      });
    }
  }

  const totalAssets = acctData.totalAssets;
  const targetTotal = settings.planTargetTotal && settings.planTargetTotal > 0 ? settings.planTargetTotal : undefined;
  const base = targetTotal ?? totalAssets;
  const candidateForRefKey = (refKey: string, assigned?: AssignedResource): TargetCandidate | undefined => {
    const resource = resources.get(refKey);
    if (!resource) return undefined;
    return {
      refKey,
      name: resource.name,
      kind: resource.kind,
      accountId: resource.accountId,
      currency: resource.currency,
      currentValue: assigned?.currentValue ?? resource.currentValue,
      primaryValue: assigned?.primaryValue ?? resource.primaryValue,
      sourceCurrentValue: resource.currentValue,
      sourcePrimaryValue: resource.primaryValue,
      requestedValue: assigned?.requestedValue,
      usesRemainder: assigned?.usesRemainder ?? true,
      overAllocated: assigned?.overAllocated ?? false,
    };
  };

  const legacyCurrencyForTarget = (target: PlanTarget) => (
    target.currency
    || getTargetRefKeys(target).map(refKey => candidateForRefKey(refKey)).find(Boolean)?.currency
    || primary
  );
  const targetCurrencies = new Set<string>([
    primary,
    ...allTargets
      .filter(target => !Number.isFinite(Number(target.targetPercent)))
      .map(legacyCurrencyForTarget),
  ]);
  const targetCurrencyRates = Object.fromEntries(await Promise.all(
    [...targetCurrencies].map(async currency => [currency, (await convertAmountFromCache(1, primary, currency)) ?? 0] as const),
  ));
  const storedExchangeRates = await db.exchangeRates.toArray();
  const reliableTargetCurrencies = new Set<string>([primary]);
  for (const currency of targetCurrencies) {
    if (storedExchangeRates.some(rate => (
      (rate.base === primary && rate.quote === currency)
      || (rate.base === currency && rate.quote === primary)
    ))) reliableTargetCurrencies.add(currency);
  }

  const sortedTargets = allTargets.sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt);
  const legacyTargetMigrations: { id: string; changes: Partial<PlanTarget> }[] = [];
  const statuses: PlanItemStatus[] = items.map((item, index) => {
    const itemTargets = sortedTargets.filter(target => target.planItemId === item.id);
    const candidateRefs = new Set(itemResources[index].keys());
    for (const scope of item.categories) {
      const refKey = exactRefForScope(scope);
      if (refKey) candidateRefs.add(refKey);
    }
    for (const target of itemTargets) {
      for (const refKey of getTargetRefKeys(target)) candidateRefs.add(refKey);
    }

    const targetProductValues = new Map<string, Map<string, AssignedResource>>();
    for (const refKey of candidateRefs) {
      const parentAssigned = itemResources[index].get(refKey);
      const parentCurrentValue = parentAssigned?.currentValue ?? 0;
      const resource = resources.get(refKey);
      if (!resource) continue;
      const claims = itemTargets.flatMap(target => {
        if (!getTargetRefKeys(target).includes(refKey)) return [];
        const configured = getResourceAllocation(target.allocations, refKey);
        return [{ ownerId: target.id, amountMinor: configured?.amountMinor }];
      });
      const resolved = resolveResourceClaims(parentCurrentValue, claims);
      if (resolved.overAllocated) {
        allocationWarnings.push({ level: 'target', refKey, ownerId: item.id, kind: 'over_allocated' });
      }
      if (resolved.residualClaimCount > 1) {
        allocationWarnings.push({ level: 'target', refKey, ownerId: item.id, kind: 'multiple_remainders' });
      }
      const primaryRate = resource.currentValue > 0 ? resource.primaryValue / resource.currentValue : 0;
      for (const target of itemTargets.filter(entry => getTargetRefKeys(entry).includes(refKey))) {
        const currentValue = resolved.values.get(target.id) ?? 0;
        const configured = getResourceAllocation(target.allocations, refKey);
        const usesRemainder = configured?.amountMinor === undefined;
        const products = targetProductValues.get(target.id) ?? new Map<string, AssignedResource>();
        products.set(refKey, {
          currentValue,
          primaryValue: currentValue * primaryRate,
          requestedValue: minorToMajor(configured?.amountMinor),
          usesRemainder,
          overAllocated: resolved.overAllocated,
        });
        targetProductValues.set(target.id, products);
      }
    }

    const targets: PlanTargetStatus[] = itemTargets.map(target => {
      const refKeys = getTargetRefKeys(target);
      const linkedProducts = refKeys.flatMap(refKey => {
        const candidate = candidateForRefKey(refKey, targetProductValues.get(target.id)?.get(refKey));
        return candidate ? [candidate] : [];
      });
      const currentValue = sumLinkedProductValues(linkedProducts);
      const legacyCurrency = legacyCurrencyForTarget(target);
      const currencyRate = targetCurrencyRates[legacyCurrency] ?? 1;
      const storedPercent = Number(target.targetPercent);
      const hasStoredPercent = Number.isFinite(storedPercent);
      const targetPercent = hasStoredPercent
        ? storedPercent
        : targetPercentFromAmount(base, Number(target.targetAmount) || 0, currencyRate);
      const migrationChanges: Partial<PlanTarget> = {};
      if (target.refKey && target.refKeys === undefined) migrationChanges.refKeys = refKeys;
      if (
        !hasStoredPercent
        && base > 0
        && Number(target.targetAmount) > 0
        && targetPercent > 0
        && reliableTargetCurrencies.has(legacyCurrency)
      ) {
        migrationChanges.targetPercent = targetPercent;
      }
      if (Object.keys(migrationChanges).length > 0) {
        legacyTargetMigrations.push({ id: target.id, changes: migrationChanges });
      }
      const targetAmount = targetAmountFromPercent(base, targetPercent);
      return {
        ...target,
        name: target.label,
        refKeys,
        currency: primary,
        targetPercent,
        targetAmount,
        currentValue,
        gapValue: targetAmount - currentValue,
        linkedProducts,
      };
    });

    const candidates = [...candidateRefs]
      .flatMap(refKey => {
        const candidate = candidateForRefKey(refKey, itemResources[index].get(refKey) ?? {
          currentValue: 0,
          primaryValue: 0,
          usesRemainder: false,
          overAllocated: false,
        });
        return candidate ? [candidate] : [];
      })
      .sort((left, right) => right.primaryValue - left.primaryValue);
    const currentValue = itemValues[index];
    const currentPercent = totalAssets > 0 ? currentValue / totalAssets * 100 : 0;
    const targetValue = item.targetPercent / 100 * base;
    return {
      ...item,
      currentValue,
      currentPercent,
      targetValue,
      gapValue: targetValue - currentValue,
      gapPercent: item.targetPercent - currentPercent,
      targets,
      targetPercentSum: sumTargetPercents(targets),
      candidates,
    };
  });

  if (legacyTargetMigrations.length > 0) {
    await db.transaction('rw', db.planTargets, async () => {
      await Promise.all(legacyTargetMigrations.map(({ id, changes }) => db.planTargets.update(id, changes)));
    });
    requestPortableSnapshot('allocation-target-hierarchy-migrated');
  }

  const refinedCategories = new Set<string>();
  for (const key of marketOwners.keys()) refinedCategories.add(splitScope(key).category!);
  for (const accountId of accountOwners.keys()) {
    const category = accountCategory.get(accountId);
    if (category) refinedCategories.add(category);
  }
  for (const refKey of exactClaims.keys()) {
    const resource = resources.get(refKey);
    const category = resource ? accountCategory.get(resource.accountId) : undefined;
    if (category) refinedCategories.add(category);
  }
  const unplannedMap: Record<string, UnplannedEntry> = {};
  for (const atom of unclaimed) {
    if (atom.value <= 0.005) continue;
    const useMarket = atom.market !== undefined && refinedCategories.has(atom.category);
    const key = useMarket ? makeScope(atom.category, atom.market) : atom.category;
    if (!unplannedMap[key]) {
      unplannedMap[key] = { category: atom.category, market: useMarket ? atom.market : undefined, value: 0 };
    }
    unplannedMap[key].value += atom.value;
  }
  const unplanned = Object.values(unplannedMap)
    .filter(entry => entry.value > 0.005)
    .sort((left, right) => right.value - left.value);

  return {
    items: statuses,
    totalAssets,
    base,
    targetTotal,
    targetPercentSum: items.reduce((sum, item) => sum + item.targetPercent, 0),
    allocationWarnings,
    unavailableValuationCount,
    unplanned,
    equityAccounts: assetAccounts
      .map(account => {
        const cashRefKey = `c:${account.id}`;
        const cash = resources.get(cashRefKey);
        return {
          id: account.id,
          name: account.name,
          category: account.category,
          currency: account.currency,
          cash: cash && (cash.currentValue > 0 || selectedRefs.has(cashRefKey))
            ? { refKey: cashRefKey, currentValue: cash.currentValue }
            : undefined,
          holdings: accountHoldingOptions[account.id] ?? [],
        };
      }),
  };
}
