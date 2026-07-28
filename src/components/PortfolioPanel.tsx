import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Holding, HoldingTxn } from '../db';
import {
  getHoldingsWithPositions, getAccountTxns, createHolding, updateHolding, deleteHolding,
  addHoldingTxn, updateHoldingTxn, deleteHoldingTxn, setCashBalance, updatePrices, updateBalances, setHoldingBalance,
  updateHoldingBalanceSnapshot,
  type HoldingWithPosition,
} from '../services/holdingService';
import { fetchQuotes } from '../services/quoteService';
import { useAppContext } from '../app-context';
import { splitHoldingsByArchive } from '../lib/holdingArchive';
import {
  getDefaultHoldingModeForCategory,
  getProductHoldingFields,
  shouldShowProductCodeForCategory,
  usesBalanceHoldings,
  usesLiveQuotes,
} from '../lib/productPortfolio';
import {
  getBalanceFlowActionKey,
  getBalanceFlowConfig,
} from '../lib/balanceFlow';
import { deriveBalanceHoldingTimeline } from '../lib/holdingPosition';
import {
  buildUsOptionContract,
  formatStrikeMilli,
  formatUsOptionLabel,
  getHoldingContractMultiplier,
  parseStrikeMilli,
  resolveUsOptionContract,
  toUsOptionSymbol,
  type UsOptionRight,
} from '../lib/usOption';
import { formatLocalDate } from '../lib/localDate';

interface Props { account: Account; onChanged: () => void; }

const MARKET_OPTS = ['opt_a_share', 'opt_us_market', 'opt_hk_market', 'opt_other'];

const today = () => formatLocalDate();

