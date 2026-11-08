import { hasCurrentUserDividendEvidence } from './dividendManualInputs.ts';
import { buildDividendHomePlan, dateInChina, quoteSymbol, type DividendStock, type GridLevel } from './dividendWorkbench.ts';
import { buildDividendFundHomePlan, type DividendFund, type DividendFundPlan } from './dividendFundPlan.ts';
import { isDividendGridProvenance, reviewDividendGrid, type DividendGridBasisCheck } from './dividendGridProvenance.ts';
import { CLASSIC_DIVIDEND_BUY_YIELDS, CLASSIC_DIVIDEND_SELL_YIELDS, DIVIDEND_PRICING_CALCULATION_VERSION, type DividendPricingMethod } from './dividendPricing.ts';
import { isKeyDataReason } from './dividendKeyData.ts';
import { dividendPricingPlan } from './dividendPricingPlan.ts';
import { dividendResearchAdvice } from './dividendResearchAdvice.ts';
import { dividendReviewSummary } from './dividendReviewSummary.ts';
import { evaluateDividendResearch, type DividendIndexResearch, type DividendResearchCheck, type DividendSelectionPrinciples, type DividendStockResearch } from './dividendResearch.ts';
import { dividendEvidenceStatus, type DividendEvidenceStatus } from './dividendEvidenceStatus.ts';
import type { DividendLedger, DividendLedgerBase } from './dividendLedger.ts';
import { dividendQuoteUsability, type DividendCheckQuote, type DividendQuoteUsability } from './dividendQuoteUsability.ts';

export type DividendTriggerState = 'triggered' | 'not_triggered' | 'unknown';
export interface DividendCheckRisk {
  id: string; reason: string; sources: string[]; reportPeriod?: string; publishedAt?: string; verifiedAt?: string;
  impact: 'new_price' | 'new_buy' | 'information'; autoRepair: boolean; unresolvedAction: 'retry' | 'review';
}
export interface DividendActionCheck {
  status: 'blocked' | 'review' | 'wait' | 'confirmation_candidate' | 'unknown'; reasons: string[]; requiresUserConfirmation: boolean;
}
type DividendNextTierState = 'pending' | 'covered' | 'unknown' | 'no_holding' | 'budget_empty' | 'below_lot';
interface DividendNextTier {
  index: number; priceMinor?: number; priceMicros?: number;
  basis?: 'cumulative_target' | 'price_reference'; targetShares?: number; sellShares?: number;
}
interface DividendCheckSummaryBase {
  id: string; code?: string; name: string;
  eligibility: { status: 'pass' | 'fail' | 'unknown'; reasons: string[]; checks: DividendResearchCheck[] };
  grid: {
    status: 'verified' | 'saved_unverified' | 'unavailable'; origin: 'saved' | 'current' | 'none';
    buyLevels: GridLevel[]; sellLevels: GridLevel[]; reasons: string[];
    buyTierIndices: number[]; sellTierIndices: number[];
    nextBuy?: DividendNextTier; nextSell?: DividendNextTier;
    nextBuyState?: DividendNextTierState; nextSellState?: DividendNextTierState;
    userConfirmedAt?: string;
    generatedAt?: number; grossDpsMicros?: number; netDpsMicros?: number; taxBps?: number; parameterVersion?: number;
    sourceUrls: string[]; selectedBatchIds: string[]; entryPriceMicros?: number; exitPriceMicros?: number;
  };
  trigger: {
    status: DividendTriggerState; buy: DividendTriggerState; sell: DividendTriggerState; buyLevels: number[]; sellLevels: number[];
    quote: DividendQuoteUsability;
    lastAvailable?: { date: string; priceMinor?: number; priceMicros?: number; buy: DividendTriggerState; sell: DividendTriggerState; buyLevels: number[]; sellLevels: number[] };
  };
  risk: { blocking: DividendCheckRisk[]; attention: DividendCheckRisk[]; evidenceInsufficient: DividendCheckRisk[] };
  actionCheck: { buy: DividendActionCheck; sell: DividendActionCheck; budgetMinor?: number; shares: number | null; additionalBuyShares?: number; sellShares?: number };
  freshness: {
    generatedAt: number; asOf: string; researchGeneratedAt?: number; quoteSourceAt?: string; quoteFetchedAt?: number;
    reportPeriod?: string; noticeDate?: string; verifiedAt?: string; evidenceVerifiedDates: string[]; sources: string[];
    evidenceStatus?: DividendEvidenceStatus['status']; semanticFingerprint: string;
  };
}
export interface DividendStockCheckSummary extends DividendCheckSummaryBase {
  kind: 'stock'; code: string; displayPlan: ReturnType<typeof buildDividendHomePlan>; gridReview: ReturnType<typeof reviewDividendGrid>;
  currentPlan: ReturnType<typeof dividendPricingPlan>;
}
export interface DividendFundCheckSummary extends DividendCheckSummaryBase {
  kind: 'fund'; fundPlan: ReturnType<typeof buildDividendFundHomePlan>;
}
export type DividendCheckSummary = DividendStockCheckSummary | DividendFundCheckSummary;
type CheckBasis = DividendGridBasisCheck & Partial<Pick<DividendLedgerBase, 'flags' | 'sourceUrls' | 'selectedBatchIds' | 'reportPeriods'>>
  & { evidenceStatus?: DividendEvidenceStatus['status']; evidenceIssues?: string[]; error?: string };
