export interface AllocationTargetLike {
  id?: string;
  targetPercent?: number;
}

/** Either input describes the same percentage-based plan. Round currency to cents,
 * but retain the derived percentage so amount -> percentage -> amount is lossless. */
export function planPercentFromInput(raw: string, mode: 'percent' | 'amount', base: number): number {
  if (!raw.trim()) return NaN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return NaN;
  if (mode === 'percent') return value;
  if (!Number.isFinite(base) || base <= 0) return NaN;
  // Amount mode still describes a primary-currency amount. Round it to cents
  // (via minor units) so amount -> percentage -> amount round-trips losslessly.
  const roundedAmount = majorToMinor(value) / 100;
  return targetPercentFromAmount(base, roundedAmount);
}

export function planProgress(current: number, target: number): number | undefined {
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(current)) return undefined;
  return Math.max(0, current / target * 100);
}

export interface LinkedTargetLike {
  refKey?: string;
  refKeys?: string[];
}

export interface ResourceAllocationLike {
  refKey: string;
  amountMinor?: number;
}

export interface ResourceClaimLike {
  ownerId: string;
  amountMinor?: number;
}

export interface ResolvedResourceClaims {
  values: Map<string, number>;
  unallocatedValue: number;
  overAllocated: boolean;
  residualClaimCount: number;
}

export interface PrimaryValueLike {
  primaryValue: number;
}

const finiteOrZero = (value: number) => Number.isFinite(value) ? value : 0;

export function majorToMinor(value: number): number {
  return Math.max(0, Math.round(finiteOrZero(value) * 100));
}

export function minorToMajor(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, value) / 100;
}

export function getResourceAllocation(
  allocations: ResourceAllocationLike[] | undefined,
  refKey: string,
): ResourceAllocationLike | undefined {
  return allocations?.find(allocation => allocation.refKey === refKey);
}

/**
 * Resolve one real asset pool across several owners without counting any value twice.
 * Explicit amount claims are honored first. One legacy/blank claim receives the
 * remainder; multiple blank claims split the remainder evenly so resolution never
 * depends on array order. A fallback owner receives otherwise-unallocated value.
 */
export function resolveResourceClaims(
  totalValue: number,
  claims: ResourceClaimLike[],
  fallbackOwnerId?: string,
): ResolvedResourceClaims {
  const available = Math.max(0, finiteOrZero(totalValue));
  const values = new Map<string, number>();
  const explicit = claims
    .map(claim => ({ ...claim, amount: minorToMajor(claim.amountMinor) }))
    .filter((claim): claim is ResourceClaimLike & { amount: number } => claim.amount !== undefined);
  const residual = claims.filter(claim => claim.amountMinor === undefined);
  const requested = explicit.reduce((sum, claim) => sum + claim.amount, 0);
  const overAllocated = requested > available + 0.000001;
  const scale = overAllocated && requested > 0 ? available / requested : 1;

  for (const claim of explicit) {
    values.set(claim.ownerId, (values.get(claim.ownerId) ?? 0) + claim.amount * scale);
  }

  let remaining = Math.max(0, available - [...values.values()].reduce((sum, value) => sum + value, 0));
  if (remaining > 0 && residual.length > 0) {
    const share = remaining / residual.length;
    for (const claim of residual) {
      values.set(claim.ownerId, (values.get(claim.ownerId) ?? 0) + share);
    }
    remaining = 0;
  } else if (remaining > 0 && fallbackOwnerId) {
    values.set(fallbackOwnerId, (values.get(fallbackOwnerId) ?? 0) + remaining);
    remaining = 0;
  }

  return {
    values,
    unallocatedValue: remaining,
    overAllocated,
    residualClaimCount: residual.length,
  };
}

/** Normalize new multi-product links together with the legacy single-product field. */
export function getTargetRefKeys(target: LinkedTargetLike): string[] {
  const refs = target.refKeys ?? (target.refKey ? [target.refKey] : []);
  return [...new Set(refs.filter(Boolean))];
}

export function sumLinkedProductValues(products: PrimaryValueLike[]): number {
  return products.reduce((sum, product) => sum + finiteOrZero(product.primaryValue), 0);
}

