import { forecastHoldingYearDividends, stockBudgetMinor, type DividendAnnouncement, type DividendStock, type GridLevel } from './dividendWorkbench.ts';
import type { DividendLedger } from './dividendLedger.ts';

export const CLASSIC_BUY_YIELD_LADDER = [550, 575, 600, 650] as const;
export const CLASSIC_SELL_YIELD_LADDER = [480, 450, 420, 400] as const;
export const CLASSIC_NEUTRAL_YIELD_BPS = 500;
export const CLASSIC_TIER_PORTION_BPS = 2500;

export type ClassicTaxRateBps = 0 | 1000 | 2000;
export type ClassicDividendBaseTier = 'manual' | 'implemented_cycle' | 'announced_forecast' | 'baseline_fallback';
export type ClassicGridOrigin = 'custom_saved' | 'classic_saved' | 'classic_auto';
export type ClassicQuoteSource = 'live' | 'cached' | 'baseline_reference' | 'missing';

export interface ClassicStockBaseline {
  code: string;
  name: string;
  dpsMicros: number;
  periodLabel: string;
  referencePriceMinor: number;
  sector: string;
}

/**
 * Industry-verified baseline annual cash dividends (CNY micros per share) for mainstream
 * A-share dividend stocks, used as a zero-latency / offline fallback before live Eastmoney
 * disclosure refresh completes, so calculation is never blocked by missing network data.
 */
export const CLASSIC_STOCK_BASELINES: Record<string, ClassicStockBaseline> = {
  '601398': { code: '601398', name: '工商银行', dpsMicros: 308000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 615, sector: '银行' },
  '600036': { code: '600036', name: '招商银行', dpsMicros: 2000000, periodLabel: '年度常规分红基准', referencePriceMinor: 3850, sector: '银行' },
  '601088': { code: '601088', name: '中国神华', dpsMicros: 2260000, periodLabel: '年度常规分红基准', referencePriceMinor: 3980, sector: '煤炭能源' },
  '000651': { code: '000651', name: '格力电器', dpsMicros: 3000000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 4350, sector: '家电制造' },
  '601166': { code: '601166', name: '兴业银行', dpsMicros: 1060000, periodLabel: '年度常规分红基准', referencePriceMinor: 1920, sector: '银行' },
  '600011': { code: '600011', name: '华能国际', dpsMicros: 270000, periodLabel: '年度常规分红基准', referencePriceMinor: 710, sector: '电力公用' },
  '600690': { code: '600690', name: '海尔智家', dpsMicros: 965000, periodLabel: '年度常规分红基准', referencePriceMinor: 2780, sector: '家电制造' },
  '000333': { code: '000333', name: '美的集团', dpsMicros: 3000000, periodLabel: '年度常规分红基准', referencePriceMinor: 6850, sector: '家电制造' },
  '000001': { code: '000001', name: '平安银行', dpsMicros: 609000, periodLabel: '2025年报+2026中报基准', referencePriceMinor: 1120, sector: '银行' },
  '000543': { code: '000543', name: '皖能电力', dpsMicros: 310000, periodLabel: '年度常规分红基准', referencePriceMinor: 760, sector: '电力公用' },
  '601318': { code: '601318', name: '中国平安', dpsMicros: 2550000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 5120, sector: '保险金融' },
  '000538': { code: '000538', name: '云南白药', dpsMicros: 2077000, periodLabel: '年度+特别常规化分红基准', referencePriceMinor: 5650, sector: '医药消费' },
  '000423': { code: '000423', name: '东阿阿胶', dpsMicros: 2415000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 5580, sector: '医药消费' },
  '002032': { code: '002032', name: '苏泊尔', dpsMicros: 2810000, periodLabel: '年度常规分红基准', referencePriceMinor: 5260, sector: '家电制造' },
  '600900': { code: '600900', name: '长江电力', dpsMicros: 943000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 2820, sector: '水电公用' },
  '601939': { code: '601939', name: '建设银行', dpsMicros: 403000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 810, sector: '银行' },
  '601288': { code: '601288', name: '农业银行', dpsMicros: 241800, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 495, sector: '银行' },
  '601225': { code: '601225', name: '陕西煤业', dpsMicros: 1420000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 2350, sector: '煤炭能源' },
  '600941': { code: '600941', name: '中国移动', dpsMicros: 4670000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 10350, sector: '通信运营' },
  '601988': { code: '601988', name: '中国银行', dpsMicros: 236400, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 490, sector: '银行' },
  '601328': { code: '601328', name: '交通银行', dpsMicros: 375000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 730, sector: '银行' },
  '601658': { code: '601658', name: '邮储银行', dpsMicros: 261000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 520, sector: '银行' },
  '600028': { code: '600028', name: '中国石化', dpsMicros: 345000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 640, sector: '石油化工' },
  '601857': { code: '601857', name: '中国石油', dpsMicros: 470000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 840, sector: '石油化工' },
  '601006': { code: '601006', name: '大秦铁路', dpsMicros: 440000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 660, sector: '铁路交运' },
  '600377': { code: '600377', name: '宁沪高速', dpsMicros: 490000, periodLabel: '年度常规分红基准', referencePriceMinor: 1320, sector: '高速交运' },
  '600019': { code: '600019', name: '宝钢股份', dpsMicros: 310000, periodLabel: '年度+中期常规分红基准', referencePriceMinor: 670, sector: '钢铁制造' },
  '600585': { code: '600585', name: '海螺水泥', dpsMicros: 960000, periodLabel: '年度常规分红基准', referencePriceMinor: 2450, sector: '建材制造' },
};

export interface ClassicDividendBatchItem {
  reportDate: string;
  period: 'Q1' | 'H1' | 'Q3' | 'FY' | 'other';
  dpsMicros: number;
  stage: 'implemented' | 'proposal' | 'approved' | 'baseline';
  exDate?: string;
}

export interface ClassicDividendBase {
  grossDpsMicros: number;
  netDpsMicros: number;
  taxBps: ClassicTaxRateBps;
  tier: ClassicDividendBaseTier;
  frequency: 'semiannual' | 'quarterly' | 'annual' | 'manual' | 'baseline';
  periodLabel: string;
  strategyNoteZh: string;
  strategyNoteEn: string;
  fallbackApplied: boolean;
  batches: ClassicDividendBatchItem[];
}

export interface ClassicGridTierRow {
  level: number;
  side: 'buy' | 'sell';
  yieldBps: number;
  portionBps: number;
  cumulativePortionBps: number;
  grossPriceMinor: number;
  priceMinor: number;
  classicPriceMinor: number;
  gapFromQuoteBps?: number;
  targetShares?: number;
  incrementalShares?: number;
  sellShares?: number;
  touched: boolean;
  status: 'triggered' | 'covered' | 'below_lot' | 'no_holding' | 'waiting' | 'quote_pending';
}

