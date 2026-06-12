import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { initializeSettings, type Settings, type PlanItem } from '../db';
import {
  getPlanStatus, createPlanItem, updatePlanItem, deletePlanItem, setPlanTargetTotal,
  createPlanTarget, updatePlanTarget, deletePlanTarget,
  splitScope, makeScope, makeAccountScope, MARKET_KEYS, MARKET_LABEL_KEYS, EQUITY_PLAN_CATEGORIES,
  type PlanStatus, type PlanItemStatus, type PlanTargetStatus, type UnplannedEntry, type MarketKey,
} from '../services/planService';
import { useAppContext } from '../app-context';

const COLORS = ['#818cf8', '#34d399', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#2dd4bf'];
const UNPLANNED_COLOR = 'rgba(128,128,128,0.35)';

export default function PlanPage() {
  const { t, i18n } = useTranslation();
  const { theme, amountVisible, setAmountVisible } = useAppContext();
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  // Item create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formPercent, setFormPercent] = useState('');
  const [formCats, setFormCats] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Target total modal
  const [showTarget, setShowTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  // Per-security target modal
  const [targetItem, setTargetItem] = useState<PlanItemStatus | null>(null);
  const [editingTarget, setEditingTarget] = useState<PlanTargetStatus | null>(null);
  const [tgRefKey, setTgRefKey] = useState<string | null>(null);
  const [tgLabel, setTgLabel] = useState('');
  const [tgAmount, setTgAmount] = useState('');
  const [tgCurrency, setTgCurrency] = useState('CNY');

  // Long-press context menu on plan item cards
  const [contextMenu, setContextMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startLongPress = (itemId: string, e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ itemId, x: Math.min(clientX, window.innerWidth - 180), y: Math.min(clientY, window.innerHeight - 140) });
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    const [st, s] = await Promise.all([getPlanStatus(), initializeSettings()]);
    setStatus(st);
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => { load(true); }, [load]);

  useEffect(() => {
    const hasOpenModal = showForm || showTarget || Boolean(confirmDelete) || Boolean(targetItem);
    document.documentElement.classList.toggle('modal-open', hasOpenModal);
    return () => document.documentElement.classList.remove('modal-open');
  }, [showForm, showTarget, confirmDelete, targetItem]);

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

  const itemColor = (idx: number) => COLORS[idx % COLORS.length];

  // scope = whole category, market slice ('股票/ETF@us') or one account ('acct:<id>')
  const scopeLabel = (scope: string) => {
    const p = splitScope(scope);
    if (p.accountId) return status?.equityAccounts.find(a => a.id === p.accountId)?.name || t('plan_deleted_account');
    return p.market ? `${t(p.category!)}·${t(MARKET_LABEL_KEYS[p.market])}` : t(p.category!);
  };

  // ---- Item form ----
  const openCreate = (preset?: UnplannedEntry) => {
    setEditingItem(null);
    setFormName(preset ? scopeLabel(makeScope(preset.category, preset.market)) : '');
    setFormPercent('');
    setFormCats(preset ? [makeScope(preset.category, preset.market)] : []);
    setShowForm(true);
  };
  const openEdit = (item: PlanItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormPercent(String(item.targetPercent));
    setFormCats([...item.categories]);
    setShowForm(true);
  };
  const handleSaveItem = async () => {
    const pct = parseFloat(formPercent);
    if (!formName.trim() || isNaN(pct) || pct <= 0 || pct > 100 || formCats.length === 0) return;
    const data = { name: formName.trim(), targetPercent: pct, categories: formCats };
    if (editingItem) await updatePlanItem(editingItem.id, data);
    else await createPlanItem(data);
    setShowForm(false); setEditingItem(null);
    load();
  };
  const handleDelete = async (id: string) => {
    await deletePlanItem(id);
    setConfirmDelete(null);
    load();
  };

  // ---- Per-security targets ----
  const openAddTarget = (item: PlanItemStatus) => {
    if (contextMenu) return;
    setTargetItem(item); setEditingTarget(null);
    setTgRefKey(null); setTgLabel(''); setTgAmount('');
    setTgCurrency(settings?.primaryCurrency || 'CNY');
  };
  const openEditTarget = (item: PlanItemStatus, tg: PlanTargetStatus) => {
    if (contextMenu) return;
    setTargetItem(item); setEditingTarget(tg);
    setTgRefKey(tg.refKey ?? null); setTgLabel(tg.name); setTgAmount(String(tg.targetAmount));
    setTgCurrency(tg.currency);
  };
  const handleSaveTarget = async () => {
    if (!targetItem) return;
    const amt = parseFloat(tgAmount);
    const candidate = tgRefKey ? targetItem.candidates.find(c => c.refKey === tgRefKey) : undefined;
    const label = candidate?.name || tgLabel.trim();
    if (isNaN(amt) || amt <= 0 || !label) return;
    // Linked targets are planned in the asset's own currency
    const data = { label, refKey: tgRefKey || undefined, targetAmount: amt, currency: candidate?.currency || tgCurrency };
    if (editingTarget) await updatePlanTarget(editingTarget.id, data);
    else await createPlanTarget({ planItemId: targetItem.id, ...data });
    setTargetItem(null); setEditingTarget(null);
    load();
  };
  const handleDeleteTarget = async (id: string) => {
    await deletePlanTarget(id);
    setTargetItem(null); setEditingTarget(null);
    load();
  };

  // ---- Target total ----
  const openTarget = () => {
    setTargetInput(status?.targetTotal ? String(status.targetTotal) : '');
    setShowTarget(true);
  };
  const handleSaveTargetTotal = async () => {
    const v = parseFloat(targetInput);
    await setPlanTargetTotal(!isNaN(v) && v > 0 ? v : undefined);
    setShowTarget(false);
    load();
  };

  if (loading || !status || !settings) return <div className="loading"><div className="spinner" /></div>;

  const primary = settings.primaryCurrency;
  const sumOk = Math.abs(status.targetPercentSum - 100) < 0.01;
  const unplannedValue = status.unplanned.reduce((s, u) => s + u.value, 0);
  const unplannedPercent = status.totalAssets > 0 ? (unplannedValue / status.totalAssets) * 100 : 0;

  // Exact scopes already claimed by other plan items. Different granularities may overlap —
  // ownership resolves finest-first (account > market > category) so values never double-count.
  const othersWhole = new Set<string>();   // whole categories
  const othersMarket = new Set<string>();  // market scopes 'cat@m'
  const othersAcct = new Set<string>();    // account ids
  for (const item of status.items) {
    if (editingItem && item.id === editingItem.id) continue;
    for (const scope of item.categories) {
      const p = splitScope(scope);
      if (p.accountId) othersAcct.add(p.accountId);
      else if (p.market) othersMarket.add(scope);
      else if (p.category) othersWhole.add(p.category);
    }
  }
  const assetCategories = settings.categories.filter(c => c.type === 'asset');
  const acctCatById = new Map(status.equityAccounts.map(a => [a.id, a.category]));

  const isEquityCat = (cat: string) => EQUITY_PLAN_CATEGORIES.includes(cat);
  const scopeCategory = (s: string) => {
    const p = splitScope(s);
    return p.category ?? acctCatById.get(p.accountId!) ?? '';
  };
  const scopesOf = (cat: string) => formCats.filter(s => scopeCategory(s) === cat);
  // Only the exact same scope conflicts; equity categories can always be refined further
  const catDisabled = (cat: string) => !isEquityCat(cat) && othersWhole.has(cat);
  const toggleCategory = (cat: string) => {
    if (scopesOf(cat).length > 0) {
      setFormCats(prev => prev.filter(s => scopeCategory(s) !== cat));
    } else if (!othersWhole.has(cat)) {
      setFormCats(prev => [...prev, cat]);
    } else if (isEquityCat(cat)) {
      // whole category is taken — preselect the market slices still free
      const free = MARKET_KEYS.filter(m => !othersMarket.has(makeScope(cat, m)));
      setFormCats(prev => [...prev, ...free.map(m => makeScope(cat, m))]);
    }
  };
  const setWholeCat = (cat: string) =>
    setFormCats(prev => [...prev.filter(s => splitScope(s).category !== cat), cat]);
  const toggleMarket = (cat: string, m: MarketKey) => {
    const scope = makeScope(cat, m);
    setFormCats(prev => {
      const without = prev.filter(s => s !== cat && s !== scope);  // drop whole-category & this slice
      return prev.includes(scope) ? without : [...without, scope];
    });
  };
  const toggleAccount = (id: string) => {
    const scope = makeAccountScope(id);
    setFormCats(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);
  };

  const renderStackBar = (label: string, segments: { color: string; pct: number }[]) => {
    const sum = segments.reduce((s, x) => s + x.pct, 0);
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-glass)' }}>
          {segments.filter(s => s.pct > 0).map((s, i) => (
            <div key={i} style={{ width: `${Math.min(s.pct, 100)}%`, background: s.color, transition: 'width 0.3s ease' }} />
          ))}
          {sum < 100 && <div style={{ flex: 1 }} />}
        </div>
      </div>
    );
  };

  const renderItem = (item: PlanItemStatus, idx: number) => {
    const color = itemColor(idx);
    // within 1% of the base amount counts as on track (consistent whether or not a target total is set)
    const onTrack = status.base > 0 && Math.abs(item.gapValue) < status.base * 0.01;
    const gapChip = onTrack
      ? { text: `✓ ${t('on_track')}`, color: theme.assetColor, bg: theme.assetDim }
      : item.gapValue > 0
        ? { text: `${t('need_buy')} ${masked(fmt(item.gapValue))}`, color: theme.assetColor, bg: theme.assetDim }
        : { text: `${t('need_sell')} ${masked(fmt(-item.gapValue))}`, color: theme.liabilityColor, bg: theme.liabilityDim };
    return (
      <div key={item.id} style={S.itemCard}
        onTouchStart={e => startLongPress(item.id, e)}
        onTouchEnd={cancelLongPress} onTouchMove={cancelLongPress}
        onContextMenu={e => { e.preventDefault(); setContextMenu({ itemId: item.id, x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 140) }); }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.9rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px', paddingLeft: 18 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.66rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.categories.map(scopeLabel).join(' · ')}
          </span>
          <span style={{ flexShrink: 0, fontSize: '0.68rem', fontWeight: 700, color: gapChip.color, background: gapChip.bg, borderRadius: 10, padding: '3px 9px', whiteSpace: 'nowrap' }}>
            {gapChip.text}
          </span>
        </div>
        {/* progress toward this item's own target: full bar = planned amount */}
        <div style={{ position: 'relative', height: 8, background: 'var(--bg-glass)', borderRadius: 4, margin: '0 2px' }}>
          <div style={{ width: `${item.targetValue > 0 ? Math.min((item.currentValue / item.targetValue) * 100, 100) : 0}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2px 8px', marginTop: 8, fontSize: '0.72rem' }}>
          <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {t('current_label')} <b style={{ fontFamily: 'var(--font-mono)' }}>{item.currentPercent.toFixed(1)}%</b>
            <span style={{ color: 'var(--text-muted)' }}> · {masked(fmt(item.currentValue))}</span>
          </span>
          <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {t('target_label')} <b style={{ fontFamily: 'var(--font-mono)' }}>{item.targetPercent}%</b>
            <span style={{ color: 'var(--text-muted)' }}> · {masked(fmt(item.targetValue))}</span>
          </span>
        </div>

        {/* Per-security targets inside this bucket (tap a row to edit) */}
        {item.targets.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
            {item.targets.map(tg => {
              const onTk = tg.targetAmount > 0 && Math.abs(tg.gapValue) < tg.targetAmount * 0.01;
              const ccy = tg.currency !== primary ? ` ${tg.currency}` : '';
              const tgChip = onTk
                ? { text: `✓ ${t('on_track')}`, color: theme.assetColor }
                : tg.gapValue > 0
                  ? { text: `${t('need_buy')} ${masked(fmt(tg.gapValue))}${ccy}`, color: theme.assetColor }
                  : { text: `${t('need_sell')} ${masked(fmt(-tg.gapValue))}${ccy}`, color: theme.liabilityColor };
              return (
                <div key={tg.id} style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => openEditTarget(item, tg)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {!tg.refKey && <span style={{ color: 'var(--text-muted)' }}>◌ </span>}{tg.name}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: '0.64rem', fontWeight: 700, color: tgChip.color, whiteSpace: 'nowrap' }}>{tgChip.text}</span>
                  </div>
                  <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('current_label')} {masked(fmt(tg.currentValue))} / {t('target_label')} {masked(fmt(tg.targetAmount))}{ccy}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button onClick={() => openAddTarget(item)}
          style={{ background: 'none', border: 'none', color: 'var(--asset-color)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', padding: '6px 0 0', marginTop: item.targets.length > 0 ? 0 : 4 }}>
          ＋ {t('add_plan_target')}
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('plan_title')}</h1>
          <p className="page-subtitle">{t('plan_subtitle')}</p>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={() => setAmountVisible(!amountVisible)}
          title={amountVisible ? t('hide_amount') : t('show_amount')}>
          {amountVisible ? '👁️' : '🔒'}
        </button>
      </div>

      {/* Summary strip */}
      <div className="summary-strip">
        <div className="summary-strip-item">
          <span className="stat-label">{t('current_total_assets')}</span>
          <span className="stat-value" style={{ color: theme.assetColor }}>{masked(fmt(status.totalAssets))}</span>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '-1px' }}>{primary}</span>
        </div>
        <div className="summary-strip-item" style={{ cursor: 'pointer' }} onClick={openTarget}>
          <span className="stat-label">{t('target_total_assets')} ✏️</span>
          <span className="stat-value" style={{ color: status.targetTotal ? '#818cf8' : 'var(--text-muted)' }}>
            {status.targetTotal ? masked(fmt(status.targetTotal)) : t('not_set')}
          </span>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '-1px' }}>{status.targetTotal ? primary : ''}</span>
        </div>
        <div className="summary-strip-item">
          <span className="stat-label">{t('plan_total_target')}</span>
          <span className="stat-value" style={{ color: sumOk ? theme.assetColor : '#fbbf24' }}>
            {status.targetPercentSum.toFixed(0)}%
          </span>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '-1px' }}>/ 100%</span>
        </div>
      </div>

      {status.items.length > 0 && !sumOk && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '8px 12px', marginBottom: 14 }}>
          ⚠️ {t('plan_sum_warning', { sum: status.targetPercentSum.toFixed(0) })}
        </div>
      )}

      {status.items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎯</div>
          <div className="empty-text">{t('plan_empty')}</div>
          <div className="empty-hint">{t('plan_empty_hint')}</div>
        </div>
      ) : (
        <>
          {/* Structure comparison */}
          {status.totalAssets > 0 && (
            <div className="chart-card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-secondary)' }}>📊 {t('structure_compare')}</div>
              {renderStackBar(t('current_label'), [
                ...status.items.map((it, i) => ({ color: itemColor(i), pct: it.currentPercent })),
                { color: UNPLANNED_COLOR, pct: unplannedPercent },
              ])}
              {renderStackBar(t('target_label'), status.items.map((it, i) => ({ color: itemColor(i), pct: it.targetPercent })))}
            </div>
          )}

          {status.items.map((item, idx) => renderItem(item, idx))}
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textAlign: 'center', margin: '4px 0 8px' }}>{t('plan_long_press_hint')}</div>
        </>
      )}

      {/* Unplanned assets */}
      {status.unplanned.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="entry-group-title">
            <span className="dot" style={{ background: UNPLANNED_COLOR }} />{t('unplanned_categories')}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8 }}>{t('unplanned_hint')}</div>
          {status.unplanned.map(u => (
            <div key={makeScope(u.category, u.market)} className="entry-item" style={{ padding: '0.625rem 0.5rem' }} onClick={() => openCreate(u)}>
              <div className="entry-info">
                <div className="entry-category" style={{ fontSize: '0.8125rem' }}>{scopeLabel(makeScope(u.category, u.market))}</div>
                <div className="entry-note-text">
                  {status.totalAssets > 0 ? ((u.value / status.totalAssets) * 100).toFixed(1) : 0}% · {t('plan_tap_to_add')}
                </div>
              </div>
              <div className="entry-amount">
                <div className="entry-amount-value" style={{ color: 'var(--text-secondary)' }}>{masked(fmt(u.value))}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="fab" onClick={() => openCreate()}>+</button>

      {/* Item create / edit modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingItem(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingItem ? t('edit_plan_item') : t('add_plan_item')}</h2>
              <button className="modal-close" onClick={() => { setShowForm(false); setEditingItem(null); }}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('name')}</label>
              <input className="form-input" placeholder={t('plan_item_name_ph')} value={formName} onChange={e => setFormName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('target_percent')}</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="1" min="0" max="100"
                placeholder="20" value={formPercent} onChange={e => setFormPercent(e.target.value)} />
              {formPercent && !isNaN(parseFloat(formPercent)) && parseFloat(formPercent) > 0 && status.base > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                  = {fmt((parseFloat(formPercent) / 100) * status.base)} {primary}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">{t('linked_categories')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {assetCategories.map(c => {
                  const used = catDisabled(c.name);
                  const active = scopesOf(c.name).length > 0;
                  return (
                    <button key={c.name} disabled={used}
                      style={{ ...S.chip, ...(active ? S.chipActive : {}), ...(used ? { opacity: 0.35, cursor: 'not-allowed' } : {}) }}
                      onClick={() => !used && toggleCategory(c.name)}>
                      {c.icon} {t(c.name)}
                    </button>
                  );
                })}
              </div>
              {/* Market / account refinement for selected equity categories */}
              {assetCategories.filter(c => isEquityCat(c.name) && scopesOf(c.name).length > 0).map(c => {
                const cat = c.name;
                const wholeActive = formCats.includes(cat);
                const wholeBlocked = othersWhole.has(cat);
                const catAccounts = status.equityAccounts.filter(a => a.category === cat);
                return (
                  <div key={cat} style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{t(cat)}：</span>
                      <button disabled={wholeBlocked}
                        style={{ ...S.chip, ...(wholeActive ? S.chipActive : {}), ...(wholeBlocked ? { opacity: 0.35, cursor: 'not-allowed' } : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                        onClick={() => !wholeBlocked && setWholeCat(cat)}>
                        {t('plan_market_all')}
                      </button>
                      {MARKET_KEYS.map(m => {
                        const scope = makeScope(cat, m);
                        const mUsed = othersMarket.has(scope);
                        const mActive = formCats.includes(scope);
                        return (
                          <button key={m} disabled={mUsed}
                            style={{ ...S.chip, ...(mActive ? S.chipActive : {}), ...(mUsed ? { opacity: 0.35, cursor: 'not-allowed' } : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                            onClick={() => !mUsed && toggleMarket(cat, m)}>
                            {t(MARKET_LABEL_KEYS[m])}
                          </button>
                        );
                      })}
                    </div>
                    {catAccounts.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{t('plan_by_account')}：</span>
                        {catAccounts.map(a => {
                          const scope = makeAccountScope(a.id);
                          const aUsed = othersAcct.has(a.id);
                          const aActive = formCats.includes(scope);
                          return (
                            <button key={a.id} disabled={aUsed}
                              style={{ ...S.chip, ...(aActive ? S.chipActive : {}), ...(aUsed ? { opacity: 0.35, cursor: 'not-allowed' } : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                              onClick={() => !aUsed && toggleAccount(a.id)}>
                              {a.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('linked_categories_hint')}</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setShowForm(false); setEditingItem(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSaveItem}>{editingItem ? t('save') : t('create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Target total modal */}
      {showTarget && (
        <div className="confirm-overlay" onClick={() => setShowTarget(false)}>
          <div className="modal-content" style={{ maxWidth: 380, width: '90%', borderRadius: 16, padding: '20px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t('target_total_assets')}</h2>
              <button className="modal-close" onClick={() => setShowTarget(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('target_total_assets')} ({primary})</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="10000" min="0"
                placeholder="1000000" value={targetInput} onChange={e => setTargetInput(e.target.value)} autoFocus />
              {targetInput && !isNaN(parseFloat(targetInput)) && parseFloat(targetInput) > 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                  = {fmt(parseFloat(targetInput))} {primary}
                </div>
              )}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('target_total_hint')}</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => setShowTarget(false)}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSaveTargetTotal}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Per-security target modal */}
      {targetItem && (
        <div className="modal-overlay" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingTarget ? t('edit_plan_target') : t('add_plan_target')} · {targetItem.name}</h2>
              <button className="modal-close" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('plan_target_pick')}</label>
              {targetItem.candidates.length === 0 ? (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('plan_no_candidates')}</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {targetItem.candidates.map(cd => {
                    const active = tgRefKey === cd.refKey;
                    return (
                      <button key={cd.refKey}
                        style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                        onClick={() => {
                          if (active) { setTgRefKey(null); setTgLabel(''); setTgCurrency(primary); }
                          else { setTgRefKey(cd.refKey); setTgLabel(cd.name); setTgCurrency(cd.currency); }
                        }}>
                        {cd.name} <span style={{ opacity: 0.65, fontSize: '0.85em', fontFamily: 'var(--font-mono)' }}>{masked(fmt(cd.currentValue))}{cd.currency !== primary ? ` ${cd.currency}` : ''}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {!tgRefKey && (
              <>
                <div className="form-group">
                  <label className="form-label">{t('plan_target_custom')}</label>
                  <input className="form-input" placeholder={t('plan_target_custom_ph')} value={tgLabel} onChange={e => setTgLabel(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('currency_label')}</label>
                  <select className="form-select" value={tgCurrency} onChange={e => setTgCurrency(e.target.value)}>
                    {(settings?.currencies || [primary]).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="form-group">
              <label className="form-label">{t('plan_target_amount')} ({tgCurrency})</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="1000" min="0"
                placeholder="50000" value={tgAmount} onChange={e => setTgAmount(e.target.value)} />
              {tgAmount && !isNaN(parseFloat(tgAmount)) && parseFloat(tgAmount) > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                  = {fmt(parseFloat(tgAmount))} {tgCurrency}
                </div>
              )}
            </div>
            {editingTarget && (
              <button className="btn btn-danger btn-block" onClick={() => handleDeleteTarget(editingTarget.id)}>
                🗑️ {t('delete')}
              </button>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleSaveTarget}>{editingTarget ? t('save') : t('create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div className="confirm-msg">{t('delete_plan_confirm')}</div>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>{t('confirm_delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Long-press context menu on plan item cards */}
      {contextMenu && (
        <>
          <div className="context-menu-overlay" onClick={() => setContextMenu(null)} />
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button className="context-menu-item" onClick={() => {
              const it = status.items.find(i => i.id === contextMenu.itemId);
              setContextMenu(null);
              if (it) openEdit(it);
            }}>
              ✏️ {t('edit_plan_item')}
            </button>
            <button className="context-menu-item danger" onClick={() => { setConfirmDelete(contextMenu.itemId); setContextMenu(null); }}>
              🗑️ {t('delete')}
            </button>
          </div>
        </>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  itemCard: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 10, backdropFilter: 'blur(12px)' },
  chip: { padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-glass)', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0 },
  chipActive: { background: 'var(--asset-dim)', border: '1px solid var(--asset-color)', color: 'var(--asset-color)', fontWeight: 600 },
};
