import { db } from '../db';
import { dividendCheckReasonCode } from '../lib/dividendCheckLabels';
import type { DividendStockCheckSummary } from '../lib/dividendCheckSummary';
import { isKeyDataReason } from '../lib/dividendKeyData';
import { defaultDividendPricingMethod, type DividendPricingMethod } from '../lib/dividendPricing';
import { dividendPricingPlan, dividendPricingPlanChange, dividendPricingProvenance } from '../lib/dividendPricingPlan';
import { defaultDividendSelectionPrinciples, type DividendResearchSnapshot, type DividendSelectionPrinciples, type DividendStockResearch } from '../lib/dividendResearch';
import { dateInChina, type DividendStock } from '../lib/dividendWorkbench';
import { loadDividendCheckSummaries } from './dividendCheckSummaryService';
import { loadDividendGridBases, type DividendGridBasisResult } from './dividendGridBasisService';
import { refreshDividendMarketQuotes } from './dividendQuoteService';
import { dividendBackgroundRefreshPaused } from './dividendRequestControl';
import {
  dividendPricingSnapshotForStock,
  dividendResearchSnapshotForStock,
  loadDividendResearchCache,
  saveDividendResearchCache,
  type SavedDividendResearch,
} from './dividendResearchCacheService';
import { fetchDividendResearch } from './dividendResearchService';
import { loadDividendWorkbenchReadOnly, refreshDividendStock } from './dividendService';

export type DividendAutoReviewReason =
  | 'quote_stale'
  | 'dividend_stale'
  | 'ledger_unverified'
  | 'research_missing'
  | 'research_stale'
  | 'pricing_method_changed'
  | 'research_issues'
  | 'grid_unverified'
  | 'checks_incomplete';

export interface DividendAutoReviewProgress {
  phase: 'detecting' | 'quotes' | 'dividends' | 'research' | 'finalizing';
  done: number;
  total: number;
  currentCode?: string;
}

export interface DividendAutoReviewStockIssue {
  code: string;
  name: string;
  kind: 'refresh_failed' | 'needs_attention';
  reasons: string[];
}

export interface DividendAutoReviewResult {
  status: 'up_to_date' | 'completed' | 'partial' | 'skipped' | 'aborted';
  asOf: string;
  checkedCodes: string[];
  refreshedCodes: string[];
  resolvedCodes: string[];
  failed: DividendAutoReviewStockIssue[];
  attention: DividendAutoReviewStockIssue[];
  savedResearch: SavedDividendResearch | null;
  summaries: Record<string, DividendStockCheckSummary>;
}

export interface DividendStockReviewNeed {
  code: string;
  name: string;
  needsQuote: boolean;
  needsDividend: boolean;
  needsResearch: boolean;
  reasons: DividendAutoReviewReason[];
}

export interface DividendAutoReviewDeps {
  loadWorkbench: typeof loadDividendWorkbenchReadOnly;
  loadSettings: () => Promise<{
    dividendPricingMethod?: DividendPricingMethod;
    dividendSelectionPrinciples?: DividendSelectionPrinciples;
  } | undefined>;
  loadResearchCache: typeof loadDividendResearchCache;
  saveResearchCache: typeof saveDividendResearchCache;
  loadGridBases: typeof loadDividendGridBases;
  loadCheckSummaries: typeof loadDividendCheckSummaries;
  refreshQuotes: typeof refreshDividendMarketQuotes;
  refreshStock: typeof refreshDividendStock;
  fetchResearch: typeof fetchDividendResearch;
  syncIdenticalGridProvenance: (
    code: string,
    plan: NonNullable<ReturnType<typeof dividendPricingPlan>>,
    provenance: NonNullable<ReturnType<typeof dividendPricingProvenance>>,
  ) => Promise<boolean>;
  isBackgroundPaused: typeof dividendBackgroundRefreshPaused;
}

