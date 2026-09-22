import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { initializeSettings, type Settings, type PlanItem, type PlanResourceAllocation } from '../db';
import {
  getPlanStatus, createPlanItem, createInitialPlanItems, updatePlanItem, deletePlanItem, setPlanTargetTotal,
  createPlanTarget, updatePlanTarget, deletePlanTarget,
  splitScope, makeScope, makeAccountScope, makeHoldingScope, makeCashScope, MARKET_KEYS, MARKET_LABEL_KEYS, EQUITY_PLAN_CATEGORIES,
  type PlanStatus, type PlanItemStatus, type PlanTargetStatus, type UnplannedEntry, type MarketKey,
} from '../services/planService';
import { useAppContext } from '../app-context';
import {
  parsePlannedPurchases,
  planPercentFromInput,
  planProgress,
  getResourceAllocation,
  majorToMinor,
  minorToMajor,
  remainingTargetPercent,
  targetAmountFromPercent,
} from '../lib/allocationPlan';
import './PlanPage.css';
import { RATES_REFRESHED_EVENT } from '../services/rateService';

const COLORS = ['#818cf8', '#34d399', '#60a5fa', '#c084fc', '#fbbf24', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#2dd4bf'];

export default function PlanPage() {
  const { t, i18n } = useTranslation();
  const { amountVisible, setAmountVisible } = useAppContext();
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Item create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formPercent, setFormPercent] = useState('');
  const [formInputMode, setFormInputMode] = useState<'percent' | 'amount'>('percent');
  const [formPurchases, setFormPurchases] = useState('');
  const [purchaseItem, setPurchaseItem] = useState<PlanItemStatus | null>(null);
  const [purchaseInput, setPurchaseInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [formCats, setFormCats] = useState<string[]>([]);
  const [formExpandedCats, setFormExpandedCats] = useState<string[]>([]);
  const [formAllocationAmounts, setFormAllocationAmounts] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Target total modal
  const [showTarget, setShowTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');

  // Second-level subcategory modal with third-level product links (legacy support)
  const [targetItem, setTargetItem] = useState<PlanItemStatus | null>(null);
  const [editingTarget, setEditingTarget] = useState<PlanTargetStatus | null>(null);
  const [tgRefKeys, setTgRefKeys] = useState<string[]>([]);
  const [tgLabel, setTgLabel] = useState('');
  const [tgPercent, setTgPercent] = useState('');
  const [tgAllocationAmounts, setTgAllocationAmounts] = useState<Record<string, string>>({});

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
    const hasOpenModal = showForm || showTarget || Boolean(confirmDelete) || Boolean(targetItem) || Boolean(purchaseItem);
    document.documentElement.classList.toggle('modal-open', hasOpenModal);
    return () => document.documentElement.classList.remove('modal-open');
  }, [showForm, showTarget, confirmDelete, targetItem, purchaseItem]);

  useEffect(() => {
    if (!showForm && !showTarget && !confirmDelete && !targetItem && !purchaseItem) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return;
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
    )].filter(element => element.getClientRects().length > 0);
    if (!dialog.contains(document.activeElement)) controls()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault();
        if (confirmDelete) setConfirmDelete(null);
        else if (purchaseItem) setPurchaseItem(null);
        else if (targetItem) setTargetItem(null);
        else if (showTarget) setShowTarget(false);
        else setShowForm(false);
      }
      if (event.key !== 'Tab') return;
      const focusable = controls();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [showForm, showTarget, confirmDelete, targetItem, purchaseItem, saving]);

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
    setFormInputMode('percent');
    setFormPurchases('');
    setSaveError(false);
    setFormCats(preset ? [makeScope(preset.category, preset.market)] : []);
    setFormExpandedCats(preset ? [preset.category] : []);
    setFormAllocationAmounts({});
    setShowForm(true);
  };

  const openEdit = (item: PlanItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormInputMode('percent');
    setFormPurchases(item.plannedPurchases ?? '');
    setSaveError(false);
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
    if (!itemFormValid || saving) return;
    const pct = planPercentFromInput(formPercent, formInputMode, status?.base ?? 0);
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
      plannedPurchases: formPurchases.trim(),
      targetPercent: pct,
      categories: formCats,
      allocations: allocationsFromInputs(exactRefs, formAllocationAmounts),
    };
    await saveAction(async () => {
      if (editingItem) await updatePlanItem(editingItem.id, data);
      else await createPlanItem(data);
      setShowForm(false); setEditingItem(null);
    });
  };

  const handleDelete = async (id: string) => {
    await saveAction(async () => {
      await deletePlanItem(id);
      setConfirmDelete(null);
      setShowForm(false);
    });
  };

  // ---- Second-level subcategories + third-level product links ----
  const openAddTarget = (item: PlanItemStatus) => {
    setSaveError(false);
    setTargetItem(item); setEditingTarget(null);
    setTgRefKeys([]); setTgLabel(''); setTgPercent('');
    setTgAllocationAmounts({});
  };
  const openEditTarget = (item: PlanItemStatus, tg: PlanTargetStatus) => {
    setSaveError(false);
    setTargetItem(item); setEditingTarget(tg);
    setTgRefKeys(tg.refKeys);
    setTgLabel(tg.name); setTgPercent(String(tg.targetPercent));
    setTgAllocationAmounts(allocationInputs(tg.allocations));
  };
  const handleSaveTarget = async () => {
    if (!targetItem || !targetFormValid || saving) return;
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
    await saveAction(async () => {
      if (editingTarget) await updatePlanTarget(editingTarget.id, { ...data, refKey: undefined, currency: undefined });
      else await createPlanTarget({ planItemId: targetItem.id, ...data });
      setTargetItem(null); setEditingTarget(null);
    });
  };
  const handleDeleteTarget = async (id: string) => {
    await saveAction(async () => {
      await deletePlanTarget(id);
      setTargetItem(null); setEditingTarget(null);
    });
  };

  // ---- Target total ----
  const openTarget = () => {
    setTargetInput(status?.targetTotal ? String(status.targetTotal) : '');
    setSaveError(false);
    setShowTarget(true);
  };
  const handleSaveTargetTotal = async () => {
    const v = Number(targetInput);
    if (targetInput.trim() && (!Number.isFinite(v) || v <= 0)) return;
    await saveAction(async () => {
      await setPlanTargetTotal(targetInput.trim() ? majorToMinor(v) / 100 : undefined);
      setShowTarget(false);
    });
  };

  const saveAction = async (action: () => Promise<void>) => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await action();
      await load();
    } catch (error) {
      console.error('Plan save failed', error);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const openPurchases = (item: PlanItemStatus) => {
    setPurchaseItem(item);
    setPurchaseInput(item.plannedPurchases ?? '');
    setSaveError(false);
  };

  // Quick batch create plans from current unplanned assets
  const handleAutoCreateFromAssets = async () => {
    if (!status || status.items.length > 0 || status.unplanned.length === 0 || saving) return;
    const total = status.unplanned.reduce((sum, entry) => sum + entry.value, 0);
    if (total <= 0) return;
    await saveAction(async () => {
      await createInitialPlanItems(status.unplanned.map(entry => ({
        name: scopeLabel(makeScope(entry.category, entry.market)),
        targetPercent: entry.value / total * 100,
        categories: [makeScope(entry.category, entry.market)],
        plannedPurchases: '',
      })));
    });
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
  const editingItemStatus = editingItem ? status.items.find(item => item.id === editingItem.id) : undefined;
  const itemPercentUsedByOthers = status.items.reduce(
    (sum, item) => sum + (item.id === editingItem?.id ? 0 : item.targetPercent),
    0,
  );
  const formPercentMin = editingItemStatus?.targetPercentSum ?? 0;
  const formPercentMax = Math.max(0, 100 - itemPercentUsedByOthers);
  const parsedFormPercent = planPercentFromInput(formPercent, formInputMode, status.base);
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

  // Exact scopes already claimed by other plan items.
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
      const without = prev.filter(s => s !== cat && s !== scope);
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

  // Render a single plan item card
  const renderItem = (item: PlanItemStatus, idx: number) => {
    const color = itemColor(idx);
    const progress = planProgress(item.currentValue, item.targetValue);
    const gap = Math.round(item.gapValue * 100) / 100;
    const isAtTarget = progress !== undefined && Math.abs(gap) < 0.01;
    const targets = parsePlannedPurchases(item.plannedPurchases);

    return (
      <article key={item.id} className="plan-card" style={{ '--plan-color': color } as React.CSSProperties}>
        {/* Keep the asset name and edit action easy to scan on a phone. */}
        <div className="plan-card-heading">
          <h2><span className="plan-dot" />{item.name}</h2>
          <div className="plan-card-heading-actions">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              aria-label={t('plan_edit_named', { name: item.name })}
              onClick={() => openEdit(item)}
            >
              {t('edit')}
            </button>
          </div>
        </div>

        {/* The plan and actual position share the same two-column layout. */}
        <div className="plan-metrics">
          <div className="plan-metric-col">
            <span className="plan-label">{t('plan_planned_amount')}</span>
            <strong>{masked(fmt(item.targetValue))}</strong>
            <span className="plan-share">{t('plan_share', { percent: fmtPct(item.targetPercent) })}</span>
          </div>
          <div className="plan-metric-col">
            <span className="plan-label">{t('plan_actual_amount')}</span>
            <strong>{masked(fmt(item.currentValue))}</strong>
            <span className="plan-share">{t('plan_share', { percent: fmtPct(item.currentPercent) })}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div
          className="plan-progress"
          role="progressbar"
          aria-label={t('plan_progress_named', { name: item.name })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === undefined ? undefined : Math.min(progress, 100)}
        >
          <div style={{ width: `${Math.min(progress ?? 0, 100)}%` }} />
        </div>
        <div className="plan-progress-caption">
          <span>{progress === undefined ? t('plan_no_base') : t('plan_progress_value', { percent: fmtPct(progress) })}</span>
          {progress !== undefined && (
            <span className={gap < 0 ? 'plan-gap-over' : ''}>
              {isAtTarget ? t('plan_at_target') : t(gap > 0 ? 'plan_gap_short' : 'plan_gap_over', { amount: masked(fmt(Math.abs(gap))) })}
            </span>
          )}
        </div>

        {/* Planned Target Assets (Tags & quick add/edit) */}
        <div className="plan-targets-box">
          <div className="plan-targets-heading">
            <span className="plan-targets-title">🎯 {t('plan_intended_targets')}</span>
            <button
              type="button"
              className="plan-text-button"
              aria-label={t('plan_edit_purchases_named', { name: item.name })}
              onClick={() => openPurchases(item)}
            >
              {targets.length > 0 ? t('edit') : t('plan_write_purchases')}
            </button>
          </div>

          <div className="plan-tags-wrap">
            {targets.map((tgt, tIdx) => (
              <button type="button" key={`${tIdx}-${tgt}`} className="plan-tag" onClick={() => openPurchases(item)}>
                {tgt}
              </button>
            ))}
            {targets.length === 0 && (
              <button type="button" className="plan-tag-add" onClick={() => openPurchases(item)}>
                {t('plan_add_target_tag')}
              </button>
            )}
          </div>

          {/* Legacy subcategories (if user previously configured plan targets) */}
          {item.targets.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {item.targets.map(tg => (
                <button
                  type="button"
                  key={tg.id}
                  className="plan-tag"
                  style={{ opacity: 0.85, fontSize: '0.75rem', cursor: 'pointer' }}
                  onClick={() => openEditTarget(item, tg)}
                >
                  📌 {tg.name} ({fmtPct(tg.targetPercent)}%)
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details: Actual value sources & candidates */}
        <details className="plan-details">
          <summary>{t('plan_details')}</summary>
          <p className="plan-help">{t('plan_actual_from', { scopes: item.categories.map(scopeLabel).join(' · ') })}</p>
          {item.candidates.length > 0 && (
            <ul className="plan-source-list">
              {item.candidates.filter(candidate => candidate.primaryValue !== 0).map(candidate => (
                <li key={candidate.refKey}>
                  <span>{resourceLabel(candidate)}</span>
                  <span>{masked(fmt(candidate.primaryValue))} {primary}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Legacy subcategories management inside details */}
          {item.targets.length > 0 && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                {t('plan_target_allocated', { sum: fmtPct(item.targetPercentSum), limit: fmtPct(item.targetPercent) })}
              </div>
              {item.targets.map(tg => (
                <button
                  type="button"
                  key={tg.id}
                  className="plan-target-row"
                  onClick={() => openEditTarget(item, tg)}
                >
                  <span>{tg.name} · {fmtPct(tg.targetPercent)}%</span>
                  <span>{masked(fmt(tg.currentValue))} / {masked(fmt(tg.targetAmount))} {primary}</span>
                </button>
              ))}
            </div>
          )}
          <button
            disabled={item.targetPercentSum >= item.targetPercent - 0.000001}
            onClick={() => openAddTarget(item)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--asset-color)',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: item.targetPercentSum >= item.targetPercent - 0.000001 ? 'not-allowed' : 'pointer',
              opacity: item.targetPercentSum >= item.targetPercent - 0.000001 ? 0.4 : 1,
              padding: '6px 0 0',
              marginTop: 4,
            }}
          >
            ＋ {t('add_plan_target')}
          </button>
        </details>
      </article>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('plan_title')}</h1>
          <p className="page-subtitle">{t('plan_subtitle')}</p>
        </div>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setAmountVisible(!amountVisible)}
          title={amountVisible ? t('hide_amount') : t('show_amount')}
        >
          {amountVisible ? '👁️' : '🔒'}
        </button>
      </div>

      {/* Top Overview & Allocation Distribution Board */}
      <section className="plan-overview">
        <div className="plan-section-heading">
          <span className="plan-label">{t('plan_budget')} · {primary}</span>
          <button type="button" className="plan-text-button" onClick={openTarget}>{t('plan_change_budget')}</button>
        </div>

        <div className="plan-budget-grid">
          <div className="plan-budget-col">
            <div className="plan-budget-amount">{masked(fmt(status.base))}</div>
          </div>
          <div className="plan-budget-col">
            <span className="plan-label">{t('total_assets')}</span>
            <div className="plan-budget-sub">{masked(fmt(status.totalAssets))}</div>
          </div>
        </div>
        <p className="plan-help">{t(status.targetTotal ? 'plan_base_fixed' : 'plan_base_live')}</p>

        {/* Allocation distribution visual bars */}
        {status.items.length > 0 && (
          <details className="plan-distribution">
            <summary>{t('plan_compare_allocation')}</summary>
            {/* Target Allocation Bar */}
            <div className="plan-dist-row">
              <div className="plan-dist-header">
                <span>{t('plan_target_allocation')}</span>
                <span>{fmtPct(status.targetPercentSum)}%</span>
              </div>
              <div className="plan-dist-track" role="img" aria-label={t('plan_target_allocation')}>
                {status.items.map((it, idx) => (
                  <div
                    key={`target-bar-${it.id}`}
                    className="plan-dist-seg"
                    style={{ width: `${Math.max(0, it.targetPercent)}%`, background: itemColor(idx) }}
                    title={`${it.name}: ${fmtPct(it.targetPercent)}%`}
                  />
                ))}
                {status.targetPercentSum < 100 && (
                  <div
                    className="plan-dist-seg plan-dist-seg-unassigned"
                    style={{ width: `${100 - status.targetPercentSum}%` }}
                    title={t('plan_budget_left', { percent: fmtPct(100 - status.targetPercentSum), amount: '' })}
                  />
                )}
              </div>
            </div>

            {/* Actual Allocation Bar */}
            <div className="plan-dist-row">
              <div className="plan-dist-header">
                <span>{t('plan_actual_allocation')}</span>
                <span>{status.totalAssets > 0 ? fmtPct(Math.min(100, (status.totalAssets - unplannedValue) / status.totalAssets * 100)) : 0}%</span>
              </div>
              <div className="plan-dist-track" role="img" aria-label={t('plan_actual_allocation')}>
                {status.items.map((it, idx) => (
                  <div
                    key={`actual-bar-${it.id}`}
                    className="plan-dist-seg"
                    style={{ width: `${Math.max(0, it.currentPercent)}%`, background: itemColor(idx) }}
                    title={`${it.name}: ${fmtPct(it.currentPercent)}%`}
                  />
                ))}
                {status.totalAssets > 0 && unplannedValue > 0 && (
                  <div
                    className="plan-dist-seg plan-dist-seg-unassigned"
                    style={{ width: `${Math.min(100, (unplannedValue / status.totalAssets) * 100)}%` }}
                    title={`${t('unplanned_categories')}: ${((unplannedValue / status.totalAssets) * 100).toFixed(1)}%`}
                  />
                )}
              </div>
            </div>

            {/* Distribution Legend */}
            <div className="plan-dist-legend">
              {status.items.map((it, idx) => (
                <span key={`legend-${it.id}`} className="plan-legend-item">
                  <span className="plan-dot" style={{ background: itemColor(idx), width: 7, height: 7 }} />
                  <span>{it.name}</span>
                  <span>{t('plan_allocation_pair', { target: fmtPct(it.targetPercent), actual: fmtPct(it.currentPercent) })}</span>
                </span>
              ))}
            </div>
          </details>
        )}

        <div className="plan-budget-footer">
          <span>{t('plan_assigned', { percent: fmtPct(status.targetPercentSum) })}</span>
          <span className={status.targetPercentSum > 100.01 ? 'plan-error-text' : ''}>
            {sumOk ? t('plan_fully_assigned') : t(status.targetPercentSum > 100 ? 'plan_budget_over' : 'plan_budget_left', {
              percent: fmtPct(Math.abs(100 - status.targetPercentSum)),
              amount: masked(fmt(Math.abs(100 - status.targetPercentSum) / 100 * status.base)),
            })}
          </span>
        </div>
      </section>

      {/* Categories section title + Add button */}
      <div className="plan-section-heading plan-list-heading">
        <h2>{t('plan_my_categories')}</h2>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => openCreate()}>{t('add_plan_item')}</button>
      </div>

      {loadError && (
        <div className="valuation-warning" role="alert">
          {t('load_failed')} <button className="plan-text-button" onClick={() => void load()}>{t('retry')}</button>
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

      {/* Plan items list or empty state */}
      {status.items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🎯</div>
          <div className="empty-text">{t('plan_empty')}</div>
          <div className="empty-hint">{t('plan_empty_hint')}</div>
          {saveError && <p className="plan-error-text" role="alert">{t('plan_save_failed')}</p>}
          {status.unplanned.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={handleAutoCreateFromAssets}
              disabled={saving}
            >
              ⚡ {t('plan_auto_create_from_assets')}
            </button>
          )}
        </div>
      ) : (
        <>
          {status.items.map((item, idx) => renderItem(item, idx))}
          <p className="plan-help plan-basis-note">{t('plan_basis_note', { currency: primary, total: masked(fmt(status.totalAssets)) })}</p>
        </>
      )}

      {/* Unplanned assets */}
      {status.unplanned.length > 0 && (
        <details className="plan-unplanned">
          <summary>{t('unplanned_categories')} · {masked(fmt(unplannedValue))} {primary}</summary>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8 }}>{t('unplanned_hint')}</div>
          {status.unplanned.map(u => (
            <div key={makeScope(u.category, u.market)} className="entry-item" style={{ padding: '0.625rem 0.5rem', cursor: 'pointer' }} onClick={() => openCreate(u)}>
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
        </details>
      )}

      {/* Create / Edit Plan Item Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingItem(null); }}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-label={editingItem ? t('edit_plan_item') : t('add_plan_item')} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingItem ? t('edit_plan_item') : t('add_plan_item')}</h2>
              <button className="modal-close" onClick={() => { setShowForm(false); setEditingItem(null); }}>✕</button>
            </div>

            {/* Step 1: Select Category Chips */}
            <div className="form-group">
              <label className="form-label">{t('linked_categories')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {assetCategories.map(c => {
                  const used = catDisabled(c.name);
                  const active = scopesOf(c.name).length > 0 || formExpandedCats.includes(c.name);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      disabled={used}
                      aria-pressed={scopesOf(c.name).length > 0}
                      style={{ ...S.chip, ...(active ? S.chipActive : {}), ...(used ? { opacity: 0.35, cursor: 'not-allowed' } : {}) }}
                      onClick={() => {
                        if (!used) {
                          toggleCategory(c.name);
                          if (!formName.trim()) setFormName(t(c.name));
                        }
                      }}
                    >
                      {c.icon} {t(c.name)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Plan Name */}
            <div className="form-group">
              <label className="form-label" htmlFor="plan-name">{t('name')}</label>
              <input
                id="plan-name"
                className="form-input"
                placeholder={t('plan_item_name_ph')}
                value={formName}
                onChange={e => setFormName(e.target.value)}
              />
            </div>

            {/* Step 2: Target Percent or Amount */}
            <div className="form-group">
              <label className="form-label" htmlFor="plan-value">
                {t(formInputMode === 'percent' ? 'target_percent' : 'plan_amount_input', { currency: primary })}
              </label>
              <div className="plan-input-modes" role="group" aria-label={t('plan_input_mode')}>
                {(['percent', 'amount'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={formInputMode === mode}
                    disabled={mode === 'amount' && status.base <= 0}
                    onClick={() => {
                      if (mode === formInputMode) return;
                      setFormPercent(Number.isFinite(parsedFormPercent)
                        ? String(mode === 'amount' ? Math.round(targetAmountFromPercent(status.base, parsedFormPercent) * 100) / 100 : parsedFormPercent)
                        : '');
                      setFormInputMode(mode);
                    }}
                  >
                    {t(mode === 'percent' ? 'plan_by_percent' : 'plan_by_amount')}
                  </button>
                ))}
              </div>
              <input
                id="plan-value"
                className="form-input mono"
                type="number"
                inputMode="decimal"
                step="any"
                min="0.01"
                placeholder={formInputMode === 'percent' ? '20' : '100000'}
                value={formPercent}
                onChange={e => setFormPercent(e.target.value)}
              />
              {Number.isFinite(parsedFormPercent) && parsedFormPercent > 0 && (
                <p className="plan-value-preview">
                  {formInputMode === 'percent'
                    ? `${masked(fmt(targetAmountFromPercent(status.base, parsedFormPercent)))} ${primary}`
                    : `${fmtPct(parsedFormPercent)}%`}
                </p>
              )}
              <p className="plan-help">
                {formPercentMin > 0
                  ? t('plan_percent_range', { min: fmtPct(formPercentMin), max: fmtPct(formPercentMax) })
                  : t('plan_percent_available', { percent: fmtPct(formPercentMax) })}
              </p>
              {formInputMode === 'amount' && <p className="plan-help">{t('plan_amount_converted')}</p>}
              {status.base <= 0 && <p className="plan-help">{t('plan_amount_needs_base')}</p>}
              {formPercent.trim() && (!Number.isFinite(parsedFormPercent) || parsedFormPercent <= 0 || parsedFormPercent > formPercentMax + 0.000001 || parsedFormPercent < formPercentMin - 0.000001) && (
                <p className="plan-error-text" role="alert">{t('plan_percent_invalid')}</p>
              )}
            </div>

            {/* Step 3: Planned Purchases (Target list) */}
            <div className="form-group">
              <label className="form-label" htmlFor="plan-purchases">{t('plan_intended_targets')}</label>
              <textarea
                id="plan-purchases"
                className="form-input plan-textarea"
                rows={3}
                placeholder={t('plan_purchases_placeholder')}
                value={formPurchases}
                onChange={e => setFormPurchases(e.target.value)}
              />
              <p className="plan-help">{t('plan_targets_input_hint')}</p>
            </div>

            {/* Advanced: Refine Scopes (Markets, Accounts, Exact holdings) */}
            <details className="plan-details">
              <summary>{t('plan_advanced_settings')}</summary>
              <p className="plan-help">{formCats.map(scopeLabel).join(' · ')}</p>

              {assetCategories.filter(c => isRefinableCat(c.name) && formExpandedCats.includes(c.name)).map(c => {
                const cat = c.name;
                const wholeActive = formCats.includes(cat);
                const wholeBlocked = othersWhole.has(cat);
                const catAccounts = status.equityAccounts.filter(a => a.category === cat);
                return (
                  <div key={cat} style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{t(cat)}:</span>
                      <button
                        disabled={wholeBlocked}
                        style={{ ...S.chip, ...(wholeActive ? S.chipActive : {}), ...(wholeBlocked ? { opacity: 0.35, cursor: 'not-allowed' } : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                        onClick={() => !wholeBlocked && setWholeCat(cat)}
                      >
                        {t('plan_market_all')}
                      </button>
                      {isEquityCat(cat) && MARKET_KEYS.map(m => {
                        const scope = makeScope(cat, m);
                        const mUsed = othersMarket.has(scope);
                        const mActive = formCats.includes(scope);
                        return (
                          <button
                            key={m}
                            disabled={mUsed}
                            style={{ ...S.chip, ...(mActive ? S.chipActive : {}), ...(mUsed ? { opacity: 0.35, cursor: 'not-allowed' } : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                            onClick={() => !mUsed && toggleMarket(cat, m)}
                          >
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
                            <button
                              key={a.id}
                              disabled={aUsed}
                              style={{ ...S.chip, ...(aActive ? S.chipActive : {}), ...(aUsed ? { opacity: 0.35, cursor: 'not-allowed' } : {}), padding: '4px 10px', fontSize: '0.72rem' }}
                              onClick={() => !aUsed && toggleAccount(a.id)}
                            >
                              {a.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
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
                                onClick={() => toggleHolding(h.id)}
                              >
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
                                  style={{ width: 140, padding: '4px 8px', fontSize: '0.72rem' }}
                                />
                              )}
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
                            onClick={() => toggleCash(a.id)}
                          >
                            {t('cash_balance')} · {masked(fmt(a.cash?.currentValue ?? 0))} {a.currency}{used ? ` · ${t('plan_resource_shared')}` : ''}
                          </button>
                          {active && a.cash && (
                            <input
                              className="form-input mono"
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="100"
                              placeholder={t('plan_allocation_remainder')}
                              value={formAllocationAmounts[a.cash.refKey] ?? ''}
                              onChange={event => setFormAllocationAmounts(previous => ({ ...previous, [a.cash!.refKey]: event.target.value }))}
                              style={{ width: 140, padding: '4px 8px', fontSize: '0.72rem' }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {itemAllocationInvalid && <p className="plan-error-text" role="alert" style={{ marginTop: 6 }}>{t('plan_allocation_invalid')}</p>}
            </details>

            {saveError && <p className="plan-error-text" role="alert">{t('plan_save_failed')}</p>}
            {editingItem && (
              <button type="button" className="plan-text-button plan-error-text" onClick={() => setConfirmDelete(editingItem.id)}>
                {t('delete_plan_item')}
              </button>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setShowForm(false); setEditingItem(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" disabled={!itemFormValid || saving} onClick={handleSaveItem}>
                {saving ? t('plan_saving') : editingItem ? t('save') : t('create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Target Total Budget Modal */}
      {showTarget && (
        <div className="confirm-overlay" onClick={() => setShowTarget(false)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-label={t('plan_budget')} style={{ maxWidth: 380, width: '90%', borderRadius: 16, padding: '20px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t('target_total_assets')}</h2>
              <button className="modal-close" onClick={() => setShowTarget(false)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="plan-total">{t('plan_budget')} ({primary})</label>
              <input
                id="plan-total"
                className="form-input mono"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                placeholder="1000000"
                value={targetInput}
                onChange={e => setTargetInput(e.target.value)}
                autoFocus
              />
              {targetInput && !isNaN(parseFloat(targetInput)) && parseFloat(targetInput) > 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                  = {fmt(parseFloat(targetInput))} {primary}
                </div>
              )}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>{t('target_total_hint')}</div>
              {targetInput.trim() && (!Number.isFinite(Number(targetInput)) || Number(targetInput) < 0.01) && (
                <p className="plan-error-text" role="alert">{t('plan_total_invalid')}</p>
              )}
              <button type="button" className="plan-text-button" onClick={() => setTargetInput('')}>{t('plan_use_current')}</button>
              {saveError && <p className="plan-error-text" role="alert">{t('plan_save_failed')}</p>}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => setShowTarget(false)}>{t('cancel')}</button>
              <button
                className="btn btn-primary btn-block"
                disabled={saving || Boolean(targetInput.trim() && (!Number.isFinite(Number(targetInput)) || Number(targetInput) < 0.01))}
                onClick={handleSaveTargetTotal}
              >
                {saving ? t('plan_saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legacy Subcategory Modal */}
      {targetItem && (
        <div className="modal-overlay" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-label={editingTarget ? t('edit_plan_target') : t('add_plan_target')} onClick={e => e.stopPropagation()}>
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
              <input
                className="form-input mono"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0.01"
                max={targetPercentMax}
                placeholder="10"
                value={tgPercent}
                onChange={e => setTgPercent(e.target.value)}
              />
              {Number.isFinite(parsedTargetPercent) && parsedTargetPercent > 0 && status.base > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                  {t('plan_target_derived_amount')} = {masked(fmt(targetAmountPreview))} {primary}
                </div>
              )}
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
                          type="button"
                          aria-pressed={active}
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
                              aria-label={`${resourceLabel(cd)} · ${t('plan_amount_input', { currency: cd.currency })}`}
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
              <div style={{ fontSize: '0.66rem', color: targetAllocationInvalid ? 'var(--liability-color)' : 'var(--text-muted)', marginTop: 8 }}>
                {targetAllocationInvalid ? t('plan_allocation_invalid') : t('plan_allocation_hint')}
              </div>
            </div>
            {saveError && <p className="plan-error-text" role="alert">{t('plan_save_failed')}</p>}
            {editingTarget && (
              <button className="btn btn-danger btn-block" onClick={() => handleDeleteTarget(editingTarget.id)}>
                🗑️ {t('delete')}
              </button>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => { setTargetItem(null); setEditingTarget(null); }}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" disabled={!targetFormValid || saving} onClick={handleSaveTarget}>
                {editingTarget ? t('save') : t('create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-box" role="dialog" aria-modal="true" aria-label={t('delete_plan_item')} onClick={e => e.stopPropagation()}>
            <div className="confirm-msg">{t('delete_plan_confirm')}</div>
            {saveError && <p className="plan-error-text" role="alert">{t('plan_save_failed')}</p>}
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" disabled={saving} onClick={() => handleDelete(confirmDelete)}>{t('confirm_delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Edit Targets Modal */}
      {purchaseItem && (
        <div className="modal-overlay" onClick={() => !saving && setPurchaseItem(null)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="purchases-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="purchases-title" className="modal-title">🎯 {t('plan_intended_targets')} · {purchaseItem.name}</h2>
              <button className="modal-close" aria-label={t('close')} onClick={() => setPurchaseItem(null)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="purchase-notes">{t('plan_targets_input_hint')}</label>
              <textarea
                id="purchase-notes"
                autoFocus
                className="form-input plan-textarea"
                rows={5}
                placeholder={t('plan_purchases_placeholder')}
                value={purchaseInput}
                onChange={e => setPurchaseInput(e.target.value)}
              />
              <p className="plan-help">{t('plan_purchases_hint')}</p>
            </div>
            {saveError && <p className="plan-error-text" role="alert">{t('plan_save_failed')}</p>}
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" disabled={saving} onClick={() => setPurchaseItem(null)}>{t('cancel')}</button>
              <button
                className="btn btn-primary btn-block"
                disabled={saving}
                onClick={() => void saveAction(async () => {
                  await updatePlanItem(purchaseItem.id, { plannedPurchases: purchaseInput.trim() });
                  setPurchaseItem(null);
                })}
              >
                {saving ? t('plan_saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  chip: {
    padding: '6px 12px',
    borderRadius: 20,
    border: '1px solid var(--border)',
    background: 'var(--bg-glass)',
    color: 'var(--text-secondary)',
    fontSize: '0.78rem',
    cursor: 'pointer',
    flexShrink: 0,
  },
  chipActive: {
    background: 'var(--asset-dim)',
    border: '1px solid var(--asset-color)',
    color: 'var(--asset-color)',
    fontWeight: 600,
  },
};
