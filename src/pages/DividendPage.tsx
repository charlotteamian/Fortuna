import { loadDividendCheckSummaries } from '../services/dividendCheckSummaryService';
import { loadDividendFundPositions } from '../services/dividendAdvisorContextService';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  dateInChina,
  mainlandCode,
  previewDividendWeightChanges,
  suggestedDividendStockWeight,
  redistributeDividendWeights,
  scaleDividendWeights,
  equalDividendWeights,
  sortDividendStocks,
  stockBudgetMinor,
  type DividendStock,
  type GridLevel,
  type LinkedDividendPosition,
} from '../lib/dividendWorkbench';
import {
  addLinkedDividendStocks,
  allocateDividendBudget,
  reallocateDividendBudget,
  dividendBudgetAllocationFingerprint,
  applyAllClassicDividendGrids,
  applyClassicDividendGrid,
  classicDividendGridFingerprint,
  deleteDividendStock,
  dividendStockEditFingerprint,
  loadDividendWorkbench,
  refreshDividendStocks,
  repairOverallocatedDividendWeights,
  saveDividendBudget,
  saveDividendHomeCollapse,
  saveDividendStock,
} from '../services/dividendService';
import {
  buildClassicStockPlan,
  type ClassicStockPlan,
  type ClassicTaxRateBps,
} from '../lib/dividendClassicStrategy';
import { generateClassicDividendAdvice, type ClassicAiAdviceOutput } from '../services/dividendClassicAdvisorService';
import { loadDividendPricingMethod, saveDividendPricingMethod } from '../services/dividendAdvisorActionsService';
import { DIVIDEND_AI_SETTINGS_REQUEST_EVENT } from '../lib/dividendAdvisorNavigation';
import DividendImportDialog from '../components/DividendImportDialog';
import DividendFundWorkbench from '../components/DividendFundWorkbench';
import DividendFundHomePlan from '../components/DividendFundHomePlan';
import DividendAdvisor from '../components/DividendAdvisor';
import { saveDividendStrategy } from '../services/dividendFundService';
import type { DividendStrategy } from '../lib/dividendFundPlan';
import { isExchangeTradedFundCode } from '../lib/dividendQuote';
import { useDividendQuotes } from '../hooks/useDividendQuotes';
import { loadDividendDailyAdvicePlanKey } from '../services/dividendDailyAdviceScopeService';
import type { DividendDailyItem } from '../lib/dividendDailyCheck';
import { dividendBackgroundRefreshPaused } from '../services/dividendRequestControl';

type Workbench = Awaited<ReturnType<typeof loadDividendWorkbench>>;
type StockSelectorFilter = 'all' | 'triggered' | 'held' | 'core' | 'watch' | 'hidden';

const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

import { dividendHomeCollapsed } from '../lib/dividendReading';
import { getClassicAdviceFacts } from '../lib/dividendClassicAdvice';
import DividendClassicAdviceResult from '../components/DividendClassicAdviceResult';
import DividendClassicGrid from '../components/DividendClassicGrid';
import './DividendPage.css';

type Dialog = 'budget' | 'stock' | 'advice' | 'fund' | null;

