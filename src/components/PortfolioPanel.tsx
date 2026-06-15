import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, HoldingTxn } from '../db';
import {
  getHoldingsWithPositions, getAccountTxns, createHolding, updateHolding, deleteHolding,
  addHoldingTxn, updateHoldingTxn, deleteHoldingTxn, setCashBalance, updatePrices,
  type HoldingWithPosition,
} from '../services/holdingService';
import { fetchQuotes } from '../services/quoteService';
import { useAppContext } from '../app-context';
import { splitHoldingsByArchive } from '../lib/holdingArchive';

interface Props { account: Account; onChanged: () => void; }

const MARKET_OPTS = ['opt_a_share', 'opt_us_market', 'opt_hk_market', 'opt_other'];

const today = () => new Date().toISOString().split('T')[0];

export default function PortfolioPanel({ account, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, amountVisible } = useAppContext();
  const [holdings, setHoldings] = useState<HoldingWithPosition[]>([]);
  const [txns, setTxns] = useState<HoldingTxn[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Holding create/edit modal
  const [showHoldingForm, setShowHoldingForm] = useState(false);
  const [editingHolding, setEditingHolding] = useState<HoldingWithPosition | null>(null);
  const [hName, setHName] = useState('');
  const [hSymbol, setHSymbol] = useState('');
  const [hMarket, setHMarket] = useState('');
  const [hPrice, setHPrice] = useState('');
  const [hInitShares, setHInitShares] = useState('');
  const [hInitPrice, setHInitPrice] = useState('');
  const [confirmDeleteHolding, setConfirmDeleteHolding] = useState<string | null>(null);

  // Buy/sell transaction modal
  const [txnHolding, setTxnHolding] = useState<HoldingWithPosition | null>(null);
  const [editingTxn, setEditingTxn] = useState<HoldingTxn | null>(null);
  const [txnKind, setTxnKind] = useState<'buy' | 'sell'>('buy');
  const [txnDate, setTxnDate] = useState(today());
  const [txnShares, setTxnShares] = useState('');
  const [txnPrice, setTxnPrice] = useState('');
  const [txnNote, setTxnNote] = useState('');

  // Batch price update modal
  const [showPrices, setShowPrices] = useState(false);
  const [priceDate, setPriceDate] = useState(today());
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});

  // Cash balance modal
  const [showCash, setShowCash] = useState(false);
  const [cashInput, setCashInput] = useState('');

  // Live quotes
  const [refreshing, setRefreshing] = useState(false);
  const [quoteMsg, setQuoteMsg] = useState<string | null>(null);
  const [pullDy, setPullDy] = useState(0);
  const refreshingRef = useRef(false);
  const quoteMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [h, tx] = await Promise.all([getHoldingsWithPositions(account.id), getAccountTxns(account.id)]);
    setHoldings(h);
    setTxns(tx);
    return h;
  }, [account.id]);

  const flashQuoteMsg = (msg: string) => {
    if (quoteMsgTimer.current) clearTimeout(quoteMsgTimer.current);
    setQuoteMsg(msg);
    quoteMsgTimer.current = setTimeout(() => setQuoteMsg(null), 2500);
  };

  const refreshQuotes = useCallback(async (silent = false) => {
    if (refreshingRef.current) return;
    // read fresh from db so this also works right after mount / external changes
    const current = await getHoldingsWithPositions(account.id);
    const { active } = splitHoldingsByArchive(current);
    const targets = active.filter(h => (h.symbol || '').trim());
    if (targets.length === 0) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const res = await fetchQuotes(
        targets.map(h => ({ id: h.id, symbol: h.symbol, market: h.market })),
        account.category === '场外基金',
      );
      if (res.ok > 0) {
        await updatePrices(account.id, res.prices, today());
        await load();
        onChanged();
      }
      if (!silent || res.ok > 0) flashQuoteMsg(t('quotes_updated', { ok: res.ok, total: res.total }));
    } catch (e) {
      console.error('Quote refresh failed', e);
      if (!silent) flashQuoteMsg(t('quotes_failed'));
    }
    refreshingRef.current = false;
    setRefreshing(false);
  }, [account.id, account.category, load, onChanged, t]);

  const refreshRef = useRef(refreshQuotes);
  useEffect(() => { refreshRef.current = refreshQuotes; }, [refreshQuotes]);

  // Initial load + one silent quote refresh per page open
  useEffect(() => {
    (async () => {
      await load();
      refreshRef.current(true);
    })();
  }, [load]);

  // Pull-to-refresh on the page's scroll container
  useEffect(() => {
    const sc = anchorRef.current?.closest('.app-content') as HTMLElement | null;
    if (!sc) return;
    let startY = -1;
    let dy = 0;
    const onStart = (e: TouchEvent) => { startY = sc.scrollTop <= 0 ? e.touches[0].clientY : -1; dy = 0; };
    const onMove = (e: TouchEvent) => {
      if (startY < 0) return;
      if (sc.scrollTop > 0) { startY = -1; dy = 0; setPullDy(0); return; }
      const raw = e.touches[0].clientY - startY;
      dy = raw > 0 ? Math.min(raw * 0.5, 80) : 0;  // damped
      setPullDy(dy);
    };
    const onEnd = () => {
      if (dy >= 55) refreshRef.current(false);
      startY = -1; dy = 0; setPullDy(0);
    };
    sc.addEventListener('touchstart', onStart, { passive: true });
    sc.addEventListener('touchmove', onMove, { passive: true });
    sc.addEventListener('touchend', onEnd);
    return () => {
      sc.removeEventListener('touchstart', onStart);
      sc.removeEventListener('touchmove', onMove);
      sc.removeEventListener('touchend', onEnd);
    };
  }, []);

  const changed = async () => { await load(); onChanged(); };

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
  const fmtFull = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pnlColor = (n: number) => n >= 0 ? theme.assetColor : theme.liabilityColor;
  const signed = (n: number) => (n >= 0 ? '+' : '') + fmt(n);

  const cash = account.cashBalance || 0;
  const { active: activeHoldings, archived: archivedHoldings } = splitHoldingsByArchive(holdings);
  const positionValue = activeHoldings.reduce((s, h) => s + h.marketValue, 0);
  const totalValue = positionValue + cash;
  const costBasis = activeHoldings.reduce((s, h) => s + h.position.costBasis, 0);
  const unrealized = positionValue - costBasis;
  const realized = holdings.reduce((s, h) => s + h.position.realizedPnl, 0);

  // ---- Holding form ----
  const openCreateHolding = () => {
    setEditingHolding(null);
    setHName(''); setHSymbol(''); setHMarket(''); setHPrice('');
    setHInitShares(''); setHInitPrice('');
    setShowHoldingForm(true);
  };
  const openEditHolding = (h: HoldingWithPosition) => {
    setEditingHolding(h);
    setHName(h.name); setHSymbol(h.symbol || ''); setHMarket(h.market || '');
    setHPrice(h.lastPrice > 0 ? String(h.lastPrice) : '');
    setShowHoldingForm(true);
  };
  const handleSaveHolding = async () => {
    if (!hName.trim()) return;
    const meta = { name: hName.trim(), symbol: hSymbol.trim() || undefined, market: hMarket || undefined };
    const price = parseFloat(hPrice);
    if (editingHolding) {
      await updateHolding(editingHolding.id, meta);
      if (!isNaN(price) && price > 0 && price !== editingHolding.lastPrice) {
        await updatePrices(account.id, { [editingHolding.id]: price }, today());
      }
    } else {
      const initShares = parseFloat(hInitShares);
      const initPrice = parseFloat(hInitPrice);
      const lastPrice = !isNaN(price) && price > 0 ? price : (!isNaN(initPrice) && initPrice > 0 ? initPrice : 0);
      const id = await createHolding(account.id, { ...meta, lastPrice, priceDate: lastPrice > 0 ? today() : undefined });
      if (!isNaN(initShares) && initShares > 0 && !isNaN(initPrice) && initPrice > 0) {
        await addHoldingTxn(account.id, id, { date: today(), kind: 'buy', shares: initShares, price: initPrice });
      }
    }
    setShowHoldingForm(false); setEditingHolding(null);
    await changed();
  };
  const handleDeleteHolding = async (id: string) => {
    await deleteHolding(id);
    setConfirmDeleteHolding(null);
    if (expandedId === id) setExpandedId(null);
    await changed();
  };

  // ---- Buy / sell ----
  const openTxn = (h: HoldingWithPosition, kind: 'buy' | 'sell') => {
    setTxnHolding(h); setEditingTxn(null); setTxnKind(kind);
    setTxnDate(today()); setTxnShares('');
    setTxnPrice(h.lastPrice > 0 ? String(h.lastPrice) : '');
    setTxnNote('');
  };
  const openEditTxn = (h: HoldingWithPosition, tx: HoldingTxn) => {
    setTxnHolding(h); setEditingTxn(tx); setTxnKind(tx.kind);
    setTxnDate(tx.date); setTxnShares(String(tx.shares)); setTxnPrice(String(tx.price));
    setTxnNote(tx.note || '');
  };
  const handleSaveTxn = async () => {
    if (!txnHolding) return;
    const shares = parseFloat(txnShares);
    const price = parseFloat(txnPrice);
    if (isNaN(shares) || shares <= 0 || isNaN(price) || price < 0) return;
    if (txnKind === 'sell' && !editingTxn && shares > txnHolding.position.shares + 1e-6) {
      alert(t('sell_exceeds_shares', { shares: txnHolding.position.shares.toLocaleString('en-US', { maximumFractionDigits: 4 }) }));
      return;
    }
    const input = { date: txnDate, kind: txnKind, shares, price, note: txnNote.trim() || undefined };
    if (editingTxn) await updateHoldingTxn(editingTxn.id, input);
    else await addHoldingTxn(account.id, txnHolding.id, input);
    setTxnHolding(null); setEditingTxn(null);
    await changed();
  };
  const handleDeleteTxn = async (id: string) => { await deleteHoldingTxn(id); await changed(); };

  // ---- Batch prices ----
  const openPrices = () => {
    setPriceDate(today());
    setPriceInputs(Object.fromEntries(activeHoldings.map(h => [h.id, h.lastPrice > 0 ? String(h.lastPrice) : ''])));
    setShowPrices(true);
  };
  const handleSavePrices = async () => {
    const parsed: Record<string, number> = {};
    for (const [id, v] of Object.entries(priceInputs)) {
      const p = parseFloat(v);
      if (!isNaN(p) && p > 0) parsed[id] = p;
    }
    await updatePrices(account.id, parsed, priceDate);
    setShowPrices(false);
    await changed();
  };

  // ---- Cash ----
  const openCash = () => { setCashInput(cash > 0 ? String(cash) : ''); setShowCash(true); };
  const handleSaveCash = async () => {
    const v = parseFloat(cashInput);
    await setCashBalance(account.id, isNaN(v) || v < 0 ? 0 : v);
    setShowCash(false);
    await changed();
  };

  const renderTxnRow = (h: HoldingWithPosition, tx: HoldingTxn) => {
    const isSell = tx.kind === 'sell';
    const txnColor = isSell ? theme.liabilityColor : theme.assetColor;
    return (
      <div key={tx.id} style={S.txnRow}>
        <span style={{ fontSize: 11, fontWeight: 700, background: isSell ? theme.liabilityDim : theme.assetDim, color: txnColor, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>
          {isSell ? t('sell_out') : t('buy_in')}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{tx.date}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {masked(`${tx.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} × ${tx.price.toFixed(account.currency === 'JPY' ? 0 : 3)}`)}
        </span>
        <div className="entry-actions" style={{ flexShrink: 0 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => openEditTxn(h, tx)}>✏️</button>
          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteTxn(tx.id)}>✕</button>
        </div>
      </div>
    );
  };

  const renderHolding = (h: HoldingWithPosition, archived = false) => {
    const expanded = expandedId === h.id;
    const pnlPct = h.position.costBasis > 0 ? (h.unrealizedPnl / h.position.costBasis) * 100 : 0;
    const hTxns = txns.filter(tx => tx.holdingId === h.id);
    return (
      <div key={h.id} style={{ ...S.holdingCard, ...(archived ? S.archivedHoldingCard : {}), border: `1px solid ${expanded ? 'var(--border-active)' : 'var(--border)'}` }}>
        <div style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expanded ? null : h.id)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
            {h.symbol && <span style={S.badge}>{h.symbol}</span>}
            {h.market && <span style={S.badge}>{h.market}</span>}
            {archived && <span style={S.archivedBadge}>{t('archived_holding_badge')}</span>}
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9375rem', whiteSpace: 'nowrap' }}>
              {masked(fmt(h.marketValue))}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {masked(h.position.shares.toLocaleString('en-US', { maximumFractionDigits: 4 }))} {t('shares_unit')} · {t('last_price')} {h.lastPrice > 0 ? masked(h.lastPrice.toFixed(3)) : '—'}{h.priceDate ? ` (${h.priceDate.slice(5)})` : ''}
            </span>
            {h.position.costBasis > 0 && (
              <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontWeight: 600, color: pnlColor(h.unrealizedPnl), whiteSpace: 'nowrap' }}>
                {masked(`${signed(h.unrealizedPnl)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`)}
              </span>
            )}
          </div>
        </div>

        {expanded && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={S.posCell}><span style={S.posKey}>{t('avg_cost_label')}</span><span style={S.posVal}>{h.position.avgCost > 0 ? masked(h.position.avgCost.toFixed(3)) : '—'}</span></div>
              <div style={S.posCell}><span style={S.posKey}>{t('holding_cost')}</span><span style={S.posVal}>{h.position.costBasis > 0 ? masked(fmt(h.position.costBasis)) : '—'}</span></div>
              <div style={S.posCell}><span style={S.posKey}>{t('unrealized_pnl')}</span><span style={{ ...S.posVal, color: h.position.costBasis > 0 ? pnlColor(h.unrealizedPnl) : 'var(--text-muted)' }}>{h.position.costBasis > 0 ? masked(signed(h.unrealizedPnl)) : '—'}</span></div>
              <div style={S.posCell}><span style={S.posKey}>{t('realized_pnl')}</span><span style={{ ...S.posVal, color: Math.abs(h.position.realizedPnl) > 0.005 ? pnlColor(h.position.realizedPnl) : 'var(--text-muted)' }}>{Math.abs(h.position.realizedPnl) > 0.005 ? masked(signed(h.position.realizedPnl)) : '—'}</span></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-sm btn-block" style={{ background: theme.assetColor, color: '#000', fontWeight: 700 }} onClick={() => openTxn(h, 'buy')}>＋ {t('buy_in')}</button>
              {!archived && <button className="btn btn-sm btn-block" style={{ background: theme.liabilityColor, color: '#fff', fontWeight: 700 }} onClick={() => openTxn(h, 'sell')}>－ {t('sell_out')}</button>}
              <button className="btn btn-sm btn-secondary" onClick={() => openEditHolding(h)}>✏️</button>
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDeleteHolding(h.id)}>🗑️</button>
            </div>
            {hTxns.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                  {t('txn_history')} ({hTxns.length})
                </div>
                {hTxns.map(tx => renderTxnRow(h, tx))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const hasSymbols = activeHoldings.some(h => (h.symbol || '').trim());
  const indicatorVisible = pullDy > 0 || refreshing || quoteMsg;

  return (
    <>
      <div ref={anchorRef} />
      {/* Pull-to-refresh / quote status indicator */}
      {indicatorVisible && (
        <div style={{
          height: refreshing || quoteMsg ? 30 : pullDy,
          overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.72rem', color: 'var(--text-muted)', gap: 6,
          transition: pullDy > 0 ? 'none' : 'height 0.2s ease',
        }}>
          {refreshing ? (
            <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>🔄</span>{t('refreshing_quotes')}</>
          ) : quoteMsg ? quoteMsg : (pullDy >= 55 ? t('release_to_refresh') : t('pull_to_refresh_quotes'))}
        </div>
      )}

      {/* Portfolio summary */}
      <div className="latest-value-card">
        <div className="stat-label">{t('total_market_value')}</div>
        <div className="latest-value" style={{ color: theme.assetColor, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ whiteSpace: 'nowrap' }}>{masked(fmtFull(totalValue))}</div>
          <div className="latest-value-currency" style={{ fontSize: '0.875rem', marginTop: 4 }}>{account.currency}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, width: '100%' }}>
          <div style={S.posCell}><span style={S.posKey}>{t('position_value')}</span><span style={S.posVal}>{masked(fmt(positionValue))}</span></div>
          <div style={{ ...S.posCell, cursor: 'pointer' }} onClick={openCash}>
            <span style={S.posKey}>{t('cash_balance')} ✏️</span>
            <span style={S.posVal}>{masked(fmt(cash))}</span>
          </div>
          <div style={S.posCell}><span style={S.posKey}>{t('unrealized_pnl')}</span>
            <span style={{ ...S.posVal, color: costBasis > 0 ? pnlColor(unrealized) : 'var(--text-muted)' }}>
              {costBasis > 0 ? masked(`${signed(unrealized)} (${unrealized >= 0 ? '+' : ''}${((unrealized / costBasis) * 100).toFixed(1)}%)`) : '—'}
            </span>
          </div>
          <div style={S.posCell}><span style={S.posKey}>{t('realized_pnl')}</span>
            <span style={{ ...S.posVal, color: Math.abs(realized) > 0.005 ? pnlColor(realized) : 'var(--text-muted)' }}>{Math.abs(realized) > 0.005 ? masked(signed(realized)) : '—'}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button className="btn btn-primary btn-block" onClick={openCreateHolding}>＋ {t('add_holding')}</button>
        {activeHoldings.length > 0 && (
          <button className="btn btn-secondary btn-block" onClick={openPrices}>💱 {t('batch_update_prices')}</button>
        )}
      </div>

      <div className="entry-group-title">
        <span className="dot" style={{ background: theme.assetColor }} />{t('holdings_title')} ({activeHoldings.length})
        <span style={{ flex: 1 }} />
        {hasSymbols && (
          <button onClick={() => refreshQuotes(false)} disabled={refreshing}
            style={{ background: 'none', border: 'none', color: 'var(--asset-color)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', padding: '2px 4px', opacity: refreshing ? 0.5 : 1 }}>
            🔄 {t('refresh_quotes')}
          </button>
        )}
      </div>
      {activeHoldings.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>{t('no_holdings')}</div>
      ) : (
        activeHoldings.map(h => renderHolding(h))
      )}

      {archivedHoldings.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="entry-group-title">
            <span className="dot" style={{ background: 'var(--text-muted)' }} />{t('archived_holdings_title')} ({archivedHoldings.length})
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '-2px 0 8px' }}>{t('archived_holdings_hint')}</div>
          {archivedHoldings.map(h => renderHolding(h, true))}
        </div>
      )}

      {/* Holding create / edit */}
      {showHoldingForm && (
        <div className="modal-overlay" onClick={() => { setShowHoldingForm(false); setEditingHolding(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingHolding ? t('edit_holding') : t('add_holding')}</h2>
              <button className="modal-close" onClick={() => { setShowHoldingForm(false); setEditingHolding(null); }}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('name')}</label>
              <input className="form-input" placeholder={t('holding_name_ph')} value={hName} onChange={e => setHName(e.target.value)} autoFocus={!editingHolding} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('f_code')}</label>
              <input className="form-input mono" placeholder={t('f_code_ph')} value={hSymbol} onChange={e => setHSymbol(e.target.value)} />
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
                {account.category === '场外基金' ? t('symbol_quote_hint_fund') : t('symbol_quote_hint_stock')}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('f_market')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {MARKET_OPTS.map(k => {
                  const label = t(k);
                  const active = hMarket === label;
                  return (
                    <button key={k} style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                      onClick={() => setHMarket(active ? '' : label)}>{label}</button>
                  );
                })}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('last_price')} ({account.currency})</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="0.0001" min="0"
                placeholder={t('price_per_share_ph')} value={hPrice} onChange={e => setHPrice(e.target.value)} />
            </div>
            {!editingHolding && (
              <>
                <div style={S.divider}><span style={S.dividerText}>{t('initial_position')}</span></div>
                <div className="form-group">
                  <label className="form-label">{t('shares')}</label>
                  <input className="form-input mono" type="number" inputMode="decimal" step="1" min="0"
                    placeholder={t('shares_ph')} value={hInitShares} onChange={e => setHInitShares(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('avg_cost_label')} ({account.currency})</label>
                  <input className="form-input mono" type="number" inputMode="decimal" step="0.0001" min="0"
                    placeholder={t('f_cost_ph')} value={hInitPrice} onChange={e => setHInitPrice(e.target.value)} />
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setShowHoldingForm(false); setEditingHolding(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSaveHolding}>{editingHolding ? t('save') : t('create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Buy / sell transaction */}
      {txnHolding && (() => {
        const shares = parseFloat(txnShares);
        const price = parseFloat(txnPrice);
        const valid = !isNaN(shares) && shares > 0 && !isNaN(price) && price >= 0;
        const isSell = txnKind === 'sell';
        const txnColor = isSell ? theme.liabilityColor : theme.assetColor;
        return (
          <div className="modal-overlay" onClick={() => { setTxnHolding(null); setEditingTxn(null); }}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title" style={{ color: txnColor }}>
                  {editingTxn ? t('edit_record') : (isSell ? t('sell_record') : t('buy_record'))} · {txnHolding.name}
                </h2>
                <button className="modal-close" onClick={() => { setTxnHolding(null); setEditingTxn(null); }}>✕</button>
              </div>
              {!editingTxn && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button className="btn btn-block" style={{ background: txnKind === 'buy' ? theme.assetColor : 'var(--bg-glass)', color: txnKind === 'buy' ? '#000' : 'var(--text-secondary)', border: txnKind === 'buy' ? 'none' : '1px solid var(--border)', fontWeight: 700 }} onClick={() => setTxnKind('buy')}>＋ {t('buy_in')}</button>
                  <button className="btn btn-block" style={{ background: txnKind === 'sell' ? theme.liabilityColor : 'var(--bg-glass)', color: txnKind === 'sell' ? '#fff' : 'var(--text-secondary)', border: txnKind === 'sell' ? 'none' : '1px solid var(--border)', fontWeight: 700 }} onClick={() => setTxnKind('sell')}>－ {t('sell_out')}</button>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t('date')}</label>
                <input className="form-input" type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('shares')}</label>
                <input className="form-input mono" type="number" inputMode="decimal" step="1" min="0"
                  placeholder={t('shares_ph')} value={txnShares} onChange={e => setTxnShares(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">{t('txn_price')} ({account.currency})</label>
                <input className="form-input mono" type="number" inputMode="decimal" step="0.0001" min="0"
                  placeholder={txnHolding.lastPrice > 0 ? String(txnHolding.lastPrice) : '0.00'}
                  value={txnPrice} onChange={e => setTxnPrice(e.target.value)} />
              </div>
              {valid && (
                <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{isSell ? t('sell_out') : t('buy_in')} {shares.toLocaleString('en-US', { maximumFractionDigits: 4 })} × {price}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: txnColor }}>{fmtFull(shares * price)} {account.currency}</span>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t('note')}</label>
                <input className="form-input" placeholder={t('note_placeholder')} value={txnNote} onChange={e => setTxnNote(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary btn-block" onClick={() => { setTxnHolding(null); setEditingTxn(null); }}>{t('cancel')}</button>
                <button className="btn btn-primary btn-block" disabled={!valid} onClick={handleSaveTxn}>{editingTxn ? t('update') : t('save')}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Batch price update */}
      {showPrices && (
        <div className="modal-overlay" onClick={() => setShowPrices(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t('batch_update_prices')}</h2>
              <button className="modal-close" onClick={() => setShowPrices(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('price_date_label')}</label>
              <input className="form-input" type="date" value={priceDate} onChange={e => setPriceDate(e.target.value)} />
            </div>
            {activeHoldings.map(h => (
              <div className="form-group" key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</div>
                  {h.symbol && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{h.symbol}</div>}
                </div>
                <input className="form-input mono" type="number" inputMode="decimal" step="0.0001" min="0"
                  style={{ width: 130, flexShrink: 0 }}
                  value={priceInputs[h.id] ?? ''}
                  onChange={e => setPriceInputs(prev => ({ ...prev, [h.id]: e.target.value }))} />
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => setShowPrices(false)}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSavePrices}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Cash balance */}
      {showCash && (
        <div className="confirm-overlay" onClick={() => setShowCash(false)}>
          <div className="modal-content" style={{ maxWidth: 360, width: '90%', borderRadius: 16, padding: '20px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t('edit_cash')}</h2>
              <button className="modal-close" onClick={() => setShowCash(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('cash_balance')} ({account.currency})</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="0.01" min="0"
                placeholder="0.00" value={cashInput} onChange={e => setCashInput(e.target.value)} autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => setShowCash(false)}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSaveCash}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete holding confirm */}
      {confirmDeleteHolding && (
        <div className="confirm-overlay" onClick={() => setConfirmDeleteHolding(null)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div className="confirm-msg">{t('delete_holding_confirm')}</div>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDeleteHolding(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={() => handleDeleteHolding(confirmDeleteHolding)}>{t('confirm_delete')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  holdingCard: { background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 8 },
  archivedHoldingCard: { opacity: 0.72 },
  badge: { fontSize: '0.62rem', fontWeight: 600, background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 8, padding: '1px 7px', color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' },
  archivedBadge: { fontSize: '0.62rem', fontWeight: 700, background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 8, padding: '1px 7px', color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' },
  posCell: { background: 'var(--bg-glass)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 },
  posKey: { fontSize: '0.66rem', color: 'var(--text-muted)' },
  posVal: { fontSize: '0.85rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' },
  txnRow: { display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 },
  chip: { padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-glass)', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0 },
  chipActive: { background: 'var(--asset-dim)', border: '1px solid var(--asset-color)', color: 'var(--asset-color)', fontWeight: 600 },
  divider: { display: 'flex', alignItems: 'center', margin: '4px 0 12px', gap: 8 },
  dividerText: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' },
};