export interface ClassicTodayAction {
  type: 'buy' | 'sell' | 'hold_covered' | 'paused' | 'wait';
  triggeredBuyLevel: number;
  triggeredSellLevel: number;
  suggestedShares: number;
  suggestedAmountMinor?: number;
  nextBuyPriceMinor?: number;
  nextBuyGapBps?: number;
  nextSellPriceMinor?: number;
  nextSellGapBps?: number;
  headlineZh: string;
  headlineEn: string;
  detailZh: string;
  detailEn: string;
}

export interface ClassicHealthCheck {
  key: 'yield_zone' | 'dividend_base' | 'position_discipline';
  status: 'good' | 'neutral' | 'caution';
  labelZh: string;
  labelEn: string;
  detailZh: string;
  detailEn: string;
}

export interface ClassicStockPlan {
  code: string;
  name: string;
  group: DividendStock['group'];
  sector: string;
  shares: number;
  lotSize: number;
  weightBps: number;
  budgetMinor?: number;
  buyPaused: boolean;
  quotePriceMinor?: number;
  quoteChangePercent?: number;
  quoteDate?: string;
  quoteSource: ClassicQuoteSource;
  currentGrossYieldBps?: number;
  currentNetYieldBps?: number;
  neutralPriceMinor: number;
  grossNeutralPriceMinor: number;
  base: ClassicDividendBase;
  gridOrigin: ClassicGridOrigin;
  hasCustomPriceDiff: boolean;
  buyRows: ClassicGridTierRow[];
  sellRows: ClassicGridTierRow[];
  classicBuyLevels: GridLevel[];
  classicSellLevels: GridLevel[];
  todayAction: ClassicTodayAction;
  healthChecks: ClassicHealthCheck[];
}

function applyTaxMicros(grossDpsMicros: number, taxBps: ClassicTaxRateBps): number {
  return Math.max(1, Number((BigInt(Math.max(1, Math.round(grossDpsMicros))) * BigInt(10000 - taxBps)) / 10000n));
}

function buyPriceForYield(dpsMicros: number, yieldBps: number): number {
  return Math.max(1, Math.floor(dpsMicros / yieldBps));
}

function sellPriceForYield(dpsMicros: number, yieldBps: number): number {
  return Math.max(1, Number((BigInt(Math.max(1, Math.round(dpsMicros))) + BigInt(yieldBps) - 1n) / BigInt(yieldBps)));
}

function periodShortLabel(reportDate: string, period: ClassicDividendBatchItem['period']): string {
  const year = reportDate.slice(0, 4);
  if (period === 'FY') return `${year}年报`;
  if (period === 'H1') return `${year}中报`;
  if (period === 'Q1') return `${year}一季报`;
  if (period === 'Q3') return `${year}三季报`;
  return reportDate;
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.abs(ta - tb) / 86400000 : Infinity;
}

/**
 * Combines the most recent full-year regular dividend cycle from structured announcements:
 * - Takes the latest regular dividend event as anchor.
 * - Includes any other distinct season (e.g. H1 + FY, or Q1/H1/Q3/FY) within 360 days of that report date,
 *   never double-counting the same season (e.g. never adding two FY dividends from two different years).
 */
function selectFullYearCycle(items: DividendAnnouncement[]): ClassicDividendBatchItem[] {
  const valid = items
    .filter(item => !item.nonRecurring && !['cancelled', 'none'].includes(item.stage) && (item.dpsMicros ?? 0) > 0)
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.announcedAt.localeCompare(a.announcedAt));
  if (!valid.length) return [];
  const newestReport = valid[0].reportDate;
  const seenSeasons = new Set<string>();
  const selected: ClassicDividendBatchItem[] = [];
  for (const item of valid) {
    if (daysBetween(newestReport, item.reportDate) > 360) continue;
    const seasonKey = item.period === 'other' ? item.reportDate : item.period;
    if (seenSeasons.has(seasonKey)) continue;
    seenSeasons.add(seasonKey);
    selected.push({
      reportDate: item.reportDate,
      period: item.period,
      dpsMicros: item.dpsMicros!,
      stage: item.stage === 'implemented' ? 'implemented' : item.stage === 'approved' ? 'approved' : 'proposal',
      exDate: item.exDate,
    });
  }
  return selected.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/**
 * 4-Tier Industry-Classic Dividend Base Resolution:
 * Tier 1: Manual user override (`manualDpsMicros`)
 * Tier 2: Latest implemented full-year dividend cycle from Eastmoney structured data / ledger
 * Tier 3: Announced dividend proposals + seasonal holding-year forecast fallback
 * Tier 4: Built-in A-share blue-chip dividend baseline or 5% benchmark yield fallback
 */