const distinct = (values: string[]) => [...new Set(values)];
const aggregate = (buy: DividendTriggerState, sell: DividendTriggerState): DividendTriggerState => buy === 'triggered' || sell === 'triggered' ? 'triggered'
  : buy === 'unknown' || sell === 'unknown' ? 'unknown' : 'not_triggered';
const action = (status: DividendActionCheck['status'], reasons: string[] = []): DividendActionCheck => ({ status, reasons: distinct(reasons), requiresUserConfirmation: status === 'confirmation_candidate' || status === 'review' });
const explicit = (levels?: GridLevel[]) => (Array.isArray(levels) ? levels : []).filter(level => level && Number.isSafeInteger(level.priceMinor) && level.priceMinor! > 0).map(level => ({ ...level }));
const priceState = (levels: GridLevel[], current: number | undefined, side: 'buy' | 'sell', indices?: number[]) => {
  const reached = current === undefined ? [] : levels.flatMap((level, index) => (side === 'buy' ? current <= level.priceMinor! : current >= level.priceMinor!) ? [indices?.[index] ?? index + 1] : []);
  return { state: current === undefined || !levels.length ? 'unknown' as const : reached.length ? 'triggered' as const : 'not_triggered' as const, reached };
};
const fingerprint = (summary: DividendCheckSummaryBase) => JSON.stringify({ eligibility: summary.eligibility, grid: summary.grid,
  trigger: { ...summary.trigger, quote: { ...summary.trigger.quote, fetchedAt: undefined } }, risk: summary.risk, actionCheck: summary.actionCheck });

