import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import { defaultDividendSelectionPrinciples, isDividendSelectionPrinciples,
  type DividendResearchSnapshot, type DividendSelectionPrinciples, type DividendStockResearch } from '../lib/dividendResearch';
import { fetchDividendResearch } from '../services/dividendResearchService';
import {
  autoReviewPendingDividendStocks,
  type DividendAutoReviewProgress,
  type DividendAutoReviewResult,
} from '../services/dividendAutoReviewService';
import { addDividendResearchCandidate, loadDividendSelectionPrinciples, previewDividendRiskRemoval,
  removeDividendRiskStocks, saveDividendSelectionPrinciples, loadDividendPricingMethod, saveDividendPricingMethod } from '../services/dividendAdvisorActionsService';
import type { DividendPricingMethod } from '../lib/dividendPricing';
import type { DividendStock } from '../lib/dividendWorkbench';
import { DividendPricingCard, DividendPricingEditor } from './DividendAdvisorPricing';
import { DividendCandidateError, resolveDividendCandidates } from '../services/dividendCandidateService';
import { dividendResearchScopeStocks, dividendResearchSnapshotForStock, dividendPricingSnapshotForStock, loadDividendResearchCache, loadDividendResearchCollapsePreference, saveDividendResearchCache, saveDividendResearchCollapse, type SavedDividendResearch } from '../services/dividendResearchCacheService';
import DividendAdvisorResumeReview from './DividendAdvisorResumeReview';
import { dateInChina } from '../lib/dividendWorkbench';
import { dividendCheckSummary, type DividendStockCheckSummary } from '../lib/dividendCheckSummary';
import { loadDividendCheckSummaries } from '../services/dividendCheckSummaryService';
import { loadDividendWorkbench } from '../services/dividendService';
import DividendCompactPlan from './DividendCompactPlan';
import DividendReadFilters from './DividendReadFilters';
import { matchesDividendReadFilter, type DividendReadFilter } from '../lib/dividendReading';
import DividendPricingUpdate from './DividendPricingUpdate';