export function resolveClassicDividendBase(
  stock: DividendStock,
  options: { asOf?: string; taxBps?: ClassicTaxRateBps; ledger?: DividendLedger } = {},
): ClassicDividendBase {
  const taxBps: ClassicTaxRateBps = options.taxBps ?? 1000;
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);

  // Tier 1: Explicit user manual annual DPS
  if (typeof stock.manualDpsMicros === 'number' && Number.isSafeInteger(stock.manualDpsMicros) && stock.manualDpsMicros > 0) {
    const gross = stock.manualDpsMicros;
    return {
      grossDpsMicros: gross,
      netDpsMicros: applyTaxMicros(gross, taxBps),
      taxBps,
      tier: 'manual',
      frequency: 'manual',
      periodLabel: '手动设定年度分红',
      strategyNoteZh: '采用您手动指定的年度每股分红基数计算四买四卖网格。',
      strategyNoteEn: 'Calculated from your manually specified annual DPS.',
      fallbackApplied: false,
      batches: [{ reportDate: asOf, period: 'FY', dpsMicros: gross, stage: 'implemented' }],
    };
  }

  // Tier 2A: Structured Eastmoney announcements (implemented cycle)
  const announcements = stock.dividend?.announcements ?? [];
  const implementedAnnouncements = announcements.filter(item => item.stage === 'implemented' && (!item.exDate || item.exDate <= asOf));
  const implementedCycle = selectFullYearCycle(implementedAnnouncements);
  if (implementedCycle.length > 0) {
    const gross = implementedCycle.reduce((sum, item) => sum + item.dpsMicros, 0);
    const freq = implementedCycle.length >= 3 ? 'quarterly' : implementedCycle.some(b => b.period === 'H1') ? 'semiannual' : 'annual';
    const periodLabel = implementedCycle.map(b => periodShortLabel(b.reportDate, b.period)).join(' + ');
    return {
      grossDpsMicros: gross,
      netDpsMicros: applyTaxMicros(gross, taxBps),
      taxBps,
      tier: 'implemented_cycle',
      frequency: freq,
      periodLabel,
      strategyNoteZh: `已按东方财富披露的最新已实施常规分红（${periodLabel}）自动合并计算，送转除权自动折算，无需人工复核PDF。`,
      strategyNoteEn: `Automatically computed from latest implemented regular dividends (${periodLabel}).`,
      fallbackApplied: false,
      batches: implementedCycle,
    };
  }

  // Tier 2B: Ledger events (if passed from research cache)
  if (options.ledger?.events?.length) {
    const ledgerAnnouncements: DividendAnnouncement[] = options.ledger.events
      .filter(e => e.implemented && (e.cashPer10Micros ?? 0) > 0 && e.period !== 'special')
      .map(e => ({
        reportDate: e.reportDate ?? asOf,
        period: e.period === 'interim' ? 'H1' : e.period === 'quarterly' ? 'Q3' : 'FY',
        dpsMicros: e.normalizedDpsMicros ?? Math.round((e.cashPer10Micros ?? 0) / 10 / (e.shareFactor && e.shareFactor > 0 ? e.shareFactor : 1)),
        announcedAt: e.announcementDate ?? asOf,
        stage: 'implemented',
        status: '实施',
        sourceUrl: e.sources[0]?.url ?? '',
        exDate: e.exDate,
      }));
    const ledgerCycle = selectFullYearCycle(ledgerAnnouncements);
    if (ledgerCycle.length > 0) {
      const gross = ledgerCycle.reduce((sum, item) => sum + item.dpsMicros, 0);
      const freq = ledgerCycle.some(b => b.period === 'H1') ? 'semiannual' : 'annual';
      const periodLabel = ledgerCycle.map(b => periodShortLabel(b.reportDate, b.period)).join(' + ');
      return {
        grossDpsMicros: gross,
        netDpsMicros: applyTaxMicros(gross, taxBps),
        taxBps,
        tier: 'implemented_cycle',
        frequency: freq,
        periodLabel,
        strategyNoteZh: `已按分红台账最新完整周期（${periodLabel}）自动折算当前股本分红基数。`,
        strategyNoteEn: `Computed from distribution ledger cycle (${periodLabel}).`,
        fallbackApplied: false,
        batches: ledgerCycle,
      };
    }
  }

  // Tier 2C: Legacy TTM payments array on stock.dividend
  if (stock.dividend && stock.dividend.dpsMicros > 0 && stock.dividend.payments?.length) {
    const gross = stock.dividend.dpsMicros;
    const periods = stock.dividend.payments.map(p => (p.reportDate ?? p.exDate ?? '').slice(0, 7)).filter(Boolean).join(' + ');
    return {
      grossDpsMicros: gross,
      netDpsMicros: applyTaxMicros(gross, taxBps),
      taxBps,
      tier: 'implemented_cycle',
      frequency: stock.dividend.payments.length >= 2 ? 'semiannual' : 'annual',
      periodLabel: periods || '近12个月已实施分红',
      strategyNoteZh: '已按过去12个月已实施现金分红（TTM）自动计算网格价格。',
      strategyNoteEn: 'Computed from trailing 12-month implemented cash dividends.',
      fallbackApplied: false,
      batches: stock.dividend.payments.map(p => {
        const rep = p.reportDate ?? p.exDate ?? asOf;
        return {
          reportDate: rep,
          period: rep.endsWith('-06-30') ? 'H1' : 'FY',
          dpsMicros: p.dpsMicros,
          stage: 'implemented',
          exDate: p.exDate,
        };
      }),
    };
  }

  // Tier 3: Announced proposals + seasonal forecast fallback
  const allWithProposals = selectFullYearCycle(announcements);
  if (allWithProposals.length > 0) {
    const gross = allWithProposals.reduce((sum, item) => sum + item.dpsMicros, 0);
    const periodLabel = allWithProposals.map(b => `${periodShortLabel(b.reportDate, b.period)}${b.stage !== 'implemented' ? '(预案)' : ''}`).join(' + ');
    return {
      grossDpsMicros: gross,
      netDpsMicros: applyTaxMicros(gross, taxBps),
      taxBps,
      tier: 'announced_forecast',
      frequency: allWithProposals.some(b => b.period === 'H1') ? 'semiannual' : 'annual',
      periodLabel,
      strategyNoteZh: `当前处于分红实施过渡期，已自动采用最新披露分红方案（${periodLabel}）兜底计算。`,
      strategyNoteEn: `Automatically using latest disclosed dividend proposal (${periodLabel}).`,
      fallbackApplied: true,
      batches: allWithProposals,
    };
  }

  try {
    const forecast = forecastHoldingYearDividends(stock, asOf, 1);
    if (forecast.dpsMicros && forecast.dpsMicros > 0) {
      const gross = forecast.dpsMicros;
      return {
        grossDpsMicros: gross,
        netDpsMicros: applyTaxMicros(gross, taxBps),
        taxBps,
        tier: 'announced_forecast',
        frequency: forecast.events.length >= 2 ? 'semiannual' : 'annual',
        periodLabel: '未来一年分红递推基准',
        strategyNoteZh: '近期已实施批次跨期，已自动按历史分红季节规律与预案递推全年分红基数。',
        strategyNoteEn: 'Automatically extrapolated from historical seasonal dividend cadence.',
        fallbackApplied: true,
        batches: forecast.events.map(e => ({
          reportDate: e.reportDate,
          period: e.reportDate.endsWith('-06-30') ? 'H1' : 'FY',
          dpsMicros: e.dpsMicros,
          stage: e.basis === 'announced' ? 'proposal' : 'implemented',
          exDate: e.expectedExDate,
        })),
      };
    }
  } catch {
    // Continue to Tier 4 baseline fallback
  }

  if (stock.dividend?.pending?.dpsMicros && stock.dividend.pending.dpsMicros > 0) {
    const gross = stock.dividend.pending.dpsMicros;
    return {
      grossDpsMicros: gross,
      netDpsMicros: applyTaxMicros(gross, taxBps),
      taxBps,
      tier: 'announced_forecast',
      frequency: 'annual',
      periodLabel: `${stock.dividend.pending.reportDate} 预案`,
      strategyNoteZh: '已自动采用最新待实施分红预案作为计算基数。',
      strategyNoteEn: 'Using latest pending dividend proposal as base.',
      fallbackApplied: true,
      batches: [{ reportDate: stock.dividend.pending.reportDate, period: 'FY', dpsMicros: gross, stage: 'proposal' }],
    };
  }

  // Tier 4: Built-in A-share blue-chip dividend baseline or 5.0% benchmark yield fallback
  const baseline = CLASSIC_STOCK_BASELINES[stock.code];
  if (baseline) {
    return {
      grossDpsMicros: baseline.dpsMicros,
      netDpsMicros: applyTaxMicros(baseline.dpsMicros, taxBps),
      taxBps,
      tier: 'baseline_fallback',
      frequency: baseline.periodLabel.includes('中期') ? 'semiannual' : 'annual',
      periodLabel: baseline.periodLabel,
      strategyNoteZh: `分红接口尚未刷新完成，已自动启用内置行业基准（${baseline.periodLabel} ¥${(baseline.dpsMicros / 1e6).toFixed(4)}/股）兜底，后台刷新后自动切换最新公告数据。`,
      strategyNoteEn: `Using built-in industry baseline (${baseline.periodLabel}) while live disclosure refreshes.`,
      fallbackApplied: true,
      batches: [{ reportDate: asOf, period: 'FY', dpsMicros: baseline.dpsMicros, stage: 'baseline' }],
    };
  }

  const impliedFromPrice = stock.quote?.priceMinor && stock.quote.priceMinor > 0
    ? Math.round(stock.quote.priceMinor * 10000 * 0.05)
    : 500000;
  return {
    grossDpsMicros: impliedFromPrice,
    netDpsMicros: applyTaxMicros(impliedFromPrice, taxBps),
    taxBps,
    tier: 'baseline_fallback',
    frequency: 'baseline',
    periodLabel: '5.0%基准股息率锚定',
    strategyNoteZh: '暂无该股历史分红缓存，已自动按经典 5.0% 基准股息率生成参考网格；点击“刷新行情与分红”即可拉取公告值。',
    strategyNoteEn: 'Generated from 5.0% benchmark yield fallback; refresh disclosures to update with official filings.',
    fallbackApplied: true,
    batches: [{ reportDate: asOf, period: 'FY', dpsMicros: impliedFromPrice, stage: 'baseline' }],
  };
}