/** Convert a portfolio-level target percentage into an amount in the target currency. */
export function targetAmountFromPercent(
  base: number,
  targetPercent: number,
  primaryToTargetRate = 1,
): number {
  if (base <= 0 || primaryToTargetRate <= 0) return 0;
  return finiteOrZero(base) * finiteOrZero(targetPercent) * finiteOrZero(primaryToTargetRate) / 100;
}

/** Read a legacy fixed-amount target as a portfolio-level percentage. */
export function targetPercentFromAmount(
  base: number,
  targetAmount: number,
  primaryToTargetRate = 1,
): number {
  if (base <= 0 || primaryToTargetRate <= 0) return 0;
  return finiteOrZero(targetAmount) / (finiteOrZero(base) * finiteOrZero(primaryToTargetRate)) * 100;
}

export function sumTargetPercents(targets: AllocationTargetLike[], excludeId?: string): number {
  return targets.reduce((sum, target) => {
    if (excludeId && target.id === excludeId) return sum;
    return sum + finiteOrZero(target.targetPercent ?? 0);
  }, 0);
}

export function remainingTargetPercent(
  limitPercent: number,
  targets: AllocationTargetLike[],
  excludeId?: string,
): number {
  return Math.max(0, finiteOrZero(limitPercent) - sumTargetPercents(targets, excludeId));
}

