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
