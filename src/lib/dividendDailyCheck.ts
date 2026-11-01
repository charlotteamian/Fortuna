import type { DividendCheckSummary } from './dividendCheckSummary.ts';
import { dateInChina } from './dividendWorkbench.ts';

export type DividendDailyStage = 'quotes' | 'evidence' | 'plans' | 'result';
export type DividendDailySourceState = 'pending' | 'success' | 'failed' | 'deferred';
export interface DividendDailySource {
  id: string; itemKey: string; stage: DividendDailyStage; provider: string; url?: string;
  status: DividendDailySourceState; attemptedAt?: number; sourceDate?: string; verifiedDates?: string[]; detail?: string;
}
export interface DividendDailyItem {
  key: string; kind: 'stock' | 'fund'; id: string; code?: string; name: string;
  bucket: 'review' | 'wait' | 'unknown';
  quote: DividendCheckSummary['trigger']['quote'];
  trigger: DividendCheckSummary['trigger']['status'];
  nextBuy?: DividendCheckSummary['grid']['nextBuy']; nextSell?: DividendCheckSummary['grid']['nextSell'];
  nextBuyState?: string; nextSellState?: string;
  actions: Pick<DividendCheckSummary['actionCheck'], 'buy' | 'sell'>;
  eligibility: DividendCheckSummary['eligibility']; reasons: string[]; fingerprint: string;
  dates: Pick<DividendCheckSummary['freshness'], 'reportPeriod' | 'noticeDate' | 'researchGeneratedAt' | 'evidenceVerifiedDates' | 'sources'>;
  checkedAt?: number; stale?: boolean;
}
export interface DividendDailyCheck {
  version: 1; batchId: string; revision: number; startedAt: number; deadlineAt: number; finishedAt?: number;
  status: 'running' | 'completed' | 'partial' | 'cancelled' | 'timed_out' | 'changed';
  stage: DividendDailyStage; inputKey: string; planKey: string; items: DividendDailyItem[];
  sources: DividendDailySource[]; checkedKeys: string[]; errors: string[];
  retryOf?: string; retryKeys?: string[];
}
export const dividendDailyItemKey = (summary: Pick<DividendCheckSummary, 'kind' | 'id'>) => `${summary.kind}:${summary.id}`;

export function dividendDailySemanticFingerprint(summary: DividendCheckSummary): string {
  const state = JSON.parse(summary.freshness.semanticFingerprint);
  // Rebuilding an identical unsaved calculation in another download batch is
  // not a plan change. Saved provenance remains bound by the user-input guard.
  if (state.grid?.origin === 'current') delete state.grid.generatedAt;
  return JSON.stringify(state);
}

/** A reading projection of stage 1's result, never a new risk/price engine.
 * A failed stock principle is a review, while a fund's unmet entry condition
 * remains waiting. Missing evidence is never scored as a major known risk. */
export function dividendDailyItem(summary: DividendCheckSummary, checkedAt?: number): DividendDailyItem {
  const actions = summary.actionCheck;
  const review = actions.buy.reasons.includes('manual_pause') || summary.kind === 'stock' && summary.eligibility.status === 'fail'
    || summary.risk.blocking.length > 0 || [actions.buy.status, actions.sell.status].some(value => ['review', 'confirmation_candidate'].includes(value));
  const unknown = actions.shares === null || summary.trigger.status === 'unknown'
    || actions.buy.status === 'unknown' || actions.sell.status === 'unknown'
    || summary.kind === 'stock' && (summary.eligibility.status === 'unknown' || summary.grid.status !== 'verified');
  const reasons = [...new Set([
    ...actions.buy.reasons.filter(reason => reason === 'manual_pause'), ...summary.risk.blocking.map(item => item.reason),
    ...summary.eligibility.reasons, ...summary.trigger.quote.reasons,
    ...summary.risk.evidenceInsufficient.map(item => item.reason), ...actions.buy.reasons, ...actions.sell.reasons,
  ])].slice(0, 3);
  return { key: dividendDailyItemKey(summary), kind: summary.kind, id: summary.id, code: summary.code, name: summary.name,
    bucket: review ? 'review' : unknown ? 'unknown' : 'wait', quote: structuredClone(summary.trigger.quote), trigger: summary.trigger.status,
    nextBuy: summary.grid.nextBuy && { ...summary.grid.nextBuy }, nextSell: summary.grid.nextSell && { ...summary.grid.nextSell },
    nextBuyState: summary.grid.nextBuyState, nextSellState: summary.grid.nextSellState,
    actions: { buy: structuredClone(actions.buy), sell: structuredClone(actions.sell) }, eligibility: structuredClone(summary.eligibility),
    reasons, fingerprint: dividendDailySemanticFingerprint(summary),
    dates: { reportPeriod: summary.freshness.reportPeriod, noticeDate: summary.freshness.noticeDate,
      researchGeneratedAt: summary.freshness.researchGeneratedAt, evidenceVerifiedDates: [...summary.freshness.evidenceVerifiedDates], sources: [...summary.freshness.sources] }, checkedAt };
}

export function sortDividendDailyItems(items: DividendDailyItem[]) {
  const order = { review: 0, unknown: 1, wait: 2 };
  return [...new Map(items.map(item => [item.key, item])).values()].sort((a, b) => order[a.bucket] - order[b.bucket]
    || Number(b.trigger === 'triggered') - Number(a.trigger === 'triggered') || a.key.localeCompare(b.key));
}

export function dividendDailyCoverage(sources: DividendDailySource[], stage?: DividendDailyStage) {
  // A research placeholder is replaced by individual source outcomes. It is
  // not an additional successful download on top of those same sources.
  const rows = sources.filter(source => (!stage || source.stage === stage) && (!source.id.endsWith(':research') || source.status === 'pending'));
  return { total: rows.length, success: rows.filter(source => source.status === 'success').length,
    failed: rows.filter(source => source.status === 'failed').length, deferred: rows.filter(source => source.status === 'deferred').length,
    pending: rows.filter(source => source.status === 'pending').length };
}

export function dividendDailyCheckIsStale(check: DividendDailyCheck, planKey: string, now = Date.now()) {
  return dateInChina(new Date(check.startedAt)) !== dateInChina(new Date(now)) || check.planKey !== planKey || check.items.some(item => item.stale);
}
