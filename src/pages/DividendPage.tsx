import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../app-context';
import { BUY_LEVELS, SELL_LEVELS, buildGrid, dateInChina, dividendEstimateMinor, effectiveDps, mainlandCode, stockBudgetMinor, type DividendStock, type GridLevel } from '../lib/dividendWorkbench';
import { deleteDividendStock, loadDividendWorkbench, refreshDividendStocks, refreshDividendTrend, saveDividendBudget, saveDividendStock } from '../services/dividendService';
import './DividendPage.css';

type Workbench = Awaited<ReturnType<typeof loadDividendWorkbench>>;
const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

export default function DividendPage() {
  const { t } = useTranslation();
  const { amountVisible, setAmountVisible } = useAppContext();
  const [data, setData] = useState<Workbench | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
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
  const load = useCallback(async () => {
    const next = await loadDividendWorkbench();
    if (alive.current) setData(next);
    return next;
  }, []);
  useEffect(() => {
    alive.current = true;
    void load().then(next => { if (alive.current) setBudgetInput(next.budgetMinor ? String(next.budgetMinor / 100) : ''); }).catch(() => setError(t('div_load_error')));
    const onFocus = () => { void load().catch(() => setError(t('div_load_error'))); };
    window.addEventListener('focus', onFocus);
    return () => { alive.current = false; window.removeEventListener('focus', onFocus); };
  }, [load, t]);
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
    const amount = Number(budgetInput.replace(/,/g, ''));
    if (!budgetInput.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1e12) { setError(t('div_invalid_budget')); return; }
    try { await saveDividendBudget(Math.round(amount * 100)); await load(); setError(''); setMessage(t('div_saved')); }
    catch { setError(t('div_save_error')); }
  };
  const addLinked = async () => {
    if (!data) return;
    try {
      const existing = new Set(data.stocks.map(s => s.code));
      for (const position of data.positions.values()) {
        if (!existing.has(position.code)) await saveDividendStock({ code: position.code, name: position.name, group: 'watch', weightBps: 0, shareMode: 'linked', manualShares: 0, lotSize: position.code.startsWith('68') ? 200 : 100 });
      }
      await load(); setMessage(t('div_linked_added')); setError('');
    } catch { setError(t('div_save_error')); }
  };
  if (!data) return <div role="status">{error || t('loading')}</div>;
  const sharesFor = (stock: DividendStock) => stock.shareMode === 'manual' ? stock.manualShares : data.positions.get(stock.code)?.shares ?? 0;
  const held = data.stocks.filter(s => sharesFor(s) > 0);
  const covered = held.filter(s => effectiveDps(s) !== undefined);
  const estimated = covered.reduce((sum, s) => sum + dividendEstimateMinor(sharesFor(s), effectiveDps(s)!), 0);
  const weight = data.stocks.reduce((sum, s) => sum + s.weightBps, 0);
  const today = dateInChina();
  const staleCount = covered.filter(s => s.manualDpsMicros === undefined && (s.dividendFailedAt || s.dividend?.asOf !== today)).length;
  const untracked = [...data.positions.keys()].filter(code => !data.stocks.some(s => s.code === code)).length;
  const displayed = data.stocks.filter(s => (group === 'all' ? s.group !== 'hidden' : group === 'held' ? sharesFor(s) > 0 : s.group === group) && `${s.name} ${s.code}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b) => ({core:0,watch:1,hidden:2}[a.group] - {core:0,watch:1,hidden:2}[b.group]) || b.weightBps - a.weightBps || a.code.localeCompare(b.code));
  return <div className="dividend-page">
    <div className="page-header"><div><h1 className="page-title">{t('div_title')}</h1><p className="page-subtitle">{t('div_subtitle')}</p></div>
      <button className="btn btn-secondary" onClick={() => setAmountVisible(!amountVisible)}>{t(amountVisible ? 'div_hide_amounts' : 'div_show_amounts')}</button>
    </div>
    <section className="div-hero">
      <div className="div-estimate"><span>{t('div_annual_estimate')}</span><strong>{held.length > 0 && covered.length === 0 ? '—' : money(estimated)}</strong><small>{t('div_coverage', { count: covered.length, total: held.length })}{staleCount > 0 ? ` · ${t('div_cached_count', { count: staleCount })}` : ''}</small></div>
      <p className="div-muted">{t('div_estimate_note')}</p>
      <div className="div-budget"><label htmlFor="div-budget">{t('div_budget')}</label><div className="div-actions"><input id="div-budget" inputMode="decimal" type={amountVisible ? "number" : "password"} min="0" step="0.01" placeholder={t('div_budget_placeholder')} value={budgetInput} onChange={e => setBudgetInput(e.target.value)} /><button className="btn btn-primary" onClick={() => void persistBudget()}>{t('save')}</button></div></div>
      <p className={weight > 10000 ? 'div-warning' : 'div-muted'}>{t('div_allocated', { percent: numeric(weight / 100), remaining: money(Math.max(0, data.budgetMinor - stockBudgetMinor(data.budgetMinor, weight))) })}{weight > 10000 ? ` · ${t('div_over_budget')}` : ''}</p>
    </section>
    <div className="div-actions div-toolbar"><button className="btn btn-primary" disabled={Boolean(progress)} onClick={() => void refresh(data.stocks.map(s => s.code))}>{progress ? t('div_refresh_progress', progress) : t('div_refresh')}</button>
      <button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => { setIsNew(true); setEditor({ code: '', name: '', group: 'watch', weightBps: 0, shareMode: 'linked', manualShares: 0, lotSize: 100 }); }}>{t('div_add')}</button>
      <button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => void addLinked()}>{t('div_add_linked', { count: untracked })}</button></div>
    {message && <p className="div-notice" role="status">{message}</p>}{error && <p className="div-warning" role="alert">{error}</p>}
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
        <div className="div-stock-heading"><div><h2>{stock.name} <span>{stock.code}</span></h2><small>{t(`div_group_${stock.group}`)} · {numeric(stock.weightBps / 100)}%</small></div><button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => { setIsNew(false); setEditor(stock); }}>{t('edit')}</button></div>
        <div className="div-metrics">
          <div><span>{t('div_quote')}</span><strong>{stock.quote ? `¥${numeric(stock.quote.priceMinor / 100)}` : '—'}</strong><small>{stock.quote?.date ?? t('div_not_fetched')}</small></div>
          <div><span>{t('div_dps')}</span><strong>{dps !== undefined ? `¥${numeric(dps / 1e6, 6)}` : '—'}</strong><small>{t(stock.manualDpsMicros !== undefined ? 'div_manual' : 'div_ttm')}</small></div>
          <div><span>{t('div_shares')}</span><strong>{quantity(shares)}</strong><small>{t(stock.shareMode === 'manual' ? 'div_manual' : position ? 'div_linked' : 'div_no_link')}</small></div>
          <div><span>{t('div_annual_estimate')}</span><strong>{dps !== undefined ? money(dividendEstimateMinor(shares, dps)) : '—'}</strong><small>{t('div_yield', { value: dps !== undefined && stock.quote ? `${numeric(dps / stock.quote.priceMinor / 100)}%` : '—' })}</small></div>
        </div>
        <div className="div-budget-line">{t('div_stock_budget')} <strong>{money(budget)}</strong></div>
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
          {stock.note && <p className="div-note">{stock.note}</p>}
          <button className="btn btn-secondary" disabled={Boolean(progress)} onClick={() => void refresh([stock.code])}>{t('div_refresh_one')}</button>
        </details>
      </article>;
    })}</div>
    {displayed.length === 0 && <p className="div-notice">{t('div_empty')}</p>}
    {editor && <StockEditor initial={editor} isNew={isNew} existingCodes={data.stocks.map(s => s.code)} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await load(); }} />}
  </div>;
}

function StockEditor({ initial, isNew, existingCodes, onClose, onSaved }: { initial: DividendStock; isNew: boolean; existingCodes: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [stock, setStock] = useState(initial);
  const [dps, setDps] = useState(initial.manualDpsMicros === undefined ? '' : String(initial.manualDpsMicros / 1e6));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const patch = (value: Partial<DividendStock>) => setStock(s => ({ ...s, ...value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = mainlandCode(stock.code);
    if (!code || (isNew && existingCodes.includes(code)) || !stock.name.trim() || (dps !== '' && (!Number.isFinite(Number(dps)) || Number(dps) < 0))) { setError(t('div_invalid_stock')); return; }
    setSaving(true);
    try {
      await saveDividendStock({ ...stock, code, name: stock.name.trim(), manualDpsMicros: dps === '' ? undefined : Math.round(Number(dps) * 1e6) });
      await onSaved();
    } catch { setError(t('div_invalid_stock')); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    setSaving(true);
    try { await deleteDividendStock(initial.code); await onSaved(); } catch { setError(t('div_save_error')); }
    finally { setSaving(false); }
  };
  return <dialog className="div-dialog" ref={dialog} onCancel={onClose} aria-labelledby="div-editor-title"><form onSubmit={e => void save(e)}>
    <div className="div-stock-heading"><h2 id="div-editor-title">{t(isNew ? 'div_add' : 'div_edit')}</h2><button type="button" className="btn btn-secondary" onClick={onClose}>{t('close')}</button></div>
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
    <div className="div-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{t('save')}</button><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
      {!isNew && <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirmDelete(true)}>{t('delete')}</button>}</div>
    {confirmDelete && <div className="div-warning"><p>{t('div_delete_confirm')}</p><button type="button" className="btn btn-danger" disabled={saving} onClick={() => void remove()}>{t('delete')}</button></div>}
  </form></dialog>;
}
