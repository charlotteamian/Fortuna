import DividendGridOrigin from './DividendGridOrigin';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import { defaultDividendSelectionPrinciples, isDividendSelectionPrinciples,
  type DividendResearchSnapshot, type DividendSelectionPrinciples, type DividendStockResearch, type DividendTechnicalResearch } from '../lib/dividendResearch';
import { fetchDividendResearch } from '../services/dividendResearchService';
import { addDividendResearchCandidate, loadDividendSelectionPrinciples, previewDividendRiskRemoval,
  removeDividendRiskStocks, saveDividendSelectionPrinciples, loadDividendPricingMethod, saveDividendPricingMethod } from '../services/dividendAdvisorActionsService';
import type { DividendPricingMethod } from '../lib/dividendPricing';
import type { DividendStock } from '../lib/dividendWorkbench';
import { DividendFinancialReviewCard, DividendPricingCard, DividendPricingEditor, DividendPricingEvidence } from './DividendAdvisorPricing';
import { DividendCandidateError, resolveDividendCandidates } from '../services/dividendCandidateService';
import { dividendResearchScopeStocks, dividendResearchSnapshotForStock, loadDividendResearchCache, loadDividendResearchCollapsePreference, saveDividendResearchCache, saveDividendResearchCollapse, type SavedDividendResearch } from '../services/dividendResearchCacheService';
import DividendAdvisorResumeReview from './DividendAdvisorResumeReview';
import { dateInChina } from '../lib/dividendWorkbench';
import { dividendCheckSummary, type DividendStockCheckSummary } from '../lib/dividendCheckSummary';
import { loadDividendCheckSummaries } from '../services/dividendCheckSummaryService';
import { loadDividendWorkbench } from '../services/dividendService';
import DividendCompactPlan from './DividendCompactPlan';
import DividendReadFilters from './DividendReadFilters';
import { matchesDividendReadFilter, type DividendReadFilter } from '../lib/dividendReading';

