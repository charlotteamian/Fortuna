import { v4 as uuidv4 } from 'uuid';
import { db, initializeSettings, type PlanItem, type PlanTarget } from '../db';
import { getAccountsWithLatest } from './assetService';
import { computeHoldingPosition } from './holdingService';
import { convertAmount } from './rateService';
import { getHoldingMode } from '../lib/productPortfolio';

// ---- Scopes ----
// A plan item links "scopes" at three granularities, finest wins so nothing is counted
// twice: one account ('acct:<id>') > a market slice of an equity category ('股票/ETF@us')
// > a whole category ('银行存款'). Market keys are canonical so stored data survives
// language switches.
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

export interface ScopeParts { category?: string; market?: MarketKey; accountId?: string; }

export function splitScope(scope: string): ScopeParts {
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

// ---- PlanItem CRUD ----
export async function getPlanItems(): Promise<PlanItem[]> {
  const items = await db.planItems.toArray();
  return items.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
}

export async function createPlanItem(data: Pick<PlanItem, 'name' | 'targetPercent' | 'categories'>): Promise<string> {
  const count = await db.planItems.count();
  const id = uuidv4();
  await db.planItems.add({ ...data, id, sortOrder: count, createdAt: Date.now() });
  return id;
}

export async function updatePlanItem(id: string, updates: Partial<PlanItem>): Promise<void> {
  await db.planItems.update(id, updates);
}

export async function deletePlanItem(id: string): Promise<void> {
  await db.planTargets.where('planItemId').equals(id).delete();
  await db.planItems.delete(id);
}

export async function setPlanTargetTotal(value: number | undefined): Promise<void> {
  const settings = await initializeSettings();
  await db.settings.put({ ...settings, planTargetTotal: value });
}

// ---- PlanTarget CRUD ----
export async function createPlanTarget(data: Pick<PlanTarget, 'planItemId' | 'label' | 'refKey' | 'targetAmount'>): Promise<string> {
  const count = await db.planTargets.where('planItemId').equals(data.planItemId).count();
  const id = uuidv4();
  await db.planTargets.add({ ...data, id, sortOrder: count, createdAt: Date.now() });
  return id;
}

export async function updatePlanTarget(id: string, updates: Partial<PlanTarget>): Promise<void> {
  await db.planTargets.update(id, updates);
}

export async function deletePlanTarget(id: string): Promise<void> {
  await db.planTargets.delete(id);
}

// ---- Status: target vs actual ----
export interface TargetCandidate {
  refKey: string;          // 'h:<holdingId>' | 'a:<accountId>'
  name: string;
  currency: string;        // the asset's own currency — plans for it are made in this currency
  currentValue: number;    // in `currency`
  primaryValue: number;    // primary currency (for sorting)
}

export interface PlanTargetStatus extends PlanTarget {
  name: string;            // live name when linked, stored label otherwise
  currency: string;        // resolved: linked asset's currency, else stored/primary
  currentValue: number;    // in `currency`
  gapValue: number;        // targetAmount − currentValue, in `currency`
}

export interface PlanItemStatus extends PlanItem {
  currentValue: number;     // primary currency
  currentPercent: number;   // share of current total assets
  targetValue: number;      // targetPercent × base
  gapValue: number;         // targetValue − currentValue (+ = buy more, − = trim)
  gapPercent: number;       // targetPercent − currentPercent
  targets: PlanTargetStatus[];
  candidates: TargetCandidate[];  // linkable holdings/accounts owned by this item
}

export interface UnplannedEntry { category: string; market?: MarketKey; value: number; }

export interface PlanStatus {
  items: PlanItemStatus[];
  totalAssets: number;          // current total assets (primary currency)
  base: number;                 // amount the targets are measured against
  targetTotal?: number;         // user-set target total assets, if any
  targetPercentSum: number;
  unplanned: UnplannedEntry[];  // asset value not covered by any item
  equityAccounts: { id: string; name: string; category: string }[];  // for the scope form
}

// The smallest unit of asset value the plan can assign: a holding, a portfolio's cash,
// or a whole non-portfolio account.
interface Atom {
  accountId: string;
  category: string;
  market?: MarketKey;      // only for equity categories
  holdingId?: string;      // only for portfolio holdings
  value: number;           // primary currency
}

export async function getPlanStatus(): Promise<PlanStatus> {
  const [items, allTargets, settings, acctData] = await Promise.all([
    getPlanItems(), db.planTargets.toArray(), initializeSettings(), getAccountsWithLatest(),
  ]);
  const primary = settings.primaryCurrency;
  const assetAccounts = acctData.accounts.filter(a => a.type === 'asset');

  // ---- Build atoms + lookup maps ----
  const atoms: Atom[] = [];
  const holdingValues: Record<string, number> = {};      // primary currency
  const holdingValuesCcy: Record<string, number> = {};   // account currency
  const holdingNames: Record<string, string> = {};
  const holdingCurrency: Record<string, string> = {};
  const accountValues: Record<string, number> = {};      // primary currency
  const accountValuesCcy: Record<string, number> = {};   // account currency
  const accountNames: Record<string, string> = {};
  const accountCurrency: Record<string, string> = {};
  const accountCategory: Record<string, string> = {};
  const portfolioIds = new Set<string>();

  for (const a of assetAccounts) {
    if (a.portfolio) portfolioIds.add(a.id);
    // metal accounts track grams — their own-currency value is the metal market value
    accountValuesCcy[a.id] = a.unit === 'gram' ? (a.metalValueInCurrency ?? 0) : a.latestAmount;
    accountCurrency[a.id] = a.currency;
    accountValues[a.id] = a.convertedAmount;
    accountNames[a.id] = a.name;
    accountCategory[a.id] = a.category;
    const usesMarketScope = EQUITY_PLAN_CATEGORIES.includes(a.category);
    if (a.portfolio) {
      const [holdings, txns] = await Promise.all([
        db.holdings.where('accountId').equals(a.id).toArray(),
        db.holdingTxns.where('accountId').equals(a.id).toArray(),
      ]);
      for (const h of holdings) {
        const pos = computeHoldingPosition(txns.filter(tx => tx.holdingId === h.id));
        const raw = getHoldingMode(a.category, h) === 'balance' ? pos.shares : pos.shares * (h.lastPrice || 0);
        const value = raw > 0 ? await convertAmount(raw, a.currency, primary) : 0;
        holdingValues[h.id] = value;
        holdingValuesCcy[h.id] = raw;
        holdingCurrency[h.id] = a.currency;
        holdingNames[h.id] = h.name;
        if (value > 0) {
          const market = usesMarketScope ? (h.market ? canonicalMarket(h.market) : marketFromCurrency(a.currency)) : undefined;
          atoms.push({ accountId: a.id, category: a.category, market, holdingId: h.id, value });
        }
      }
      if (a.cashBalance && a.cashBalance > 0) {
        atoms.push({
          accountId: a.id, category: a.category, market: usesMarketScope ? marketFromCurrency(a.currency) : undefined,
          value: await convertAmount(a.cashBalance, a.currency, primary),
        });
      }
    } else if (a.convertedAmount > 0) {
      const market = usesMarketScope
        ? (a.productData?.market ? canonicalMarket(a.productData.market) : marketFromCurrency(a.currency))
        : undefined;
      atoms.push({ accountId: a.id, category: a.category, market, value: a.convertedAmount });
    }
  }

  // ---- Resolve ownership: account scope > market scope > whole category ----
  const acctOwner = new Map<string, number>();
  const marketOwner = new Map<string, number>();
  const wholeOwner = new Map<string, number>();
  items.forEach((item, idx) => {
    for (const scope of item.categories) {
      const p = splitScope(scope);
      if (p.accountId) { if (!acctOwner.has(p.accountId)) acctOwner.set(p.accountId, idx); }
      else if (p.category && p.market) { const k = makeScope(p.category, p.market); if (!marketOwner.has(k)) marketOwner.set(k, idx); }
      else if (p.category) { if (!wholeOwner.has(p.category)) wholeOwner.set(p.category, idx); }
    }
  });

  const itemValues = items.map(() => 0);
  const itemAtoms: Atom[][] = items.map(() => []);
  const unclaimed: Atom[] = [];
  for (const atom of atoms) {
    const owner = acctOwner.get(atom.accountId)
      ?? (atom.market !== undefined ? marketOwner.get(makeScope(atom.category, atom.market)) : undefined)
      ?? wholeOwner.get(atom.category);
    if (owner === undefined) unclaimed.push(atom);
    else { itemValues[owner] += atom.value; itemAtoms[owner].push(atom); }
  }

  const totalAssets = acctData.totalAssets;
  const targetTotal = settings.planTargetTotal && settings.planTargetTotal > 0 ? settings.planTargetTotal : undefined;
  const base = targetTotal ?? totalAssets;

  const sortedTargets = allTargets.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  // Linked targets are planned and compared in the asset's own currency (no FX conversion)
  const targetStatus = (tg: PlanTarget): PlanTargetStatus => {
    let currentValue = 0;
    let name = tg.label;
    let currency = tg.currency || primary;
    if (tg.refKey?.startsWith('h:')) {
      const hid = tg.refKey.slice(2);
      currentValue = holdingValuesCcy[hid] ?? 0;
      name = holdingNames[hid] ?? tg.label;
      currency = holdingCurrency[hid] ?? currency;
    } else if (tg.refKey?.startsWith('a:')) {
      const aid = tg.refKey.slice(2);
      currentValue = accountValuesCcy[aid] ?? 0;
      name = accountNames[aid] ?? tg.label;
      currency = accountCurrency[aid] ?? currency;
    }
    return { ...tg, name, currency, currentValue, gapValue: tg.targetAmount - currentValue };
  };

  const statuses: PlanItemStatus[] = items.map((item, idx) => {
    const currentValue = itemValues[idx];
    const currentPercent = totalAssets > 0 ? (currentValue / totalAssets) * 100 : 0;
    const targetValue = (item.targetPercent / 100) * base;
    // Linkable concrete targets: holdings and whole non-portfolio accounts owned by this item
    const candidates: TargetCandidate[] = [];
    const seen = new Set<string>();
    for (const atom of itemAtoms[idx]) {
      // holdings link individually; whole accounts link only when not a portfolio (whose cash atom isn't a security)
      const refKey = atom.holdingId ? `h:${atom.holdingId}` : portfolioIds.has(atom.accountId) ? null : `a:${atom.accountId}`;
      if (!refKey || seen.has(refKey)) continue;
      seen.add(refKey);
      candidates.push({
        refKey,
        name: atom.holdingId ? holdingNames[atom.holdingId] : accountNames[atom.accountId],
        currency: accountCurrency[atom.accountId],
        currentValue: atom.holdingId ? holdingValuesCcy[atom.holdingId] : accountValuesCcy[atom.accountId],
        primaryValue: atom.holdingId ? holdingValues[atom.holdingId] : accountValues[atom.accountId],
      });
    }
    candidates.sort((a, b) => b.primaryValue - a.primaryValue);
    return {
      ...item,
      currentValue,
      currentPercent,
      targetValue,
      gapValue: targetValue - currentValue,
      gapPercent: item.targetPercent - currentPercent,
      targets: sortedTargets.filter(tg => tg.planItemId === item.id).map(targetStatus),
      candidates,
    };
  });

  // ---- Unplanned: group leftover atoms; split by market where the category is partially claimed ----
  const refinedCats = new Set<string>();
  for (const key of marketOwner.keys()) refinedCats.add(splitScope(key).category!);
  for (const accountId of acctOwner.keys()) { const c = accountCategory[accountId]; if (c) refinedCats.add(c); }
  const unplannedMap: Record<string, UnplannedEntry> = {};
  for (const atom of unclaimed) {
    if (atom.value <= 0.005) continue;
    const useMarket = atom.market !== undefined && refinedCats.has(atom.category);
    const key = useMarket ? makeScope(atom.category, atom.market) : atom.category;
    if (!unplannedMap[key]) unplannedMap[key] = { category: atom.category, market: useMarket ? atom.market : undefined, value: 0 };
    unplannedMap[key].value += atom.value;
  }
  const unplanned = Object.values(unplannedMap).filter(u => u.value > 0.005).sort((a, b) => b.value - a.value);

  return {
    items: statuses,
    totalAssets,
    base,
    targetTotal,
    targetPercentSum: items.reduce((s, i) => s + i.targetPercent, 0),
    unplanned,
    equityAccounts: assetAccounts
      .filter(a => EQUITY_PLAN_CATEGORIES.includes(a.category))
      .map(a => ({ id: a.id, name: a.name, category: a.category })),
  };
}