export interface DividendAutoReviewOptions {
  /** Optional subset of stock codes (e.g., when opening a single stock plan). Omit to check all tracked stocks. */
  codes?: string[];
  /** Bypass session/TTL throttling (for explicit manual retry buttons). Default: false. */
  force?: boolean;
  /** Cancellation signal (e.g., component unmount). */
  signal?: AbortSignal;
  /** Progress callback for calm inline UI status. */
  onProgress?: (progress: DividendAutoReviewProgress) => void;
  /** Failure retry cooldown in ms for automatic runs (default: 5 minutes). */
  failureCooldownMs?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Dependency overrides for deterministic tests. */
  deps?: Partial<DividendAutoReviewDeps>;
}

export const AUTO_REVIEW_FAILURE_COOLDOWN_MS = 5 * 60_000;
const DIVIDEND_REFRESH_CONCURRENCY = 3;

interface SessionReviewRecord {
  asOf: string;
  settingsKey: string;
  attemptedAt: number;
  outcome: 'resolved' | 'attention' | 'failed';
  reasons: string[];
}

interface ActiveRun {
  scopeKey: string;
  force: boolean;
  controller: AbortController;
  subscribers: Set<{
    signal?: AbortSignal;
    onProgress?: (progress: DividendAutoReviewProgress) => void;
    aborted: boolean;
  }>;
  lastProgress?: DividendAutoReviewProgress;
  promise: Promise<DividendAutoReviewResult>;
}

const sessionRecords = new Map<string, SessionReviewRecord>();
let activeRun: ActiveRun | null = null;

function dedupeCanonical(reasons: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const reason of reasons) {
    if (!reason) continue;
    const key = dividendCheckReasonCode(reason);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reason);
  }
  return result;
}

function normalizePricingMethod(stored?: DividendPricingMethod): DividendPricingMethod {
  if (!stored) return defaultDividendPricingMethod();
  return stored.strategy === 'recent_batches'
    ? stored
    : { ...stored, strategy: 'recent_batches', holdingPeriod: 'month_to_year' };
}

function settingsFingerprint(pricingMethod: DividendPricingMethod, principles: DividendSelectionPrinciples): string {
  return JSON.stringify({
    pricingMethod,
    principles: { ...principles, notes: '' },
  });
}

function hasCoreResearchFailure(stock?: DividendStockResearch): boolean {
  if (!stock) return true;
  return stock.issues.some(
    issue => issue.kind === 'financial'
      || issue.kind === 'dividend'
      || (issue.kind === 'technical' && !stock.technical),
  );
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
}

async function defaultSyncIdenticalGridProvenance(
  code: string,
  plan: NonNullable<ReturnType<typeof dividendPricingPlan>>,
  provenance: NonNullable<ReturnType<typeof dividendPricingProvenance>>,
): Promise<boolean> {
  return db.transaction('rw', db.dividendStocks, async () => {
    const current = await db.dividendStocks.get(code);
    if (!current || current.priceMode === 'manual') return false;
    if (dividendPricingPlanChange(plan, current).status !== 'same') return false;
    await db.dividendStocks.update(code, { gridProvenance: provenance });
    return true;
  });
}

const defaultDeps: DividendAutoReviewDeps = {
  loadWorkbench: loadDividendWorkbenchReadOnly,
  loadSettings: () => db.settings.get('main'),
  loadResearchCache: loadDividendResearchCache,
  saveResearchCache: saveDividendResearchCache,
  loadGridBases: loadDividendGridBases,
  loadCheckSummaries: loadDividendCheckSummaries,
  refreshQuotes: refreshDividendMarketQuotes,
  refreshStock: refreshDividendStock,
  fetchResearch: fetchDividendResearch,
  syncIdenticalGridProvenance: defaultSyncIdenticalGridProvenance,
  isBackgroundPaused: dividendBackgroundRefreshPaused,
};

