import { useState, useEffect, useRef } from 'react';
import { getAccount, getRecords, addRecord, updateRecord, deleteRecord, updateAccount,
  addMetalTransaction, updateMetalTransaction, computeMetalPosition, restoreAccount } from '../services/assetService';
import { initializeSettings, type Account, type AccountRecord, type Settings, METAL_TYPES } from '../db';
import { getMetalPricePerGram } from '../services/rateService';
import { useAppContext } from '../app-context';
import { useTranslation } from 'react-i18next';
import { getFieldsForCategory } from '../lib/categoryFields';
import PortfolioPanel from '../components/PortfolioPanel';

interface Props { accountId: string; onBack: () => void; }

export default function AccountDetail({ accountId, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, amountVisible } = useAppContext();
  const [account, setAccount] = useState<Account | null>(null);
  const [records, setRecords] = useState<AccountRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AccountRecord | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameText, setNameText] = useState('');
  const [stockShares, setStockShares] = useState('');
  const [stockPrice, setStockPrice] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newAmount, setNewAmount] = useState('');
  const [newNote, setNewNote] = useState('');
  const [metalPricePerGram, setMetalPricePerGram] = useState<number | null>(null);
  // Precious-metal buy/sell transaction modal
  const [showMetalTxn, setShowMetalTxn] = useState(false);
  const [metalKind, setMetalKind] = useState<'buy' | 'sell'>('buy');
  const [txnGrams, setTxnGrams] = useState('');
  const [txnPrice, setTxnPrice] = useState('');
  const [editingMetalRec, setEditingMetalRec] = useState<AccountRecord | null>(null);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
    if (touchStartX.current < 50 && deltaX > 80 && deltaY < 60) onBack();
    touchStartX.current = null; touchStartY.current = null;
  };

  // Silent by default so in-place refreshes (e.g. from PortfolioPanel) don't unmount children
  const load = async (initial = false) => {
    if (initial) setLoading(true);
    const [a, r, s] = await Promise.all([getAccount(accountId), getRecords(accountId), initializeSettings()]);
    setAccount(a || null);
    setRecords(r);
    setSettings(s);
    setNameText(a?.name || '');
    if (a?.unit === 'gram' && a.metalType) {
      const ppg = await getMetalPricePerGram(a.metalType, a.currency, s.goldPriceSource ?? 'international');
      setMetalPricePerGram(ppg);
    }
    setLoading(false);
  };

  const [showEditProductData, setShowEditProductData] = useState(false);
  const [editInstitution, setEditInstitution] = useState('');
  const [editProductData, setEditProductData] = useState<Record<string, string>>({});

  const [refreshingMetal, setRefreshingMetal] = useState(false);
  const handleRefreshMetal = async () => {
    if (!account || !account.metalType) return;
    setRefreshingMetal(true);
    try {
      const ppg = await getMetalPricePerGram(account.metalType, account.currency, settings?.goldPriceSource ?? 'international', true);
      setMetalPricePerGram(ppg);
    } catch (e) {
      console.error(e);
    }
    setRefreshingMetal(false);
  };

  useEffect(() => { load(true); }, [accountId]);

  const handleAddRecord = async () => {
    let amt: number;
    if (isEquity) {
      const shares = parseFloat(stockShares);
      const price = parseFloat(stockPrice);
      if (isNaN(shares) || isNaN(price) || shares <= 0 || price <= 0) return;
      amt = shares * price;
    } else {
      amt = parseFloat(newAmount);
      if (isNaN(amt) || amt < 0) return;
    }
    await addRecord(accountId, newDate, amt, newNote || undefined);
    setShowAddRecord(false);
    setNewAmount(''); setNewNote(''); setNewDate(new Date().toISOString().split('T')[0]);
    setStockShares(''); setStockPrice('');
    load();
  };

  const handleUpdateRecord = async () => {
    if (!editingRecord) return;
    const amt = parseFloat(newAmount);
    if (isNaN(amt) || amt < 0) return;
    await updateRecord(editingRecord.id, { date: newDate, amount: amt, note: newNote || undefined });
    setEditingRecord(null); setNewAmount(''); setNewNote(''); load();
  };

  const handleDeleteRecord = async (id: string) => { await deleteRecord(id); load(); };

  // ---- Precious-metal buy/sell ----
  const openMetalTxn = (kind: 'buy' | 'sell') => {
    setMetalKind(kind); setEditingMetalRec(null);
    setTxnGrams(''); setTxnPrice(''); setNewNote('');
    setNewDate(new Date().toISOString().split('T')[0]);
    setShowMetalTxn(true);
  };
  const openEditMetalRec = (r: AccountRecord) => {
    setEditingMetalRec(r); setMetalKind(r.kind || 'buy');
    setTxnGrams(String(r.deltaGrams ?? Math.abs(r.amount)));
    setTxnPrice(r.pricePerGram != null ? String(r.pricePerGram) : '');
    setNewDate(r.date); setNewNote(r.note || '');
    setShowMetalTxn(true);
  };
  const handleSaveMetalTxn = async () => {
    const grams = parseFloat(txnGrams);
    const price = parseFloat(txnPrice);
    if (isNaN(grams) || grams <= 0 || isNaN(price) || price < 0) return;
    if (metalKind === 'sell' && !editingMetalRec) {
      const pos = computeMetalPosition(records);
      if (grams > pos.remainingGrams + 1e-6) { alert(t('sell_exceeds', { grams: pos.remainingGrams.toFixed(2) })); return; }
    }
    const input = { date: newDate, kind: metalKind, grams, pricePerGram: price, note: newNote || undefined };
    if (editingMetalRec) await updateMetalTransaction(editingMetalRec.id, accountId, input);
    else await addMetalTransaction(accountId, input);
    setShowMetalTxn(false); setEditingMetalRec(null);
    setTxnGrams(''); setTxnPrice(''); setNewNote('');
    load();
  };
  const handleNameSave = async () => { if (nameText.trim()) await updateAccount(accountId, { name: nameText.trim() }); setEditingName(false); load(); };
  const handleRestoreAccount = async () => { await restoreAccount(accountId); load(); };

  const handleSaveProductData = async () => {
    await updateAccount(accountId, {
      institution: editInstitution.trim() || undefined,
      productData: Object.keys(editProductData).filter(k => editProductData[k]).length > 0 ? editProductData : undefined,
    });
    setShowEditProductData(false);
    load();
  };
  const openEditProductData = () => {
    setEditInstitution(account?.institution || '');
    setEditProductData(account?.productData ? { ...account.productData } : {});
    setShowEditProductData(true);
  };
  const setField = (key: string, val: string) => setEditProductData(prev => ({ ...prev, [key]: val }));
  const openEditRecord = (r: AccountRecord) => { setEditingRecord(r); setNewDate(r.date); setNewAmount(String(r.amount)); setNewNote(r.note || ''); };
  const masked = (text: string) => amountVisible ? text : '****';

  const fmt = (n: number) => {
    const isEn = i18n.language.startsWith('en');
    if (isEn) {
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + t('unit_yi');
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + t('unit_wan');
      return n.toFixed(2);
    }
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + t('unit_yi');
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + t('unit_wan');
    return n.toFixed(2);
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!account || !settings) return null;

  const isMetal = account.unit === 'gram';
  const isPortfolio = !!account.portfolio;
  const isArchived = Boolean(account.archivedAt);
  const isEquity = !isPortfolio && (account.category === '股票/ETF' || account.category === '股票' || account.category === '场外基金');
  const costPerShare = account.productData?.cost ? parseFloat(account.productData.cost) : null;
  const metalName = METAL_TYPES.find(m => m.code === account.metalType)?.name || '';
  const color = account.type === 'asset' ? theme.assetColor : theme.liabilityColor;
  const position = isMetal ? computeMetalPosition(records) : null;
  const marketValue = position && metalPricePerGram ? position.remainingGrams * metalPricePerGram : 0;
  const unrealizedPnl = position ? marketValue - position.costBasis : 0;

  return (
    <div className="app">
      <div className="app-content" style={{ paddingBottom: 24, paddingLeft: '1.25rem', paddingRight: '1.25rem' }}
           onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <button className="back-btn" onClick={onBack} style={{ padding: '12px 16px 12px 0', fontSize: '1.125rem', margin: '-4px 0 8px' }}>
          ← {t('back')}
        </button>

        <div className="account-header">
          <div className="account-header-info">
            {editingName ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="form-input" value={nameText} onChange={e => setNameText(e.target.value)}
                  autoFocus onBlur={handleNameSave} onKeyDown={e => e.key === 'Enter' && handleNameSave()} />
              </div>
            ) : (
              <h1 className="account-header-name" onClick={() => setEditingName(true)}>
                {account.name} <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>✏️</span>
              </h1>
            )}
            <div className="account-header-meta">
              <span className="category-type" style={{ background: account.type === 'asset' ? theme.assetDim : theme.liabilityDim, color }}>
                {account.type === 'asset' ? t('assets') : t('liabilities')}
              </span>
              <span>{t(account.category)}</span>
              {isPortfolio && (
                <span style={{ background: 'var(--asset-dim)', color: 'var(--asset-color)', borderRadius: 10, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 600 }}>
                  {t('portfolio_badge')}
                </span>
              )}
              {isMetal && <span>{metalName}</span>}
              {isArchived && (
                <span style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 20, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                  {t('archived_badge')}
                </span>
              )}
              {account.institution && (
                <span style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 10px', fontSize: '0.72rem' }}>
                  🏢 {account.institution}
                </span>
              )}
              <span>{account.currency} {t(account.currency + '_name') || ''}</span>
            </div>
          </div>
        </div>

        {isArchived && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{t('archived_accounts')}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{t('archived_detail_hint')}</div>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={handleRestoreAccount}>{t('restore_account')}</button>
          </div>
        )}

        {/* Product info card (per-product fields make no sense for portfolio accounts) */}
        {!isPortfolio && ((account.productData && Object.keys(account.productData).some(k => account.productData![k])) ? (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('product_info')}</span>
              {!isArchived && <button onClick={openEditProductData} style={{ background: 'none', border: 'none', color: 'var(--asset-color)', fontSize: '0.75rem', cursor: 'pointer', padding: '2px 6px' }}>{t('edit')}</button>}
            </div>
            {(() => {
              const fieldDefs = settings ? getFieldsForCategory(account.category, settings, t) : [];
              const labelMap: Record<string, string> = {};
              fieldDefs.forEach(f => { labelMap[f.key] = f.label; });
              return Object.entries(account.productData).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginRight: 8 }}>{labelMap[k] || k}</span>
                  <span style={{ color: 'var(--text-primary)', textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
                </div>
              ));
            })()}
          </div>
        ) : (
          !isArchived && <button onClick={openEditProductData} style={{ width: '100%', background: 'transparent', border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: '0.8rem', padding: '10px', cursor: 'pointer', marginBottom: 12 }}>
            + {t('edit_product_info')}
          </button>
        ))}

        {/* Precious-metal position card */}
        {isMetal && position && (
          <div className="latest-value-card">
            <div className="stat-label">{t('remaining_grams')}</div>
            <div className="latest-value" style={{ color, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ whiteSpace: 'nowrap' }}>{masked(position.remainingGrams.toFixed(2))}</div>
              <div className="latest-value-currency" style={{ fontSize: '0.875rem', marginTop: 4 }}>{t('unit_gram')}</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }}>
              {metalName}{t('unit_price')}：{metalPricePerGram != null && metalPricePerGram > 0 ? masked(metalPricePerGram.toFixed(2)) : '—'} {account.currency}/{t('unit_gram')}
              <button
                onClick={(e) => { e.stopPropagation(); handleRefreshMetal(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, fontSize: 14, animation: refreshingMetal ? 'spin 1s linear infinite' : 'none', opacity: refreshingMetal ? 0.5 : 1 }}
                title={t('refresh')}>
                🔄
              </button>
            </div>
            {position.remainingGrams > 0 && metalPricePerGram != null && metalPricePerGram > 0 && (
              <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 600, color, marginTop: 4 }}>
                ≈ {masked(fmt(marketValue))} {account.currency}
              </div>
            )}
            {position.remainingGrams > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, width: '100%' }}>
                <div style={S.posCell}>
                  <span style={S.posKey}>{t('avg_cost_label')}</span>
                  <span style={S.posVal}>{position.avgCost > 0 ? masked(position.avgCost.toFixed(2)) : '—'}</span>
                </div>
                <div style={S.posCell}>
                  <span style={S.posKey}>{t('holding_cost')}</span>
                  <span style={S.posVal}>{position.costBasis > 0 ? masked(fmt(position.costBasis)) : '—'}</span>
                </div>
                {position.costBasis > 0 && metalPricePerGram != null && metalPricePerGram > 0 && (
                  <div style={S.posCell}>
                    <span style={S.posKey}>{t('unrealized_pnl')}</span>
                    <span style={{ ...S.posVal, color: unrealizedPnl >= 0 ? theme.assetColor : theme.liabilityColor }}>
                      {masked((unrealizedPnl >= 0 ? '+' : '') + fmt(unrealizedPnl))}
                    </span>
                  </div>
                )}
                {Math.abs(position.realizedPnl) > 0.005 && (
                  <div style={S.posCell}>
                    <span style={S.posKey}>{t('realized_pnl')}</span>
                    <span style={{ ...S.posVal, color: position.realizedPnl >= 0 ? theme.assetColor : theme.liabilityColor }}>
                      {masked((position.realizedPnl >= 0 ? '+' : '') + fmt(position.realizedPnl))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Portfolio account: holdings managed inside the account */}
        {isPortfolio && !isArchived && <PortfolioPanel account={account} onChanged={() => load()} />}

        {/* Latest value (non-metal) */}
        {!isMetal && !isPortfolio && records.length > 0 && (
          <div className="latest-value-card">
            <div className="stat-label">{t('latest_balance')}</div>
            <div className="latest-value" style={{ color, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ whiteSpace: 'nowrap' }}>
                {masked(records[0].amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
              </div>
              <div className="latest-value-currency" style={{ fontSize: '0.875rem', marginTop: 4 }}>{account.currency}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('record_date')}：{records[0].date}</div>
          </div>
        )}

        {!isArchived && account.category === '信用卡' && (
          <div className="settings-item" style={{ marginBottom: 20, background: 'var(--bg-card)', padding: '12px 16px', borderRadius: 16 }}>
            <div>
              <div className="settings-item-label">{t('credit_card_reminder')}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>{t('credit_card_reminder_desc')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" style={{ width: '60px', padding: '6px', textAlign: 'center' }} type="number" 
                placeholder={t('day', { defaultValue: 'Day' })} id="cc-day-input" />
              <button className="btn btn-primary btn-sm" onClick={async () => {
                const input = document.getElementById('cc-day-input') as HTMLInputElement;
                const day = parseInt(input?.value || '0');
                if (isNaN(day) || day < 1 || day > 31) {
                  alert(t('invalid_day_alert'));
                  return;
                }
                if (confirm(t('save_success_calendar_prompt', { day }))) {
                  try {
                    const { CapacitorCalendar } = await import('@ebarooni/capacitor-calendar');
                    const now = new Date();
                    const start = new Date(now.getFullYear(), now.getMonth(), day, 10, 0, 0);
                    if (start < now) start.setMonth(start.getMonth() + 1);
                    
                    await CapacitorCalendar.createEventWithPrompt({
                      title: `${account.name} ${t('repayment_reminder_title', { defaultValue: 'Repayment Reminder' })}`,
                      description: `Fortuna ${t('reminder_description', { defaultValue: 'Reminder: Today is the repayment day for', name: account.name })}`,
                      startDate: start.getTime(),
                      endDate: start.getTime() + 60 * 60 * 1000,
                      alerts: [-1440, -120], // 1 day before and 2 hours before
	                      recurrence: {
	                        frequency: 'monthly',
	                        byMonthDay: [day],
	                        interval: 1
	                      }
                    });
                  } catch (e) {
                    alert(t('calendar_fail'));
                    console.error(e);
                  }
                }
              }}>{t('generate')}</button>
            </div>
          </div>
        )}

        {!isArchived && (isMetal ? (
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button className="btn btn-block" style={{ background: theme.assetColor, color: '#000', fontWeight: 700 }}
              onClick={() => openMetalTxn('buy')}>＋ {t('buy_in')}</button>
            <button className="btn btn-block" style={{ background: theme.liabilityColor, color: '#fff', fontWeight: 700 }}
              onClick={() => openMetalTxn('sell')}>－ {t('sell_out')}</button>
          </div>
        ) : isPortfolio ? null : (
          <button className="btn btn-primary btn-block" style={{ marginBottom: 20 }}
            onClick={() => { setEditingRecord(null); setNewAmount(''); setNewNote(''); setNewDate(new Date().toISOString().split('T')[0]); setStockShares(''); setStockPrice(''); setShowAddRecord(true); }}>
            + {t('add_record')}
          </button>
        ))}

        <div className="entry-group-title"><span className="dot" style={{ background: color }} />{isPortfolio ? t('snapshot_history') : t('history_records')} ({records.length})</div>
        {isPortfolio && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '-2px 0 8px' }}>{t('snapshot_hint')}</div>}
        {records.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>{t('no_records')}</div>
        ) : isMetal ? (
          records.map(r => {
            const isSell = r.kind === 'sell';
            const txnColor = isSell ? theme.liabilityColor : theme.assetColor;
            const grams = r.deltaGrams ?? Math.abs(r.amount);
            const hasPrice = r.pricePerGram != null && r.pricePerGram > 0;
            const total = hasPrice ? grams * r.pricePerGram! : 0;
            return (
              <div key={r.id} style={S.metalRow}>
                {/* top line: badge + date · grams · actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, background: isSell ? theme.liabilityDim : theme.assetDim, color: txnColor, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>
                    {isSell ? t('sell_out') : t('buy_in')}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{r.date}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', color: txnColor, whiteSpace: 'nowrap' }}>
                    {isSell ? '−' : '+'}{masked(grams.toFixed(2))}<span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>{t('unit_gram')}</span>
                  </span>
                  {!isArchived && (
                    <div className="entry-actions" style={{ flexShrink: 0 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEditMetalRec(r)}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteRecord(r.id)}>✕</button>
                    </div>
                  )}
                </div>
                {/* second line: unit price (left) · subtotal (right) */}
                {hasPrice && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span style={{ whiteSpace: 'nowrap' }}>@ {masked(r.pricePerGram!.toFixed(2))} {account.currency}/{t('unit_gram')}</span>
                    <span style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>{masked(total.toLocaleString('en-US', { maximumFractionDigits: 0 }))} {account.currency}</span>
                  </div>
                )}
                {r.note && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{r.note}</div>}
              </div>
            );
          })
        ) : (
          records.map(r => (
            <div className="record-item" key={r.id}>
              <div className="record-date">{r.date}</div>
              <div className="record-info">
                <div className="record-amount" style={{ color }}>
                  {masked(r.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
                </div>
                {r.note && <div className="record-note">{r.note}</div>}
              </div>
              {!isArchived && (
                <div className="entry-actions">
                  {!isPortfolio && <button className="btn btn-sm btn-secondary" onClick={() => openEditRecord(r)}>✏️</button>}
                  <button className="btn btn-sm btn-danger" onClick={() => handleDeleteRecord(r.id)}>✕</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showEditProductData && account && (
        <div className="modal-overlay" onClick={() => setShowEditProductData(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t('edit_product_info')}</h2>
              <button className="modal-close" onClick={() => setShowEditProductData(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('institution')}</label>
              <input className="form-input" placeholder={t('institution_ph')}
                value={editInstitution} onChange={e => setEditInstitution(e.target.value)} />
            </div>
            {getFieldsForCategory(account.category, settings, t).map(field => (
              <div className="form-group" key={field.key}>
                <label className="form-label">{field.label}</label>
                {field.options ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {field.options.map(optVal => (
                      <button key={optVal}
                        style={{ padding: '5px 11px', borderRadius: 20, border: `1px solid ${editProductData[field.key] === optVal ? 'var(--asset-color)' : 'var(--border)'}`, background: editProductData[field.key] === optVal ? 'var(--asset-dim)' : 'var(--bg-glass)', color: editProductData[field.key] === optVal ? 'var(--asset-color)' : 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: editProductData[field.key] === optVal ? 600 : 400 }}
                        onClick={() => setField(field.key, editProductData[field.key] === optVal ? '' : optVal)}>
                        {optVal}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input className="form-input"
                    placeholder={field.placeholder || ''}
                    value={editProductData[field.key] || ''}
                    onChange={e => setField(field.key, e.target.value)} />
                )}
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => setShowEditProductData(false)}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSaveProductData}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {(showAddRecord || editingRecord) && (
        <div className="modal-overlay" onClick={() => { setShowAddRecord(false); setEditingRecord(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingRecord ? t('edit_record') : t('add_record')}</h2>
              <button className="modal-close" onClick={() => { setShowAddRecord(false); setEditingRecord(null); }}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('date')}</label>
              <input className="form-input" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            {isEquity && !editingRecord ? (
              <>
                <div className="form-group">
                  <label className="form-label">{t('shares')}</label>
                  <input className="form-input mono" type="number" inputMode="decimal" step="1" min="0"
                    placeholder={t('shares_ph')} value={stockShares} onChange={e => setStockShares(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('price_per_share')} ({account.currency})</label>
                  <input className="form-input mono" type="number" inputMode="decimal" step="0.0001" min="0"
                    placeholder={t('price_per_share_ph')} value={stockPrice} onChange={e => setStockPrice(e.target.value)} />
                </div>
                {stockShares && stockPrice && !isNaN(parseFloat(stockShares)) && !isNaN(parseFloat(stockPrice)) && (
                  <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{t('market_value')}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--asset-color)' }}>
                        {(parseFloat(stockShares) * parseFloat(stockPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {account.currency}
                      </span>
                    </div>
                    {costPerShare !== null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{t('pnl')}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: (parseFloat(stockPrice) - costPerShare) >= 0 ? 'var(--asset-color)' : 'var(--liability-color)' }}>
                          {((parseFloat(stockPrice) - costPerShare) * parseFloat(stockShares) >= 0 ? '+' : '')}
                          {((parseFloat(stockPrice) - costPerShare) * parseFloat(stockShares)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="form-group">
                <label className="form-label">{isMetal ? `${t('amount')} (${metalName})` : `${t('amount')} (${account.currency})`}</label>
                <input className="form-input mono" type="number" inputMode="decimal" step="0.01" min="0"
                  placeholder={isMetal ? `0.00 ${t('unit_gram')}` : '0.00'} value={newAmount} onChange={e => setNewAmount(e.target.value)} autoFocus />
                {isMetal && metalPricePerGram !== null && newAmount && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    ≈ {fmt(parseFloat(newAmount || '0') * metalPricePerGram)} {account.currency}（{metalName} {metalPricePerGram.toFixed(2)}/{account.currency}/{t('unit_gram')}）
                  </div>
                )}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">{t('note')}</label>
              <input className="form-input" placeholder={t('note_placeholder')} value={newNote} onChange={e => setNewNote(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setShowAddRecord(false); setEditingRecord(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={editingRecord ? handleUpdateRecord : handleAddRecord}>
                {editingRecord ? t('update') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Precious-metal buy/sell modal */}
      {showMetalTxn && (() => {
        const grams = parseFloat(txnGrams);
        const price = parseFloat(txnPrice);
        const valid = !isNaN(grams) && grams > 0 && !isNaN(price) && price >= 0;
        const total = valid ? grams * price : 0;
        const isSell = metalKind === 'sell';
        const txnColor = isSell ? theme.liabilityColor : theme.assetColor;
        return (
          <div className="modal-overlay" onClick={() => { setShowMetalTxn(false); setEditingMetalRec(null); }}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title" style={{ color: txnColor }}>
                  {editingMetalRec ? t('edit_record') : (isSell ? t('sell_record') : t('buy_record'))} · {metalName}
                </h2>
                <button className="modal-close" onClick={() => { setShowMetalTxn(false); setEditingMetalRec(null); }}>✕</button>
              </div>
              {!editingMetalRec && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button className="btn btn-block" style={{ background: metalKind === 'buy' ? theme.assetColor : 'var(--bg-glass)', color: metalKind === 'buy' ? '#000' : 'var(--text-secondary)', border: metalKind === 'buy' ? 'none' : '1px solid var(--border)', fontWeight: 700 }} onClick={() => setMetalKind('buy')}>＋ {t('buy_in')}</button>
                  <button className="btn btn-block" style={{ background: metalKind === 'sell' ? theme.liabilityColor : 'var(--bg-glass)', color: metalKind === 'sell' ? '#fff' : 'var(--text-secondary)', border: metalKind === 'sell' ? 'none' : '1px solid var(--border)', fontWeight: 700 }} onClick={() => setMetalKind('sell')}>－ {t('sell_out')}</button>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t('date')}</label>
                <input className="form-input" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('grams_label')}</label>
                <input className="form-input mono" type="number" inputMode="decimal" step="0.01" min="0"
                  placeholder={`0.00 ${t('unit_gram')}`} value={txnGrams} onChange={e => setTxnGrams(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">{(isSell ? t('sell_price') : t('cost_price'))} ({account.currency}/{t('unit_gram')})</label>
                <input className="form-input mono" type="number" inputMode="decimal" step="0.01" min="0"
                  placeholder={metalPricePerGram != null && metalPricePerGram > 0 ? metalPricePerGram.toFixed(2) : '0.00'}
                  value={txnPrice} onChange={e => setTxnPrice(e.target.value)} />
              </div>
              {valid && (
                <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{isSell ? t('sell_out') : t('buy_in')} {grams.toFixed(2)}{t('unit_gram')} × {price.toFixed(2)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: txnColor }}>{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {account.currency}</span>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t('note')}</label>
                <input className="form-input" placeholder={t('note_placeholder')} value={newNote} onChange={e => setNewNote(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary btn-block" onClick={() => { setShowMetalTxn(false); setEditingMetalRec(null); }}>{t('cancel')}</button>
                <button className="btn btn-primary btn-block" disabled={!valid} onClick={handleSaveMetalTxn}>
                  {editingMetalRec ? t('update') : t('save')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  metalRow: { background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 8 },
  posCell: { background: 'var(--bg-glass)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 },
  posKey: { fontSize: '0.66rem', color: 'var(--text-muted)' },
  posVal: { fontSize: '0.9rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' },
};
