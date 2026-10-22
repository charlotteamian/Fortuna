import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import { defaultDividendSelectionPrinciples, isDividendSelectionPrinciples, parseDividendResearchCodes,
  type DividendResearchSnapshot, type DividendSelectionPrinciples, type DividendStockResearch, type DividendTechnicalResearch } from '../lib/dividendResearch';
import { fetchDividendResearch, defaultDividendResearchCandidates } from '../services/dividendResearchService';
import { addDividendResearchCandidate, loadDividendSelectionPrinciples, previewDividendRiskRemoval,
  removeDividendRiskStocks, saveDividendSelectionPrinciples, loadDividendPricingMethod, saveDividendPricingMethod } from '../services/dividendAdvisorActionsService';
import type { DividendPricingMethod } from '../lib/dividendPricing';
import type { DividendStock } from '../lib/dividendWorkbench';
import { DividendFinancialReviewCard, DividendPricingCard, DividendPricingEditor } from './DividendAdvisorPricing';
import { dividendResearchAdvice } from '../lib/dividendResearchAdvice';

type Panel = 'chat' | 'research' | 'principles';
type RemovalPreview = Awaited<ReturnType<typeof previewDividendRiskRemoval>>;
const PRINCIPLE_KEYS = ['minYieldBps', 'minRoeBps', 'minRevenueGrowthBps', 'minProfitGrowthBps', 'maxDebtAssetBps', 'minCashProfitBps', 'minFcfCoverageBps', 'maxPayoutBps', 'minDividendYears'] as const;
const percent = (value: number) => `${value.toFixed(2)}%`;

function TechnicalPosition({ technical }: { technical?: DividendTechnicalResearch }) {
  const { t } = useTranslation();
  if (!technical) return <p className="div-ai-muted">{t('div_ai_trend_unknown')}</p>;
  const pricePrefix = technical.priceBasis === 'index' ? '' : '¥';
  const state = technical.currentUsable ? { rising: 'up', range: 'sideways', falling: 'down', accelerating_down: 'accelerating_down' }[technical.state] : 'unknown';
  return <div className="div-ai-technical"><p className={`div-ai-status ${technical.pacing === 'pause_add' ? 'risk' : ''}`}>
    {t(`div_ai_trend_${state}`)} · {technical.asOf}</p>
    {technical.currentUsable && <p className="div-ai-technical-conclusion">{t(`div_ai_technical_conclusion_${technical.state}`)}</p>}
    {!technical.currentUsable && <p className="div-ai-muted">{t('div_ai_technical_stale')}</p>}
    <dl className="div-ai-metrics"><div><dt>{t(technical.priceBasis === 'index' ? 'div_ai_metric_index_points' : 'div_ai_metric_price')}</dt><dd>{pricePrefix}{(technical.lastCloseMinor / 100).toFixed(2)}</dd></div>
      <div><dt>{t('div_ai_metric_ma30')}</dt><dd>{pricePrefix}{(technical.ma30Minor / 100).toFixed(2)}</dd></div>
      <div><dt>{t('div_ai_metric_return5')}</dt><dd>{percent(technical.change5Percent)}</dd></div>
      <div><dt>{t('div_ai_metric_return10')}</dt><dd>{percent(technical.change10Percent)}</dd></div>
      <div><dt>{t('div_ai_metric_drawdown')}</dt><dd>{percent(technical.drawdown60Percent)}</dd></div>
      <div><dt>RSI(6)</dt><dd>{technical.rsi6.toFixed(1)}</dd></div></dl>
    <p className="div-ai-muted">{t(technical.priceBasis === 'index' ? 'div_ai_index_basis' : technical.priceBasis === 'qfq' ? 'div_ai_technical_basis' : 'div_ai_unadjusted_basis')}</p>
  </div>;
}