/**
 * Builds the complete, ready-to-render Classic Dividend Grid Plan and live trigger analysis
 * for a stock. Never returns an empty or blocked grid.
 */
export function buildClassicStockPlan(
  stock: DividendStock,
  options: {
    totalBudgetMinor?: number;
    shares?: number;
    taxBps?: ClassicTaxRateBps;
    asOf?: string;
    ledger?: DividendLedger;
  } = {},
): ClassicStockPlan {
  const taxBps: ClassicTaxRateBps = options.taxBps ?? (stock.gridProvenance?.taxBps ?? 1000);
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const shares = options.shares ?? (stock.shareMode === 'manual' ? stock.manualShares : 0);
  const budgetMinor = options.totalBudgetMinor === undefined ? undefined : stockBudgetMinor(options.totalBudgetMinor, stock.weightBps);
  const base = resolveClassicDividendBase(stock, { asOf, taxBps, ledger: options.ledger });
  const baseline = CLASSIC_STOCK_BASELINES[stock.code];
  const sector = baseline?.sector ?? (/银行/.test(stock.name) ? '银行' : /电|水|能/.test(stock.name) ? '公用事业' : /煤|矿|油|化/.test(stock.name) ? '资源周期' : '红利价值');

  // Resolve quote with graceful fallback
  let quotePriceMinor: number | undefined;
  let quoteDate: string | undefined;
  let quoteChangePercent: number | undefined;
  let quoteSource: ClassicQuoteSource = 'missing';
  if (stock.quote && Number.isSafeInteger(stock.quote.priceMinor) && stock.quote.priceMinor > 0) {
    quotePriceMinor = stock.quote.priceMinor;
    quoteDate = stock.quote.date;
    quoteChangePercent = stock.quote.changePercent;
    const age = quoteDate ? daysBetween(asOf, quoteDate.slice(0, 10)) : 0;
    quoteSource = age <= 10 && stock.quoteFailedAt === undefined ? 'live' : 'cached';
  } else if (baseline?.referencePriceMinor) {
    quotePriceMinor = baseline.referencePriceMinor;
    quoteDate = '基准参考价';
    quoteSource = 'baseline_reference';
  }

  const grossNeutralPriceMinor = buyPriceForYield(base.grossDpsMicros, CLASSIC_NEUTRAL_YIELD_BPS);
  const neutralPriceMinor = buyPriceForYield(base.netDpsMicros, CLASSIC_NEUTRAL_YIELD_BPS);
  const currentGrossYieldBps = quotePriceMinor ? Math.round(base.grossDpsMicros / quotePriceMinor) : undefined;
  const currentNetYieldBps = quotePriceMinor ? Math.round(base.netDpsMicros / quotePriceMinor) : undefined;

  const classicBuyLevels: GridLevel[] = CLASSIC_BUY_YIELD_LADDER.map(yieldBps => ({
    yieldBps,
    portionBps: CLASSIC_TIER_PORTION_BPS,
    priceMinor: buyPriceForYield(base.netDpsMicros, yieldBps),
  }));
  const classicSellLevels: GridLevel[] = CLASSIC_SELL_YIELD_LADDER.map(yieldBps => ({
    yieldBps,
    portionBps: CLASSIC_TIER_PORTION_BPS,
    priceMinor: sellPriceForYield(base.netDpsMicros, yieldBps),
  }));

  const hasSavedBuy = Array.isArray(stock.buyLevels) && stock.buyLevels.length > 0 && stock.buyLevels.every(l => l.priceMinor && l.priceMinor > 0);
  const hasSavedSell = Array.isArray(stock.sellLevels) && stock.sellLevels.length > 0 && stock.sellLevels.every(l => l.priceMinor && l.priceMinor > 0);
  const useSaved = hasSavedBuy && hasSavedSell;
  const activeBuyLevels = useSaved ? stock.buyLevels! : classicBuyLevels;
  const activeSellLevels = useSaved ? stock.sellLevels! : classicSellLevels;

  const matchesClassic = useSaved
    && activeBuyLevels.length === classicBuyLevels.length
    && activeBuyLevels.every((l, i) => l.priceMinor === classicBuyLevels[i].priceMinor)
    && activeSellLevels.length === classicSellLevels.length
    && activeSellLevels.every((l, i) => l.priceMinor === classicSellLevels[i].priceMinor);

  const gridOrigin: ClassicGridOrigin = !useSaved ? 'classic_auto' : matchesClassic ? 'classic_saved' : 'custom_saved';
  const hasCustomPriceDiff = useSaved && !matchesClassic;

  // Build Buy Rows
  let buyCumulativePortion = 0;
  let cumulativeBuySharesFloat = 0;
  const buyRows: ClassicGridTierRow[] = activeBuyLevels.map((level, index) => {
    buyCumulativePortion += level.portionBps;
    const classicPrice = classicBuyLevels[index]?.priceMinor ?? buyPriceForYield(base.netDpsMicros, level.yieldBps);
    const priceMinor = level.priceMinor ?? classicPrice;
    const grossPriceMinor = buyPriceForYield(base.grossDpsMicros, level.yieldBps);
    if (budgetMinor !== undefined && budgetMinor > 0 && priceMinor > 0) {
      cumulativeBuySharesFloat += stockBudgetMinor(budgetMinor, level.portionBps) / priceMinor;
    }
    const targetShares = budgetMinor !== undefined && budgetMinor > 0
      ? Math.floor(cumulativeBuySharesFloat / stock.lotSize) * stock.lotSize
      : undefined;
    const incrementalShares = targetShares !== undefined
      ? Math.max(0, Math.floor((targetShares - shares) / stock.lotSize) * stock.lotSize)
      : undefined;
    const touched = quotePriceMinor !== undefined && quotePriceMinor <= priceMinor;
    const gapFromQuoteBps = quotePriceMinor !== undefined && quotePriceMinor > 0
      ? Math.round(((priceMinor - quotePriceMinor) / quotePriceMinor) * 10000)
      : undefined;
    const status: ClassicGridTierRow['status'] = quotePriceMinor === undefined
      ? 'quote_pending'
      : !touched
        ? 'waiting'
        : targetShares === undefined
          ? 'triggered'
          : incrementalShares && incrementalShares > 0
            ? 'triggered'
            : targetShares <= shares && targetShares > 0
              ? 'covered'
              : 'below_lot';
    return {
      level: index + 1,
      side: 'buy',
      yieldBps: level.yieldBps,
      portionBps: level.portionBps,
      cumulativePortionBps: buyCumulativePortion,
      grossPriceMinor,
      priceMinor,
      classicPriceMinor: classicPrice,
      gapFromQuoteBps,
      targetShares,
      incrementalShares,
      touched,
      status,
    };
  });

  // Build Sell Rows
  let sellCumulativePortion = 0;
  const sellRows: ClassicGridTierRow[] = activeSellLevels.map((level, index) => {
    sellCumulativePortion += level.portionBps;
    const classicPrice = classicSellLevels[index]?.priceMinor ?? sellPriceForYield(base.netDpsMicros, level.yieldBps);
    const priceMinor = level.priceMinor ?? classicPrice;
    const grossPriceMinor = sellPriceForYield(base.grossDpsMicros, level.yieldBps);
    const sellShares = shares > 0
      ? sellCumulativePortion >= 10000
        ? shares
        : Math.floor(((shares * sellCumulativePortion) / 10000) / stock.lotSize) * stock.lotSize
      : 0;
    const touched = quotePriceMinor !== undefined && quotePriceMinor >= priceMinor;
    const gapFromQuoteBps = quotePriceMinor !== undefined && quotePriceMinor > 0
      ? Math.round(((priceMinor - quotePriceMinor) / quotePriceMinor) * 10000)
      : undefined;
    const status: ClassicGridTierRow['status'] = quotePriceMinor === undefined
      ? 'quote_pending'
      : !touched
        ? 'waiting'
        : shares <= 0
          ? 'no_holding'
          : sellShares > 0
            ? 'triggered'
            : 'below_lot';
    return {
      level: index + 1,
      side: 'sell',
      yieldBps: level.yieldBps,
      portionBps: level.portionBps,
      cumulativePortionBps: sellCumulativePortion,
      grossPriceMinor,
      priceMinor,
      classicPriceMinor: classicPrice,
      gapFromQuoteBps,
      sellShares: shares > 0 ? sellShares : undefined,
      touched,
      status,
    };
  });

  // Determine Today's Action
  const touchedBuys = buyRows.filter(r => r.touched);
  const touchedSells = sellRows.filter(r => r.touched);
  const triggeredBuyLevel = touchedBuys.length ? touchedBuys.at(-1)!.level : 0;
  const triggeredSellLevel = touchedSells.length ? touchedSells.at(-1)!.level : 0;
  const nextUntouchedBuy = buyRows.find(r => !r.touched) ?? buyRows[0];
  const nextUntouchedSell = sellRows.find(r => !r.touched) ?? sellRows[0];

  const maxBuyIncremental = Math.max(0, ...touchedBuys.map(r => r.incrementalShares ?? 0));
  const maxSellShares = Math.max(0, ...touchedSells.map(r => r.sellShares ?? 0));

  let todayAction: ClassicTodayAction;
  const yuan = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toFixed(2)}`;
  const pct = (bps?: number) => bps === undefined ? '—' : `${(bps / 100).toFixed(2)}%`;

  if (stock.buyPaused && triggeredBuyLevel > 0) {
    todayAction = {
      type: 'paused',
      triggeredBuyLevel,
      triggeredSellLevel,
      suggestedShares: 0,
      nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
      nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
      nextSellPriceMinor: nextUntouchedSell?.priceMinor,
      nextSellGapBps: nextUntouchedSell?.gapFromQuoteBps,
      headlineZh: `股价已触及买${triggeredBuyLevel}档（≤${yuan(touchedBuys.at(-1)!.priceMinor)}），但当前已手动暂停买入`,
      headlineEn: `Price reached Buy Tier ${triggeredBuyLevel} (≤${yuan(touchedBuys.at(-1)!.priceMinor)}), but buying is manually paused`,
      detailZh: `若需执行加仓，可在编辑中解除“暂停买入”。当前扣税后股息率 ${pct(currentNetYieldBps)}。`,
      detailEn: `Unpause buying in settings to execute. Current after-tax yield: ${pct(currentNetYieldBps)}.`,
    };
  } else if (triggeredSellLevel > 0 && shares > 0 && maxSellShares > 0) {
    const row = touchedSells.at(-1)!;
    const amountMinor = quotePriceMinor ? maxSellShares * quotePriceMinor : undefined;
    todayAction = {
      type: 'sell',
      triggeredBuyLevel,
      triggeredSellLevel,
      suggestedShares: maxSellShares,
      suggestedAmountMinor: amountMinor,
      nextBuyPriceMinor: buyRows[0]?.priceMinor,
      nextBuyGapBps: buyRows[0]?.gapFromQuoteBps,
      nextSellPriceMinor: nextUntouchedSell?.priceMinor,
      nextSellGapBps: nextUntouchedSell?.gapFromQuoteBps,
      headlineZh: `触发卖${triggeredSellLevel}档（≥${yuan(row.priceMinor)}，股息率≤${pct(row.yieldBps)}），建议今日减仓 ${maxSellShares} 股`,
      headlineEn: `Triggered Sell Tier ${triggeredSellLevel} (≥${yuan(row.priceMinor)}), suggest selling ${maxSellShares} shares`,
      detailZh: `现价 ${yuan(quotePriceMinor)} 已进入高估止盈区（对应税后股息率 ${pct(currentNetYieldBps)}），按阶梯兑现 ${row.cumulativePortionBps / 100}% 持仓（约 ${yuan(amountMinor)}）。`,
      detailEn: `Current price ${yuan(quotePriceMinor)} is in the profit-taking zone (after-tax yield ${pct(currentNetYieldBps)}).`,
    };
  } else if (triggeredBuyLevel > 0) {
    const row = touchedBuys.at(-1)!;
    if (maxBuyIncremental > 0) {
      const amountMinor = quotePriceMinor ? maxBuyIncremental * quotePriceMinor : undefined;
      todayAction = {
        type: 'buy',
        triggeredBuyLevel,
        triggeredSellLevel,
        suggestedShares: maxBuyIncremental,
        suggestedAmountMinor: amountMinor,
        nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
        nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
        nextSellPriceMinor: sellRows[0]?.priceMinor,
        nextSellGapBps: sellRows[0]?.gapFromQuoteBps,
        headlineZh: `触发买${triggeredBuyLevel}档（≤${yuan(row.priceMinor)}，股息率≥${pct(row.yieldBps)}），建议今日买入 ${maxBuyIncremental} 股`,
        headlineEn: `Triggered Buy Tier ${triggeredBuyLevel} (≤${yuan(row.priceMinor)}), suggest buying ${maxBuyIncremental} shares`,
        detailZh: `现价 ${yuan(quotePriceMinor)}（税后股息率 ${pct(currentNetYieldBps)}）低于买${triggeredBuyLevel}档上限，累计目标持仓 ${row.targetShares} 股，扣除已持 ${shares} 股后建议补足 ${maxBuyIncremental} 股（约 ${yuan(amountMinor)}）。`,
        detailEn: `Current price ${yuan(quotePriceMinor)} (yield ${pct(currentNetYieldBps)}) is at or below Buy Tier ${triggeredBuyLevel}. Target ${row.targetShares} shares, add ${maxBuyIncremental} shares.`,
      };
    } else if (budgetMinor === undefined || budgetMinor <= 0) {
      todayAction = {
        type: 'buy',
        triggeredBuyLevel,
        triggeredSellLevel,
        suggestedShares: stock.lotSize,
        suggestedAmountMinor: quotePriceMinor ? stock.lotSize * quotePriceMinor : undefined,
        nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
        nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
        nextSellPriceMinor: sellRows[0]?.priceMinor,
        nextSellGapBps: sellRows[0]?.gapFromQuoteBps,
        headlineZh: `价格已触发买${triggeredBuyLevel}档（≤${yuan(row.priceMinor)}，股息率≥${pct(row.yieldBps)}），可按每档 25% 分批建仓`,
        headlineEn: `Price triggered Buy Tier ${triggeredBuyLevel} (≤${yuan(row.priceMinor)}, yield ≥${pct(row.yieldBps)})`,
        detailZh: `现价 ${yuan(quotePriceMinor)} 已进入高股息击球区（累计应配 ${row.cumulativePortionBps / 100}% 仓位）。为该股分配预算后可自动算出精确整手股数（1手=${stock.lotSize}股约 ${yuan(quotePriceMinor ? quotePriceMinor * stock.lotSize : undefined)}）。`,
        detailEn: `Price ${yuan(quotePriceMinor)} is in the buy zone (${row.cumulativePortionBps / 100}% cumulative weight). Assign a budget to calculate exact lot shares.`,
      };
    } else {
      todayAction = {
        type: 'hold_covered',
        triggeredBuyLevel,
        triggeredSellLevel,
        suggestedShares: 0,
        nextBuyPriceMinor: nextUntouchedBuy?.priceMinor,
        nextBuyGapBps: nextUntouchedBuy?.gapFromQuoteBps,
        nextSellPriceMinor: sellRows[0]?.priceMinor,
        nextSellGapBps: sellRows[0]?.gapFromQuoteBps,
        headlineZh: `价格处于买${triggeredBuyLevel}档区间（≤${yuan(row.priceMinor)}），当前持仓 ${shares} 股已满足本档目标，今日持股收息`,
        headlineEn: `In Buy Tier ${triggeredBuyLevel} zone (≤${yuan(row.priceMinor)}); current ${shares} shares already cover target`,
        detailZh: `本档累计目标 ${row.targetShares ?? 0} 股（或差额不足1手 ${stock.lotSize} 股），无需重复加仓，等待下一档 ${yuan(nextUntouchedBuy?.priceMinor)} 或派息。`,
        detailEn: `Current holdings already cover this tier's target (${row.targetShares ?? 0} shares). Hold and collect dividends.`,
      };
    }
  } else {
    const buy1 = buyRows[0];
    const sell1 = sellRows[0];
    const buyGapText = buy1?.gapFromQuoteBps !== undefined ? `距买1档 ${yuan(buy1.priceMinor)} 还需回落 ${Math.abs(buy1.gapFromQuoteBps / 100).toFixed(2)}%` : `买1档目标价 ${yuan(buy1?.priceMinor)}`;
    const sellGapText = sell1?.gapFromQuoteBps !== undefined ? `距卖1档 ${yuan(sell1.priceMinor)} 还需上涨 ${Math.abs(sell1.gapFromQuoteBps / 100).toFixed(2)}%` : `卖1档目标价 ${yuan(sell1?.priceMinor)}`;
    todayAction = {
      type: 'wait',
      triggeredBuyLevel: 0,
      triggeredSellLevel: 0,
      suggestedShares: 0,
      nextBuyPriceMinor: buy1?.priceMinor,
      nextBuyGapBps: buy1?.gapFromQuoteBps,
      nextSellPriceMinor: sell1?.priceMinor,
      nextSellGapBps: sell1?.gapFromQuoteBps,
      headlineZh: `今日未触发买卖档 · ${buyGapText}，耐心等待击球区`,
      headlineEn: `No tier triggered today · Wait for Buy 1 (${yuan(buy1?.priceMinor)}) or Sell 1 (${yuan(sell1?.priceMinor)})`,
      detailZh: `当前现价 ${yuan(quotePriceMinor)}（税后股息率 ${pct(currentNetYieldBps)}，5%中性锚 ${yuan(neutralPriceMinor)}）。${buyGapText}；${sellGapText}。`,
      detailEn: `Current price ${yuan(quotePriceMinor)} (after-tax yield ${pct(currentNetYieldBps)}, 5% anchor ${yuan(neutralPriceMinor)}).`,
    };
  }

  // Build 3 Classic Health Checks (non-blocking, informative)
  const healthChecks: ClassicHealthCheck[] = [
    {
      key: 'yield_zone',
      status: currentNetYieldBps !== undefined && currentNetYieldBps >= 550 ? 'good' : currentNetYieldBps !== undefined && currentNetYieldBps < 450 ? 'caution' : 'neutral',
      labelZh: '股息率估值位置',
      labelEn: 'Yield Valuation Zone',
      detailZh: currentNetYieldBps !== undefined
        ? currentNetYieldBps >= 550
          ? `当前税后股息率 ${pct(currentNetYieldBps)} ≥ 5.50%，处于经典高息建仓区（低于5%中性锚 ${yuan(neutralPriceMinor)}）`
          : currentNetYieldBps >= 480
            ? `当前税后股息率 ${pct(currentNetYieldBps)}，处于 4.8%~5.5% 中性持有收息区间`
            : `当前税后股息率 ${pct(currentNetYieldBps)} < 4.80%，股价高于中性锚，注意分批止盈纪律`
        : `5.0% 中性锚定价 ${yuan(neutralPriceMinor)}，买1档(5.5%) ${yuan(buyRows[0]?.priceMinor)}`,
      detailEn: currentNetYieldBps !== undefined
        ? `Current after-tax yield ${pct(currentNetYieldBps)} vs 5.0% neutral anchor (${yuan(neutralPriceMinor)}).`
        : `5.0% neutral anchor is ${yuan(neutralPriceMinor)}.`,
    },
    {
      key: 'dividend_base',
      status: base.tier === 'implemented_cycle' || base.tier === 'manual' ? 'good' : 'neutral',
      labelZh: '分红基数与缺数自动处理',
      labelEn: 'Dividend Base & Auto-Fallback',
      detailZh: base.strategyNoteZh,
      detailEn: base.strategyNoteEn,
    },
    {
      key: 'position_discipline',
      status: budgetMinor && budgetMinor > 0 ? 'good' : 'neutral',
      labelZh: '网格仓位与整手纪律',
      labelEn: 'Grid & Lot Discipline',
      detailZh: budgetMinor && budgetMinor > 0
        ? `分配预算 ${yuan(budgetMinor)}（权重 ${(stock.weightBps / 100).toFixed(2)}%），四买四卖每档各 25%，按 ${stock.lotSize} 股/手向下取整计算`
        : `当前未分配固定预算金额（权重 ${(stock.weightBps / 100).toFixed(2)}%），已自动按每档 25% 仓位比例直接给出触发价格`,
      detailEn: budgetMinor && budgetMinor > 0
        ? `Allocated budget ${yuan(budgetMinor)} (${(stock.weightBps / 100).toFixed(2)}%), 25% per tier, rounded to ${stock.lotSize}-share lots.`
        : `No fixed budget assigned; displaying 25% tier price levels directly.`,
    },
  ];

  return {
    code: stock.code,
    name: stock.name,
    group: stock.group,
    sector,
    shares,
    lotSize: stock.lotSize,
    weightBps: stock.weightBps,
    budgetMinor,
    buyPaused: Boolean(stock.buyPaused),
    quotePriceMinor,
    quoteChangePercent,
    quoteDate,
    quoteSource,
    currentGrossYieldBps,
    currentNetYieldBps,
    neutralPriceMinor,
    grossNeutralPriceMinor,
    base,
    gridOrigin,
    hasCustomPriceDiff,
    buyRows,
    sellRows,
    classicBuyLevels,
    classicSellLevels,
    todayAction,
    healthChecks,
  };
}

