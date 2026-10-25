import type { DividendResearchAdvice } from './dividendResearchAdvice.ts';
import type { DividendPricingBlocker } from './dividendPricing.ts';
import type { DividendResearchRule, DividendStockResearch } from './dividendResearch.ts';

export interface DividendReviewSummaryItem {
  topic: string;
  labelKey: string;
  rules: DividendResearchRule[];
  pricingIssues: DividendPricingBlocker[];
  factKey?: string;
  comparison?: { value: number; threshold: number; unit: 'percent' | 'years'; direction: 'below' | 'above' };
}
export interface DividendReviewSummary { risks: DividendReviewSummaryItem[]; missing: DividendReviewSummaryItem[] }

const ruleTopic: Record<DividendResearchRule, string> = {
  yield: 'yield', roe: 'roe', revenueGrowth: 'revenue', profitGrowth: 'profit', debtAsset: 'debt', cashProfit: 'operating_cash',
  payout: 'payout', fiveYearPayout: 'payout', dividendYears: 'dividend_history', financialSector: 'financial_sector',
  reportFreshness: 'report', fcfCoverage: 'cashflow',
};
const pricingTopic: Record<DividendPricingBlocker, string> = {
  annual_eps_missing: 'earnings', non_positive_earnings: 'earnings', cyclical_normalisation_required: 'earnings',
  annual_payout_missing: 'payout', payout_above_100: 'payout',
  trailing_dividend_missing: 'trailing_dividend', trailing_dividend_invalid: 'trailing_dividend', trailing_dividend_stale: 'trailing_dividend',
  trailing_dividend_zero: 'trailing_dividend', cash_distributions_incomplete: 'trailing_dividend',
  fcf_missing: 'cashflow', fcf_below_150: 'cashflow', fcf_non_positive: 'cashflow', fcf_dividend_capped: 'cashflow',
  financial_sector_review: 'financial_sector', treasury_missing: 'treasury', treasury_stale: 'treasury',
  yield_history_missing: 'yield_history', capital_actions_unverified: 'yield_history', opportunity_cost_missing: 'opportunity', opportunity_cost_stale: 'opportunity',
  anchors_conflict: 'anchors', anchors_missing: 'anchors', growth_return_conflict: 'gordon', quote_missing: 'quote',
  roe_bps_missing: 'pb_reference', annual_stale: 'report', dividend_continuity_missing: 'dividend_history', implausible_yield: 'valuation_scale', pricing_calculation_stale: 'financial_evidence',
};

/** Count topics once while retaining every rule and pricing observation for the details. */
export function dividendReviewSummary(stock: DividendStockResearch, advice: DividendResearchAdvice): DividendReviewSummary {
  const risks = new Map<string, DividendReviewSummaryItem>(), missing = new Map<string, DividendReviewSummaryItem>();
  const add = (status: 'risk' | 'unknown', topic: string, rule?: DividendResearchRule, issue?: DividendPricingBlocker) => {
    const group = status === 'risk' ? risks : missing;
    const item = group.get(topic) ?? { topic, labelKey: `div_v4_topic_${topic}`, rules: [], pricingIssues: [] };
    if (rule && !item.rules.includes(rule)) item.rules.push(rule);
    if (issue && !item.pricingIssues.includes(issue)) item.pricingIssues.push(issue);
    group.set(topic, item);
  };
  for (const rule of advice.failedRules) add('risk', ruleTopic[rule], rule);
  for (const rule of advice.missingRules) add('unknown', ruleTopic[rule], rule);
  for (const issue of advice.pricingRiskReasons) add('risk', pricingTopic[issue], undefined, issue);
  const recentCash = stock.pricing?.annuals.slice(0, 3) ?? [];
  const completeCashInputs = recentCash.length === 3 && recentCash.every(year => Number.isSafeInteger(year.operatingCashMinor)
    && Number.isSafeInteger(year.capitalExpenditureMinor) && year.capitalExpenditureMinor! >= 0 && Number.isSafeInteger(year.totalShares) && year.totalShares! > 0
    || Number.isSafeInteger(year.fcfCoverageBps) && Number.isSafeInteger(year.dividendMicros) && year.dividendMicros! > 0);
  for (const issue of advice.pricingMissingReasons) {
    // A known non-positive year cannot supply positive cash support. Do not
    // count that derived calculation gap as another missing-data topic.
    if (issue === 'fcf_missing' && completeCashInputs && advice.pricingRiskReasons.includes('fcf_non_positive')) add('risk', 'cashflow', undefined, issue);
    else add('unknown', pricingTopic[issue], undefined, issue);
  }
  if (!stock.checks.length) add('unknown', 'financial_evidence');
  const sector = stock.financial?.sectorReview ?? stock.pricing?.financialReview;
  if (sector?.metrics.some(metric => metric.status === 'risk')) add('risk', 'financial_sector');
  if (sector?.missing.length || sector?.metrics.some(metric => metric.status === 'unknown')) add('unknown', 'financial_sector');
  if (stock.technical?.currentUsable && stock.technical.pacing !== 'observe') add('risk', 'stock_trend');
  if (advice.marketPacing !== 'observe') add('risk', 'market_trend');
  if (advice.technicalMissing) add('unknown', 'stock_trend');
  if (advice.marketMissing) add('unknown', 'market_trend');
  if (advice.additionalRulesUnverified) add('unknown', 'additional_rules');
  for (const item of risks.values()) {
    const check = stock.checks.find(check => check.status === 'risk' && item.rules.includes(check.rule) && check.value !== undefined && check.threshold !== undefined);
    if (check) item.comparison = { value: check.value!, threshold: check.threshold!, unit: check.rule === 'dividendYears' ? 'years' : 'percent',
      direction: ['debtAsset', 'payout', 'fiveYearPayout'].includes(check.rule) ? 'above' : 'below' };
    else if (item.pricingIssues.includes('fcf_non_positive')) item.factKey = 'div_v4_fact_fcf_non_positive';
    else if (item.pricingIssues.includes('fcf_below_150')) item.factKey = 'div_v4_fact_fcf_low';
    else if (item.pricingIssues.includes('fcf_dividend_capped')) item.factKey = 'div_v4_fact_fcf_capped';
    else if (item.pricingIssues.includes('payout_above_100')) item.factKey = 'div_v4_fact_payout_high';
    else if (item.pricingIssues.includes('non_positive_earnings')) item.factKey = 'div_v4_fact_earnings_non_positive';
    else if (item.topic === 'financial_sector') item.factKey = 'div_v4_fact_sector_risk';
    else if (item.topic === 'stock_trend') item.factKey = stock.technical?.state === 'accelerating_down' ? 'div_v4_fact_stock_accelerating' : 'div_v4_fact_stock_falling';
    else if (item.topic === 'market_trend') item.factKey = advice.marketPacing === 'pause_add' ? 'div_v4_fact_market_accelerating' : 'div_v4_fact_market_falling';
    else if (item.topic === 'anchors') item.factKey = 'div_v4_fact_anchors_conflict';
    else if (item.topic === 'gordon') item.factKey = 'div_v4_fact_gordon';
    else if (item.topic === 'valuation_scale') item.factKey = 'div_v4_fact_valuation_scale';
  }
  return { risks: [...risks.values()], missing: [...missing.values()] };
}