function StockConclusion({ stock, snapshot }: { stock: DividendStockResearch; snapshot: DividendResearchSnapshot }) {
  const { t } = useTranslation();
  const advice = dividendResearchAdvice(stock, snapshot.indices, snapshot.principles.notes);
  const yuan = (value?: number) => value === undefined ? '—' : `¥${(value / 100).toFixed(2)}`;
  const labels = (rules: typeof advice.failedRules) => rules.map(rule => t(`div_ai_rule_label_${rule}`)).join('、');
  return <div className={`div-ai-conclusion ${advice.decision}`}><p className="div-ai-conclusion-label">{t('div_ai_conclusion_label')}</p>
    <h3>{t(`div_ai_decision_${advice.decision}`)}</h3>
    <p>{t(`div_ai_decision_${advice.decision}_detail`, { price: yuan(advice.currentPriceMinor), margin: yuan(advice.marginPriceMinor) })}</p>
    {advice.failedRules.length > 0 && <p>{t('div_ai_conclusion_failed', { rules: labels(advice.failedRules) })}</p>}
    {advice.missingRules.length > 0 && <p>{t('div_ai_conclusion_missing', { rules: labels(advice.missingRules) })}</p>}
    {advice.pricingBlockers.length > 0 && <p>{t('div_ai_conclusion_pricing', { reasons: advice.pricingBlockers.slice(0, 2).map(blocker => t(`div_v2_pricing_gap_${blocker}`)).join(' ') })}</p>}
    {advice.technicalMissing && <p>{t('div_ai_conclusion_technical_missing')}</p>}
    {advice.marketPacing !== 'observe' && <p>{t(`div_ai_conclusion_market_${advice.marketPacing}`)}</p>}
    {advice.marketMissing && <p>{t('div_ai_conclusion_market_missing')}</p>}
    {advice.additionalRulesUnverified && <p>{t('div_ai_conclusion_additional_rules')}</p>}
    <p className="div-ai-conclusion-next"><strong>{t('div_ai_conclusion_next')}</strong>{t(`div_ai_decision_${advice.decision}_next`)}</p>
  </div>;
}

function StockResearch({ stock, snapshot, canAdd, busy, onAdd, onDiscuss, onUpdated }: { stock: DividendStockResearch; snapshot: DividendResearchSnapshot; canAdd: boolean; busy: boolean; onAdd: () => void; onDiscuss: () => void; onUpdated: () => Promise<unknown> }) {
  const { t } = useTranslation();
  return <article className={`div-ai-research-card ${stock.status}`}><header><span><strong>{stock.name}</strong><small>{stock.code}</small></span>
    <span className={`div-ai-status ${stock.status}`}>{t(`div_ai_research_${stock.status}`)}</span></header>
    <StockConclusion stock={stock} snapshot={snapshot} />
    {stock.financial?.sectorReview && <DividendFinancialReviewCard code={stock.code} review={stock.financial.sectorReview} />}
    <details className="div-ai-research-details"><summary>{t('div_ai_research_details')}</summary>
    <div className="div-ai-research-card-body"><details><summary>{t('div_ai_research_rules')}</summary>
      <ul className="div-ai-checks">{stock.checks.map(check => <li key={check.rule}><div><strong>{t(`div_ai_rule_label_${check.rule}`)}</strong>
        <span className={`div-ai-status ${check.status}`}>{t(`div_ai_research_${check.status}`)}</span></div>
        {check.value !== undefined && check.threshold !== undefined && <p>{t('div_ai_research_value', { value: check.rule === 'dividendYears' ? check.value : `${check.value / 100}%`, threshold: check.rule === 'dividendYears' ? check.threshold : `${check.threshold / 100}%` })}</p>}
        {check.period && <p>{t('div_ai_research_period', { period: check.period })}</p>}
        {check.reason && <p>{t(`div_ai_reason_${check.reason}`)}</p>}
      </li>)}</ul></details>
      {stock.pricing && <DividendPricingCard code={stock.code} pricing={stock.pricing} disabled={busy || canAdd} onUpdated={onUpdated} />}
      <details open><summary>{t('div_ai_research_technical')}</summary><TechnicalPosition technical={stock.technical} /></details>
      {stock.financial && <details><summary>{t('div_ai_research_financial')}</summary><p className="div-ai-muted">{stock.financial.sector}</p>
        <ul className="div-ai-periods">{stock.financial.periods.slice(0, 4).map(period => <li key={period.reportDate}>
          <strong>{period.reportDate}</strong><p>{t('div_ai_financial_period', { revenue: period.revenueGrowthBps === undefined ? '—' : `${period.revenueGrowthBps / 100}%`, profit: period.profitGrowthBps === undefined ? '—' : `${period.profitGrowthBps / 100}%`, roe: period.roeBps === undefined ? '—' : `${period.roeBps / 100}%` })}</p>
          {period.noticeDate && <small>{t('div_ai_financial_published', { date: period.noticeDate })}</small>}
        </li>)}</ul></details>}
      <details><summary>{t('div_ai_research_sources')}</summary><ul className="div-ai-sources">{stock.sources.map((source, index) => <li key={index}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">{source.provider} · {t(`div_ai_source_${source.kind}`)}</a><small>{source.asOf ?? new Date(source.fetchedAt).toLocaleDateString()}</small>
      </li>)}</ul>{stock.issues.length > 0 && <ul className="div-ai-fetch-issues">{stock.issues.map((issue, index) => <li key={index}><strong>{t(`div_ai_source_${issue.kind}`)} · {t(`div_ai_issue_${issue.reason}`)}</strong>
        {issue.attempts !== undefined && <span>{t('div_ai_issue_attempts', { count: issue.attempts })}</span>}
        {issue.detail && <code>{issue.detail}</code>}
        <p>{t(`div_ai_issue_help_${issue.kind}`)}</p>
        {issue.url?.startsWith('https://') && <a href={issue.url} target="_blank" rel="noopener noreferrer">{t('div_ai_issue_open_failed_source')}</a>}
      </li>)}</ul>}</details>
      {(stock.status === 'unknown' || stock.issues.length > 0) && <div className="div-ai-evidence-help"><strong>{t('div_ai_evidence_help_title')}</strong><p>{t('div_ai_evidence_help_detail')}</p><div className="div-ai-help-links">
        <a href={`https://data.eastmoney.com/stockdata/${stock.code}.html`} target="_blank" rel="noopener noreferrer">{t('div_ai_open_financial_source')}</a>
        <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener noreferrer">{t('div_ai_open_company_reports')}</a>
      </div></div>}
      <div className="div-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={onDiscuss}>{t('div_ai_discuss_stock')}</button>
        {canAdd && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onAdd}>{t('div_ai_add_watch')}</button>}</div>
    </div></details></article>;
}

