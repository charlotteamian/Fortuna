import type { DividendIndexResearch, DividendResearchRule, DividendStockResearch } from './dividendResearch.ts';
import type { DividendPricingBlocker } from './dividendPricing.ts';
import { buildGrid, type DividendStock } from './dividendWorkbench.ts';

export type DividendResearchDecision = 'evidence' | 'wait_price' | 'eligible';
export interface DividendResearchAdvice {
  decision: DividendResearchDecision;
  failedRules: DividendResearchRule[];
  missingRules: DividendResearchRule[];
  pricingBlockers: DividendPricingBlocker[];
  pricingPauseReasons: DividendPricingBlocker[];
  pricingRiskReasons: DividendPricingBlocker[];
  pricingMissingReasons: DividendPricingBlocker[];
  technicalMissing: boolean;
  marketMissing: boolean;
  marketPacing: 'observe' | 'review_grid' | 'pause_add';
  additionalRulesUnverified: boolean;
  currentPriceMinor?: number;
  marginPriceMinor?: number;
  firstBuyPriceMinor?: number;
  triggeredBuyLevels: number[];
}

/** Keep an observed shortfall separate from evidence which has not been obtained. */
export function dividendPricingIssueIsRisk(issue: DividendPricingBlocker, stock: DividendStockResearch): boolean {
  if (issue === 'financial_sector_review') return stock.financial?.sectorReview?.status === 'risk' || stock.pricing?.financialReview?.status === 'risk';
  return ['non_positive_earnings', 'payout_above_100', 'fcf_below_150', 'fcf_non_positive', 'fcf_dividend_capped',
    'anchors_conflict', 'growth_return_conflict', 'implausible_yield'].includes(issue);
}

/** A deterministic, evidence-bound conclusion is available without configuring an AI model. */
export function dividendResearchAdvice(stock: DividendStockResearch, indices: DividendIndexResearch[], additionalRules?: string, savedStock?: DividendStock): DividendResearchAdvice {
  const failedRules = stock.checks.filter(check => check.status === 'risk').map(check => check.rule);
  const missingRules = stock.checks.filter(check => check.status === 'unknown').map(check => check.rule);
  const pricingBlockers = stock.pricing?.blockers ?? [];
  const pricingPauseReasons = stock.pricing?.pauseReasons ?? [];
  const technicalMissing = !stock.technical?.currentUsable;
  // Broad-market conditions are risk context, never a switch for the saved grid.
  const broad = indices.filter(index => index.code !== 'sz399006');
  const usableMarket = broad.filter(index => index.technical?.currentUsable);
  const marketMissing = !broad.length || usableMarket.length !== broad.length;
  const marketPacing = usableMarket.some(index => index.technical?.pacing === 'pause_add') ? 'pause_add'
    : usableMarket.some(index => index.technical?.pacing === 'review_grid') ? 'review_grid' : 'observe';
  const currentPriceMinor = stock.pricing?.currentPriceMinor;
  const marginPriceMinor = stock.pricing?.marginPriceMinor;
  const additionalRulesUnverified = Boolean(additionalRules?.trim());
  const issues = [...new Set([...pricingBlockers, ...pricingPauseReasons, ...stock.pricing?.warnings ?? []])];
  const pricingRiskReasons = issues.filter(issue => dividendPricingIssueIsRisk(issue, stock));
  const pricingMissingReasons = issues.filter(issue => !dividendPricingIssueIsRisk(issue, stock));
  const grid = savedStock ? buildGrid(savedStock, 0, 0, 'buy', stock.pricing?.priceDate) : stock.pricing?.canApply ? stock.pricing.grid : [];
  const firstBuyPriceMinor = grid[0]?.priceMinor;
  const quoteUsable = currentPriceMinor !== undefined && currentPriceMinor > 0 && !issues.includes('quote_missing');
  const triggeredBuyLevels = quoteUsable ? grid.flatMap((level, index) => level.priceMinor !== undefined && currentPriceMinor <= level.priceMinor ? [index + 1] : []) : [];
  // A margin-of-safety reference must not become a second gate on an already
  // discounted ladder. Financial and technical findings remain visible below.
  const decision: DividendResearchDecision = !quoteUsable || !grid.some(level => level.priceMinor !== undefined) ? 'evidence' : triggeredBuyLevels.length ? 'eligible' : 'wait_price';
  return { decision, failedRules, missingRules, pricingBlockers, pricingPauseReasons, pricingRiskReasons, pricingMissingReasons,
    technicalMissing, marketMissing, marketPacing, additionalRulesUnverified, currentPriceMinor, marginPriceMinor, firstBuyPriceMinor, triggeredBuyLevels };
}