/** Pure classifier identifying which stocks actually need automatic refresh or review. */
export function classifyDividendStockReviewNeed(input: {
  stock: DividendStock;
  summary?: DividendStockCheckSummary;
  basis?: DividendGridBasisResult;
  savedResearch: SavedDividendResearch | null;
  pricingMethod: DividendPricingMethod;
  asOf: string;
}): DividendStockReviewNeed {
  const { stock, summary, basis, savedResearch, pricingMethod, asOf } = input;
  const reasons: DividendAutoReviewReason[] = [];
  const add = (reason: DividendAutoReviewReason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  const needsQuote = stock.quoteFailedAt !== undefined || !summary || summary.trigger.quote.status !== 'current';
  if (needsQuote) add('quote_stale');

  const dividendStale = stock.dividend?.schemaVersion !== 2
    || stock.dividend.asOf !== asOf
    || stock.dividendFailedAt !== undefined;
  if (dividendStale) add('dividend_stale');

  const ledgerUnverified = stock.priceMode !== 'manual'
    && (!basis || !basis.verified || basis.evidenceStatus !== 'current');
  if (ledgerUnverified) add('ledger_unverified');

  const researchSnapshot = savedResearch ? dividendResearchSnapshotForStock(savedResearch, stock.code) : undefined;
  const pricingSnapshot = savedResearch ? dividendPricingSnapshotForStock(savedResearch, stock.code) : undefined;
  const researchStock = researchSnapshot?.stocks[0];

  if (!researchStock || researchStock.checks.length === 0) {
    add('research_missing');
  } else {
    const researchDateOk = Number.isSafeInteger(researchSnapshot!.generatedAt)
      && researchSnapshot!.generatedAt > 0
      && dateInChina(new Date(researchSnapshot!.generatedAt)) === asOf;
    const pricingDateOk = stock.priceMode === 'manual'
      || (Number.isSafeInteger(pricingSnapshot!.generatedAt)
        && pricingSnapshot!.generatedAt > 0
        && dateInChina(new Date(pricingSnapshot!.generatedAt)) === asOf);
    if (!researchDateOk || !pricingDateOk) add('research_stale');

    if (stock.priceMode !== 'manual' && JSON.stringify(pricingSnapshot?.pricingMethod) !== JSON.stringify(pricingMethod)) {
      add('pricing_method_changed');
    }

    const hasRecoverableIssue = researchStock.issues.some(
      issue => issue.kind === 'financial'
        || issue.kind === 'dividend'
        || (issue.kind === 'technical' && issue.reason === 'request_failed'),
    );
    if (hasRecoverableIssue) add('research_issues');

    const hasUnknownChecks = researchStock.checks.some(check => check.status === 'unknown');
    const hasAutoRepairGap = Boolean(summary?.risk.evidenceInsufficient.some(item => item.autoRepair));
    if (hasUnknownChecks || hasAutoRepairGap) add('checks_incomplete');
  }

  if (stock.priceMode !== 'manual' && (!summary || summary.grid.status !== 'verified')) {
    add('grid_unverified');
  }

  const needsResearch = reasons.some(
    reason => reason === 'research_missing'
      || reason === 'research_stale'
      || reason === 'pricing_method_changed'
      || reason === 'research_issues'
      || reason === 'grid_unverified'
      || reason === 'checks_incomplete'
      || reason === 'ledger_unverified',
  );

  return {
    code: stock.code,
    name: stock.name,
    needsQuote,
    needsDividend: dividendStale || (ledgerUnverified && !needsResearch),
    needsResearch,
    reasons,
  };
}

function abortedResult(asOf: string, savedResearch: SavedDividendResearch | null = null, summaries: Record<string, DividendStockCheckSummary> = {}): DividendAutoReviewResult {
  return {
    status: 'aborted',
    asOf,
    checkedCodes: [],
    refreshedCodes: [],
    resolvedCodes: [],
    failed: [],
    attention: [],
    savedResearch,
    summaries,
  };
}

function collectFailureReasons(
  summary: DividendStockCheckSummary | undefined,
  stockResearch: DividendStockResearch | undefined,
  flags: { quoteFailed: boolean; dividendFailed: boolean; financialFailed: boolean; researchFailed: boolean },
): string[] {
  const reasons: string[] = [];
  if (summary) {
    for (const item of summary.risk.blocking) reasons.push(item.reason);
    for (const item of summary.risk.evidenceInsufficient) {
      if (isKeyDataReason(item.reason)) reasons.push(item.reason);
    }
    if (summary.trigger.quote.status !== 'current') {
      reasons.push(...summary.trigger.quote.reasons);
    }
  }
  if (flags.quoteFailed && !reasons.some(r => dividendCheckReasonCode(r).startsWith('quote_'))) {
    reasons.push('quote_refresh_failed');
  }
  if (flags.dividendFailed) {
    reasons.push('dividend_source_refresh_failed');
  }
  if (flags.financialFailed || flags.researchFailed || !stockResearch) {
    reasons.push('research_missing');
  }
  return dedupeCanonical(reasons);
}

function collectAttentionReasons(summary: DividendStockCheckSummary | undefined): string[] {
  if (!summary) return [];
  const reasons: string[] = [];
  if (summary.eligibility.status === 'fail' || summary.eligibility.status === 'unknown') {
    reasons.push(...summary.eligibility.reasons);
  }
  if (summary.grid.status !== 'verified') {
    reasons.push(...summary.grid.reasons);
  }
  for (const item of summary.risk.attention) reasons.push(item.reason);
  for (const item of summary.risk.evidenceInsufficient) {
    if (!isKeyDataReason(item.reason) && item.reason !== 'saved_evidence_snapshot_missing') {
      reasons.push(item.reason);
    }
  }
  return dedupeCanonical(reasons);
}

async function executeAutoReview(
  options: DividendAutoReviewOptions,
  signal: AbortSignal,
  emitProgress: (progress: DividendAutoReviewProgress) => void,
): Promise<DividendAutoReviewResult> {
  const nowFn = options.now ?? Date.now;
  const nowMs = nowFn();
  const asOf = dateInChina(new Date(nowMs));
  const force = Boolean(options.force);
  const failureCooldownMs = options.failureCooldownMs ?? AUTO_REVIEW_FAILURE_COOLDOWN_MS;
  const deps: DividendAutoReviewDeps = { ...defaultDeps, ...options.deps };

  if (signal.aborted) return abortedResult(asOf);
  if (!force && deps.isBackgroundPaused()) {
    return {
      status: 'skipped',
      asOf,
      checkedCodes: [],
      refreshedCodes: [],
      resolvedCodes: [],
      failed: [],
      attention: [],
      savedResearch: null,
      summaries: {},
    };
  }

  emitProgress({ phase: 'detecting', done: 0, total: 0 });

  const [workbench, settings, initialResearch] = await Promise.all([
    deps.loadWorkbench(),
    deps.loadSettings(),
    deps.loadResearchCache().catch(() => null),
  ]);
  if (signal.aborted) return abortedResult(asOf, initialResearch);

  const pricingMethod = normalizePricingMethod(settings?.dividendPricingMethod);
  const principles = settings?.dividendSelectionPrinciples ?? defaultDividendSelectionPrinciples();
  const settingsKey = settingsFingerprint(pricingMethod, principles);
  const requestedSet = options.codes ? new Set(options.codes) : null;

  const targetStocks = [...workbench.stocks]
    .filter(stock => !requestedSet || requestedSet.has(stock.code))
    .sort((a, b) => {
      const aHeld = Number((a.shareMode === 'manual' ? a.manualShares : workbench.positions.get(a.code)?.shares ?? 0) > 0);
      const bHeld = Number((b.shareMode === 'manual' ? b.manualShares : workbench.positions.get(b.code)?.shares ?? 0) > 0);
      return bHeld - aHeld || b.weightBps - a.weightBps || a.code.localeCompare(b.code);
    });
  const checkedCodes = targetStocks.map(stock => stock.code);

  if (!targetStocks.length) {
    return {
      status: 'up_to_date',
      asOf,
      checkedCodes: [],
      refreshedCodes: [],
      resolvedCodes: [],
      failed: [],
      attention: [],
      savedResearch: initialResearch,
      summaries: {},
    };
  }

  const [initialBases, initialChecks] = await Promise.all([
    deps.loadGridBases(checkedCodes, asOf).catch(() => ({} as Record<string, DividendGridBasisResult>)),
    deps.loadCheckSummaries(workbench, { asOf, now: nowMs, researchCache: initialResearch ?? undefined }),
  ]);
  if (signal.aborted) return abortedResult(asOf, initialResearch, initialChecks.stocks);

  const allNeeds = targetStocks.map(stock => classifyDividendStockReviewNeed({
    stock,
    summary: initialChecks.stocks[stock.code],
    basis: initialBases[stock.code],
    savedResearch: initialResearch,
    pricingMethod,
    asOf,
  }));

  const pending: DividendStockReviewNeed[] = [];
  const throttledFailed: DividendAutoReviewStockIssue[] = [];
  const throttledAttention: DividendAutoReviewStockIssue[] = [];

  for (const need of allNeeds) {
    if (!need.reasons.length) continue;
    if (!force) {
      const record = sessionRecords.get(need.code);
      if (record && record.asOf === asOf && record.settingsKey === settingsKey) {
        if (record.outcome === 'failed' && nowMs - record.attemptedAt < failureCooldownMs) {
          throttledFailed.push({
            code: need.code,
            name: need.name,
            kind: 'refresh_failed',
            reasons: record.reasons.length
              ? record.reasons
              : collectFailureReasons(initialChecks.stocks[need.code], initialResearch ? dividendResearchSnapshotForStock(initialResearch, need.code).stocks[0] : undefined, {
                quoteFailed: false,
                dividendFailed: false,
                financialFailed: false,
                researchFailed: false,
              }),
          });
          continue;
        }
        if (record.outcome === 'resolved' || record.outcome === 'attention') {
          const attentionReasons = collectAttentionReasons(initialChecks.stocks[need.code]);
          if (attentionReasons.length) {
            throttledAttention.push({
              code: need.code,
              name: need.name,
              kind: 'needs_attention',
              reasons: attentionReasons,
            });
          }
          continue;
        }
      }
    }
    pending.push(need);
  }

  if (!pending.length) {
    return {
      status: throttledFailed.length ? 'partial' : 'up_to_date',
      asOf,
      checkedCodes,
      refreshedCodes: [],
      resolvedCodes: [],
      failed: throttledFailed,
      attention: throttledAttention,
      savedResearch: initialResearch,
      summaries: initialChecks.stocks,
    };
  }

  const total = pending.length;
  const quoteCodes = pending.filter(item => item.needsQuote).map(item => item.code);
  const dividendCodes = pending.filter(item => item.needsDividend).map(item => item.code);
  const researchTargets = pending.filter(item => item.needsResearch).map(({ code, name }) => ({ code, name }));

  const quoteFailedCodes = new Set<string>();
  const dividendFailedCodes = new Set<string>();
  const refreshedCodes = pending.map(item => item.code);
  let latestResearch = initialResearch;
  let researchThrew = false;

  // 1. Batch quote refresh for pending stocks needing live quotes
  if (quoteCodes.length) {
    emitProgress({ phase: 'quotes', done: 0, total });
    try {
      const quoteResult = await deps.refreshQuotes({ codes: quoteCodes, signal });
      for (const code of quoteResult.failedCodes) quoteFailedCodes.add(code);
    } catch (cause) {
      if (signal.aborted || isAbortError(cause)) return abortedResult(asOf, latestResearch, initialChecks.stocks);
      for (const code of quoteCodes) quoteFailedCodes.add(code);
    }
  }
  if (signal.aborted) return abortedResult(asOf, latestResearch, initialChecks.stocks);

  // 2. Dividend disclosure & schedule refresh on db.dividendStocks (bounded concurrency)
  if (dividendCodes.length) {
    let cursor = 0;
    let done = 0;
    emitProgress({ phase: 'dividends', done: 0, total });
    await Promise.all(
      Array.from({ length: Math.min(DIVIDEND_REFRESH_CONCURRENCY, dividendCodes.length) }, async () => {
        while (cursor < dividendCodes.length && !signal.aborted) {
          const code = dividendCodes[cursor++];
          emitProgress({ phase: 'dividends', done, total, currentCode: code });
          try {
            const ok = await deps.refreshStock(code, { skipQuote: true, signal });
            if (!ok) dividendFailedCodes.add(code);
          } catch (cause) {
            if (signal.aborted || isAbortError(cause)) return;
            dividendFailedCodes.add(code);
          }
          done++;
          if (!researchTargets.length) {
            emitProgress({ phase: 'dividends', done: Math.min(done, total), total, currentCode: code });
          }
        }
      }),
    );
  }
  if (signal.aborted) return abortedResult(asOf, latestResearch, initialChecks.stocks);

  // 3. Research, financial checks, ledger & pricing refresh
  const persistSnapshot = async (snapshot: DividendResearchSnapshot, preserveFailedSources: boolean) => {
    const scope = latestResearch?.scope ?? 'plan';
    const candidateInput = latestResearch?.candidateInput ?? '';
    const reviewedCodes = latestResearch?.reviewedCodes ?? workbench.stocks.map(stock => stock.code);
    const collapsedCodes = latestResearch?.collapsedCodes ?? workbench.stocks.map(stock => stock.code);
    try {
      latestResearch = await deps.saveResearchCache(
        { snapshot, scope, candidateInput, reviewedCodes, collapsedCodes },
        { preserveFailedSources, signal },
      );
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      // Preserve in-memory state if cache persistence fails transiently.
    }
  };

  if (researchTargets.length) {
    let completed = 0;
    const baseDone = Math.max(0, total - researchTargets.length);
    emitProgress({ phase: 'research', done: baseDone, total });
    try {
      const fullSnapshot = await deps.fetchResearch(researchTargets, principles, {
        pricingMethod,
        signal,
        onStock: async stockSnapshot => {
          completed++;
          const stockRow = stockSnapshot.stocks[0];
          emitProgress({ phase: 'research', done: Math.min(baseDone + completed, total), total, currentCode: stockRow?.code });
          if (stockRow) {
            await persistSnapshot(stockSnapshot, hasCoreResearchFailure(stockRow));
          }
        },
      });
      if (signal.aborted) return abortedResult(asOf, latestResearch, initialChecks.stocks);

      // Persist full snapshot (with indices/macro/opportunity): healthy stocks update context cleanly,
      // while core-failed stocks preserve prior good financials without redating them.
      const healthyStocks = fullSnapshot.stocks.filter(row => !hasCoreResearchFailure(row));
      const failedStocks = fullSnapshot.stocks.filter(row => hasCoreResearchFailure(row));
      if (healthyStocks.length) {
        await persistSnapshot({ ...fullSnapshot, stocks: healthyStocks }, false);
      }
      if (failedStocks.length) {
        await persistSnapshot({ ...fullSnapshot, stocks: failedStocks }, true);
      }
    } catch (cause) {
      if (signal.aborted || isAbortError(cause)) return abortedResult(asOf, latestResearch, initialChecks.stocks);
      researchThrew = true;
    }
  }
  if (signal.aborted) return abortedResult(asOf, latestResearch, initialChecks.stocks);

  // 4. Finalize: recompute summaries & safely sync gridProvenance ONLY for identical saved grids
  emitProgress({ phase: 'finalizing', done: total, total });
  const finalNowMs = nowFn();
  let finalWorkbench = await deps.loadWorkbench();
  let finalChecks = await deps.loadCheckSummaries(finalWorkbench, {
    asOf,
    now: finalNowMs,
    researchCache: latestResearch ?? undefined,
  });

  let provenanceSynced = false;
  for (const item of pending) {
    if (signal.aborted) return abortedResult(asOf, latestResearch, finalChecks.stocks);
    const stock = finalWorkbench.stocks.find(row => row.code === item.code);
    const summary = finalChecks.stocks[item.code];
    if (!stock || !summary || stock.priceMode === 'manual') continue;
    if (summary.grid.status !== 'saved_unverified' || !summary.currentPlan || !latestResearch) continue;
    if (dividendPricingPlanChange(summary.currentPlan, stock).status !== 'same') continue;
    const pricingSnapshot = dividendPricingSnapshotForStock(latestResearch, stock.code);
    const pricing = pricingSnapshot.stocks[0]?.pricing;
    if (!pricing) continue;
    const provenance = dividendPricingProvenance(pricing, pricingSnapshot.generatedAt);
    if (!provenance) continue;
    try {
      if (await deps.syncIdenticalGridProvenance(stock.code, summary.currentPlan, provenance)) {
        provenanceSynced = true;
      }
    } catch {
      // Never fail auto-review on a provenance sync race; saved grid remains intact.
    }
  }

  if (provenanceSynced) {
    finalWorkbench = await deps.loadWorkbench();
    finalChecks = await deps.loadCheckSummaries(finalWorkbench, {
      asOf,
      now: nowFn(),
      researchCache: latestResearch ?? undefined,
    });
  }

  // 5. Summarize per-stock results and record session throttling metadata
  const resolvedCodes: string[] = [];
  const failed: DividendAutoReviewStockIssue[] = [...throttledFailed];
  const attention: DividendAutoReviewStockIssue[] = [...throttledAttention];
  const recordedAt = nowFn();

  for (const item of pending) {
    const summary = finalChecks.stocks[item.code];
    const stockResearch = latestResearch ? dividendResearchSnapshotForStock(latestResearch, item.code).stocks[0] : undefined;
    const stockQuoteFailed = quoteFailedCodes.has(item.code) || Boolean(summary?.trigger.quote.reasons.includes('quote_refresh_failed'));
    const stockDividendFailed = dividendFailedCodes.has(item.code) || Boolean(stockResearch?.issues.some(issue => issue.kind === 'dividend'));
    const stockFinancialFailed = Boolean(stockResearch?.issues.some(issue => issue.kind === 'financial'));
    const stockResearchFailed = item.needsResearch && (researchThrew || !stockResearch);
    const unresolvedKeyData = summary
      ? summary.risk.evidenceInsufficient.filter(risk => {
        if (!isKeyDataReason(risk.reason)) return false;
        // Pre-market / suspended prior-session quotes returned by a healthy quote request
        // are market-timing notices, not refresh failures.
        if (risk.reason === 'quote_prior_date' && !stockQuoteFailed && summary.trigger.quote.historicalUsable) return false;
        return true;
      })
      : [];
    const keyDataMissing = Boolean(summary?.risk.blocking.length) || unresolvedKeyData.length > 0;

    if (stockQuoteFailed || stockDividendFailed || stockFinancialFailed || stockResearchFailed || keyDataMissing) {
      const reasons = collectFailureReasons(summary, stockResearch, {
        quoteFailed: stockQuoteFailed,
        dividendFailed: stockDividendFailed,
        financialFailed: stockFinancialFailed,
        researchFailed: stockResearchFailed,
      });
      failed.push({ code: item.code, name: item.name, kind: 'refresh_failed', reasons });
      sessionRecords.set(item.code, {
        asOf,
        settingsKey,
        attemptedAt: recordedAt,
        outcome: 'failed',
        reasons,
      });
    } else {
      resolvedCodes.push(item.code);
      const attentionReasons = collectAttentionReasons(summary);
      if (attentionReasons.length) {
        attention.push({ code: item.code, name: item.name, kind: 'needs_attention', reasons: attentionReasons });
        sessionRecords.set(item.code, {
          asOf,
          settingsKey,
          attemptedAt: recordedAt,
          outcome: 'attention',
          reasons: attentionReasons,
        });
      } else {
        sessionRecords.set(item.code, {
          asOf,
          settingsKey,
          attemptedAt: recordedAt,
          outcome: 'resolved',
          reasons: [],
        });
      }
    }
  }

  return {
    status: failed.length > 0 ? 'partial' : 'completed',
    asOf,
    checkedCodes,
    refreshedCodes,
    resolvedCodes,
    failed,
    attention,
    savedResearch: latestResearch,
    summaries: finalChecks.stocks,
  };
}

/**
 * Automatically detects and refreshes pending-review dividend stocks (quotes, disclosures,
 * ledgers, financial/research checks, and identical-grid provenance) with concurrency limits,
 * AbortSignal cancellation, in-flight coalescing, and session/TTL throttling.
 */
export function autoReviewPendingDividendStocks(
  options: DividendAutoReviewOptions = {},
): Promise<DividendAutoReviewResult> {
  const asOf = dateInChina(new Date((options.now ?? Date.now)()));
  if (options.signal?.aborted) return Promise.resolve(abortedResult(asOf));

  const canCoalesce = !options.force;
  const scopeKey = options.codes?.length ? [...new Set(options.codes)].sort().join(',') : '*';

  if (canCoalesce && activeRun && (activeRun.scopeKey === '*' || activeRun.scopeKey === scopeKey)) {
    const run = activeRun;
    const subscriber = { signal: options.signal, onProgress: options.onProgress, aborted: false };
    run.subscribers.add(subscriber);
    if (run.lastProgress) options.onProgress?.(run.lastProgress);

    return new Promise<DividendAutoReviewResult>((resolve, reject) => {
      const cleanup = () => {
        run.subscribers.delete(subscriber);
        if (options.signal) options.signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        subscriber.aborted = true;
        cleanup();
        if ([...run.subscribers].every(item => item.aborted)) {
          run.controller.abort();
        }
        resolve(abortedResult(asOf));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      run.promise.then(
        result => {
          if (subscriber.aborted) return;
          cleanup();
          resolve(result);
        },
        error => {
          if (subscriber.aborted) return;
          cleanup();
          reject(error);
        },
      );
    });
  }

  const controller = new AbortController();
  const subscriber = { signal: options.signal, onProgress: options.onProgress, aborted: false };
  const run: ActiveRun = {
    scopeKey,
    force: Boolean(options.force),
    controller,
    subscribers: new Set([subscriber]),
    promise: Promise.resolve(abortedResult(asOf)),
  };

  const emitProgress = (progress: DividendAutoReviewProgress) => {
    run.lastProgress = progress;
    for (const sub of run.subscribers) {
      if (!sub.aborted) sub.onProgress?.(progress);
    }
  };

  const promise = executeAutoReview(options, controller.signal, emitProgress).finally(() => {
    if (activeRun === run) activeRun = null;
  });
  run.promise = promise;
  activeRun = run;

  return new Promise<DividendAutoReviewResult>((resolve, reject) => {
    const onAbort = () => {
      subscriber.aborted = true;
      run.subscribers.delete(subscriber);
      if (run.subscribers.size === 0 || [...run.subscribers].every(item => item.aborted)) {
        controller.abort();
      }
      resolve(abortedResult(asOf));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      result => {
        options.signal?.removeEventListener('abort', onAbort);
        if (!subscriber.aborted) resolve(result);
      },
      error => {
        options.signal?.removeEventListener('abort', onAbort);
        if (!subscriber.aborted) reject(error);
      },
    );
  });
}

/** Clears session throttling memory (intended for tests or explicit full reset). */
export function resetDividendAutoReviewSession(): void {
  sessionRecords.clear();
  if (activeRun) {
    activeRun.controller.abort();
    activeRun = null;
  }
}