export default function DividendAdvisorWorkspace({ activePanel, amountVisible, onUpdated, onDiscuss, disabled = false }: { activePanel: Panel; amountVisible: boolean; onUpdated: () => Promise<unknown>; disabled?: boolean;
  onDiscuss: (stock: DividendStockResearch, snapshot: DividendResearchSnapshot) => void }) {
  const { t, i18n } = useTranslation();
  const [principles, setPrinciples] = useState<DividendSelectionPrinciples>(defaultDividendSelectionPrinciples);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pricingMethod, setPricingMethod] = useState<DividendPricingMethod | null>(null);
  const [working, setBusy] = useState(false);
  const busy = working || disabled;
  const [snapshot, setSnapshot] = useState<DividendResearchSnapshot | null>(null);
  const [scope, setScope] = useState<'plan' | 'candidates'>('plan');
  const [codes, setCodes] = useState('');
  const [configuredCodes, setConfiguredCodes] = useState<string[]>([]);
  const [configuredStocks, setConfiguredStocks] = useState<Pick<DividendStock, 'code' | 'name'>[]>([]);
  const [removal, setRemoval] = useState<RemovalPreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    void db.dividendStocks.toArray().then(stocks => { if (active) setConfiguredStocks(stocks); })
      .catch(() => { if (active) setError(t('div_ai_error_storage')); });
    return () => { active = false; };
  }, [activePanel, t]);

  useEffect(() => {
    let active = true; mounted.current = true;
    void Promise.all([loadDividendSelectionPrinciples(), loadDividendPricingMethod()]).then(([value, method]) => { if (active) { setPrinciples(value); setPricingMethod(method); setReady(true); } })
      .catch(() => { if (active) setError(t('div_ai_error_storage')); });
    return () => { active = false; mounted.current = false; };
  }, [t]);

  const run = async (job: () => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await job(); }
    catch (cause) { if (mounted.current) setError(t(cause instanceof Error && cause.message === 'INVALID_RESEARCH_CODES' ? 'div_ai_invalid_codes' : 'div_ai_action_error')); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const research = (selected: 'plan' | 'candidates') => void run(async () => {
    const current = await db.dividendStocks.toArray();
    const stocks = selected === 'plan' ? current.map(({ code, name }) => ({ code, name })) : codes.trim()
      ? parseDividendResearchCodes(codes).map(code => ({ code, name: code })) : defaultDividendResearchCandidates();
    if (!stocks.length) { setNotice(t('div_ai_research_no_stocks')); return; }
    setRemoval(null);
    const value = await fetchDividendResearch(stocks, principles, { ...(pricingMethod ? { pricingMethod } : {}) });
    if (!mounted.current) return;
    setSnapshot(value); setScope(selected); setConfiguredCodes(current.map(stock => stock.code));
  });
  const savePrinciples = () => void run(async () => {
    const numeric = Object.fromEntries(PRINCIPLE_KEYS.map(key => [key, Number(draft?.[key] ?? (key === 'minDividendYears' ? principles[key] : (principles[key] ?? 15000) / 100)) * (key === 'minDividendYears' ? 1 : 100)]));
    for (const key of PRINCIPLE_KEYS) numeric[key] = Math.round(numeric[key] * 1e8) / 1e8;
    const value = { ...numeric, notes: notesDraft ?? principles.notes ?? '' };
    if (PRINCIPLE_KEYS.some(key => draft?.[key] === '') || !isDividendSelectionPrinciples(value)) { setError(t('div_ai_principles_invalid')); return; }
    await saveDividendSelectionPrinciples(value);
    if (mounted.current) { setPrinciples(value); setDraft(null); setNotesDraft(null); setSnapshot(null); setRemoval(null); setNotice(t('div_ai_principles_saved')); }
  });
  const riskCodes = scope === 'plan' ? snapshot?.stocks.filter(stock => stock.checks.some(check => check.status === 'risk')).map(stock => stock.code) ?? [] : [];

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
          await saveDividendPricingMethod(value); if (mounted.current) { setPricingMethod(value); setSnapshot(null); setRemoval(null); setNotice(t('div_v2_pricing_saved')); }
        })} />
      </details>}</section>}
    {activePanel === 'research' && <section><h2 className="div-ai-panel-title">{t('div_ai_tab_research')}</h2><p className="div-ai-muted">{t('div_ai_research_intro')}</p>
      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => research('plan')}>{t('div_ai_check_plan')}</button>
      <details className="div-ai-candidate-search"><summary>{t('div_ai_screen_candidates')}</summary><label htmlFor="div-ai-candidates">{t('div_ai_candidate_codes')}</label>
        <textarea className="form-input" id="div-ai-candidates" value={codes} rows={2} maxLength={240} disabled={busy}
          placeholder={t('div_ai_candidate_placeholder')} onChange={event => setCodes(event.target.value)} />
        <button type="button" className="btn btn-secondary" disabled={!ready || busy} onClick={() => research('candidates')}>{t('div_ai_screen_candidates')}</button></details>
      {working && <p className="div-advisor-status" role="status">{t('div_ai_research_loading')}</p>}
      {snapshot && !amountVisible && <p className="div-advisor-hidden">{t('div_ai_reading_hidden')}</p>}
      {snapshot && amountVisible && <div className="div-ai-research-results"><p className="div-ai-muted">{t('div_ai_research_checked', { time: new Date(snapshot.generatedAt).toLocaleString(i18n.language) })}</p>
        {snapshot.stocks.map(stock => <StockResearch key={stock.code} stock={stock} snapshot={snapshot} onUpdated={onUpdated} canAdd={scope === 'candidates' && !configuredCodes.includes(stock.code)} busy={busy} onDiscuss={() => onDiscuss(stock, snapshot)} onAdd={() => void run(async () => {
          await addDividendResearchCandidate(stock.code, stock.name); await onUpdated();
          if (mounted.current) { setConfiguredCodes(current => [...current, stock.code]); setNotice(t('div_ai_added_watch')); }
        })} />)}
        {riskCodes.length > 0 && <div className="div-ai-removal"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(async () => {
          const preview = await previewDividendRiskRemoval(riskCodes); if (mounted.current) setRemoval(preview);
        })}>{t('div_ai_review_remove')}</button>
          {removal && <div className="div-ai-confirm"><p>{t('div_ai_remove_intro')}</p>
            {removal.removable.map(stock => <p key={stock.code}>{stock.name} · {stock.code}</p>)}
            {removal.protected.map(stock => <p className="div-ai-muted" key={stock.code}>{stock.name} · {t('div_ai_remove_protected')}</p>)}
            {!removal.removable.length && <p>{t('div_ai_remove_none')}</p>}
            <div className="div-actions">{removal.removable.length > 0 && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(async () => {
              const result = await removeDividendRiskStocks(removal.removable.map(stock => stock.code)); await onUpdated();
              if (mounted.current) { setRemoval(null); setSnapshot(null); setNotice(t('div_ai_removed', { count: result.removable.length })); }
            })}>{t('div_ai_remove_confirm', { count: removal.removable.length })}</button>}
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setRemoval(null)}>{t('cancel')}</button></div>
          </div>}
        </div>}
      </div>}
    </section>}
    {error && <p className="div-warning" role="alert">{error}</p>}{notice && <p className="div-advisor-status" role="status">{notice}</p>}
  </div>;
}