/**
 * Generates an immediately readable, actionable daily operation advice report in Markdown
 * based on the classic dividend grid strategy. Works both for a single stock or the entire portfolio.
 */
export function buildClassicDailyAdviceMarkdown(
  plans: ClassicStockPlan[],
  options: { selectedCode?: string; totalBudgetMinor?: number; language?: string; asOf?: string } = {},
): string {
  const zh = (options.language ?? 'zh').startsWith('zh');
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const yuan = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (bps?: number) => bps === undefined ? '—' : `${(bps / 100).toFixed(2)}%`;

  const targetPlans = options.selectedCode
    ? plans.filter(p => p.code === options.selectedCode)
    : plans.filter(p => p.group !== 'hidden' || p.shares > 0);
  const effectivePlans = targetPlans.length ? targetPlans : plans;

  const buyTriggered = effectivePlans.filter(p => p.todayAction.type === 'buy');
  const sellTriggered = effectivePlans.filter(p => p.todayAction.type === 'sell');
  const coveredHoldings = effectivePlans.filter(p => p.todayAction.type === 'hold_covered');
  const waiting = effectivePlans
    .filter(p => p.todayAction.type === 'wait')
    .sort((a, b) => Math.abs(a.todayAction.nextBuyGapBps ?? 99999) - Math.abs(b.todayAction.nextBuyGapBps ?? 99999));

  if (!zh) {
    const lines: string[] = [
      `## Classic Dividend Grid · Daily Action Plan (${asOf})`,
      '',
    ];
    if (options.selectedCode && effectivePlans[0]) {
      const p = effectivePlans[0];
      lines.push(`### ${p.name} (${p.code}) — ${p.todayAction.headlineEn}`);
      lines.push(`- **Current Price**: ${yuan(p.quotePriceMinor)} · **After-Tax Yield**: ${pct(p.currentNetYieldBps)} (Pre-tax ${pct(p.currentGrossYieldBps)})`);
      lines.push(`- **Dividend Base**: ¥${(p.base.grossDpsMicros / 1e6).toFixed(4)}/share (${p.base.periodLabel}, after-tax ¥${(p.base.netDpsMicros / 1e6).toFixed(4)})`);
      lines.push(`- **5.0% Neutral Anchor**: ${yuan(p.neutralPriceMinor)} · **Holdings**: ${p.shares} shares · **Budget**: ${yuan(p.budgetMinor)}`);
      lines.push(`- **Buy Ladder (5.5% / 5.75% / 6.0% / 6.5%)**: ${p.buyRows.map(r => `B${r.level} ${yuan(r.priceMinor)}${r.touched ? ' ✅' : ''}`).join(' / ')}`);
      lines.push(`- **Sell Ladder (4.8% / 4.5% / 4.2% / 4.0%)**: ${p.sellRows.map(r => `S${r.level} ${yuan(r.priceMinor)}${r.touched ? ' 🔴' : ''}`).join(' / ')}`);
      lines.push(`- **Today's Advice**: ${p.todayAction.detailEn}`);
      return lines.join('\n');
    }
    lines.push(`- **Buy Signals Today**: **${buyTriggered.length}** stock(s) · **Sell Signals Today**: **${sellTriggered.length}** stock(s) · **Waiting / Observing**: **${waiting.length}** stock(s)`);
    if (buyTriggered.length) {
      lines.push('', '### 1. Buy Grid Triggered Today');
      for (const p of buyTriggered) {
        lines.push(`- **${p.name} (${p.code})**: Price ${yuan(p.quotePriceMinor)} (Yield ${pct(p.currentNetYieldBps)}) reached **Buy Tier ${p.todayAction.triggeredBuyLevel}** (≤${yuan(p.buyRows[p.todayAction.triggeredBuyLevel - 1]?.priceMinor)}). Suggest buying **${p.todayAction.suggestedShares} shares** (~${yuan(p.todayAction.suggestedAmountMinor)}).`);
      }
    }
    if (sellTriggered.length) {
      lines.push('', '### 2. Sell Grid Triggered Today');
      for (const p of sellTriggered) {
        lines.push(`- **${p.name} (${p.code})**: Price ${yuan(p.quotePriceMinor)} (Yield ${pct(p.currentNetYieldBps)}) reached **Sell Tier ${p.todayAction.triggeredSellLevel}**. Suggest selling **${p.todayAction.suggestedShares} shares**.`);
      }
    }
    if (!buyTriggered.length && !sellTriggered.length) {
      lines.push('', '### 1. No Immediate Trade Required Today');
      lines.push('- None of your tracked dividend stocks need new grid orders right now. Hold existing positions to collect dividends.');
    }
    if (waiting.length) {
      lines.push('', '### 2. Closest to Buy Tier 1 (Watchlist)');
      for (const p of waiting.slice(0, 5)) {
        lines.push(`- **${p.name} (${p.code})**: Current ${yuan(p.quotePriceMinor)} (Yield ${pct(p.currentNetYieldBps)}), Buy 1 at **${yuan(p.buyRows[0]?.priceMinor)}** (${pct(p.todayAction.nextBuyGapBps)} away).`);
      }
    }
    return lines.join('\n');
  }

  // Chinese report
  const lines: string[] = [
    `## 今日红利网格操作建议（${asOf}）`,
    '',
  ];

  if (options.selectedCode && effectivePlans[0]) {
    const p = effectivePlans[0];
    lines.push(`### ${p.name}（${p.code}）· ${p.todayAction.headlineZh}`);
    lines.push('');
    lines.push(`- **当前行情与估值**：现价 **${yuan(p.quotePriceMinor)}**，税后股息率 **${pct(p.currentNetYieldBps)}**（税前 ${pct(p.currentGrossYieldBps)}），5.0%中性价值锚 **${yuan(p.neutralPriceMinor)}**`);
    lines.push(`- **分红计算基数**：税前 **¥${(p.base.grossDpsMicros / 1e6).toFixed(4)}/股**，税后 **¥${(p.base.netDpsMicros / 1e6).toFixed(4)}/股**（口径：${p.base.periodLabel}）`);
    lines.push(`- **当前仓位与预算**：已持仓 **${p.shares} 股**，分配预算 **${yuan(p.budgetMinor)}**（权重 ${(p.weightBps / 100).toFixed(2)}%）`);
    lines.push(`- **买入四档（5.5% / 5.75% / 6.0% / 6.5%）**：${p.buyRows.map(r => `买${r.level} **${yuan(r.priceMinor)}**${r.touched ? '（已触及✅）' : ''}`).join(' ／ ')}`);
    lines.push(`- **卖出四档（4.8% / 4.5% / 4.2% / 4.0%）**：${p.sellRows.map(r => `卖${r.level} **${yuan(r.priceMinor)}**${r.touched ? '（已触及🔴）' : ''}`).join(' ／ ')}`);
    lines.push(`- **今日具体操作建议**：${p.todayAction.detailZh}`);
    lines.push(`- **缺数与口径说明**：${p.base.strategyNoteZh}`);
    return lines.join('\n');
  }

  lines.push(`- **今日盘面结论**：触发买入 **${buyTriggered.length}** 只 · 触发卖出 **${sellTriggered.length}** 只 · 已买满持仓收息 **${coveredHoldings.length}** 只 · 等待击球区 **${waiting.length}** 只`);

  if (buyTriggered.length > 0) {
    lines.push('', '### 一、今日触发买档 · 建议分批建仓/加仓');
    for (const p of buyTriggered) {
      const tierRow = p.buyRows[p.todayAction.triggeredBuyLevel - 1];
      lines.push(`1. **${p.name}（${p.code}）**：现价 **${yuan(p.quotePriceMinor)}**（税后股息率 **${pct(p.currentNetYieldBps)}**），已触及 **买${p.todayAction.triggeredBuyLevel}档（≤${yuan(tierRow?.priceMinor)}）** → **${p.todayAction.headlineZh.split('，').at(-1)}**${p.todayAction.suggestedAmountMinor ? `（约 ${yuan(p.todayAction.suggestedAmountMinor)}）` : ''}。`);
    }
  }

  if (sellTriggered.length > 0) {
    lines.push('', '### 二、今日触发卖档 · 建议阶梯止盈减仓');
    for (const p of sellTriggered) {
      const tierRow = p.sellRows[p.todayAction.triggeredSellLevel - 1];
      lines.push(`1. **${p.name}（${p.code}）**：现价 **${yuan(p.quotePriceMinor)}**（税后股息率降至 **${pct(p.currentNetYieldBps)}**），已触及 **卖${p.todayAction.triggeredSellLevel}档（≥${yuan(tierRow?.priceMinor)}）** → **建议卖出 ${p.todayAction.suggestedShares} 股**（约 ${yuan(p.todayAction.suggestedAmountMinor)}）。`);
    }
  }

  if (buyTriggered.length === 0 && sellTriggered.length === 0) {
    lines.push('', '### 一、今日操作结论：无需下单，安心持股收息');
    lines.push('- 今日各标的股价均未触发新增买入或止盈卖出条件。红利网格的核心纪律是**“不到买点绝不追高，不到卖点安心吃息”**，今日保持现有仓位即可。');
  }

  if (coveredHoldings.length > 0) {
    lines.push('', '### 二、处于买档区间但已配满目标仓位');
    for (const p of coveredHoldings) {
      lines.push(`- **${p.name}（${p.code}）**：现价 ${yuan(p.quotePriceMinor)} 处于买${p.todayAction.triggeredBuyLevel}档内，当前持仓 **${p.shares} 股**已达本档累计目标，无需重复加仓，下一档加仓价 **${yuan(p.todayAction.nextBuyPriceMinor)}**。`);
    }
  }

  if (waiting.length > 0) {
    lines.push('', '### 三、重点观察标的（距离买1档最近）');
    for (const p of waiting.slice(0, 6)) {
      const gap = p.todayAction.nextBuyGapBps !== undefined ? `再回落 **${Math.abs(p.todayAction.nextBuyGapBps / 100).toFixed(2)}%** 触发` : '';
      lines.push(`- **${p.name}（${p.code}）**：现价 **${yuan(p.quotePriceMinor)}**（税后股息率 ${pct(p.currentNetYieldBps)}），买1档(5.5%)挂单参考价 **${yuan(p.buyRows[0]?.priceMinor)}**（${gap}），卖1档(4.8%) **${yuan(p.sellRows[0]?.priceMinor)}**。`);
    }
  }

  return lines.join('\n');
}