/** One line is one plan. Punctuation belongs to the user's sentence. */
export function parsePlannedPurchases(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/[\n\r\u2028\u2029]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export interface FundingWaterfallBucket {
  id: string;
  name: string;
  currentValue: number;
  targetValue: number;
}

export interface FundingWaterfallStep {
  sourceType: 'idle_cash' | 'overweight_trim' | 'lower_priority_redeem';
  bucketId?: string;
  bucketName?: string;
  amount: number;
}

export interface FundingWaterfallResult {
  targetBucketId: string;
  targetBucketName: string;
  requiredAmount: number;
  coveredAmount: number;
  shortfallAmount: number;
  steps: FundingWaterfallStep[];
}

/**
 * Computes an automatic funding waterfall for an underweight allocation bucket
 * using the existing top-to-bottom bucket order as priority (top = highest priority
 * to keep/buy; bottom = lowest priority, sold first when raising funds):
 * 1. Use unallocated / idle cash first.
 * 2. Trim overweight amounts from other buckets (from lowest priority upward).
 * 3. Redeem remaining value from lower-priority buckets (from bottom upward).
 */
export function computeFundingWaterfall(
  items: readonly FundingWaterfallBucket[],
  targetBucketId: string,
  options: { requiredAmount?: number; idleCash?: number } = {},
): FundingWaterfallResult {
  const targetIndex = items.findIndex(item => item.id === targetBucketId);
  if (targetIndex < 0) {
    return {
      targetBucketId,
      targetBucketName: '',
      requiredAmount: 0,
      coveredAmount: 0,
      shortfallAmount: 0,
      steps: [],
    };
  }
  const target = items[targetIndex];
  const rawRequired = options.requiredAmount ?? Math.max(0, finiteOrZero(target.targetValue) - finiteOrZero(target.currentValue));
  const requiredAmount = Math.round(Math.max(0, finiteOrZero(rawRequired)) * 100) / 100;
  if (requiredAmount < 0.01) {
    return {
      targetBucketId: target.id,
      targetBucketName: target.name,
      requiredAmount: 0,
      coveredAmount: 0,
      shortfallAmount: 0,
      steps: [],
    };
  }

  let remaining = requiredAmount;
  const steps: FundingWaterfallStep[] = [];
  const takenByIndex = items.map(() => 0);

  // Step 1: Idle / unplanned cash
  const availableIdle = Math.round(Math.max(0, finiteOrZero(options.idleCash ?? 0)) * 100) / 100;
  if (availableIdle >= 0.01 && remaining >= 0.01) {
    const used = Math.min(remaining, availableIdle);
    steps.push({ sourceType: 'idle_cash', amount: Math.round(used * 100) / 100 });
    remaining = Math.round((remaining - used) * 100) / 100;
  }

  // Step 2: Overweight trim (lowest-priority buckets first, then any other overweight bucket)
  const trimOrder = [
    ...Array.from({ length: items.length - targetIndex - 1 }, (_, k) => items.length - 1 - k),
    ...Array.from({ length: targetIndex }, (_, k) => targetIndex - 1 - k),
  ];
  for (const idx of trimOrder) {
    if (remaining < 0.01) break;
    const bucket = items[idx];
    const overweight = Math.round(Math.max(0, finiteOrZero(bucket.currentValue) - finiteOrZero(bucket.targetValue)) * 100) / 100;
    if (overweight >= 0.01) {
      const used = Math.min(remaining, overweight);
      takenByIndex[idx] += used;
      steps.push({
        sourceType: 'overweight_trim',
        bucketId: bucket.id,
        bucketName: bucket.name,
        amount: Math.round(used * 100) / 100,
      });
      remaining = Math.round((remaining - used) * 100) / 100;
    }
  }

  // Step 3: Lower-priority bucket principal redemption (bottom-up, only buckets below targetIndex)
  for (let idx = items.length - 1; idx > targetIndex; idx--) {
    if (remaining < 0.01) break;
    const bucket = items[idx];
    const rest = Math.round(Math.max(0, finiteOrZero(bucket.currentValue) - takenByIndex[idx]) * 100) / 100;
    if (rest >= 0.01) {
      const used = Math.min(remaining, rest);
      takenByIndex[idx] += used;
      steps.push({
        sourceType: 'lower_priority_redeem',
        bucketId: bucket.id,
        bucketName: bucket.name,
        amount: Math.round(used * 100) / 100,
      });
      remaining = Math.round((remaining - used) * 100) / 100;
    }
  }

  const coveredAmount = Math.round((requiredAmount - remaining) * 100) / 100;
  return {
    targetBucketId: target.id,
    targetBucketName: target.name,
    requiredAmount,
    coveredAmount,
    shortfallAmount: remaining,
    steps,
  };
}

// ---- Plan Management Modes & Position Ladders (Plan A) ----
export type PlanManagementMode = 'simple' | 'ladder' | 'dividend' | 'stocks';
export type PlanLadderKind = 'price' | 'index' | 'yield';

export interface PlanLadderRow {
  id: string;
  label?: string;
  triggerValue: number;
  positionPercent: number;
}

export interface PlanLadderConfig {
  kind: PlanLadderKind;
  symbol?: string;
  symbolName?: string;
  currentQuote?: number;
  quoteDate?: string;
  rows: PlanLadderRow[];
}

export interface PlanStockCard {
  id: string;
  name: string;
  symbol?: string;
  weightPercent: number;
  targetPositionPercent: number;
  currentPrice?: number;
  actualAmount?: number;
  note?: string;
}

export type PlanLadderPresetKey = 'gold_518850' | 'chinext_159915' | 'oil_513350' | 'dividend_yield';

export function buildPresetLadderConfig(preset: PlanLadderPresetKey): PlanLadderConfig {
  if (preset === 'gold_518850') {
    const pairs: [string, number, number][] = [
      ['<1300', 2.75, 100],
      ['<1400', 3.00, 79],
      ['<1650', 3.50, 62],
      ['<1900', 4.00, 48],
      ['<2100', 4.50, 36],
      ['<2350', 5.00, 25],
      ['<2600', 5.50, 15],
      ['<2850', 6.00, 8],
      ['<3100', 6.50, 4],
      ['<3300', 7.00, 2],
      ['<3550', 7.50, 1],
      ['<3800', 8.00, 0],
    ];
    return {
      kind: 'price',
      symbol: '518850',
      symbolName: '黄金ETF',
      rows: pairs.map(([label, triggerValue, positionPercent], idx) => ({
        id: `gold-${idx + 1}`,
        label,
        triggerValue,
        positionPercent,
      })),
    };
  }
  if (preset === 'chinext_159915') {
    const pairs: [number, number][] = [
      [1200, 100], [1300, 90], [1400, 81], [1600, 73], [1800, 65],
      [2000, 58], [2200, 52], [2400, 46], [2600, 41], [2800, 36],
      [3000, 31], [3200, 27], [3400, 23], [3600, 19], [3800, 15],
      [4000, 12], [4200, 9], [4400, 6], [4600, 4], [4800, 2], [5000, 0],
    ];
    return {
      kind: 'index',
      symbol: '399006',
      symbolName: '创业板ETF',
      rows: pairs.map(([triggerValue, positionPercent], idx) => ({
        id: `chinext-${idx + 1}`,
        label: String(triggerValue),
        triggerValue,
        positionPercent,
      })),
    };
  }
  if (preset === 'oil_513350') {
    const pairs: [string, number, number][] = [
      ['<0.30', 0.30, 100],
      ['<0.45', 0.45, 79],
      ['<0.50', 0.50, 62],
      ['<0.60', 0.60, 48],
      ['<0.70', 0.70, 36],
      ['<0.80', 0.80, 25],
      ['<0.90', 0.90, 15],
      ['<1.00', 1.00, 8],
      ['<1.10', 1.10, 4],
      ['<1.20', 1.20, 2],
      ['<1.30', 1.30, 1],
      ['>1.40', 1.40, 0],
    ];
    return {
      kind: 'price',
      symbol: '513350',
      symbolName: '标普油气ETF',
      rows: pairs.map(([label, triggerValue, positionPercent], idx) => ({
        id: `oil-${idx + 1}`,
        label,
        triggerValue,
        positionPercent,
      })),
    };
  }
  const yieldPairs: [number, number][] = [
    [8.0, 100], [7.5, 90], [7.0, 80], [6.5, 70], [6.0, 60],
    [5.5, 50], [5.0, 40], [4.5, 30], [4.0, 20], [3.5, 10], [3.0, 0],
  ];
  return {
    kind: 'yield',
    rows: yieldPairs.map(([triggerValue, positionPercent], idx) => ({
      id: `div-yield-${idx + 1}`,
      label: `${triggerValue.toFixed(1)}%`,
      triggerValue,
      positionPercent,
    })),
  };
}

export function isPlanManagementMode(value: unknown): value is PlanManagementMode {
  return value === 'simple' || value === 'ladder' || value === 'dividend' || value === 'stocks';
}

export function isPlanLadderConfig(value: unknown): value is PlanLadderConfig {
  if (!value || typeof value !== 'object') return false;
  const cfg = value as PlanLadderConfig;
  if (!['price', 'index', 'yield'].includes(cfg.kind)) return false;
  if (cfg.symbol !== undefined && typeof cfg.symbol !== 'string') return false;
  if (cfg.symbolName !== undefined && typeof cfg.symbolName !== 'string') return false;
  if (cfg.currentQuote !== undefined && (typeof cfg.currentQuote !== 'number' || !Number.isFinite(cfg.currentQuote) || cfg.currentQuote < 0)) return false;
  if (cfg.quoteDate !== undefined && typeof cfg.quoteDate !== 'string') return false;
  if (!Array.isArray(cfg.rows) || cfg.rows.length > 200) return false;
  return cfg.rows.every(row => (
    Boolean(row)
    && typeof row === 'object'
    && typeof row.id === 'string'
    && row.id.trim().length > 0
    && (row.label === undefined || typeof row.label === 'string')
    && typeof row.triggerValue === 'number'
    && Number.isFinite(row.triggerValue)
    && row.triggerValue >= 0
    && typeof row.positionPercent === 'number'
    && Number.isFinite(row.positionPercent)
    && row.positionPercent >= 0
    && row.positionPercent <= 100
  ));
}

export function isPlanStockCardArray(value: unknown): value is PlanStockCard[] {
  if (!Array.isArray(value) || value.length > 200) return false;
  return value.every(card => (
    Boolean(card)
    && typeof card === 'object'
    && typeof card.id === 'string'
    && card.id.trim().length > 0
    && typeof card.name === 'string'
    && card.name.trim().length > 0
    && (card.symbol === undefined || typeof card.symbol === 'string')
    && typeof card.weightPercent === 'number'
    && Number.isFinite(card.weightPercent)
    && card.weightPercent >= 0
    && typeof card.targetPositionPercent === 'number'
    && Number.isFinite(card.targetPositionPercent)
    && card.targetPositionPercent >= 0
    && card.targetPositionPercent <= 100
    && (card.currentPrice === undefined || (typeof card.currentPrice === 'number' && Number.isFinite(card.currentPrice) && card.currentPrice >= 0))
    && (card.actualAmount === undefined || (typeof card.actualAmount === 'number' && Number.isFinite(card.actualAmount) && card.actualAmount >= 0))
    && (card.note === undefined || typeof card.note === 'string')
  ));
}

export interface ResolvedLadderTier {
  quote: number;
  activeIndex: number;
  activeRow: PlanLadderRow;
  nextBuyRow?: PlanLadderRow;
  nextSellRow?: PlanLadderRow;
  sortedRows: PlanLadderRow[];
}

/**
 * Matches a live quote (price, index point, or dividend yield %) against a position ladder table
 * to highlight the active row and determine the adjacent buy/sell trigger tiers.
 */
export function resolveActiveLadderTier(
  config: PlanLadderConfig | undefined,
  overrideQuote?: number,
): ResolvedLadderTier | null {
  if (!config || !Array.isArray(config.rows) || config.rows.length === 0) return null;
  const quote = overrideQuote ?? config.currentQuote;
  if (quote === undefined || !Number.isFinite(quote) || quote <= 0) return null;

  if (config.kind === 'yield') {
    // Higher dividend yield = cheaper valuation = higher position ratio (sorted descending: 8.0% -> 3.0%).
    // A tier triggers only once yield rises into it (quote >= triggerValue).
    const sortedRows = [...config.rows].sort((a, b) => b.triggerValue - a.triggerValue || b.positionPercent - a.positionPercent);
    let activeIndex = sortedRows.findIndex(row => quote >= row.triggerValue);
    if (activeIndex < 0) activeIndex = sortedRows.length - 1;
    const activeRow = sortedRows[activeIndex];
    const nextBuyRow = activeIndex > 0 ? sortedRows[activeIndex - 1] : undefined;
    const nextSellRow = activeIndex < sortedRows.length - 1 ? sortedRows[activeIndex + 1] : undefined;
    return { quote, activeIndex, activeRow, nextBuyRow, nextSellRow, sortedRows };
  }

  // Price or index ladder: lower price/point = cheaper valuation = higher position ratio (sorted ascending: 2.75 -> 8.00).
  // A tier triggers only once price/index drops into it (quote <= triggerValue).
  const sortedRows = [...config.rows].sort((a, b) => a.triggerValue - b.triggerValue || b.positionPercent - a.positionPercent);
  let activeIndex = sortedRows.findIndex(row => quote <= row.triggerValue);
  if (activeIndex < 0) activeIndex = sortedRows.length - 1;
  const activeRow = sortedRows[activeIndex];
  const nextBuyRow = activeIndex > 0 ? sortedRows[activeIndex - 1] : undefined;
  const nextSellRow = activeIndex < sortedRows.length - 1 ? sortedRows[activeIndex + 1] : undefined;
  return { quote, activeIndex, activeRow, nextBuyRow, nextSellRow, sortedRows };
}

export interface PlanDynamicMetrics {
  mode: PlanManagementMode;
  /** Position ratio at the active ladder tier; null when no quote is available to place a tier. */
  activePositionPercent: number | null;
  dynamicTargetValue: number;
  reserveNeededValue: number;
  dynamicGapValue: number;
  resolvedLadder: ResolvedLadderTier | null;
  /** True when a ladder/dividend plan has tiers but no quote, so a tier cannot be placed. */
  quoteMissing: boolean;
}

export function computePlanDynamicMetrics(
  item: {
    targetValue: number;
    currentValue: number;
    planMode?: PlanManagementMode;
    ladderConfig?: PlanLadderConfig;
    stockCards?: PlanStockCard[];
  },
  options: { overrideQuote?: number } = {},
): PlanDynamicMetrics {
  const mode: PlanManagementMode = item.planMode ?? (item.ladderConfig ? 'ladder' : item.stockCards?.length ? 'stocks' : 'simple');
  const fullTarget = Math.max(0, finiteOrZero(item.targetValue));
  const current = Math.max(0, finiteOrZero(item.currentValue));

  if (mode === 'ladder' || mode === 'dividend') {
    const fallbackLadder = mode === 'dividend' && (!item.ladderConfig || item.ladderConfig.rows.length === 0)
      ? buildPresetLadderConfig('dividend_yield')
      : item.ladderConfig;
    const resolvedLadder = resolveActiveLadderTier(fallbackLadder, options.overrideQuote);
    // Without a quote no tier can be placed, so never fabricate a 100% "buy to full" stance.
    const quoteMissing = !resolvedLadder;
    const activePositionPercent = resolvedLadder ? resolvedLadder.activeRow.positionPercent : null;
    const dynamicTargetValue = activePositionPercent === null ? fullTarget : Math.round(fullTarget * activePositionPercent) / 100;
    const reserveNeededValue = Math.max(0, Math.round((fullTarget - dynamicTargetValue) * 100) / 100);
    const dynamicGapValue = Math.round((dynamicTargetValue - current) * 100) / 100;
    return {
      mode,
      activePositionPercent,
      dynamicTargetValue,
      reserveNeededValue,
      dynamicGapValue,
      resolvedLadder,
      quoteMissing,
    };
  }

  if (mode === 'stocks' && item.stockCards && item.stockCards.length > 0) {
    const weightedPct = item.stockCards.reduce((sum, card) => (
      sum + (finiteOrZero(card.weightPercent) * finiteOrZero(card.targetPositionPercent)) / 100
    ), 0);
    const activePositionPercent = Math.min(100, Math.max(0, Math.round(weightedPct * 100) / 100));
    const dynamicTargetValue = Math.round(fullTarget * activePositionPercent) / 100;
    const reserveNeededValue = Math.max(0, Math.round((fullTarget - dynamicTargetValue) * 100) / 100);
    const dynamicGapValue = Math.round((dynamicTargetValue - current) * 100) / 100;
    return {
      mode,
      activePositionPercent,
      dynamicTargetValue,
      reserveNeededValue,
      dynamicGapValue,
      resolvedLadder: null,
      quoteMissing: false,
    };
  }

  // 'simple' mode (or empty 'stocks'): 100% of quota is active
  return {
    mode,
    activePositionPercent: 100,
    dynamicTargetValue: fullTarget,
    reserveNeededValue: 0,
    dynamicGapValue: Math.round((fullTarget - current) * 100) / 100,
    resolvedLadder: null,
    quoteMissing: false,
  };
}

export interface EditableLadderRowInput {
  id: string;
  label: string;
  triggerValue: string;
  positionPercent: string;
}

function autoLadderLabel(kind: PlanLadderKind, triggerRaw: string): string | undefined {
  const num = Number(triggerRaw.trim());
  if (!triggerRaw.trim() || !Number.isFinite(num)) return undefined;
  if (kind === 'yield') return `${num.toFixed(1)}%`;
  if (kind === 'index') return String(Math.round(num * 10) / 10);
  return undefined;
}

/** Keeps auto-generated yield/index labels aligned when the trigger value is edited directly. */
export function syncEditableLadderLabel(
  kind: PlanLadderKind,
  prevTrigger: string,
  nextTrigger: string,
  currentLabel: string,
): string {
  if (kind === 'price') return currentLabel;
  const trimmed = currentLabel.trim();
  const prevAuto = autoLadderLabel(kind, prevTrigger);
  const prevRawNum = prevTrigger.trim();
  if (!trimmed || trimmed === prevAuto || trimmed === prevRawNum || trimmed === `${prevRawNum}%`) {
    return autoLadderLabel(kind, nextTrigger) ?? '';
  }
  return currentLabel;
}

/** Parses and validates inline ladder rows without silently dropping invalid entries. */
export function parseEditableLadderRows(
  rows: readonly EditableLadderRowInput[],
  kind: PlanLadderKind,
): { ok: true; rows: PlanLadderRow[] } | { ok: false; error: 'empty' | 'invalid_row' } {
  if (rows.length === 0) return { ok: false, error: 'empty' };
  const parsed: PlanLadderRow[] = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const tvRaw = row.triggerValue.trim();
    const pctRaw = row.positionPercent.trim();
    const tv = tvRaw ? Number(tvRaw) : NaN;
    const pct = pctRaw ? Number(pctRaw) : NaN;
    if (!Number.isFinite(tv) || tv < 0 || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: 'invalid_row' };
    }
    const labelTrimmed = row.label.trim();
    const effectiveLabel = kind === 'price'
      ? labelTrimmed
      : labelTrimmed || autoLadderLabel(kind, tvRaw) || '';
    parsed.push({
      id: row.id || `row-${idx + 1}`,
      ...(effectiveLabel ? { label: effectiveLabel } : {}),
      triggerValue: tv,
      positionPercent: pct,
    });
  }
  return { ok: true, rows: parsed };
}

