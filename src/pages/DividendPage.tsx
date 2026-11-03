import { loadDividendCheckSummaries } from '../services/dividendCheckSummaryService';
import { loadDividendFundPositions } from '../services/dividendAdvisorContextService';
import { dividendCheckSummary } from '../lib/dividendCheckSummary';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUY_LEVELS, SELL_LEVELS, dateInChina, latestReportDividend, forecastHoldingYearDividends, fundedDividendStocks, mainlandCode, redistributeDividendWeights, scaleDividendWeights, sortDividendStocks, stockBudgetMinor, type DividendStock, type GridLevel, type LinkedDividendPosition } from '../lib/dividendWorkbench';
import { addLinkedDividendStocks, allocateDividendBudget, deleteDividendStock, dividendStockEditFingerprint, loadDividendWorkbench, refreshDividendStocks, saveDividendBudget, saveDividendHomeCollapse, saveDividendStock, saveDividendStockGroup, saveDividendStockWeight } from '../services/dividendService';
import DividendImportDialog from '../components/DividendImportDialog';
import DividendFundWorkbench from '../components/DividendFundWorkbench';
import DividendFundHomePlan from '../components/DividendFundHomePlan';
import DividendAdvisor from '../components/DividendAdvisor';
import DividendHomePlan from '../components/DividendHomePlan';
import DividendCompactPlan from '../components/DividendCompactPlan';
import DividendGridOrigin from '../components/DividendGridOrigin';
import DividendReadFilters from '../components/DividendReadFilters';
import { dividendHomeCollapsed, matchesDividendReadFilter, type DividendReadFilter } from '../lib/dividendReading';
import DividendCheckStatus from '../components/DividendCheckStatus';
import DividendPlanGrid from '../components/DividendPlanGrid';
import { saveDividendStrategy } from '../services/dividendFundService';
import type { DividendStrategy } from '../lib/dividendFundPlan';
import { isExchangeTradedFundCode } from '../lib/dividendQuote';
import { useDividendQuotes } from '../hooks/useDividendQuotes';
import { loadDividendDailyAdvicePlanKey } from '../services/dividendDailyAdviceScopeService';
import './DividendPage.css';
import type { DividendDailyItem } from '../lib/dividendDailyCheck';
import { dividendBackgroundRefreshPaused } from '../services/dividendRequestControl';

type Workbench = Awaited<ReturnType<typeof loadDividendWorkbench>>;
const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

