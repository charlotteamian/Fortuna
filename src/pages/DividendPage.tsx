import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../app-context';
import { BUY_LEVELS, SELL_LEVELS, buildGrid, dateInChina, dividendEstimateMinor, effectiveDps, mainlandCode, redistributeDividendWeights, scaleDividendWeights, stockBudgetMinor, type DividendStock, type GridLevel, type LinkedDividendPosition } from '../lib/dividendWorkbench';
import { addLinkedDividendStocks, allocateDividendBudget, deleteDividendStock, loadDividendWorkbench, refreshDividendStocks, refreshDividendTrend, saveDividendBudget, saveDividendStock } from '../services/dividendService';
import DividendImportDialog from '../components/DividendImportDialog';
import './DividendPage.css';

type Workbench = Awaited<ReturnType<typeof loadDividendWorkbench>>;
const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

export default function DividendPage() {
  const { t } = useTranslation();
  const { amountVisible, setAmountVisible } = useAppContext();
  const [data, setData] = useState<Workbench | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [linkedPickerOpen, setLinkedPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationResult, setAllocationResult] = useState<{ before: DividendStock[]; after: DividendStock[] } | null>(null);
  const allocationResultRef = useRef<HTMLElement>(null);
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<DividendStock | null>(null);
  const [trendBusy, setTrendBusy] = useState<string | null>(null);
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
    if (alive.current && id === loadId.current) {
      setData(next);
      const budget = next.budgetConfigured ? next.budgetMinor : null;
      if (savedBudget.current !== budget) {
        savedBudget.current = budget;
        setBudgetInput(budget === null ? '' : String(budget / 100));
      }
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
  const money = (minor: number) => amountVisible ? `¥${numeric(minor / 100)}` : '••••';
  const quantity = (shares: number) => amountVisible ? numeric(shares, 4) : '••••';
  const refresh = async (codes: string[]) => {
    if (busy.current) return;
    busy.current = true;
    setProgress({ done: 0, total: codes.length }); setError(''); setMessage('');
    try {
      const result = await refreshDividendStocks(codes, (done, total) => { if (alive.current) setProgress({ done, total }); });
      await load();
      if (alive.current) setMessage(t(result.failed ? 'div_refresh_result' : 'div_refresh_success', result));
    } catch { if (alive.current) setError(t('div_load_error')); }
    finally { busy.current = false; if (alive.current) setProgress(null); }
  };
  const persistBudget = async () => {
    if (budgetSaving) return;
    const amount = Number(budgetInput.replace(/,/g, ''));
    if (!budgetInput.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1e12) { setError(t('div_invalid_budget')); return; }
    setBudgetSaving(true);
    try {
      const budget = Math.round(amount * 100);
      await saveDividendBudget(budget);
      await load();
      setAllocationResult(null);
      if (alive.current) { setBudgetInput(String(budget / 100)); setError(''); setMessage(t('div_saved')); }
    } catch { if (alive.current) setError(t('div_save_error')); }
    finally { if (alive.current) setBudgetSaving(false); }
  };
  if (!data) return <div role="status">{error || t('loading')}</div>;
  const sharesFor = (stock: DividendStock) => stock.shareMode === 'manual' ? stock.manualShares : data.positions.get(stock.code)?.shares ?? 0;
  const held = data.stocks.filter(s => sharesFor(s) > 0);
  const covered = held.filter(s => effectiveDps(s) !== undefined);
  const estimated = covered.reduce((sum, s) => sum + dividendEstimateMinor(sharesFor(s), effectiveDps(s)!), 0);
  const weight = data.stocks.reduce((sum, s) => sum + s.weightBps, 0);
  const today = dateInChina();
  const staleCount = covered.filter(s => s.manualDpsMicros === undefined && (s.dividendFailedAt || s.dividend?.asOf !== today)).length;
  const untracked = [...data.positions.values()].filter(position => !data.stocks.some(stock => stock.code === position.code)).sort((a, b) => a.code.localeCompare(b.code));
  const displayed = data.stocks.filter(s => (group === 'all' ? s.group !== 'hidden' : group === 'held' ? sharesFor(s) > 0 : s.group === group) && `${s.name} ${s.code}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b) => ({core:0,watch:1,hidden:2}[a.group] - {core:0,watch:1,hidden:2}[b.group]) || b.weightBps - a.weightBps || a.code.localeCompare(b.code));
  return <div className="dividend-page">
    <div className="page-header"><div><h1 className="page-title">{t('div_title')}</h1><p className="page-subtitle">{t('div_subtitle')}</p></div>
      <button className="btn btn-secondary" onClick={() => setAmountVisible(!amountVisible)}>{t(amountVisible ? 'div_hide_amounts' : 'div_show_amounts')}</button>
    </div>
    <section className="div-hero">
      <div className="div-estimate"><span>{t('div_annual_estimate')}</span><strong>{held.length > 0 && covered.length === 0 ? '—' : money(estimated)}</strong><small>{t('div_coverage', { count: covered.length, total: held.length })}{staleCount > 0 ? ` · ${t('div_cached_count', { count: staleCount })}` : ''}</small></div>
      <p className="div-muted">{t('div_estimate_note')}</p>
      <form className="div-budget" onSubmit={e => { e.preventDefault(); void persistBudget(); }}><label htmlFor="div-budget">{t('div_budget')}</label><div className="div-actions"><input id="div-budget" inputMode="decimal" type={amountVisible ? "number" : "password"} min="0" max="1000000000000" step="0.01" placeholder={t('div_budget_placeholder')} value={budgetInput} disabled={budgetSaving} onChange={e => setBudgetInput(e.target.value)} /><button type="submit" className="btn btn-primary" disabled={budgetSaving}>{t(budgetSaving ? 'loading' : 'save')}</button></div></form>
      <p className={weight > 10000 ? 'div-warning' : 'div-muted'}>{t('div_allocated', { percent: numeric(weight / 100), remaining: money(Math.max(0, data.budgetMinor - stockBudgetMinor(data.budgetMinor, weight))) })}{weight > 10000 ? ` · ${t('div_over_budget')}` : ''}</p>
      <p className="div-muted">{t('div_allocation_rule')}</p>
      <button className="btn btn-secondary" disabled={Boolean(progress) || weight <= 0 || weight >= 10000} onClick={() => setAllocationOpen(true)}>{t('div_allocate_unused')}</button>
      {weight === 0 && <p className="div-muted">{t('div_no_positive_weights')}</p>}
    </section>
    <div className="div-actions div-toolbar"><button className="btn btn-primary" disabled={Boolean(progress)} onClick={() => void refresh(data.stocks.map(s => s.code))}>{progress ? t('div_refresh_progress', progress) : t('div_refresh')}</button>
      <button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => { setIsNew(true); setEditor({ code: '', name: '', group: 'watch', weightBps: 0, shareMode: 'linked', manualShares: 0, lotSize: 100 }); }}>{t('div_add')}</button>
      <button className="btn btn-secondary" disabled={Boolean(progress) || untracked.length === 0} onClick={() => setLinkedPickerOpen(true)}>{t('div_add_linked', { count: untracked.length })}</button>
      <button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => setImportOpen(true)}>{t('div_import')}</button></div>
    {message && <p className="div-notice" role="status">{message}</p>}{error && <p className="div-warning" role="alert">{error}</p>}
    {allocationResult && <section className="div-allocation-result" ref={allocationResultRef}>
      <div className="div-stock-heading"><h2>{t('div_allocation_result')}</h2><button className="btn btn-secondary" onClick={() => setAllocationResult(null)}>{t('close')}</button></div>
      <p className="div-muted">{t('div_allocation_formula', { before: numeric(allocationResult.before.reduce((sum, s) => sum + s.weightBps, 0) / 100), after: numeric(allocationResult.after.reduce((sum, s) => sum + s.weightBps, 0) / 100) })}</p>
      <details className="div-details"><summary>{t('div_allocation_changes')}</summary><AllocationPreview before={allocationResult.before} after={allocationResult.after} budgetMinor={data.budgetMinor} amountVisible={amountVisible} /></details>
    </section>}
    <details className="div-method"><summary>{t('div_method')}</summary><p>{t('div_template_note')}</p><p>{t('div_link_note')}</p><p>{t('div_grid_note')}</p><p>{t('div_source_note')}</p></details>
    <input className="div-search" aria-label={t('div_search')} placeholder={t('div_search')} value={search} onChange={e => setSearch(e.target.value)} />
    <div className="div-filters" aria-label={t('div_group')}>{['all', 'held', 'core', 'watch', 'hidden'].map(g => <button key={g} className={group === g ? 'selected' : ''} aria-pressed={group === g} onClick={() => setGroup(g)}>{t(`div_group_${g}`)}</button>)}</div>
    <div className="div-stock-list">{displayed.map(stock => {
      const shares = sharesFor(stock), dps = effectiveDps(stock);
      const budget = stockBudgetMinor(data.budgetMinor, stock.weightBps);
      const position = data.positions.get(stock.code);
      const buyGrid = buildGrid(stock, budget, shares, 'buy');
      const firstPrice = buyGrid[0]?.priceMinor;
      const outdated = stock.dividend && stock.dividend.asOf !== today;
      return <article className="div-stock" key={stock.code}>
        <div className="div-stock-heading"><div><h2>{stock.name} <span>{stock.code}</span></h2><small>{t(`div_group_${stock.group}`)}</small></div><button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => { setIsNew(false); setEditor(stock); }}>{t('edit')}</button></div>
        <div className="div-budget-line"><span>{t('div_stock_weight')} <strong>{numeric(stock.weightBps / 100)}%</strong></span><span>{t('div_stock_budget')} <strong>{money(budget)}</strong></span></div>
        {stock.note && <div className="div-note"><span>{t('div_note')}</span><p>{stock.note}</p></div>}
        <div className="div-metrics">
          <div><span>{t('div_quote')}</span><strong>{stock.quote ? `¥${numeric(stock.quote.priceMinor / 100)}` : '—'}</strong><small>{stock.quote?.date ?? t('div_not_fetched')}</small></div>
          <div><span>{t('div_dps')}</span><strong>{dps !== undefined ? `¥${numeric(dps / 1e6, 6)}` : '—'}</strong><small>{t(stock.manualDpsMicros !== undefined ? 'div_manual' : 'div_ttm')}</small></div>
          <div><span>{t('div_shares')}</span><strong>{quantity(shares)}</strong><small>{t(stock.shareMode === 'manual' ? 'div_manual' : position ? 'div_linked' : 'div_no_link')}</small></div>
          <div><span>{t('div_annual_estimate')}</span><strong>{dps !== undefined ? money(dividendEstimateMinor(shares, dps)) : '—'}</strong><small>{t('div_yield', { value: dps !== undefined && stock.quote ? `${numeric(dps / stock.quote.priceMinor / 100)}%` : '—' })}</small></div>
        </div>
        <p className="div-muted">{t('div_entry_price', { price: firstPrice ? `¥${numeric(firstPrice / 100)}` : '—', gap: firstPrice && stock.quote ? `${numeric((firstPrice / stock.quote.priceMinor - 1) * 100)}%` : '—' })}</p>
        {(stock.quoteFailedAt || stock.dividendFailedAt) && <p className="div-warning">{[stock.quoteFailedAt ? t('div_quote_failed') : '', stock.dividendFailedAt ? t('div_dividend_failed') : ''].filter(Boolean).join(' · ')} {t('div_cache_note')}</p>}
        {outdated && stock.manualDpsMicros === undefined && <p className="div-muted">{t('div_asof', { date: stock.dividend!.asOf })}</p>}
        <details className="div-details"><summary>{t('div_details')}</summary>
          <p className="div-muted">{t('div_stock_budget_note')}</p>
          {(['buy', 'sell'] as const).map(side => <div key={side} className="div-grid"><h3>{t(`div_grid_${side}`)}</h3><div className="div-table-scroll"><table><thead><tr><th>{t('div_grid_yield')}</th><th>{t('div_grid_price')}</th><th>{t(side === 'buy' ? 'div_cumulative_budget' : 'div_cumulative_sell')}</th><th>{t('div_grid_shares')}</th></tr></thead><tbody>{buildGrid(stock, budget, shares, side).map((row, i) => <tr key={i} className={row.touched ? 'div-touched' : ''}>
            <td>{row.displayYieldBps === undefined ? '—' : `${numeric(row.displayYieldBps / 100)}%`}{(side === 'buy' ? stock.buyLevels : stock.sellLevels)?.[i]?.priceMinor ? ' *' : ''}{row.touched && <small>{t('div_touched')}</small>}</td><td>{row.priceMinor ? `¥${numeric(row.priceMinor / 100)}` : '—'}</td><td>{side === 'buy' ? money(stockBudgetMinor(budget, row.cumulative)) : `${numeric(row.cumulative / 100)}%`}</td><td>{side === 'buy' ? row.targetShares === undefined ? '—' : quantity(row.targetShares) : quantity(row.sellShares ?? 0)}</td>
          </tr>)}</tbody></table></div></div>)}
          <p className="div-muted">{t('div_linked_sources')}: {stock.shareMode === 'manual' ? t('div_manual_override') : position?.sources.map(s => `${s.accountName} ${quantity(s.shares)}`).join(' · ') || t('div_no_link')}</p>
          <div className="div-payments"><h3>{t('div_dividend_records')}</h3>{stock.dividend ? <><p className="div-muted">{stock.dividend.windowStart} &lt; {t('div_exdate')} ≤ {stock.dividend.asOf}</p>{stock.dividend.payments.map(p => <p key={`${p.exDate}:${p.reportDate}`}>{p.exDate} · ¥{numeric(p.dpsMicros / 1e6, 6)}/{t('div_one_share')}</p>)}{stock.dividend.payments.length === 0 && <p>{t('div_no_payment')}</p>}{stock.dividend.pending && <p className="div-warning">{t('div_pending', { date: stock.dividend.pending.reportDate, dps: numeric(stock.dividend.pending.dpsMicros / 1e6, 6) })}</p>}</> : <p>{t('div_not_fetched')}</p>}
            <p className="div-muted">{t('div_sources_dates', { quote: stock.quote ? new Date(stock.quote.fetchedAt).toLocaleString() : '—', dividend: stock.dividend ? new Date(stock.dividend.fetchedAt).toLocaleString() : '—' })}</p>
          </div>
          <div className="div-payments"><h3>{t('div_valuation')}</h3>
            <p>{t('div_bvps', { value: stock.dividend?.financial?.bvpsMicros ? numeric(stock.dividend.financial.bvpsMicros / 1e6, 4) : '—', pb: stock.quote && stock.dividend?.financial?.bvpsMicros ? numeric(stock.quote.priceMinor * 10000 / stock.dividend.financial.bvpsMicros) : '—' })}</p>
            <p>{t('div_profit_growth', { value: stock.dividend?.financial?.profitGrowthPercent === undefined ? '—' : `${numeric(stock.dividend.financial.profitGrowthPercent)}%`, date: stock.dividend?.financial?.reportDate ?? '—' })}</p>
            <h3>{t('div_trend')}</h3>
            {stock.trend && <><p>{t('div_trend_date', { date: stock.trend.date })}</p><p>{t('div_trend_changes', { five: numeric(stock.trend.change5), ten: numeric(stock.trend.change10), thirty: numeric(stock.trend.change30) })}</p><p>MA5 / 10 / 30: {numeric(stock.trend.ma5Minor / 100)} / {numeric(stock.trend.ma10Minor / 100)} / {numeric(stock.trend.ma30Minor / 100)}</p><p>RSI6: {numeric(stock.trend.rsi6)} · BOLL(20, 2): {numeric(stock.trend.bollLowerMinor / 100)} / {numeric(stock.trend.bollMiddleMinor / 100)} / {numeric(stock.trend.bollUpperMinor / 100)}</p></>}
            {stock.trendFailedAt && <p className="div-warning">{t('div_trend_failed')}</p>}
            <button className="btn btn-secondary" disabled={trendBusy !== null} onClick={async () => { setTrendBusy(stock.code); try { await refreshDividendTrend(stock.code); await load(); } catch { setError(t('div_load_error')); } finally { setTrendBusy(null); } }}>{t(trendBusy === stock.code ? 'loading' : 'div_refresh_trend')}</button>
          </div>
          <button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => void refresh([stock.code])}>{t('div_refresh_one')}</button>
        </details>
      </article>;
    })}</div>
    {displayed.length === 0 && <p className="div-notice">{t('div_empty')}</p>}
    {editor && <StockEditor initial={editor} isNew={isNew} stocks={data.stocks} budgetMinor={data.budgetMinor} amountVisible={amountVisible} onClose={() => setEditor(null)} onSaved={async action => {
      const before = data.stocks.filter(stock => stock.code !== editor.code);
      setEditor(null); const next = await load();
      setAllocationResult(action === 'redistributed' && before.some(stock => stock.weightBps > 0) ? { before, after: next.stocks } : null);
      setError(''); setMessage(t(action === 'redistributed' ? 'div_deleted_redistributed' : action === 'deleted' ? 'div_deleted_unallocated' : 'div_saved'));
    }} />}
    {importOpen && <DividendImportDialog stocks={data.stocks} budgetMinor={data.budgetMinor} amountVisible={amountVisible} onClose={() => setImportOpen(false)} onSaved={async result => {
      setImportOpen(false); await load(); setAllocationResult(null); setError(''); setMessage(t('div_import_done', result));
    }} />}
    {allocationOpen && <AllocationDialog stocks={data.stocks} budgetMinor={data.budgetMinor} amountVisible={amountVisible} onClose={() => setAllocationOpen(false)} onSaved={async () => {
      setAllocationOpen(false); const next = await load(); setAllocationResult({ before: data.stocks, after: next.stocks }); setError(''); setMessage(t('div_allocation_done'));
    }} />}
    {linkedPickerOpen && <LinkedStockPicker positions={untracked} amountVisible={amountVisible} onClose={() => setLinkedPickerOpen(false)} onSaved={async count => {
      setLinkedPickerOpen(false); await load(); setAllocationResult(null); setMessage(t('div_linked_added', { count })); setError('');
    }} />}
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

function StockEditor({ initial, isNew, stocks, budgetMinor, amountVisible, onClose, onSaved }: { initial: DividendStock; isNew: boolean; stocks: DividendStock[]; budgetMinor: number; amountVisible: boolean; onClose: () => void; onSaved: (action?: 'deleted' | 'redistributed') => Promise<void> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const deletePreview = useRef<HTMLElement>(null);
  const [stock, setStock] = useState(initial);
  const [dps, setDps] = useState(initial.manualDpsMicros === undefined ? '' : String(initial.manualDpsMicros / 1e6));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [redistribute, setRedistribute] = useState(true);
  const afterDelete = redistribute ? redistributeDividendWeights(stocks, initial.code) : stocks.filter(s => s.code !== initial.code);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (confirmDelete) deletePreview.current?.scrollIntoView({ block: 'start' }); }, [confirmDelete]);
  const patch = (value: Partial<DividendStock>) => setStock(s => ({ ...s, ...value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = mainlandCode(stock.code);
    if (saving) return;
    if (!code || (isNew && stocks.some(s => s.code === code)) || !stock.name.trim() || (dps !== '' && (!Number.isFinite(Number(dps)) || Number(dps) < 0))) { setError(t('div_invalid_stock')); return; }
    setSaving(true);
    try {
      await saveDividendStock({ ...stock, code, name: stock.name.trim(), manualDpsMicros: dps === '' ? undefined : Math.round(Number(dps) * 1e6) });
      await onSaved();
    } catch { setError(t('div_invalid_stock')); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (saving) return;
    setSaving(true);
    try { await deleteDividendStock(initial.code, redistribute); await onSaved(redistribute ? 'redistributed' : 'deleted'); } catch { setError(t('div_save_error')); }
    finally { setSaving(false); }
  };
  return <dialog className="div-dialog" ref={dialog} onCancel={e => { if (saving) e.preventDefault(); else onClose(); }} aria-labelledby="div-editor-title"><form onSubmit={e => void save(e)}>
    <div className="div-stock-heading"><h2 id="div-editor-title">{t(isNew ? 'div_add' : 'div_edit')}</h2><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('close')}</button></div>
    <div className="div-form-fields">
      <label>{t('div_code')}<input required disabled={!isNew} value={stock.code} onChange={e => patch({ code: e.target.value, ...(isNew ? { lotSize: e.target.value.replace(/\D/g, '').startsWith('68') ? 200 : 100 } : {}) })} /></label>
      <label>{t('name')}<input required maxLength={80} value={stock.name} onChange={e => patch({ name: e.target.value })} /></label>
      <label>{t('div_group')}<select value={stock.group} onChange={e => patch({ group: e.target.value as DividendStock['group'] })}>{['core', 'watch', 'hidden'].map(g => <option key={g} value={g}>{t(`div_group_${g}`)}</option>)}</select></label>
      <label>{t('div_weight')}<input required type="number" inputMode="decimal" min="0" max="100" step="0.01" value={stock.weightBps / 100} onChange={e => patch({ weightBps: Math.round(Number(e.target.value) * 100) })} /></label>
      <label>{t('div_share_mode')}<select value={stock.shareMode} onChange={e => patch({ shareMode: e.target.value as DividendStock['shareMode'] })}><option value="linked">{t('div_linked')}</option><option value="manual">{t('div_manual')}</option></select></label>
      {stock.shareMode === 'manual' && <label>{t('div_shares')}<input required type="number" inputMode="decimal" min="0" step="0.0001" value={stock.manualShares} onChange={e => patch({ manualShares: Number(e.target.value) })} /></label>}
      <label>{t('div_manual_dps')}<input type="number" inputMode="decimal" min="0" step="0.000001" placeholder={t('div_auto_dps')} value={dps} onChange={e => setDps(e.target.value)} /></label>
      <label>{t('div_lot_size')}<input required type="number" min="1" max="10000" step="1" value={stock.lotSize} onChange={e => patch({ lotSize: Number(e.target.value) })} /></label>
    </div><p className="div-muted">{t('div_manual_note')}</p>
    <label className="div-form-note">{t('div_note')}<textarea maxLength={2000} rows={3} value={stock.note ?? ''} onChange={e => patch({ note: e.target.value })} /></label>
    <details className="div-method"><summary>{t('div_edit_grid')}</summary><p>{t('div_edit_grid_note')}</p>{(['buy', 'sell'] as const).map(side => {
      const key = side === 'buy' ? 'buyLevels' : 'sellLevels';
      const levels = stock[key] ?? (side === 'buy' ? BUY_LEVELS : SELL_LEVELS);
      const change = (i: number, field: keyof GridLevel, value: string) => patch({ [key]: levels.map((level, index) => index === i ? { ...level, [field]: value === '' && field === 'priceMinor' ? undefined : Math.round(Number(value) * 100) } : level) });
      return <div key={side}><h3>{t(`div_grid_${side}`)}</h3><div className="div-table-scroll"><table><thead><tr><th>{t('div_grid_yield')} %</th><th>{t('div_portion')} %</th><th>{t('div_override_price')}</th></tr></thead><tbody>{levels.map((level, i) => <tr key={i}>
        <td><input aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_grid_yield')}`} type="number" required min="0.01" max="100" step="0.01" value={level.yieldBps / 100} onChange={e => change(i, 'yieldBps', e.target.value)} /></td>
        <td><input aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_portion')}`} type="number" required min="0" max="100" step="0.01" value={level.portionBps / 100} onChange={e => change(i, 'portionBps', e.target.value)} /></td>
        <td><input aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_override_price')}`} type="number" min="0.01" step="0.01" placeholder={t('div_auto')} value={level.priceMinor === undefined ? '' : level.priceMinor / 100} onChange={e => change(i, 'priceMinor', e.target.value)} /></td>
      </tr>)}</tbody></table></div></div>;
    })}<button type="button" className="btn btn-secondary" onClick={() => patch({ buyLevels: undefined, sellLevels: undefined })}>{t('div_reset_grid')}</button></details>
    {error && <p className="div-warning" role="alert">{error}</p>}
    <div className="div-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{t('save')}</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('cancel')}</button>
      {!isNew && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirmDelete(true)}>{t('delete')}</button>}</div>
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
    <div className="div-table-scroll"><table><caption>{t('div_allocation_preview')}</caption><thead><tr><th>{t('name')}</th><th>{t('div_allocation_before')}</th><th>{t('div_allocation_after')}</th><th>{t('div_stock_budget')}</th></tr></thead><tbody>{after.map(stock => <tr key={stock.code}>
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
