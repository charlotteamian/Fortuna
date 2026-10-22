import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db, type Account, type Holding } from '../db';
import { useAppContext } from '../app-context';
import type { PriceMonitor } from '../lib/priceMonitor';
import { resolveUsOptionContract } from '../lib/usOption';
import {
  deletePriceMonitor,
  listPriceMonitors,
  restartPriceMonitor,
  savePriceMonitor,
  stopPriceMonitor,
} from '../services/priceMonitorService';
import { refreshPriceMonitorQuotes } from '../services/priceMonitorQuoteService';
import './PriceMonitorPanel.css';

interface Props { kind: 'security' | 'gold'; accountId?: string; holdingId?: string; }
interface HistoricalHolding { holding: Holding; account: Account; }
const MARKET_CURRENCIES: Record<string, string> = { 'A股': 'CNY', '港股': 'HKD', '美股': 'USD' };
const CURRENCIES = ['CNY', 'USD', 'HKD', 'GBP', 'EUR', 'JPY', 'CHF', 'AUD', 'CAD', 'SGD'];
const securityIdentity = (symbol: string, market?: string) => {
  const value = symbol.trim();
  if (/^(sh|sz|bj)\d{6}$/i.test(value)) return { symbol: value.slice(2), market: 'A股' };
  if (/^hk\d{1,5}$/i.test(value)) return { symbol: value.slice(2), market: '港股' };
  if (/^us[A-Z.]+$/.test(value)) return { symbol: value.slice(2), market: '美股' };
  return { symbol: value, market: /美|US/i.test(market ?? '') ? '美股' : /港|HK/i.test(market ?? '') ? '港股' : 'A股' };
};
const displayPrice = (micros: number) => (micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 });
const decimalInteger = (value: string, digits: number): number | null => {
  const normalized = value.trim();
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
  return Number.isSafeInteger(result) ? result : null;
};