export default function DividendPage() {
  const { t } = useTranslation();
  const [amountVisible, setAmountVisible] = useState(true);
  const [data, setData] = useState<Workbench | null>(null);
  const [dailyPlanKey, setDailyPlanKey] = useState('');
  const [checks, setChecks] = useState<Awaited<ReturnType<typeof loadDividendCheckSummaries>>>({ stocks: {}, funds: {} });
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const [linkedPickerOpen, setLinkedPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationResult, setAllocationResult] = useState<{ before: DividendStock[]; after: DividendStock[] } | null>(null);
  const allocationResultRef = useRef<HTMLElement>(null);
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [readFilter, setReadFilter] = useState<DividendReadFilter>('all');
  const [collapsedCodes, setCollapsedCodes] = useState<string[]>([]);
  const collapseLoaded = useRef(false);
  const collapseState = useRef<string[]>([]);
  const [managerSearch, setManagerSearch] = useState('');
  const [focusedPlanCode, setFocusedPlanCode] = useState('');
  const [openPlanRequest, setOpenPlanRequest] = useState(0);
  const scrolledPlanRequest = useRef(0);
  const [groupSaving, setGroupSaving] = useState(false);
  const [editor, setEditor] = useState<DividendStock | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const savedBudget = useRef<number | null | undefined>(undefined);
  const loadId = useRef(0);
  const load = useCallback(async () => {
    const id = ++loadId.current;
    const next = await loadDividendWorkbench();
    const fundPositions = await loadDividendFundPositions(next.fundPlan.funds);
    const inspection = await loadDividendCheckSummaries(next, { fundPositions });
    const planKey = await loadDividendDailyAdvicePlanKey(next, inspection);
    if (alive.current && id === loadId.current) {
      setData(next); setChecks(inspection);
      setDailyPlanKey(planKey);
      if (!collapseLoaded.current) {
        collapseLoaded.current = true; collapseState.current = next.collapsedCodes; setCollapsedCodes(next.collapsedCodes);
      }
      const budget = next.budgetConfigured ? next.budgetMinor : null;
      if (savedBudget.current !== budget) { savedBudget.current = budget; setBudgetInput(budget === null ? '' : String(budget / 100)); }
    }
    return next;
  }, []);
  useEffect(() => {
    alive.current = true;
    void load().catch(() => { if (alive.current) setError(t('div_load_error')); });
    const onFocus = () => { void load().catch(() => setError(t('div_load_error'))); };
    window.addEventListener('focus', onFocus);
    return () => { alive.current = false; window.removeEventListener('focus', onFocus); };
  }, [load, t]);
  useEffect(() => { allocationResultRef.current?.scrollIntoView({ block: 'start' }); }, [allocationResult]);
  const quoteTargets = data ? [...data.stocks.map(stock => stock.code), ...data.fundPlan.funds
    .filter(fund => isExchangeTradedFundCode(fund.code)).map(fund => `${fund.id}:${fund.code}`)].sort().join(',') : '';
  const quotes = useDividendQuotes(quoteTargets, load, busy);
  const automaticDisclosureDay = useRef('');
  useEffect(() => {
    const day = dateInChina();
    if (!data || window.location.hash === '#/dividend/advice' || automaticDisclosureDay.current === day || busy.current || quotes.refreshing || dividendBackgroundRefreshPaused()) return;
    automaticDisclosureDay.current = day;
    const codes = [...data.stocks].sort((a,b) => Number(data.positions.has(b.code))-Number(data.positions.has(a.code)) || b.weightBps-a.weightBps)
      .filter(stock => stock.dividend?.schemaVersion !== 2 || stock.dividend.asOf !== day || stock.dividendFailedAt !== undefined).map(stock=>stock.code);
    if (!codes.length) return;
    busy.current = true;setProgress({done:0,total:codes.length});
    void refreshDividendStocks(codes,(done,total)=>{if (alive.current) setProgress({done,total});})
      .then(async()=>{await load();}).catch(()=>{if (alive.current) setError(t('div_load_error'));})
      .finally(()=>{busy.current=false;if (alive.current) setProgress(null);});
  },[data,quotes.refreshing,load,t]);
  const money = (minor: number) => amountVisible ? `¥${numeric(minor / 100)}` : '••••';
  const quantity = (shares: number) => amountVisible ? numeric(shares, 4) : '••••';
  const refresh = async (codes: string[]) => {
    if (busy.current || quotes.refreshing || dividendBackgroundRefreshPaused()) return;
    busy.current = true; setProgress({ done: 0, total: codes.length }); setError(''); setMessage('');
    try {
      const result = await refreshDividendStocks(codes, (done, total) => { if (alive.current) setProgress({ done, total }); });
      await load(); if (alive.current) setMessage(t(result.failed ? 'div_refresh_result' : 'div_refresh_success', result));
    } catch { if (alive.current) setError(t('div_load_error')); }
    finally { busy.current = false; if (alive.current) setProgress(null); }
  };
  const persistBudget = async () => {
    if (budgetSaving) return;
    const amount = Number(budgetInput.replace(/,/g, ''));
    if (!budgetInput.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1e12) { setError(t('div_invalid_budget')); return; }
    setBudgetSaving(true);
    try {
      const budget = Math.round(amount * 100); await saveDividendBudget(budget); await load(); setAllocationResult(null);
      if (alive.current) { setBudgetInput(String(budget / 100)); setError(''); setMessage(t('div_saved')); }
    } catch { if (alive.current) setError(t('div_save_error')); }
    finally { if (alive.current) setBudgetSaving(false); }
  };
  if (!data) return <div role="status">{error || t('loading')}</div>;
  const changeStrategy = async (strategy: DividendStrategy) => {
    if (strategySaving) return;
    setStrategySaving(true); setError('');
    try { await saveDividendStrategy(strategy); await load(); setMessage(''); }
    catch { setError(t('div_save_error')); }
    finally { setStrategySaving(false); }
  };
  const changeStockGroup = async (code: string, value: DividendStock['group']) => {
    if (groupSaving) return;
    setGroupSaving(true); setError('');
    try { await saveDividendStockGroup(code, value); await load(); setMessage(t('div_saved')); }
    catch { setError(t('div_save_error')); }
    finally { setGroupSaving(false); }
  };
  const removeStock = async (code: string) => {
    if (busy.current) return;
    const before = data.stocks;
    const hadWeight = before.some(stock => stock.code === code && stock.weightBps > 0);
    busy.current = true; setError('');
    try {
      await deleteDividendStock(code, true);
      const next = await load();
      setAllocationResult(hadWeight ? { before, after: next.stocks } : null);
      setMessage(t(hadWeight ? 'div_deleted_redistributed' : 'div_deleted_unallocated'));
    } catch (cause) {
      setError(t(cause instanceof Error && cause.message === 'DIVIDEND_STOCK_HELD' ? 'div_v2_held_delete_blocked' : 'div_save_error'));
    } finally { busy.current = false; }
  };
  const openStockPlan = async (code: string) => {
    if (data.strategy !== 'stocks') await changeStrategy('stocks');
    setManagerSearch(''); setFocusedPlanCode(code); setOpenPlanRequest(value => value + 1);
  };
  const openFundPlan = async () => {
    if (data.strategy !== 'funds') await changeStrategy('funds');
    setFocusedPlanCode(''); setOpenPlanRequest(value => value + 1);
  };
  const toggleStock = (code: string) => {
    const collapsed = !dividendHomeCollapsed(code, collapseState.current);
    const key = code.startsWith('fund:') ? `open:${code}` : code;
    const next = (code.startsWith('fund:') ? !collapsed : collapsed) ? [...collapseState.current, key] : collapseState.current.filter(value => value !== key);
    collapseState.current = next; setCollapsedCodes(next);
    void saveDividendHomeCollapse(code, collapsed).catch(() => { if (alive.current) setError(t('div_save_error')); });
  };
  const openCheckItem = async (item: DividendDailyItem) => {
    const strategy = item.kind === 'stock' ? 'stocks' : 'funds';
    if (data.strategy !== strategy) await changeStrategy(strategy);
    setReadFilter('all'); setSearch('');
    setGroup(item.kind === 'stock' && data.stocks.find(stock => stock.code === item.code)?.group === 'hidden' ? 'hidden' : 'all');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const article = document.getElementById(`div-check-${item.key}`);
      const evidence = article?.querySelector<HTMLDetailsElement>('.div-check-status-evidence');
      if (evidence) { evidence.open = true; evidence.querySelector('summary')?.focus(); }
      article?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
  };
  const sharesFor = (stock: DividendStock) => stock.shareMode === 'manual' ? stock.manualShares : data.positions.get(stock.code)?.shares ?? 0;
  const today = dateInChina();
  const held = data.stocks.filter(stock => sharesFor(stock) > 0);
  const forecasts = held.map(stock => forecastHoldingYearDividends(stock, today, sharesFor(stock)));
  const covered = forecasts.filter(forecast => forecast.amountMinor !== undefined);
  const forecastTotal = covered.reduce((sum, forecast) => sum + forecast.amountMinor!, 0);
  const heldChecks = held.map(stock => checks.stocks[stock.code] ?? dividendCheckSummary({ stock, totalBudgetMinor: data.budgetConfigured ? data.budgetMinor : undefined, shares: sharesFor(stock), asOf: today }));
  const triggeredBuys = heldChecks.filter(check => check.trigger.buy === 'triggered').length;
  const triggeredSells = heldChecks.filter(check => check.trigger.sell === 'triggered').length;
  const weight = data.stocks.reduce((sum, stock) => sum + stock.weightBps, 0);
  const untracked = [...data.positions.values()].filter(position => !data.stocks.some(stock => stock.code === position.code)).sort((a, b) => a.code.localeCompare(b.code));
  const displayed = sortDividendStocks(data.stocks.filter(stock => (group === 'all' ? stock.group !== 'hidden' || sharesFor(stock) > 0 : group === 'held' ? sharesFor(stock) > 0 : stock.group === group)
    && `${stock.name} ${stock.code}`.toLowerCase().includes(search.trim().toLowerCase()) && matchesDividendReadFilter(checks.stocks[stock.code], readFilter)), sharesFor);
  const fundedCodes = new Set(fundedDividendStocks(data.stocks, data.budgetConfigured ? data.budgetMinor : undefined).map(stock => stock.code));
  const managedStocks = sortDividendStocks(data.stocks.filter(stock => `${stock.name} ${stock.code}`.toLowerCase().includes(managerSearch.trim().toLowerCase())), sharesFor);
  const fundedPlans = managedStocks.filter(stock => fundedCodes.has(stock.code));
  const unfundedPlans = managedStocks.filter(stock => !fundedCodes.has(stock.code));
  const strategySelector = <div className="div-strategy-options" role="group" aria-label={t('div_strategy')}>{(['stocks', 'funds'] as const).map(strategy => <button key={strategy}
    className={data.strategy === strategy ? 'selected' : ''} aria-pressed={data.strategy === strategy} disabled={strategySaving || budgetSaving || Boolean(progress)} onClick={() => void changeStrategy(strategy)}>{t(`div_strategy_${strategy}`)}</button>)}</div>;
  const planManagement = <div className="div-plan-manager">
    <h2 className="div-ai-panel-title">{t('div_ai_tab_plan')}</h2><p className="div-ai-muted">{t('div_v2_management_intro')}</p>
    <details className="div-method" open><summary>{t('div_strategy')}</summary>{strategySelector}</details>
    {data.strategy === 'funds' ? <DividendFundWorkbench plan={data.fundPlan} checks={checks.funds} amountVisible={amountVisible} onSaved={load} /> : <>
      <details className="div-method"><summary>{t('div_budget_manage')} · {data.budgetConfigured ? money(data.budgetMinor) : '—'}</summary>
        <form className="div-budget" onSubmit={event => { event.preventDefault(); void persistBudget(); }}><label htmlFor="div-budget">{t('div_budget')}</label><div className="div-actions">
          <input id="div-budget" inputMode="decimal" type={amountVisible ? 'number' : 'password'} min="0" max="1000000000000" step="0.01" placeholder={t('div_budget_placeholder')} value={budgetInput} disabled={budgetSaving} onChange={event => setBudgetInput(event.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={budgetSaving}>{t(budgetSaving ? 'loading' : 'save')}</button></div></form>
        <p className="div-muted">{t('div_allocated', { percent: numeric(weight / 100), remaining: money(Math.max(0, data.budgetMinor - stockBudgetMinor(data.budgetMinor, weight))) })}</p>
        <div className="div-budget-meter" role="progressbar" aria-valuenow={weight} aria-valuemin={0} aria-valuemax={10000} aria-label={t('div_allocated', { percent: numeric(weight / 100), remaining: '' })}><span style={{ width: `${Math.min(100, weight / 100)}%` }} className={weight > 10000 ? 'over' : ''} /></div>
        {weight > 10000 && <p className="div-warning">{t('div_over_budget')}</p>}<p className="div-muted">{t('div_allocation_rule')}</p>
        <button className="btn btn-secondary" disabled={Boolean(progress) || weight <= 0 || weight >= 10000} onClick={() => setAllocationOpen(true)}>{t('div_allocate_unused')}</button>
      </details>
      <details className="div-method" open={Boolean(focusedPlanCode)}><summary>{t('div_manage_stocks')} · {data.stocks.length}</summary>
        <div className="div-plan-manager-actions"><button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => { setIsNew(true); setEditor({ code: '', name: '', group: 'watch', weightBps: 0, shareMode: 'linked', manualShares: 0, lotSize: 100 }); }}>{t('div_add')}</button>
          <button className="btn btn-secondary" disabled={Boolean(progress) || untracked.length === 0} onClick={() => setLinkedPickerOpen(true)}>{t('div_add_linked', { count: untracked.length })}</button>
          <button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => setImportOpen(true)}>{t('div_import')}</button></div>
        <input aria-label={t('div_search')} placeholder={t('div_search')} value={managerSearch} onChange={event => setManagerSearch(event.target.value)} />
        <div className="div-plan-manager-list">{fundedPlans.map(stock => {
          const check = checks.stocks[stock.code] ?? dividendCheckSummary({ stock, totalBudgetMinor: data.budgetConfigured ? data.budgetMinor : undefined, shares: sharesFor(stock), asOf: today });
          const plan = check.displayPlan;
          return <details key={stock.code} open={stock.code === focusedPlanCode}
          ref={element => { if (element && stock.code === focusedPlanCode && scrolledPlanRequest.current !== openPlanRequest) { scrolledPlanRequest.current = openPlanRequest; element.scrollIntoView({ block: 'start' }); } }}>
          <summary><strong>{stock.name}</strong><span>{stock.code} · {t(`div_group_${stock.group}`)}</span>
            {(['buy', 'sell'] as const).filter(side => plan[`${side}TriggeredLevel`] > 0).map(side => <span className="div-grid-trigger-status is-triggered" key={side}>{t(`div_home_${side}`)} · {t('div_grid_triggered_level', { level: plan[`${side}TriggeredLevel`] })}</span>)}</summary>
          <label className="div-plan-stock-group">{t('div_group')}<select value={stock.group} aria-label={`${stock.name} ${t('div_group')}`} disabled={groupSaving} onChange={event => void changeStockGroup(stock.code, event.target.value as DividendStock['group'])}>{(['core', 'watch', 'hidden'] as const).map(value => <option key={value} value={value}>{t(`div_group_${value}`)}</option>)}</select></label>
          <div className="div-budget-line"><span>{t('div_stock_weight')} <strong>{numeric(stock.weightBps / 100)}%</strong></span><span>{t('div_stock_budget')} <strong>{money(stockBudgetMinor(data.budgetMinor, stock.weightBps))}</strong></span></div>
          <div className="div-actions"><button className="btn btn-secondary" onClick={() => { setIsNew(false); setEditor(stock); }}>{t('div_edit')}</button>
            <InlineDeleteButton disabled={Boolean(progress) || strategySaving} onConfirm={() => removeStock(stock.code)} /></div>
          {stock.buyPaused && <p className="div-warning">{t('div_buy_paused_note')}</p>}
          <DividendCheckStatus summary={check} />
          {(['buy', 'sell'] as const).map(side => <DividendPlanGrid key={side} plan={plan} side={side} amountVisible={amountVisible} tierIndices={check.grid[side === 'buy' ? 'buyTierIndices' : 'sellTierIndices']} />)}
        </details>; })}</div>
        {fundedPlans.length === 0 && <p className="div-muted">{t('div_no_funded_plans')}</p>}
        {unfundedPlans.length > 0 && <details className="div-unfunded-stocks" open={unfundedPlans.some(stock => stock.code === focusedPlanCode)}><summary>{t('div_unfunded_stocks', { count: unfundedPlans.length })}</summary>
          <p className="div-muted">{t('div_unfunded_allocate_hint')}</p>
          <div className="div-unfunded-stock-list">{unfundedPlans.map(stock => <UnfundedStockRow key={stock.code}
            stock={stock} remainingBps={Math.max(0, 10000 - weight)} disabled={Boolean(progress) || strategySaving}
            onAllocated={load} onRemoved={() => removeStock(stock.code)} onEdit={() => { setIsNew(false); setEditor(stock); }}
            ref={element => { if (element && stock.code === focusedPlanCode && scrolledPlanRequest.current !== openPlanRequest) { scrolledPlanRequest.current = openPlanRequest; element.scrollIntoView({ block: 'start' }); } }} />)}</div>
        </details>}
      </details>
    </>}
    {message && <p className="div-notice" role="status">{message}</p>}{error && <p className="div-warning" role="alert">{error}</p>}
    {allocationResult && <section className="div-allocation-result" ref={allocationResultRef}><div className="div-stock-heading"><h2>{t('div_allocation_result')}</h2><button className="btn btn-secondary" onClick={() => setAllocationResult(null)}>{t('close')}</button></div>
      <AllocationPreview before={allocationResult.before} after={allocationResult.after} budgetMinor={data.budgetMinor} amountVisible={amountVisible} /></section>}
    {importOpen && <DividendImportDialog stocks={data.stocks} budgetMinor={data.budgetMinor} amountVisible={amountVisible} onClose={() => setImportOpen(false)} onSaved={async result => { setImportOpen(false); await load(); setAllocationResult(null); setError(''); setMessage(t('div_import_done', result)); }} />}
    {allocationOpen && <AllocationDialog stocks={data.stocks} budgetMinor={data.budgetMinor} amountVisible={amountVisible} onClose={() => setAllocationOpen(false)} onSaved={async () => { setAllocationOpen(false); const next = await load(); setAllocationResult({ before: data.stocks, after: next.stocks }); setError(''); setMessage(t('div_allocation_done')); }} />}
    {linkedPickerOpen && <LinkedStockPicker positions={untracked} amountVisible={amountVisible} onClose={() => setLinkedPickerOpen(false)} onSaved={async count => { setLinkedPickerOpen(false); await load(); setAllocationResult(null); setMessage(t('div_linked_added', { count })); setError(''); }} />}
  </div>;
  return <div className="dividend-page">
    {editor && <StockEditor initial={editor} isNew={isNew} stocks={data.stocks} budgetMinor={data.budgetMinor} amountVisible={amountVisible} onConflict={load} onClose={() => setEditor(null)} onSaved={async action => {
      const before = data.stocks.filter(stock => stock.code !== editor.code); setEditor(null); const next = await load();
      setAllocationResult(action === 'redistributed' && before.some(stock => stock.weightBps > 0) ? { before, after: next.stocks } : null);
      setError(''); setMessage(t(action === 'redistributed' ? 'div_deleted_redistributed' : action === 'deleted' ? 'div_deleted_unallocated' : 'div_saved'));
    }} />}
    <div className="page-header"><div><h1 className="page-title">{t('div_title')}</h1><small className="div-active-strategy">{t('div_home_all_plans')}</small></div>
      <button className="btn btn-secondary" onClick={() => setAmountVisible(!amountVisible)}>{t(amountVisible ? 'div_hide_amounts' : 'div_show_amounts')}</button></div>
    <div className="div-home-tabs" role="tablist" aria-label={t('div_strategy')}>{(['stocks', 'funds'] as const).map(strategy => <button key={strategy} role="tab" aria-selected={data.strategy === strategy} className={data.strategy === strategy ? 'active' : ''} disabled={strategySaving || budgetSaving || Boolean(progress)} onClick={() => void changeStrategy(strategy)}>{t(`div_strategy_${strategy}`)}</button>)}</div>
    <DividendAdvisor onUpdated={load} amountVisible={amountVisible} planManagement={planManagement} planKey={dailyPlanKey} openPlanRequest={openPlanRequest} onOpenCheckItem={openCheckItem} />
    <section className="div-quote-status" aria-label={t('div_auto_quotes')}><div role="status"><strong>{quotes.refreshing ? t('div_quotes_updating') : progress ? t('div_refresh_progress', progress) : t('div_auto_quotes')}</strong>
      {quotes.result && <small>{t('div_quotes_result', { done: quotes.result.done - quotes.result.failed, total: quotes.result.done, time: new Date(quotes.result.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</small>}
      {(quotes.failed || Boolean(quotes.result?.failed)) && <p className="div-warning">{t('div_quotes_failed')}</p>}
    </div><button className="btn btn-secondary" disabled={quotes.refreshing || Boolean(progress) || !quoteTargets} onClick={() => void quotes.refresh(true)}>{t('div_refresh_quotes')}</button></section>
    <details className="div-reading-tools"><summary>{t('div_read_filter')} · {t(`div_read_filter_${readFilter}`)}</summary>
      <input className="div-search" aria-label={t('div_search')} placeholder={t('div_search')} value={search} onChange={event => setSearch(event.target.value)} />
      <DividendReadFilters value={readFilter} onChange={setReadFilter} />
      <div className="div-filters" aria-label={t('div_group')}>{['all', 'held', 'core', 'watch', 'hidden'].map(value => <button key={value} className={group === value ? 'selected' : ''} aria-pressed={group === value} onClick={() => setGroup(value)}>{t(`div_group_${value}`)}</button>)}</div>
    </details>
    {data.strategy === 'funds' ? <DividendFundHomePlan plan={data.fundPlan} checks={checks.funds} amountVisible={amountVisible} asOf={today} collapsedCodes={collapsedCodes} onToggle={toggleStock} readFilter={readFilter} search={search} onEdit={() => void openFundPlan()} /> :
    <section className="div-stock-home" aria-labelledby="div-stock-home-title"><div className="div-section-heading"><h2 id="div-stock-home-title">{t('div_home_stock_plans')}</h2><button type="button" className="div-advisor-text-button" onClick={() => void openStockPlan('')}>{t('div_manage_stocks')}</button></div>
      <div className="div-summary-strip">
        <span><strong>{held.length}</strong><small>{t('div_summary_held')}</small></span>
        <span className={triggeredBuys > 0 ? 'is-triggered' : ''}><strong>{triggeredBuys}</strong><small>{t('div_summary_buy_triggered')}</small></span>
        <span className={triggeredSells > 0 ? 'is-triggered' : ''}><strong>{triggeredSells}</strong><small>{t('div_summary_sell_triggered')}</small></span>
      </div>
      {message && <p className="div-notice" role="status">{message}</p>}{error && <p className="div-warning" role="alert">{error}</p>}
      <div className="div-stock-list">{displayed.map(stock => {
        const shares = sharesFor(stock), latest = latestReportDividend(stock), forecast = forecastHoldingYearDividends(stock, today, shares);
        const expanded = !collapsedCodes.includes(stock.code);
        const check = checks.stocks[stock.code] ?? dividendCheckSummary({ stock, totalBudgetMinor: data.budgetConfigured ? data.budgetMinor : undefined, shares, asOf: today });
        return <article className="div-stock div-stock-reading div-compact-row" id={`div-check-stock:${stock.code}`} key={stock.code}>
          <button type="button" className="div-stock-toggle" aria-expanded={expanded} aria-controls={`div-stock-body-${stock.code}`} onClick={() => toggleStock(stock.code)}>
          <span className="div-stock-heading"><span><span className="div-stock-title">{stock.name} <span>{stock.code}</span></span><small>{shares > 0 ? `${t('div_group_held')} · ` : ''}{t(`div_group_${stock.group}`)}</small></span><span className="div-stock-toggle-state">{stock.buyPaused && <span className="div-stock-paused">{t('div_ai_buy_paused')}</span>}<span className="div-stock-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span><span>{t(expanded ? 'div_home_collapse' : 'div_home_expand')}</span></span></span>
          </button>
          <DividendCompactPlan summary={check} amountVisible={amountVisible}>
          <DividendGridOrigin stock={stock} asOf={today} check={check} />
          <p className="div-muted">{t('div_v2_latest_report_dividend')} · {latest?.dpsMicros === undefined ? '—' : `¥${numeric(latest.dpsMicros / 1e6, 6)}`} · {latest ? latest.basis === 'manual' ? t('div_manual') : `${latest.reportDate} · ${t(`div_v2_period_${latest.period}`)} · ${t(`div_v2_stage_${latest.stage}`)}` : t('div_v2_refresh_required')}</p>
          <div className="div-forecast-line"><div><span>{t('div_v2_one_year_per_share')}</span><strong>{forecast.dpsMicros === undefined ? '—' : `¥${numeric(forecast.dpsMicros / 1e6, 6)}`}</strong></div>
            {shares > 0 && <div><span>{t('div_v2_holding_amount', { shares: quantity(shares) })}</span><strong>{forecast.amountMinor === undefined ? '—' : money(forecast.amountMinor)}</strong></div>}</div>
          {!latest && <button className="div-advisor-text-button" disabled={Boolean(progress) || quotes.refreshing} onClick={() => void refresh([stock.code])}>{t('div_v2_refresh_disclosures')}</button>}
          {(stock.quoteFailedAt || stock.dividendFailedAt) && <p className="div-warning">{t(stock.dividendFailedAt ? 'div_dividend_failed' : 'div_quote_failed')}</p>}
          <section className="div-details"><h4>{t('div_v2_dividend_basis')}</h4>
            {latest && <p className="div-muted">{latest.basis === 'manual' ? t('div_v2_manual_report') : t(latest.reportEventCount > 1 ? 'div_v2_report_multiple' : 'div_v2_report_scope', { count: latest.reportEventCount, report: latest.reportDate, period: t(`div_v2_period_${latest.period}`), date: latest.announcedAt })}</p>}
            <p className="div-muted">{t('div_v2_forecast_window', { from: forecast.asOf, through: forecast.through })}</p>
            {forecast.missingReason && <p className="div-muted">{t(`div_v2_missing_${forecast.missingReason}`)}</p>}
            {forecast.incompleteReportDates.length > 0 && <p className="div-warning">{t('div_v2_incomplete_periods', { reports: forecast.incompleteReportDates.join('、') })}</p>}
            <ul className="div-forecast-events">{forecast.events.map(event => <li key={`${event.reportDate}:${event.expectedExDate}`}><strong>{event.reportDate} · ¥{numeric(event.dpsMicros / 1e6, 6)}/{t('div_one_share')}</strong>
              <span>{t(event.basis === 'announced' ? 'div_v2_event_announced' : 'div_v2_event_historical')} · {t(`div_v2_stage_${event.stage}`)}</span>
              {event.basisReportDate && <span>{t('div_v2_event_prior_period', { report: event.basisReportDate })}</span>}
              {event.amountUnannounced && <span>{t('div_v2_event_amount_unannounced')}</span>}
              <span>{t(event.dateEstimated ? 'div_v2_estimated_ex_date' : 'div_v2_confirmed_ex_date', { date: event.expectedExDate })}</span>
              {event.expectedPaymentDate && <span>{t('div_v2_payment_date', { date: event.expectedPaymentDate })}</span>}
            </li>)}</ul>
            {stock.shareMode === 'manual' ? <p className="div-muted">{t('div_manual_override')}</p> : <p className="div-muted">{t('div_linked_sources')}: {data.positions.get(stock.code)?.sources.map(source => `${source.accountName} ${quantity(source.shares)}`).join(' · ') || t('div_no_link')}</p>}
            {stock.note && <p className="div-muted">{stock.note}</p>}
            <button className="btn btn-secondary" disabled={Boolean(progress) || quotes.refreshing} onClick={() => void refresh([stock.code])}>{t('div_v2_refresh_disclosures')}</button>
          </section>
          </DividendCompactPlan>
          <div id={`div-stock-body-${stock.code}`} hidden={!expanded}>
          {(fundedCodes.has(stock.code) || shares > 0) ? <DividendHomePlan showStatus={false} check={check} stock={stock} totalBudgetMinor={data.budgetConfigured ? data.budgetMinor : undefined} shares={shares} amountVisible={amountVisible} asOf={today}
            onEdit={() => void openStockPlan(stock.code)} /> : <div className="div-unfunded-home"><span>{t('div_check_unfunded')}</span><button type="button" className="div-advisor-text-button" onClick={() => void openStockPlan(stock.code)}>{t('div_home_edit_plan')}</button></div>}
          </div>
        </article>;
      })}</div>{!displayed.length && <p className="div-notice">{t('div_empty')}</p>}
      <details className="div-reading-tools"><summary>{t('div_v2_holding_forecast')} · {held.length > covered.length ? '—' : money(forecastTotal)}</summary>
        <section className="div-hero div-forecast-hero"><div className="div-estimate"><span>{t('div_v2_holding_forecast')}</span><strong>{held.length > covered.length ? '—' : money(forecastTotal)}</strong><small>{t('div_coverage', { count: covered.length, total: held.length })}</small></div><p className="div-muted">{t('div_v2_forecast_basis')}</p></section>
      </details>
      <div className="div-actions div-toolbar"><button className="btn btn-secondary" disabled={Boolean(progress) || quotes.refreshing} onClick={() => void refresh(data.stocks.map(stock => stock.code))}>{progress ? t('div_refresh_progress', progress) : t('div_v2_refresh_disclosures')}</button></div>
    </section>}
  </div>;
}

/** Point-twice delete: the first tap arms confirmation, the second within a few seconds removes. */
function InlineDeleteButton({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => Promise<void> }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3500);
    return () => clearTimeout(timer);
  }, [confirming]);
  const onClick = async () => {
    if (!confirming) { setConfirming(true); return; }
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); setConfirming(false); }
    catch { setConfirming(false); }
    finally { setBusy(false); }
  };
  return <button type="button" className={confirming ? 'btn btn-danger' : 'btn btn-secondary'} disabled={disabled || busy} onClick={() => void onClick()}>{t(confirming ? 'div_confirm_remove' : 'delete')}</button>;
}

