export interface AllocationTargetLike {
  id?: string;
  targetPercent?: number;
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
