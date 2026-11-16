import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { initializeSettings, type Settings, type PlanItem, type PlanResourceAllocation } from '../db';
import {
  getPlanStatus, createPlanItem, createInitialPlanItems, updatePlanItem, movePlanItem, deletePlanItem, setPlanTargetTotal,
  createPlanTarget, updatePlanTarget, deletePlanTarget, refreshPlanQuotes,
  splitScope, makeScope, makeAccountScope, makeHoldingScope, makeCashScope, MARKET_KEYS, MARKET_LABEL_KEYS, EQUITY_PLAN_CATEGORIES,
  type PlanStatus, type PlanItemStatus, type PlanTargetStatus, type UnplannedEntry, type MarketKey,
} from '../services/planService';
import { loadDividendWorkbench, saveDividendBudget } from '../services/dividendService';
import { DIVIDEND_ADVISOR_READER_HASH } from '../lib/dividendAdvisorNavigation';
import { useAppContext } from '../app-context';
import {
  buildPresetLadderConfig,
  computePlanDynamicMetrics,
  planPercentFromInput,
  getResourceAllocation,
  majorToMinor,
  minorToMajor,
  targetAmountFromPercent,
  type PlanLadderConfig,
  type PlanLadderKind,
  type PlanLadderPresetKey,
  type PlanLadderRow,
  type PlanManagementMode,
  type PlanStockCard,
} from '../lib/allocationPlan';
import DividendPage from './DividendPage';
import './PlanPage.css';
import { RATES_REFRESHED_EVENT } from '../services/rateService';

const COLORS = ['#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#fb923c', '#818cf8', '#f472b6', '#22d3ee', '#a3e635', '#2dd4bf'];

interface EditableLadderRow {
  id: string;
  label: string;
  triggerValue: string;
  positionPercent: string;
}

interface EditableStockCard {
  id: string;
  name: string;
  symbol: string;
  weightPercent: string;
  targetPositionPercent: string;
  currentPrice: string;
  actualAmount: string;
  note: string;
}

