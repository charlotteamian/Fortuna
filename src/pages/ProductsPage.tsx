import type React from 'react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAccountsWithLatest, type AccountWithLatest } from '../services/assetService';
import { initializeSettings, type Settings } from '../db';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../app-context';
import { getFieldsForCategory } from '../lib/categoryFields';

const COLORS = ['#818cf8','#34d399','#60a5fa','#c084fc','#fbbf24','#f472b6','#22d3ee','#a3e635','#fb923c','#2dd4bf'];

export default function AccountPage() {
  const { t, i18n } = useTranslation();
  const { theme, amountVisible } = useAppContext();
  const [acctData, setAcctData] = useState<{ accounts: AccountWithLatest[]; totalAssets: number; totalLiabilities: number; netWorth: number } | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [data, s] = await Promise.all([getAccountsWithLatest(), initializeSettings()]);
    setAcctData(data);
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
      const sumA = a.filter(x => x.type === 'asset').reduce((s, x) => s + x.convertedAmount, 0);
      const sumB = b.filter(x => x.type === 'asset').reduce((s, x) => s + x.convertedAmount, 0);
      return sumB - sumA;
    });
  }, [grouped]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  if (!acctData || acctData.accounts.length === 0) {
    return (
      <>
        <div className="page-header"><div><h1 className="page-title">{t('account_overview')}</h1><p className="page-subtitle">{t('account_overview_subtitle')}</p></div></div>
        <div className="empty-state"><div className="empty-icon">🏦</div><div className="empty-text">{t('start_tracking')}</div><div className="empty-hint">{t('add_first_hint')}</div></div>
      </>
    );
  }

  return (
    <div style={{ paddingBottom: 80 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('account_overview')}</h1>
          <p className="page-subtitle">{t('account_overview_subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('total_assets')}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: theme.assetColor }}>{masked(fmt(acctData.totalAssets))}</div>
        </div>
      </div>

      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {instList.map(([inst, accounts], idx) => {
          const assetAccts = accounts.filter(a => a.type === 'asset');
          const liabAccts = accounts.filter(a => a.type === 'liability');
          const assetTotal = assetAccts.reduce((s, a) => s + a.convertedAmount, 0);
          const liabTotal = liabAccts.reduce((s, a) => s + a.convertedAmount, 0);
          const isExpanded = expanded.has(inst);
          const avatarColor = COLORS[idx % COLORS.length];
          const initial = inst.replace(/[（(].*/, '').trim()[0] || '?';

          return (
            <div key={inst} style={S.card}>
              {/* Institution header */}
              <div style={S.instHeader} onClick={() => toggle(inst)}>
                <div style={{ ...S.avatar, background: avatarColor + '22', color: avatarColor, border: `1.5px solid ${avatarColor}44` }}>
                  {initial}
                </div>
                <div style={S.instInfo}>
                  <span style={S.instName}>{inst}</span>
                  <div style={S.instMeta}>
                    {assetTotal > 0 && <span style={{ color: theme.assetColor, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{masked(fmt(assetTotal))}</span>}
                    {liabTotal > 0 && <span style={{ color: theme.liabilityColor, fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>－{masked(fmt(liabTotal))}</span>}
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{accounts.length} 项</span>
                  </div>
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{isExpanded ? '▲' : '▼'}</span>
              </div>

              {/* Account list */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  {accounts.map(acct => {
                    const catColor = acct.type === 'asset' ? theme.assetColor : theme.liabilityColor;
                    const catDim = acct.type === 'asset' ? theme.assetDim : theme.liabilityDim;
                    const hasProductData = acct.productData && Object.keys(acct.productData).some(k => acct.productData![k]);
                    return (
                      <div key={acct.id} style={S.acctItem}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{acct.name}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>
                                <span style={{ background: catDim, color: catColor, borderRadius: 8, padding: '1px 6px', fontSize: '0.68rem', fontWeight: 600 }}>{t(acct.category)}</span>
                                <span style={{ marginLeft: 5 }}>{acct.currency}</span>
                              </div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 700, color: catColor }}>
                              {masked(acct.unit === 'gram'
                                ? `${acct.latestAmount.toFixed(2)}g`
                                : acct.latestAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                              )}
                            </div>
                            {acct.currency !== settings?.primaryCurrency && acct.convertedAmount > 0 && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>≈{masked(fmt(acct.convertedAmount))}</div>
                            )}
                          </div>
                        </div>
                        {hasProductData && settings && (() => {
                          const fieldDefs = getFieldsForCategory(acct.category, settings, t);
                          const labelMap: Record<string, string> = {};
                          fieldDefs.forEach(f => { labelMap[f.key] = f.label; });
                          return (
                            <div style={S.dataGrid}>
                              {Object.entries(acct.productData!).filter(([, v]) => v).slice(0, 4).map(([k, v]) => (
                                <div key={k} style={S.dataCell}>
                                  <span style={S.dataKey}>{labelMap[k] || k}</span>
                                  <span style={S.dataVal}>{v}</span>
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

const S: Record<string, React.CSSProperties> = {
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' },
  instHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', cursor: 'pointer', userSelect: 'none' },
  avatar: { width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 700, flexShrink: 0 },
  instInfo: { flex: 1, minWidth: 0 },
  instName: { fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block' },
  instMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 },
  acctItem: { padding: '10px 14px', borderTop: '1px solid var(--border)' },
  dataGrid: { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6 },
  dataCell: { display: 'flex', gap: 4, alignItems: 'center' },
  dataKey: { fontSize: '0.68rem', color: 'var(--text-muted)' },
  dataVal: { fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 500 },
};
