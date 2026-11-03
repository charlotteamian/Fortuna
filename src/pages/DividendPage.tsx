import { loadDividendCheckSummaries } from '../services/dividendCheckSummaryService';
import { loadDividendFundPositions } from '../services/dividendAdvisorContextService';
import { dividendCheckSummary } from '../lib/dividendCheckSummary';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  dateInChina,
  forecastHoldingYearDividends,
  fundedDividendStocks,
  latestReportDividend,
  mainlandCode,
  redistributeDividendWeights,
  scaleDividendWeights,
  sortDividendStocks,
  stockBudgetMinor,
  type DividendStock,
  type GridLevel,
  type LinkedDividendPosition,
} from '../lib/dividendWorkbench';
import {
  addLinkedDividendStocks,
  allocateDividendBudget,
  applyAllClassicDividendGrids,
  applyClassicDividendGrid,
  deleteDividendStock,
  dividendStockEditFingerprint,
  loadDividendWorkbench,
  refreshDividendStocks,
  saveDividendBudget,
  saveDividendHomeCollapse,
  saveDividendStock,
  saveDividendStockGroup,
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
import DividendAdvisorMarkdown from '../components/DividendAdvisorMarkdown';
import DividendCheckStatus from '../components/DividendCheckStatus';
import DividendPlanGrid from '../components/DividendPlanGrid';
import { saveDividendStrategy } from '../services/dividendFundService';
import type { DividendStrategy } from '../lib/dividendFundPlan';
import { isExchangeTradedFundCode } from '../lib/dividendQuote';
import { useDividendQuotes } from '../hooks/useDividendQuotes';
import { loadDividendDailyAdvicePlanKey } from '../services/dividendDailyAdviceScopeService';
import './DividendPage.css';
import type { DividendDailyItem } from '../lib/dividendDailyCheck';
import { dividendBackgroundRefreshPaused } from '../services/dividendRequestControl';

type Workbench = Awaited<ReturnType<typeof loadDividendWorkbench>>;
type StockSelectorFilter = 'all' | 'triggered' | 'held' | 'core' | 'watch' | 'hidden';

const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

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
  const [budgetPanelOpen, setBudgetPanelOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const [linkedPickerOpen, setLinkedPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationResult, setAllocationResult] = useState<{ before: DividendStock[]; after: DividendStock[] } | null>(null);
  const allocationResultRef = useRef<HTMLElement>(null);
  const detailSectionRef = useRef<HTMLElement>(null);
  const [collapsedCodes, setCollapsedCodes] = useState<string[]>([]);
  const collapseLoaded = useRef(false);
  const collapseState = useRef<string[]>([]);
  const [managerSearch, setManagerSearch] = useState('');
  const [focusedPlanCode, setFocusedPlanCode] = useState('');
  const [openPlanRequest, setOpenPlanRequest] = useState(0);
  const scrolledPlanRequest = useRef(0);
  const [groupSaving, setGroupSaving] = useState(false);
  const [gridApplying, setGridApplying] = useState(false);
  const [editor, setEditor] = useState<DividendStock | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Inline AI Daily Advice state
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
    const [next, pricingMethod] = await Promise.all([
      loadDividendWorkbench(),
      loadDividendPricingMethod().catch(() => null),
    ]);
    const fundPositions = await loadDividendFundPositions(next.fundPlan.funds);
    const inspection = await loadDividendCheckSummaries(next, { fundPositions });
    const planKey = await loadDividendDailyAdvicePlanKey(next, inspection);
    if (alive.current && id === loadId.current) {
      setData(next);
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
  const quantity = (shares: number) => (amountVisible ? numeric(shares, 4) : '••••');

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
      await saveDividendBudget(budget);
      await load();
      setAllocationResult(null);
      if (alive.current) {
        setBudgetInput(String(budget / 100));
        setError('');
        setMessage(t('div_saved'));
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
      // Keep local state responsive even if settings write fails
    }
  };

  const today = dateInChina();

  // Compute Classic Plans for all stocks
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

  const planByCode = useMemo(() => new Map(classicPlans.map(p => [p.code, p])), [classicPlans]);

  // Filter stocks for selector
  const filteredPlans = useMemo(() => {
    const query = search.trim().toLowerCase();
    return classicPlans.filter(plan => {
      if (query && !`${plan.name} ${plan.code} ${plan.sector}`.toLowerCase().includes(query)) return false;
      if (selectorFilter === 'triggered') return plan.todayAction.triggeredBuyLevel > 0 || plan.todayAction.triggeredSellLevel > 0;
      if (selectorFilter === 'held') return plan.shares > 0;
      if (selectorFilter === 'core') return plan.group === 'core';
      if (selectorFilter === 'watch') return plan.group === 'watch';
      if (selectorFilter === 'hidden') return plan.group === 'hidden';
      return plan.group !== 'hidden' || plan.shares > 0;
    });
  }, [classicPlans, search, selectorFilter]);

  // Keep selectedCode valid
  const activeSelectedCode = useMemo(() => {
    if (selectedCode && planByCode.has(selectedCode)) return selectedCode;
    return filteredPlans[0]?.code ?? classicPlans[0]?.code ?? '';
  }, [selectedCode, planByCode, filteredPlans, classicPlans]);

  const selectedPlan = activeSelectedCode ? planByCode.get(activeSelectedCode) : undefined;
  const selectedStock = data?.stocks.find(s => s.code === activeSelectedCode);

  if (!data) return <div role="status">{error || t('loading')}</div>;

  const sharesFor = (stock: DividendStock) =>
    stock.shareMode === 'manual' ? stock.manualShares : data.positions.get(stock.code)?.shares ?? 0;

  const changeStrategy = async (strategy: DividendStrategy) => {
    if (strategySaving) return;
    setStrategySaving(true);
    setError('');
    try {
      await saveDividendStrategy(strategy);
      await load();
      setMessage('');
    } catch {
      setError(t('div_save_error'));
    } finally {
      setStrategySaving(false);
    }
  };

  const changeStockGroup = async (code: string, value: DividendStock['group']) => {
    if (groupSaving) return;
    setGroupSaving(true);
    setError('');
    try {
      await saveDividendStockGroup(code, value);
      await load();
      setMessage(t('div_saved'));
    } catch {
      setError(t('div_save_error'));
    } finally {
      setGroupSaving(false);
    }
  };

  const saveSingleClassicGrid = async (code: string) => {
    if (gridApplying) return;
    setGridApplying(true);
    setError('');
    try {
      await applyClassicDividendGrid(code, taxBps);
      await load();
      setMessage(t('div_saved'));
    } catch {
      setError(t('div_save_error'));
    } finally {
      setGridApplying(false);
    }
  };

  const saveAllClassicGrids = async () => {
    if (gridApplying) return;
    setGridApplying(true);
    setError('');
    try {
      await applyAllClassicDividendGrids(taxBps);
      await load();
      setMessage(t('div_saved'));
    } catch {
      setError(t('div_save_error'));
    } finally {
      setGridApplying(false);
    }
  };

  const askAiToday = async (options: { targetCode?: string; customQuestion?: string } = {}) => {
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiBusy(true);
    const targetStock = options.targetCode ? planByCode.get(options.targetCode) : undefined;
    setAiTargetLabel(
      options.customQuestion?.trim()
        ? options.customQuestion.trim()
        : targetStock
          ? `${targetStock.name} (${targetStock.code})`
          : t('div_cs_ai_btn_all'),
    );
    try {
      const output = await generateClassicDividendAdvice({
        plans: classicPlans,
        selectedCode: options.targetCode,
        totalBudgetMinor: data.budgetConfigured ? data.budgetMinor : undefined,
        question: options.customQuestion,
        language: i18n.language,
        asOf: today,
        signal: controller.signal,
        onLocalReady: localMarkdown => {
          if (alive.current && aiAbortRef.current === controller) {
            setAiOutput({ localMarkdown, configured: true });
          }
        },
      });
      if (alive.current && aiAbortRef.current === controller) {
        setAiOutput(output);
        if (options.customQuestion) setAiQuestion('');
      }
    } catch {
      // Ignore abort errors
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        if (alive.current) setAiBusy(false);
      }
    }
  };

  const openFundPlan = async () => {
    if (data.strategy !== 'funds') await changeStrategy('funds');
    setFocusedPlanCode('');
    setOpenPlanRequest(value => value + 1);
  };

  const toggleFundCollapse = (code: string) => {
    const collapsed = !collapseState.current.includes(code);
    const key = code.startsWith('fund:') ? `open:${code}` : code;
    const next = (code.startsWith('fund:') ? !collapsed : collapsed)
      ? [...collapseState.current, key]
      : collapseState.current.filter(value => value !== key);
    collapseState.current = next;
    setCollapsedCodes(next);
    void saveDividendHomeCollapse(code, collapsed).catch(() => {
      if (alive.current) setError(t('div_save_error'));
    });
  };

  const openCheckItem = (item: DividendDailyItem) => {
    if (item.kind === 'stock' && item.code) {
      setSelectorFilter('all');
      setSearch('');
      setSelectedCode(item.code);
      requestAnimationFrame(() => {
        detailSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  };

  // Portfolio metrics
  const heldPlans = classicPlans.filter(p => p.shares > 0);
  const annualDividendMinorTotal = heldPlans.reduce(
    (sum, p) => sum + Math.round((p.shares * p.base.grossDpsMicros) / 10000),
    0,
  );
  const buyTriggeredCount = classicPlans.filter(p => p.todayAction.triggeredBuyLevel > 0).length;
  const sellTriggeredCount = classicPlans.filter(p => p.todayAction.triggeredSellLevel > 0).length;
  const totalWeightBps = data.stocks.reduce((sum, stock) => sum + stock.weightBps, 0);
  const untracked = [...data.positions.values()]
    .filter(position => !data.stocks.some(stock => stock.code === position.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  // Filter counts
  const filterCounts: Record<StockSelectorFilter, number> = {
    all: classicPlans.filter(p => p.group !== 'hidden' || p.shares > 0).length,
    triggered: classicPlans.filter(p => p.todayAction.triggeredBuyLevel > 0 || p.todayAction.triggeredSellLevel > 0).length,
    held: heldPlans.length,
    core: classicPlans.filter(p => p.group === 'core').length,
    watch: classicPlans.filter(p => p.group === 'watch').length,
    hidden: classicPlans.filter(p => p.group === 'hidden').length,
  };

  // Secondary planManagement node for DividendAdvisor modal compatibility
  const fundedCodes = new Set(
    fundedDividendStocks(data.stocks, data.budgetConfigured ? data.budgetMinor : undefined).map(stock => stock.code),
  );
  const managedStocks = sortDividendStocks(
    data.stocks.filter(stock => `${stock.name} ${stock.code}`.toLowerCase().includes(managerSearch.trim().toLowerCase())),
    sharesFor,
  );
  const fundedPlans = managedStocks.filter(stock => fundedCodes.has(stock.code));
  const planManagement = (
    <div className="div-plan-manager">
      <h2 className="div-ai-panel-title">{t('div_ai_tab_plan')}</h2>
      {data.strategy === 'funds' ? (
        <DividendFundWorkbench plan={data.fundPlan} checks={checks.funds} amountVisible={amountVisible} onSaved={load} />
      ) : (
        <div className="div-plan-manager-list">
          <input
            aria-label={t('div_search')}
            placeholder={t('div_search')}
            value={managerSearch}
            onChange={event => setManagerSearch(event.target.value)}
          />
          {fundedPlans.map(stock => {
            const check =
              checks.stocks[stock.code] ??
              dividendCheckSummary({
                stock,
                totalBudgetMinor: data.budgetConfigured ? data.budgetMinor : undefined,
                shares: sharesFor(stock),
                asOf: today,
              });
            const plan = check.displayPlan;
            return (
              <details
                key={stock.code}
                open={stock.code === focusedPlanCode}
                ref={element => {
                  if (element && stock.code === focusedPlanCode && scrolledPlanRequest.current !== openPlanRequest) {
                    scrolledPlanRequest.current = openPlanRequest;
                    element.scrollIntoView({ block: 'start' });
                  }
                }}
              >
                <summary>
                  <strong>{stock.name}</strong>
                  <span>
                    {stock.code} · {t(`div_group_${stock.group}`)}
                  </span>
                </summary>
                <DividendCheckStatus summary={check} />
                {(['buy', 'sell'] as const).map(side => (
                  <DividendPlanGrid
                    key={side}
                    plan={plan}
                    side={side}
                    amountVisible={amountVisible}
                    tierIndices={check.grid[side === 'buy' ? 'buyTierIndices' : 'sellTierIndices']}
                  />
                ))}
              </details>
            );
          })}
        </div>
      )}
    </div>
  );

  // Price ruler position percentage for selectedPlan
  const rulerPositionPct = (() => {
    if (!selectedPlan?.quotePriceMinor) return 50;
    const minBuy = selectedPlan.buyRows.at(-1)?.priceMinor ?? selectedPlan.neutralPriceMinor * 0.75;
    const maxSell = selectedPlan.sellRows.at(-1)?.priceMinor ?? selectedPlan.neutralPriceMinor * 1.25;
    const low = Math.min(minBuy * 0.92, selectedPlan.quotePriceMinor);
    const high = Math.max(maxSell * 1.08, selectedPlan.quotePriceMinor);
    if (high <= low) return 50;
    return Math.max(4, Math.min(96, Math.round(((selectedPlan.quotePriceMinor - low) / (high - low)) * 100)));
  })();

  const latestReport = selectedStock ? latestReportDividend(selectedStock) : undefined;
  const holdingForecast = selectedStock && selectedPlan
    ? forecastHoldingYearDividends(selectedStock, today, selectedPlan.shares)
    : undefined;

  return (
    <div className="dividend-page">
      {editor && (
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
            const before = data.stocks.filter(stock => stock.code !== editor.code);
            setEditor(null);
            const next = await load();
            setAllocationResult(
              action === 'redistributed' && before.some(stock => stock.weightBps > 0)
                ? { before, after: next.stocks }
                : null,
            );
            setError('');
            setMessage(
              t(
                action === 'redistributed'
                  ? 'div_deleted_redistributed'
                  : action === 'deleted'
                    ? 'div_deleted_unallocated'
                    : 'div_saved',
              ),
            );
          }}
        />
      )}
      {importOpen && (
        <DividendImportDialog
          stocks={data.stocks}
          budgetMinor={data.budgetMinor}
          amountVisible={amountVisible}
          onClose={() => setImportOpen(false)}
          onSaved={async result => {
            setImportOpen(false);
            await load();
            setAllocationResult(null);
            setError('');
            setMessage(t('div_import_done', result));
          }}
        />
      )}
      {allocationOpen && (
        <AllocationDialog
          stocks={data.stocks}
          budgetMinor={data.budgetMinor}
          amountVisible={amountVisible}
          onClose={() => setAllocationOpen(false)}
          onSaved={async () => {
            setAllocationOpen(false);
            const next = await load();
            setAllocationResult({ before: data.stocks, after: next.stocks });
            setError('');
            setMessage(t('div_allocation_done'));
          }}
        />
      )}
      {linkedPickerOpen && (
        <LinkedStockPicker
          positions={untracked}
          amountVisible={amountVisible}
          onClose={() => setLinkedPickerOpen(false)}
          onSaved={async count => {
            setLinkedPickerOpen(false);
            await load();
            setAllocationResult(null);
            setMessage(t('div_linked_added', { count }));
            setError('');
          }}
        />
      )}

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('div_title')}</h1>
          <small className="div-active-strategy">{t('div_cs_subtitle')}</small>
        </div>
        <div className="div-actions">
          <div className="div-cs-mode-switch" role="group" aria-label={t('div_strategy')}>
            <button
              type="button"
              className={data.strategy === 'stocks' ? 'selected' : ''}
              aria-pressed={data.strategy === 'stocks'}
              disabled={strategySaving}
              onClick={() => void changeStrategy('stocks')}
            >
              {t('div_cs_mode_stocks')}
            </button>
            <button
              type="button"
              className={data.strategy === 'funds' ? 'selected' : ''}
              aria-pressed={data.strategy === 'funds'}
              disabled={strategySaving}
              onClick={() => void changeStrategy('funds')}
            >
              {t('div_cs_mode_funds')}
            </button>
          </div>
          <button className="btn btn-secondary" onClick={() => setAmountVisible(!amountVisible)}>
            {t(amountVisible ? 'div_hide_amounts' : 'div_show_amounts')}
          </button>
        </div>
      </div>

      {/* Top 4 Summary Cards */}
      <section className="div-cs-kpi-grid" aria-label={t('div_title')}>
        <div className="div-cs-kpi-card" onClick={() => setBudgetPanelOpen(v => !v)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setBudgetPanelOpen(v => !v); }}>
          <span>{t('div_cs_summary_budget')}</span>
          <strong>{data.budgetConfigured && data.budgetMinor > 0 ? money(data.budgetMinor) : t('div_cs_summary_budget_unset')}</strong>
          <small>{t('div_allocated', { percent: numeric(totalWeightBps / 100), remaining: money(Math.max(0, data.budgetMinor - stockBudgetMinor(data.budgetMinor, totalWeightBps))) })}</small>
        </div>
        <div className="div-cs-kpi-card">
          <span>{t('div_cs_summary_held')}</span>
          <strong>{t('div_cs_summary_held_val', { held: heldPlans.length, total: classicPlans.length })}</strong>
          <small>{untracked.length > 0 ? t('div_add_linked', { count: untracked.length }) : t('div_group_core') + ` ${filterCounts.core}`}</small>
        </div>
        <div className="div-cs-kpi-card">
          <span>{t('div_cs_summary_forecast')}</span>
          <strong>{money(annualDividendMinorTotal)}</strong>
          <small>{t(`div_cs_tax_${taxBps}`)}</small>
        </div>
        <div className={`div-cs-kpi-card${buyTriggeredCount > 0 ? ' is-buy-active' : sellTriggeredCount > 0 ? ' is-sell-active' : ''}`}>
          <span>{t('div_cs_summary_triggers')}</span>
          <strong>{t('div_cs_summary_triggers_val', { buy: buyTriggeredCount, sell: sellTriggeredCount })}</strong>
          <small>
            {quotes.refreshing
              ? t('div_quotes_updating')
              : quotes.result
                ? new Date(quotes.result.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                : today}
          </small>
        </div>
      </section>

      {/* Collapsible Budget & Tax Settings Bar */}
      {budgetPanelOpen && (
        <section className="div-cs-budget-drawer">
          <div className="div-stock-heading">
            <h3>{t('div_cs_toolbar_budget')}</h3>
            <button type="button" className="btn btn-secondary" onClick={() => setBudgetPanelOpen(false)}>
              {t('close')}
            </button>
          </div>
          <form
            className="div-budget"
            onSubmit={event => {
              event.preventDefault();
              void persistBudget();
            }}
          >
            <label htmlFor="div-budget">{t('div_budget')}</label>
            <div className="div-actions">
              <input
                id="div-budget"
                inputMode="decimal"
                type={amountVisible ? 'number' : 'password'}
                min="0"
                max="1000000000000"
                step="0.01"
                placeholder={t('div_budget_placeholder')}
                value={budgetInput}
                disabled={budgetSaving}
                onChange={event => setBudgetInput(event.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={budgetSaving}>
                {t(budgetSaving ? 'loading' : 'save')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(progress) || totalWeightBps <= 0 || totalWeightBps >= 10000}
                onClick={() => setAllocationOpen(true)}
              >
                {t('div_allocate_unused')}
              </button>
            </div>
          </form>
          {totalWeightBps > 10000 && <p className="div-warning">{t('div_over_budget')}</p>}
          <p className="div-muted">{t('div_allocation_rule')}</p>
        </section>
      )}

      {allocationResult && (
        <section className="div-allocation-result" ref={allocationResultRef}>
          <div className="div-stock-heading">
            <h2>{t('div_allocation_result')}</h2>
            <button className="btn btn-secondary" onClick={() => setAllocationResult(null)}>
              {t('close')}
            </button>
          </div>
          <AllocationPreview
            before={allocationResult.before}
            after={allocationResult.after}
            budgetMinor={data.budgetMinor}
            amountVisible={amountVisible}
          />
        </section>
      )}

      {message && (
        <p className="div-notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="div-warning" role="alert">
          {error}
        </p>
      )}

      {/* Inline AI Daily Grid Operation Advisor */}
      <section className="div-cs-ai-panel" aria-labelledby="div-cs-ai-heading">
        <div className="div-cs-ai-header">
          <div className="div-cs-ai-title-wrap">
            <span className="div-advisor-badge" aria-hidden="true">AI</span>
            <div>
              <h2 id="div-cs-ai-heading">{t('div_cs_ai_bar_title')}</h2>
              <p className="div-muted">{t('div_cs_ai_bar_desc')}</p>
            </div>
          </div>
          <div className="div-cs-ai-quick-links">
            <button
              type="button"
              className="div-advisor-text-button"
              onClick={() => window.dispatchEvent(new CustomEvent(DIVIDEND_AI_SETTINGS_REQUEST_EVENT))}
            >
              {t('div_cs_ai_config_btn')}
            </button>
          </div>
        </div>

        <div className="div-cs-ai-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={aiBusy}
            onClick={() => void askAiToday()}
          >
            ✨ {t('div_cs_ai_btn_all')}
          </button>
          {selectedPlan && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={aiBusy}
              onClick={() => void askAiToday({ targetCode: selectedPlan.code })}
            >
              🎯 {t('div_cs_ai_btn_selected', { name: selectedPlan.name })}
            </button>
          )}
          <form
            className="div-cs-ai-form"
            onSubmit={e => {
              e.preventDefault();
              if (aiQuestion.trim()) void askAiToday({ targetCode: selectedPlan?.code, customQuestion: aiQuestion });
            }}
          >
            <input
              type="text"
              placeholder={t('div_cs_ai_input_placeholder')}
              value={aiQuestion}
              disabled={aiBusy}
              onChange={e => setAiQuestion(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary" disabled={aiBusy || !aiQuestion.trim()}>
              {t('div_cs_ai_ask_btn')}
            </button>
          </form>
        </div>

        {aiBusy && (
          <p className="div-advisor-status" role="status">
            {t('div_cs_ai_thinking')}
          </p>
        )}

        {aiOutput && (
          <div className="div-cs-ai-result">
            <div className="div-cs-ai-result-bar">
              <strong>{aiTargetLabel}</strong>
              <button type="button" className="div-advisor-text-button" onClick={() => setAiOutput(null)}>
                {t('div_cs_ai_collapse')}
              </button>
            </div>
            {aiOutput.modelMarkdown && (
              <div className="div-cs-ai-block is-model">
                <span className="div-cs-ai-chip">{t('div_cs_ai_model_badge')}</span>
                <DividendAdvisorMarkdown language={i18n.language}>{aiOutput.modelMarkdown}</DividendAdvisorMarkdown>
              </div>
            )}
            <div className="div-cs-ai-block is-local">
              <span className="div-cs-ai-chip">{t('div_cs_ai_local_badge')}</span>
              <DividendAdvisorMarkdown language={i18n.language}>{aiOutput.localMarkdown}</DividendAdvisorMarkdown>
            </div>
          </div>
        )}
      </section>

      {data.strategy === 'funds' ? (
        <DividendFundHomePlan
          plan={data.fundPlan}
          checks={checks.funds}
          amountVisible={amountVisible}
          asOf={today}
          collapsedCodes={collapsedCodes}
          onToggle={toggleFundCollapse}
          readFilter="all"
          search={search}
          onEdit={() => void openFundPlan()}
        />
      ) : (
        <>
          {/* Quick Action & Tax Toolbar */}
          <section className="div-cs-toolbar">
            <div className="div-cs-tax-selector">
              <label htmlFor="div-cs-tax-select">{t('div_cs_tax_label')}</label>
              <select
                id="div-cs-tax-select"
                value={taxBps}
                onChange={e => void changeTaxRate(Number(e.target.value) as ClassicTaxRateBps)}
              >
                <option value={0}>{t('div_cs_tax_0')}</option>
                <option value={1000}>{t('div_cs_tax_1000')}</option>
                <option value={2000}>{t('div_cs_tax_2000')}</option>
              </select>
            </div>
            <div className="div-cs-toolbar-btns">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(progress)}
                onClick={() => {
                  setIsNew(true);
                  setEditor({
                    code: '',
                    name: '',
                    group: 'watch',
                    weightBps: 0,
                    shareMode: 'linked',
                    manualShares: 0,
                    lotSize: 100,
                  });
                }}
              >
                {t('div_cs_toolbar_add')}
              </button>
              {untracked.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(progress)}
                  onClick={() => setLinkedPickerOpen(true)}
                >
                  {t('div_cs_toolbar_linked', { count: untracked.length })}
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(progress)}
                onClick={() => setImportOpen(true)}
              >
                {t('div_cs_toolbar_import')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(progress)}
                onClick={() => setBudgetPanelOpen(v => !v)}
              >
                {t('div_cs_toolbar_budget')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={gridApplying || Boolean(progress)}
                onClick={() => void saveAllClassicGrids()}
              >
                {t('div_cs_batch_apply_all')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(progress) || quotes.refreshing}
                onClick={() => {
                  void quotes.refresh(true);
                  void refresh(data.stocks.map(s => s.code));
                }}
              >
                {progress ? t('div_refresh_progress', progress) : t('div_cs_toolbar_refresh_all')}
              </button>
            </div>
          </section>

          {/* Stock Selector Section */}
          <section className="div-cs-selector-section" aria-labelledby="div-cs-selector-heading">
            <div className="div-cs-selector-header">
              <h2 id="div-cs-selector-heading">{t('div_cs_selector_title')}</h2>
              <input
                className="div-cs-search-input"
                aria-label={t('div_search')}
                placeholder={t('div_search')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="div-cs-filter-pills" role="tablist" aria-label={t('div_group')}>
              {(['all', 'triggered', 'held', 'core', 'watch', 'hidden'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={selectorFilter === f}
                  className={selectorFilter === f ? 'selected' : ''}
                  onClick={() => setSelectorFilter(f)}
                >
                  {t(`div_cs_filter_${f}`, { count: filterCounts[f] })}
                </button>
              ))}
            </div>

            <div className="div-cs-stock-chips" role="listbox" aria-label={t('div_cs_selector_title')}>
              {filteredPlans.map(plan => {
                const isSelected = plan.code === activeSelectedCode;
                const buyLv = plan.todayAction.triggeredBuyLevel;
                const sellLv = plan.todayAction.triggeredSellLevel;
                const gapPct =
                  plan.todayAction.nextBuyGapBps !== undefined
                    ? (plan.todayAction.nextBuyGapBps / 100).toFixed(1)
                    : undefined;
                const statusClass =
                  plan.buyPaused && buyLv > 0
                    ? 'is-paused'
                    : sellLv > 0 && plan.shares > 0
                      ? 'is-sell-triggered'
                      : buyLv > 0 && plan.todayAction.type === 'buy'
                        ? 'is-buy-triggered'
                        : buyLv > 0
                          ? 'is-covered'
                          : 'is-waiting';

                return (
                  <button
                    key={plan.code}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`div-cs-stock-chip ${statusClass}${isSelected ? ' is-selected' : ''}`}
                    onClick={() => setSelectedCode(plan.code)}
                  >
                    <div className="div-cs-chip-top">
                      <strong>{plan.name}</strong>
                      <small>{plan.code}</small>
                    </div>
                    <div className="div-cs-chip-mid">
                      <span className="div-cs-chip-price">
                        {plan.quotePriceMinor ? `¥${(plan.quotePriceMinor / 100).toFixed(2)}` : '—'}
                      </span>
                      <span className="div-cs-chip-yield">
                        {plan.currentNetYieldBps ? `${(plan.currentNetYieldBps / 100).toFixed(2)}%` : '—'}
                      </span>
                    </div>
                    <div className="div-cs-chip-badges">
                      {plan.buyPaused && buyLv > 0 ? (
                        <span className="div-cs-badge is-paused">{t('div_cs_badge_paused')}</span>
                      ) : sellLv > 0 && plan.shares > 0 ? (
                        <span className="div-cs-badge is-sell">{t('div_cs_badge_sell', { level: sellLv })}</span>
                      ) : buyLv > 0 && plan.todayAction.type === 'buy' ? (
                        <span className="div-cs-badge is-buy">{t('div_cs_badge_buy', { level: buyLv })}</span>
                      ) : buyLv > 0 ? (
                        <span className="div-cs-badge is-covered">{t('div_cs_badge_covered', { level: buyLv })}</span>
                      ) : gapPct !== undefined ? (
                        <span className="div-cs-badge is-wait">{t('div_cs_badge_wait', { gap: gapPct })}</span>
                      ) : null}
                      {plan.shares > 0 && (
                        <span className="div-cs-badge is-held">
                          {t('div_cs_badge_held', { shares: amountVisible ? numeric(plan.shares, 0) : '••' })}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {filteredPlans.length === 0 && <p className="div-muted">{t('div_empty')}</p>}
            </div>
          </section>

          {/* Selected Stock Detail Workbench */}
          {selectedPlan && selectedStock && (
            <section
              className="div-cs-workbench"
              ref={detailSectionRef}
              aria-labelledby="div-cs-workbench-title"
            >
              {/* Workbench Header */}
              <div className="div-cs-workbench-header">
                <div className="div-cs-workbench-title-group">
                  <div className="div-cs-title-row">
                    <h2 id="div-cs-workbench-title">{selectedPlan.name}</h2>
                    <span className="div-cs-code-pill">{selectedPlan.code}</span>
                    <span className="div-cs-sector-pill">{selectedPlan.sector}</span>
                    <span className="div-cs-tier-pill">{t(`div_cs_tier_${selectedPlan.base.tier}`)}</span>
                    <span className="div-cs-origin-pill">{t(`div_cs_origin_${selectedPlan.gridOrigin}`)}</span>
                  </div>
                  <div className="div-cs-group-inline">
                    <label>
                      {t('div_group')}:
                      <select
                        value={selectedStock.group}
                        disabled={groupSaving}
                        onChange={e =>
                          void changeStockGroup(selectedStock.code, e.target.value as DividendStock['group'])
                        }
                      >
                        {(['core', 'watch', 'hidden'] as const).map(g => (
                          <option key={g} value={g}>
                            {t(`div_group_${g}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="div-cs-workbench-actions">
                  {(selectedPlan.gridOrigin === 'classic_auto' || selectedPlan.hasCustomPriceDiff) && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={gridApplying}
                      onClick={() => void saveSingleClassicGrid(selectedPlan.code)}
                    >
                      {t(
                        selectedPlan.hasCustomPriceDiff
                          ? 'div_cs_Sync_classic_btn'
                          : 'div_cs_apply_classic_btn',
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setIsNew(false);
                      setEditor(selectedStock);
                    }}
                  >
                    {t('div_cs_edit_stock_btn')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={Boolean(progress) || quotes.refreshing}
                    onClick={() => void refresh([selectedStock.code])}
                  >
                    {t('div_cs_refresh_single_btn')}
                  </button>
                </div>
              </div>

              {/* Today's Trigger Conclusion Banner */}
              <div className={`div-cs-action-banner is-${selectedPlan.todayAction.type}`}>
                <div className="div-cs-action-banner-main">
                  <strong>
                    {i18n.language.startsWith('zh')
                      ? selectedPlan.todayAction.headlineZh
                      : selectedPlan.todayAction.headlineEn}
                  </strong>
                  <p>
                    {i18n.language.startsWith('zh')
                      ? selectedPlan.todayAction.detailZh
                      : selectedPlan.todayAction.detailEn}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={aiBusy}
                  onClick={() => void askAiToday({ targetCode: selectedPlan.code })}
                >
                  🎯 {t('div_cs_ai_btn_selected', { name: selectedPlan.name })}
                </button>
              </div>

              {/* 6 Key Metrics Strip */}
              <div className="div-cs-metrics-grid">
                <div className="div-cs-metric-box">
                  <span>{t('div_cs_detail_quote')}</span>
                  <strong>
                    {selectedPlan.quotePriceMinor
                      ? `¥${(selectedPlan.quotePriceMinor / 100).toFixed(2)}`
                      : '—'}
                  </strong>
                  <small>
                    {selectedPlan.quoteChangePercent !== undefined && (
                      <span
                        className={
                          selectedPlan.quoteChangePercent > 0
                            ? 'is-up'
                            : selectedPlan.quoteChangePercent < 0
                              ? 'is-down'
                              : ''
                        }
                      >
                        {selectedPlan.quoteChangePercent > 0 ? '+' : ''}
                        {selectedPlan.quoteChangePercent.toFixed(2)}% ·{' '}
                      </span>
                    )}
                    {selectedPlan.quoteDate ?? '—'}
                  </small>
                </div>

                <div className="div-cs-metric-box">
                  <span>{t('div_cs_detail_yield')}</span>
                  <strong className="is-accent">
                    {selectedPlan.currentNetYieldBps
                      ? `${(selectedPlan.currentNetYieldBps / 100).toFixed(2)}%`
                      : '—'}
                  </strong>
                  <small>
                    {t('div_cs_detail_pretax_yield', {
                      yield: selectedPlan.currentGrossYieldBps
                        ? (selectedPlan.currentGrossYieldBps / 100).toFixed(2)
                        : '—',
                    })}
                  </small>
                </div>

                <div className="div-cs-metric-box">
                  <span>{t('div_cs_detail_anchor')}</span>
                  <strong>¥{(selectedPlan.neutralPriceMinor / 100).toFixed(2)}</strong>
                  <small>
                    {t('div_cs_detail_anchor_sub', {
                      price: (selectedPlan.grossNeutralPriceMinor / 100).toFixed(2),
                    })}
                  </small>
                </div>

                <div className="div-cs-metric-box">
                  <span>{t('div_cs_detail_dps')}</span>
                  <strong>¥{(selectedPlan.base.grossDpsMicros / 1e6).toFixed(4)}</strong>
                  <small>
                    {t('div_cs_detail_dps_sub', {
                      net: (selectedPlan.base.netDpsMicros / 1e6).toFixed(4),
                      period: selectedPlan.base.periodLabel,
                    })}
                  </small>
                </div>

                <div className="div-cs-metric-box">
                  <span>{t('div_cs_detail_holding')}</span>
                  <strong>{quantity(selectedPlan.shares)}</strong>
                  <small>
                    {selectedStock.shareMode === 'manual'
                      ? t('div_manual')
                      : data.positions
                          .get(selectedStock.code)
                          ?.sources.map(s => `${s.accountName} ${quantity(s.shares)}`)
                          .join(' · ') || t('div_no_link')}
                  </small>
                </div>

                <div className="div-cs-metric-box">
                  <span>
                    {t('div_cs_detail_budget', { weight: numeric(selectedPlan.weightBps / 100) })}
                  </span>
                  <strong>
                    {selectedPlan.budgetMinor !== undefined ? money(selectedPlan.budgetMinor) : '—'}
                  </strong>
                  <small>
                    {holdingForecast?.amountMinor !== undefined && selectedPlan.shares > 0
                      ? `${t('div_v2_holding_forecast')} ${money(holdingForecast.amountMinor)}`
                      : latestReport?.dpsMicros !== undefined
                        ? `${t('div_v2_latest_report_dividend')} ¥${(latestReport.dpsMicros / 1e6).toFixed(4)}`
                        : `${selectedPlan.lotSize} ${t('div_one_share')}/lot`}
                  </small>
                </div>
              </div>

              {/* Visual Price Ladder Ruler */}
              <div className="div-cs-ruler-card">
                <div className="div-cs-ruler-header">
                  <span>{t('div_cs_ladder_ruler_title')}</span>
                  <small>
                    {t('div_cs_buy_tier_name', { level: 4 })} ¥
                    {((selectedPlan.buyRows.at(-1)?.priceMinor ?? 0) / 100).toFixed(2)} ←{' '}
                    {t('div_cs_ladder_neutral')} ¥{(selectedPlan.neutralPriceMinor / 100).toFixed(2)} →{' '}
                    {t('div_cs_sell_tier_name', { level: 4 })} ¥
                    {((selectedPlan.sellRows.at(-1)?.priceMinor ?? 0) / 100).toFixed(2)}
                  </small>
                </div>
                <div className="div-cs-ruler-track">
                  <div className="div-cs-ruler-zone is-buy-zone">{t('div_cs_ladder_buy_zone')}</div>
                  <div className="div-cs-ruler-zone is-neutral-zone">{t('div_cs_ladder_neutral')}</div>
                  <div className="div-cs-ruler-zone is-sell-zone">{t('div_cs_ladder_sell_zone')}</div>
                  {selectedPlan.quotePriceMinor && (
                    <div
                      className="div-cs-ruler-pin"
                      style={{ insetInlineStart: `${rulerPositionPct}%` }}
                    >
                      <span>¥{(selectedPlan.quotePriceMinor / 100).toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="div-cs-ruler-stops">
                  {[...selectedPlan.buyRows].reverse().map(r => (
                    <span key={`b-${r.level}`} className={r.touched ? 'is-active-buy' : ''}>
                      B{r.level} ¥{(r.priceMinor / 100).toFixed(2)}
                    </span>
                  ))}
                  <span className="is-anchor">5% ¥{(selectedPlan.neutralPriceMinor / 100).toFixed(2)}</span>
                  {selectedPlan.sellRows.map(r => (
                    <span key={`s-${r.level}`} className={r.touched ? 'is-active-sell' : ''}>
                      S{r.level} ¥{(r.priceMinor / 100).toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>

              {/* 4-Buy & 4-Sell Grid Tables */}
              <div className="div-cs-tables-grid">
                {/* Buy Ladder Table */}
                <div className="div-cs-table-card is-buy-card">
                  <h3>{t('div_cs_buy_table_title')}</h3>
                  <div className="div-table-scroll">
                    <table className="div-cs-grid-table">
                      <thead>
                        <tr>
                          <th>{t('div_cs_col_tier')}</th>
                          <th>{t('div_cs_col_yield')}</th>
                          <th>{t('div_cs_col_trigger_price')}</th>
                          <th>{t('div_cs_col_gross_price')}</th>
                          <th>{t('div_cs_col_gap')}</th>
                          <th>{t('div_cs_col_shares')}</th>
                          <th>{t('div_cs_col_status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPlan.buyRows.map(row => (
                          <tr key={row.level} className={row.touched ? 'is-triggered-buy' : ''}>
                            <th scope="row">{t('div_cs_buy_tier_name', { level: row.level })}</th>
                            <td>{(row.yieldBps / 100).toFixed(2)}%</td>
                            <td className="div-cs-price-cell">
                              <strong>¥{(row.priceMinor / 100).toFixed(2)}</strong>
                            </td>
                            <td className="div-muted">¥{(row.grossPriceMinor / 100).toFixed(2)}</td>
                            <td className={row.touched ? 'is-up' : ''}>
                              {row.gapFromQuoteBps === undefined
                                ? '—'
                                : `${row.gapFromQuoteBps > 0 ? '+' : ''}${(row.gapFromQuoteBps / 100).toFixed(2)}%`}
                            </td>
                            <td>
                              {row.targetShares !== undefined
                                ? t('div_cs_shares_buy_format', {
                                    target: quantity(row.targetShares),
                                    add: quantity(row.incrementalShares ?? 0),
                                  })
                                : t('div_cs_shares_portion_only', {
                                    pct: numeric(row.cumulativePortionBps / 100),
                                  })}
                            </td>
                            <td>
                              <span className={`div-cs-status-pill is-${row.status}`}>
                                {t(
                                  row.status === 'triggered'
                                    ? 'div_cs_row_triggered_buy'
                                    : `div_cs_row_${row.status}`,
                                )}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Sell Ladder Table */}
                <div className="div-cs-table-card is-sell-card">
                  <h3>{t('div_cs_sell_table_title')}</h3>
                  <div className="div-table-scroll">
                    <table className="div-cs-grid-table">
                      <thead>
                        <tr>
                          <th>{t('div_cs_col_tier')}</th>
                          <th>{t('div_cs_col_yield')}</th>
                          <th>{t('div_cs_col_trigger_price')}</th>
                          <th>{t('div_cs_col_gross_price')}</th>
                          <th>{t('div_cs_col_gap')}</th>
                          <th>{t('div_cs_col_shares')}</th>
                          <th>{t('div_cs_col_status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPlan.sellRows.map(row => (
                          <tr key={row.level} className={row.touched ? 'is-triggered-sell' : ''}>
                            <th scope="row">{t('div_cs_sell_tier_name', { level: row.level })}</th>
                            <td>{(row.yieldBps / 100).toFixed(2)}%</td>
                            <td className="div-cs-price-cell">
                              <strong>¥{(row.priceMinor / 100).toFixed(2)}</strong>
                            </td>
                            <td className="div-muted">¥{(row.grossPriceMinor / 100).toFixed(2)}</td>
                            <td className={row.touched ? 'is-down' : ''}>
                              {row.gapFromQuoteBps === undefined
                                ? '—'
                                : `${row.gapFromQuoteBps > 0 ? '+' : ''}${(row.gapFromQuoteBps / 100).toFixed(2)}%`}
                            </td>
                            <td>
                              {row.sellShares !== undefined
                                ? t('div_cs_shares_sell_format', {
                                    sell: quantity(row.sellShares),
                                    pct: numeric(row.cumulativePortionBps / 100),
                                  })
                                : t('div_cs_shares_portion_only', {
                                    pct: numeric(row.cumulativePortionBps / 100),
                                  })}
                            </td>
                            <td>
                              <span className={`div-cs-status-pill is-${row.status}`}>
                                {t(
                                  row.status === 'triggered'
                                    ? 'div_cs_row_triggered_sell'
                                    : `div_cs_row_${row.status}`,
                                )}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 3-Item Classic Health & Auto-Fallback Check Strip */}
              <div className="div-cs-health-grid">
                {selectedPlan.healthChecks.map(h => (
                  <div key={h.key} className={`div-cs-health-item is-${h.status}`}>
                    <strong>{i18n.language.startsWith('zh') ? h.labelZh : h.labelEn}</strong>
                    <p>{i18n.language.startsWith('zh') ? h.detailZh : h.detailEn}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Classic Dividend Strategy & Auto Missing-Data Rules Explanation Card */}
          <details className="div-cs-method-card">
            <summary>{t('div_cs_method_card_title')}</summary>
            <div className="div-cs-method-body">
              <div>
                <h4>{t('div_cs_method_rule_1_title')}</h4>
                <p>{t('div_cs_method_rule_1_body')}</p>
              </div>
              <div>
                <h4>{t('div_cs_method_rule_2_title')}</h4>
                <p>{t('div_cs_method_rule_2_body')}</p>
              </div>
              <div>
                <h4>{t('div_cs_method_rule_3_title')}</h4>
                <p>{t('div_cs_method_rule_3_body')}</p>
              </div>
            </div>
          </details>
        </>
      )}

      {/* Secondary Deep AI Workspace & History Drawer */}
      <details className="div-cs-advanced-ai">
        <summary>{t('div_cs_ai_deep_btn')}</summary>
        <DividendAdvisor
          onUpdated={load}
          amountVisible={amountVisible}
          planManagement={planManagement}
          planKey={dailyPlanKey}
          openPlanRequest={openPlanRequest}
          onOpenCheckItem={openCheckItem}
        />
      </details>
    </div>
  );
}

function LinkedStockPicker({
  positions,
  amountVisible,
  onClose,
  onSaved,
}: {
  positions: LinkedDividendPosition[];
  amountVisible: boolean;
  onClose: () => void;
  onSaved: (count: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
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
      await onSaved(await addLinkedDividendStocks(selectedCodes));
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
  onSaved: (action?: 'deleted' | 'redistributed') => Promise<void>;
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
      await saveDividendStock(
        {
          ...stock,
          code,
          name: stock.name.trim(),
          manualDpsMicros: dps === '' ? undefined : Math.round(Number(dps) * 1e6),
        },
        isNew ? { expectNew: true } : { expectedFingerprint: openedFingerprint },
      );
      await onSaved();
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
        </div>
        <p className="div-muted">{t('div_v2_manual_grid_note')}</p>
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
          <label className="div-linked-all">
            <input
              type="checkbox"
              checked={stock.buyPaused ?? false}
              onChange={e => patch({ buyPaused: e.target.checked })}
            />
            {t('div_buy_paused')}
          </label>
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
            <p className="div-muted">{t(redistribute ? 'div_redistribute_note' : 'div_delete_keep_unused')}</p>
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
        {oldTotal > 0 && t('div_allocation_formula', { before: numeric(oldTotal / 100), after: numeric(newTotal / 100) })}
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
            {fundedDividendStocks(after, budgetMinor).map(stock => (
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
  stocks,
  budgetMinor,
  amountVisible,
  onClose,
  onSaved,
}: {
  stocks: DividendStock[];
  budgetMinor: number;
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
  const apply = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await allocateDividendBudget();
      await onSaved();
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
      aria-labelledby="div-allocation-title"
      onCancel={e => {
        if (saving) e.preventDefault();
        else onClose();
      }}
    >
      <div className="div-stock-heading">
        <h2 id="div-allocation-title">{t('div_allocate_unused')}</h2>
        <button className="btn btn-secondary" disabled={saving} onClick={onClose}>
          {t('close')}
        </button>
      </div>
      <p className="div-muted">{t('div_allocate_unused_note')}</p>
      <AllocationPreview
        before={stocks}
        after={scaleDividendWeights(stocks)}
        budgetMinor={budgetMinor}
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
