import type { DividendPricingResult } from './dividendPricing.ts';
import { BUY_LEVELS, SELL_LEVELS, type GridLevel } from './dividendWorkbench.ts';

/** Keep both sides on the same sustainable dividend and valuation yield. */
export function dividendPricingPlan(pricing: DividendPricingResult): { buyLevels: GridLevel[]; sellLevels: GridLevel[] } | null {
  const dividend = pricing.d1Micros, anchor = pricing.anchors.selectedBps;
  if (!pricing.canApply || pricing.status !== 'ready' || pricing.grid.length !== 3
    || !dividend || !Number.isSafeInteger(dividend) || !anchor || !Number.isSafeInteger(anchor)) return null;
  const buyLevels = pricing.grid.map((level, index) => ({ priceMinor: level.priceMinor, yieldBps: level.yieldBps,
    portionBps: index === 2 ? 3334 : 3333 }));
  // Existing default sells are 450/400/350/300 against a 500-bp first buy.
  // Preserve those ratios (90/80/70/60%) against this stock's selected anchor.
  const sellLevels = SELL_LEVELS.map(level => {
    const yieldBps = Math.max(1, Math.floor(anchor * level.yieldBps / BUY_LEVELS[0].yieldBps));
    return { yieldBps, portionBps: level.portionBps, priceMinor: Math.floor(dividend / yieldBps) };
  });
  if (buyLevels.some(level => !Number.isSafeInteger(level.priceMinor) || level.priceMinor <= 0)
    || sellLevels.some((level, index) => !Number.isSafeInteger(level.priceMinor) || level.priceMinor <= 0
      || index > 0 && level.priceMinor <= sellLevels[index - 1].priceMinor)
    || Math.max(...buyLevels.map(level => level.priceMinor)) >= sellLevels[0].priceMinor) return null;
  return { buyLevels, sellLevels };
}