/** Unfunded row: allocate a weight inline, or remove the target without opening the full editor. */
function UnfundedStockRow({ stock, remainingBps, disabled, onAllocated, onRemoved, onEdit, ref }: { stock: DividendStock; remainingBps: number; disabled: boolean; onAllocated: () => Promise<unknown>; onRemoved: () => Promise<unknown>; onEdit: () => void; ref?: React.Ref<HTMLDivElement> }) {
  const { t } = useTranslation();
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = Number(weight);
    if (!weight.trim() || !Number.isFinite(value) || value <= 0 || Math.round(value * 100) > remainingBps) { setError(t('div_allocate_weight_invalid', { remaining: numeric(remainingBps / 100) })); return; }
    setBusy(true); setError('');
    try { await saveDividendStockWeight(stock.code, Math.round(value * 100)); setWeight(''); await onAllocated(); }
    catch { setError(t('div_save_error')); }
    finally { setBusy(false); }
  };
  return <div className="div-unfunded-stock-row" ref={ref}>
    <span className="div-unfunded-stock-name">{stock.name}<small>{stock.code}</small></span>
    <form className="div-unfunded-allocate" onSubmit={e => void submit(e)}>
      <span className="div-alloc-input-wrap"><input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder={t('div_allocate_weight_placeholder')} value={weight} disabled={busy || disabled} onChange={e => setWeight(e.target.value)} aria-label={`${stock.name} ${t('div_allocate_weight')}`} /><span className="div-alloc-pct">%</span></span>
      <button type="submit" className="btn btn-secondary" disabled={busy || disabled}>{t('div_allocate_weight')}</button>
    </form>
    <div className="div-unfunded-row-actions">
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onEdit}>{t('div_edit')}</button>
      <InlineDeleteButton disabled={disabled} onConfirm={async () => { await onRemoved(); }} />
    </div>
    {error && <p className="div-warning" role="alert">{error}</p>}
  </div>;
}

