import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateInChina } from '../lib/dividendWorkbench';
import { dividendFundAllocation, dividendFundEntry, type DividendFund, type DividendFundPlan } from '../lib/dividendFundPlan';
import { deleteDividendFund, saveDividendFund, saveDividendFundConfig } from '../services/dividendFundService';

const number = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const optionalNumber = (value: number | undefined, scale: number) => value === undefined ? '' : String(value / scale);
const errorKey = (error: unknown) => error instanceof Error && error.message === 'DIVIDEND_FUND_OVERWEIGHT' ? 'df_overweight'
  : error instanceof Error && error.message === 'DIVIDEND_FUND_DUPLICATE' ? 'df_duplicate' : 'df_invalid';

export default function DividendFundWorkbench({ plan, amountVisible, onSaved }: { plan: DividendFundPlan; amountVisible: boolean; onSaved: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [budget, setBudget] = useState(optionalNumber(plan.budgetMinor, 100));
  const [mode, setMode] = useState(plan.mode);
  const [entryRule, setEntryRule] = useState(plan.entryRule);
  const [drawdown, setDrawdown] = useState(String(plan.drawdownBps / 100));
  const [indexYield, setIndexYield] = useState(String(plan.indexYieldBps / 100));
  const [editor, setEditor] = useState<DividendFund | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    setBudget(optionalNumber(plan.budgetMinor, 100)); setMode(plan.mode); setEntryRule(plan.entryRule);
    setDrawdown(String(plan.drawdownBps / 100)); setIndexYield(String(plan.indexYieldBps / 100));
  }, [plan.budgetMinor, plan.mode, plan.entryRule, plan.drawdownBps, plan.indexYieldBps]);
  const money = (minor: number) => amountVisible ? `¥${number(minor / 100)}` : '••••';
  const allocation = dividendFundAllocation(plan);
  const persist = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if ((budget !== '' && (!Number.isFinite(Number(budget)) || Number(budget) < 0)) || !drawdown.trim() || !indexYield.trim()) { setError(t('df_invalid')); return; }
    setSaving(true); setError('');
    try {
      await saveDividendFundConfig({ budgetMinor: budget === '' ? undefined : Math.round(Number(budget) * 100), mode, entryRule, drawdownBps: Math.round(Number(drawdown) * 100), indexYieldBps: Math.round(Number(indexYield) * 100) });
      await onSaved(); setMessage(t('div_saved'));
    } catch (error) { setError(t(errorKey(error))); }
    finally { setSaving(false); }
  };
  const funds = plan.funds.filter(fund => `${fund.name} ${fund.code ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.weightBps - a.weightBps || a.name.localeCompare(b.name));
  return <>
    <section className="div-hero">
      <div className="div-estimate"><span>{t('df_planned_budget')}</span><strong>{plan.budgetMinor === undefined ? '—' : money(plan.budgetMinor)}</strong><small>{t(`df_mode_${plan.mode}`)}</small></div>
      {plan.mode === 'rebalance' && <div className="div-budget-line"><span>{t('df_equity_budget')} <strong>{money(allocation.fundBudgetMinor)}</strong></span><span>{t('df_bond_budget')} <strong>{money(allocation.bondBudgetMinor)}</strong></span></div>}
      <p className="div-muted">{t('df_allocation', { percent: number(allocation.totalWeightBps / 100), remaining: money(allocation.unallocatedMinor) })}</p>
      <p className="div-muted">{t('df_weight_note')}</p>
      <details className="div-method df-plan-settings" open={plan.budgetMinor === undefined}><summary>{t('df_edit_plan')}</summary><form onSubmit={event => void persist(event)} className="div-budget df-config">
        <fieldset disabled={saving}>
          <div className="div-form-fields">
            <label>{t('df_planned_budget')}<input inputMode="decimal" type={amountVisible ? 'number' : 'password'} min="0" max="1000000000000" step="0.01" placeholder={t('div_budget_placeholder')} value={budget} onChange={event => setBudget(event.target.value)} /></label>
            <label>{t('df_mode')}<select value={mode} onChange={event => setMode(event.target.value as DividendFundPlan['mode'])}>{(['hold', 'rebalance', 'swing'] as const).map(value => <option key={value} value={value}>{t(`df_mode_${value}`)}</option>)}</select></label>
          </div>
          <p className="div-muted">{t(`df_mode_${mode}_note`)}</p>
          <details className="div-method"><summary>{t('df_entry_settings')}</summary><div className="div-form-fields">
            <label>{t('df_drawdown_threshold')}<input required type="number" inputMode="decimal" min="0.01" max="99.99" step="0.01" value={drawdown} onChange={event => setDrawdown(event.target.value)} /></label>
            <label>{t('df_yield_threshold')}<input required type="number" inputMode="decimal" min="0.01" max="100" step="0.01" value={indexYield} onChange={event => setIndexYield(event.target.value)} /></label>
            <label>{t('df_entry_rule')}<select value={entryRule} onChange={event => setEntryRule(event.target.value as DividendFundPlan['entryRule'])}><option value="both">{t('df_rule_both')}</option><option value="either">{t('df_rule_either')}</option></select></label>
          </div><p className="div-muted">{t('df_yield_note')}</p></details>
          <button type="submit" className="btn btn-primary">{t(saving ? 'loading' : 'df_save_plan')}</button>
        </fieldset>
      </form></details>
    </section>
    <section className="df-entry-guide"><strong>{t('df_entry_summary', { drawdown: number(plan.drawdownBps / 100), yield: number(plan.indexYieldBps / 100), rule: t(`df_rule_${plan.entryRule}`) })}</strong><p className="div-muted">{t('df_reference_note')}</p></section>
    <div className="div-actions div-toolbar"><button className="btn btn-primary" disabled={saving} onClick={() => { setMessage(''); setEditor({ id: crypto.randomUUID(), name: '', indexKind: 'low_volatility', weightBps: 0 }); }}>{t('df_add')}</button></div>
    {message && <p className="div-notice" role="status">{message}</p>}{error && <p className="div-warning" role="alert">{error}</p>}
    <input className="div-search" aria-label={t('df_search')} placeholder={t('df_search')} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="div-stock-list df-fund-list">{funds.map(fund => {
      const reference = dividendFundEntry(plan, fund);
      return <article className="div-stock" key={fund.id}>
        <div className="div-stock-heading"><div><h2>{fund.name}</h2><small>{t(`df_index_${fund.indexKind}`)}{fund.code ? ` · ${fund.code}` : ''}</small></div><button className="btn btn-secondary" disabled={saving} onClick={() => setEditor(fund)}>{t('edit')}</button></div>
        <div className="div-budget-line"><span>{t('df_weight')} <strong>{number(fund.weightBps / 100)}%</strong></span><span>{t('df_target_amount')} <strong>{plan.budgetMinor === undefined ? '—' : money(allocation.amounts.get(fund.id) ?? 0)}</strong></span></div>
        {fund.note && <div className="div-note"><span>{t('div_note')}</span><p>{fund.note}</p></div>}
        <p className={reference.status === 'met' ? 'div-notice' : 'div-muted'}>{t(`df_signal_${reference.status}`)}</p>
        {fund.reference && <>
          <div className="div-metrics">
            <div><span>{t('df_current_price')}</span><strong>{fund.reference.priceMicros === undefined ? '—' : `¥${number(fund.reference.priceMicros / 1e6, 6)}`}</strong></div>
            <div><span>{t('df_current_drawdown')}</span><strong>{reference.drawdownBps === undefined ? '—' : `${number(reference.drawdownBps / 100)}%`}</strong></div>
            <div><span>{t('df_index_yield')}</span><strong>{fund.reference.indexYieldBps === undefined ? '—' : `${number(fund.reference.indexYieldBps / 100)}%`}</strong></div>
            <div><span>{t('df_entry_price', { percent: number(plan.drawdownBps / 100) })}</span><strong>{reference.targetPriceMicros === undefined ? '—' : `¥${number(reference.targetPriceMicros / 1e6, 6)}`}</strong></div>
            {plan.mode === 'swing' && <div><span>{t('df_exit_price')}</span><strong>{fund.reference.highMicros === undefined ? '—' : `¥${number(fund.reference.highMicros / 1e6, 6)}`}</strong></div>}
          </div>
          <p className="div-muted">{t('df_data_source', { date: fund.reference.asOf, source: fund.reference.source || t('df_manual_source') })}</p>
        </>}
      </article>;
    })}</div>
    {funds.length === 0 && <p className="div-notice">{t(plan.funds.length ? 'df_no_match' : 'df_empty')}</p>}
    <details className="div-method"><summary>{t('df_method')}</summary><p>{t('df_method_modes')}</p><p>{t('df_method_selection')}</p><p>{t('df_method_cost')}</p><p><a href="https://etf.sse.com.cn/fundtrends/c/5733322.shtml" target="_blank" rel="noreferrer">{t('df_example_source')}</a></p></details>
    {editor && <FundEditor initial={editor} plan={plan} amountVisible={amountVisible} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await onSaved(); setError(''); setMessage(t('div_saved')); }} />}
  </>;
}

function FundEditor({ initial, plan, amountVisible, onClose, onSaved }: { initial: DividendFund; plan: DividendFundPlan; amountVisible: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code ?? '');
  const [indexKind, setIndexKind] = useState(initial.indexKind);
  const [weight, setWeight] = useState(String(initial.weightBps / 100));
  const [note, setNote] = useState(initial.note ?? '');
  const [price, setPrice] = useState(optionalNumber(initial.reference?.priceMicros, 1e6));
  const [high, setHigh] = useState(optionalNumber(initial.reference?.highMicros, 1e6));
  const [indexYield, setIndexYield] = useState(optionalNumber(initial.reference?.indexYieldBps, 100));
  const [date, setDate] = useState(initial.reference?.asOf ?? dateInChina());
  const [source, setSource] = useState(initial.reference?.source ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const existing = plan.funds.some(fund => fund.id === initial.id);
  const used = plan.funds.filter(fund => fund.id !== initial.id).reduce((sum, fund) => sum + fund.weightBps, 0);
  const previewFund = { ...initial, weightBps: Math.round(Number(weight) * 100) };
  const preview = Number.isFinite(Number(weight)) && Number(weight) >= 0 && used + previewFund.weightBps <= 10000
    ? dividendFundAllocation({ ...plan, funds: [...plan.funds.filter(fund => fund.id !== initial.id), previewFund] }).amounts.get(initial.id) : undefined;
  const persist = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!weight.trim() || [weight, price, high, indexYield].some(value => value !== '' && !Number.isFinite(Number(value)))) { setError(t('df_invalid')); return; }
    setSaving(true); setError('');
    try {
      await saveDividendFund({ id: initial.id, name: name.trim(), code: code.trim() || undefined, indexKind, weightBps: Math.round(Number(weight) * 100), note: note.trim() || undefined,
        reference: [price, high, indexYield].some(value => value !== '') ? { priceMicros: price === '' ? undefined : Math.round(Number(price) * 1e6), highMicros: high === '' ? undefined : Math.round(Number(high) * 1e6), indexYieldBps: indexYield === '' ? undefined : Math.round(Number(indexYield) * 100), asOf: date, source: source.trim() || undefined } : undefined });
      await onSaved();
    } catch (error) { setError(t(errorKey(error))); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (saving) return;
    setSaving(true);
    try { await deleteDividendFund(initial.id); await onSaved(); }
    catch { setError(t('div_save_error')); }
    finally { setSaving(false); }
  };
  return <dialog className="div-dialog" ref={dialog} aria-labelledby="df-editor-title" onCancel={event => { if (saving) event.preventDefault(); else onClose(); }}><form onSubmit={event => void persist(event)}>
    <div className="div-stock-heading"><h2 id="df-editor-title">{t(existing ? 'df_edit' : 'df_add')}</h2><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('close')}</button></div>
    <fieldset disabled={saving}>
      <div className="div-form-fields">
        <label>{t('df_name')}<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} autoFocus /></label>
        <label>{t('df_code')}<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} /></label>
        <label>{t('df_index')}<select value={indexKind} onChange={event => setIndexKind(event.target.value as DividendFund['indexKind'])}>{(['low_volatility', 'low_volatility_100', 'other'] as const).map(value => <option key={value} value={value}>{t(`df_index_${value}`)}</option>)}</select></label>
        <label>{t('df_weight')}<input required type="number" inputMode="decimal" min="0" max="100" step="0.01" value={weight} onChange={event => setWeight(event.target.value)} /></label>
      </div>
      <p className="div-muted">{t('df_available_weight', { percent: number((10000 - used) / 100) })}</p>
      <p className="div-notice">{t('df_target_amount')}：{plan.budgetMinor === undefined || preview === undefined ? '—' : amountVisible ? `¥${number(preview / 100)}` : '••••'}</p>
      <label className="div-form-note">{t('div_note')}<textarea maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
      <details className="div-method"><summary>{t('df_reference_optional')}</summary><p>{t('df_reference_input_note')}</p><div className="div-form-fields">
        <label>{t('df_current_price')}<input type="number" inputMode="decimal" min="0.000001" max="1000000" step="0.000001" value={price} onChange={event => setPrice(event.target.value)} /></label>
        <label>{t('df_high')}<input type="number" inputMode="decimal" min="0.000001" max="1000000" step="0.000001" value={high} onChange={event => setHigh(event.target.value)} /></label>
        <label>{t('df_index_yield')}<input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={indexYield} onChange={event => setIndexYield(event.target.value)} /></label>
        <label>{t('df_as_of')}<input type="date" max={dateInChina()} value={date} onChange={event => setDate(event.target.value)} /></label>
        <label>{t('df_source')}<input maxLength={300} placeholder={t('df_manual_source')} value={source} onChange={event => setSource(event.target.value)} /></label>
      </div></details>
      {error && <p className="div-warning" role="alert">{error}</p>}
      <div className="div-actions"><button type="submit" className="btn btn-primary">{t('save')}</button><button type="button" className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>{existing && <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(true)}>{t('delete')}</button>}</div>
      {confirmDelete && <section className="div-delete-preview"><p className="div-warning">{t('df_delete_note', { name: initial.name, percent: number(initial.weightBps / 100) })}</p><div className="div-actions"><button type="button" className="btn btn-danger" onClick={() => void remove()}>{t('div_delete_apply')}</button><button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>{t('cancel')}</button></div></section>}
    </fieldset>
  </form></dialog>;
}