export default function PlanPage() {
  const { t, i18n } = useTranslation();
  const { amountVisible, setAmountVisible } = useAppContext();
  const [subView, setSubView] = useState<'plan' | 'dividend'>(() => (
    window.location.hash === DIVIDEND_ADVISOR_READER_HASH ? 'dividend' : 'plan'
  ));
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dividendSummary, setDividendSummary] = useState<{
    stockCount: number;
    avgYieldPct?: number;
  }>({ stockCount: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshingQuotes, setRefreshingQuotes] = useState(false);

  // Item create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanItem | null>(null);
  const [formMode, setFormMode] = useState<PlanManagementMode>('ladder');
  const [formName, setFormName] = useState('');
  const [formPercent, setFormPercent] = useState('');
  const [formInputMode, setFormInputMode] = useState<'percent' | 'amount'>('percent');
  const [formPurchases, setFormPurchases] = useState('');
  const [formLadderKind, setFormLadderKind] = useState<PlanLadderKind>('price');
  const [formSymbol, setFormSymbol] = useState('');
  const [formSymbolName, setFormSymbolName] = useState('');
  const [formCurrentQuote, setFormCurrentQuote] = useState('');
  const [formLadderRows, setFormLadderRows] = useState<EditableLadderRow[]>([]);
  const [formStockCards, setFormStockCards] = useState<EditableStockCard[]>([]);

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
      const [st, s, wb] = await Promise.all([
        getPlanStatus(),
        initializeSettings(),
        loadDividendWorkbench().catch(() => null),
      ]);
      setStatus(st);
      setSettings(s);
      if (wb) {
        const activeStocks = wb.stocks.filter(stock => stock.group !== 'hidden');
        setDividendSummary({
          stockCount: activeStocks.length,
        });
      }
    } catch (error) {
      console.error('Allocation plan load failed', error);
      setLoadError(true);
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true).then(() => {
      void refreshPlanQuotes().then(res => {
        if (res.updated > 0) void load(false);
      }).catch(() => {});
    });
  }, [load]);

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
  // Format amounts without RMB symbol (¥)
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
  const fmtQuote = (n: number, kind?: PlanLadderKind) => {
    if (kind === 'index') return String(Math.round(n * 10) / 10);
    if (kind === 'yield') return Number(n.toFixed(2)).toString();
    return Number(n.toFixed(4)).toString();
  };

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

  const scopeLabel = (scope: string) => {
    const p = splitScope(scope);
    const named = status?.scopeNames?.[scope];
    if (named) {
      const name = p.cashAccountId ? `${named.name} · ${t('cash_balance')}` : named.name;
      return named.inactive ? t('plan_source_inactive', { name }) : name;
    }
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

  const toEditableRows = (rows: PlanLadderRow[]): EditableLadderRow[] => rows.map(row => ({
    id: row.id,
    label: row.label ?? '',
    triggerValue: String(row.triggerValue),
    positionPercent: String(row.positionPercent),
  }));

  const applyPresetToForm = (preset: PlanLadderPresetKey) => {
    const cfg = buildPresetLadderConfig(preset);
    setFormLadderKind(cfg.kind);
    setFormSymbol(cfg.symbol ?? '');
    setFormSymbolName(cfg.symbolName ?? '');
    setFormLadderRows(toEditableRows(cfg.rows));
    if (!formName.trim()) {
      if (preset === 'gold_518850') setFormName('黄金投资计划');
      else if (preset === 'chinext_159915') setFormName('创业板ETF');
      else if (preset === 'oil_513350') setFormName('原油投资计划');
      else if (preset === 'dividend_yield') setFormName('红利价值板块');
    }
  };

  const handleRefreshQuotes = async () => {
    if (refreshingQuotes) return;
    setRefreshingQuotes(true);
    try {
      await refreshPlanQuotes();
      await load(false);
    } finally {
      setRefreshingQuotes(false);
    }
  };

  // ---- Item form ----
  const openCreate = (preset?: UnplannedEntry) => {
    setEditingItem(null);
    setFormMode('ladder');
    setFormName(preset ? scopeLabel(makeScope(preset.category, preset.market)) : '');
    setFormPercent('');
    setFormInputMode('percent');
    setFormPurchases('');
    const defaultCfg = buildPresetLadderConfig('gold_518850');
    setFormLadderKind(defaultCfg.kind);
    setFormSymbol('');
    setFormSymbolName('');
    setFormCurrentQuote('');
    setFormLadderRows(toEditableRows(defaultCfg.rows.slice(0, 6)));
    setFormStockCards([
      {
        id: `sc-${Date.now()}`,
        name: '',
        symbol: '',
        weightPercent: '50',
        targetPositionPercent: '60',
        currentPrice: '',
        actualAmount: '',
        note: '',
      },
    ]);
    setSaveError(false);
    setFormCats(preset ? [makeScope(preset.category, preset.market)] : []);
    setFormExpandedCats(preset ? [preset.category] : []);
    setFormAllocationAmounts({});
    setShowForm(true);
  };

  const openEdit = (item: PlanItem) => {
    setEditingItem(item);
    const resolvedMode: PlanManagementMode = item.planMode
      ?? (item.ladderConfig ? 'ladder' : item.stockCards?.length ? 'stocks' : 'simple');
    setFormMode(resolvedMode);
    setFormName(item.name);
    setFormInputMode('percent');
    setFormPurchases(item.plannedPurchases ?? '');
    setSaveError(false);
    setFormPercent(String(item.targetPercent));
    setFormCats([...item.categories]);

    const cfg = item.ladderConfig
      ?? (resolvedMode === 'dividend' ? buildPresetLadderConfig('dividend_yield') : buildPresetLadderConfig('gold_518850'));
    setFormLadderKind(cfg.kind);
    setFormSymbol(cfg.symbol ?? '');
    setFormSymbolName(cfg.symbolName ?? '');
    setFormCurrentQuote(cfg.currentQuote !== undefined ? String(cfg.currentQuote) : '');
    setFormLadderRows(toEditableRows(cfg.rows));

    setFormStockCards(
      item.stockCards && item.stockCards.length > 0
        ? item.stockCards.map(card => ({
            id: card.id,
            name: card.name,
            symbol: card.symbol ?? '',
            weightPercent: String(card.weightPercent),
            targetPositionPercent: String(card.targetPositionPercent),
            currentPrice: card.currentPrice !== undefined ? String(card.currentPrice) : '',
            actualAmount: card.actualAmount !== undefined ? String(card.actualAmount) : '',
            note: card.note ?? '',
          }))
        : [
            {
              id: `sc-${Date.now()}`,
              name: '',
              symbol: '',
              weightPercent: '50',
              targetPositionPercent: '60',
              currentPrice: '',
              actualAmount: '',
              note: '',
            },
          ],
    );

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

  const buildLadderConfigFromForm = (): PlanLadderConfig | undefined => {
    if (formMode !== 'ladder' && formMode !== 'dividend') return undefined;
    const validRows: PlanLadderRow[] = formLadderRows.flatMap((row, idx) => {
      const tv = Number(row.triggerValue);
      const pct = Number(row.positionPercent);
      if (!Number.isFinite(tv) || tv < 0 || !Number.isFinite(pct) || pct < 0 || pct > 100) return [];
      return [{
        id: row.id || `row-${idx + 1}`,
        ...(row.label.trim() ? { label: row.label.trim() } : {}),
        triggerValue: tv,
        positionPercent: pct,
      }];
    });
    const parsedQuote = formCurrentQuote.trim() ? Number(formCurrentQuote) : undefined;
    return {
      kind: formMode === 'dividend' ? 'yield' : formLadderKind,
      ...(formSymbol.trim() ? { symbol: formSymbol.trim().toUpperCase() } : {}),
      ...(formSymbolName.trim() ? { symbolName: formSymbolName.trim() } : {}),
      ...(parsedQuote !== undefined && Number.isFinite(parsedQuote) && parsedQuote > 0 ? { currentQuote: parsedQuote } : {}),
      rows: validRows.length > 0
        ? validRows
        : buildPresetLadderConfig(formMode === 'dividend' ? 'dividend_yield' : 'gold_518850').rows,
    };
  };

  const buildStockCardsFromForm = (): PlanStockCard[] | undefined => {
    if (formMode !== 'stocks') return undefined;
    const validCards: PlanStockCard[] = formStockCards.flatMap((card, idx) => {
      if (!card.name.trim()) return [];
      const weight = Number(card.weightPercent);
      const pos = Number(card.targetPositionPercent);
      const price = card.currentPrice.trim() ? Number(card.currentPrice) : undefined;
      const actual = card.actualAmount.trim() ? Number(card.actualAmount) : undefined;
      return [{
        id: card.id || `card-${idx + 1}`,
        name: card.name.trim(),
        ...(card.symbol.trim() ? { symbol: card.symbol.trim().toUpperCase() } : {}),
        weightPercent: Number.isFinite(weight) && weight >= 0 ? weight : 0,
        targetPositionPercent: Number.isFinite(pos) && pos >= 0 && pos <= 100 ? pos : 100,
        ...(price !== undefined && Number.isFinite(price) && price > 0 ? { currentPrice: price } : {}),
        ...(actual !== undefined && Number.isFinite(actual) && actual >= 0 ? { actualAmount: actual } : {}),
        ...(card.note.trim() ? { note: card.note.trim() } : {}),
      }];
    });
    return validCards;
  };

  const handleSaveItem = async () => {
    if (!itemFormValid || saving) return;
    const pct = planPercentFromInput(formPercent, formInputMode, status?.base ?? 0);
    if (!formName.trim() || !Number.isFinite(pct) || pct < 0) return;

    const exactRefs = formCats.flatMap(scope => {
      const refKey = exactResourceRefForScope(scope);
      return refKey ? [refKey] : [];
    });
    const ladderConfig = buildLadderConfigFromForm();
    const stockCards = buildStockCardsFromForm();

    const data: Parameters<typeof createPlanItem>[0] = {
      name: formName.trim(),
      plannedPurchases: formPurchases,
      targetPercent: pct,
      categories: formCats,
      allocations: allocationsFromInputs(exactRefs, formAllocationAmounts),
      ...(formMode !== 'simple' || editingItem?.planMode ? { planMode: formMode } : {}),
      ...(ladderConfig ? { ladderConfig } : {}),
      ...(stockCards ? { stockCards } : {}),
    };

    await saveAction(async () => {
      if (editingItem) {
        await updatePlanItem(editingItem.id, {
          ...data,
          planMode: formMode,
          ladderConfig,
          stockCards,
        });
      } else {
        await createPlanItem(data);
      }
      // Sync Dividend Workbench budget when saving a dividend-mode sector
      if (formMode === 'dividend' && status && status.base > 0) {
        const dividendBudgetMinor = Math.round(targetAmountFromPercent(status.base, pct) * 100);
        if (Number.isSafeInteger(dividendBudgetMinor) && dividendBudgetMinor >= 0) {
          await saveDividendBudget(dividendBudgetMinor).catch(() => {});
        }
      }
      await refreshPlanQuotes().catch(() => {});
      setShowForm(false);
      setEditingItem(null);
    });
  };

  const handleDelete = async (id: string) => {
    await saveAction(async () => {
      await deletePlanItem(id);
      setConfirmDelete(null);
      setShowForm(false);
      setEditingItem(null);
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
    const pct = planPercentFromInput(tgPercent, 'percent', status?.base ?? 0);
    const label = tgLabel.trim();
    if (!Number.isFinite(pct) || pct < 0 || !label) return;
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
      await setPlanTargetTotal(targetInput.trim() ? v : undefined);
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

  // Sub-page: Dividend Individual Stock Workbench
  if (subView === 'dividend') {
    const dividendPlanItem = status.items.find(it => it.planMode === 'dividend');
    const sharedQuota = dividendPlanItem
      ? dividendPlanItem.targetValue
      : settings.dividendBudgetMinor !== undefined
        ? settings.dividendBudgetMinor / 100
        : undefined;
    return (
      <>
        <div className="plan-subpage-bar">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => {
              if (window.location.hash === DIVIDEND_ADVISOR_READER_HASH) {
                window.history.replaceState(null, '', window.location.pathname + window.location.search);
              }
              setSubView('plan');
              void load(false);
            }}
          >
            {t('plan_back_to_plan')}
          </button>
          <strong style={{ fontSize: 'var(--fs-md)', whiteSpace: 'nowrap' }}>{t('plan_dividend_workbench_title')}</strong>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {sharedQuota !== undefined ? t('plan_dividend_shared_quota', { amount: masked(fmt(sharedQuota)) }) : ''}
          </span>
        </div>
        <DividendPage />
      </>
    );
  }

  const primary = settings.primaryCurrency;
  const resourceLabel = (candidate: PlanItemStatus['candidates'][number]) => (
    candidate.kind === 'cash' ? `${candidate.name}·${t('cash_balance')}` : candidate.name
  );
  const sumOk = Math.abs(status.targetPercentSum - 100) < 0.01;
  const unplannedValue = status.unplanned.reduce((s, u) => s + u.value, 0);
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

  // Allow creating plans even for assets not yet held (formCats may be empty)
  const itemFormValid = Boolean(
    formName.trim()
    && Number.isFinite(parsedFormPercent)
    && parsedFormPercent >= 0
    && !itemAllocationInvalid
  );

  const parsedTargetPercent = planPercentFromInput(tgPercent, 'percent', status.base);
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
    && parsedTargetPercent >= 0
  );
  const targetAmountPreview = targetAmountFromPercent(
    status.base,
    parsedTargetPercent,
  );

  // Exact scopes already claimed by other plan items.
  const othersWhole = new Set<string>();
  const othersMarket = new Set<string>();
  const othersAcct = new Set<string>();
  const othersHold = new Set<string>();
  const othersCash = new Set<string>();
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

  const liquidPool = status.liquidReservePoolValue ?? 0;
  const totalReserveNeeded = status.totalReserveNeededValue ?? 0;
  const reserveDelta = Math.round((liquidPool - totalReserveNeeded) * 100) / 100;

  // Render a single plan item card (Plan A Layout)
  const renderItem = (item: PlanItemStatus, idx: number) => {
    const color = itemColor(idx);
    const sym = item.ladderConfig?.symbol?.trim().toUpperCase();
    const fallbackQuote = item.ladderConfig?.currentQuote
      ?? (sym ? status.holdingValuesBySymbol?.[sym]?.lastPrice : undefined);
    const dyn = computePlanDynamicMetrics(
      {
        targetValue: item.targetValue,
        currentValue: item.currentValue,
        planMode: item.planMode,
        ladderConfig: item.ladderConfig,
        stockCards: item.stockCards,
      },
      { overrideQuote: fallbackQuote && fallbackQuote > 0 ? fallbackQuote : undefined },
    );

    const activePct = dyn.activePositionPercent;
    const dynamicTargetVal = dyn.dynamicTargetValue;
    const reserveNeededVal = dyn.reserveNeededValue;
    const dynamicGap = dyn.dynamicGapValue; // + = need to buy, - = need to trim
    const actualRatioOfFull = item.targetValue > 0 ? (item.currentValue / item.targetValue) * 100 : 0;
    const tolerance = Math.max(100, item.targetValue * 0.015);
    const isAtTarget = Math.abs(dynamicGap) <= tolerance;
    const notes = item.plannedPurchases ?? '';

    const modeBadgeKey = dyn.mode === 'ladder'
      ? 'plan_mode_badge_ladder'
      : dyn.mode === 'dividend'
        ? 'plan_mode_badge_dividend'
        : dyn.mode === 'stocks'
          ? 'plan_mode_badge_stocks'
          : 'plan_mode_badge_simple';

    const statusPillClass = dyn.mode === 'stocks'
      ? 'plan-pill plan-pill-neutral'
      : isAtTarget
        ? 'plan-pill plan-pill-target'
        : dynamicGap > 0
          ? 'plan-pill plan-pill-buy'
          : 'plan-pill plan-pill-trim';

    const statusPillText = dyn.mode === 'stocks'
      ? t('plan_pill_stock_count', { count: item.stockCards?.length ?? 0 })
      : isAtTarget
        ? t('plan_pill_on_target', { pct: fmtPct(activePct) })
        : dynamicGap > 0
          ? t('plan_pill_need_buy', { pct: fmtPct(activePct) })
          : t('plan_pill_need_trim', { pct: fmtPct(activePct) });

    const effectiveLadder = dyn.mode === 'dividend' && (!item.ladderConfig || item.ladderConfig.rows.length === 0)
      ? buildPresetLadderConfig('dividend_yield')
      : item.ladderConfig;

    const dividendFunds = dyn.mode === 'dividend' ? (settings.dividendFundPlan?.funds ?? []) : [];

    return (
      <article key={item.id} className="plan-card" style={{ '--plan-color': color } as CSSProperties}>
        {/* Row 1: Title on left + Status Pill & Edit/Move controls on right */}
        <div className="plan-card-header-top">
          <h2 className="plan-card-title">
            <span className="plan-dot" />
            <span>{item.name}</span>
          </h2>
          <div className="plan-card-heading-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={statusPillClass}>{statusPillText}</span>
            {status.items.length > 1 && (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={idx === 0 || saving}
                  aria-label={t('plan_priority_up', { name: item.name })}
                  onClick={() => void saveAction(() => movePlanItem(item.id, 'up'))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={idx === status.items.length - 1 || saving}
                  aria-label={t('plan_priority_down', { name: item.name })}
                  onClick={() => void saveAction(() => movePlanItem(item.id, 'down'))}
                >
                  ↓
                </button>
              </>
            )}
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

        {/* Row 2: Left-aligned Mode · Quota · Symbol · Live Quote */}
        <div className="plan-card-sub">
          <span>{t(modeBadgeKey)}</span>
          <span> · {t('plan_sub_quota', { pct: fmtPct(item.targetPercent), amount: masked(fmt(item.targetValue)) })}</span>
          {effectiveLadder?.symbol && (
            <span> · {effectiveLadder.symbolName ? `${effectiveLadder.symbolName} (${effectiveLadder.symbol})` : effectiveLadder.symbol}</span>
          )}
          {dyn.resolvedLadder && (
            <span>
              {' · '}
              {effectiveLadder?.kind === 'yield'
                ? t('plan_sub_yield', { yield: fmtQuote(dyn.resolvedLadder.quote, 'yield') })
                : t('plan_sub_quote', { quote: fmtQuote(dyn.resolvedLadder.quote, effectiveLadder?.kind) })}
            </span>
          )}
        </div>

        {/* Strict 2-Column × 3-Row Aligned Metric Comparison Box */}
        <div className="plan-metric-compare">
          {/* Grid Row 1: Labels */}
          <div className="plan-metric-label">
            {t('plan_dynamic_target_col', { pct: fmtPct(activePct) })}
          </div>
          <div className="plan-metric-label plan-metric-col-right">
            {t('plan_actual_full_ratio_col', { pct: fmtPct(actualRatioOfFull) })}
          </div>

          {/* Grid Row 2: Big Amounts (Locked on the exact same horizontal baseline!) */}
          <div className="plan-metric-val">
            {masked(fmt(dynamicTargetVal))}
          </div>
          <div className="plan-metric-val plan-metric-col-right">
            {masked(fmt(item.currentValue))}
          </div>

          {/* Grid Row 3: Reserve & Action Diff Notes */}
          <div className="plan-metric-note">
            {t('plan_reserve_needed_note', { amount: masked(fmt(reserveNeededVal)) })}
          </div>
          <div
            className="plan-metric-note plan-metric-col-right"
            style={{
              color: isAtTarget
                ? 'var(--asset-color)'
                : dynamicGap > 0
                  ? 'var(--warning)'
                  : 'var(--danger)',
            }}
          >
            {isAtTarget
              ? t('plan_diff_on_target', { amount: masked(fmt(Math.abs(dynamicGap))) })
              : dynamicGap > 0
                ? t('plan_diff_need_buy', { amount: masked(fmt(Math.abs(dynamicGap))) })
                : t('plan_diff_need_trim', { amount: masked(fmt(Math.abs(dynamicGap))) })}
          </div>
        </div>

        {/* Next Step Action Bar for Ladder / Dividend Modes */}
        {dyn.resolvedLadder && (dyn.resolvedLadder.nextBuyRow || dyn.resolvedLadder.nextSellRow) && (
          <div className="plan-next-bar">
            <span>
              {dyn.resolvedLadder.nextBuyRow
                ? effectiveLadder?.kind === 'yield'
                  ? t('plan_next_yield_buy_hint', {
                      val: fmtQuote(dyn.resolvedLadder.nextBuyRow.triggerValue, 'yield'),
                      pct: fmtPct(dyn.resolvedLadder.nextBuyRow.positionPercent),
                    })
                  : t('plan_next_buy_hint', {
                      val: fmtQuote(dyn.resolvedLadder.nextBuyRow.triggerValue, effectiveLadder?.kind),
                      pct: fmtPct(dyn.resolvedLadder.nextBuyRow.positionPercent),
                    })
                : '—'}
            </span>
            <span>
              {dyn.resolvedLadder.nextSellRow
                ? effectiveLadder?.kind === 'yield'
                  ? t('plan_next_yield_sell_hint', {
                      val: fmtQuote(dyn.resolvedLadder.nextSellRow.triggerValue, 'yield'),
                      pct: fmtPct(dyn.resolvedLadder.nextSellRow.positionPercent),
                    })
                  : t('plan_next_sell_hint', {
                      val: fmtQuote(dyn.resolvedLadder.nextSellRow.triggerValue, effectiveLadder?.kind),
                      pct: fmtPct(dyn.resolvedLadder.nextSellRow.positionPercent),
                    })
                : '—'}
            </span>
          </div>
        )}

        {/* Dividend Mode: Direct Entry Button to Dividend Stock Workbench */}
        {dyn.mode === 'dividend' && (
          <button
            type="button"
            className="plan-div-enter-btn"
            onClick={() => setSubView('dividend')}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('plan_enter_dividend_wb', { count: dividendSummary.stockCount })}
            </span>
            <span style={{ flexShrink: 0 }}>{t('plan_enter_btn')}</span>
          </button>
        )}

        {/* Free-form Strategy Notes Box (retained across all modes) */}
        <div className="plan-note-box">
          <div className="plan-note-box-head">
            <span>{t('plan_note_box_title')}</span>
            <button
              type="button"
              className="plan-text-button"
              style={{ minHeight: 'auto', padding: '0 4px', fontSize: 'var(--fs-xs)' }}
              aria-label={t('plan_edit_purchases_named', { name: item.name })}
              onClick={() => openPurchases(item)}
            >
              {notes.trim() ? t('edit') : t('plan_add_target_tag')}
            </button>
          </div>
          {notes.trim() && (
            <button
              type="button"
              className="plan-note-content"
              style={{ fontSize: 'var(--fs-xs)', padding: 0 }}
              aria-label={t('plan_edit_purchases_named', { name: item.name })}
              onClick={() => openPurchases(item)}
            >
              {notes}
            </button>
          )}
        </div>

        {/* Stocks Mode: Individual Stock / Fund Cards */}
        {dyn.mode === 'stocks' && item.stockCards && item.stockCards.length > 0 && (
          <div>
            {item.stockCards.map(card => {
              const symKey = card.symbol?.trim().toUpperCase();
              const matchedHolding = symKey ? status.holdingValuesBySymbol?.[symKey] : undefined;
              const livePrice = card.currentPrice ?? matchedHolding?.lastPrice;
              const actualAmt = card.actualAmount ?? matchedHolding?.primaryValue ?? 0;
              const cardQuota = item.targetValue * (card.weightPercent / 100);
              const cardTarget = cardQuota * (card.targetPositionPercent / 100);

              return (
                <div key={card.id} className="plan-stock-subcard">
                  <div className="plan-card-header-top">
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {card.name}{card.symbol ? ` (${card.symbol})` : ''}
                    </span>
                    <span className="plan-pill plan-pill-target">
                      {livePrice !== undefined && livePrice > 0
                        ? t('plan_stock_card_pill', { price: fmtQuote(livePrice, 'price'), pct: fmtPct(card.targetPositionPercent) })
                        : t('plan_stock_card_pill_no_price', { pct: fmtPct(card.targetPositionPercent) })}
                    </span>
                  </div>
                  <div className="plan-card-sub">
                    {t('plan_stock_card_sub', {
                      weight: fmtPct(card.weightPercent),
                      quota: masked(fmt(cardQuota)),
                      target: masked(fmt(cardTarget)),
                      actual: masked(fmt(actualAmt)),
                    })}
                  </div>
                  {card.note && (
                    <div className="plan-stock-subcard-note">
                      <strong>{t('plan_stock_card_note_prefix')}</strong>{card.note}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Ladder / Dividend Mode: Expandable Full-Visibility Position Ladder Table */}
        {(dyn.mode === 'ladder' || dyn.mode === 'dividend') && effectiveLadder && effectiveLadder.rows.length > 0 && (
          <details className="plan-ladder-details">
            <summary>
              <span className="plan-summary-left">
                {t('plan_ladder_summary', { count: effectiveLadder.rows.length })}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.preventDefault(); openEdit(item); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(item); } }}
                className="plan-pill plan-pill-neutral"
                style={{ color: 'var(--asset-color)' }}
              >
                {t('plan_edit_ladder_btn')}
              </span>
            </summary>

            {/* Dividend Funds inside Dividend Sector */}
            {dividendFunds.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {dividendFunds.map(fund => {
                  const fundCode = fund.code?.trim().toUpperCase();
                  const fundHolding = fundCode ? status.holdingValuesBySymbol?.[fundCode] : undefined;
                  const fundQuote = fund.quote?.priceMicros !== undefined
                    ? fund.quote.priceMicros / 1_000_000
                    : fund.reference?.priceMicros !== undefined
                      ? fund.reference.priceMicros / 1_000_000
                      : fundHolding?.lastPrice;
                  const fundActual = fundHolding?.primaryValue ?? 0;
                  return (
                    <div key={fund.id} className="plan-stock-subcard">
                      <div className="plan-card-header-top">
                        <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          📊 {fund.name}{fund.code ? ` (${fund.code})` : ''}
                        </span>
                        <span className="plan-pill plan-pill-target">{t('plan_div_fund_badge')}</span>
                      </div>
                      <div className="plan-card-sub">
                        {t('plan_div_fund_sub', {
                          weight: fmtPct(fund.weightBps / 100),
                          price: fundQuote !== undefined && fundQuote > 0 ? fmtQuote(fundQuote, 'price') : '—',
                          actual: masked(fmt(fundActual)),
                        })}
                      </div>
                      {fund.note && (
                        <div className="plan-stock-subcard-note">{fund.note}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div tabIndex={0} role="region" aria-label={item.name} className="plan-ladder-wrapper">
              <table className="plan-ladder-table">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '26%' }}>
                      {effectiveLadder.kind === 'yield'
                        ? t('plan_col_yield')
                        : effectiveLadder.kind === 'index'
                          ? t('plan_col_index')
                          : t('plan_col_ref')}
                    </th>
                    <th scope="col" style={{ width: '24%' }}>
                      {effectiveLadder.kind === 'yield'
                        ? t('plan_col_pos_pct')
                        : effectiveLadder.kind === 'index'
                          ? t('plan_col_pos_pct')
                          : t('plan_col_price')}
                    </th>
                    <th scope="col" style={{ width: '24%' }}>
                      {effectiveLadder.kind === 'price' ? t('plan_col_pos_pct') : t('plan_col_target_amt')}
                    </th>
                    <th scope="col" style={{ width: '26%' }}>
                      {effectiveLadder.kind === 'price' ? t('plan_col_target_amt') : t('plan_col_status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(dyn.resolvedLadder?.sortedRows ?? effectiveLadder.rows).map((row, rIdx) => {
                    const isCurrent = dyn.resolvedLadder?.activeIndex === rIdx;
                    const isNextBuy = dyn.resolvedLadder?.nextBuyRow?.id === row.id;
                    const isNextSell = dyn.resolvedLadder?.nextSellRow?.id === row.id;
                    const rowAmt = item.targetValue * (row.positionPercent / 100);
                    const firstLabel = row.label || (
                      effectiveLadder.kind === 'yield'
                        ? `${row.triggerValue.toFixed(1)}%`
                        : fmtQuote(row.triggerValue, effectiveLadder.kind)
                    );
                    const statusLabel = isCurrent
                      ? t('plan_row_current')
                      : isNextBuy
                        ? t('plan_row_next_buy')
                        : isNextSell
                          ? t('plan_row_next_sell')
                          : t('plan_row_waiting');

                    if (effectiveLadder.kind === 'price') {
                      return (
                        <tr key={row.id} className={isCurrent ? 'row-active' : undefined}>
                          <th scope="row">{isCurrent ? '● ' : ''}{firstLabel}</th>
                          <td>{fmtQuote(row.triggerValue, 'price')}</td>
                          <td>{fmtPct(row.positionPercent)}%</td>
                          <td>{masked(fmt(rowAmt))}</td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={row.id} className={isCurrent ? 'row-active' : undefined}>
                        <th scope="row">{isCurrent ? '● ' : ''}{firstLabel}</th>
                        <td>{fmtPct(row.positionPercent)}%</td>
                        <td>{masked(fmt(rowAmt))}</td>
                        <td>{statusLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {/* Legacy subcategories & linked scope details */}
        <details className="plan-details">
          <summary>{t('plan_details')}</summary>
          <p className="plan-help">{t('plan_actual_from', { scopes: item.categories.length ? item.categories.map(scopeLabel).join(' · ') : t('plan_sources_empty') })}</p>
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

          {item.targets.length > 0 && (
            <div style={{ marginTop: 'var(--sp-2)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-1)' }}>
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
            className="btn-text"
            onClick={() => openAddTarget(item)}
            style={{ marginTop: 'var(--sp-1)' }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void handleRefreshQuotes()}
            disabled={refreshingQuotes}
          >
            {t('plan_refresh_quotes')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setSubView('dividend')}
          >
            {t('plan_open_dividend_workbench')}
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setAmountVisible(!amountVisible)}
            title={amountVisible ? t('hide_amount') : t('show_amount')}
          >
            {amountVisible ? '👁️' : '🔒'}
          </button>
        </div>
      </div>

      {/* Top Overview & Global Liquid Reserve Pool Reconciliation */}
      <section className="plan-overview">
        <div className="plan-section-heading">
          <span className="plan-label" style={{ fontWeight: 600 }}>{t('plan_overview_heading')} · {primary}</span>
          <button type="button" className="plan-text-button" onClick={openTarget}>{t('plan_change_budget')}</button>
        </div>

        {/* Strict 2-Col × 3-Row Aligned Overview Grid */}
        <div className="plan-metric-compare">
          <div className="plan-metric-label">{t('plan_full_quota_total')}</div>
          <div className="plan-metric-label plan-metric-col-right">{t('plan_actual_total_assets')}</div>

          <div className="plan-metric-val">{masked(fmt(status.base))}</div>
          <div className="plan-metric-val plan-metric-col-right" style={{ color: 'var(--text-secondary)' }}>
            {masked(fmt(status.totalAssets))}
          </div>

          <div className="plan-metric-note">{t('plan_assigned', { percent: fmtPct(status.targetPercentSum) })}</div>
          <div className="plan-metric-note plan-metric-col-right" style={{ color: 'var(--asset-color)' }}>
            {t('plan_liquid_pool_included', { amount: masked(fmt(liquidPool)) })}
          </div>
        </div>

        {/* Global Liquid Reserve Pool Check Bar */}
        <div className="plan-reserve-bar">
          <div className="plan-reserve-info">
            <div className="plan-reserve-main">
              {t('plan_reserve_need_label')}: <strong>{masked(fmt(totalReserveNeeded))}</strong>
            </div>
            <div className="plan-reserve-sub">
              {t('plan_liquid_pool_label', { amount: masked(fmt(liquidPool)) })}
            </div>
          </div>
          <span className={`plan-pill ${reserveDelta >= 0 ? 'plan-pill-target' : 'plan-pill-buy'}`}>
            {reserveDelta >= 0
              ? t('plan_reserve_surplus', { amount: masked(fmt(Math.abs(reserveDelta))) })
              : t('plan_reserve_shortfall', { amount: masked(fmt(Math.abs(reserveDelta))) })}
          </span>
        </div>

        {/* Allocation distribution visual bars */}
        {status.items.length > 0 && (
          <details className="plan-distribution">
            <summary>{t('plan_compare_allocation')}</summary>
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
        <div className="valuation-warning">
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
              style={{ marginTop: 'var(--sp-3)' }}
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
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>{t('unplanned_hint')}</div>
          {status.unplanned.map(u => (
            <div key={makeScope(u.category, u.market)} className="entry-item" style={{ padding: 'var(--sp-2) var(--sp-2)', cursor: 'pointer' }} onClick={() => openCreate(u)}>
              <div className="entry-info">
                <div className="entry-category" style={{ fontSize: 'var(--fs-md)' }}>{scopeLabel(makeScope(u.category, u.market))}</div>
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

      {/* Create / Edit Plan Item Modal with Management Mode Selector */}
      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingItem(null); }}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-label={editingItem ? t('edit_plan_item') : t('add_plan_item')} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingItem ? t('edit_plan_item') : t('add_plan_item')}</h2>
              <button className="modal-close" onClick={() => { setShowForm(false); setEditingItem(null); }}>✕</button>
            </div>

            {/* Step 1: Select Management Mode */}
            <div className="form-group">
              <label className="form-label">{t('plan_mode_label')}</label>
              <div className="plan-mode-grid" role="group" aria-label={t('plan_mode_label')}>
                {([
                  { key: 'ladder' as const, title: t('plan_mode_ladder'), desc: t('plan_mode_ladder_desc') },
                  { key: 'stocks' as const, title: t('plan_mode_stocks'), desc: t('plan_mode_stocks_desc') },
                  { key: 'dividend' as const, title: t('plan_mode_dividend'), desc: t('plan_mode_dividend_desc') },
                  { key: 'simple' as const, title: t('plan_mode_simple'), desc: t('plan_mode_simple_desc') },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className="plan-mode-option"
                    aria-pressed={formMode === opt.key}
                    onClick={() => {
                      setFormMode(opt.key);
                      if (opt.key === 'dividend') {
                        const divCfg = buildPresetLadderConfig('dividend_yield');
                        setFormLadderKind('yield');
                        setFormLadderRows(toEditableRows(divCfg.rows));
                        if (!formName.trim()) setFormName('红利价值板块');
                      }
                    }}
                  >
                    <div className="plan-mode-option-title">{opt.title}</div>
                    <div className="plan-mode-option-desc">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Select Category Chips (Optional for unheld future assets) */}
            <div className="form-group">
              <label className="form-label">{t('linked_categories')}</label>
              <div className="chip-group">
                {assetCategories.map(c => {
                  const used = catDisabled(c.name);
                  const active = scopesOf(c.name).length > 0 || formExpandedCats.includes(c.name);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      disabled={used}
                      aria-pressed={scopesOf(c.name).length > 0}
                      className={`chip${active ? ' active' : ''}`}
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

            {/* Step 3: Target Percent or Amount */}
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
                min="0"
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
              {formInputMode === 'amount' && <p className="plan-help">{t('plan_amount_converted')}</p>}
              {status.base <= 0 && <p className="plan-help">{t('plan_amount_needs_base')}</p>}
              {formPercent.trim() && (!Number.isFinite(parsedFormPercent) || parsedFormPercent < 0) && (
                <p className="plan-error-text" role="alert">{t('plan_percent_invalid')}</p>
              )}
            </div>

            {/* Step 4A: Ladder Configuration (when mode is 'ladder' or 'dividend') */}
            {(formMode === 'ladder' || formMode === 'dividend') && (
              <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)' }}>
                <label className="form-label">{t('plan_preset_label')}</label>
                <div className="chip-group" style={{ marginBottom: 'var(--sp-2)' }}>
                  <button type="button" className="chip compact" onClick={() => applyPresetToForm('gold_518850')}>
                    {t('plan_preset_gold')}
                  </button>
                  <button type="button" className="chip compact" onClick={() => applyPresetToForm('chinext_159915')}>
                    {t('plan_preset_chinext')}
                  </button>
                  <button type="button" className="chip compact" onClick={() => applyPresetToForm('oil_513350')}>
                    {t('plan_preset_oil')}
                  </button>
                  <button type="button" className="chip compact" onClick={() => applyPresetToForm('dividend_yield')}>
                    {t('plan_preset_dividend')}
                  </button>
                </div>

                {formMode === 'ladder' && (
                  <div style={{ marginBottom: 'var(--sp-2)' }}>
                    <label className="form-label">{t('plan_ladder_kind_label')}</label>
                    <div className="chip-group">
                      {(['price', 'index', 'yield'] as const).map(k => (
                        <button
                          key={k}
                          type="button"
                          className={`chip compact${formLadderKind === k ? ' active' : ''}`}
                          onClick={() => setFormLadderKind(k)}
                        >
                          {t(`plan_ladder_kind_${k}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 'var(--sp-2)' }}>
                  <div>
                    <label className="form-label" style={{ fontSize: 'var(--fs-xs)' }}>{t('plan_anchor_symbol_label')}</label>
                    <input
                      className="form-input mono"
                      placeholder="518850 / 159915"
                      value={formSymbol}
                      onChange={e => setFormSymbol(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 'var(--fs-xs)' }}>{t('plan_anchor_quote_label')}</label>
                    <input
                      className="form-input mono"
                      type="number"
                      step="any"
                      placeholder="5.30"
                      value={formCurrentQuote}
                      onChange={e => setFormCurrentQuote(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>{t('plan_ladder_rows_label')}</label>
                  <button
                    type="button"
                    className="plan-text-button"
                    onClick={() => setFormLadderRows(prev => [
                      ...prev,
                      { id: `row-${Date.now()}-${prev.length}`, label: '', triggerValue: '', positionPercent: '' },
                    ])}
                  >
                    {t('plan_add_ladder_row')}
                  </button>
                </div>

                <div style={{ maxHeight: 210, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 28px', gap: 6, fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span>{t('plan_col_ref')}</span>
                    <span>{formLadderKind === 'yield' ? t('plan_col_yield') : formLadderKind === 'index' ? t('plan_col_index') : t('plan_col_price')}</span>
                    <span>{t('plan_col_pos_pct')} (%)</span>
                    <span />
                  </div>
                  {formLadderRows.map((row, rIdx) => (
                    <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 28px', gap: 6, marginBottom: 4 }}>
                      <input
                        className="form-input"
                        style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                        placeholder="<2350"
                        value={row.label}
                        onChange={e => setFormLadderRows(prev => prev.map((r, i) => i === rIdx ? { ...r, label: e.target.value } : r))}
                      />
                      <input
                        className="form-input mono"
                        style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                        type="number"
                        step="any"
                        placeholder="5.00"
                        value={row.triggerValue}
                        onChange={e => setFormLadderRows(prev => prev.map((r, i) => i === rIdx ? { ...r, triggerValue: e.target.value } : r))}
                      />
                      <input
                        className="form-input mono"
                        style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                        type="number"
                        step="any"
                        placeholder="25"
                        value={row.positionPercent}
                        onChange={e => setFormLadderRows(prev => prev.map((r, i) => i === rIdx ? { ...r, positionPercent: e.target.value } : r))}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ padding: 0, minHeight: 28 }}
                        onClick={() => setFormLadderRows(prev => prev.filter((_, i) => i !== rIdx))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 4B: Individual Stock / Fund Cards Editor (when mode is 'stocks') */}
            {formMode === 'stocks' && (
              <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>{t('plan_stock_cards_label')}</label>
                  <button
                    type="button"
                    className="plan-text-button"
                    onClick={() => setFormStockCards(prev => [
                      ...prev,
                      {
                        id: `sc-${Date.now()}-${prev.length}`,
                        name: '',
                        symbol: '',
                        weightPercent: '20',
                        targetPositionPercent: '50',
                        currentPrice: '',
                        actualAmount: '',
                        note: '',
                      },
                    ])}
                  >
                    {t('plan_add_stock_card')}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                  {formStockCards.map((card, cIdx) => (
                    <div key={card.id} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-subtle)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: 6, marginBottom: 6 }}>
                        <input
                          className="form-input"
                          style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                          placeholder={t('plan_stock_name_ph')}
                          value={card.name}
                          onChange={e => setFormStockCards(prev => prev.map((c, i) => i === cIdx ? { ...c, name: e.target.value } : c))}
                        />
                        <input
                          className="form-input mono"
                          style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                          placeholder={t('plan_stock_code_ph')}
                          value={card.symbol}
                          onChange={e => setFormStockCards(prev => prev.map((c, i) => i === cIdx ? { ...c, symbol: e.target.value } : c))}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          style={{ padding: 0, minHeight: 28 }}
                          onClick={() => setFormStockCards(prev => prev.filter((_, i) => i !== cIdx))}
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                        <input
                          className="form-input mono"
                          style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                          type="number"
                          step="any"
                          placeholder={t('plan_stock_weight_ph')}
                          value={card.weightPercent}
                          onChange={e => setFormStockCards(prev => prev.map((c, i) => i === cIdx ? { ...c, weightPercent: e.target.value } : c))}
                        />
                        <input
                          className="form-input mono"
                          style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                          type="number"
                          step="any"
                          placeholder={t('plan_stock_pos_ph')}
                          value={card.targetPositionPercent}
                          onChange={e => setFormStockCards(prev => prev.map((c, i) => i === cIdx ? { ...c, targetPositionPercent: e.target.value } : c))}
                        />
                        <input
                          className="form-input mono"
                          style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)' }}
                          type="number"
                          step="any"
                          placeholder={t('plan_stock_price_ph')}
                          value={card.currentPrice}
                          onChange={e => setFormStockCards(prev => prev.map((c, i) => i === cIdx ? { ...c, currentPrice: e.target.value } : c))}
                        />
                      </div>
                      <input
                        className="form-input"
                        style={{ padding: '4px 6px', fontSize: 'var(--fs-xs)', width: '100%' }}
                        placeholder={t('plan_stock_note_ph')}
                        value={card.note}
                        onChange={e => setFormStockCards(prev => prev.map((c, i) => i === cIdx ? { ...c, note: e.target.value } : c))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional free-form notes */}
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
                  <div key={cat} style={{ marginTop: 'var(--sp-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>{t(cat)}:</span>
                      <button
                        disabled={wholeBlocked}
                        className={`chip compact${wholeActive ? ' active' : ''}`}
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
                            className={`chip compact${mActive ? ' active' : ''}`}
                            onClick={() => !mUsed && toggleMarket(cat, m)}
                          >
                            {t(MARKET_LABEL_KEYS[m])}
                          </button>
                        );
                      })}
                    </div>
                    {catAccounts.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-1)', marginTop: 'var(--sp-1)' }}>
                        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>{t('plan_by_account')}:</span>
                        {catAccounts.map(a => {
                          const scope = makeAccountScope(a.id);
                          const aUsed = othersAcct.has(a.id);
                          const aActive = formCats.includes(scope);
                          return (
                            <button
                              key={a.id}
                              disabled={aUsed}
                              className={`chip compact${aActive ? ' active' : ''}`}
                              onClick={() => !aUsed && toggleAccount(a.id)}
                            >
                              {a.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {catAccounts.filter(a => a.holdings.length > 0).map(a => (
                      <div key={`hold-${a.id}`} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-1)', marginTop: 'var(--sp-1)' }}>
                        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>{t('plan_holdings_of', { name: a.name })}:</span>
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
                                className={`chip compact${hActive ? ' active' : ''}`}
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
                                  style={{ width: 140, padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--fs-xs)' }}
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
                        <div key={`cash-${a.id}`} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-1)', marginTop: 'var(--sp-1)' }}>
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>{a.name}:</span>
                          <button
                            className={`chip compact${active ? ' active' : ''}`}
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
                              style={{ width: 140, padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--fs-xs)' }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {itemAllocationInvalid && <p className="plan-error-text" role="alert" style={{ marginTop: 'var(--sp-1)' }}>{t('plan_allocation_invalid')}</p>}
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
          <div className="modal-content" role="dialog" aria-modal="true" aria-label={t('plan_budget')} style={{ maxWidth: 380, width: '90%', borderRadius: 'var(--radius-lg)', padding: 'var(--sp-5)' }} onClick={e => e.stopPropagation()}>
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
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 'var(--sp-1)' }}>
                  = {fmt(parseFloat(targetInput))} {primary}
                </div>
              )}
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 'var(--sp-1)' }}>{t('target_total_hint')}</div>
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
                step="any"
                min="0"
                placeholder="10"
                value={tgPercent}
                onChange={e => setTgPercent(e.target.value)}
              />
              {Number.isFinite(parsedTargetPercent) && parsedTargetPercent > 0 && status.base > 0 && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--asset-color)', fontFamily: 'var(--font-mono)', marginTop: 'var(--sp-1)' }}>
                  {t('plan_target_derived_amount')} = {masked(fmt(targetAmountPreview))} {primary}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">{t('plan_target_pick')}</label>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>{t('plan_target_pick_hint')}</div>
              {targetItem.candidates.length === 0 ? (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('plan_no_candidates')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  {targetItem.candidates.map(cd => {
                    const active = tgRefKeys.includes(cd.refKey);
                    const used = targetRefsUsedByOthers.has(cd.refKey);
                    return (
                      <div key={cd.refKey} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          aria-pressed={active}
                          className={`chip${active ? ' active' : ''}`}
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
                          <span style={{ opacity: 0.65, fontSize: 'var(--fs-rel-sm)', fontFamily: 'var(--font-mono)', marginLeft: 'var(--sp-1)' }}>
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
                              style={{ width: 150, padding: 'var(--sp-1) var(--sp-2)', fontSize: 'var(--fs-xs)' }}
                            />
                            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>{cd.currency}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: 'var(--fs-2xs)', color: targetAllocationInvalid ? 'var(--liability-color)' : 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>
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

      {/* Notes editor */}
      {purchaseItem && (
        <div className="modal-overlay" onClick={() => !saving && setPurchaseItem(null)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="purchases-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="purchases-title" className="modal-title">{t('plan_intended_targets')} · {purchaseItem.name}</h2>
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
                  await updatePlanItem(purchaseItem.id, { plannedPurchases: purchaseInput });
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
