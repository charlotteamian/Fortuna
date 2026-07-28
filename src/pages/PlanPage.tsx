import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { initializeSettings, type Settings, type PlanItem, type PlanResourceAllocation } from '../db';
import {
  getPlanStatus, createPlanItem, updatePlanItem, deletePlanItem, setPlanTargetTotal,
  createPlanTarget, updatePlanTarget, deletePlanTarget,
  splitScope, makeScope, makeAccountScope, makeHoldingScope, makeCashScope, MARKET_KEYS, MARKET_LABEL_KEYS, EQUITY_PLAN_CATEGORIES,
  type PlanStatus, type PlanItemStatus, type PlanTargetStatus, type UnplannedEntry, type MarketKey,
} from '../services/planService';
import { useAppContext } from '../app-context';
import {
  getResourceAllocation,
  majorToMinor,
  minorToMajor,
  remainingTargetPercent,
  targetAmountFromPercent,
} from '../lib/allocationPlan';
import { RATES_REFRESHED_EVENT } from '../services/rateService';

const COLORS = ['#818cf8', '#34d399', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#2dd4bf'];
const UNPLANNED_COLOR = 'rgba(128,128,128,0.35)';

export default function PlanPage() {
  const { t, i18n } = useTranslation();
  const { theme, amountVisible, setAmountVisible } = useAppContext();
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Item create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formPercent, setFormPercent] = useState('');
  const [formCats, setFormCats] = useState<string[]>([]);
  const [formExpandedCats, setFormExpandedCats] = useState<string[]>([]);
  const [formAllocationAmounts, setFormAllocationAmounts] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Target total modal
  const [showTarget, setShowTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  // Second-level subcategory modal with third-level product links
  const [targetItem, setTargetItem] = useState<PlanItemStatus | null>(null);
  const [editingTarget, setEditingTarget] = useState<PlanTargetStatus | null>(null);
  const [tgRefKeys, setTgRefKeys] = useState<string[]>([]);
  const [tgLabel, setTgLabel] = useState('');
  const [tgPercent, setTgPercent] = useState('');
  const [tgAllocationAmounts, setTgAllocationAmounts] = useState<Record<string, string>>({});

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
    setLoadError(false);
    try {
      const [st, s] = await Promise.all([getPlanStatus(), initializeSettings()]);
      setStatus(st);
      setSettings(s);
    } catch (error) {
      console.error('Allocation plan load failed', error);
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
  const fmtPct = (n: number) => String(Number(n.toFixed(2)));

  const itemColor = (idx: number) => COLORS[idx % COLORS.length];

  const exactResourceRefForScope = (scope: string): string | undefined => {
    const parts = splitScope(scope);
    if (parts.holdingId) return `h:${parts.holdingId}`;
    if (parts.cashAccountId) return `c:${parts.cashAccountId}`;
    return undefined;
  };

  const allocationInputs = (allocations: PlanResourceAllocation[] | undefined) => Object.fromEntries(
    (allocations ?? []).flatMap(allocation => {
      const amount = minorToMajor(allocation.amountMinor);
      return amount === undefined ? [] : [[allocation.refKey, String(amount)]];
    }),
  );

  const allocationsFromInputs = (refKeys: string[], inputs: Record<string, string>): PlanResourceAllocation[] => (
    refKeys.flatMap(refKey => {
      const raw = inputs[refKey]?.trim();
      if (!raw) return [];
      const value = Number(raw);
      return Number.isFinite(value) && value > 0
        ? [{ refKey, amountMinor: majorToMinor(value) }]
        : [];
    })
  );

  // scope = category, market, account, holding or a portfolio cash pool
  const scopeLabel = (scope: string) => {
    const p = splitScope(scope);
    if (p.holdingId) {
      for (const a of status?.equityAccounts ?? []) {
        const h = a.holdings.find(x => x.id === p.holdingId);
        if (h) return h.name;
      }
      return t('plan_deleted_holding');
    }
    if (p.cashAccountId) {
      const account = status?.equityAccounts.find(entry => entry.id === p.cashAccountId);
      return account ? `${account.name}·${t('cash_balance')}` : t('plan_deleted_account');
    }
    if (p.accountId) return status?.equityAccounts.find(a => a.id === p.accountId)?.name || t('plan_deleted_account');
    return p.market ? `${t(p.category!)}·${t(MARKET_LABEL_KEYS[p.market])}` : t(p.category!);
  };

  // ---- Item form ----
  const openCreate = (preset?: UnplannedEntry) => {
    setEditingItem(null);
    setFormName(preset ? scopeLabel(makeScope(preset.category, preset.market)) : '');
    setFormPercent('');
    setFormCats(preset ? [makeScope(preset.category, preset.market)] : []);
    setFormExpandedCats(preset ? [preset.category] : []);
    setFormAllocationAmounts({});
    setShowForm(true);
  };
  const openEdit = (item: PlanItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormPercent(String(item.targetPercent));
    setFormCats([...item.categories]);
    setFormExpandedCats([...new Set(item.categories.map(scope => {
      const parts = splitScope(scope);
      if (parts.holdingId) {
        return status?.equityAccounts.find(account => account.holdings.some(holding => holding.id === parts.holdingId))?.category ?? '';
      }
      if (parts.cashAccountId || parts.accountId) {
        return status?.equityAccounts.find(account => account.id === (parts.cashAccountId ?? parts.accountId))?.category ?? '';
      }
      return parts.category ?? '';
    }).filter(Boolean))]);
    setFormAllocationAmounts(allocationInputs(item.allocations));
    setShowForm(true);
  };
  const handleSaveItem = async () => {
    const pct = parseFloat(formPercent);
    const usedByOthers = status?.items.reduce((sum, item) => sum + (item.id === editingItem?.id ? 0 : item.targetPercent), 0) ?? 0;
    const concreteTargetMinimum = editingItem
      ? status?.items.find(item => item.id === editingItem.id)?.targetPercentSum ?? 0
      : 0;
    if (
      !formName.trim()
      || isNaN(pct)
      || pct <= 0
      || pct > 100 - usedByOthers + 0.000001
      || pct < concreteTargetMinimum - 0.000001
      || formCats.length === 0
    ) return;
    const exactRefs = formCats.flatMap(scope => {
      const refKey = exactResourceRefForScope(scope);
      return refKey ? [refKey] : [];
    });
    const data = {
      name: formName.trim(),
      targetPercent: pct,
      categories: formCats,
      allocations: allocationsFromInputs(exactRefs, formAllocationAmounts),
    };
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

  // ---- Second-level subcategories + third-level product links ----
  const openAddTarget = (item: PlanItemStatus) => {
    if (contextMenu) return;
    setTargetItem(item); setEditingTarget(null);
    setTgRefKeys([]); setTgLabel(''); setTgPercent('');
    setTgAllocationAmounts({});
  };
  const openEditTarget = (item: PlanItemStatus, tg: PlanTargetStatus) => {
    if (contextMenu) return;
    setTargetItem(item); setEditingTarget(tg);
    setTgRefKeys(tg.linkedProducts.map(product => product.refKey));
    setTgLabel(tg.name); setTgPercent(fmtPct(tg.targetPercent));
    setTgAllocationAmounts(allocationInputs(tg.allocations));
  };
  const handleSaveTarget = async () => {
    if (!targetItem) return;
    const pct = parseFloat(tgPercent);
    const label = tgLabel.trim();
    const remaining = remainingTargetPercent(targetItem.targetPercent, targetItem.targets, editingTarget?.id);
    if (isNaN(pct) || pct <= 0 || pct > remaining + 0.000001 || !label) return;
    const data = {
      label,
      refKeys: tgRefKeys,
      allocations: allocationsFromInputs(tgRefKeys, tgAllocationAmounts),
      targetPercent: pct,
    };
    if (editingTarget) await updatePlanTarget(editingTarget.id, { ...data, refKey: undefined, currency: undefined });
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

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (loadError && (!status || !settings)) return (
    <div className="empty-state" role="alert">
      <div className="empty-icon">⚠️</div>
      <div className="empty-text">{t('load_failed')}</div>
      <div className="empty-hint">{t('load_failed_hint')}</div>
      <button type="button" className="btn btn-primary" onClick={() => void load(true)}>{t('retry')}</button>
    </div>
  );
  if (!status || !settings) return null;

  const primary = settings.primaryCurrency;
  const resourceLabel = (candidate: PlanItemStatus['candidates'][number]) => (
    candidate.kind === 'cash' ? `${candidate.name}·${t('cash_balance')}` : candidate.name
  );
  const sumOk = Math.abs(status.targetPercentSum - 100) < 0.01;
  const unplannedValue = status.unplanned.reduce((s, u) => s + u.value, 0);
  const unplannedPercent = status.totalAssets > 0 ? (unplannedValue / status.totalAssets) * 100 : 0;
  const editingItemStatus = editingItem ? status.items.find(item => item.id === editingItem.id) : undefined;
  const itemPercentUsedByOthers = status.items.reduce(
    (sum, item) => sum + (item.id === editingItem?.id ? 0 : item.targetPercent),
    0,
  );
  const formPercentMin = editingItemStatus?.targetPercentSum ?? 0;
  const formPercentMax = Math.max(0, 100 - itemPercentUsedByOthers);
  const parsedFormPercent = parseFloat(formPercent);
  const resourceCurrentValues = new Map<string, number>();
  for (const account of status.equityAccounts) {
    if (account.cash) resourceCurrentValues.set(account.cash.refKey, account.cash.currentValue);
    for (const holding of account.holdings) resourceCurrentValues.set(holding.refKey, holding.currentValue);
  }
  const activeItemExactRefs = formCats.flatMap(scope => {
    const refKey = exactResourceRefForScope(scope);
    return refKey ? [refKey] : [];
  });
  const itemAllocationInvalid = activeItemExactRefs.some(refKey => {
    const otherClaims = status.items.flatMap(item => {
      if (item.id === editingItem?.id) return [];
      const usesRef = item.categories.some(scope => exactResourceRefForScope(scope) === refKey);
      if (!usesRef) return [];
      return [getResourceAllocation(item.allocations, refKey)];
    });
    const assignedToAnotherItem = status.items.some(item => (
      item.id !== editingItem?.id
      && item.candidates.some(candidate => candidate.refKey === refKey && candidate.currentValue > 0.000001)
    ));
    const raw = formAllocationAmounts[refKey]?.trim() ?? '';
    if (!raw) {
      return assignedToAnotherItem || otherClaims.some(allocation => allocation?.amountMinor === undefined);
    }
    const value = Number(raw);
    const otherExplicit = otherClaims.reduce(
      (sum, allocation) => sum + (minorToMajor(allocation?.amountMinor) ?? 0),
      0,
    );
    const currentValue = resourceCurrentValues.get(refKey) ?? 0;
    return !Number.isFinite(value) || value <= 0 || value + otherExplicit > currentValue + 0.000001;
  });
  const itemFormValid = Boolean(
    formName.trim()
    && formCats.length > 0
    && Number.isFinite(parsedFormPercent)
    && parsedFormPercent > 0
    && parsedFormPercent >= formPercentMin - 0.000001
    && parsedFormPercent <= formPercentMax + 0.000001
    && !itemAllocationInvalid
  );

  const parsedTargetPercent = parseFloat(tgPercent);
  const targetPercentMax = targetItem
    ? remainingTargetPercent(targetItem.targetPercent, targetItem.targets, editingTarget?.id)
    : 0;
  const targetLabel = tgLabel.trim();
  const targetRefsUsedByOthers = new Set((targetItem?.targets ?? [])
    .filter(target => target.id !== editingTarget?.id)
    .flatMap(target => target.refKeys));
  const targetCandidateValues = new Map((targetItem?.candidates ?? []).map(candidate => [candidate.refKey, candidate.currentValue]));
  const targetAllocationInvalid = tgRefKeys.some(refKey => {
    const otherClaims = (targetItem?.targets ?? []).flatMap(target => {
      if (target.id === editingTarget?.id || !target.refKeys.includes(refKey)) return [];
      return [getResourceAllocation(target.allocations, refKey)];
    });
    const raw = tgAllocationAmounts[refKey]?.trim() ?? '';
    if (!raw) return otherClaims.length > 0;
    const value = Number(raw);
    const otherExplicit = otherClaims.reduce(
      (sum, allocation) => sum + (minorToMajor(allocation?.amountMinor) ?? 0),
      0,
    );
    const currentValue = targetCandidateValues.get(refKey) ?? 0;
    return !Number.isFinite(value) || value <= 0 || value + otherExplicit > currentValue + 0.000001;
  });
  const targetFormValid = Boolean(
    targetItem
    && targetLabel
    && !targetAllocationInvalid
    && Number.isFinite(parsedTargetPercent)
    && parsedTargetPercent > 0
    && parsedTargetPercent <= targetPercentMax + 0.000001
  );
  const targetAmountPreview = targetAmountFromPercent(
    status.base,
    parsedTargetPercent,
  );

  // Exact scopes already claimed by other plan items. Different granularities may overlap —
  // ownership resolves finest-first (holding > account > market > category) so values never double-count.
  const othersWhole = new Set<string>();   // whole categories
  const othersMarket = new Set<string>();  // market scopes 'cat@m'
  const othersAcct = new Set<string>();    // account ids
  const othersHold = new Set<string>();    // holding ids
  const othersCash = new Set<string>();    // portfolio account ids
  for (const item of status.items) {
    if (editingItem && item.id === editingItem.id) continue;
    for (const scope of item.categories) {
      const p = splitScope(scope);
      if (p.holdingId) othersHold.add(p.holdingId);
      else if (p.cashAccountId) othersCash.add(p.cashAccountId);
      else if (p.accountId) othersAcct.add(p.accountId);
      else if (p.market) othersMarket.add(scope);
      else if (p.category) othersWhole.add(p.category);
    }
  }
  const assetCategories = settings.categories.filter(c => c.type === 'asset');
  const acctCatById = new Map(status.equityAccounts.map(a => [a.id, a.category]));
  const holdingAcctById = new Map<string, string>();
  for (const a of status.equityAccounts) for (const h of a.holdings) holdingAcctById.set(h.id, a.id);

  const isEquityCat = (cat: string) => EQUITY_PLAN_CATEGORIES.includes(cat);
  const isRefinableCat = (cat: string) => isEquityCat(cat)
    || status.equityAccounts.some(account => (
      account.category === cat && (account.holdings.length > 0 || Boolean(account.cash))
    ));
  const scopeCategory = (s: string) => {
    const p = splitScope(s);
    if (p.holdingId) return acctCatById.get(holdingAcctById.get(p.holdingId) ?? '') ?? '';
    if (p.cashAccountId) return acctCatById.get(p.cashAccountId) ?? '';
    return p.category ?? acctCatById.get(p.accountId!) ?? '';
  };
  const scopesOf = (cat: string) => formCats.filter(s => scopeCategory(s) === cat);
  // Only the exact same scope conflicts; equity categories can always be refined further
  const catDisabled = (cat: string) => !isRefinableCat(cat) && othersWhole.has(cat);
  const toggleCategory = (cat: string) => {
    if (scopesOf(cat).length > 0) {
      setFormCats(prev => prev.filter(s => scopeCategory(s) !== cat));
      setFormExpandedCats(previous => previous.filter(entry => entry !== cat));
    } else if (!othersWhole.has(cat)) {
      setFormCats(prev => [...prev, cat]);
      setFormExpandedCats(previous => previous.includes(cat) ? previous : [...previous, cat]);
    } else if (isRefinableCat(cat)) {
      setFormExpandedCats(previous => previous.includes(cat)
        ? previous.filter(entry => entry !== cat)
        : [...previous, cat]);
    }
  };
  const setWholeCat = (cat: string) =>
    setFormCats(prev => [...prev.filter(s => scopeCategory(s) !== cat), cat]);
  const toggleMarket = (cat: string, m: MarketKey) => {
    const scope = makeScope(cat, m);
    setFormCats(prev => {
      const without = prev.filter(s => s !== cat && s !== scope);  // drop whole-category & this slice
      return prev.includes(scope) ? without : [...without, scope];
    });
  };
  const toggleAccount = (id: string) => {
    const scope = makeAccountScope(id);
    const category = acctCatById.get(id);
    setFormCats(prev => prev.includes(scope)
      ? prev.filter(s => s !== scope)
      : [...prev.filter(s => s !== category), scope]);
  };
  const toggleHolding = (id: string) => {
    const scope = makeHoldingScope(id);
    const category = acctCatById.get(holdingAcctById.get(id) ?? '');
    setFormCats(prev => prev.includes(scope)
      ? prev.filter(s => s !== scope)
      : [...prev.filter(s => s !== category), scope]);
    if (formCats.includes(scope)) {
      setFormAllocationAmounts(previous => {
        const next = { ...previous };
        delete next[`h:${id}`];
        return next;
      });
    }
  };
  const toggleCash = (id: string) => {
    const scope = makeCashScope(id);
    const category = acctCatById.get(id);
    setFormCats(prev => prev.includes(scope)
      ? prev.filter(s => s !== scope)
      : [...prev.filter(s => s !== category), scope]);
    if (formCats.includes(scope)) {
      setFormAllocationAmounts(previous => {
        const next = { ...previous };
        delete next[`c:${id}`];
        return next;
      });
    }
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
            {t('target_label')} <b style={{ fontFamily: 'var(--font-mono)' }}>{fmtPct(item.targetPercent)}%</b>
            <span style={{ color: 'var(--text-muted)' }}> · {masked(fmt(item.targetValue))}</span>
          </span>
        </div>

        {/* Second-level subcategories, each rolling up linked third-level products */}
        {item.targets.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
            <div style={{ fontSize: '0.64rem', color: item.targetPercentSum > item.targetPercent + 0.000001 ? theme.liabilityColor : 'var(--text-muted)', padding: '3px 0 2px' }}>
              {t('plan_target_allocated', { sum: fmtPct(item.targetPercentSum), limit: fmtPct(item.targetPercent) })}
            </div>
            {item.targets.map(tg => {
              const onTk = tg.targetAmount > 0 && Math.abs(tg.gapValue) < tg.targetAmount * 0.01;
              const tgChip = onTk
                ? { text: `✓ ${t('on_track')}`, color: theme.assetColor }
                : tg.gapValue > 0
                  ? { text: `${t('need_buy')} ${masked(fmt(tg.gapValue))}`, color: theme.assetColor }
                  : { text: `${t('need_sell')} ${masked(fmt(-tg.gapValue))}`, color: theme.liabilityColor };
              return (
                <div key={tg.id} style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => openEditTarget(item, tg)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tg.linkedProducts.length === 0 && <span style={{ color: 'var(--text-muted)' }}>◌ </span>}{tg.name}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: '0.64rem', fontWeight: 700, color: tgChip.color, whiteSpace: 'nowrap' }}>{tgChip.text}</span>
                  </div>
                  <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('current_label')} {masked(fmt(tg.currentValue))} / {t('target_label')} {fmtPct(tg.targetPercent)}% · {masked(fmt(tg.targetAmount))} {primary}
                  </div>
                  {tg.linkedProducts.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{t('plan_linked_products')}:</span>
                      {tg.linkedProducts.map(product => (
                        <span key={product.refKey} style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 10, padding: '2px 7px' }}>
                          {resourceLabel(product)} · {masked(fmt(product.currentValue))} {product.currency}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('plan_no_linked_products')}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button disabled={item.targetPercentSum >= item.targetPercent - 0.000001} onClick={() => openAddTarget(item)}
          style={{ background: 'none', border: 'none', color: 'var(--asset-color)', fontSize: '0.72rem', fontWeight: 600, cursor: item.targetPercentSum >= item.targetPercent - 0.000001 ? 'not-allowed' : 'pointer', opacity: item.targetPercentSum >= item.targetPercent - 0.000001 ? 0.4 : 1, padding: '6px 0 0', marginTop: item.targets.length > 0 ? 0 : 4 }}>
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
            {fmtPct(status.targetPercentSum)}%
          </span>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '-1px' }}>/ 100%</span>
        </div>
      </div>

      {status.items.length > 0 && !sumOk && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '8px 12px', marginBottom: 14 }}>
          ⚠️ {t('plan_sum_warning', { sum: fmtPct(status.targetPercentSum) })}
        </div>
      )}

      {status.unavailableValuationCount > 0 && (
        <div className="valuation-warning" role="status">
          ⚠️ {t('some_values_excluded', { count: status.unavailableValuationCount })}
        </div>
      )}

      {status.allocationWarnings.length > 0 && (
        <div style={{ fontSize: '0.72rem', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '8px 12px', marginBottom: 14 }}>
          ⚠️ {t('plan_allocation_warning', { count: status.allocationWarnings.length })}
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
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 10, color: 'var(--text-secondary)' }}>📊 {t('structure_compare')}</div>
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
              <input className="form-input mono" type="number" inputMode="decimal" step="0.1" min={Math.max(0.01, formPercentMin)} max={formPercentMax}
                placeholder="20" value={formPercent} onChange={e => setFormPercent(e.target.value)} />
              {formPercent && !isNaN(parseFloat(formPercent)) && parseFloat(formPercent) > 0 && status.base > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                  = {masked(fmt((parseFloat(formPercent) / 100) * status.base))} {primary}
                </div>
              )}
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6 }}>
                {formPercentMin > 0
                  ? t('plan_percent_range', { min: fmtPct(formPercentMin), max: fmtPct(formPercentMax) })
                  : t('plan_percent_available', { percent: fmtPct(formPercentMax) })}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('linked_categories')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {assetCategories.map(c => {
                  const used = catDisabled(c.name);
                  const active = scopesOf(c.name).length > 0 || formExpandedCats.includes(c.name);
                  return (
                    <button key={c.name} disabled={used}
                      style={{ ...S.chip, ...(active ? S.chipActive : {}), ...(used ? { opacity: 0.35, cursor: 'not-allowed' } : {}) }}
                      onClick={() => !used && toggleCategory(c.name)}>
                      {c.icon} {t(c.name)}
                    </button>
                  );
                })}
              </div>
              {/* Market/account/resource refinement for selected or expanded categories. */}
              {assetCategories.filter(c => isRefinableCat(c.name) && formExpandedCats.includes(c.name)).map(c => {
                const cat = c.name;
                const wholeActive = formCats.includes(cat);
                const wholeBlocked = othersWhole.has(cat);
                const catAccounts = status.equityAccounts.filter(a => a.category === cat);
                return (
                  <div key={cat} style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{t(cat)}:</span>
                      <button disabled={wholeBlocked}
                        style={{ ...S.chip, ...(wholeActive ? S.chipActive : {}), ...(wholeBlocked ? { opacity: 0.35, cursor: 'not-allowed' } : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                        onClick={() => !wholeBlocked && setWholeCat(cat)}>
                        {t('plan_market_all')}
                      </button>
                      {isEquityCat(cat) && MARKET_KEYS.map(m => {
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
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{t('plan_by_account')}:</span>
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
                    {/* Exact holding shares can override or split broader account/category claims. */}
                    {catAccounts.filter(a => a.holdings.length > 0).map(a => (
                      <div key={`hold-${a.id}`} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{t('plan_holdings_of', { name: a.name })}:</span>
                        {a.holdings.map(h => {
                          const scope = makeHoldingScope(h.id);
                          const hUsed = othersHold.has(h.id) || status.items.some(item => (
                            item.id !== editingItem?.id
                            && item.candidates.some(candidate => candidate.refKey === h.refKey && candidate.currentValue > 0.000001)
                          ));
                          const hActive = formCats.includes(scope);
                          return (
                            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              <button
                                style={{ ...S.chip, ...(hActive ? S.chipActive : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                                onClick={() => toggleHolding(h.id)}>
                                {h.name} · {masked(fmt(h.currentValue))} {a.currency}{hUsed ? ` · ${t('plan_resource_shared')}` : ''}
                              </button>
                              {hActive && (
                                <input
                                  className="form-input mono"
                                  type="number"
                                  inputMode="decimal"
                                  min="0.01"
                                  step="100"
                                  placeholder={t('plan_allocation_remainder')}
                                  value={formAllocationAmounts[h.refKey] ?? ''}
                                  onChange={event => setFormAllocationAmounts(previous => ({ ...previous, [h.refKey]: event.target.value }))}
                                  style={{ width: 150, padding: '5px 8px', fontSize: '0.72rem' }}
                                />
                              )}
                              {hActive && <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{a.currency}</span>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {catAccounts.filter(a => a.cash).map(a => {
                      const scope = makeCashScope(a.id);
                      const active = formCats.includes(scope);
                      const used = othersCash.has(a.id) || Boolean(a.cash && status.items.some(item => (
                        item.id !== editingItem?.id
                        && item.candidates.some(candidate => candidate.refKey === a.cash!.refKey && candidate.currentValue > 0.000001)
                      )));
                      return (
                        <div key={`cash-${a.id}`} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{a.name}:</span>
                          <button
                            style={{ ...S.chip, ...(active ? S.chipActive : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                            onClick={() => toggleCash(a.id)}>
                            {t('cash_balance')} · {masked(fmt(a.cash?.currentValue ?? 0))} {a.currency}{used ? ` · ${t('plan_resource_shared')}` : ''}
                          </button>
                          {active && a.cash && (
                            <>
                              <input
                                className="form-input mono"
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                step="100"
                                placeholder={t('plan_allocation_remainder')}
                                value={formAllocationAmounts[a.cash.refKey] ?? ''}
                                onChange={event => setFormAllocationAmounts(previous => ({ ...previous, [a.cash!.refKey]: event.target.value }))}
                                style={{ width: 150, padding: '5px 8px', fontSize: '0.72rem' }}
                              />
                              <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{a.currency}</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('linked_categories_hint')}</div>
              <div style={{ fontSize: '0.66rem', color: itemAllocationInvalid ? theme.liabilityColor : 'var(--text-muted)', marginTop: 4 }}>
                {itemAllocationInvalid ? t('plan_allocation_invalid') : t('plan_allocation_hint')}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setShowForm(false); setEditingItem(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" disabled={!itemFormValid} onClick={handleSaveItem}>{editingItem ? t('save') : t('create')}</button>
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

      {/* Second-level subcategory modal with third-level product associations */}
      {targetItem && (
        <div className="modal-overlay" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingTarget ? t('edit_plan_target') : t('add_plan_target')} · {targetItem.name}</h2>
              <button className="modal-close" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('plan_target_custom')}</label>
              <input className="form-input" placeholder={t('plan_target_custom_ph')} value={tgLabel} onChange={e => setTgLabel(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('plan_target_percent')}</label>
              <input className="form-input mono" type="number" inputMode="decimal" step="0.1" min="0.01" max={targetPercentMax}
                placeholder="10" value={tgPercent} onChange={e => setTgPercent(e.target.value)} />
              {Number.isFinite(parsedTargetPercent) && parsedTargetPercent > 0 && status.base > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                  {t('plan_target_derived_amount')} = {masked(fmt(targetAmountPreview))} {primary}
                </div>
              )}
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6 }}>
                {t('plan_target_percent_hint')} {t('plan_percent_available', { percent: fmtPct(targetPercentMax) })}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('plan_target_pick')}</label>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 8 }}>{t('plan_target_pick_hint')}</div>
              {targetItem.candidates.length === 0 ? (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('plan_no_candidates')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {targetItem.candidates.map(cd => {
                    const active = tgRefKeys.includes(cd.refKey);
                    const used = targetRefsUsedByOthers.has(cd.refKey);
                    return (
                      <div key={cd.refKey} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                          onClick={() => {
                            setTgRefKeys(previous => active
                              ? previous.filter(refKey => refKey !== cd.refKey)
                              : [...previous, cd.refKey]);
                            if (active) {
                              setTgAllocationAmounts(previous => {
                                const next = { ...previous };
                                delete next[cd.refKey];
                                return next;
                              });
                            }
                          }}>
                          {resourceLabel(cd)}{used ? ` · ${t('plan_resource_shared')}` : ''}
                          <span style={{ opacity: 0.65, fontSize: '0.85em', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
                            {masked(fmt(cd.currentValue))} {cd.currency}
                          </span>
                        </button>
                        {active && (
                          <>
                            <input
                              className="form-input mono"
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="100"
                              placeholder={t('plan_allocation_remainder')}
                              value={tgAllocationAmounts[cd.refKey] ?? ''}
                              onChange={event => setTgAllocationAmounts(previous => ({ ...previous, [cd.refKey]: event.target.value }))}
                              style={{ width: 150, padding: '5px 8px', fontSize: '0.72rem' }}
                            />
                            <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)' }}>{cd.currency}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: '0.66rem', color: targetAllocationInvalid ? theme.liabilityColor : 'var(--text-muted)', marginTop: 8 }}>
                {targetAllocationInvalid ? t('plan_allocation_invalid') : t('plan_allocation_hint')}
              </div>
            </div>
            {editingTarget && (
              <button className="btn btn-danger btn-block" onClick={() => handleDeleteTarget(editingTarget.id)}>
                🗑️ {t('delete')}
              </button>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" disabled={!targetFormValid} onClick={handleSaveTarget}>{editingTarget ? t('save') : t('create')}</button>
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
