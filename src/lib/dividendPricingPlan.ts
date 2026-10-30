import { CLASSIC_DIVIDEND_BUY_YIELDS, CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS, CLASSIC_DIVIDEND_SELL_YIELDS,
  DIVIDEND_PRICING_CALCULATION_VERSION, type DividendPricingResult } from './dividendPricing.ts';
import type { DividendGridProvenance } from './dividendGridProvenance.ts';
import type { GridLevel } from './dividendWorkbench.ts';

/** Both sides use the same verified recent-batch base and the user's fixed cash-yield ladder. */
export function dividendPricingPlan(pricing: DividendPricingResult): { buyLevels: GridLevel[]; sellLevels: GridLevel[] } | null {
  const dividend = pricing.d1Micros, base = pricing.dividendBase;
  if (pricing.calculationVersion !== DIVIDEND_PRICING_CALCULATION_VERSION || pricing.pricingBasis !== 'recent_batches'
    || !pricing.canApply || pricing.status !== 'ready' || pricing.blockers.length > 0 || pricing.grid.length !== CLASSIC_DIVIDEND_BUY_YIELDS.length
    || !dividend || !Number.isSafeInteger(dividend) || !base || !Number.isSafeInteger(base.dpsMicros)
    || !base.verified || ![0,1000,2000].includes(pricing.taxBps)
    || dividend !== Number(BigInt(base.dpsMicros!) * BigInt(10000-pricing.taxBps) / 10000n)
    || pricing.anchors.selectedBps !== CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS || pricing.anchors.selection !== 'fixed_classic'
    || pricing.theoreticalPriceMinor !== Math.floor(dividend / CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS)) return null;
  if (pricing.grid.some((level,index) => level.yieldBps !== CLASSIC_DIVIDEND_BUY_YIELDS[index]
    || level.priceMinor !== Math.floor(dividend / CLASSIC_DIVIDEND_BUY_YIELDS[index])
    || level.cumulativePortionBps !== (index+1)*2500)) return null;
  const buyLevels = pricing.grid.map(level => ({ priceMinor: level.priceMinor, yieldBps: level.yieldBps, portionBps: 2500 }));
  const sellLevels = CLASSIC_DIVIDEND_SELL_YIELDS.map(yieldBps => ({ yieldBps, portionBps: 2500, priceMinor: Number((BigInt(dividend) + BigInt(yieldBps) - 1n) / BigInt(yieldBps)) }));
  if (buyLevels.some((level,index) => !Number.isSafeInteger(level.priceMinor) || level.priceMinor <= 0
      || index > 0 && level.priceMinor >= buyLevels[index-1].priceMinor)
    || sellLevels.some((level, index) => !Number.isSafeInteger(level.priceMinor) || level.priceMinor <= 0
      || index > 0 && level.priceMinor <= sellLevels[index - 1].priceMinor)
    || Math.max(...buyLevels.map(level => level.priceMinor)) >= sellLevels[0].priceMinor) return null;
  return { buyLevels, sellLevels };
}

/** Origin is created by deterministic code, never copied from a model-supplied JSON field. */
export function dividendPricingProvenance(pricing: DividendPricingResult, generatedAt: number): DividendGridProvenance | undefined {
  if (!dividendPricingPlan(pricing) || !Number.isSafeInteger(generatedAt) || generatedAt <= 0) return undefined;
  return { generatedAt, grossDpsMicros: pricing.dividendBase!.dpsMicros!, taxBps: pricing.taxBps as 0 | 1000 | 2000,
    parameterVersion: DIVIDEND_PRICING_CALCULATION_VERSION, basisKind: 'recent_batches' };
}