/**
 * System prompt for the direct AI dividend grid advisor so the LLM gives concrete,
 * practical daily operation advice based on the classic yield-ladder strategy.
 */
export function classicDividendAdvisorSystemPrompt(language = 'zh'): string {
  return language.startsWith('zh')
    ? `你是专业的A股红利股网格投资顾问。用户采用行业经典的「股息率阶梯锚定网格法」：
1. 定价核心：以每股可持续年度现金分红（扣除红利税后）除以目标股息率计算买卖网格：
   - 5.0% 股息率为中性价值参考锚；
   - 买入四档：5.50%（买1）、5.75%（买2）、6.00%（买3）、6.50%（买4），每档分配该股25%预算，向下取整到分；
   - 卖出四档：4.80%（卖1）、4.50%（卖2）、4.20%（卖3）、4.00%（卖4），每档对应25%持仓，向上取整到分。
2. 缺数自动兜底法则：系统已自动按「手动指定 > 最新已实施完整年度/相邻半年批次 > 已公告预案递推 > 行业基准兜底」四级策略算出每只股票的精确网格。切勿要求用户去人工复核公告或找资料。
3. 回答要求：直接、清晰地给出当天具体的操作建议（哪只股票触发了第几档、建议买/卖多少股、参考挂单价是多少、未触发股票距离买1档还差多少），语言自然流畅、条理分明，不要附加套话免责声明。`
    : `You are a professional A-share dividend grid investment advisor using the classic Yield-Ladder Anchoring Strategy (5.0% neutral anchor; 4 buy tiers at 5.50%/5.75%/6.00%/6.50% and 4 sell tiers at 4.80%/4.50%/4.20%/4.00%, 25% per tier). All dividend bases and grid prices are already calculated via a 4-tier automatic fallback chain. Give clear, direct, actionable daily trading advice (which tiers triggered, exact shares and limit prices to buy/sell, and distance to Buy Tier 1 for waiting stocks) without generic disclaimers or asking the user to manually verify filings.`;
}