function LinkedStockPicker({ positions, amountVisible, onClose, onSaved }: { positions: LinkedDividendPosition[]; amountVisible: boolean; onClose: () => void; onSaved: (count: number) => Promise<void> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const selectableCodes = positions.map(position => position.code);
  const selectedCodes = selected.filter(code => selectableCodes.includes(code));
  const allSelected = positions.length > 0 && selectedCodes.length === positions.length;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || selectedCodes.length === 0) return;
    setSaving(true);
    try { await onSaved(await addLinkedDividendStocks(selectedCodes)); }
    catch { setError(t('div_save_error')); }
    finally { setSaving(false); }
  };
  return <dialog className="div-dialog" ref={dialog} onCancel={e => { if (saving) e.preventDefault(); else onClose(); }} aria-labelledby="div-linked-title"><form onSubmit={e => void submit(e)}>
    <div className="div-stock-heading"><h2 id="div-linked-title">{t('div_linked_select_title')}</h2><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('close')}</button></div>
    <p className="div-muted">{t('div_linked_select_note')}</p>
    <label className="div-linked-all"><input type="checkbox" checked={allSelected} disabled={saving || positions.length === 0} onChange={e => setSelected(e.target.checked ? selectableCodes : [])} />{t('div_linked_select_all')}</label>
    <div className="div-linked-list">{positions.map(position => <label className="div-linked-option" key={position.code}>
      <input type="checkbox" disabled={saving} checked={selectedCodes.includes(position.code)} onChange={e => setSelected(codes => e.target.checked ? [...codes, position.code] : codes.filter(code => code !== position.code))} />
      <span><strong>{position.name} <small>{position.code}</small></strong><small>{t('div_linked_position_shares', { shares: amountVisible ? numeric(position.shares, 4) : '••••' })} · {position.sources.map(source => source.accountName).join(' · ')}</small></span>
    </label>)}</div>
    {positions.length === 0 && <p className="div-muted">{t('div_linked_empty')}</p>}
    {error && <p className="div-warning" role="alert">{error}</p>}
    <div className="div-actions"><button type="submit" className="btn btn-primary" disabled={saving || selectedCodes.length === 0}>{t(saving ? 'loading' : 'div_linked_add_selected', { count: selectedCodes.length })}</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('cancel')}</button></div>
  </form></dialog>;
}

