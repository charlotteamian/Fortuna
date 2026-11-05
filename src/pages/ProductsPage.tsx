import { useState, useEffect, useCallback, useMemo } from 'react';
import './ProductsPage.css';
import { getAccountsWithLatest, type AccountWithLatest } from '../services/assetService';
import { initializeSettings, type Settings } from '../db';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../app-context';
import { getFieldsForCategory } from '../lib/categoryFields';
import { RATES_REFRESHED_EVENT } from '../services/rateService';
import { isAccountHidden, isAccountIncludedInTotals } from '../lib/accountPreferences';

const COLORS = ['#818cf8','#34d399','#60a5fa','#c084fc','#fbbf24','#f472b6','#22d3ee','#a3e635','#fb923c','#2dd4bf'];

export default function AccountPage() {
  const { t, i18n } = useTranslation();
  const { amountVisible } = useAppContext();
  const [acctData, setAcctData] = useState<{ accounts: AccountWithLatest[]; totalAssets: number; totalLiabilities: number; netWorth: number } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setLoadError(false);
    try {
      const [data, s] = await Promise.all([getAccountsWithLatest(), initializeSettings()]);
      setAcctData(data);
      setSettings(s);
    } catch (error) {
      console.error('Account overview load failed', error);
      setLoadError(true);
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(false); };
    window.addEventListener(RATES_REFRESHED_EVENT, refresh);
    return () => window.removeEventListener(RATES_REFRESHED_EVENT, refresh);
  }, [load]);

  const fmt = (n: number) => {
    const isEn = i18n.language.startsWith('en');
    if (isEn) {
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + t('unit_yi');
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + t('unit_wan');
      return n.toFixed(0);
    }
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + t('unit_yi');
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + t('unit_wan');
    return n.toFixed(0);
  };

  const masked = (text: string) => amountVisible ? text : '****';

  const grouped = useMemo(() => {
    if (!acctData) return {};
    const map: Record<string, AccountWithLatest[]> = {};
    for (const acct of acctData.accounts) {
      if (isAccountHidden(acct)) continue;
      const key = acct.institution?.trim() || t('no_institution');
      if (!map[key]) map[key] = [];
      map[key].push(acct);
    }
    return map;
  }, [acctData, t]);

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const instList = useMemo(() => {
    return Object.entries(grouped).sort(([, a], [, b]) => {
      const sumA = a.filter(x => x.type === 'asset' && isAccountIncludedInTotals(x)).reduce((s, x) => s + x.convertedAmount, 0);
      const sumB = b.filter(x => x.type === 'asset' && isAccountIncludedInTotals(x)).reduce((s, x) => s + x.convertedAmount, 0);
      return sumB - sumA;
    });
  }, [grouped]);
  const visibleAccountCount = acctData?.accounts.filter(account => !isAccountHidden(account)).length ?? 0;

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (loadError && !acctData) return (
    <div className="empty-state" role="alert">
      <div className="empty-icon">⚠️</div>
      <div className="empty-text">{t('load_failed')}</div>
      <div className="empty-hint">{t('load_failed_hint')}</div>
      <button type="button" className="btn btn-primary" onClick={() => void load()}>{t('retry')}</button>
    </div>
  );

  if (!acctData || acctData.accounts.length === 0) {
    return (
      <>
        <div className="page-header"><div><h1 className="page-title">{t('account_overview')}</h1><p className="page-subtitle">{t('account_overview_subtitle')}</p></div></div>
        <div className="empty-state"><div className="empty-icon">🏦</div><div className="empty-text">{t('start_tracking')}</div><div className="empty-hint">{t('add_first_hint')}</div></div>
      </>
    );
  }

  return (
    <div className="accounts-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('account_overview')}</h1>
          <p className="page-subtitle">{t('account_overview_subtitle')}</p>
        </div>
        <div className="accounts-total">
          <div className="accounts-total-label">{t('total_assets')}</div>
          <div className="accounts-total-value">{masked(fmt(acctData.totalAssets))}</div>
        </div>
      </div>
      {acctData.accounts.some(account => isAccountIncludedInTotals(account) && account.conversionUnavailable) && (
        <div className="valuation-warning" role="status">
          ⚠️ {t('some_values_excluded', { count: acctData.accounts.filter(account => isAccountIncludedInTotals(account) && account.conversionUnavailable).length })}
        </div>
      )}

      <div className="accounts-list">
        {visibleAccountCount === 0 && (
          <div className="empty-state" style={{ padding: 'var(--sp-8) var(--sp-4)' }}>
            <div className="empty-icon">🙈</div>
            <div className="empty-text">{t('all_accounts_hidden')}</div>
            <div className="empty-hint">{t('all_accounts_hidden_hint')}</div>
          </div>
        )}
        {instList.map(([inst, accounts], idx) => {
          const assetAccts = accounts.filter(a => a.type === 'asset');
          const liabAccts = accounts.filter(a => a.type === 'liability');
          const assetTotal = assetAccts.filter(isAccountIncludedInTotals).reduce((s, a) => s + a.convertedAmount, 0);
          const liabTotal = liabAccts.filter(isAccountIncludedInTotals).reduce((s, a) => s + a.convertedAmount, 0);
          const isExpanded = expanded.has(inst);
          const avatarColor = COLORS[idx % COLORS.length];
          const initial = inst.replace(/[（(].*/, '').trim()[0] || '?';

          return (
            <div key={inst} className="inst-card">
              {/* Institution header */}
              <button type="button" className="inst-header" onClick={() => toggle(inst)} aria-expanded={isExpanded}>
                <div className="inst-avatar" style={{ background: avatarColor + '22', color: avatarColor, border: `1.5px solid ${avatarColor}44` }}>
                  {initial}
                </div>
                <div className="inst-info">
                  <span className="inst-name">{inst}</span>
                  <div className="inst-meta">
                    {assetTotal > 0 && <span className="inst-meta-amount" style={{ color: 'var(--asset-color)' }}>{masked(fmt(assetTotal))}</span>}
                    {liabTotal > 0 && <span className="inst-meta-amount liability" style={{ color: 'var(--liability-color)' }}>－{masked(fmt(liabTotal))}</span>}
                    <span className="inst-meta-count">{t('item_count', { count: accounts.length })}</span>
                  </div>
                </div>
                <span className="inst-caret">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {/* Account list */}
              {isExpanded && (
                <div className="inst-list">
                  {accounts.map(acct => {
                    const catColor = acct.type === 'asset' ? 'var(--asset-color)' : 'var(--liability-color)';
                    const catDim = acct.type === 'asset' ? 'var(--asset-dim)' : 'var(--liability-dim)';
                    const hasProductData = acct.productData && Object.keys(acct.productData).some(k => acct.productData![k]);
                    return (
                      <div key={acct.id} className="acct-item">
                        <div className="acct-row">
                          <div className="acct-main">
                            <div className="acct-name">{acct.name}</div>
                            <div className="acct-sub">
                              <span className="acct-tag" style={{ background: catDim, color: catColor }}>{t(acct.category)}</span>
                              {!isAccountIncludedInTotals(acct) && <span>{t('excluded_from_totals_badge')}</span>}
                              <span>{acct.currency}</span>
                            </div>
                          </div>
                          <div className="acct-figures">
                            <div className="acct-amount" style={{ color: catColor }}>
                              {masked(acct.unit === 'gram'
                                ? `${acct.latestAmount.toFixed(2)}g`
                                : acct.latestAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                              )}
                            </div>
                            {acct.currency !== settings?.primaryCurrency && (
                              <div className="acct-converted">
                                {acct.conversionUnavailable ? t('conversion_unavailable') : `≈${masked(fmt(acct.convertedAmount))}`}
                              </div>
                            )}
                          </div>
                        </div>
                        {hasProductData && settings && (() => {
                          const fieldDefs = getFieldsForCategory(acct.category, settings, t);
                          const labelMap: Record<string, string> = {};
                          fieldDefs.forEach(f => { labelMap[f.key] = f.label; });
                          return (
                            <div className="data-grid">
                              {Object.entries(acct.productData!).filter(([, v]) => v).slice(0, 4).map(([k, v]) => (
                                <div key={k} className="data-cell">
                                  <span className="data-key">{labelMap[k] || k}</span>
                                  <span className="data-val">{v}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
