import { db } from '../db.ts';
import { buildGrid, dateInChina, type DividendStock } from '../lib/dividendWorkbench.ts';
import type { DividendPlanProposal } from '../lib/dividendAdvisorActions.ts';
import { dividendResearchAdvice } from '../lib/dividendResearchAdvice.ts';
import type { DividendResearchSnapshot } from '../lib/dividendResearch.ts';
import { fetchDividendResearch } from './dividendResearchService.ts';
import { loadDividendPricingMethod, loadDividendSelectionPrinciples, previewDividendPlanChange } from './dividendAdvisorActionsService.ts';

export const DIVIDEND_RESUME_REVIEW_MAX_AGE_MS = 15 * 60_000;
export interface DividendResumeReview {
  snapshot: DividendResearchSnapshot;
  advice: ReturnType<typeof dividendResearchAdvice>;
  proposal: DividendPlanProposal | null;
  planFingerprint: string;
  reviewedAt: number;
  operationsPass: boolean;
  pricePass: boolean;
  technicalPass: boolean;
  wasPaused: boolean;
  priceState: 'triggered' | 'waiting' | 'unknown';
  savedBuyPricesMinor: (number | undefined)[];
  triggeredBuyLevels: number[];
}

export async function reviewDividendResume(stock: Pick<DividendStock, 'code' | 'name'>,
  options: { fetchResearch?: typeof fetchDividendResearch; now?: () => number } = {}): Promise<DividendResumeReview> {
  const [principles, method] = await Promise.all([loadDividendSelectionPrinciples(), loadDividendPricingMethod()]);
  const proposal: DividendPlanProposal = { id: `resume-${stock.code}`, code: stock.code, buyPaused: false,
    reason: 'Fresh financial, price and technical evidence reviewed; resuming the saved grid is the user’s decision after reading the alerts.' };
  const { saved, before } = await db.transaction('r', db.dividendStocks, db.settings, async () => {
    const saved = await db.dividendStocks.get(stock.code);
    if (!saved) throw new Error('DIVIDEND_STOCK_MISSING');
    return { saved, before: await previewDividendPlanChange(proposal) };
  });
  const snapshot = await (options.fetchResearch ?? fetchDividendResearch)([stock], principles, { pricingMethod: method, maxStocks: 1, timeBudgetMs: 60000 });
  const result = snapshot.stocks.find(value => value.code === stock.code);
  if (!result) throw new Error('DIVIDEND_REVIEW_REQUIRED');
  const asOf = dateInChina(new Date((options.now ?? Date.now)()));
  const advice = dividendResearchAdvice(result, snapshot.indices, principles.notes, saved, asOf);
  const operationsPass = result.checks.length > 0 && !advice.failedRules.length && !advice.missingRules.length
    && !advice.additionalRulesUnverified && !advice.pricingPauseReasons.filter(reason => reason !== 'quote_missing').length;
  const savedBuyPricesMinor = buildGrid(saved, 0, 0, 'buy', asOf).map(level => level.priceMinor);
  const triggeredBuyLevels = advice.triggeredBuyLevels;
  const priceState = !advice.quoteUsable || savedBuyPricesMinor.every(price => price === undefined) ? 'unknown' : triggeredBuyLevels.length ? 'triggered' : 'waiting';
  const pricePass = priceState === 'triggered';
  const technicalPass = !advice.technicalMissing && !advice.marketMissing && result.technical?.pacing === 'observe' && advice.marketPacing === 'observe';
  const review: DividendResumeReview = { snapshot: { ...snapshot, principles, pricingMethod: method }, advice, operationsPass, pricePass, technicalPass,
    // Re-enabling monitoring is distinct from placing a trade. Alerts and a
    // price above the ladder never silently change the user's pause setting.
    proposal: saved.buyPaused ? proposal : null, wasPaused: Boolean(saved.buyPaused), priceState, savedBuyPricesMinor, triggeredBuyLevels,
    planFingerprint: before.fingerprint, reviewedAt: (options.now ?? Date.now)() };
  await assertDividendResumeReviewCurrent(review, proposal, options.now);
  return review;
}

/** A report cannot resume a different plan or survive changed user assumptions. */
export async function assertDividendResumeReviewCurrent(review: DividendResumeReview, proposal = review.proposal, now = Date.now) {
  if (!proposal || proposal.buyPaused !== false) throw new Error('DIVIDEND_REVIEW_REQUIRED');
  const age = now() - review.reviewedAt;
  if (age < 0 || age > DIVIDEND_RESUME_REVIEW_MAX_AGE_MS) throw new Error('DIVIDEND_REVIEW_STALE');
  const [principles, method, current] = await Promise.all([loadDividendSelectionPrinciples(), loadDividendPricingMethod(), previewDividendPlanChange(proposal)]);
  if (JSON.stringify(principles) !== JSON.stringify(review.snapshot.principles)
    || JSON.stringify(method) !== JSON.stringify(review.snapshot.pricingMethod) || current.fingerprint !== review.planFingerprint) throw new Error('DIVIDEND_REVIEW_CHANGED');
}