function StockEditor({ initial, isNew, stocks, budgetMinor, amountVisible, onClose, onSaved, onConflict }: { initial: DividendStock; isNew: boolean; stocks: DividendStock[]; budgetMinor: number; amountVisible: boolean; onClose: () => void; onSaved: (action?: 'deleted' | 'redistributed') => Promise<void>; onConflict: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const deletePreview = useRef<HTMLElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [stock, setStock] = useState(initial);
  const [openedFingerprint] = useState(() => dividendStockEditFingerprint(initial));
  const [dps, setDps] = useState(initial.manualDpsMicros === undefined ? '' : String(initial.manualDpsMicros / 1e6));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [redistribute, setRedistribute] = useState(true);
  const afterDelete = redistribute ? redistributeDividendWeights(stocks, initial.code) : stocks.filter(s => s.code !== initial.code);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (confirmDelete) deletePreview.current?.scrollIntoView({ block: 'start' }); }, [confirmDelete]);
  const patch = (value: Partial<DividendStock>) => setStock(s => ({ ...s, ...value }));
  const basicValid = () => {
    const code = mainlandCode(stock.code);
    return Boolean(code && (isNew ? !stocks.some(s => s.code === code) : true) && stock.name.trim());
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) { if (!basicValid()) { setError(t('div_invalid_stock')); return; } setError(''); setStep(2); return; }
    const code = mainlandCode(stock.code);
    if (saving) return;
    if (!code || !stock.name.trim() || (dps !== '' && (!Number.isFinite(Number(dps)) || Number(dps) < 0))) { setError(t('div_invalid_stock')); return; }
    setSaving(true);
    try {
      await saveDividendStock({ ...stock, code, name: stock.name.trim(), manualDpsMicros: dps === '' ? undefined : Math.round(Number(dps) * 1e6) },
        isNew ? { expectNew: true } : { expectedFingerprint: openedFingerprint });
      await onSaved();
    } catch (cause) {
      const conflict = cause instanceof Error && cause.message === 'DIVIDEND_STOCK_CHANGED';
      setError(t(conflict ? 'div_check_stock_conflict' : 'div_invalid_stock'));
      if (conflict) await onConflict().catch(() => undefined);
    }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (saving) return;
    setSaving(true);
    try { await deleteDividendStock(initial.code, redistribute); await onSaved(redistribute ? 'redistributed' : 'deleted'); } catch (cause) { setError(t(cause instanceof Error && cause.message === 'DIVIDEND_STOCK_HELD' ? 'div_v2_held_delete_blocked' : 'div_save_error')); }
    finally { setSaving(false); }
  };
  const gridEditor = (side: 'buy' | 'sell') => {
    const key = side === 'buy' ? 'buyLevels' : 'sellLevels';
    const levels = stock[key] ?? (side === 'buy' ? BUY_LEVELS : SELL_LEVELS);
    const change = (i: number, field: keyof GridLevel, value: string) => patch({ [key]: levels.map((level, index) => index === i ? { ...level, [field]: value === '' && field === 'priceMinor' ? undefined : Math.round(Number(value) * 100) } : level) });
    return <div key={side}><h3>{t(`div_grid_${side}`)}</h3><div className="div-table-scroll"><table><thead><tr><th>{t('div_grid_yield')} %</th><th>{t('div_portion')} %</th><th>{t('div_override_price')}</th></tr></thead><tbody>{levels.map((level, i) => <tr key={i}>
      <td><input aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_grid_yield')}`} type="number" required min="0.01" max="100" step="0.01" value={level.yieldBps / 100} onChange={e => change(i, 'yieldBps', e.target.value)} /></td>
      <td><input aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_portion')}`} type="number" required min="0" max="100" step="0.01" value={level.portionBps / 100} onChange={e => change(i, 'portionBps', e.target.value)} /></td>
      <td><input aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_override_price')}`} type="number" min="0.01" step="0.01" placeholder={t('div_auto')} value={level.priceMinor === undefined ? '' : level.priceMinor / 100} onChange={e => change(i, 'priceMinor', e.target.value)} /></td>
    </tr>)}</tbody></table></div></div>;
  };
  return <dialog className="div-dialog" ref={dialog} onCancel={e => { if (saving) e.preventDefault(); else onClose(); }} aria-labelledby="div-editor-title"><form onSubmit={e => void save(e)}>
    <div className="div-stock-heading"><h2 id="div-editor-title">{t(isNew ? 'div_add' : 'div_edit')}</h2><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('close')}</button></div>
    <div className="div-editor-steps" role="tablist" aria-label={t('div_editor_step_of', { current: step, total: 2 })}>
      <button type="button" role="tab" aria-selected={step === 1} className={step === 1 ? 'active' : ''} onClick={() => setStep(1)}>{t('div_editor_step_basic')}</button>
      <button type="button" role="tab" aria-selected={step === 2} className={step === 2 ? 'active' : ''} onClick={() => { if (basicValid()) { setError(''); setStep(2); } }}>{t('div_editor_step_grid')}</button>
    </div>
    <p className="div-muted div-editor-step-hint">{t('div_editor_step_of', { current: step, total: 2 })}</p>
    {step === 1 ? <>
      <div className="div-form-fields">
        <label>{t('div_code')}<input required disabled={!isNew} value={stock.code} onChange={e => patch({ code: e.target.value, ...(isNew ? { lotSize: e.target.value.replace(/\D/g, '').startsWith('68') ? 200 : 100 } : {}) })} /></label>
        <label>{t('name')}<input required maxLength={80} value={stock.name} onChange={e => patch({ name: e.target.value })} /></label>
        <label>{t('div_group')}<select value={stock.group} onChange={e => patch({ group: e.target.value as DividendStock['group'] })}>{['core', 'watch', 'hidden'].map(g => <option key={g} value={g}>{t(`div_group_${g}`)}</option>)}</select></label>
        <label>{t('div_weight')}<input required type="number" inputMode="decimal" min="0" max="100" step="0.01" value={stock.weightBps / 100} onChange={e => patch({ weightBps: Math.round(Number(e.target.value) * 100) })} /></label>
        <label>{t('div_share_mode')}<select value={stock.shareMode} onChange={e => patch({ shareMode: e.target.value as DividendStock['shareMode'] })}><option value="linked">{t('div_linked')}</option><option value="manual">{t('div_manual')}</option></select></label>
        {stock.shareMode === 'manual' && <label>{t('div_shares')}<input required type="number" inputMode="decimal" min="0" step="0.0001" value={stock.manualShares} onChange={e => patch({ manualShares: Number(e.target.value) })} /></label>}
        <label>{t('div_lot_size')}<input required type="number" min="1" max="10000" step="1" value={stock.lotSize} onChange={e => patch({ lotSize: Number(e.target.value) })} /></label>
      </div>
      <label className="div-form-note">{t('div_note')}<textarea maxLength={2000} rows={3} value={stock.note ?? ''} onChange={e => patch({ note: e.target.value })} /></label>
    </> : <>
      <label className="div-form-fields div-form-fields-single">{t('div_v2_manual_grid_annual')}<input type="number" inputMode="decimal" min="0" step="0.000001" placeholder={t('div_auto_dps')} value={dps} onChange={e => setDps(e.target.value)} /></label>
      <p className="div-muted">{t('div_v2_manual_grid_note')}</p>
      <div className="div-method"><p>{t('div_edit_grid_note')}</p><p>{t('div_v2_grid_forecast_basis')}</p>
        <label className="div-linked-all"><input type="checkbox" checked={stock.buyPaused ?? false} onChange={e => patch({ buyPaused: e.target.checked })} />{t('div_buy_paused')}</label>
        {(['buy', 'sell'] as const).map(gridEditor)}
        <button type="button" className="btn btn-secondary" onClick={() => patch({ buyLevels: undefined, sellLevels: undefined })}>{t('div_reset_grid')}</button>
      </div>
    </>}
    {error && <p className="div-warning" role="alert">{error}</p>}
    <div className="div-actions">
      {step === 2 && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setStep(1)}>{t('div_editor_step_back')}</button>}
      <button type="submit" className="btn btn-primary" disabled={saving}>{step === 1 ? t('div_editor_step_next') : t('save')}</button>
      <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('cancel')}</button>
      {!isNew && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirmDelete(true)}>{t('delete')}</button>}
    </div>
    {confirmDelete && <section className="div-delete-preview" ref={deletePreview}><p className="div-warning">{t('div_delete_confirm', { name: initial.name })}</p>
      <label className="div-linked-all"><input type="checkbox" checked={redistribute} disabled={saving} onChange={e => setRedistribute(e.target.checked)} />{t('div_delete_redistribute')}</label>
      <p className="div-muted">{t(redistribute ? 'div_redistribute_note' : 'div_delete_keep_unused')}</p>
      <AllocationPreview before={stocks.filter(s => s.code !== initial.code)} after={afterDelete} budgetMinor={budgetMinor} amountVisible={amountVisible} />
      <div className="div-actions"><button type="button" className="btn btn-danger" disabled={saving} onClick={() => void remove()}>{t('div_delete_apply')}</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirmDelete(false)}>{t('cancel')}</button></div>
    </section>}
  </form></dialog>;
}