export default function DividendPage() {
  const { t, i18n } = useTranslation();
  const [amountVisible, setAmountVisible] = useState(true);
  const [data, setData] = useState<Workbench | null>(null);
  const [dailyPlanKey, setDailyPlanKey] = useState('');
  const [checks, setChecks] = useState<Awaited<ReturnType<typeof loadDividendCheckSummaries>>>({ stocks: {}, funds: {} });
  const [taxBps, setTaxBps] = useState<ClassicTaxRateBps>(1000);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [selectorFilter, setSelectorFilter] = useState<StockSelectorFilter>('all');
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<Dialog>(null);
  const [adviceCode, setAdviceCode] = useState<string>();
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const [linkedPickerOpen, setLinkedPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationMode, setAllocationMode] = useState<'proportional' | 'equal'>('proportional');
  const [allocationResult, setAllocationResult] = useState<{ before: DividendStock[]; after: DividendStock[] } | null>(null);
  const allocationResultRef = useRef<HTMLElement>(null);
  const [collapsedCodes, setCollapsedCodes] = useState<string[]>([]);
  const collapseLoaded = useRef(false);
  const collapseState = useRef<string[]>([]);
  const [gridApplying, setGridApplying] = useState(false);
  const [editor, setEditor] = useState<DividendStock | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [weightsRepaired, setWeightsRepaired] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [aiQuestion, setAiQuestion] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOutput, setAiOutput] = useState<ClassicAiAdviceOutput | null>(null);
  const [aiTargetLabel, setAiTargetLabel] = useState('');
  const aiAbortRef = useRef<AbortController | null>(null);

  const busy = useRef(false);
  const alive = useRef(true);
  const savedBudget = useRef<number | null | undefined>(undefined);
  const loadId = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    const [workbench, pricingMethod] = await Promise.all([
      loadDividendWorkbench(),
      loadDividendPricingMethod().catch(() => null),
    ]);
    const repair = workbench.stocks.reduce((sum, stock) => sum + stock.weightBps, 0) > 10000
      ? await repairOverallocatedDividendWeights()
      : undefined;
    const next = repair ? await loadDividendWorkbench() : workbench;
    const fundPositions = await loadDividendFundPositions(next.fundPlan.funds);
    const inspection = await loadDividendCheckSummaries(next, { fundPositions });
    const planKey = await loadDividendDailyAdvicePlanKey(next, inspection);
    if (alive.current && id === loadId.current) {
      setData(next);
      if (repair?.rebalanced) setWeightsRepaired(true);
      setChecks(inspection);
      setDailyPlanKey(planKey);
      if (pricingMethod) {
        const loadedTax: ClassicTaxRateBps = pricingMethod.holdingPeriod === 'over_year' ? 0 : pricingMethod.holdingPeriod === 'up_to_month' ? 2000 : 1000;
        setTaxBps(loadedTax);
      }
      if (!collapseLoaded.current) {
        collapseLoaded.current = true;
        collapseState.current = next.collapsedCodes;
        setCollapsedCodes(next.collapsedCodes);
      }
      const budget = next.budgetConfigured ? next.budgetMinor : null;
      if (savedBudget.current !== budget) {
        savedBudget.current = budget;
        setBudgetInput(budget === null ? '' : String(budget / 100));
      }
    }
    return next;
  }, []);

  useEffect(() => {
    alive.current = true;
    void load().catch(() => {
      if (alive.current) setError(t('div_load_error'));
    });
    const onFocus = () => {
      void load().catch(() => setError(t('div_load_error')));
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      aiAbortRef.current?.abort();
      window.removeEventListener('focus', onFocus);
    };
  }, [load, t]);

  useEffect(() => {
    allocationResultRef.current?.scrollIntoView({ block: 'start' });
  }, [allocationResult]);

  const quoteTargets = data
    ? [
        ...data.stocks.map(stock => stock.code),
        ...data.fundPlan.funds
          .filter(fund => isExchangeTradedFundCode(fund.code))
          .map(fund => `${fund.id}:${fund.code}`),
      ]
        .sort()
        .join(',')
    : '';
  const quotes = useDividendQuotes(quoteTargets, load, busy);
  const automaticDisclosureDay = useRef('');

  useEffect(() => {
    const day = dateInChina();
    if (
      !data ||
      window.location.hash === '#/dividend/advice' ||
      automaticDisclosureDay.current === day ||
      busy.current ||
      quotes.refreshing ||
      dividendBackgroundRefreshPaused()
    )
      return;
    automaticDisclosureDay.current = day;
    const codes = [...data.stocks]
      .sort((a, b) => Number(data.positions.has(b.code)) - Number(data.positions.has(a.code)) || b.weightBps - a.weightBps)
      .filter(stock => stock.dividend?.schemaVersion !== 2 || stock.dividend.asOf !== day || stock.dividendFailedAt !== undefined)
      .map(stock => stock.code);
    if (!codes.length) return;
    busy.current = true;
    setProgress({ done: 0, total: codes.length });
    void refreshDividendStocks(codes, (done, total) => {
      if (alive.current) setProgress({ done, total });
    })
      .then(async () => {
        await load();
      })
      .catch(() => {
        if (alive.current) setError(t('div_load_error'));
      })
      .finally(() => {
        busy.current = false;
        if (alive.current) setProgress(null);
      });
  }, [data, quotes.refreshing, load, t]);

  const money = (minor: number) => (amountVisible ? `¥${numeric(minor / 100)}` : '••••');

  const refresh = async (codes: string[]) => {
    if (busy.current || quotes.refreshing || dividendBackgroundRefreshPaused()) return;
    busy.current = true;
    setProgress({ done: 0, total: codes.length });
    setError('');
    setMessage('');
    try {
      const result = await refreshDividendStocks(codes, (done, total) => {
        if (alive.current) setProgress({ done, total });
      });
      await load();
      if (alive.current) setMessage(t(result.failed ? 'div_refresh_result' : 'div_refresh_success', result));
    } catch {
      if (alive.current) setError(t('div_load_error'));
    } finally {
      busy.current = false;
      if (alive.current) setProgress(null);
    }
  };

  const persistBudget = async () => {
    if (budgetSaving) return;
    const amount = Number(budgetInput.replace(/,/g, ''));
    if (!budgetInput.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1e12) {
      setError(t('div_invalid_budget'));
      return;
    }
    setBudgetSaving(true);
    try {
      const budget = Math.round(amount * 100);
      const result = await saveDividendBudget(budget);
      await load();
      setAllocationResult(null);
      if (alive.current) {
        setBudgetInput(String(budget / 100));
        setError('');
        setMessage(t(result.rebalanced ? 'div_new_weights_rebalanced' : 'div_saved'));
      }
    } catch {
      if (alive.current) setError(t('div_save_error'));
    } finally {
      if (alive.current) setBudgetSaving(false);
    }
  };

  const changeTaxRate = async (nextTax: ClassicTaxRateBps) => {
    setTaxBps(nextTax);
    try {
      const currentMethod = await loadDividendPricingMethod();
      const holdingPeriod = nextTax === 0 ? 'over_year' : nextTax === 2000 ? 'up_to_month' : 'month_to_year';
      await saveDividendPricingMethod({ ...currentMethod, strategy: 'recent_batches', holdingPeriod });
    } catch {
      setError(t('div_save_error'));
      await load().catch(() => undefined);
    }
  };

  const today = dateInChina();

  const classicPlans = useMemo<ClassicStockPlan[]>(() => {
    if (!data) return [];
    const sharesFor = (stock: DividendStock) =>
      stock.shareMode === 'manual' ? stock.manualShares : data.positions.get(stock.code)?.shares ?? 0;
    const sorted = sortDividendStocks(data.stocks, sharesFor);
    return sorted.map(stock =>
      buildClassicStockPlan(stock, {
        totalBudgetMinor: data.budgetConfigured ? data.budgetMinor : undefined,
        shares: sharesFor(stock),
        taxBps,
        asOf: today,
      }),
    );
  }, [data, taxBps, today]);


  const checkedPlans = useMemo(
    () => classicPlans.map(plan => ({ plan, facts: getClassicAdviceFacts(plan, today) })),
    [classicPlans, today],
  );
  const selected = checkedPlans.find(({ plan }) => plan.code === selectedCode);
  const selectedStock = data?.stocks.find(stock => stock.code === selectedCode);
  const matchesFilter = ({ plan, facts }: (typeof checkedPlans)[number], filter: StockSelectorFilter) => {
    switch (filter) {
      case 'triggered': return facts.status === 'buy' || facts.status === 'sell';
      case 'held': return plan.shares > 0;
      case 'core': return plan.group === 'core';
      case 'watch': return plan.group === 'watch';
      case 'hidden': return plan.group === 'hidden';
      default: return plan.group !== 'hidden' || plan.shares > 0;
    }
  };

  if (!data) return <div role="status">{error || t('loading')}</div>;

  const totalWeightBps = data.stocks.reduce((sum, stock) => sum + stock.weightBps, 0);
  const annualDividendMinor = classicPlans.reduce(
    (sum, plan) => sum + Math.round((plan.shares * plan.base.grossDpsMicros) / 10000), 0,
  );
  const homePlans = checkedPlans.filter(item => matchesFilter(item, 'all'));
  const buyCount = homePlans.filter(({ facts }) => facts.status === 'buy').length;
  const sellCount = homePlans.filter(({ facts }) => facts.status === 'sell').length;
  const unverifiedCount = homePlans.filter(({ facts }) => !facts.quoteCurrent).length;
  const heldCount = classicPlans.filter(plan => plan.shares > 0).length;
  const query = search.trim().toLowerCase();
  const visiblePlans = checkedPlans.filter(item => matchesFilter(item, selectorFilter) &&
    (!query || `${item.plan.name} ${item.plan.code}`.toLowerCase().includes(query)));
  const untracked = [...data.positions.values()]
    .filter(position => !data.stocks.some(stock => stock.code === position.code))
    .sort((a, b) => a.code.localeCompare(b.code));
  const adviceTarget = checkedPlans.find(({ plan }) => plan.code === adviceCode)?.plan;
  const canRefresh = !progress && !quotes.refreshing;
  const remainingMinor = Math.max(0, data.budgetMinor - stockBudgetMinor(data.budgetMinor, totalWeightBps));

  const closePanel = () => {
    aiAbortRef.current?.abort();
    setPanel(null);
    setBatchConfirm(false);
  };

  const changeStrategy = async (strategy: DividendStrategy) => {
    if (strategySaving || strategy === data.strategy) return;
    setStrategySaving(true);
    setError('');
    try {
      await saveDividendStrategy(strategy);
      setSearch('');
      setMessage('');
      await load();
    } catch {
      setError(t('div_save_error'));
    } finally {
      setStrategySaving(false);
    }
  };

  const applyGrid = async (code?: string) => {
    if (gridApplying) return;
    setGridApplying(true);
    setError('');
    setMessage('');
    try {
      if (code && selected && selectedStock) {
        await applyClassicDividendGrid(code, taxBps, {
          asOf: today,
          stockFingerprint: dividendStockEditFingerprint(selectedStock),
          gridFingerprint: classicDividendGridFingerprint(selected.plan),
        });
      } else if (!code) {
        await applyAllClassicDividendGrids(taxBps);
      }
      await load();
      setBatchConfirm(false);
      setMessage(t('div_saved'));
    } catch (cause) {
      const changed = cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_CHANGED';
      if (changed) await load().catch(() => undefined);
      setError(t(changed ? 'div_new_grid_preview_changed' : 'div_save_error'));
    } finally {
      setGridApplying(false);
    }
  };

  const openStock = (code: string) => {
    setSelectedCode(code);
    setMessage('');
    setError('');
    setPanel('stock');
  };

  const startAdd = () => {
    setIsNew(true);
    setEditor({
      code: '',
      name: '',
      group: 'watch',
      weightBps: suggestedDividendStockWeight(data.stocks, data.budgetMinor),
      shareMode: 'linked',
      manualShares: 0,
      lotSize: 100,
    });
  };

  const refreshMarket = async (codes: string[]) => {
    if (!canRefresh) return;
    await quotes.refresh(true);
    if (codes.length) await refresh(codes);
  };

  const askAiToday = async (targetCode?: string, question?: string) => {
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiBusy(true);
    setAiOutput(null);
    const target = checkedPlans.find(({ plan }) => plan.code === targetCode)?.plan;
    setAiTargetLabel(question || (target ? `${target.name} (${target.code})` : t('div_new_daily')));
    try {
      const output = await generateClassicDividendAdvice({
        plans: classicPlans,
        selectedCode: targetCode,
        totalBudgetMinor: data.budgetConfigured ? data.budgetMinor : undefined,
        question,
        language: i18n.language,
        asOf: today,
        signal: controller.signal,
        onLocalReady: localMarkdown => {
          if (alive.current && aiAbortRef.current === controller) setAiOutput({ localMarkdown, configured: true });
        },
      });
      if (alive.current && aiAbortRef.current === controller) {
        setAiOutput(output);
        if (question) setAiQuestion('');
      }
    } catch {
      if (!controller.signal.aborted && alive.current) setError(t('div_ai_error_network'));
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        if (alive.current) setAiBusy(false);
      }
    }
  };

  const openAdvice = (code?: string) => {
    setAdviceCode(code);
    setAiQuestion('');
    setError('');
    setPanel('advice');
    void askAiToday(code);
  };

  const toggleFundCollapse = (code: string) => {
    const collapsed = !dividendHomeCollapsed(code, collapseState.current);
    const key = `open:${code}`;
    const next = collapsed ? collapseState.current.filter(value => value !== key) : [...collapseState.current, key];
    collapseState.current = next;
    setCollapsedCodes(next);
    void saveDividendHomeCollapse(code, collapsed).catch(() => {
      if (alive.current) setError(t('div_save_error'));
    });
  };

  const onOpenCheckItem = (item: DividendDailyItem) => {
    if (item.kind === 'stock' && item.code) {
      openStock(item.code);
    } else if (item.kind === 'fund') {
      void changeStrategy('funds');
    }
  };

  const feedback = <>
    {message && <p className="div-notice" role="status">{message}</p>}
    {error && <p className="div-warning" role="alert">{error}</p>}
  </>;

  return (
    <div className="dividend-page">
      <header className="div-wb-header">
        <h1 className="page-title">{t('div_title')}</h1>
        <button type="button" className="btn btn-secondary" onClick={() => setAmountVisible(value => !value)}>
          {t(amountVisible ? 'div_hide_amounts' : 'div_show_amounts')}
        </button>
      </header>

      <div className="div-wb-segment" role="group" aria-label={t('div_strategy')}>
        {(['stocks', 'funds'] as const).map(strategy => (
          <button type="button" key={strategy} aria-pressed={data.strategy === strategy} disabled={strategySaving}
            onClick={() => void changeStrategy(strategy)}>{t(`div_cs_mode_${strategy}`)}</button>
        ))}
      </div>

      <section className="div-focus-top-tools" aria-label={t('div_focus_data_tools')}>
        <button type="button" className="btn btn-secondary" disabled={!canRefresh || !quoteTargets}
          onClick={() => void refreshMarket(data.stocks.map(stock => stock.code))}>
          {progress ? t('div_refresh_progress', progress) : t(quotes.refreshing ? 'div_quotes_updating' : 'div_cs_toolbar_refresh_all')}
        </button>
      </section>
      <DividendAdvisor onUpdated={load} amountVisible={amountVisible} planKey={dailyPlanKey} onOpenCheckItem={onOpenCheckItem} showDailyCheck={false}
        onManageStock={code => { const stock = data.stocks.find(value => value.code === code); if (stock) { setIsNew(false); setEditor(stock); } }}
        selectionTools={<div className="div-selection-toolbar">
          <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>{t('div_cs_toolbar_import')}</button>
          <button type="button" className="btn btn-secondary" onClick={startAdd}>{t('div_cs_toolbar_add')}</button>
          <button type="button" className="btn btn-secondary" disabled={!data.stocks.length || data.budgetMinor <= 0}
            onClick={() => { setAllocationMode('equal'); setAllocationOpen(true); }}>{t('div_experience_reallocate')}</button>
          {untracked.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => setLinkedPickerOpen(true)}>{t('div_cs_toolbar_linked', { count: untracked.length })}</button>}
        </div>}
        />

      {!panel && feedback}
      {!panel && allocationResult && <details className="div-wb-disclosure">
        <summary>{t('div_allocation_result')}</summary>
        <AllocationPreview {...allocationResult} budgetMinor={data.budgetMinor} amountVisible={amountVisible} />
      </details>}
      {data.strategy === 'stocks' ? <>
        <section className="div-wb-overview" aria-label={t('div_new_overview')}>
          <div className="div-wb-heading">
            <div>
              <span>{t('div_cs_summary_budget')}</span>
              <strong>{data.budgetConfigured ? money(data.budgetMinor) : '—'}</strong>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => { setMessage(''); setError(''); setWeightsRepaired(false); setPanel('budget'); }}>{t('div_budget_manage')}</button>
          </div>
          <p className={totalWeightBps > 10000 ? 'div-warning' : 'div-muted'}>
            {totalWeightBps > 10000
              ? t('div_new_weights_over', { percent: numeric(totalWeightBps / 100) })
              : t('div_allocated', { percent: numeric(totalWeightBps / 100), remaining: money(remainingMinor) })}
          </p>
          {weightsRepaired && <p className="div-muted" role="status">{t('div_new_weights_repaired')}</p>}
          <dl className="div-wb-overview-meta">
            <div><dt>{t('div_cs_summary_held')}</dt><dd>{heldCount} / {classicPlans.length}</dd></div>
            <div><dt>{t('div_new_gross_annual')}</dt><dd>{money(annualDividendMinor)}</dd></div>
          </dl>
        </section>

        <section className="div-wb-daily" aria-labelledby="div-wb-daily-title">
          <div className="div-wb-heading">
            <div>
              <h2 id="div-wb-daily-title">{t('div_new_daily')}</h2>
              <p>{t('div_cs_summary_triggers_val', { buy: buyCount, sell: sellCount })}
                {unverifiedCount > 0 && <small> · {t('div_new_unverified_count', { count: unverifiedCount })}</small>}
              </p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => openAdvice()}>{t('div_new_daily_open')}</button>
          </div>
          {(progress || quotes.refreshing || quotes.failed) && <p className="div-muted" role="status">
            {progress ? t('div_refresh_progress', progress) : t(quotes.refreshing ? 'div_quotes_updating' : 'div_new_quote_failed')}
          </p>}
        </section>

        <section className="div-wb-stocks" aria-labelledby="div-wb-stocks-title">
          <div className="div-wb-heading">
            <h2 id="div-wb-stocks-title">{t('div_new_stocks')}</h2>
            <button type="button" className="btn btn-primary" onClick={startAdd}>{t('div_cs_toolbar_add')}</button>
          </div>
          <div className="div-wb-list-tools">
            <input type="search" aria-label={t('div_search')} placeholder={t('div_search')} value={search}
              onChange={event => setSearch(event.target.value)} />
            <select aria-label={t('div_new_stock_filter')} value={selectorFilter}
              onChange={event => setSelectorFilter(event.target.value as StockSelectorFilter)}>
              {(['all', 'triggered', 'held', 'core', 'watch', 'hidden'] as const).map(filter =>
                <option value={filter} key={filter}>{t(`div_cs_filter_${filter}`, {
                  count: checkedPlans.filter(item => matchesFilter(item, filter)).length,
                })}</option>,
              )}
            </select>
          </div>

          <ul className="div-wb-stock-list">
            {visiblePlans.map(({ plan, facts }) => (
              <li key={plan.code}>
                <button type="button" className="div-wb-stock-row" onClick={() => openStock(plan.code)}>
                  <span className="div-wb-stock-name">
                    <strong>{plan.name}</strong>
                    <small>{plan.code} · {t(`div_group_${plan.group}`)}</small>
                  </span>
                  <span className="div-wb-stock-data">
                    <strong>{plan.quotePriceMinor === undefined ? '—' : `¥${(plan.quotePriceMinor / 100).toFixed(2)}`}</strong>
                    <small className={`is-${facts.status}`}>{t(`div_new_status_${facts.status}`)}</small>
                  </span>
                  <span className="div-wb-chevron" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
          {!visiblePlans.length && <p className="div-muted">{t('div_read_no_match')}</p>}

        </section>
      </> : (
        <DividendFundHomePlan plan={data.fundPlan} checks={checks.funds} amountVisible={amountVisible}
          asOf={today} collapsedCodes={collapsedCodes} onToggle={toggleFundCollapse}
          readFilter="all" search="" onEdit={() => setPanel('fund')} />
      )}

      {panel === 'budget' && <WorkbenchDialog title={t('div_budget_manage')} onClose={closePanel}>
        {feedback}
        <form className="div-wb-budget" onSubmit={event => { event.preventDefault(); void persistBudget(); }}>
          <label htmlFor="div-budget">{t('div_budget')}</label>
          <div className="div-wb-list-tools">
            <input id="div-budget" inputMode="decimal" type={amountVisible ? 'number' : 'password'} min="0"
              max="1000000000000" step="0.01" value={budgetInput} disabled={budgetSaving}
              onChange={event => setBudgetInput(event.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={budgetSaving}>{t(budgetSaving ? 'loading' : 'save')}</button>
          </div>
        </form>
        <label className="div-wb-budget" htmlFor="div-cs-tax-select">
          {t('div_cs_tax_label')}
          <select id="div-cs-tax-select" value={taxBps} onChange={event => void changeTaxRate(Number(event.target.value) as ClassicTaxRateBps)}>
            {([0, 1000, 2000] as const).map(rate => <option key={rate} value={rate}>{t(`div_cs_tax_${rate}`)}</option>)}
          </select>
        </label>
        <p className="div-muted">{t('div_new_weights_rule')}</p>
        <div className="div-actions">
          <button type="button" className="btn btn-secondary" disabled={budgetSaving || totalWeightBps === 0 || totalWeightBps === 10000}
            onClick={() => { setAllocationMode('proportional'); setAllocationOpen(true); }}>{t(totalWeightBps > 10000 ? 'div_new_weights_repair' : 'div_allocate_unused')}</button>
          <button type="button" className="btn btn-primary" disabled={budgetSaving || !data.stocks.length || data.budgetMinor <= 0}
            onClick={() => { setAllocationMode('equal'); setAllocationOpen(true); }}>{t('div_experience_reallocate')}</button>
        </div>
        <ul className="div-wb-weights">
          {data.stocks.slice().sort((a, b) => b.weightBps - a.weightBps).map(stock =>
            <li key={stock.code}>
              <button type="button" className="div-wb-stock-row" onClick={() => { setIsNew(false); setEditor(stock); }}>
                <span className="div-wb-stock-name"><strong>{stock.name}</strong><small>{stock.code} · {t(`div_group_${stock.group}`)}</small></span>
                <span className="div-wb-stock-data"><strong>{numeric(stock.weightBps / 100)}%</strong>
                  <small>{money(stockBudgetMinor(data.budgetMinor, stock.weightBps))}</small></span>
                <span className="div-wb-chevron" aria-hidden="true">›</span>
              </button>
            </li>)}
        </ul>
        <details className="div-wb-disclosure">
          <summary>{t('div_new_grid_method')}</summary>
          {([1, 2] as const).map(index => <p className="div-muted" key={index}>{t(`div_cs_method_rule_${index}_body`)}</p>)}
          {batchConfirm ? <>
            <p className="div-warning">{t('div_new_batch_overwrite', { count: data.stocks.length })}</p>
            <div className="div-actions">
              <button type="button" className="btn btn-primary" disabled={gridApplying} onClick={() => void applyGrid()}>{t('div_new_confirm_grid')}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setBatchConfirm(false)}>{t('cancel')}</button>
            </div>
          </> : <button type="button" className="btn btn-secondary" disabled={!data.stocks.length || gridApplying}
            onClick={() => setBatchConfirm(true)}>{t('div_cs_batch_apply_all')}</button>}
        </details>
        {allocationResult && <section className="div-allocation-result" ref={allocationResultRef}>
          <h3>{t('div_allocation_result')}</h3>
          <AllocationPreview {...allocationResult} budgetMinor={data.budgetMinor} amountVisible={amountVisible} />
        </section>}
      </WorkbenchDialog>}

      {panel === 'stock' && selected && selectedStock && <WorkbenchDialog key={selectedCode}
        title={selected.plan.name} subtitle={`${selected.plan.code} · ${t(`div_group_${selected.plan.group}`)}`} onClose={closePanel}>
        {feedback}
        <DividendClassicGrid plan={selected.plan} facts={selected.facts} amountVisible={amountVisible} busy={gridApplying}
          onSaveGrid={() => void applyGrid(selected.plan.code)} />
        <div className="div-actions div-wb-detail-actions">
          <button type="button" className="btn btn-primary" onClick={() => { setIsNew(false); setEditor(selectedStock); }}>
            {t('div_new_edit_stock')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!canRefresh}
            onClick={() => void refreshMarket([selectedStock.code])}>{t('div_cs_refresh_single_btn')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => openAdvice(selected.plan.code)}>{t('div_new_daily_open')}</button>
        </div>
        {(progress || quotes.refreshing) && <p className="div-muted" role="status">
          {progress ? t('div_refresh_progress', progress) : t('div_quotes_updating')}
        </p>}
      </WorkbenchDialog>}

      {panel === 'fund' && <WorkbenchDialog title={t('div_home_fund_plans')} onClose={closePanel}>
        <DividendFundWorkbench plan={data.fundPlan} checks={checks.funds} amountVisible={amountVisible} onSaved={load} />
      </WorkbenchDialog>}

      {panel === 'advice' && <WorkbenchDialog title={t('div_new_daily')} subtitle={adviceTarget?.name}
        onClose={() => { closePanel(); if (adviceCode) setPanel('stock'); }}>
        {feedback}
        {aiOutput && <DividendClassicAdviceResult output={aiOutput} targetLabel={aiTargetLabel} amountVisible={amountVisible} />}
        {aiBusy && <p className="div-muted" role="status">{t('div_new_ai_working')}</p>}
        <div className="div-wb-advice-tools">
          <form className="div-wb-list-tools" onSubmit={event => {
            event.preventDefault();
            if (aiQuestion.trim()) void askAiToday(adviceCode, aiQuestion.trim());
          }}>
            <input aria-label={t('div_new_ai_question')} placeholder={t('div_new_ai_question')} value={aiQuestion}
              onChange={event => setAiQuestion(event.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={aiBusy || !aiQuestion.trim()}>{t('div_cs_ai_ask_btn')}</button>
          </form>
          <button type="button" className="btn btn-secondary" onClick={() => {
            closePanel();
            window.dispatchEvent(new CustomEvent(DIVIDEND_AI_SETTINGS_REQUEST_EVENT));
          }}>{t('div_cs_ai_config_btn')}</button>
        </div>
      </WorkbenchDialog>}

      {editor && createPortal(
        <StockEditor
          initial={editor}
          isNew={isNew}
          stocks={data.stocks}
          budgetMinor={data.budgetMinor}
          taxBps={taxBps}
          amountVisible={amountVisible}
          onConflict={load}
          onClose={() => setEditor(null)}
          onSaved={async action => {
            const before = data.stocks;
            setEditor(null);
            const next = await load();
            if (action === 'deleted' || action === 'redistributed') {
              if (panel === 'stock') closePanel();
            }
            setAllocationResult(
              action === 'rebalanced' || action === 'redistributed' && before.some(stock => stock.weightBps > 0)
                ? { before, after: next.stocks }
                : null,
            );
            setError('');
            setMessage(
              t(
                action === 'rebalanced'
                  ? 'div_new_weights_rebalanced'
                  : action === 'redistributed'
                  ? 'div_deleted_redistributed'
                  : action === 'deleted'
                    ? 'div_deleted_unallocated'
                    : 'div_saved',
              ),
            );
          }}
        />
      , document.body)}
      {importOpen && createPortal(
        <DividendImportDialog
          stocks={data.stocks}
          budgetMinor={data.budgetMinor}
          amountVisible={amountVisible}
          onClose={() => setImportOpen(false)}
          onSaved={async result => {
            setImportOpen(false);
            const next = await load();
            const changed = data.stocks.some(stock => next.stocks.find(saved => saved.code === stock.code)?.weightBps !== stock.weightBps);
            setAllocationResult(changed ? { before: data.stocks, after: next.stocks } : null);
            setError('');
            setMessage(t('div_import_done', result));
          }}
        />
      , document.body)}
      {allocationOpen && createPortal(
        <AllocationDialog
          key={allocationMode}
          mode={allocationMode}
          stocks={data.stocks}
          budgetMinor={data.budgetMinor}
          budgetConfigured={data.budgetConfigured}
          amountVisible={amountVisible}
          onClose={() => setAllocationOpen(false)}
          onSaved={async () => {
            setAllocationOpen(false);
            const next = await load();
            setAllocationResult({ before: data.stocks, after: next.stocks });
            setError('');
            setMessage(t(allocationMode === 'equal' ? 'div_experience_reallocate_done' : 'div_allocation_done'));
          }}
        />
      , document.body)}
      {linkedPickerOpen && createPortal(
        <LinkedStockPicker
          positions={untracked}
          hasBudget={data.budgetMinor > 0}
          amountVisible={amountVisible}
          onClose={() => setLinkedPickerOpen(false)}
          onSaved={async count => {
            setLinkedPickerOpen(false);
            const next = await load();
            const changed = data.stocks.some(stock => next.stocks.find(saved => saved.code === stock.code)?.weightBps !== stock.weightBps);
            setAllocationResult(changed ? { before: data.stocks, after: next.stocks } : null);
            setMessage(t('div_linked_added', { count }) + (changed ? ` · ${t('div_new_weights_rebalanced')}` : ''));
            setError('');
          }}
        />
      , document.body)}

    </div>
  );
}

function WorkbenchDialog({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-label={title} className="div-dialog div-wb-dialog"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="div-wb-dialog-header">
      <div><h2>{title}</h2>{subtitle && <small>{subtitle}</small>}</div>
      <button type="button" className="btn btn-secondary" onClick={onClose}>{t('close')}</button>
    </header>
    <div className="div-wb-dialog-body">{children}</div>
  </dialog>;
}

function LinkedStockPicker({
  positions,
  hasBudget,
  amountVisible,
  onClose,
  onSaved,
}: {
  positions: LinkedDividendPosition[];
  hasBudget: boolean;
  amountVisible: boolean;
  onClose: () => void;
  onSaved: (count: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [allocate, setAllocate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const selectableCodes = positions.map(position => position.code);
  const selectedCodes = selected.filter(code => selectableCodes.includes(code));
  const allSelected = positions.length > 0 && selectedCodes.length === positions.length;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || selectedCodes.length === 0) return;
    setSaving(true);
    try {
      await onSaved(await addLinkedDividendStocks(selectedCodes, allocate));
    } catch {
      setError(t('div_save_error'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      className="div-dialog"
      ref={dialog}
      onCancel={e => {
        if (saving) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="div-linked-title"
    >
      <form onSubmit={e => void submit(e)}>
        <div className="div-stock-heading">
          <h2 id="div-linked-title">{t('div_linked_select_title')}</h2>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
            {t('close')}
          </button>
        </div>
        <p className="div-muted">{t('div_linked_select_note')}</p>
        {hasBudget && <label className="div-linked-all">
          <input type="checkbox" checked={allocate} disabled={saving} onChange={event => setAllocate(event.target.checked)} />
          {t('div_new_allocate_linked')}
        </label>}
        <label className="div-linked-all">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={saving || positions.length === 0}
            onChange={e => setSelected(e.target.checked ? selectableCodes : [])}
          />
          {t('div_linked_select_all')}
        </label>
        <div className="div-linked-list">
          {positions.map(position => (
            <label className="div-linked-option" key={position.code}>
              <input
                type="checkbox"
                disabled={saving}
                checked={selectedCodes.includes(position.code)}
                onChange={e =>
                  setSelected(codes =>
                    e.target.checked ? [...codes, position.code] : codes.filter(code => code !== position.code),
                  )
                }
              />
              <span>
                <strong>
                  {position.name} <small>{position.code}</small>
                </strong>
                <small>
                  {t('div_linked_position_shares', {
                    shares: amountVisible ? numeric(position.shares, 4) : '••••',
                  })}{' '}
                  · {position.sources.map(source => source.accountName).join(' · ')}
                </small>
              </span>
            </label>
          ))}
        </div>
        {positions.length === 0 && <p className="div-muted">{t('div_linked_empty')}</p>}
        {error && (
          <p className="div-warning" role="alert">
            {error}
          </p>
        )}
        <div className="div-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || selectedCodes.length === 0}>
            {t(saving ? 'loading' : 'div_linked_add_selected', { count: selectedCodes.length })}
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function StockEditor({
  initial,
  isNew,
  stocks,
  budgetMinor,
  taxBps,
  amountVisible,
  onClose,
  onSaved,
  onConflict,
}: {
  initial: DividendStock;
  isNew: boolean;
  stocks: DividendStock[];
  budgetMinor: number;
  taxBps: ClassicTaxRateBps;
  amountVisible: boolean;
  onClose: () => void;
  onSaved: (action?: 'deleted' | 'redistributed' | 'rebalanced') => Promise<void>;
  onConflict: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const deletePreview = useRef<HTMLElement>(null);
  const [stock, setStock] = useState(initial);
  const [openedFingerprint] = useState(() => dividendStockEditFingerprint(initial));
  const [dps, setDps] = useState(initial.manualDpsMicros === undefined ? '' : String(initial.manualDpsMicros / 1e6));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [redistribute, setRedistribute] = useState(true);
  const afterDelete = redistribute
    ? redistributeDividendWeights(stocks, initial.code)
    : stocks.filter(s => s.code !== initial.code);
  const weightPreview = previewDividendWeightChanges(stocks, [{ code: mainlandCode(stock.code) || stock.code, weightBps: stock.weightBps }]);
  const previewCode = mainlandCode(stock.code) || stock.code;
  const classicFallback = useMemo(() => buildClassicStockPlan(stock, { taxBps }), [stock, taxBps]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (confirmDelete) deletePreview.current?.scrollIntoView({ block: 'start' });
  }, [confirmDelete]);
  const patch = (value: Partial<DividendStock>) => setStock(s => ({ ...s, ...value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = mainlandCode(stock.code);
    if (saving) return;
    if (
      !code ||
      (isNew && stocks.some(s => s.code === code)) ||
      !stock.name.trim() ||
      (dps !== '' && (!Number.isFinite(Number(dps)) || Number(dps) < 0))
    ) {
      setError(t('div_invalid_stock'));
      return;
    }
    setSaving(true);
    try {
      const result = await saveDividendStock(
        {
          ...stock,
          code,
          name: stock.name.trim(),
          manualDpsMicros: dps === '' ? undefined : Math.round(Number(dps) * 1e6),
        },
        isNew ? { expectNew: true } : { expectedFingerprint: openedFingerprint },
      );
      await onSaved(result.rebalanced ? 'rebalanced' : undefined);
    } catch (cause) {
      const conflict = cause instanceof Error && cause.message === 'DIVIDEND_STOCK_CHANGED';
      setError(t(conflict ? 'div_check_stock_conflict' : 'div_invalid_stock'));
      if (conflict) await onConflict().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await deleteDividendStock(initial.code, redistribute);
      await onSaved(redistribute ? 'redistributed' : 'deleted');
    } catch (cause) {
      setError(
        t(
          cause instanceof Error && cause.message === 'DIVIDEND_STOCK_HELD'
            ? 'div_v2_held_delete_blocked'
            : 'div_save_error',
        ),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      className="div-dialog"
      ref={dialog}
      onCancel={e => {
        if (saving) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="div-editor-title"
    >
      <form onSubmit={e => void save(e)}>
        <div className="div-stock-heading">
          <h2 id="div-editor-title">{t(isNew ? 'div_add' : 'div_edit')}</h2>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
            {t('close')}
          </button>
        </div>
          <label className="div-linked-all">
            <input
              type="checkbox"
              checked={stock.buyPaused ?? false}
              onChange={e => patch({ buyPaused: e.target.checked })}
            />
            {t('div_buy_paused')}
          </label>
        <div className="div-form-fields">
          <label>
            {t('div_code')}
            <input
              required
              disabled={!isNew}
              value={stock.code}
              onChange={e =>
                patch({
                  code: e.target.value,
                  ...(isNew ? { lotSize: e.target.value.replace(/\D/g, '').startsWith('68') ? 200 : 100 } : {}),
                })
              }
            />
          </label>
          <label>
            {t('name')}
            <input required maxLength={80} value={stock.name} onChange={e => patch({ name: e.target.value })} />
          </label>
          <label>
            {t('div_group')}
            <select value={stock.group} onChange={e => patch({ group: e.target.value as DividendStock['group'] })}>
              {['core', 'watch', 'hidden'].map(g => (
                <option key={g} value={g}>
                  {t(`div_group_${g}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('div_weight')}
            <input
              required
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.01"
              value={stock.weightBps / 100}
              onChange={e => patch({ weightBps: Math.round(Number(e.target.value) * 100) })}
            />
          </label>
          <label>
            {t('div_share_mode')}
            <select
              value={stock.shareMode}
              onChange={e => patch({ shareMode: e.target.value as DividendStock['shareMode'] })}
            >
              <option value="linked">{t('div_linked')}</option>
              <option value="manual">{t('div_manual')}</option>
            </select>
          </label>
          {stock.shareMode === 'manual' && (
            <label>
              {t('div_shares')}
              <input
                required
                type="number"
                inputMode="decimal"
                min="0"
                step="0.0001"
                value={stock.manualShares}
                onChange={e => patch({ manualShares: Number(e.target.value) })}
              />
            </label>
          )}
        </div>
        <details className="div-method"><summary>{t('div_focus_advanced')}</summary><div className="div-form-fields">
          <label>
            {t('div_v2_manual_grid_annual')}
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.000001"
              placeholder={t('div_auto_dps')}
              value={dps}
              onChange={e => setDps(e.target.value)}
            />
          </label>
          <label>
            {t('div_lot_size')}
            <input
              required
              type="number"
              min="1"
              max="10000"
              step="1"
              value={stock.lotSize}
              onChange={e => patch({ lotSize: Number(e.target.value) })}
            />
          </label>
        </div><p className="div-muted">{t('div_v2_manual_grid_note')}</p></details>
        {weightPreview.requestedTotalBps > 10000 && <p className="div-notice">
          {t('div_new_weight_preview', { percent: numeric((weightPreview.weights.get(previewCode) ?? 0) / 100) })}
        </p>}
        {isNew && budgetMinor > 0 && <p className="div-muted">{t('div_new_weight_default')}</p>}
        <label className="div-form-note">
          {t('div_note')}
          <textarea
            maxLength={2000}
            rows={3}
            value={stock.note ?? ''}
            onChange={e => patch({ note: e.target.value })}
          />
        </label>
        <details className="div-method">
          <summary>{t('div_edit_grid')}</summary>
          <p>{t('div_edit_grid_note')}</p>
          {(['buy', 'sell'] as const).map(side => {
            const key = side === 'buy' ? 'buyLevels' : 'sellLevels';
            const levels =
              stock[key] ??
              (side === 'buy' ? classicFallback.classicBuyLevels : classicFallback.classicSellLevels);
            const change = (i: number, field: keyof GridLevel, value: string) =>
              patch({
                [key]: levels.map((level, index) =>
                  index === i
                    ? {
                        ...level,
                        [field]:
                          value === '' && field === 'priceMinor' ? undefined : Math.round(Number(value) * 100),
                      }
                    : level,
                ),
              });
            return (
              <div key={side}>
                <h3>{t(`div_grid_${side}`)}</h3>
                <div className="div-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('div_grid_yield')} %</th>
                        <th>{t('div_portion')} %</th>
                        <th>{t('div_override_price')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {levels.map((level, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_grid_yield')}`}
                              type="number"
                              required
                              min="0.01"
                              max="100"
                              step="0.01"
                              value={level.yieldBps / 100}
                              onChange={e => change(i, 'yieldBps', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_portion')}`}
                              type="number"
                              required
                              min="0"
                              max="100"
                              step="0.01"
                              value={level.portionBps / 100}
                              onChange={e => change(i, 'portionBps', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`${t(`div_grid_${side}`)} ${i + 1} ${t('div_override_price')}`}
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder={t('div_auto')}
                              value={level.priceMinor === undefined ? '' : level.priceMinor / 100}
                              onChange={e => change(i, 'priceMinor', e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => patch({ buyLevels: undefined, sellLevels: undefined })}
          >
            {t('div_reset_grid')}
          </button>
        </details>
        {error && (
          <p className="div-warning" role="alert">
            {error}
          </p>
        )}
        <div className="div-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {t('save')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
            {t('cancel')}
          </button>
          {!isNew && (
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirmDelete(true)}>
              {t('delete')}
            </button>
          )}
        </div>
        {confirmDelete && (
          <section className="div-delete-preview" ref={deletePreview}>
            <p className="div-warning">{t('div_delete_confirm', { name: initial.name })}</p>
            <label className="div-linked-all">
              <input
                type="checkbox"
                checked={redistribute}
                disabled={saving}
                onChange={e => setRedistribute(e.target.checked)}
              />
              {t('div_delete_redistribute')}
            </label>
            <p className="div-muted">{t(redistribute ? 'div_experience_deleted_allocation' : 'div_delete_keep_unused')}</p>
            <AllocationPreview
              before={stocks.filter(s => s.code !== initial.code)}
              after={afterDelete}
              budgetMinor={budgetMinor}
              amountVisible={amountVisible}
            />
            <div className="div-actions">
              <button type="button" className="btn btn-danger" disabled={saving} onClick={() => void remove()}>
                {t('div_delete_apply')}
              </button>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirmDelete(false)}>
                {t('cancel')}
              </button>
            </div>
          </section>
        )}
      </form>
    </dialog>
  );
}

function AllocationPreview({
  before,
  after,
  budgetMinor,
  amountVisible,
}: {
  before: DividendStock[];
  after: DividendStock[];
  budgetMinor: number;
  amountVisible: boolean;
}) {
  const { t } = useTranslation();
  const oldTotal = before.reduce((sum, stock) => sum + stock.weightBps, 0);
  const newTotal = after.reduce((sum, stock) => sum + stock.weightBps, 0);
  return (
    <div className="div-allocation-preview">
      <p className="div-muted">
        {oldTotal > 0 && t('div_experience_allocation_formula', { before: numeric(oldTotal / 100), after: numeric(newTotal / 100) })}
      </p>
      <p className="div-muted">
        {t('div_allocation_remaining', {
          percent: numeric(Math.max(0, 10000 - newTotal) / 100),
          amount: amountVisible
            ? `¥${numeric(Math.max(0, budgetMinor - stockBudgetMinor(budgetMinor, newTotal)) / 100)}`
            : '••••',
        })}
      </p>
      <div className="div-table-scroll">
        <table>
          <caption>{t('div_allocation_preview')}</caption>
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('div_allocation_before')}</th>
              <th>{t('div_allocation_after')}</th>
              <th>{t('div_stock_budget')}</th>
            </tr>
          </thead>
          <tbody>
            {after.filter(stock => stock.weightBps > 0 || before.some(old => old.code === stock.code && old.weightBps > 0)).map(stock => (
              <tr key={stock.code}>
                <td>
                  {stock.name}
                  <small className="div-preview-code">
                    {stock.code}
                    {stock.group === 'hidden' ? ` · ${t('div_group_hidden')}` : ''}
                  </small>
                </td>
                <td>{numeric((before.find(s => s.code === stock.code)?.weightBps ?? 0) / 100)}%</td>
                <td>{numeric(stock.weightBps / 100)}%</td>
                <td>
                  {amountVisible ? `¥${numeric(stockBudgetMinor(budgetMinor, stock.weightBps) / 100)}` : '••••'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AllocationDialog({
  mode,
  stocks,
  budgetMinor,
  budgetConfigured,
  amountVisible,
  onClose,
  onSaved,
}: {
  mode: 'proportional' | 'equal';
  stocks: DividendStock[];
  budgetMinor: number;
  budgetConfigured: boolean;
  amountVisible: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [preview] = useState(() => ({ stocks: structuredClone(stocks), budgetMinor, fingerprint: dividendBudgetAllocationFingerprint(stocks, budgetMinor, budgetConfigured) }));
  const apply = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === 'equal') await reallocateDividendBudget({ expectedFingerprint: preview.fingerprint });
      else await allocateDividendBudget();
      await onSaved();
    } catch (cause) {
      setError(t(cause instanceof Error && cause.message === 'DIVIDEND_BUDGET_CHANGED' ? 'div_experience_allocation_changed' : 'div_save_error'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      className="div-dialog"
      ref={dialog}
      aria-labelledby="div-allocation-title"
      onCancel={e => {
        if (saving) e.preventDefault();
        else onClose();
      }}
    >
      <div className="div-stock-heading">
        <h2 id="div-allocation-title">{t(mode === 'equal' ? 'div_experience_reallocate' : preview.stocks.reduce((sum, stock) => sum + stock.weightBps, 0) > 10000 ? 'div_new_weights_repair' : 'div_allocate_unused')}</h2>
        <button className="btn btn-secondary" disabled={saving} onClick={onClose}>
          {t('close')}
        </button>
      </div>
      <p className="div-muted">{t(mode === 'equal' ? 'div_experience_reallocate_note' : preview.stocks.reduce((sum, stock) => sum + stock.weightBps, 0) > 10000 ? 'div_new_weights_rule' : 'div_allocate_unused_note')}</p>
      <AllocationPreview
        before={preview.stocks}
        after={mode === 'equal' ? equalDividendWeights(preview.stocks) : scaleDividendWeights(preview.stocks)}
        budgetMinor={preview.budgetMinor}
        amountVisible={amountVisible}
      />
      {error && (
        <p role="alert" className="div-warning">
          {error}
        </p>
      )}
      <div className="div-actions">
        <button className="btn btn-primary" disabled={saving} onClick={() => void apply()}>
          {t('div_allocation_apply')}
        </button>
        <button className="btn btn-secondary" disabled={saving} onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </dialog>
  );
}