type Panel = 'chat' | 'research' | 'principles';
type RemovalPreview = Awaited<ReturnType<typeof previewDividendRiskRemoval>>;
const PRINCIPLE_KEYS = ['minYieldBps', 'minRoeBps', 'minRevenueGrowthBps', 'minProfitGrowthBps', 'maxDebtAssetBps', 'minCashProfitBps', 'minFcfCoverageBps', 'maxPayoutBps', 'minDividendYears'] as const;
function StockResearch({ stock, snapshot, pricingSnapshot, savedStock, check: loadedCheck, amountVisible, canAdd, busy, pricingOutdated, autoReviewing, failureReasons, collapsed, onToggle, onAdd, onDiscuss, onUpdated, onResearchUpdated, onManage, onRetry }: { onRetry: () => void; onManage?: () => void; stock: DividendStockResearch; snapshot: DividendResearchSnapshot; pricingSnapshot: DividendResearchSnapshot; savedStock?: DividendStock; check?: DividendStockCheckSummary; amountVisible: boolean; canAdd: boolean; busy: boolean; pricingOutdated: boolean; autoReviewing: boolean; failureReasons?: string[]; collapsed: boolean; onToggle: () => void; onAdd: () => void; onDiscuss: () => void; onUpdated: () => Promise<unknown>; onResearchUpdated: (snapshot: DividendResearchSnapshot) => Promise<void> }) {
  const { t } = useTranslation();
  const pricingElement = useRef<HTMLDivElement>(null), focusOnOpen = useRef(false);
  const focusPricing = () => { pricingElement.current?.focus({ preventScroll: true }); pricingElement.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  useEffect(() => { if (!collapsed && focusOnOpen.current) { focusOnOpen.current = false; focusPricing(); } }, [collapsed]);
  const openPricing = () => { if (collapsed) { focusOnOpen.current = true; onToggle(); } else focusPricing(); };
  const pricing = pricingSnapshot.stocks[0]?.pricing;
  const check = loadedCheck ?? dividendCheckSummary({ stock: savedStock ?? { code: stock.code, name: stock.name, group: 'watch', weightBps: 0, shareMode: 'manual', manualShares: 0, lotSize: 100 },
    research: stock, indices: snapshot.indices, principles: snapshot.principles, pricingMethod: snapshot.pricingMethod,
    basis: { asOf: dateInChina(), verified: false, evidenceStatus: 'missing', evidenceIssues: ['DIVIDEND_LEDGER_MISSING'] }, researchGeneratedAt: snapshot.generatedAt });
  return <article className={`div-ai-research-card ${stock.status}`}><header><span><strong>{stock.name}</strong><small>{stock.code}{savedStock && ` · ${t(`div_group_${savedStock.group}`)}`}</small></span>
    <button type="button" className="btn btn-secondary div-ai-research-toggle" disabled={busy} aria-expanded={!collapsed} aria-controls={`div-ai-stock-${stock.code}`} onClick={onToggle}>{t(collapsed ? 'div_focus_grid_preview' : 'div_ai_research_collapse')}</button></header>
    <DividendCompactPlan summary={check} amountVisible={amountVisible} pricingUpdate={<DividendPricingUpdate pricing={pricing} check={loadedCheck} savedStock={savedStock}
      amountVisible={amountVisible} outdated={pricingOutdated} disabled={busy} autoReviewing={autoReviewing} failureReasons={failureReasons} onOpen={openPricing} onRetry={onRetry} />} />
    <div className="div-focus-card-actions">
      {amountVisible && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onDiscuss}>{t('div_ai_discuss_stock')}</button>}
      {onManage && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onManage}>{t('div_focus_manage')}</button>}
      {canAdd && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onAdd}>{t('div_ai_add_watch')}</button>}
    </div>
    <div id={`div-ai-stock-${stock.code}`} ref={pricingElement} tabIndex={-1} hidden={collapsed || !amountVisible}>
      {savedStock?.buyPaused && <DividendAdvisorResumeReview stock={stock} disabled={busy} onUpdated={onUpdated} onResearchUpdated={onResearchUpdated} />}
      {pricingOutdated && !autoReviewing && <p className="div-warning">{t('div_ai_research_outdated')}</p>}
      {canAdd && <div className="div-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onAdd}>{t('div_ai_add_watch')}</button><span className="div-ai-muted">{t('div_check_join_to_save')}</span></div>}
      {pricing ? <DividendPricingCard key={pricingSnapshot.generatedAt} retryDisabled={busy} onRetry={onRetry} onResearchUpdated={onResearchUpdated} check={check} savedStock={savedStock} code={stock.code} pricing={pricing} method={pricingSnapshot.pricingMethod} generatedAt={pricingSnapshot.generatedAt} disabled={busy || canAdd || pricingOutdated} onUpdated={onUpdated} />
        : <p className="div-ai-stock-checked div-ai-muted">{t(autoReviewing ? 'div_auto_review_stock_running' : 'div_check_grid_missing')}</p>}
    </div>
  </article>;
}