type Panel = 'chat' | 'research' | 'principles';
type RemovalPreview = Awaited<ReturnType<typeof previewDividendRiskRemoval>>;
const PRINCIPLE_KEYS = ['minYieldBps', 'minRoeBps', 'minRevenueGrowthBps', 'minProfitGrowthBps', 'maxDebtAssetBps', 'minCashProfitBps', 'minFcfCoverageBps', 'maxPayoutBps', 'minDividendYears'] as const;
/** Saved technical evidence can be partial. Show gaps instead of throwing while rendering. */
const numericText = (value: number | undefined, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
const percent = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';

function TechnicalPosition({ technical }: { technical?: DividendTechnicalResearch }) {
  const { t } = useTranslation();
  if (!technical) return <p className="div-ai-muted">{t('div_ai_trend_unknown')}</p>;
  const pricePrefix = technical.priceBasis === 'index' ? '' : '¥';
  const conclusion = ({ rising: 'rising', range: 'range', falling: 'falling', accelerating_down: 'accelerating_down' } as Record<string, string>)[technical.state];
  const state = technical.currentUsable ? ({ rising: 'up', range: 'sideways', falling: 'down', accelerating_down: 'accelerating_down' } as Record<string, string>)[technical.state] ?? 'unknown' : 'unknown';
  return <div className="div-ai-technical"><p className={`div-ai-status ${technical.pacing === 'pause_add' ? 'risk' : ''}`}>
    {t(`div_ai_trend_${state}`)} · {technical.asOf ?? t('div_check_date_unknown')}</p>
    {technical.currentUsable && conclusion && <p className="div-ai-technical-conclusion">{t(`div_ai_technical_conclusion_${conclusion}`)}</p>}
    {!technical.currentUsable && <p className="div-ai-muted">{t('div_ai_technical_stale')}</p>}
    <dl className="div-ai-metrics"><div><dt>{t(technical.priceBasis === 'index' ? 'div_ai_metric_index_points' : 'div_ai_metric_price')}</dt><dd>{pricePrefix}{numericText(technical.lastCloseMinor === undefined ? undefined : technical.lastCloseMinor / 100)}</dd></div>
      <div><dt>{t('div_ai_metric_ma30')}</dt><dd>{pricePrefix}{numericText(technical.ma30Minor === undefined ? undefined : technical.ma30Minor / 100)}</dd></div>
      <div><dt>{t('div_ai_metric_return5')}</dt><dd>{percent(technical.change5Percent)}</dd></div>
      <div><dt>{t('div_ai_metric_return10')}</dt><dd>{percent(technical.change10Percent)}</dd></div>
      <div><dt>{t('div_ai_metric_drawdown')}</dt><dd>{percent(technical.drawdown60Percent)}</dd></div>
      <div><dt>RSI(6)</dt><dd>{numericText(technical.rsi6, 1)}</dd></div></dl>
    <p className="div-ai-muted">{t(technical.priceBasis === 'index' ? 'div_ai_index_basis' : technical.priceBasis === 'qfq' ? 'div_ai_technical_basis' : 'div_ai_unadjusted_basis')}</p>
  </div>;
}

function StockResearch({ stock, snapshot, savedStock, check: loadedCheck, amountVisible, canAdd, busy, outdated, collapsed, onToggle, onAdd, onDiscuss, onUpdated, onResearchUpdated, onManage, onRetry }: { onRetry: () => void; onManage?: () => void; stock: DividendStockResearch; snapshot: DividendResearchSnapshot; savedStock?: DividendStock; check?: DividendStockCheckSummary; amountVisible: boolean; canAdd: boolean; busy: boolean; outdated: boolean; collapsed: boolean; onToggle: () => void; onAdd: () => void; onDiscuss: () => void; onUpdated: () => Promise<unknown>; onResearchUpdated: (snapshot: DividendResearchSnapshot) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const check = loadedCheck ?? dividendCheckSummary({ stock: savedStock ?? { code: stock.code, name: stock.name, group: 'watch', weightBps: 0, shareMode: 'manual', manualShares: 0, lotSize: 100 },
    research: stock, indices: snapshot.indices, principles: snapshot.principles, pricingMethod: snapshot.pricingMethod,
    basis: { asOf: dateInChina(), verified: false, evidenceStatus: 'missing', evidenceIssues: ['DIVIDEND_LEDGER_MISSING'] }, researchGeneratedAt: snapshot.generatedAt });
  return <article className={`div-ai-research-card ${stock.status}`}><header><span><strong>{stock.name}</strong><small>{stock.code}{savedStock && ` · ${t(`div_group_${savedStock.group}`)}`}</small></span>
    <button type="button" className="btn btn-secondary div-ai-research-toggle" disabled={busy} aria-expanded={!collapsed} aria-controls={`div-ai-stock-${stock.code}`} onClick={onToggle}>{t(collapsed ? 'div_focus_grid_preview' : 'div_ai_research_collapse')}</button></header>
    <DividendCompactPlan summary={check} amountVisible={amountVisible}>
      {amountVisible && <>
      {savedStock && <DividendGridOrigin stock={savedStock} asOf={dateInChina()} check={check} />}
        <div className="div-ai-research-card-body">

          <details><summary>{t('div_ai_research_rules')}</summary><ul className="div-ai-checks">{check.eligibility.checks.map(check => <li key={check.rule}><div><strong>{t(`div_ai_rule_label_${check.rule}`)}</strong>
            <span className={`div-ai-status ${check.status}`}>{t(`div_ai_research_${check.status}`)}</span></div>
            {check.value !== undefined && check.threshold !== undefined && <p>{t('div_ai_research_value', { value: check.rule === 'dividendYears' ? check.value : `${check.value / 100}%`, threshold: check.rule === 'dividendYears' ? check.threshold : `${check.threshold / 100}%` })}</p>}
            {check.period && <p>{t('div_ai_research_period', { period: check.period })}</p>}{check.reason && <p>{t(`div_ai_reason_${check.reason}`)}</p>}
          </li>)}</ul>{!(stock.checks ?? []).length && <p className="div-ai-muted">{t('div_v4_review_empty')}</p>}</details>
          {stock.financial?.sectorReview && <DividendFinancialReviewCard code={stock.code} review={stock.financial.sectorReview} />}
          {stock.pricing && <details><summary>{t('div_classic_title')}</summary><DividendPricingEvidence code={stock.code} pricing={stock.pricing} /></details>}
          <details className="div-ai-evidence-section"><summary>{t('div_ai_research_technical')}</summary><TechnicalPosition technical={stock.technical} />
            {(snapshot.indices ?? []).filter(index => index.code !== 'sz399006').map(index => <section key={index.code}><h4>{index.name}</h4><TechnicalPosition technical={index.technical} /></section>)}
          </details>
          {stock.financial && <details className="div-ai-evidence-section"><summary>{t('div_ai_research_financial')}</summary><p className="div-ai-muted">{stock.financial.sector}</p>
            <ul className="div-ai-periods">{(stock.financial.periods ?? []).slice(0, 4).map(period => {
              const annual = typeof period.reportDate === 'string' && period.reportDate.endsWith('-12-31');
              const roe = period.annualizedRoeBps ?? (annual ? period.roeBps : undefined);
              return <li key={period.reportDate}><strong>{period.reportDate}</strong>
              <p>{t('div_ai_financial_period_v5', { revenue: period.revenueGrowthBps === undefined ? '—' : `${period.revenueGrowthBps / 100}%`, profit: period.profitGrowthBps === undefined ? '—' : `${period.profitGrowthBps / 100}%`,
                roe: roe === undefined ? '—' : `${roe / 100}%`, roeLabel: t(annual ? 'div_ai_financial_roe_annual' : period.roeBasis === 'annualised_ytd' && roe !== undefined ? 'div_ai_financial_roe_annualised' : 'div_ai_financial_roe_unverified') })}</p>
              {!annual && period.roeBasis === 'annualised_ytd' && period.roePeriodMonths && period.roeBps !== undefined && roe !== undefined && <p>{t('div_ai_financial_roe_annualised_help', { months: period.roePeriodMonths, reported: `${period.roeBps / 100}%`, annualised: `${roe / 100}%` })}</p>}
              {period.noticeDate && <small>{t('div_ai_financial_published', { date: period.noticeDate })}</small>}
            </li>; })}</ul></details>}
          {(stock.issues ?? []).length > 0 && <details className="div-ai-evidence-section"><summary>{t('div_ai_research_sources')}</summary><ul className="div-ai-sources">{(stock.sources ?? []).map((source, index) => <li key={index}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">{source.provider} · {t(`div_ai_source_${source.kind}`)}</a><small>{source.asOf ?? new Date(source.fetchedAt).toLocaleDateString()}</small>
          </li>)}</ul><ul className="div-ai-fetch-issues">{(stock.issues ?? []).map((issue, index) => <li key={index}><strong>{t(`div_ai_source_${issue.kind}`)} · {t(`div_ai_issue_${issue.reason}`)}</strong>
            {issue.attempts !== undefined && <span>{t('div_ai_issue_attempts', { count: issue.attempts })}</span>}{issue.detail && <code>{issue.detail}</code>}
            <p>{t(`div_ai_issue_help_${issue.kind}`)}</p>{issue.url?.startsWith('https://') && <a href={issue.url} target="_blank" rel="noopener noreferrer">{t('div_ai_issue_open_failed_source')}</a>}
          </li>)}</ul></details>}

          {(stock.status === 'unknown' || (stock.issues ?? []).length > 0) && <details><summary>{t('div_ai_evidence_help_title')}</summary><div className="div-ai-evidence-help"><strong>{t('div_ai_evidence_help_title')}</strong><p>{t('div_ai_evidence_help_detail')}</p><div className="div-ai-help-links">
            <a href={`https://data.eastmoney.com/stockdata/${stock.code}.html`} target="_blank" rel="noopener noreferrer">{t('div_ai_open_financial_source')}</a><a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener noreferrer">{t('div_ai_open_company_reports')}</a>
          </div></div></details>}
          {savedStock?.buyPaused && <DividendAdvisorResumeReview stock={stock} disabled={busy} onUpdated={onUpdated} onResearchUpdated={onResearchUpdated} />}
          <div className="div-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={onDiscuss}>{t('div_ai_discuss_stock')}</button></div>
        </div>
      </>}
    </DividendCompactPlan>
    <div className="div-focus-card-actions">
      {onManage && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onManage}>{t('div_focus_manage')}</button>}
      {canAdd && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onAdd}>{t('div_ai_add_watch')}</button>}
    </div>
    <div id={`div-ai-stock-${stock.code}`} hidden={collapsed || !amountVisible}>
      {outdated && <p className="div-warning">{t('div_ai_research_outdated')}</p>}
      <p className="div-ai-stock-checked div-ai-muted">{t('div_ai_research_stock_checked', { time: new Date(snapshot.generatedAt).toLocaleString(i18n.language) })}</p>
      {canAdd && <div className="div-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onAdd}>{t('div_ai_add_watch')}</button><span className="div-ai-muted">{t('div_check_join_to_save')}</span></div>}
      {stock.pricing ? <DividendPricingCard key={snapshot.generatedAt} retryDisabled={busy} onRetry={onRetry} onResearchUpdated={onResearchUpdated} check={check} code={stock.code} pricing={stock.pricing} method={snapshot.pricingMethod} generatedAt={snapshot.generatedAt} disabled={busy || canAdd || outdated} onUpdated={onUpdated} />
        : <p className="div-ai-stock-checked div-ai-muted">{t('div_check_grid_missing')}</p>}
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
  const mounted = useRef(false);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    setCheckSummaries({});
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
    return () => { active = false; mounted.current = false; };
  }, [t]);

  const run = async (job: () => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await job(); }
    catch (cause) { if (mounted.current) setError(cause instanceof DividendCandidateError
      ? t(`div_ai_candidate_${cause.reason}`, { query: cause.query, matches: cause.matches.map(stock => `${stock.name} ${stock.code}`).join('、') })
      : t(cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError') ? 'div_experience_repair_timeout'
        : cause instanceof Error && cause.message === 'INVALID_RESEARCH_CODES' ? 'div_ai_invalid_codes' : cause instanceof Error && cause.message === 'RESEARCH_CACHE_SAVE_FAILED' ? 'div_ai_research_save_failed' : 'div_ai_action_error')); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); setResearchProgress(null); } }
  };
  const notifyUpdated = async () => {
    await onUpdated();
    const current = await db.dividendStocks.toArray();
    if (mounted.current) setConfiguredStocks(current);
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
  const isOutdated = (value: DividendResearchSnapshot) => JSON.stringify(value.principles) !== JSON.stringify(principles)
    || JSON.stringify(value.pricingMethod) !== JSON.stringify(pricingMethod)
    || dateInChina(new Date(value.generatedAt)) !== dateInChina();
  const outdated = !!savedResearch && visibleStocks.some(stock => isOutdated(dividendResearchSnapshotForStock(savedResearch, stock.code)));
  const onResearchUpdated = async (value: DividendResearchSnapshot) => {
    const current = await db.dividendStocks.toArray();
    const saved = await saveDividendResearchCache({ snapshot: value, scope: savedResearch?.scope ?? 'plan', candidateInput: savedResearch?.candidateInput ?? codes,
      reviewedCodes: savedResearch?.reviewedCodes, collapsedCodes: savedResearch?.collapsedCodes ?? value.stocks.map(stock => stock.code) });
    if (mounted.current) { setSavedResearch(saved); setRestored(false); setConfiguredStocks(current); }
  };
  const repairStock = (stock: DividendStockResearch) => void run(async () => {
    if (mounted.current) setResearchProgress({ done: 0, total: 1 });
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
      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => research('plan')}>{t('div_experience_repair_all')}</button></div><p className="div-ai-muted div-repair-note">{t('div_experience_repair_note')}</p>
      <details className="div-ai-candidate-search"><summary>{t('div_ai_screen_candidates')}</summary><label htmlFor="div-ai-candidates">{t('div_ai_candidate_codes')}</label>
        <textarea className="form-input" id="div-ai-candidates" value={codes} rows={2} maxLength={400} disabled={busy}
          placeholder={t('div_ai_candidate_placeholder')} onChange={event => setCodes(event.target.value)} />
        <p className="div-ai-muted">{t('div_ai_candidate_review_only')}</p>
        <button type="button" className="btn btn-secondary" disabled={!ready || busy || !codes.trim()} onClick={() => research('candidates')}>{t('div_ai_screen_candidates')}</button></details>
      {working && <p className="div-advisor-status" role="status">{researchProgress ? t('div_experience_repair_progress', researchProgress) : t('div_ai_research_loading')}</p>}
      {snapshot && !amountVisible && <p className="div-advisor-hidden">{t('div_ai_reading_hidden')}</p>}
      <div className="div-focus-selection-tools"><input type="search" className="form-input" value={search} aria-label={t('div_search')} placeholder={t('div_search')} onChange={event => setSearch(event.target.value)} />
        <DividendReadFilters value={readFilter} onChange={setReadFilter} /></div>
      <div className="div-ai-research-results">{configuredStocks.filter(stock => !visibleCodes.has(stock.code) && matchesSearch(stock) && matchesDividendReadFilter(checkSummaries[stock.code], readFilter)).map(stock => {
        const check = checkSummaries[stock.code];
        return <article key={stock.code} className="div-ai-research-card div-focus-saved-stock"><header><span><strong>{stock.name}</strong><small>{stock.code} · {t(`div_group_${stock.group}`)}</small></span>
          </header>
          {check ? <DividendCompactPlan summary={check} amountVisible={amountVisible} /> : <p className="div-ai-muted">{t('loading')}</p>}
          <div className="div-focus-card-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onManageStock?.(stock.code)}>{t('div_focus_manage')}</button></div>
        </article>;
      })}</div>
      {snapshot && <div className="div-ai-research-results">{visibleStocks.length > 0 && <p className="div-ai-muted">{t('div_ai_research_checked', { time: new Date(snapshot.generatedAt).toLocaleString(i18n.language) })}</p>}
        <p className="div-ai-muted">{t(savedResearch?.scope === 'candidates' ? 'div_ai_research_candidate_results' : 'div_ai_research_plan_results')}</p>
        {restored && <p className="div-ai-muted">{t('div_ai_research_restored')}</p>}
        {outdated && <p className="div-warning">{t('div_ai_research_outdated')}</p>}
        {savedResearch?.scope === 'candidates' && <button type="button" className="btn btn-secondary" disabled={!ready || busy} onClick={() => research('candidates', true)}>{t('div_ai_refresh_candidates')}</button>}
        {!visibleStocks.length && <p className="div-ai-muted">{t('div_ai_research_no_stocks')}</p>}
        {visibleStocks.filter(stock => matchesSearch(stock) && matchesDividendReadFilter(checkSummaries[stock.code], readFilter)).map(stock => {
          const stockSnapshot = dividendResearchSnapshotForStock(savedResearch!, stock.code);
          return <StockResearch onRetry={() => repairStock(stock)} key={stock.code} amountVisible={amountVisible} check={checkSummaries[stock.code]} stock={stock} snapshot={stockSnapshot} onUpdated={notifyUpdated} onResearchUpdated={onResearchUpdated} onManage={onManageStock && configuredStocks.some(current => current.code === stock.code) ? () => onManageStock(stock.code) : undefined} savedStock={configuredStocks.find(current => current.code === stock.code)} canAdd={!configuredStocks.some(current => current.code === stock.code)} busy={busy} outdated={isOutdated(stockSnapshot)} collapsed={savedResearch?.collapsedCodes?.includes(stock.code) ?? true} onToggle={() => toggleStock(stock.code)} onDiscuss={() => onDiscuss(stock, stockSnapshot)} onAdd={() => void run(async () => {
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