export default function PortfolioPanel({ account, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, amountVisible } = useAppContext();
  const defaultHoldingMode = getDefaultHoldingModeForCategory(account.category);
  const isBalancePortfolio = defaultHoldingMode === 'balance';
  const balanceFlow = isBalancePortfolio ? getBalanceFlowConfig(account.category, account.type) : null;
  const usesDerivedBalance = Boolean(balanceFlow?.transactionOnly);
  const quoteRefreshEnabled = usesLiveQuotes(account.category);
  const productHoldingFields = isBalancePortfolio ? getProductHoldingFields(account.category) : [];
  const showProductCode = !isBalancePortfolio || shouldShowProductCodeForCategory(account.category);
  const [holdings, setHoldings] = useState<HoldingWithPosition[]>([]);
  const [txns, setTxns] = useState<HoldingTxn[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showArchivedHoldings, setShowArchivedHoldings] = useState(false);

  // Holding create/edit modal
  const [showHoldingForm, setShowHoldingForm] = useState(false);
  const [editingHolding, setEditingHolding] = useState<HoldingWithPosition | null>(null);
  const [hName, setHName] = useState('');
  const [hSymbol, setHSymbol] = useState('');
  const [hMarket, setHMarket] = useState('');
  const [hInstrumentType, setHInstrumentType] = useState<'security' | 'us_option'>('security');
  const [hOptionUnderlying, setHOptionUnderlying] = useState('');
  const [hOptionExpiration, setHOptionExpiration] = useState('');
  const [hOptionRight, setHOptionRight] = useState<UsOptionRight>('call');
  const [hOptionStrike, setHOptionStrike] = useState('');
  const [hPrice, setHPrice] = useState('');
  const [hProductData, setHProductData] = useState<Record<string, string>>({});
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

  // Direct balance adjustment modal (separate from principal-flow transactions)
  const [adjustHolding, setAdjustHolding] = useState<HoldingWithPosition | null>(null);
  const [editingBalanceTxn, setEditingBalanceTxn] = useState<HoldingTxn | null>(null);
  const [adjustDate, setAdjustDate] = useState(today());
  const [adjustInput, setAdjustInput] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

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
    if (!quoteRefreshEnabled) return;
    if (refreshingRef.current) return;
    // read fresh from db so this also works right after mount / external changes
    const current = await getHoldingsWithPositions(account.id);
    const { active } = splitHoldingsByArchive(current);
    const targets = active.filter(h => (h.symbol || '').trim() || resolveUsOptionContract(h));
    if (targets.length === 0) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const res = await fetchQuotes(
        targets.map(h => ({
          id: h.id,
          name: h.name,
          symbol: h.symbol,
          market: h.market,
          instrumentType: h.instrumentType,
          optionUnderlying: h.optionUnderlying,
          optionExpiration: h.optionExpiration,
          optionRight: h.optionRight,
          optionStrikeMilli: h.optionStrikeMilli,
          contractMultiplier: h.contractMultiplier,
        })),
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
  }, [account.id, account.category, load, onChanged, quoteRefreshEnabled, t]);

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
  const costBasis = isBalancePortfolio ? 0 : activeHoldings.reduce((s, h) => s + h.position.costBasis, 0);
  const unrealized = isBalancePortfolio ? 0 : positionValue - costBasis;
  const realized = isBalancePortfolio ? 0 : holdings.reduce((s, h) => s + h.position.realizedPnl, 0);
  const cumulativePnl = unrealized + realized;
  const cumulativePnlRateBasis = isBalancePortfolio ? 0 : holdings.reduce((sum, h) => (
    sum + (h.position.shares > 1e-9 ? h.position.netInvested : h.position.realizedCostBasis)
  ), 0);
  const cumulativePnlRate = cumulativePnlRateBasis > 1e-9 ? (cumulativePnl / cumulativePnlRateBasis) * 100 : null;

  // ---- Holding form ----
  const openCreateHolding = () => {
    setEditingHolding(null);
    setHName(''); setHSymbol(''); setHMarket(''); setHPrice('');
    setHInstrumentType('security'); setHOptionUnderlying(''); setHOptionExpiration('');
    setHOptionRight('call'); setHOptionStrike('');
    setHProductData({});
    setHInitShares(''); setHInitPrice('');
    setShowHoldingForm(true);
  };
  const openEditHolding = (h: HoldingWithPosition) => {
    const optionContract = resolveUsOptionContract(h);
    setEditingHolding(h);
    setHName(h.name); setHSymbol(h.symbol || ''); setHMarket(h.market || '');
    // Legacy free-text option names can fetch quotes immediately, but switching their
    // valuation to 100× must remain an explicit user choice because old quantities may
    // have been entered as shares instead of contracts.
    setHInstrumentType(h.instrumentType === 'us_option' ? 'us_option' : 'security');
    setHOptionUnderlying(optionContract?.underlying ?? '');
    setHOptionExpiration(optionContract?.expiration ?? '');
    setHOptionRight(optionContract?.right ?? 'call');
    setHOptionStrike(optionContract ? formatStrikeMilli(optionContract.strikeMilli) : '');
    setHPrice(isBalancePortfolio ? (h.marketValue > 0 ? String(Math.round(h.marketValue * 100) / 100) : '') : (h.lastPrice > 0 ? String(h.lastPrice) : ''));
    setHProductData(h.productData ? { ...h.productData } : {});
    setShowHoldingForm(true);
  };
  const handleSaveHolding = async () => {
    if (!hName.trim()) return;
    const cleanProductData = Object.fromEntries(Object.entries(hProductData).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const missingRequired = productHoldingFields.some(field => field.required && !cleanProductData[field.key]);
    if (missingRequired) {
      alert(t('required_fields_missing'));
      return;
    }
    const strikeMilli = parseStrikeMilli(hOptionStrike);
    const optionContract = hInstrumentType === 'us_option' && strikeMilli != null
      ? buildUsOptionContract({
          underlying: hOptionUnderlying,
          expiration: hOptionExpiration,
          right: hOptionRight,
          strikeMilli,
        })
      : null;
    if (hInstrumentType === 'us_option' && !optionContract) {
      alert(t('option_contract_incomplete'));
      return;
    }
    const meta: Pick<Holding,
      'name' | 'symbol' | 'market' | 'instrumentType' | 'optionUnderlying' | 'optionExpiration'
      | 'optionRight' | 'optionStrikeMilli' | 'contractMultiplier' | 'mode' | 'productData'
    > = {
      name: hName.trim(),
      symbol: optionContract
        ? toUsOptionSymbol(optionContract)
        : showProductCode ? (hSymbol.trim() || undefined) : undefined,
      market: isBalancePortfolio ? undefined : (optionContract ? t('opt_us_market') : (hMarket || undefined)),
      instrumentType: optionContract ? 'us_option' : undefined,
      optionUnderlying: optionContract?.underlying,
      optionExpiration: optionContract?.expiration,
      optionRight: optionContract?.right,
      optionStrikeMilli: optionContract?.strikeMilli,
      contractMultiplier: optionContract?.multiplier,
      mode: defaultHoldingMode,
      productData: Object.keys(cleanProductData).length > 0 ? cleanProductData : undefined,
    };
    const priceOrBalance = parseFloat(hPrice);
    if (editingHolding) {
      await updateHolding(editingHolding.id, meta);
      if (isBalancePortfolio && !usesDerivedBalance) {
        if (!isNaN(priceOrBalance) && priceOrBalance >= 0 && Math.abs(priceOrBalance - editingHolding.marketValue) > 0.005) {
          await setHoldingBalance(account.id, editingHolding.id, priceOrBalance, today(), t('balance_adjustment_note'));
        }
      } else if (!isNaN(priceOrBalance) && priceOrBalance > 0 && priceOrBalance !== editingHolding.lastPrice) {
        await updatePrices(account.id, { [editingHolding.id]: priceOrBalance }, today());
      }
    } else {
      const initShares = parseFloat(hInitShares);
      const initPrice = parseFloat(hInitPrice);
      const lastPrice = isBalancePortfolio ? 1 : (!isNaN(priceOrBalance) && priceOrBalance > 0 ? priceOrBalance : (!isNaN(initPrice) && initPrice > 0 ? initPrice : 0));
      const id = await createHolding(account.id, { ...meta, lastPrice, priceDate: lastPrice > 0 ? today() : undefined });
      if (isBalancePortfolio) {
        if (!isNaN(priceOrBalance) && priceOrBalance > 0) {
          await addHoldingTxn(account.id, id, { date: today(), kind: 'buy', shares: priceOrBalance, price: 1, note: t('initial_balance_note') });
        }
      } else if (!isNaN(initShares) && initShares > 0 && !isNaN(initPrice) && initPrice > 0) {
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
    setTxnPrice(isBalancePortfolio ? '1' : (h.lastPrice > 0 ? String(h.lastPrice) : ''));
    setTxnNote('');
  };
  const openEditTxn = (h: HoldingWithPosition, tx: HoldingTxn) => {
    setTxnHolding(h); setEditingTxn(tx); setTxnKind(tx.kind);
    setTxnDate(tx.date); setTxnShares(String(tx.shares)); setTxnPrice(String(tx.price));
    setTxnNote(tx.note || '');
  };
  const previewBalanceTxn = (
    holdingId: string,
    currentTxn: HoldingTxn | null,
    kind: 'buy' | 'sell',
    date: string,
    shares: number,
  ) => {
    const candidate: HoldingTxn = {
      ...(currentTxn ?? {
        id: '__preview__',
        accountId: account.id,
        holdingId,
        createdAt: Number.MAX_SAFE_INTEGER,
      }),
      date,
      kind,
      shares,
      price: 1,
      balanceSnapshot: undefined,
    };
    const holdingTxns = txns.filter(tx => tx.holdingId === holdingId);
    const previewTxns = currentTxn
      ? holdingTxns.map(tx => tx.id === currentTxn.id ? candidate : tx)
      : [...holdingTxns, candidate];
    const timeline = deriveBalanceHoldingTimeline(previewTxns);
    return {
      balance: timeline.at(-1)?.balance ?? 0,
      underflow: timeline.some(entry => entry.underflow),
    };
  };
  const handleSaveTxn = async () => {
    if (!txnHolding) return;
    const shares = parseFloat(txnShares);
    const price = isBalancePortfolio ? 1 : parseFloat(txnPrice);
    if (isNaN(shares) || shares <= 0 || isNaN(price) || price < 0) return;
    const balancePreview = isBalancePortfolio
      ? previewBalanceTxn(txnHolding.id, editingTxn, txnKind, txnDate, shares)
      : null;
    if (balancePreview?.underflow) {
      alert(t('balance_decrease_exceeds'));
      return;
    }
    if (!isBalancePortfolio && txnKind === 'sell' && !editingTxn && shares > txnHolding.position.shares + 1e-6) {
      alert(t(isBalancePortfolio ? 'sell_exceeds_balance' : 'sell_exceeds_shares', { shares: txnHolding.position.shares.toLocaleString('en-US', { maximumFractionDigits: isBalancePortfolio ? 2 : 4 }) }));
      return;
    }
    const input = { date: txnDate, kind: txnKind, shares, price, note: txnNote.trim() || undefined };
    if (editingTxn) await updateHoldingTxn(editingTxn.id, input);
    else await addHoldingTxn(account.id, txnHolding.id, input);
    setTxnHolding(null); setEditingTxn(null);
    await changed();
  };
  const handleDeleteTxn = async (id: string) => { await deleteHoldingTxn(id); await changed(); };

  // ---- Direct balance adjustment ----
  const openBalanceAdjustment = (h: HoldingWithPosition, txn: HoldingTxn | null = null) => {
    setAdjustHolding(h);
    setEditingBalanceTxn(txn);
    setAdjustDate(txn?.date ?? today());
    setAdjustInput(String(txn?.balanceSnapshot ?? Math.round(h.marketValue * 100) / 100));
    setAdjustNote(txn?.note || '');
  };
  const closeBalanceAdjustment = () => {
    setAdjustHolding(null);
    setEditingBalanceTxn(null);
    setAdjustInput('');
    setAdjustNote('');
  };
  const handleSaveBalanceAdjustment = async () => {
    if (!adjustHolding) return;
    const target = parseFloat(adjustInput);
    if (isNaN(target) || target < 0) return;
    const note = adjustNote.trim() || t('balance_adjustment_note');
    if (editingBalanceTxn) {
      await updateHoldingBalanceSnapshot(editingBalanceTxn.id, target, adjustDate, note);
    } else {
      await setHoldingBalance(account.id, adjustHolding.id, target, adjustDate, note);
    }
    closeBalanceAdjustment();
    await changed();
  };

  // ---- Batch prices ----
  const openPrices = () => {
    setPriceDate(today());
    setPriceInputs(Object.fromEntries(activeHoldings.map(h => [h.id, isBalancePortfolio ? (h.marketValue > 0 ? String(Math.round(h.marketValue * 100) / 100) : '') : (h.lastPrice > 0 ? String(h.lastPrice) : '')])));
    setShowPrices(true);
  };
  const handleSavePrices = async () => {
    const parsed: Record<string, number> = {};
    for (const [id, v] of Object.entries(priceInputs)) {
      const p = parseFloat(v);
      if (!isNaN(p) && (isBalancePortfolio ? p >= 0 : p > 0)) parsed[id] = p;
    }
    if (isBalancePortfolio) await updateBalances(account.id, parsed, priceDate);
    else await updatePrices(account.id, parsed, priceDate);
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
    const holdingIsBalance = usesBalanceHoldings(account.category, h);
    const isBalanceAdjustment = holdingIsBalance && tx.balanceSnapshot != null;
    const txnColor = isSell ? theme.liabilityColor : theme.assetColor;
    const multiplier = getHoldingContractMultiplier(h);
    return (
      <div key={tx.id} style={S.txnRow}>
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, background: isBalanceAdjustment ? 'var(--bg-glass)' : isSell ? theme.liabilityDim : theme.assetDim, color: isBalanceAdjustment ? 'var(--text-muted)' : txnColor, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>
          {isBalanceAdjustment
            ? t('balance_adjustment')
            : holdingIsBalance && balanceFlow
            ? t(getBalanceFlowActionKey(balanceFlow, tx.kind))
            : t(isSell ? 'sell_out' : 'buy_in')}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{tx.date}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isBalanceAdjustment
            ? masked(`= ${tx.balanceSnapshot!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${account.currency}`)
            : holdingIsBalance
            ? masked(`${isSell ? '-' : '+'}${tx.shares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${account.currency}`)
            : masked(`${tx.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })}${multiplier > 1 ? ` × ${multiplier}` : ''} × ${tx.price.toFixed(account.currency === 'JPY' ? 0 : 3)}`)}
        </span>
        <div className="entry-actions" style={{ flexShrink: 0 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => isBalanceAdjustment ? openBalanceAdjustment(h, tx) : openEditTxn(h, tx)}>✏️</button>
          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteTxn(tx.id)}>✕</button>
        </div>
      </div>
    );
  };

  const renderHolding = (h: HoldingWithPosition, archived = false) => {
    const expanded = expandedId === h.id;
    const holdingIsBalance = usesBalanceHoldings(account.category, h);
    const optionContract = resolveUsOptionContract(h);
    const multiplier = getHoldingContractMultiplier(h);
    const productMeta = getProductHoldingFields(account.category)
      .map(field => ({ field, value: h.productData?.[field.key]?.trim() }))
      .filter((item): item is { field: (typeof productHoldingFields)[number]; value: string } => Boolean(item.value));
    const hasPnl = h.position.costBasis > 0 || Math.abs(h.position.realizedPnl) > 0.005;
    const pnlRateText = h.totalPnlRate == null
      ? ''
      : ` (${h.totalPnlRate >= 0 ? '+' : ''}${h.totalPnlRate.toFixed(1)}%)`;
    const hTxns = txns.filter(tx => tx.holdingId === h.id);
    const totalIn = hTxns.filter(tx => tx.balanceSnapshot == null && tx.kind === 'buy').reduce((s, tx) => s + tx.shares, 0);
    const totalOut = hTxns.filter(tx => tx.balanceSnapshot == null && tx.kind === 'sell').reduce((s, tx) => s + tx.shares, 0);
    return (
      <div key={h.id} className="holding-card" style={{ ...S.holdingCard, ...(archived ? S.archivedHoldingCard : {}), border: `1px solid ${expanded ? 'var(--border-active)' : 'var(--border)'}` }}>
        <div style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expanded ? null : h.id)}>
          <div className="holding-card-summary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="holding-card-name" style={{ fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
            {h.symbol && <span style={S.badge}>{optionContract ? formatUsOptionLabel(optionContract) : h.symbol}</span>}
            {h.market && <span style={S.badge}>{h.market}</span>}
            {archived && <span style={S.archivedBadge}>{t('archived_holding_badge')}</span>}
            <span className="holding-card-spacer" style={{ flex: 1 }} />
            <span className="holding-card-amount" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9375rem', whiteSpace: 'nowrap' }}>
              {masked(fmt(h.marketValue))}
            </span>
          </div>
          <div className="holding-card-detail" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {holdingIsBalance
                ? `${t(balanceFlow?.balanceLabelKey ?? 'current_balance')} ${masked(h.marketValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} ${account.currency}`
                : `${masked(h.position.shares.toLocaleString('en-US', { maximumFractionDigits: 4 }))} ${t(optionContract ? 'option_contracts_unit' : 'shares_unit')} · ${t('last_price')} ${h.lastPrice > 0 ? masked(h.lastPrice.toFixed(3)) : '—'}${h.priceDate ? ` (${h.priceDate.slice(5)})` : ''}`}
            </span>
            {!holdingIsBalance && hasPnl && (
              <span className="holding-card-pnl" style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontWeight: 600, color: pnlColor(h.totalPnl), whiteSpace: 'nowrap' }}>
                {masked(`${signed(h.totalPnl)}${pnlRateText}`)}
              </span>
            )}
          </div>
          {productMeta.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {productMeta.map(({ field, value }) => (
                <span key={field.key} style={S.badge}>{t(field.labelKey)} {value}</span>
              ))}
            </div>
          )}
        </div>

        {expanded && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {holdingIsBalance ? (
                <>
                  {productMeta.map(({ field, value }) => (
                    <div style={S.posCell} key={field.key}><span style={S.posKey}>{t(field.labelKey)}</span><span style={S.posVal}>{value}</span></div>
                  ))}
                  <div style={S.posCell}><span style={S.posKey}>{t(balanceFlow?.balanceLabelKey ?? 'current_balance')}</span><span style={S.posVal}>{masked(fmt(h.marketValue))}</span></div>
                  <div style={S.posCell}><span style={S.posKey}>{t('txn_history')}</span><span style={S.posVal}>{hTxns.length}</span></div>
                  <div style={S.posCell}><span style={S.posKey}>{t(balanceFlow?.totalIncreaseLabelKey ?? 'total_buy_amount')}</span><span style={S.posVal}>{totalIn > 0 ? masked(fmt(totalIn)) : '—'}</span></div>
                  <div style={S.posCell}><span style={S.posKey}>{t(balanceFlow?.totalDecreaseLabelKey ?? 'total_sell_amount')}</span><span style={S.posVal}>{totalOut > 0 ? masked(fmt(totalOut)) : '—'}</span></div>
                </>
              ) : (
                <>
                  <div style={S.posCell}><span style={S.posKey}>{t('diluted_cost')}</span><span style={S.posVal}>{h.position.shares > 1e-9 ? masked(h.position.dilutedCost.toFixed(3)) : '—'}</span></div>
                  <div style={S.posCell}><span style={S.posKey}>{t('avg_buy_cost')}</span><span style={S.posVal}>{h.position.avgCost > 0 ? masked(h.position.avgCost.toFixed(3)) : '—'}</span></div>
                  <div style={S.posCell}><span style={S.posKey}>{t('total_pnl')}</span><span style={{ ...S.posVal, color: hasPnl ? pnlColor(h.totalPnl) : 'var(--text-muted)' }}>{hasPnl ? masked(signed(h.totalPnl)) : '—'}</span></div>
                  <div style={S.posCell}><span style={S.posKey}>{t('holding_cost')}</span><span style={S.posVal}>{h.position.costBasis > 0 ? masked(fmt(h.position.costBasis)) : '—'}</span></div>
                  {optionContract && <div style={S.posCell}><span style={S.posKey}>{t('option_multiplier')}</span><span style={S.posVal}>× {multiplier}</span></div>}
                  <div style={S.posCell}><span style={S.posKey}>{t('unrealized_pnl')}</span><span style={{ ...S.posVal, color: h.position.costBasis > 0 ? pnlColor(h.unrealizedPnl) : 'var(--text-muted)' }}>{h.position.costBasis > 0 ? masked(signed(h.unrealizedPnl)) : '—'}</span></div>
                  <div style={S.posCell}><span style={S.posKey}>{t('realized_pnl')}</span><span style={{ ...S.posVal, color: Math.abs(h.position.realizedPnl) > 0.005 ? pnlColor(h.position.realizedPnl) : 'var(--text-muted)' }}>{Math.abs(h.position.realizedPnl) > 0.005 ? masked(signed(h.position.realizedPnl)) : '—'}</span></div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              <button className="btn btn-sm btn-block" style={{ background: theme.assetColor, color: 'var(--theme-on-asset)', fontWeight: 700 }} onClick={() => openTxn(h, 'buy')}>＋ {t(balanceFlow?.increaseActionKey ?? 'buy_in')}</button>
              {!archived && <button className="btn btn-sm btn-block" style={{ background: theme.liabilityColor, color: '#fff', fontWeight: 700 }} onClick={() => openTxn(h, 'sell')}>－ {t(balanceFlow?.decreaseActionKey ?? 'sell_out')}</button>}
              {holdingIsBalance && usesDerivedBalance && (
                <button className="btn btn-sm btn-secondary btn-block" onClick={() => openBalanceAdjustment(h)}>
                  {t('balance_adjustment')}
                </button>
              )}
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

  const hasSymbols = quoteRefreshEnabled && activeHoldings.some(h => (h.symbol || '').trim() || resolveUsOptionContract(h));
  const indicatorVisible = quoteRefreshEnabled && (pullDy > 0 || refreshing || quoteMsg);
  const formStrikeMilli = parseStrikeMilli(hOptionStrike);
  const formOptionContract = hInstrumentType === 'us_option' && formStrikeMilli != null
    ? buildUsOptionContract({
        underlying: hOptionUnderlying,
        expiration: hOptionExpiration,
        right: hOptionRight,
        strikeMilli: formStrikeMilli,
      })
    : null;

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
          <div style={S.posCell}><span style={S.posKey}>{isBalancePortfolio ? t('product_balance_total') : t('position_value')}</span><span style={S.posVal}>{masked(fmt(positionValue))}</span></div>
          <div style={{ ...S.posCell, cursor: 'pointer' }} onClick={openCash}>
            <span style={S.posKey}>{t('cash_balance')} ✏️</span>
            <span style={S.posVal}>{masked(fmt(cash))}</span>
          </div>
          {isBalancePortfolio ? (
            <>
              <div style={S.posCell}><span style={S.posKey}>{t('active_products')}</span><span style={S.posVal}>{activeHoldings.length}</span></div>
              <div style={S.posCell}><span style={S.posKey}>{t('archived_products_title')}</span><span style={S.posVal}>{archivedHoldings.length}</span></div>
            </>
          ) : (
            <>
              <div style={S.posCell}><span style={S.posKey}>{t('total_pnl')}</span>
                <span style={{ ...S.posVal, color: costBasis > 0 || Math.abs(realized) > 0.005 ? pnlColor(cumulativePnl) : 'var(--text-muted)' }}>
                  {costBasis > 0 || Math.abs(realized) > 0.005
                    ? masked(`${signed(cumulativePnl)}${cumulativePnlRate == null ? '' : ` (${cumulativePnlRate >= 0 ? '+' : ''}${cumulativePnlRate.toFixed(1)}%)`}`)
                    : '—'}
                </span>
              </div>
              <div style={S.posCell}><span style={S.posKey}>{t('realized_pnl')}</span>
                <span style={{ ...S.posVal, color: Math.abs(realized) > 0.005 ? pnlColor(realized) : 'var(--text-muted)' }}>{Math.abs(realized) > 0.005 ? masked(signed(realized)) : '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button className="btn btn-primary btn-block" onClick={openCreateHolding}>＋ {t(isBalancePortfolio ? 'add_product' : 'add_holding')}</button>
        {activeHoldings.length > 0 && !usesDerivedBalance && (
          <button className="btn btn-secondary btn-block" onClick={openPrices}>💱 {t(isBalancePortfolio ? 'batch_update_balances' : 'batch_update_prices')}</button>
        )}
      </div>

      <div className="entry-group-title">
        <span className="dot" style={{ background: theme.assetColor }} />{t(isBalancePortfolio ? 'products_in_account' : 'holdings_title')} ({activeHoldings.length})
        <span style={{ flex: 1 }} />
        {hasSymbols && (
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => refreshQuotes(false)} disabled={refreshing}
            style={{ color: 'var(--asset-color)', fontSize: '0.72rem', fontWeight: 600 }}>
            🔄 {t('refresh_quotes')}
          </button>
        )}
      </div>
      {activeHoldings.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', padding: 20, textAlign: 'center' }}>{t(isBalancePortfolio ? 'no_products_in_account' : 'no_holdings')}</div>
      ) : (
        activeHoldings.map(h => renderHolding(h))
      )}

      {archivedHoldings.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="entry-group-title collapsible-section-title">
            <span className="dot" style={{ background: 'var(--text-muted)' }} />
            <span className="collapsible-section-label">{t(isBalancePortfolio ? 'archived_products_title' : 'archived_holdings_title')} ({archivedHoldings.length})</span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setShowArchivedHoldings(value => !value)}
              aria-expanded={showArchivedHoldings}
              aria-label={showArchivedHoldings ? t('hide_archived_positions') : t('show_archived_positions')}
            >
              {showArchivedHoldings ? `👁️ ${t('hide_archived_assets')}` : `📦 ${t('show_archived_assets')}`}
            </button>
          </div>
          {showArchivedHoldings && <>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '-2px 0 8px' }}>{t(isBalancePortfolio ? 'archived_products_hint' : 'archived_holdings_hint')}</div>
            {archivedHoldings.map(h => renderHolding(h, true))}
          </>}
        </div>
      )}

      {/* Holding create / edit */}
      {showHoldingForm && (
        <div className="modal-overlay" onClick={() => { setShowHoldingForm(false); setEditingHolding(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingHolding ? t(isBalancePortfolio ? 'edit_product' : 'edit_holding') : t(isBalancePortfolio ? 'add_product' : 'add_holding')}</h2>
              <button className="modal-close" onClick={() => { setShowHoldingForm(false); setEditingHolding(null); }}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('name')}</label>
              <input className="form-input" placeholder={t(isBalancePortfolio ? 'product_holding_name_ph' : 'holding_name_ph')} value={hName} onChange={e => setHName(e.target.value)} autoFocus={!editingHolding} />
            </div>
            {!isBalancePortfolio && account.category === '股票/ETF' && (
              <div className="form-group">
                <label className="form-label">{t('instrument_type')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-block" type="button"
                    style={{ background: hInstrumentType === 'security' ? 'var(--asset-dim)' : 'var(--bg-glass)', border: `1px solid ${hInstrumentType === 'security' ? 'var(--asset-color)' : 'var(--border)'}`, color: 'var(--text-primary)' }}
                    onClick={() => setHInstrumentType('security')}>{t('instrument_security')}</button>
                  <button className="btn btn-block" type="button"
                    style={{ background: hInstrumentType === 'us_option' ? 'var(--asset-dim)' : 'var(--bg-glass)', border: `1px solid ${hInstrumentType === 'us_option' ? 'var(--asset-color)' : 'var(--border)'}`, color: 'var(--text-primary)' }}
                    onClick={() => setHInstrumentType('us_option')}>{t('instrument_us_option')}</button>
                </div>
              </div>
            )}
            {hInstrumentType === 'us_option' ? (
              <>
                <div className="form-group">
                  <label className="form-label">{t('option_underlying')} *</label>
                  <input className="form-input mono" placeholder={t('option_underlying_placeholder')} value={hOptionUnderlying}
                    onChange={e => setHOptionUnderlying(e.target.value.toUpperCase())} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">{t('option_expiration')} *</label>
                    <input className="form-input" type="date" value={hOptionExpiration} onChange={e => setHOptionExpiration(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('option_strike')} *</label>
                    <input className="form-input mono" type="number" inputMode="decimal" min="0" step="0.001"
                      placeholder="7.00" value={hOptionStrike} onChange={e => setHOptionStrike(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('option_right')} *</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['call', 'put'] as UsOptionRight[]).map(right => (
                      <button key={right} type="button" className="btn btn-block"
                        style={{ background: hOptionRight === right ? 'var(--asset-dim)' : 'var(--bg-glass)', border: `1px solid ${hOptionRight === right ? 'var(--asset-color)' : 'var(--border)'}`, color: 'var(--text-primary)' }}
                        onClick={() => setHOptionRight(right)}>{t(right === 'call' ? 'option_call' : 'option_put')}</button>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: '0.68rem', color: formOptionContract ? 'var(--text-muted)' : 'var(--liability-color)', margin: '-4px 0 12px', lineHeight: 1.5 }}>
                  {formOptionContract
                    ? t('option_contract_preview', { symbol: toUsOptionSymbol(formOptionContract) })
                    : t('option_contract_hint')}
                </div>
              </>
            ) : showProductCode && (
              <div className="form-group">
                <label className="form-label">{t(isBalancePortfolio ? 'product_code' : 'f_code')}</label>
                <input className="form-input mono" placeholder={t('f_code_ph')} value={hSymbol} onChange={e => setHSymbol(e.target.value)} />
                {!isBalancePortfolio && (
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
                    {account.category === '场外基金' ? t('symbol_quote_hint_fund') : t('symbol_quote_hint_stock')}
                  </div>
                )}
              </div>
            )}
            {!isBalancePortfolio && hInstrumentType !== 'us_option' && <div className="form-group">
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
            </div>}
            {(!editingHolding || !usesDerivedBalance) ? (
              <div className="form-group">
                <label className="form-label">{t(isBalancePortfolio ? (editingHolding ? 'current_balance' : (balanceFlow?.initialBalanceLabelKey ?? 'initial_balance')) : 'last_price')} ({account.currency})</label>
                <input className="form-input mono" type="number" inputMode="decimal" step={isBalancePortfolio ? '0.01' : '0.0001'} min="0"
                  placeholder={isBalancePortfolio ? '0.00' : t('price_per_share_ph')} value={hPrice} onChange={e => setHPrice(e.target.value)} />
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">{t(balanceFlow?.balanceLabelKey ?? 'current_balance')}</label>
                <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {masked(fmtFull(editingHolding.marketValue))} {account.currency}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('derived_balance_hint')}</div>
              </div>
            )}
            {productHoldingFields.map(field => (
              <div className="form-group" key={field.key}>
                <label className="form-label">{t(field.labelKey)}{field.required ? ' *' : ''}</label>
                <input className="form-input"
                  type={field.key === 'rate' ? 'number' : 'text'}
                  inputMode={field.key === 'rate' ? 'decimal' : undefined}
                  step={field.key === 'rate' ? '0.01' : undefined}
                  placeholder={field.placeholderKey ? t(field.placeholderKey) : ''}
                  value={hProductData[field.key] || ''}
                  onChange={e => setHProductData(prev => ({ ...prev, [field.key]: e.target.value }))} />
              </div>
            ))}
            {!editingHolding && !isBalancePortfolio && (
              <>
                <div style={S.divider}><span style={S.dividerText}>{t('initial_position')}</span></div>
                <div className="form-group">
                  <label className="form-label">{t(hInstrumentType === 'us_option' ? 'option_contracts' : 'shares')}</label>
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
        const price = isBalancePortfolio ? 1 : parseFloat(txnPrice);
        const valid = !isNaN(shares) && shares > 0 && !isNaN(price) && price >= 0;
        const isSell = txnKind === 'sell';
        const txnColor = isSell ? theme.liabilityColor : theme.assetColor;
        const txnMultiplier = getHoldingContractMultiplier(txnHolding);
        const balancePreview = isBalancePortfolio && valid
          ? previewBalanceTxn(txnHolding.id, editingTxn, txnKind, txnDate, shares)
          : null;
        const balanceUnderflow = Boolean(balancePreview?.underflow);
        return (
          <div className="modal-overlay" onClick={() => { setTxnHolding(null); setEditingTxn(null); }}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title" style={{ color: txnColor }}>
                  {editingTxn
                    ? t('edit_record')
                    : t(balanceFlow ? getBalanceFlowActionKey(balanceFlow, txnKind) : (isSell ? 'sell_record' : 'buy_record'))} · {txnHolding.name}
                </h2>
                <button className="modal-close" onClick={() => { setTxnHolding(null); setEditingTxn(null); }}>✕</button>
              </div>
              {!editingTxn && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button className="btn btn-block" style={{ background: txnKind === 'buy' ? theme.assetColor : 'var(--bg-glass)', color: txnKind === 'buy' ? '#000' : 'var(--text-secondary)', border: txnKind === 'buy' ? 'none' : '1px solid var(--border)', fontWeight: 700 }} onClick={() => setTxnKind('buy')}>＋ {t(balanceFlow?.increaseActionKey ?? 'buy_in')}</button>
                  <button className="btn btn-block" style={{ background: txnKind === 'sell' ? theme.liabilityColor : 'var(--bg-glass)', color: txnKind === 'sell' ? '#fff' : 'var(--text-secondary)', border: txnKind === 'sell' ? 'none' : '1px solid var(--border)', fontWeight: 700 }} onClick={() => setTxnKind('sell')}>－ {t(balanceFlow?.decreaseActionKey ?? 'sell_out')}</button>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t('date')}</label>
                <input className="form-input" type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t(isBalancePortfolio ? 'transaction_amount' : txnMultiplier > 1 ? 'option_contracts' : 'shares')}</label>
                <input className="form-input mono" type="number" inputMode="decimal" step={isBalancePortfolio ? '0.01' : '1'} min="0"
                  placeholder={isBalancePortfolio ? '0.00' : t('shares_ph')} value={txnShares} onChange={e => setTxnShares(e.target.value)} autoFocus />
              </div>
              {!isBalancePortfolio && <div className="form-group">
                <label className="form-label">{t('txn_price')} ({account.currency})</label>
                <input className="form-input mono" type="number" inputMode="decimal" step="0.0001" min="0"
                  placeholder={txnHolding.lastPrice > 0 ? String(txnHolding.lastPrice) : '0.00'}
                  value={txnPrice} onChange={e => setTxnPrice(e.target.value)} />
              </div>}
              {valid && (
                <div style={{ background: 'var(--bg-glass)', borderRadius: 10, padding: '10px 14px', marginBottom: 8, fontSize: '0.8125rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {t(balanceFlow ? getBalanceFlowActionKey(balanceFlow, txnKind) : (isSell ? 'sell_out' : 'buy_in'))} {shares.toLocaleString('en-US', { maximumFractionDigits: isBalancePortfolio ? 2 : 4 })}
                      {!isBalancePortfolio && `${txnMultiplier > 1 ? ` × ${txnMultiplier}` : ''} × ${price}`}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: txnColor }}>{fmtFull(shares * price * txnMultiplier)} {account.currency}</span>
                  </div>
                  {isBalancePortfolio && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, color: balanceUnderflow ? 'var(--liability-color)' : 'var(--text-muted)' }}>
                      <span>{balanceUnderflow ? t('balance_decrease_exceeds') : t('balance_after_change')}</span>
                      {!balanceUnderflow && <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmtFull(balancePreview?.balance ?? 0)} {account.currency}</span>}
                    </div>
                  )}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{t('note')}</label>
                <input className="form-input" placeholder={t('note_placeholder')} value={txnNote} onChange={e => setTxnNote(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary btn-block" onClick={() => { setTxnHolding(null); setEditingTxn(null); }}>{t('cancel')}</button>
                <button className="btn btn-primary btn-block" disabled={!valid || balanceUnderflow} onClick={handleSaveTxn}>{editingTxn ? t('update') : t('save')}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Direct balance adjustment */}
      {adjustHolding && (
        <div className="modal-overlay" onClick={closeBalanceAdjustment}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t('balance_adjustment')} · {adjustHolding.name}</h2>
              <button className="modal-close" onClick={closeBalanceAdjustment}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('date')}</label>
              <input className="form-input" type="date" value={adjustDate} onChange={e => setAdjustDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('adjusted_balance')} ({account.currency})</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="0.01" min="0"
                placeholder="0.00" value={adjustInput} onChange={e => setAdjustInput(e.target.value)} autoFocus />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                {t('balance_adjustment_hint')}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('note')}</label>
              <input className="form-input" placeholder={t('note_placeholder')} value={adjustNote} onChange={e => setAdjustNote(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={closeBalanceAdjustment}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSaveBalanceAdjustment}>
                {editingBalanceTxn ? t('update') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch price/balance update */}
      {showPrices && (
        <div className="modal-overlay" onClick={() => setShowPrices(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t(isBalancePortfolio ? 'batch_update_balances' : 'batch_update_prices')}</h2>
              <button className="modal-close" onClick={() => setShowPrices(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t(isBalancePortfolio ? 'balance_date_label' : 'price_date_label')}</label>
              <input className="form-input" type="date" value={priceDate} onChange={e => setPriceDate(e.target.value)} />
            </div>
            {activeHoldings.map(h => (
              <div className="form-group" key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</div>
                  {h.symbol && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{h.symbol}</div>}
                </div>
                <input className="form-input mono" type="number" inputMode="decimal" step={isBalancePortfolio ? '0.01' : '0.0001'} min="0"
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
            <div className="confirm-msg">{t(isBalancePortfolio ? 'delete_product_confirm' : 'delete_holding_confirm')}</div>
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