export default function DividendAdvisorWorkspace({ activePanel, amountVisible, onUpdated, onDiscuss, disabled = false, onManageStock, selectionTools }: { onManageStock?: (code: string) => void; selectionTools?: ReactNode; activePanel: Panel; amountVisible: boolean; onUpdated: () => Promise<unknown>; disabled?: boolean;
  onDiscuss: (stock: DividendStockResearch, snapshot: DividendResearchSnapshot) => void }) {
  const { t, i18n } = useTranslation();
  const [principles, setPrinciples] = useState<DividendSelectionPrinciples>(defaultDividendSelectionPrinciples);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pricingMethod, setPricingMethod] = useState<DividendPricingMethod | null>(null);
  const [working, setBusy] = useState(false);
  const [researchProgress, setResearchProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = working || disabled;
  const [savedResearch, setSavedResearch] = useState<SavedDividendResearch | null>(null);
  const snapshot = savedResearch?.snapshot ?? null;
  const [codes, setCodes] = useState('');
  const [search, setSearch] = useState('');
  const [readFilter, setReadFilter] = useState<DividendReadFilter>('all');
  const [configuredStocks, setConfiguredStocks] = useState<DividendStock[]>([]);
  const [checkSummaries, setCheckSummaries] = useState<Record<string, DividendStockCheckSummary>>({});
  const [removal, setRemoval] = useState<RemovalPreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [restored, setRestored] = useState(false);
  const [autoReviewing, setAutoReviewing] = useState(false);
  const [autoReviewProgress, setAutoReviewProgress] = useState<DividendAutoReviewProgress | null>(null);
  const [autoReviewResult, setAutoReviewResult] = useState<DividendAutoReviewResult | null>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const autoReviewAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void loadDividendWorkbench().then(async workbench => {
      const candidates: DividendStock[] = (savedResearch?.snapshot.stocks ?? []).filter(row => !workbench.stocks.some(stock => stock.code === row.code))
        .map(row => ({ code: row.code, name: row.name, group: 'watch', weightBps: 0, shareMode: 'manual', manualShares: 0, lotSize: 100 }));
      return loadDividendCheckSummaries({ ...workbench, stocks: [...workbench.stocks, ...candidates] }, { researchCache: savedResearch ?? undefined });
    }).then(value => { if (active) setCheckSummaries(value.stocks); }).catch(() => { if (active) setError(t('div_ai_error_storage')); });
    return () => { active = false; };
  }, [savedResearch, configuredStocks, pricingMethod, principles, t]);

  useEffect(() => {
    const subscription = liveQuery(() => db.dividendStocks.toArray()).subscribe({
      next: stocks => setConfiguredStocks(stocks),
      error: () => setError(t('div_ai_error_storage')),
    });
    return () => subscription.unsubscribe();
  }, [t]);

  useEffect(() => {
    let active = true; mounted.current = true;
    void Promise.all([loadDividendSelectionPrinciples(), loadDividendPricingMethod(), Promise.all([loadDividendResearchCache(), loadDividendResearchCollapsePreference()]).then(([saved, collapsedCodes]) => saved ? { ...saved, collapsedCodes: collapsedCodes ?? saved.snapshot.stocks.map(stock => stock.code) } : null).catch(() => {
      if (active) setError(t('div_ai_error_storage')); return null;
    })]).then(([value, method, saved]) => { if (active) {
      setPrinciples(value); setPricingMethod(method); setReady(true);
      if (saved) { setSavedResearch(saved); setCodes(saved.candidateInput); setRestored(true); }
    } })
      .catch(() => { if (active) setError(t('div_ai_error_storage')); });
    return () => { active = false; mounted.current = false; autoReviewAbortRef.current?.abort(); };
  }, [t]);

  const notifyUpdated = useCallback(async () => {
    await onUpdated();
    const current = await db.dividendStocks.toArray();
    if (mounted.current) setConfiguredStocks(current);
  }, [onUpdated]);

  const autoReviewTriggerKey = useMemo(() => JSON.stringify({
    codes: configuredStocks.map(stock => stock.code).sort(),
    pricingMethod,
    principles: { ...principles, notes: '' },
  }), [configuredStocks, pricingMethod, principles]);

  const triggerAutoReview = useCallback((options: { codes?: string[]; force?: boolean } = {}) => {
    if (lock.current || disabled) return;
    autoReviewAbortRef.current?.abort();
    const controller = new AbortController();
    autoReviewAbortRef.current = controller;
    setAutoReviewing(true);
    setAutoReviewProgress({ phase: 'detecting', done: 0, total: 0 });
    void autoReviewPendingDividendStocks({
      codes: options.codes,
      force: options.force,
      signal: controller.signal,
      onProgress: progress => {
        if (!controller.signal.aborted && mounted.current) setAutoReviewProgress(progress);
      },
    }).then(async result => {
      if (controller.signal.aborted || !mounted.current || result.status === 'aborted') return;
      setAutoReviewResult(result);
      if (result.savedResearch) {
        setSavedResearch(result.savedResearch);
        setRestored(false);
      }
      if (Object.keys(result.summaries).length) {
        setCheckSummaries(current => ({ ...current, ...result.summaries }));
      }
      if (result.refreshedCodes.length > 0) {
        await notifyUpdated().catch(() => undefined);
      }
    }).catch(() => {
      // Automatic background review keeps saved plans intact; explicit failures are surfaced via result.failed.
    }).finally(() => {
      if (autoReviewAbortRef.current === controller) {
        autoReviewAbortRef.current = null;
        if (mounted.current) {
          setAutoReviewing(false);
          setAutoReviewProgress(null);
        }
      }
    });
  }, [disabled, notifyUpdated]);

  useEffect(() => {
    if (!ready || activePanel !== 'research' || configuredStocks.length === 0 || disabled) return;
    triggerAutoReview();
    return () => {
      autoReviewAbortRef.current?.abort();
    };
  }, [ready, activePanel, autoReviewTriggerKey, configuredStocks.length, disabled, triggerAutoReview]);

  const run = async (job: () => Promise<void>) => {
    if (lock.current || disabled) return;
    autoReviewAbortRef.current?.abort();
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await job(); }
    catch (cause) { if (mounted.current) setError(cause instanceof DividendCandidateError
      ? t(`div_ai_candidate_${cause.reason}`, { query: cause.query, matches: cause.matches.map(stock => `${stock.name} ${stock.code}`).join('、') })
      : t(cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError') ? 'div_experience_repair_timeout'
        : cause instanceof Error && cause.message === 'INVALID_RESEARCH_CODES' ? 'div_ai_invalid_codes' : cause instanceof Error && cause.message === 'RESEARCH_CACHE_SAVE_FAILED' ? 'div_ai_research_save_failed' : 'div_ai_action_error')); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); setResearchProgress(null); } }
  };
  const research = (selected: 'plan' | 'candidates', repeatLast = false) => void run(async () => {
    const current = await db.dividendStocks.toArray();
    const stocks = selected === 'plan' ? current.map(({ code, name }) => ({ code, name }))
      : repeatLast && savedResearch ? dividendResearchScopeStocks(savedResearch, []).map(({ code, name }) => ({ code, name }))
      : await resolveDividendCandidates(codes, [...current, ...(snapshot?.stocks ?? [])]);
    setRemoval(null);
    let completed = 0;
    if (mounted.current) setResearchProgress({ done: 0, total: stocks.length });
    // Selecting an empty plan must also leave the previous candidate view. Save
    // its empty scope without downloading or treating archived evidence as targets.
    const value: DividendResearchSnapshot = stocks.length
      ? await fetchDividendResearch(stocks, principles, { ...(pricingMethod ? { pricingMethod } : {}), signal: AbortSignal.timeout(90000),
        onStock: async () => { completed++; if (mounted.current) setResearchProgress({ done: completed, total: stocks.length }); } })
      : { generatedAt: Date.now(), principles, indices: [], stocks: [], ...(pricingMethod ? { pricingMethod } : {}) };
    // Finish saving even when navigation unmounts this screen during the download.
    try {
      const saved = await saveDividendResearchCache({ snapshot: value, scope: selected, candidateInput: repeatLast ? savedResearch?.candidateInput ?? codes : codes,
        reviewedCodes: stocks.map(stock => stock.code), collapsedCodes: savedResearch?.collapsedCodes ?? stocks.map(stock => stock.code) });
      const latestStocks = await db.dividendStocks.toArray();
      if (mounted.current) {
        setSavedResearch(saved); setRestored(false); setConfiguredStocks(latestStocks);
        if (selected === 'plan') setAutoReviewResult(null);
      }
    }
    catch { throw new Error('RESEARCH_CACHE_SAVE_FAILED'); }
  });
  const savePrinciples = () => void run(async () => {
    const numeric = Object.fromEntries(PRINCIPLE_KEYS.map(key => [key, Number(draft?.[key] ?? (key === 'minDividendYears' ? principles[key] : (principles[key] ?? 15000) / 100)) * (key === 'minDividendYears' ? 1 : 100)]));
    for (const key of PRINCIPLE_KEYS) numeric[key] = Math.round(numeric[key] * 1e8) / 1e8;
    const value = { ...numeric, notes: notesDraft ?? principles.notes ?? '' };
    if (PRINCIPLE_KEYS.some(key => draft?.[key] === '') || !isDividendSelectionPrinciples(value)) { setError(t('div_ai_principles_invalid')); return; }
    await saveDividendSelectionPrinciples(value);
    if (mounted.current) { setPrinciples(value); setDraft(null); setNotesDraft(null); setRemoval(null); setNotice(t('div_ai_principles_saved')); }
  });
  const visibleStocks = savedResearch ? dividendResearchScopeStocks(savedResearch, configuredStocks.map(stock => stock.code)) : [];
  const visibleCodes = new Set(visibleStocks.map(stock => stock.code));
  const query = search.trim().toLowerCase();
  const matchesSearch = (stock: { name: string; code: string }) => `${stock.name} ${stock.code}`.toLowerCase().includes(query);
  const riskCodes = visibleStocks.filter(stock => configuredStocks.some(current => current.code === stock.code)
    && (stock.checks ?? []).some(check => check.status === 'risk')).map(stock => stock.code);
  const isPricingOutdated = (value: DividendResearchSnapshot) => !Number.isSafeInteger(value.generatedAt) || value.generatedAt <= 0
    || JSON.stringify(value.pricingMethod) !== JSON.stringify(pricingMethod)
    || dateInChina(new Date(value.generatedAt)) !== dateInChina();
  const outdated = !!savedResearch && visibleStocks.some(stock => isPricingOutdated(dividendPricingSnapshotForStock(savedResearch, stock.code)));
  const onResearchUpdated = async (value: DividendResearchSnapshot) => {
    const current = await db.dividendStocks.toArray();
    const saved = await saveDividendResearchCache({ snapshot: value, scope: savedResearch?.scope ?? 'plan', candidateInput: savedResearch?.candidateInput ?? codes,
      reviewedCodes: savedResearch?.reviewedCodes, collapsedCodes: savedResearch?.collapsedCodes ?? value.stocks.map(stock => stock.code) });
    if (mounted.current) { setSavedResearch(saved); setRestored(false); setConfiguredStocks(current); }
  };
  const repairStock = (stock: DividendStockResearch) => void run(async () => {
    if (mounted.current) setResearchProgress({ done: 0, total: 1 });
    if (configuredStocks.some(current => current.code === stock.code)) {
      const result = await autoReviewPendingDividendStocks({
        codes: [stock.code],
        force: true,
        signal: AbortSignal.timeout(90000),
      });
      if (mounted.current) {
        if (result.savedResearch) {
          setSavedResearch(result.savedResearch);
          setRestored(false);
        }
        if (Object.keys(result.summaries).length) {
          setCheckSummaries(current => ({ ...current, ...result.summaries }));
        }
        setAutoReviewResult(current => {
          if (!current) return result;
          const nextFailed = [
            ...current.failed.filter(item => item.code !== stock.code),
            ...result.failed.filter(item => item.code === stock.code),
          ];
          return { ...current, failed: nextFailed, status: nextFailed.length ? 'partial' : 'completed' };
        });
      }
      await notifyUpdated();
      return;
    }
    const value = await fetchDividendResearch([{ code: stock.code, name: stock.name }], principles, { ...(pricingMethod ? { pricingMethod } : {}), signal: AbortSignal.timeout(90000) });
    await onResearchUpdated(value);
    await notifyUpdated();
  });
  const toggleStock = (code: string) => void run(async () => {
    const collapsed = !savedResearch?.collapsedCodes?.includes(code);
    await saveDividendResearchCollapse(code, collapsed, savedResearch?.collapsedCodes);
    if (mounted.current) setSavedResearch(current => current ? { ...current,
      collapsedCodes: collapsed ? [...(current.collapsedCodes ?? []), code] : current.collapsedCodes?.filter(value => value !== code) } : current);
  });

  const failedReviewByCode = useMemo(
    () => new Map((autoReviewResult?.failed ?? []).map(item => [item.code, item])),
    [autoReviewResult],
  );
  const autoReviewFailed = autoReviewResult?.failed ?? [];

  return <div className="div-ai-workspace-panels" hidden={activePanel === 'chat'}>
    {activePanel === 'principles' && <section><h2 className="div-ai-panel-title">{t('div_ai_tab_principles')}</h2><p className="div-ai-muted">{t('div_ai_principles_intro')}</p>
      <details className="div-method" open><summary>{t('div_v2_selection_rules')}</summary><p>{t('div_ai_principles_defaults')}</p><form className="div-ai-principles-form" onSubmit={event => { event.preventDefault(); savePrinciples(); }}>
        {PRINCIPLE_KEYS.map(key => <label key={key}><span>{t(`div_ai_rule_${key}`)}</span><input type="number" className="form-input" step={key === 'minDividendYears' ? '1' : '.01'}
          disabled={!ready || busy} value={draft?.[key] ?? (key === 'minDividendYears' ? principles[key] : (principles[key] ?? 15000) / 100)}
          onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        <label className="div-ai-principles-notes"><span>{t('div_ai_principles_notes')}</span><textarea className="form-input" rows={4} maxLength={4000} disabled={!ready || busy}
          value={notesDraft ?? principles.notes ?? ''} onChange={event => setNotesDraft(event.target.value)} placeholder={t('div_ai_principles_notes_placeholder')} /><small>{t('div_ai_principles_notes_help')}</small></label>
        <button type="submit" className="btn btn-primary" disabled={!ready || busy || (!draft && notesDraft === null)}>{t('div_ai_principles_save')}</button>
      </form></details>
      {pricingMethod && <details className="div-method" open><summary>{t('div_v2_pricing_settings')} · {t('div_v2_pricing_summary', { margin: pricingMethod.safetyMarginBps / 100 })}</summary>
        <DividendPricingEditor key={JSON.stringify(pricingMethod)} method={pricingMethod} stocks={configuredStocks} opportunity={snapshot?.opportunity} disabled={busy} onSave={value => run(async () => {
          await saveDividendPricingMethod(value); if (mounted.current) { setPricingMethod(value); setRemoval(null); setNotice(t('div_v2_pricing_saved')); }
        })} />
      </details>}</section>}
    {activePanel === 'research' && <section><h2 className="div-ai-panel-title">{t('div_ai_tab_research')}</h2><p className="div-ai-muted">{t('div_focus_selection_intro')}</p><div className="div-selection-actions">{selectionTools}
      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => research('plan')}>{t('div_experience_repair_all')}</button></div>
      <details className="div-ai-candidate-search"><summary>{t('div_ai_screen_candidates')}</summary><label htmlFor="div-ai-candidates">{t('div_ai_candidate_codes')}</label>
        <textarea className="form-input" id="div-ai-candidates" value={codes} rows={2} maxLength={400} disabled={busy}
          placeholder={t('div_ai_candidate_placeholder')} onChange={event => setCodes(event.target.value)} />
        <p className="div-ai-muted">{t('div_ai_candidate_review_only')}</p>
        <button type="button" className="btn btn-secondary" disabled={!ready || busy || !codes.trim()} onClick={() => research('candidates')}>{t('div_ai_screen_candidates')}</button></details>
      {working && <p className="div-advisor-status" role="status">{researchProgress ? t('div_experience_repair_progress', researchProgress) : t('div_ai_research_loading')}</p>}
      {!working && autoReviewing && <p className="div-advisor-status div-auto-review-banner" role="status">
        {autoReviewProgress && autoReviewProgress.total > 0
          ? t('div_auto_review_running', { done: autoReviewProgress.done, total: autoReviewProgress.total })
          : t('div_auto_review_detecting')}
      </p>}
      {!working && !autoReviewing && autoReviewFailed.length > 0 && <div className="div-auto-review-banner is-failed" role="status">
        <span>{t('div_auto_review_failed_summary', {
          count: autoReviewFailed.length,
          stocks: autoReviewFailed.map(item => item.name).join(i18n.language.startsWith('zh') ? '、' : ', '),
        })}</span>
        <button type="button" className="btn btn-secondary" disabled={busy}
          onClick={() => triggerAutoReview({ codes: autoReviewFailed.map(item => item.code), force: true })}>
          {t('div_auto_review_retry')}
        </button>
      </div>}
      {!working && !autoReviewing && autoReviewFailed.length === 0 && autoReviewResult?.status === 'completed' && autoReviewResult.resolvedCodes.length > 0 && (
        <p className="div-advisor-status" role="status">{t('div_auto_review_completed', { count: autoReviewResult.resolvedCodes.length })}</p>
      )}
      {snapshot && !amountVisible && <p className="div-advisor-hidden">{t('div_ai_reading_hidden')}</p>}
      <div className="div-focus-selection-tools"><input type="search" className="form-input" value={search} aria-label={t('div_search')} placeholder={t('div_search')} onChange={event => setSearch(event.target.value)} />
        <DividendReadFilters value={readFilter} onChange={setReadFilter} /></div>
      <div className="div-ai-research-results">{configuredStocks.filter(stock => !visibleCodes.has(stock.code) && matchesSearch(stock) && matchesDividendReadFilter(checkSummaries[stock.code], readFilter)).map(stock => {
        const check = checkSummaries[stock.code];
        return <article key={stock.code} className="div-ai-research-card div-focus-saved-stock"><header><span><strong>{stock.name}</strong><small>{stock.code} · {t(`div_group_${stock.group}`)}</small></span>
          </header>
          {autoReviewing ? <p className="div-ai-muted" role="status">{t('div_auto_review_stock_running')}</p>
            : check ? <DividendCompactPlan summary={check} amountVisible={amountVisible} /> : <p className="div-ai-muted">{t('loading')}</p>}
          <div className="div-focus-card-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onManageStock?.(stock.code)}>{t('div_focus_manage')}</button></div>
        </article>;
      })}</div>
      {snapshot && <div className="div-ai-research-results">
        <p className="div-ai-muted">{t(savedResearch?.scope === 'candidates' ? 'div_ai_research_candidate_results' : 'div_ai_research_plan_results')}</p>
        {restored && !autoReviewing && <p className="div-ai-muted">{t('div_ai_research_restored')}</p>}
        {outdated && !autoReviewing && <p className="div-warning">{t('div_ai_research_outdated')}</p>}
        {savedResearch?.scope === 'candidates' && <button type="button" className="btn btn-secondary" disabled={!ready || busy} onClick={() => research('candidates', true)}>{t('div_ai_refresh_candidates')}</button>}
        {!visibleStocks.length && <p className="div-ai-muted">{t('div_ai_research_no_stocks')}</p>}
        {visibleStocks.filter(stock => matchesSearch(stock) && matchesDividendReadFilter(checkSummaries[stock.code], readFilter)).map(stock => {
          const stockSnapshot = dividendResearchSnapshotForStock(savedResearch!, stock.code);
          const pricingSnapshot = dividendPricingSnapshotForStock(savedResearch!, stock.code);
          return <StockResearch onRetry={() => repairStock(stock)} key={stock.code} amountVisible={amountVisible} check={checkSummaries[stock.code]} stock={stock} snapshot={stockSnapshot} pricingSnapshot={pricingSnapshot} onUpdated={notifyUpdated} onResearchUpdated={onResearchUpdated} onManage={onManageStock && configuredStocks.some(current => current.code === stock.code) ? () => onManageStock(stock.code) : undefined} savedStock={configuredStocks.find(current => current.code === stock.code)} canAdd={!configuredStocks.some(current => current.code === stock.code)} busy={busy} pricingOutdated={isPricingOutdated(pricingSnapshot)} autoReviewing={autoReviewing} failureReasons={failedReviewByCode.get(stock.code)?.reasons} collapsed={savedResearch?.collapsedCodes?.includes(stock.code) ?? true} onToggle={() => toggleStock(stock.code)} onDiscuss={() => onDiscuss(stock, stockSnapshot)} onAdd={() => void run(async () => {
          await addDividendResearchCandidate(stock.code, stock.name); await notifyUpdated();
          if (mounted.current) setNotice(t('div_ai_added_watch'));
        })} />; })}
        {riskCodes.length > 0 && <details className="div-ai-removal"><summary>{t('div_ai_review_remove')}</summary><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(async () => {
          const preview = await previewDividendRiskRemoval(riskCodes); if (mounted.current) setRemoval(preview);
        })}>{t('div_ai_review_remove')}</button>
          {removal && <div className="div-ai-confirm"><p>{t('div_ai_remove_intro')}</p>
            {removal.removable.map(stock => <p key={stock.code}>{stock.name} · {stock.code}</p>)}
            {removal.protected.map(stock => <p className="div-ai-muted" key={stock.code}>{stock.name} · {t('div_ai_remove_protected')}</p>)}
            {!removal.removable.length && <p>{t('div_ai_remove_none')}</p>}
            <div className="div-actions">{removal.removable.length > 0 && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(async () => {
              const result = await removeDividendRiskStocks(removal.removable.map(stock => stock.code)); await onUpdated();
              const current = await db.dividendStocks.toArray();
              if (mounted.current) { setRemoval(null); setConfiguredStocks(current); setNotice(t('div_ai_removed', { count: result.removable.length })); }
            })}>{t('div_ai_remove_confirm', { count: removal.removable.length })}</button>}
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRemoval(null)}>{t('cancel')}</button></div>
          </div>}
        </details>}
      </div>}
    </section>}
    {error && <p className="div-warning" role="alert">{error}</p>}{notice && <p className="div-advisor-status" role="status">{notice}</p>}
  </div>;
}