/** Adapts existing engines into one immutable inspection result. Never generates a fallback yield ladder. */
export function dividendCheckSummary(input: {
  stock: DividendStock; research?: DividendStockResearch; indices?: DividendIndexResearch[]; basis?: CheckBasis; ledger?: DividendLedger;
  pricingMethod?: DividendPricingMethod; principles?: DividendSelectionPrinciples; researchGeneratedAt?: number;
  totalBudgetMinor?: number; shares?: number; asOf?: string; now?: number; quoteSession?: 'confirmed' | 'unknown'; comparisonQuote?: DividendCheckQuote;
  savedEvidenceSnapshot?: { sourceUrls: string[]; selectedBatchIds: string[]; verifiedAt?: string };
}): DividendStockCheckSummary {
  const now = input.now ?? Date.now(), asOf = input.asOf ?? dateInChina(new Date(now));
  const stock = input.stock, originalPricing = input.research?.pricing;
  const invalidPricing = !!originalPricing && ![originalPricing.annuals, originalPricing.blockers, originalPricing.warnings, originalPricing.grid].every(Array.isArray);
  const safeResearch = input.research ? { ...input.research, checks: Array.isArray(input.research.checks) ? input.research.checks : [],
    sources: Array.isArray(input.research.sources) ? input.research.sources : [], issues: Array.isArray(input.research.issues) ? input.research.issues : [],
    pricing: invalidPricing ? undefined : originalPricing } : undefined;
  const research = safeResearch && input.principles ? evaluateDividendResearch(safeResearch, input.principles, now) : safeResearch;
  const pricing = research?.pricing, basis = input.basis ?? pricing?.dividendBase;
  const userConfirmed = hasCurrentUserDividendEvidence(pricing, asOf, input.ledger);
  const ledger = userConfirmed ? undefined : input.ledger ?? pricing?.ledger;
  const cachedEvidence = pricing?.ledger ? dividendEvidenceStatus(pricing.ledger, asOf) : undefined;
  const cachedFailureIsCurrent = cachedEvidence && !cachedEvidence.usable && pricing?.ledger?.asOf === asOf;
  const cashFetchFailed = research?.issues.some(issue => issue.kind === 'dividend' && ['request_failed', 'invalid_data', 'deferred'].includes(issue.reason));
  const evidence = userConfirmed ? { status: 'current' as const, usable: true, reasons: ['USER_CONFIRMED_INPUT'] } : cashFetchFailed ? { status: 'failed' as const, usable: false, reasons: ['DIVIDEND_SOURCE_REFRESH_FAILED'] }
    : cachedFailureIsCurrent ? cachedEvidence : input.basis?.evidenceStatus && input.basis.evidenceStatus !== 'current'
    ? { status: input.basis.evidenceStatus, usable: false, reasons: input.basis.evidenceIssues ?? [] }
    : ledger ? dividendEvidenceStatus(ledger, asOf) : input.basis?.evidenceStatus
      ? { status: input.basis.evidenceStatus, usable: input.basis.evidenceStatus === 'current', reasons: input.basis.evidenceIssues ?? [] } : undefined;
  const taxBps = input.pricingMethod ? { over_year: 0, month_to_year: 1000, up_to_month: 2000 }[input.pricingMethod.holdingPeriod] : pricing?.taxBps;
  const origin = isDividendGridProvenance(stock.gridProvenance) ? stock.gridProvenance : undefined;
  const gridReview = reviewDividendGrid({ ...stock, buyLevels: Array.isArray(stock.buyLevels) ? stock.buyLevels : [], sellLevels: Array.isArray(stock.sellLevels) ? stock.sellLevels : [],
    quote: stock.quote && typeof stock.quote.date === 'string' ? stock.quote : undefined }, basis, { asOf, taxBps, parameterVersion: DIVIDEND_PRICING_CALCULATION_VERSION, basisKind: 'recent_batches',
      buyYieldBps: input.pricingMethod?.buyYieldBps ?? pricing?.buyYieldBps ?? CLASSIC_DIVIDEND_BUY_YIELDS,
      sellYieldBps: input.pricingMethod?.sellYieldBps ?? pricing?.sellYieldBps ?? CLASSIC_DIVIDEND_SELL_YIELDS });
  const savedBuy = explicit(stock.buyLevels), savedSell = explicit(stock.sellLevels), hasSaved = savedBuy.length > 0 || savedSell.length > 0;
  const basisMatches = !input.basis || !pricing?.dividendBase || input.basis.dpsMicros === pricing.dividendBase.dpsMicros
    && input.basis.asOf === pricing.dividendBase.asOf && input.basis.verified === pricing.dividendBase.verified
    && (!input.basis.selectedBatchIds || JSON.stringify(input.basis.selectedBatchIds) === JSON.stringify(pricing.dividendBase.selectedBatchIds));
  const currentPlan = pricing && pricing.dividendBase?.asOf === asOf && basisMatches && (!evidence || evidence.usable)
    && (taxBps === undefined || pricing.taxBps === taxBps) ? dividendPricingPlan(pricing) : null;
  const buyLevels = hasSaved ? savedBuy : currentPlan?.buyLevels.map(level => ({ ...level })) ?? [];
  const sellLevels = hasSaved ? savedSell : currentPlan?.sellLevels.map(level => ({ ...level })) ?? [];
  const tierIndices = (levels: GridLevel[] | undefined) => (levels ?? []).flatMap((level, index) => Number.isSafeInteger(level.priceMinor) && level.priceMinor! > 0 ? [index + 1] : []);
  const buyTierIndices = hasSaved ? tierIndices(stock.buyLevels) : buyLevels.map((_, i) => i + 1);
  const sellTierIndices = hasSaved ? tierIndices(stock.sellLevels) : sellLevels.map((_, i) => i + 1);
  const partialBuy = hasSaved && (stock.buyLevels?.length ?? 0) !== savedBuy.length;
  const partialSell = hasSaved && (stock.sellLevels?.length ?? 0) !== savedSell.length;
  const gridStatus = hasSaved ? gridReview.basisState === 'verified' && gridReview.hasCompleteSavedGrid && (!evidence || evidence.usable) ? 'verified' : 'saved_unverified'
    : currentPlan ? 'verified' : 'unavailable';
  const gridReasons = distinct([...(hasSaved && !gridReview.hasCompleteSavedGrid ? ['grid_partial'] : []),
    ...(hasSaved && gridReview.provenanceMissing ? ['grid_provenance_missing'] : []), ...gridReview.staleReasons, ...(!basisMatches ? ['pricing_basis_changed'] : []),
    ...(evidence && !evidence.usable ? evidence.reasons.length ? evidence.reasons : [`evidence_${evidence.status}`] : []),
    ...(!hasSaved && !currentPlan ? pricing?.blockers.length ? pricing.blockers : ['grid_unavailable'] : [])]);
  const researchQuote: DividendCheckQuote | undefined = pricing?.currentPriceMinor !== undefined && pricing.priceDate ? { priceMinor: pricing.currentPriceMinor, date: pricing.priceDate } : undefined;
  // A failed primary quote may not be revived through a secondary research feed.
  const selectedQuote = stock.quote ?? researchQuote;
  const comparisonQuote = input.comparisonQuote ?? (stock.quote ? researchQuote : undefined);
  const researchQuoteFailed = !stock.quote && [...pricing?.pauseReasons ?? [], ...pricing?.warnings ?? []].includes('quote_missing');
  const quote = dividendQuoteUsability({ quote: selectedQuote, comparisonQuote, failedAt: stock.quoteFailedAt ?? (researchQuoteFailed ? now : undefined),
    latestExDate: basis?.latestExDate, asOf, now, quoteSession: input.quoteSession });
  const sanitizedStock: DividendStock = { ...stock, buyLevels, sellLevels, manualDpsMicros: undefined,
    quote: selectedQuote?.priceMinor !== undefined ? { priceMinor: selectedQuote.priceMinor, date: selectedQuote.date, fetchedAt: selectedQuote.fetchedAt ?? 0 } : undefined };
  const shares = input.shares ?? (stock.shareMode === 'manual' ? stock.manualShares : 0);
  const rawDisplayPlan = buildDividendHomePlan(sanitizedStock, input.totalBudgetMinor, shares, asOf);
  const historicalBuy = priceState(buyLevels, quote.historicalUsable ? quote.priceMinor : undefined, 'buy', buyTierIndices);
  const historicalSell = priceState(sellLevels, quote.historicalUsable ? quote.priceMinor : undefined, 'sell', sellTierIndices);
  const buy = quote.status === 'current' && !(partialBuy && historicalBuy.state === 'not_triggered') ? historicalBuy.state : 'unknown';
  const sell = quote.status === 'current' && !(partialSell && historicalSell.state === 'not_triggered') ? historicalSell.state : 'unknown';
  const savedCumulative = (side: 'buy' | 'sell', index: number, fallback: number) => hasSaved
    ? (stock[side === 'buy' ? 'buyLevels' : 'sellLevels'] ?? []).slice(0, (side === 'buy' ? buyTierIndices : sellTierIndices)[index])
      .reduce((sum, level) => sum + level.portionBps, 0) : fallback;
  const displayPlan: ReturnType<typeof buildDividendHomePlan> = { ...rawDisplayPlan,
    quoteUsable: quote.status === 'current',
    buy: rawDisplayPlan.buy.map((row, index) => ({ ...row, cumulative: savedCumulative('buy', index, row.cumulative), targetShares: partialBuy ? undefined : row.targetShares, priceTouched: quote.status === 'current' && row.priceTouched, touched: quote.status === 'current' && row.touched })),
    sell: rawDisplayPlan.sell.map((row, index) => ({ ...row, cumulative: savedCumulative('sell', index, row.cumulative), sellShares: partialSell ? undefined : row.sellShares, priceTouched: quote.status === 'current' && row.priceTouched, touched: quote.status === 'current' && row.touched })),
    buyState: stock.buyPaused ? 'paused' : partialBuy ? 'price_missing' : quote.status !== 'current' ? 'quote_missing' : rawDisplayPlan.buyState,
    sellState: shares <= 0 ? 'no_holding' : partialSell ? 'price_missing' : quote.status !== 'current' ? 'quote_missing' : rawDisplayPlan.sellState,
    additionalBuyShares: quote.status === 'current' && !partialBuy ? rawDisplayPlan.additionalBuyShares : 0,
    sellShares: quote.status === 'current' && !partialSell ? rawDisplayPlan.sellShares : 0,
    buyTriggeredLevel: quote.status === 'current' ? historicalBuy.reached.at(-1) ?? 0 : 0,
    sellTriggeredLevel: quote.status === 'current' ? historicalSell.reached.at(-1) ?? 0 : 0 };
  // These are outstanding cumulative targets, not a trade history or a second
  // allocation engine. Missing quantities permit only an indexed price reference.
  // See docs/dividend-stage1/next-tier-definition.md for the exact semantics.
  const priceReference = (levels: GridLevel[], indices: number[]): DividendNextTier | undefined => levels[0]?.priceMinor === undefined ? undefined
    : { index: indices[0], priceMinor: levels[0].priceMinor, basis: 'price_reference' };
  const nextBuyRow = displayPlan.buy.findIndex(row => row.targetShares !== undefined && row.targetShares > shares);
  const nextSellRow = displayPlan.sell.findIndex(row => row.sellShares !== undefined && row.sellShares > 0);
  const buyTargetUnknown = partialBuy || !buyLevels.length || displayPlan.budgetMinor === undefined;
  const sellTargetUnknown = partialSell || !sellLevels.length;
  const nextBuyState: DividendNextTierState = displayPlan.budgetMinor !== undefined && displayPlan.budgetMinor <= 0 ? 'budget_empty'
    : buyTargetUnknown ? 'unknown' : nextBuyRow < 0 ? shares <= 0 && displayPlan.buy.every(row => row.targetShares === 0) ? 'below_lot' : 'covered'
    : displayPlan.buy[nextBuyRow].targetShares! - shares < stock.lotSize ? 'below_lot' : 'pending';
  const nextSellState: DividendNextTierState = shares <= 0 ? 'no_holding' : sellTargetUnknown ? 'unknown' : nextSellRow < 0 ? 'below_lot' : 'pending';
  const nextBuy: DividendNextTier | undefined = nextBuyState === 'unknown' ? priceReference(buyLevels, buyTierIndices)
    : nextBuyRow < 0 || nextBuyState === 'budget_empty' ? undefined : { index: buyTierIndices[nextBuyRow], priceMinor: displayPlan.buy[nextBuyRow].priceMinor,
      basis: 'cumulative_target', targetShares: displayPlan.buy[nextBuyRow].targetShares };
  const nextSell: DividendNextTier | undefined = nextSellState === 'unknown' ? priceReference(sellLevels, sellTierIndices)
    : nextSellRow < 0 || shares <= 0 ? undefined : { index: sellTierIndices[nextSellRow], priceMinor: displayPlan.sell[nextSellRow].priceMinor,
      basis: 'cumulative_target', sellShares: displayPlan.sell[nextSellRow].sellShares };
  const sources = distinct([...(basis?.sourceUrls ?? []), ...(research?.sources.map(source => source.url) ?? [])]);
  const selectedIds = basis?.selectedBatchIds ?? [];
  const ledgerEvents = Array.isArray(ledger?.events) ? ledger.events.filter(event => event && typeof event === 'object') : [];
  const selectedEvents = ledgerEvents.filter(event => selectedIds.includes(event.batchId));
  const evidenceVerifiedDates = distinct(selectedEvents.flatMap(event => Array.isArray(event.sources) ? event.sources.flatMap(source => typeof source?.verifiedAt === 'string' ? [source.verifiedAt] : []) : [])).sort();
  const risk: DividendCheckSummaryBase['risk'] = { blocking: [], attention: [], evidenceInsufficient: [] };
  const informational = new Set(['stock_trend', 'market_trend', 'yield_history', 'treasury_missing', 'treasury_stale',
    'opportunity_cost_missing', 'opportunity_cost_stale', 'yield_history_missing', 'capital_actions_unverified', 'roe_bps_missing']);
  const add = (group: keyof typeof risk, reason: string, impact: DividendCheckRisk['impact'] = 'new_buy', period?: string) => {
    if (risk[group].some(item => item.reason === reason)) return;
    const lower = reason.toLowerCase(), financial = reason.startsWith('rule_') && !['rule_yield', 'rule_dividendYears'].includes(reason)
      || /financial|earnings|roe|fcf|payout|cashflow/.test(lower);
    const quoteIssue = lower.startsWith('quote_');
    const cashEvidence = !financial && !quoteIssue && /dividend|ledger|announcement|source_|capital|crosscheck|base_changed|ex_dividend/.test(lower);
    const itemSources = financial ? research?.sources.filter(source => source.kind === 'financial').map(source => source.url) ?? []
      : quoteIssue ? stock.quote ? [`https://qt.gtimg.cn/q=${quoteSymbol(stock.code)}`] : research?.sources.filter(source => source.kind === 'technical').map(source => source.url) ?? []
        : cashEvidence ? basis?.sourceUrls ?? [] : sources;
    const financialPeriod = research?.financial?.periods?.find(row => row.reportDate === period);
    const repairable = /missing|failed|stale|unverified|incomplete|cninfo|partial/.test(lower);
    risk[group].push({ id: reason, reason, sources: distinct(itemSources), reportPeriod: period,
      publishedAt: financialPeriod?.noticeDate,
      // Cash-announcement verification does not verify a financial report or an
      // earnings cross-check. Missing dates remain absent rather than relabelled.
      verifiedAt: cashEvidence && !lower.includes('crosscheck') ? evidenceVerifiedDates.at(-1) : undefined,
      impact: informational.has(reason) || group === 'attention' || group === 'evidenceInsufficient' && !isKeyDataReason(reason) ? 'information' : impact,
      autoRepair: group === 'evidenceInsufficient' && repairable, unresolvedAction: repairable ? 'retry' : 'review' });
  };
  const checks = research?.checks.map(check => ({ ...check })) ?? [];
  const failed = checks.filter(check => check.status === 'risk'), missing = checks.filter(check => check.status === 'unknown');
  for (const check of failed) add('attention', `rule_${check.rule}`, 'new_buy', check.period);
  for (const check of missing) add('evidenceInsufficient', `rule_${check.rule}`, 'new_buy', check.period);
  if (!checks.length) add('evidenceInsufficient', 'research_missing');
  if (invalidPricing) add('evidenceInsufficient', 'pricing_invalid');
  if (input.principles?.notes?.trim()) add('evidenceInsufficient', 'additional_rules_unverified');
  const researchTimeValid = Number.isSafeInteger(input.researchGeneratedAt) && input.researchGeneratedAt! > 0 && input.researchGeneratedAt! <= now;
  const researchCurrent = researchTimeValid && dateInChina(new Date(input.researchGeneratedAt!)) === asOf;
  if (!researchCurrent) add('evidenceInsufficient', researchTimeValid ? 'research_not_current' : 'research_time_missing');
  const basisUnavailable = !!basis && !basis.verified || !!evidence && !evidence.usable;
  const eligibility: DividendCheckSummaryBase['eligibility'] = {
    status: failed.length ? 'fail' : !checks.length || missing.length || !researchCurrent || basisUnavailable || input.principles?.notes?.trim() ? 'unknown' : 'pass',
    reasons: [...failed, ...missing].slice(0, 3).map(check => `rule_${check.rule}`), checks,
  };
  if (!eligibility.reasons.length && eligibility.status === 'unknown') eligibility.reasons = [!checks.length ? 'research_missing' : !researchCurrent ? researchTimeValid ? 'research_not_current' : 'research_time_missing' : basisUnavailable ? 'grid_not_verified' : 'additional_rules_unverified'];
  if (research) {
    const advice = dividendResearchAdvice(research, input.indices ?? [], input.principles?.notes, sanitizedStock, asOf);
    const grouped = dividendReviewSummary(research, advice);
    for (const item of grouped.risks) if (!item.rules.length) add('attention', item.topic);
    for (const item of grouped.missing) if (!item.rules.length) add('evidenceInsufficient', item.topic);
    for (const reason of advice.pricingMissingReasons) add('evidenceInsufficient', reason);
  }
  for (const blocker of pricing?.blockers ?? []) add(['dividend_source_conflict', 'dividend_crosscheck_mismatch'].includes(blocker) ? 'blocking' : 'evidenceInsufficient', blocker, 'new_price');
  for (const reason of gridReasons) add(reason === 'dividend_source_conflict' ? 'blocking' : 'evidenceInsufficient', reason);
  for (const reason of quote.reasons) add(reason === 'quote_source_conflict' ? 'blocking' : 'evidenceInsufficient', reason);
  if (basis?.flags?.includes('CROSSCHECK_MISSING')) add('evidenceInsufficient', 'crosscheck_missing');
  const comparisonBatchIds = new Set([...selectedIds, ...input.savedEvidenceSnapshot?.selectedBatchIds ?? []]);
  const earliestSelectedExDate = selectedEvents.flatMap(event => event.exDate ? [event.exDate] : []).sort()[0];
  const relevantSpecialEvents = ledgerEvents.filter(event => {
    if (event.period !== 'special' || event.announcementDate && event.announcementDate > asOf) return false;
    // Selected unverified/conflicting cash is still a current unresolved item.
    if (comparisonBatchIds.has(event.batchId)) return true;
    if (!event.implemented || !event.exDate || event.exDate > asOf) return false;
    const normalizesSelectedCash = !!earliestSelectedExDate && event.exDate >= earliestSelectedExDate
      && (event.shareFactor !== 1 || event.verification === 'conflict');
    const affectsCurrentComparison = event.exDate === basis?.latestExDate
      && (gridReview.staleReasons.includes('ex_dividend_since_generation') || quote.reasons.includes('quote_before_ex'));
    return normalizesSelectedCash || affectsCurrentComparison;
  });
  for (const event of relevantSpecialEvents) {
    // This limitation belongs to this special event. A regular selected cash
    // batch must not supply its sources or turn an unverified special event into
    // a newly verified one merely because both affect the same comparison.
    const eventSources = Array.isArray(event.sources) ? event.sources : [];
    const eventVerifiedDates = event.verification === 'verified'
      ? eventSources.flatMap(source => typeof source?.verifiedAt === 'string' ? [source.verifiedAt] : []).sort() : [];
    risk.evidenceInsufficient.push({ id: `special_dividend_review:${event.id}`, reason: 'special_dividend_review',
      sources: distinct(eventSources.flatMap(source => typeof source?.url === 'string' ? [source.url] : [])),
      reportPeriod: event.reportDate, publishedAt: event.announcementDate, verifiedAt: eventVerifiedDates.at(-1),
      impact: 'information', autoRepair: false, unresolvedAction: 'review' });
  }
  if (hasSaved && (!input.savedEvidenceSnapshot?.sourceUrls.length || !input.savedEvidenceSnapshot.selectedBatchIds.length)) add('evidenceInsufficient', 'saved_evidence_snapshot_missing');
  const buyConstraints = distinct([...gridReasons, ...(gridStatus !== 'verified' ? ['grid_not_verified'] : []),
    ...risk.blocking.map(item => item.reason), ...risk.evidenceInsufficient.filter(item => item.impact !== 'information' && !item.reason.startsWith('quote_')).map(item => item.reason),
    ...(!quote.sessionConfirmed ? ['execution_session_unverified'] : []),
    ...(!hasSaved && currentPlan ? ['current_grid_not_saved'] : [])]);
  const buyAction = stock.buyPaused ? action('blocked', ['manual_pause']) : gridStatus === 'unavailable' || quote.status !== 'current' ? action('unknown', [...gridReasons, ...quote.reasons])
    : buy === 'not_triggered' ? action('wait')
    : input.totalBudgetMinor === undefined ? action('review', ['budget_missing', ...buyConstraints])
    : displayPlan.budgetMinor! <= 0 ? action('blocked', ['budget_empty'])
    : buyConstraints.length ? action('review', buyConstraints)
    : displayPlan.additionalBuyShares <= 0 ? action('wait', [displayPlan.buyState]) : action('confirmation_candidate', ['cash_fees_liquidity_unverified']);
  const sellAction = shares <= 0 ? action('blocked', ['no_holding']) : !sellLevels.length || quote.status !== 'current' ? action('unknown', [...quote.reasons, ...(!sellLevels.length ? ['sell_price_missing'] : [])])
    : sell === 'not_triggered' ? action('wait') : !quote.sessionConfirmed || gridStatus !== 'verified' || !hasSaved
      ? action('review', [...(!quote.sessionConfirmed ? ['execution_session_unverified'] : []), ...(gridStatus !== 'verified' ? ['grid_not_verified'] : []), ...(!hasSaved ? ['current_grid_not_saved'] : [])])
      : displayPlan.sellShares <= 0 ? action('wait', ['below_lot']) : action('confirmation_candidate', ['fees_liquidity_unverified']);
  const summary: DividendStockCheckSummary = {
    kind: 'stock', id: stock.code, code: stock.code, name: stock.name, eligibility,
    grid: { status: gridStatus, origin: hasSaved ? 'saved' : currentPlan ? 'current' : 'none', buyLevels, sellLevels, buyTierIndices, sellTierIndices, reasons: gridReasons,
      nextBuy, nextSell, nextBuyState, nextSellState,
      userConfirmedAt: hasSaved ? origin?.userConfirmedAt : userConfirmed ? pricing?.userConfirmedEvidence?.confirmedAt : undefined,
      generatedAt: hasSaved ? origin?.generatedAt : input.researchGeneratedAt, grossDpsMicros: hasSaved ? origin?.grossDpsMicros : basis?.dpsMicros,
      netDpsMicros: hasSaved && origin ? Number(BigInt(origin.grossDpsMicros) * BigInt(10000 - origin.taxBps) / 10000n) : pricing?.d1Micros,
      taxBps: hasSaved ? origin?.taxBps : pricing?.taxBps, parameterVersion: hasSaved ? origin?.parameterVersion : pricing?.calculationVersion,
      sourceUrls: [...sources], selectedBatchIds: [...selectedIds] },
    trigger: { status: aggregate(buy, sell), buy, sell, buyLevels: quote.status === 'current' ? historicalBuy.reached : [], sellLevels: quote.status === 'current' ? historicalSell.reached : [], quote,
      lastAvailable: quote.historicalUsable && quote.date ? { date: quote.date, priceMinor: quote.priceMinor, buy: historicalBuy.state, sell: historicalSell.state, buyLevels: historicalBuy.reached, sellLevels: historicalSell.reached } : undefined },
    risk, actionCheck: { buy: buyAction, sell: sellAction, budgetMinor: displayPlan.budgetMinor, shares, additionalBuyShares: displayPlan.additionalBuyShares, sellShares: displayPlan.sellShares },
    freshness: { generatedAt: now, asOf, researchGeneratedAt: input.researchGeneratedAt, quoteSourceAt: quote.date, quoteFetchedAt: quote.fetchedAt,
      reportPeriod: research?.financial?.latest?.reportDate, noticeDate: research?.financial?.latest?.noticeDate,
      verifiedAt: evidenceVerifiedDates.at(-1), evidenceVerifiedDates, sources: [...sources], evidenceStatus: evidence?.status, semanticFingerprint: '' },
    displayPlan, gridReview, currentPlan,
  };
  summary.freshness.semanticFingerprint = fingerprint(summary);
  return summary;
}