function AllocationPreview({ before, after, budgetMinor, amountVisible }: { before: DividendStock[]; after: DividendStock[]; budgetMinor: number; amountVisible: boolean }) {
  const { t } = useTranslation();
  const oldTotal = before.reduce((sum, stock) => sum + stock.weightBps, 0);
  const newTotal = after.reduce((sum, stock) => sum + stock.weightBps, 0);
  return <div className="div-allocation-preview">
    <p className="div-muted">{oldTotal > 0 && t('div_allocation_formula', { before: numeric(oldTotal / 100), after: numeric(newTotal / 100) })}</p>
    <p className="div-muted">{t('div_allocation_remaining', { percent: numeric(Math.max(0, 10000 - newTotal) / 100), amount: amountVisible ? `¥${numeric(Math.max(0, budgetMinor - stockBudgetMinor(budgetMinor, newTotal)) / 100)}` : '••••' })}</p>
    <div className="div-table-scroll"><table><caption>{t('div_allocation_preview')}</caption><thead><tr><th>{t('name')}</th><th>{t('div_allocation_before')}</th><th>{t('div_allocation_after')}</th><th>{t('div_stock_budget')}</th></tr></thead><tbody>{fundedDividendStocks(after, budgetMinor).map(stock => <tr key={stock.code}>
      <td>{stock.name}<small className="div-preview-code">{stock.code}{stock.group === 'hidden' ? ` · ${t('div_group_hidden')}` : ''}</small></td>
      <td>{numeric((before.find(s => s.code === stock.code)?.weightBps ?? 0) / 100)}%</td><td>{numeric(stock.weightBps / 100)}%</td><td>{amountVisible ? `¥${numeric(stockBudgetMinor(budgetMinor, stock.weightBps) / 100)}` : '••••'}</td>
    </tr>)}</tbody></table></div>
  </div>;
}

function AllocationDialog({ stocks, budgetMinor, amountVisible, onClose, onSaved }: { stocks: DividendStock[]; budgetMinor: number; amountVisible: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const apply = async () => {
    if (saving) return;
    setSaving(true);
    try { await allocateDividendBudget(); await onSaved(); }
    catch { setError(t('div_save_error')); }
    finally { setSaving(false); }
  };
  return <dialog className="div-dialog" ref={dialog} aria-labelledby="div-allocation-title" onCancel={e => { if (saving) e.preventDefault(); else onClose(); }}>
    <div className="div-stock-heading"><h2 id="div-allocation-title">{t('div_allocate_unused')}</h2><button className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('close')}</button></div>
    <p className="div-muted">{t('div_allocate_unused_note')}</p>
    <AllocationPreview before={stocks} after={scaleDividendWeights(stocks)} budgetMinor={budgetMinor} amountVisible={amountVisible} />
    {error && <p role="alert" className="div-warning">{error}</p>}
    <div className="div-actions"><button className="btn btn-primary" disabled={saving} onClick={() => void apply()}>{t('div_allocation_apply')}</button><button className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('cancel')}</button></div>
  </dialog>;
}