export default function PriceMonitorPanel({ kind, accountId, holdingId }: Props) {
  const { t, i18n } = useTranslation();
  const { settings } = useAppContext();
  const id = useId();
  const [plans, setPlans] = useState<PriceMonitor[]>([]);
  const [history, setHistory] = useState<HistoricalHolding[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [selectedHolding, setSelectedHolding] = useState('');
  const [linkedAccount, setLinkedAccount] = useState<string | undefined>(accountId);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [market, setMarket] = useState('A股');
  const [currency, setCurrency] = useState('CNY');
  const [target, setTarget] = useState('');
  const [tolerance, setTolerance] = useState('');
  const [direction, setDirection] = useState<PriceMonitor['direction']>('at_or_below');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [all, allHoldings, allAccounts] = await Promise.all([listPriceMonitors(), db.holdings.toArray(), db.accounts.toArray()]);
    setPlans(all.filter(plan => plan.kind === kind && (!accountId || plan.accountId === accountId)));
    setAccounts(allAccounts);
    const byId = new Map(allAccounts.map(account => [account.id, account]));
    setHistory(allHoldings.flatMap(holding => {
      const account = byId.get(holding.accountId);
      return account && account.type === 'asset' && ['股票/ETF', '股票'].includes(account.category)
        && !resolveUsOptionContract(holding) && (!accountId || account.id === accountId)
        ? [{ holding, account }] : [];
    }));
  }, [kind, accountId]);

  useEffect(() => {
    const reload = () => { void load().catch(() => setError(t('price_monitor_load_failed'))); };
    reload();
    window.addEventListener('price-monitors-changed', reload);
    return () => window.removeEventListener('price-monitors-changed', reload);
  }, [load, t]);

  const active = plans.filter(plan => plan.status === 'active');
  const ended = plans.filter(plan => plan.status !== 'active');
  const dateTime = (timestamp: number) => new Date(timestamp).toLocaleString(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-GB', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const unit = (planCurrency: string) => kind === 'gold' ? `${planCurrency}/${t('unit_gram')}` : planCurrency;
  const chooseHistorical = (value: string) => {
    setSelectedHolding(value);
    const entry = history.find(item => item.holding.id === value);
    if (entry) {
      const identity = securityIdentity(entry.holding.symbol ?? '', entry.holding.market);
      const nextMarket = identity.market;
      setName(entry.holding.name); setSymbol(identity.symbol);
      setMarket(nextMarket); setCurrency(MARKET_CURRENCIES[nextMarket]);
      setLinkedAccount(entry.account.id);
    } else {
      setName(''); setSymbol(''); setLinkedAccount(accountId);
    }
  };

  const newPlan = () => {
    setExpanded(true); setEditingId(undefined); setSelectedHolding(''); setLinkedAccount(accountId);
    setName(kind === 'gold' ? t('price_monitor_gold_name') : ''); setSymbol('');
    setMarket('A股'); setCurrency(kind === 'gold'
      ? accounts.find(account => account.id === accountId)?.currency ?? settings?.primaryCurrency ?? 'CNY' : 'CNY');
    setTarget(''); setTolerance(''); setDirection('at_or_below'); setError(''); setShowForm(true);
    if (kind === 'security' && holdingId) chooseHistorical(holdingId);
  };

  const editPlan = (plan: PriceMonitor) => {
    const identity = securityIdentity(plan.symbol ?? '', plan.market);
    setEditingId(plan.id); setName(plan.name); setSymbol(identity.symbol);
    setMarket(identity.market); setCurrency(plan.currency);
    setSelectedHolding(plan.holdingId ?? ''); setLinkedAccount(plan.accountId);
    setTarget(String(plan.targetPriceMicros / 1_000_000));
    setTolerance(String(plan.toleranceBps / 100)); setDirection(plan.direction);
    setError(''); setShowForm(true);
  };

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await load(); }
    catch { setError(t('price_monitor_action_failed')); }
    finally { setBusy(false); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetPriceMicros = decimalInteger(target, 6);
    const toleranceBps = decimalInteger(tolerance, 2);
    const validSymbol = market === 'A股' ? /^\d{6}$/.test(symbol.trim())
      : market === '港股' ? /^\d{1,5}$/.test(symbol.trim()) : /^[A-Z][A-Z0-9.-]{0,14}$/i.test(symbol.trim());
    if (!name.trim() || (kind === 'security' && !validSymbol) || targetPriceMicros == null
      || targetPriceMicros <= 0 || toleranceBps == null || toleranceBps > 10_000) {
      setError(t('price_monitor_validation')); return;
    }
    await run(async () => {
      await savePriceMonitor({ id: editingId, kind, name: name.trim(),
        symbol: kind === 'security' ? symbol.trim().toUpperCase() : undefined,
        market: kind === 'security' ? market : undefined,
        currency, accountId: linkedAccount, holdingId: selectedHolding || undefined,
        metalType: kind === 'gold' ? 'XAU' : undefined,
        targetPriceMicros, toleranceBps, direction });
      setShowForm(false);
      await refreshPriceMonitorQuotes({ force: true });
    });
  };

  const renderPlan = (plan: PriceMonitor) => (
    <article key={plan.id} className={`price-monitor-card price-monitor-${plan.status}`}>
      <div className="price-monitor-card-heading">
        <div><strong>{plan.name}</strong><small>{plan.symbol ? `${plan.symbol} · ` : ''}{unit(plan.currency)}</small></div>
        <span className="price-monitor-status">{t(`price_monitor_status_${plan.status}`)}</span>
      </div>
      <p className="price-monitor-target">{t(plan.direction === 'at_or_below' ? 'price_monitor_below_summary' : 'price_monitor_above_summary', {
        price: displayPrice(plan.targetPriceMicros), unit: unit(plan.currency),
      })}</p>
      <p className="price-monitor-note">{t('price_monitor_band_summary', { percent: plan.toleranceBps / 100 })}</p>
      {plan.lastQuote ? <p className="price-monitor-quote">{t('price_monitor_last_quote', {
        price: displayPrice(plan.lastQuote.priceMicros), unit: unit(plan.currency), date: plan.lastQuote.date, time: dateTime(plan.lastQuote.fetchedAt),
      })}</p> : <p className="price-monitor-note">{t('price_monitor_waiting')}</p>}
      {!!plan.lastErrorAt && <p className="price-monitor-error" role="status">{t('price_monitor_quote_failed', { time: dateTime(plan.lastErrorAt) })}</p>}
      {plan.status === 'active' && plan.alert?.kind === 'near' && !plan.alert.dismissedAt && <p className="price-monitor-near">{t('price_monitor_near')}</p>}
      <div className="price-monitor-actions">
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => editPlan(plan)}>{t('edit')}</button>
        {plan.status === 'active'
          ? <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void run(() => stopPriceMonitor(plan.id))}>{t('price_monitor_stop')}</button>
          : <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => void run(async () => {
            await restartPriceMonitor(plan.id); await refreshPriceMonitorQuotes({ force: true });
          })}>{t('price_monitor_restart')}</button>}
        <button type="button" className="price-monitor-delete" disabled={busy} onClick={() => setConfirmDelete(plan.id)}>{t('delete')}</button>
      </div>
      {confirmDelete === plan.id && <div className="price-monitor-confirm" role="group" aria-label={t('price_monitor_delete_confirm')}>
        <p>{t('price_monitor_delete_confirm')}</p>
        <div className="price-monitor-actions">
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setConfirmDelete(null)}>{t('cancel')}</button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void run(async () => {
            await deletePriceMonitor(plan.id); setConfirmDelete(null);
          })}>{t('confirm_delete')}</button>
        </div>
      </div>}
    </article>
  );

  return (
    <section className="price-monitor-panel" aria-label={t(`price_monitor_title_${kind}`)}>
      <button type="button" className="price-monitor-toggle" aria-expanded={expanded} aria-controls={`${id}-body`} onClick={() => setExpanded(value => !value)}>
        <span className="price-monitor-toggle-title"><span aria-hidden="true">◉</span>{t(`price_monitor_title_${kind}`)}
          <small>{t('price_monitor_active_count', { count: active.length })}</small></span>
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && <div id={`${id}-body`} className="price-monitor-body">
        <p className="price-monitor-note">{t('price_monitor_intro')}</p>
        <div className="price-monitor-actions price-monitor-toolbar">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={newPlan}>+ {t('price_monitor_add')}</button>
          <button type="button" className="btn btn-sm btn-secondary" disabled={busy || active.length === 0} onClick={() => void run(() => refreshPriceMonitorQuotes({ force: true }))}>
            {t(busy ? 'price_monitor_checking' : 'price_monitor_refresh')}
          </button>
        </div>
        {error && <p className="price-monitor-error" role="alert">{error}</p>}
        {showForm && <form className="price-monitor-form" onSubmit={event => void save(event)}>
          <h3>{t(editingId ? 'price_monitor_edit' : 'price_monitor_add')}</h3>
          {kind === 'security' && history.length > 0 && <label htmlFor={`${id}-history`}>
            <span>{t('price_monitor_from_history')}</span>
            <select id={`${id}-history`} className="form-select" value={selectedHolding} disabled={busy} onChange={event => chooseHistorical(event.target.value)}>
              <option value="">{t('price_monitor_new_security')}</option>
              {history.map(({ holding, account }) => <option key={holding.id} value={holding.id}>{holding.name} {holding.symbol ?? ''} · {account.name}</option>)}
            </select>
          </label>}
          <label htmlFor={`${id}-name`}><span>{t('price_monitor_name')}</span>
            <input id={`${id}-name`} className="form-input" value={name} maxLength={100} required disabled={busy} onChange={event => setName(event.target.value)} />
          </label>
          {kind === 'security' && <div className="price-monitor-form-grid">
            <label htmlFor={`${id}-symbol`}><span>{t('price_monitor_symbol')}</span>
              <input id={`${id}-symbol`} className="form-input" value={symbol} maxLength={24} required autoCapitalize="characters" autoComplete="off" disabled={busy}
                onChange={event => { setSymbol(event.target.value); setSelectedHolding(''); }} />
            </label>
            <label htmlFor={`${id}-market`}><span>{t('price_monitor_market')}</span>
              <select id={`${id}-market`} className="form-select" value={market} disabled={busy} onChange={event => {
                setMarket(event.target.value); setCurrency(MARKET_CURRENCIES[event.target.value]); setSelectedHolding('');
              }}>
                {Object.keys(MARKET_CURRENCIES).map(value => <option key={value} value={value}>{t(`price_monitor_market_${MARKET_CURRENCIES[value]}`)}</option>)}
              </select>
            </label>
          </div>}
          {kind === 'gold' && <label htmlFor={`${id}-currency`}><span>{t('price_monitor_currency_gram')}</span>
            <select id={`${id}-currency`} className="form-select" value={currency} disabled={busy} onChange={event => setCurrency(event.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map(value => <option key={value} value={value}>{value}/{t('unit_gram')}</option>)}
            </select>
          </label>}
          <label htmlFor={`${id}-direction`}><span>{t('price_monitor_condition')}</span>
            <select id={`${id}-direction`} className="form-select" value={direction} disabled={busy} onChange={event => setDirection(event.target.value as PriceMonitor['direction'])}>
              <option value="at_or_below">{t('price_monitor_direction_below')}</option>
              <option value="at_or_above">{t('price_monitor_direction_above')}</option>
            </select>
          </label>
          <div className="price-monitor-form-grid">
            <label htmlFor={`${id}-target`}><span>{t('price_monitor_target', { unit: unit(currency) })}</span>
              <input id={`${id}-target`} className="form-input" type="text" inputMode="decimal" value={target} required disabled={busy}
                aria-describedby={`${id}-rules`} onChange={event => setTarget(event.target.value)} />
            </label>
            <label htmlFor={`${id}-tolerance`}><span>{t('price_monitor_tolerance')}</span>
              <input id={`${id}-tolerance`} className="form-input" type="text" inputMode="decimal" value={tolerance} placeholder={t('price_monitor_tolerance_placeholder')}
                required disabled={busy} aria-describedby={`${id}-rules`} onChange={event => setTolerance(event.target.value)} />
            </label>
          </div>
          <p id={`${id}-rules`} className="price-monitor-note">{t('price_monitor_rules')}</p>
          {kind === 'gold' && <p className="price-monitor-note">{t('price_monitor_gold_source')}</p>}
          <div className="price-monitor-actions">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{t('price_monitor_save')}</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => { setShowForm(false); setError(''); }}>{t('cancel')}</button>
          </div>
        </form>}
        {active.map(renderPlan)}
        {plans.length === 0 && !showForm && <p className="price-monitor-empty">{t('price_monitor_empty')}</p>}
        {ended.length > 0 && <details className="price-monitor-ended"><summary>{t('price_monitor_ended_count', { count: ended.length })}</summary>{ended.map(renderPlan)}</details>}
        <p className="price-monitor-schedule">{t('price_monitor_schedule')}</p>
      </div>}
    </section>
  );
}
