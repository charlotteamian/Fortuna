import type { DividendIndexResearch, DividendResearchRule, DividendStockResearch } from './dividendResearch.ts';
import type { DividendPricingBlocker } from './dividendPricing.ts';

export type DividendResearchDecision = 'risk' | 'pause' | 'wait_stable' | 'evidence' | 'wait_price' | 'eligible';
export interface DividendResearchAdvice {
  decision: DividendResearchDecision;
  failedRules: DividendResearchRule[];
  missingRules: DividendResearchRule[];
  pricingBlockers: DividendPricingBlocker[];
  technicalMissing: boolean;
  marketMissing: boolean;
  marketPacing: 'observe' | 'review_grid' | 'pause_add';
  additionalRulesUnverified: boolean;
  currentPriceMinor?: number;
  marginPriceMinor?: number;
}

/** A deterministic, evidence-bound conclusion is available without configuring an AI model. */
export function dividendResearchAdvice(stock: DividendStockResearch, indices: DividendIndexResearch[], additionalRules?: string): DividendResearchAdvice {
  const failedRules = stock.checks.filter(check => check.status === 'risk').map(check => check.rule);
  const missingRules = stock.checks.filter(check => check.status === 'unknown').map(check => check.rule);
  const pricingBlockers = stock.pricing?.blockers ?? [];
  const technicalMissing = !stock.technical?.currentUsable;
  // Broad-market indices govern pacing; the growth index alone cannot establish the market condition.
  const broad = indices.filter(index => index.code !== 'sz399006');
  const usableMarket = broad.filter(index => index.technical?.currentUsable);
  const marketMissing = !usableMarket.length;
  const marketPacing = usableMarket.some(index => index.technical?.pacing === 'pause_add') ? 'pause_add'
    : usableMarket.some(index => index.technical?.pacing === 'review_grid') ? 'review_grid' : 'observe';
  const currentPriceMinor = stock.pricing?.currentPriceMinor;
  const marginPriceMinor = stock.pricing?.marginPriceMinor;
  const additionalRulesUnverified = Boolean(additionalRules?.trim());
  const sustainabilityFailure = pricingBlockers.some(blocker => ['non_positive_earnings', 'payout_above_100', 'fcf_non_positive', 'fcf_below_150', 'implausible_yield'].includes(blocker));
  const decision: DividendResearchDecision = failedRules.length || sustainabilityFailure ? 'risk'
    : stock.technical?.currentUsable && stock.technical.pacing === 'pause_add' || marketPacing === 'pause_add' ? 'pause'
    : stock.technical?.currentUsable && stock.technical.pacing === 'review_grid' || marketPacing === 'review_grid' ? 'wait_stable'
    : missingRules.length || pricingBlockers.length || technicalMissing || marketMissing || additionalRulesUnverified || !stock.pricing?.canApply
      || currentPriceMinor === undefined || marginPriceMinor === undefined ? 'evidence'
    : currentPriceMinor > marginPriceMinor ? 'wait_price' : 'eligible';
  return { decision, failedRules, missingRules, pricingBlockers, technicalMissing, marketMissing, marketPacing, additionalRulesUnverified, currentPriceMinor, marginPriceMinor };
}
