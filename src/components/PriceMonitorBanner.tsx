import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import type { PriceMonitor } from '../lib/priceMonitor';
import { dismissPriceMonitorAlert, stopPriceMonitor } from '../services/priceMonitorService';
import './PriceMonitorBanner.css';

export default function PriceMonitorBanner() {
  const { t, i18n } = useTranslation();
  const [plans, setPlans] = useState<PriceMonitor[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const subscription = liveQuery(() => db.priceMonitors.toArray()).subscribe({
      next: rows => setPlans(rows.filter(row => row.alert && !row.alert.dismissedAt).sort((a, b) => (
        Number(b.alert!.kind === 'reached') - Number(a.alert!.kind === 'reached') || b.alert!.createdAt - a.alert!.createdAt
      ))),
      error: err => console.warn('Price alert load failed', err),
    });
    return () => subscription.unsubscribe();
  }, []);
  if (!plans.length) return null;
  const act = async (plan: PriceMonitor, stop: boolean) => {
    setBusy(plan.id); setError(false);
    try {
      if (stop) await stopPriceMonitor(plan.id);
      await dismissPriceMonitorAlert(plan.id);
    } catch { setError(true); }
    finally { setBusy(null); }
  };
  const price = (value: number) => (value / 1e6).toLocaleString(i18n.language, { maximumFractionDigits: 6 });
  return <aside className="price-monitor-banner" aria-label={t('price_monitor_title')}>
    <div className="price-monitor-banner-list" role="status" aria-live="polite">
      {(expanded ? plans : plans.slice(0, 1)).map(plan => <div className="price-monitor-banner-row" key={plan.id}>
        <div className="price-monitor-banner-copy">
          <strong>{t(`price_monitor_banner_${plan.alert!.kind}`, { name: plan.name })}</strong>
          <span>{t('price_monitor_banner_trigger', { price: price(plan.alert!.priceMicros), target: price(plan.targetPriceMicros), currency: plan.currency })}{plan.kind === 'gold' ? `/${t('unit_gram')}` : ''}</span>
          <small>{plan.alert!.date}</small>
        </div>
        <div className="price-monitor-banner-actions">
          {plan.status === 'active' && <button type="button" disabled={busy !== null} onClick={() => void act(plan, true)}>{t('price_monitor_stop')}</button>}
          <button type="button" disabled={busy !== null} onClick={() => void act(plan, false)} aria-label={t('price_monitor_banner_dismiss', { name: plan.name })}>✕</button>
        </div>
      </div>)}
    </div>
    {plans.length > 1 && <button type="button" className="price-monitor-banner-more" onClick={() => setExpanded(value => !value)}>
      {t(expanded ? 'price_monitor_banner_less' : 'price_monitor_banner_more', { count: plans.length - 1 })}
    </button>}
    {error && <p role="alert">{t('price_monitor_error')}</p>}
  </aside>;
}
