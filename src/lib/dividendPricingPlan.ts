import { CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS, DIVIDEND_PRICING_CALCULATION_VERSION, invalidateOutdatedDividendPricing, type DividendPricingResult } from './dividendPricing.ts';
import type { DividendGridProvenance } from './dividendGridProvenance.ts';
import type { DividendStock, GridLevel } from './dividendWorkbench.ts';
import { DIVIDEND_OFFICIAL_PARSER_VERSION } from './dividendLedger.ts';

/** Both sides use the same verified recent-batch base and the user's fixed cash-yield ladder. */
export function dividendPricingPlan(source: DividendPricingResult): { buyLevels: GridLevel[]; sellLevels: GridLevel[] } | null {
  const pricing = invalidateOutdatedDividendPricing(source);
  const dividend = pricing.d1Micros, base = pricing.dividendBase;
  const buyYields = pricing.buyYieldBps, sellYields = pricing.sellYieldBps;
  if (pricing.calculationVersion !== DIVIDEND_PRICING_CALCULATION_VERSION || pricing.pricingBasis !== 'recent_batches'
    || !pricing.canApply || pricing.status !== 'ready' || pricing.blockers.length > 0 || !Array.isArray(buyYields) || buyYields.length < 1
    || pricing.grid.length !== buyYields.length
    || !dividend || !Number.isSafeInteger(dividend) || !base || !Number.isSafeInteger(base.dpsMicros)
    || ![0,1000,2000].includes(pricing.taxBps)
    || dividend !== Number(BigInt(base.dpsMicros!) * BigInt(10000-pricing.taxBps) / 10000n)
    || pricing.anchors.selectedBps !== CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS || pricing.anchors.selection !== 'fixed_classic'
    || pricing.theoreticalPriceMinor !== Math.floor(dividend / CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS)) return null;
  if (pricing.grid.some((level,index) => level.yieldBps !== buyYields[index]
    || level.priceMinor !== Math.floor(dividend / buyYields[index])
    || level.cumulativePortionBps !== (index+1)*2500)) return null;
  const buyLevels = pricing.grid.map(level => ({ priceMinor: level.priceMinor, yieldBps: level.yieldBps, portionBps: 2500 }));
  const sellLevels = (sellYields ?? []).map(yieldBps => ({ yieldBps, portionBps: 2500, priceMinor: Number((BigInt(dividend) + BigInt(yieldBps) - 1n) / BigInt(yieldBps)) }));
  if (buyLevels.some((level,index) => !Number.isSafeInteger(level.priceMinor) || level.priceMinor <= 0
      || index > 0 && level.priceMinor >= buyLevels[index-1].priceMinor)
    || sellLevels.length !== buyLevels.length
    || sellLevels.some((level, index) => !Number.isSafeInteger(level.priceMinor) || level.priceMinor <= 0
      || index > 0 && level.priceMinor <= sellLevels[index - 1].priceMinor)
    || Math.max(...buyLevels.map(level => level.priceMinor)) >= sellLevels[0].priceMinor) return null;
  return { buyLevels, sellLevels };
}

/** Async inspection results may belong to the previous research snapshot.
 * Never combine that plan's prices with this snapshot's dividend arithmetic. */
export function dividendPricingPlanForCheck(source: DividendPricingResult, checkedPlan?: ReturnType<typeof dividendPricingPlan>) {
  const plan = dividendPricingPlan(source);
  if (!plan || checkedPlan === null) return null;
  if (checkedPlan === undefined) return plan;
  return (['buyLevels', 'sellLevels'] as const).every(side => plan[side].length === checkedPlan[side].length
    && plan[side].every((level, index) => {
      const checked = checkedPlan[side][index];
      return level.priceMinor === checked.priceMinor && level.yieldBps === checked.yieldBps && level.portionBps === checked.portionBps;
    })) ? plan : null;
}

/** Compare all eight displayed prices and their parameters without changing a saved plan. */
export function dividendPricingPlanChange(plan: NonNullable<ReturnType<typeof dividendPricingPlan>>, saved?: Pick<DividendStock, 'buyLevels' | 'sellLevels'>) {
  const hasSaved = (['buyLevels', 'sellLevels'] as const).some(side => saved?.[side]?.some(row => row.priceMinor !== undefined));
  const rows = (['buy', 'sell'] as const).flatMap(side => plan[`${side}Levels`].map((row, index) => ({
    side, index: index + 1, row, previous: saved?.[`${side}Levels`]?.[index],
  })));
  const priceChanges = rows.filter(({ row, previous }) => row.priceMinor !== previous?.priceMinor);
  const extraRows = (['buyLevels', 'sellLevels'] as const).some(side => (saved?.[side]?.length ?? 0) !== plan[side].length);
  const parameterChanges = extraRows || rows.some(({ row, previous }) => row.yieldBps !== previous?.yieldBps || row.portionBps !== previous?.portionBps);
  return { status: !hasSaved ? 'unsaved' as const : priceChanges.length || extraRows ? 'changed' as const : parameterChanges ? 'parameters' as const : 'same' as const,
    changedCount: priceChanges.length, firstChange: priceChanges[0] && { side: priceChanges[0].side, index: priceChanges[0].index,
      previousPriceMinor: priceChanges[0].previous?.priceMinor, priceMinor: priceChanges[0].row.priceMinor }, firstBuyPriceMinor: plan.buyLevels[0]?.priceMinor };
}

/** Origin is created by deterministic code, never copied from a model-supplied JSON field. */
export function dividendPricingProvenance(pricing: DividendPricingResult, generatedAt: number): DividendGridProvenance | undefined {
  if (!dividendPricingPlan(pricing) || !Number.isSafeInteger(generatedAt) || generatedAt <= 0) return undefined;
  return { generatedAt, grossDpsMicros: pricing.dividendBase!.dpsMicros!, taxBps: pricing.taxBps as 0 | 1000 | 2000,
    parameterVersion: DIVIDEND_PRICING_CALCULATION_VERSION, basisKind: 'recent_batches',
    ...(!pricing.userConfirmedEvidence ? { officialParserVersion: DIVIDEND_OFFICIAL_PARSER_VERSION } : {}),
    ...(pricing.userConfirmedEvidence ? { userConfirmedAt: pricing.userConfirmedEvidence.confirmedAt, userConfirmedExpiresOn: pricing.userConfirmedEvidence.expiresOn } : {}) };
}