/** Fund conditions are a pure price-trigger grid against the saved entry/exit prices. */
export function dividendFundCheckSummary(input: { plan: DividendFundPlan; fund: DividendFund; shares?: number; asOf?: string; now?: number; quoteSession?: 'confirmed' | 'unknown' }): DividendFundCheckSummary {
  const now = input.now ?? Date.now(), asOf = input.asOf ?? dateInChina(new Date(now)), { plan, fund } = input;
  const quote = dividendQuoteUsability({ quote: fund.quote, failedAt: fund.quoteFailedAt, asOf, now, quoteSession: input.quoteSession });
  const referencePlan = buildDividendFundHomePlan(plan, fund, asOf, now);
  const shares = typeof input.shares === 'number' && Number.isFinite(input.shares) && input.shares >= 0 ? input.shares : null;
  // Keep the price-trigger engine on the current observation only; the saved
  // fund and target formulas stay intact. A missing quote stays unknown.
  const currentPlan = buildDividendFundHomePlan(plan, { ...fund,
    quote: quote.status === 'current' ? fund.quote : undefined,
    reference: fund.reference ? { ...fund.reference, priceMicros: undefined } : undefined,
  }, asOf, now);
  const fundPlan = { ...currentPlan, priceMicros: referencePlan.priceMicros };
  const buy: DividendTriggerState = quote.status !== 'current' ? 'unknown' : fundPlan.entry.status === 'met' ? 'triggered'
    : fundPlan.entry.status === 'wait' ? 'not_triggered' : 'unknown';
  const sell: DividendTriggerState = plan.mode !== 'swing' ? 'not_triggered' : quote.status !== 'current' ? 'unknown'
    : fundPlan.exitState === 'triggered' ? 'triggered' : fundPlan.exitState === 'waiting' ? 'not_triggered' : 'unknown';
  // Only genuine price-grid data gaps are reported; no verification stack.
  const reasons = distinct([
    ...(quote.status !== 'current' ? quote.reasons : []),
    ...fundPlan.entry.issues.filter(issue => issue === 'price_missing' || issue === 'high_missing'),
  ]);
  const sources = fund.reference?.source ? [fund.reference.source] : [];
  const risks = reasons.map(reason => ({ id: reason, reason, sources: [...sources], reportPeriod: fund.reference?.asOf, impact: 'new_buy' as const,
    autoRepair: reason === 'quote_missing' || reason === 'quote_refresh_failed', unresolvedAction: reason.startsWith('quote_') ? 'retry' as const : 'review' as const }));
  const budgetMinor = fundPlan.targetAmountMinor;
  const buyAction = budgetMinor !== undefined && budgetMinor <= 0 ? action('blocked', ['budget_empty']) : shares === null ? action('unknown', ['holding_unknown']) : fundPlan.entry.status === 'wait' ? action('wait')
    : buy === 'unknown' ? action('unknown', reasons) : budgetMinor === undefined ? action('review', ['budget_missing'])
    : !quote.sessionConfirmed ? action('review', ['execution_session_unverified']) : action('confirmation_candidate', ['cash_fees_liquidity_unverified']);
  const sellAction = shares === null ? action('unknown', ['holding_unknown']) : shares <= 0 ? action('blocked', ['no_holding']) : plan.mode !== 'swing' ? action('wait', [`fund_mode_${plan.mode}`])
    : sell === 'unknown' ? action('unknown', reasons) : sell === 'not_triggered' ? action('wait')
    : !quote.sessionConfirmed ? action('review', ['execution_session_unverified']) : action('confirmation_candidate', ['fees_liquidity_unverified']);
  const summary: DividendFundCheckSummary = { kind: 'fund', id: fund.id, code: fund.code, name: fund.name,
    eligibility: { status: fundPlan.entry.status === 'met' ? 'pass' : fundPlan.entry.status === 'wait' ? 'fail' : 'unknown', reasons: fundPlan.entry.issues.slice(0, 3), checks: [] },
    grid: { status: fundPlan.entry.targetPriceMicros === undefined && fundPlan.exitPriceMicros === undefined ? 'unavailable' : 'verified', origin: 'saved',
      buyLevels: [], sellLevels: [], buyTierIndices: [], sellTierIndices: [], reasons: [], sourceUrls: [...sources], selectedBatchIds: [],
      entryPriceMicros: fundPlan.entry.targetPriceMicros, exitPriceMicros: fundPlan.exitPriceMicros,
      nextBuy: fundPlan.entry.targetPriceMicros === undefined ? undefined : { index: 1, priceMicros: fundPlan.entry.targetPriceMicros },
      nextSell: fundPlan.exitPriceMicros === undefined ? undefined : { index: 1, priceMicros: fundPlan.exitPriceMicros } },
    trigger: { status: aggregate(buy, sell), buy, sell, buyLevels: [], sellLevels: [], quote },
    risk: { blocking: [], attention: [], evidenceInsufficient: risks }, actionCheck: { buy: buyAction, sell: sellAction, budgetMinor, shares },
    freshness: { generatedAt: now, asOf, quoteSourceAt: quote.date, quoteFetchedAt: quote.fetchedAt, reportPeriod: fund.reference?.asOf,
      evidenceVerifiedDates: [], sources: [...sources], semanticFingerprint: '' }, fundPlan };
  summary.freshness.semanticFingerprint = fingerprint(summary);
  return summary;
}
