import type { DividendFinancialSectorReview } from './dividendFinancialSector.ts';
import { dividendAnnualCashEvidence, dividendAnnualReportEvidence, type DividendAnnualReportEvidence } from './dividendAnnualReportEvidence.ts';
import { latestCompletedDividendYear } from './dividendPeriod.ts';
import { dividendLedgerBase, dividendLedgerHistoryDiagnostics, type DividendLedger, type DividendLedgerBase } from './dividendLedger.ts';
/** Changes to inputs, evidence or arithmetic must retire older cached drafts. */
export const DIVIDEND_PRICING_CALCULATION_VERSION = 5;
export const CLASSIC_DIVIDEND_BUY_YIELDS = [550, 575, 600, 650] as const;
export const CLASSIC_DIVIDEND_SELL_YIELDS = [480, 450, 420, 400] as const;
export const CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS = 500;
export type DividendPricingRiskClass = 'bondlike' | 'bank' | 'cyclical' | 'other';
export interface DividendPricingStockOverride {
  riskClass?: DividendPricingRiskClass;
  normalizedEpsMicros?: number;
  normalizationSource?: string;
  normalizationAsOf?: string;
}
export interface DividendPricingMethod {
  /** Absent in legacy backups; every new calculation uses this fixed-yield method. */
  strategy?: 'classic_ttm' | 'recent_batches';
  requiredReturnBps: number;
  growthBps: number;
  holdingPeriod: 'over_year' | 'month_to_year' | 'up_to_month';
  safetyMarginBps: number;
  riskPremiumBps: Record<DividendPricingRiskClass, number>;
  historicalPercentileBps: number;
  opportunityCostBps?: number;
  opportunityCostAsOf?: string;
  opportunityCostSource?: string;
  stockOverrides: Record<string, DividendPricingStockOverride>;
}
export interface DividendTreasuryResearch {
  yieldBps: number;
  asOf: string;
  fetchedAt: number;
  sourceUrl: string;
  history: { date: string; yieldBps: number }[];
}
export interface DividendOpportunityResearch { yieldBps: number; asOf: string; sourceUrl: string; basis: string }
export interface DividendPricingAnnual {
  year: number;
  reportDate: string;
  noticeDate?: string;
  epsMicros?: number;
  adjustedEpsMicros?: number;
  roeBps?: number;
  operatingCashMinor?: number;
  capitalExpenditureMinor?: number;
  totalShares?: number;
  dividendMicros?: number;
  dividendCashMinor?: number;
  payoutBps?: number;
  payoutBasis?: 'reported_cash_over_profit' | 'per_share_dividend_over_eps';
  netProfitMinor?: number;
  reportEvidence?: DividendAnnualReportEvidence;
  fcfCoverageBps?: number;
}
export interface DividendYieldHistory {
  basis: 'implemented_cash_ex_date_trailing_year_over_unadjusted_month_close' | 'verified_recent_batches_over_unadjusted_month_close';
  samples: { date: string; yieldBps: number; treasuryBps?: number; spreadBps?: number }[];
  from: string;
  through: string;
  capitalActionsVerified: boolean;
  /** A source feed must not contradict already verified annual cash disclosures. */
  cashDistributionsComplete?: boolean;
  sourceUrls: string[];
  priceSampleCount?: number;
  priceFrom?: string;
  priceThrough?: string;
  ledgerIssues?: string[];
}
export interface DividendYieldHistoryCoverage {
  usable: boolean;
  sampleCount: number;
  requiredSamples: 60;
  spanYears: number;
  requiredSpanYears: 4.8;
  from?: string;
  through?: string;
  ageDays?: number;
  maxAgeDays: 40;
  reasons: ('history_unavailable' | 'samples_insufficient' | 'span_insufficient' | 'stale' | 'capital_actions_unverified' | 'cash_distributions_incomplete' | 'announcement_unverified' | 'ledger_conflict')[];
}
/** Exact implemented cash in (windowStart, asOf], on the asOf share basis. */
export interface DividendPricingTrailingDividend {
  dpsMicros: number;
  asOf: string;
  windowStart: string;
  capitalActionsVerified: boolean;
  cashDistributionsComplete: boolean;
  sourceUrls: string[];
  /** Earliest quote date whose cash window and share basis match this TTM. */
  quoteComparisonSafeFrom?: string;
}
export type DividendPricingBlocker = 'annual_eps_missing' | 'annual_payout_missing' | 'non_positive_earnings'
  | 'payout_above_100' | 'fcf_missing' | 'fcf_below_150' | 'fcf_non_positive' | 'fcf_dividend_capped' | 'financial_sector_review'
  | 'treasury_missing' | 'treasury_stale' | 'yield_history_missing' | 'capital_actions_unverified'
  | 'opportunity_cost_missing' | 'opportunity_cost_stale' | 'anchors_conflict' | 'growth_return_conflict'
  | 'quote_missing' | 'roe_bps_missing' | 'cyclical_normalisation_required' | 'annual_stale'
  | 'dividend_continuity_missing' | 'implausible_yield' | 'anchors_missing' | 'pricing_calculation_stale'
  | 'trailing_dividend_missing' | 'trailing_dividend_invalid' | 'trailing_dividend_stale' | 'trailing_dividend_zero' | 'cash_distributions_incomplete'
  | 'dividend_ledger_missing' | 'dividend_base_unverified' | 'dividend_base_incomplete' | 'dividend_source_conflict' | 'dividend_frequency_unknown' | 'dividend_crosscheck_mismatch';
export interface DividendPricingGrid {
  /** Price relative to the 5% neutral line; never an additional price discount. */
  discountBps: number;
  priceMinor: number;
  yieldBps: number;
  changeFromCurrentBps?: number;
  cumulativePortionBps: number;
  meetsSafetyMargin: boolean;
}
export interface DividendPricingResult {
  /** Missing on historical cached calculations. Those remain evidence, not new drafts. */
  calculationVersion?: number;
  /** Absent on historical calculations, which cannot create a new plan. */
  pricingBasis?: 'classic_ttm' | 'recent_batches';
  trailingDividend?: DividendPricingTrailingDividend;
  ledger?: DividendLedger;
  dividendBase?: DividendLedgerBase;
  status: 'ready' | 'blocked';
  canApply: boolean;
  riskClass: DividendPricingRiskClass;
  blockers: DividendPricingBlocker[];
  /** Historical field name: these are advisory findings, never automatic pause instructions. */
  pauseReasons?: DividendPricingBlocker[];
  warnings: DividendPricingBlocker[];
  annuals: DividendPricingAnnual[];
  normalizedEpsMicros?: number;
  normalizationBasis: 'three_year_adjusted_eps_mean' | 'documented_user_normalization' | 'missing';
  sustainablePayoutBps?: number;
  taxBps: number;
  /** Earnings-based pretax dividend, before any industrial cash-flow cap. */
  earningsDividendMicros?: number;
  fcfDividendCapMicros?: number;
  fcfCapApplied?: boolean;
  fcfEvidence?: { year: number; fcfPerShareMicros: number; dividendCapMicros: number;
    basis: 'reported_cash_flow_per_share' | 'reported_dividend_coverage' }[];
  /** Compatibility field: tax-adjusted implemented TTM, not forecast sustainable EPS dividends. */
  d1Micros?: number;
  anchors: { riskFreePlusPremiumBps?: number; historicalPercentileBps?: number; opportunityCostBps?: number; medianBps?: number; rangeBps?: number;
    selectedBps?: number; selection?: 'median' | 'highest_available' | 'fixed_classic' };
  gordonYieldBps: number;
  gordonPriceMinor?: number;
  anchorPriceMinor?: number;
  theoreticalPriceMinor?: number;
  marginPriceMinor?: number;
  currentPbBps?: number;
  meanRoeBps?: number;
  pbImpliedYieldBps?: number;
  reasonablePbBps?: number;
  pbBridgePriceMinor?: number;
  currentSpreadBps?: number;
  spreadPercentileBps?: number;
  grid: DividendPricingGrid[];
  treasury?: DividendTreasuryResearch;
  history?: DividendYieldHistory;
  historyCoverage?: DividendYieldHistoryCoverage;
  sourceUrls: string[];
  opportunity?: DividendOpportunityResearch;
  currentPriceMinor?: number;
  priceDate?: string;
  normalizationEvidence?: { source: string; asOf: string };
  /** Implemented trailing cash on the quote's share basis, not sustainable D1. */
  currentCashYieldBps?: number;
  financialReview?: DividendFinancialSectorReview;
}
export interface DividendPricingInput {
  code: string;
  name: string;
  financialSector: boolean;
  sector?: string;
  method: DividendPricingMethod;
  annuals: DividendPricingAnnual[];
  trailingDividend?: DividendPricingTrailingDividend;
  ledger?: DividendLedger;
  dividendBase?: DividendLedgerBase;
  priceMinor?: number;
  priceDate?: string;
  /** Implemented trailing cash on the quote's share basis, not sustainable D1. */
  currentCashYieldBps?: number;
  bvpsMicros?: number;
  asOf: string;
  treasury?: DividendTreasuryResearch;
  history?: DividendYieldHistory;
  opportunity?: DividendOpportunityResearch;
  sourceUrls?: string[];
  financialReview?: DividendFinancialSectorReview;
}

export function defaultDividendPricingMethod(): DividendPricingMethod {
  return { strategy: 'recent_batches', requiredReturnBps: 800, growthBps: 0, holdingPeriod: 'month_to_year', safetyMarginBps: 1500,
    riskPremiumBps: { bondlike: 175, bank: 225, cyclical: 350, other: 300 }, historicalPercentileBps: 7500,
    stockOverrides: {} };
}
export function isDividendPricingMethod(raw: unknown): raw is DividendPricingMethod {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as DividendPricingMethod;
  const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
  const text = (v: unknown, length: number) => v === undefined || typeof v === 'string' && v.length <= length;
  return (p.strategy === undefined || p.strategy === 'classic_ttm' || p.strategy === 'recent_batches')
    && integer(p.requiredReturnBps, 1, 5000) && integer(p.growthBps, 0, 300)
    && ['over_year', 'month_to_year', 'up_to_month'].includes(p.holdingPeriod)
    && integer(p.safetyMarginBps, 1000, 3000) && integer(p.historicalPercentileBps, 7000, 8000)
    && !!p.riskPremiumBps && ['bondlike', 'bank', 'cyclical', 'other'].every(key => integer(p.riskPremiumBps[key as DividendPricingRiskClass], 0, 3000))
    && (p.opportunityCostBps === undefined || integer(p.opportunityCostBps, 1, 3000))
    && text(p.opportunityCostAsOf, 10) && text(p.opportunityCostSource, 2000)
    && !!p.stockOverrides && typeof p.stockOverrides === 'object' && !Array.isArray(p.stockOverrides)
    && Object.entries(p.stockOverrides).length <= 100 && Object.entries(p.stockOverrides).every(([code, value]) => /^\d{6}$/.test(code)
      && !!value && typeof value === 'object' && (value.riskClass === undefined || ['bondlike', 'bank', 'cyclical', 'other'].includes(value.riskClass))
      && (value.normalizedEpsMicros === undefined || integer(value.normalizedEpsMicros, 1, 1e10))
      && text(value.normalizationAsOf, 10) && text(value.normalizationSource, 2000));
}

function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && !value.trim()) return undefined;
  const result = Number(value); return Number.isFinite(result) ? result : undefined;
}
function date(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.slice(0, 10), time = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : undefined;
}
function scaled(value: unknown, scale: number): number | undefined {
  const n = numeric(value), result = n === undefined ? undefined : Math.round(n * scale);
  return result !== undefined && Number.isSafeInteger(result) ? result : undefined;
}
function rows(raw: unknown, code?: string): Record<string, unknown>[] {
  const p = raw as { success?: boolean; result?: { data?: Record<string, unknown>[] } };
  if (!p?.success || !Array.isArray(p.result?.data) || code && p.result.data.some(r => r.SECURITY_CODE !== code)) throw new Error('PRICING_SOURCE_INVALID');
  return p.result.data;
}
function knownRows(raw: unknown, code: string, asOf: string) {
  return rows(raw, code).filter(r => { const report = date(r.REPORT_DATE), notice = date(r.NOTICE_DATE); return report && notice && report <= asOf && notice <= asOf; });
}
export function parseDividendTreasury(raw: unknown, asOf: string, fetchedAt = Date.now()): DividendTreasuryResearch {
  const history = rows(raw).flatMap(row => { const d = date(row.SOLAR_DATE), y = scaled(row.EMM00166466, 100); return d && d <= asOf && y !== undefined && y >= 0 && y < 3000 ? [{ date: d, yieldBps: y }] : []; })
    .sort((a,b) => a.date.localeCompare(b.date));
  if (!history.length) throw new Error('TREASURY_SOURCE_INVALID');
  return { yieldBps: history.at(-1)!.yieldBps, asOf: history.at(-1)!.date, fetchedAt, history, sourceUrl: 'https://data.eastmoney.com/cjsj/zmgzsyl.html' };
}
export const DIVIDEND_OPPORTUNITY_URL = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/000922indicator.xls';
export function parseDividendOpportunityRows(table: unknown[][], asOf: string): DividendOpportunityResearch {
  const header = table[0]?.map(String) ?? [], dateIndex = header.findIndex(v => /日期|Date/.test(v)), codeIndex = header.findIndex(v => /指数代码|Index Code/.test(v)), yieldIndex = header.findIndex(v => /股息率1|D\/P1/.test(v));
  if (dateIndex < 0 || codeIndex < 0 || yieldIndex < 0) throw new Error('OPPORTUNITY_COLUMNS_INVALID');
  const values = table.slice(1).flatMap(row => { const d = String(row[dateIndex]).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), y = scaled(row[yieldIndex],100);
    return String(row[codeIndex]).padStart(6,'0') === '000922' && date(d) && d <= asOf && y && y > 0 && y < 3000 ? [{ date:d, yieldBps:y }] : []; }).sort((a,b) => b.date.localeCompare(a.date));
  if (!values.length) throw new Error('OPPORTUNITY_SOURCE_INVALID');
  return { yieldBps: values[0].yieldBps, asOf: values[0].date, sourceUrl: DIVIDEND_OPPORTUNITY_URL,
    basis: 'CSI Dividend 000922 official D/P1 (total-share cash dividend yield), a diversified dividend-equity alternative; company-specific risks differ, user may replace the comparison' };
}

/** Each fiscal year sums implemented interim/final/special dividends, not a rolling TTM. */
export function dividendPricingAnnuals(financialRaw: unknown, cashRaw: unknown | undefined, distributionRaw: unknown, code: string, asOf: string): DividendPricingAnnual[] {
  const financial = knownRows(financialRaw, code, asOf);
  const cash = cashRaw ? knownRows(cashRaw, code, asOf) : [];
  const distributions = rows(distributionRaw, code);
  const lastYear = latestCompletedDividendYear(asOf);
  return Array.from({ length: 5 }, (_, index) => {
    const year = lastYear - index, reportDate = `${year}-12-31`;
    const f = financial.filter(r => date(r.REPORT_DATE) === reportDate).sort((a,b) => String(b.NOTICE_DATE).localeCompare(String(a.NOTICE_DATE)))[0];
    const c = cash.filter(r => date(r.REPORT_DATE) === reportDate).sort((a,b) => String(b.NOTICE_DATE).localeCompare(String(a.NOTICE_DATE)))[0];
    const events = new Map<string, Record<string, unknown>>();
    for (const r of distributions) {
      const ex = date(r.EX_DIVIDEND_DATE), notice = date(r.NOTICE_DATE) ?? date(r.PLAN_NOTICE_DATE);
      if (String(r.REPORT_DATE).slice(0,4) !== String(year) || !ex || ex > asOf || !notice || notice > asOf || !['实施','实施分配'].includes(String(r.ASSIGN_PROGRESS))) continue;
      const key = `${String(r.REPORT_DATE).slice(0,10)}:${ex}`;
      if (!events.has(key) || String(r.NOTICE_DATE) > String(events.get(key)!.NOTICE_DATE)) events.set(key, r);
    }
    const ds = [...events.values()];
    // The source is CNY per ten shares: /10 * 1,000,000 gives per-share micros.
    const amounts = ds.map(r => scaled(r.PRETAX_BONUS_RMB, 100000));
    const sourceDividendMicros = ds.length && amounts.every(v => v !== undefined && v >= 0) ? amounts.reduce<number>((s,v) => s + v!, 0) : undefined;
    const cashAmounts = ds.map(r => { const shares = numeric(r.TOTAL_SHARES), dps = scaled(r.PRETAX_BONUS_RMB, 100000); return shares && dps !== undefined ? Math.round(shares * dps / 10000) : undefined; });
    const sourceCashMinor = cashAmounts.length && cashAmounts.every(v => v !== undefined && Number.isSafeInteger(v)) ? cashAmounts.reduce<number>((s,v) => s + v!, 0) : undefined;
    const epsMicros = scaled(f?.EPSJB, 1e6), adjustedEpsMicros = scaled(f?.EPSKCJB, 1e6);
    const sourceNetProfitMinor = scaled(f?.PARENTNETPROFIT, 100);
    const reportEvidence = dividendAnnualReportEvidence(code,year,asOf,sourceNetProfitMinor);
    // An explicit issuer-reported zero is evidence. A missing row alone is not.
    // Do not apply a no-distribution extract if live implemented cash contradicts it.
    const usableEvidence = reportEvidence && (reportEvidence.basis !== 'reported_no_dividend' || !ds.length) ? reportEvidence : undefined;
    const dividendMicros = usableEvidence?.dividendMicros ?? sourceDividendMicros;
    const dividendCashMinor = usableEvidence?.dividendCashMinor ?? sourceCashMinor;
    const netProfitMinor = usableEvidence?.netProfitMinor ?? sourceNetProfitMinor;
    const operatingCashMinor = scaled(c?.NETCASH_OPERATE, 100), capitalExpenditureMinor = scaled(c?.CONSTRUCT_LONG_ASSET, 100);
    // Full-year cash / same-year profit avoids dividing pre-bonus dividends by
    // restated post-bonus EPS (e.g. CATL's 2022 ten-for-eight capitalisation).
    const cashPayout = netProfitMinor !== undefined && netProfitMinor > 0 && dividendCashMinor !== undefined
      ? Math.round(dividendCashMinor/netProfitMinor*10000) : undefined;
    const payoutBps = cashPayout ?? (epsMicros !== undefined && epsMicros > 0 && dividendMicros !== undefined ? Math.round(dividendMicros / epsMicros * 10000) : undefined);
    const payoutBasis = payoutBps === undefined ? undefined : cashPayout !== undefined ? 'reported_cash_over_profit' as const : 'per_share_dividend_over_eps' as const;
    const fcfCoverageBps = operatingCashMinor !== undefined && capitalExpenditureMinor !== undefined && dividendCashMinor && dividendCashMinor > 0
      ? Math.round((operatingCashMinor - capitalExpenditureMinor) / dividendCashMinor * 10000) : undefined;
    return { year, reportDate, noticeDate: date(f?.NOTICE_DATE), epsMicros, adjustedEpsMicros, roeBps: scaled(f?.ROEJQ, 100),
      operatingCashMinor, capitalExpenditureMinor, totalShares: numeric(f?.TOTAL_SHARE), dividendMicros, dividendCashMinor, netProfitMinor,
      payoutBps, payoutBasis, reportEvidence:usableEvidence, fcfCoverageBps };
  });
}

export function dividendPricingPriceHistory(raw: unknown, symbol: string, asOf: string): { date: string; priceMinor: number }[] {
  const p = raw as { code?: number; data?: Record<string, { month?: unknown[][] }> };
  const list = p?.data?.[symbol]?.month;
  if (p?.code !== 0 || !Array.isArray(list)) throw new Error('PRICE_HISTORY_INVALID');
  const prices = list.flatMap(row => { if (!Array.isArray(row)) return []; const d = date(row[0]), price = scaled(row[2], 100); return d && d <= asOf && price && price > 0 ? [{ date: d, priceMinor: price }] : []; }).sort((a,b) => a.date.localeCompare(b.date));
  if (!prices.length) throw new Error('PRICE_HISTORY_EMPTY');
  // A duplicated provider row cannot count as an extra monthly observation.
  return [...new Map(prices.map(price => [price.date.slice(0,7), price])).values()];
}
/** Subtract one calendar year, clamping 29 February to 28 February. */
function dividendWindowStart(asOf: string): string | undefined {
  if (date(asOf) !== asOf) return undefined;
  const year = Number(asOf.slice(0,4)) - 1, month = Number(asOf.slice(5,7));
  const day = Math.min(Number(asOf.slice(8,10)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

interface ImplementedCashEvent { date: string; dps: number; factor: number; notice: string }
function implementedCashEvidence(distributionRaw: unknown, code: string, asOf: string) {
  const source = distributionRaw as { result?: { pages?: number } };
  const events = new Map<string, ImplementedCashEvent>();
  let capitalActionsVerified = true;
  let cashDistributionsComplete = source.result?.pages === undefined || source.result.pages === 1;
  for (const row of rows(distributionRaw, code)) {
    if (!['实施','实施分配'].includes(String(row.ASSIGN_PROGRESS))) continue;
    const notice = date(row.NOTICE_DATE) ?? date(row.PLAN_NOTICE_DATE);
    if (notice && notice > asOf) continue;
    const ex = date(row.EX_DIVIDEND_DATE), dps = scaled(row.PRETAX_BONUS_RMB, 100000);
    if (ex && ex > asOf) continue;
    if (!ex || dps === undefined || dps < 0 || !Number.isSafeInteger(dps)) { cashDistributionsComplete = false; continue; }
    // Bonus/transfer ratios are per ten pre-event shares. Keep cash and price on
    // the sample date's share basis, including a cash-and-bonus event itself.
    if (!('BONUS_RATIO' in row) || !('IT_RATIO' in row)) capitalActionsVerified = false;
    const bonus = numeric(row.BONUS_RATIO) ?? 0, transfer = numeric(row.IT_RATIO) ?? 0;
    if ((row.BONUS_RATIO != null && numeric(row.BONUS_RATIO) === undefined)
      || (row.IT_RATIO != null && numeric(row.IT_RATIO) === undefined)) capitalActionsVerified = false;
    if (bonus < 0 || transfer < 0 || bonus + transfer > 1000) { capitalActionsVerified = false; continue; }
    const key = `${String(row.REPORT_DATE).slice(0,10)}:${ex}`;
    const event = { date: ex, dps, factor: 1 + (bonus + transfer) / 10, notice: notice ?? '' };
    const previous = events.get(key);
    if (previous && previous.notice === event.notice && (previous.dps !== dps || previous.factor !== event.factor)) cashDistributionsComplete = false;
    if (!previous || event.notice > previous.notice) events.set(key, event);
  }
  const ordered = [...events.values()].sort((a,b) => a.date.localeCompare(b.date));
  const cashEvidence = dividendAnnualCashEvidence(code, asOf);
  cashDistributionsComplete &&= cashEvidence.every(evidence => {
    const reportedAnnualCash = [...events.entries()].filter(([key]) => key.startsWith(`${evidence.year}-`))
      .reduce((sum, [,event]) => sum + event.dps, 0);
    return Math.abs(reportedAnnualCash - evidence.dividendMicros) <= 1;
  });
  return { ordered, capitalActionsVerified, cashDistributionsComplete,
    sourceUrls: [...new Set([`https://data.eastmoney.com/yjfp/detail/${code}.html`, ...cashEvidence.flatMap(evidence => evidence.sources.map(source => source.url))])] };
}

/** Shared exact cash numerator for current TTM and historical observations. */
function trailingCashMicros(ordered: ImplementedCashEvent[], asOf: string): number | undefined {
  const previous = dividendWindowStart(asOf);
  // A feed starting inside the year cannot prove that the earlier months had no cash.
  if (!previous || !ordered.length || ordered[0].date > previous) return undefined;
  let cashMicros = 0;
  for (const event of ordered.filter(e => e.date > previous && e.date <= asOf)) {
    const factor = ordered.filter(e => e.date >= event.date && e.date <= asOf).reduce((n,e) => n * e.factor, 1);
    cashMicros += event.dps / factor;
  }
  const rounded = Math.round(cashMicros);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : undefined;
}

/** First day that a cash event is excluded by the one-calendar-year window. */
function cashWindowExitDate(exDate: string): string {
  // Native calendar normalisation intentionally makes 29 February roll out on
  // 1 March in a non-leap following year. The 28 February cutoff still retains it.
  return new Date(Date.UTC(Number(exDate.slice(0,4)) + 1, Number(exDate.slice(5,7)) - 1,
    Number(exDate.slice(8,10)))).toISOString().slice(0,10);
}

function quoteComparisonBoundary(ordered: ImplementedCashEvent[], asOf: string): string {
  const changes = ordered.flatMap(event => {
    const dates = event.dps > 0 || event.factor !== 1 ? [event.date, event.notice] : [];
    if (event.dps > 0) dates.push(cashWindowExitDate(event.date));
    return dates.filter(value => !!date(value) && value <= asOf);
  });
  // With no recorded relevant change, the full observed history is unchanged.
  return changes.sort().at(-1) ?? ordered[0].date;
}

/** No quote is required, and cash is never reconstructed from a rounded yield. */
export function dividendPricingTrailingDividend(distributionRaw: unknown, code: string, asOf: string): DividendPricingTrailingDividend | undefined {
  const windowStart = dividendWindowStart(asOf);
  if (!windowStart) return undefined;
  const evidence = implementedCashEvidence(distributionRaw, code, asOf);
  const dpsMicros = trailingCashMicros(evidence.ordered, asOf);
  if (dpsMicros === undefined) return undefined;
  return { dpsMicros, asOf, windowStart, capitalActionsVerified: evidence.capitalActionsVerified,
    cashDistributionsComplete: evidence.cashDistributionsComplete, sourceUrls: evidence.sourceUrls,
    quoteComparisonSafeFrom: quoteComparisonBoundary(evidence.ordered, asOf) };
}

export function dividendPricingYieldHistory(prices: { date: string; priceMinor: number }[], distributionRaw: unknown, code: string,
  treasury?: DividendTreasuryResearch): DividendYieldHistory | undefined {
  const asOf = prices.map(price => price.date).sort().at(-1);
  if (!asOf || !date(asOf)) return undefined;
  const { ordered, capitalActionsVerified, cashDistributionsComplete, sourceUrls } = implementedCashEvidence(distributionRaw, code, asOf);
  const samples = prices.flatMap(p => {
    const dps = trailingCashMicros(ordered, p.date);
    if (dps === undefined || !Number.isSafeInteger(p.priceMinor) || p.priceMinor <= 0) return [];
    const yieldBps = Math.round(dps / p.priceMinor);
    if (yieldBps < 0 || yieldBps > 3000) return [];
    const t = treasury?.history.filter(t => t.date <= p.date).at(-1);
    const usableTreasury = t && Date.parse(p.date) - Date.parse(t.date) <= 10 * 86400000 ? t : undefined;
    return [{ date: p.date, yieldBps, ...(usableTreasury ? { treasuryBps: usableTreasury.yieldBps, spreadBps: yieldBps - usableTreasury.yieldBps } : {}) }];
  });
  if (!samples.length) return undefined;
  return { basis: 'implemented_cash_ex_date_trailing_year_over_unadjusted_month_close', samples,
    from: samples[0].date, through: samples.at(-1)!.date, capitalActionsVerified, cashDistributionsComplete,
    sourceUrls };
}

/** Each historical quote uses the verified batches and capital actions known on that date. */
export function dividendLedgerYieldHistory(prices: { date: string; priceMinor: number }[], ledger: DividendLedger,
  treasury?: DividendTreasuryResearch): DividendYieldHistory {
  const diagnostics = dividendLedgerHistoryDiagnostics(ledger, prices);
  const samples = diagnostics.samples.flatMap(sample => {
    if (sample.yieldBps === undefined || sample.yieldBps < 0 || sample.yieldBps > 3000) return [];
    const bond = treasury?.history.filter(row => row.date <= sample.date).at(-1);
    const currentBond = bond && Date.parse(sample.date) - Date.parse(bond.date) <= 10 * 86400000 ? bond : undefined;
    return [{ date: sample.date, yieldBps: sample.yieldBps, ...(currentBond ? { treasuryBps: currentBond.yieldBps, spreadBps: sample.yieldBps - currentBond.yieldBps } : {}) }];
  });
  const priceDates = [...new Set(prices.map(price => price.date))].sort();
  return { basis: 'verified_recent_batches_over_unadjusted_month_close', samples, from: samples[0]?.date ?? '', through: samples.at(-1)?.date ?? '',
    capitalActionsVerified: true, cashDistributionsComplete: ledger.complete, sourceUrls: ledger.sourceUrls,
    priceSampleCount: diagnostics.priceSampleCount, priceFrom: priceDates[0], priceThrough: priceDates.at(-1), ledgerIssues: diagnostics.reasons };
}
export function dividendPricingPercentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a,b) => a-b), position = (sorted.length - 1) * fraction, lo = Math.floor(position), hi = Math.ceil(position);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (position-lo));
}
export function dividendPricingHistoryCoverage(history: DividendYieldHistory | undefined, asOf: string): DividendYieldHistoryCoverage {
  const samples = history?.samples.filter(sample => Number.isSafeInteger(sample.yieldBps) && sample.yieldBps > 0 && sample.yieldBps < 3000
    && !!date(sample.date) && sample.date.slice(0,7) < asOf.slice(0,7)).sort((a,b) => a.date.localeCompare(b.date)) ?? [];
  const monthly = [...new Map(samples.map(sample => [sample.date.slice(0,7), sample])).values()];
  const from = monthly[0]?.date;
  // A stale declared observation boundary remains stale even when an imported
  // snapshot inconsistently contains later rows.
  const through = monthly.at(-1)?.date && history?.through && date(history.through)
    ? [monthly.at(-1)!.date, history.through].sort()[0] : monthly.at(-1)?.date;
  const spanYears = from && through ? Math.max(0, (Date.parse(through) - Date.parse(from)) / (365.25 * 86400000)) : 0;
  const ageDays = through ? (Date.parse(asOf) - Date.parse(through)) / 86400000 : undefined;
  const reasons: DividendYieldHistoryCoverage['reasons'] = [];
  if (!history || !monthly.length) reasons.push('history_unavailable');
  if (monthly.length < 60) reasons.push('samples_insufficient');
  if (spanYears < 4.8) reasons.push('span_insufficient');
  if (ageDays === undefined || ageDays < 0 || ageDays > 40) reasons.push('stale');
  if (history && !history.capitalActionsVerified) reasons.push('capital_actions_unverified');
  if (history?.cashDistributionsComplete === false) reasons.push('cash_distributions_incomplete');
  if (monthly.length < 60 && history?.ledgerIssues?.some(issue => ['ANNOUNCEMENT_UNVERIFIED', 'CAPITAL_OR_CASH_UNVERIFIED'].includes(issue))) reasons.push('announcement_unverified');
  if (monthly.length < 60 && history?.ledgerIssues?.includes('SOURCE_CONFLICT')) reasons.push('ledger_conflict');
  return { usable: reasons.length === 0, sampleCount: monthly.length, requiredSamples:60, spanYears, requiredSpanYears:4.8,
    from, through, ageDays, maxAgeDays:40, reasons };
}
export function calculateDividendPricing(input: DividendPricingInput): DividendPricingResult {
  const { method, annuals, treasury, history, asOf } = input;
  if (!isDividendPricingMethod(method)) throw new Error('INVALID_DIVIDEND_PRICING_METHOD');
  const override = method.stockOverrides[input.code];
  const riskClass = override?.riskClass ?? (input.financialSector && /银行/.test(`${input.name} ${input.sector ?? ''}`) ? 'bank' : /煤|钢|矿|有色|石油|化工|航运/.test(`${input.name} ${input.sector ?? ''}`) ? 'cyclical' : /电力|水电|水务|高速|铁路|长江电力/.test(`${input.name} ${input.sector ?? ''}`) ? 'bondlike' : 'other');
  const blockers: DividendPricingBlocker[] = [], warnings: DividendPricingBlocker[] = [], pauseReasons: DividendPricingBlocker[] = [];
  const block = (condition: boolean, key: DividendPricingBlocker) => { if (condition) blockers.push(key); };
  const pause = (condition: boolean, key: DividendPricingBlocker) => { if (condition) pauseReasons.push(key); };
  const age = (d?: string) => !date(d) || d! > asOf ? Infinity : (Date.parse(asOf) - Date.parse(d!)) / 86400000;
  const recent = annuals.slice(0,3);
  const manual = override?.normalizedEpsMicros !== undefined && !!override.normalizationSource?.trim() && age(override.normalizationAsOf) <= 550;
  const adjusted = recent.map(y => y.adjustedEpsMicros);
  const normalizedEpsMicros = manual ? override!.normalizedEpsMicros : adjusted.length === 3 && adjusted.every(v => v !== undefined) ? Math.round(adjusted.reduce<number>((s,v) => s+v!,0)/3) : undefined;
  pause(normalizedEpsMicros === undefined, 'annual_eps_missing'); pause(normalizedEpsMicros !== undefined && normalizedEpsMicros <= 0, 'non_positive_earnings');
  pause(riskClass === 'cyclical' && !manual, 'cyclical_normalisation_required');
  pause(annuals.length < 5 || annuals.slice(0,5).some(y => y.payoutBps === undefined), 'annual_payout_missing');
  pause(annuals.some(y => (y.payoutBps ?? 0) > 10000), 'payout_above_100');
  pause(annuals.slice(0,5).some(y => y.dividendMicros === undefined || y.dividendMicros <= 0), 'dividend_continuity_missing');
  pause(!annuals[0]?.noticeDate || age(annuals[0].reportDate) > 550, 'annual_stale');
  const payouts = annuals.slice(0,5).flatMap(y => y.payoutBps === undefined ? [] : [y.payoutBps]).sort((a,b) => a-b);
  // A historical distribution above earnings is a reason to pause buying,
  // not to reuse an unsupported >100% payout in the dividend numerator.
  const sustainablePayoutBps = payouts.length === 5 ? Math.min(payouts[2], 10000) : undefined;
  const fcfEvidence: NonNullable<DividendPricingResult['fcfEvidence']> = [];
  if (input.financialSector) pause(input.financialReview?.status !== 'pass' || age(input.financialReview?.asOf) > 230, 'financial_sector_review');
  else {
    for (const year of recent) {
      const cashKnown = Number.isSafeInteger(year.operatingCashMinor) && Number.isSafeInteger(year.capitalExpenditureMinor)
        && year.capitalExpenditureMinor! >= 0;
      const freeCashMinor = cashKnown ? year.operatingCashMinor! - year.capitalExpenditureMinor! : undefined;
      const coverageKnown = Number.isSafeInteger(year.fcfCoverageBps);
      pause(freeCashMinor !== undefined ? freeCashMinor <= 0 : coverageKnown && year.fcfCoverageBps! <= 0, 'fcf_non_positive');
      const coverage = freeCashMinor !== undefined && year.dividendCashMinor && year.dividendCashMinor > 0
        ? freeCashMinor / year.dividendCashMinor * 10000 : coverageKnown ? year.fcfCoverageBps : undefined;
      if (coverage !== undefined && coverage > 0 && coverage < 15000) warnings.push('fcf_below_150');
      // Prefer reported cash flow divided by the source's reported share count.
      // The provider may repeat current shares across annual rows; this is not
      // claimed as a dated year-end share count. When absent, cash-dividend
      // coverage provides a stated proxy; total company cash is never a DPS.
      const reportedPerShare = freeCashMinor !== undefined && Number.isSafeInteger(year.totalShares) && year.totalShares! > 0
        ? Math.floor(freeCashMinor / year.totalShares! * 10000) : undefined;
      const proxyPerShare = coverage !== undefined && Number.isSafeInteger(year.dividendMicros) && year.dividendMicros! > 0
        ? Math.floor(year.dividendMicros! * coverage / 10000) : undefined;
      const fcfPerShareMicros = reportedPerShare ?? proxyPerShare;
      if (fcfPerShareMicros !== undefined && Number.isSafeInteger(fcfPerShareMicros) && fcfPerShareMicros > 0) {
        fcfEvidence.push({ year: year.year, fcfPerShareMicros, dividendCapMicros: Math.floor(fcfPerShareMicros / 1.5),
          basis: reportedPerShare === undefined ? 'reported_dividend_coverage' : 'reported_cash_flow_per_share' });
      }
    }
    pause(recent.length < 3 || fcfEvidence.length !== 3, 'fcf_missing');
  }
  const taxBps = method.holdingPeriod === 'over_year' ? 0 : method.holdingPeriod === 'month_to_year' ? 1000 : 2000;
  const earningsDividendMicros = normalizedEpsMicros !== undefined && sustainablePayoutBps !== undefined
    ? Math.round(normalizedEpsMicros * sustainablePayoutBps / 10000) : undefined;
  const fcfDividendCapMicros = fcfEvidence.length === 3 ? Math.min(...fcfEvidence.map(year => year.dividendCapMicros)) : undefined;
  const fcfReferenceBelowEarnings = earningsDividendMicros !== undefined && fcfDividendCapMicros !== undefined && fcfDividendCapMicros < earningsDividendMicros;
  const fcfCapApplied = false;
  pause(warnings.includes('fcf_below_150') || fcfReferenceBelowEarnings, 'fcf_below_150');
  // New grids use the verified most recent distribution batches, never a rolling cash window.
  const trailingDividend = input.trailingDividend;
  const dividendBase = input.ledger ? dividendLedgerBase(input.ledger, asOf, { epsMicros: annuals[0]?.epsMicros, payoutBps: annuals[0]?.payoutBps }) : input.dividendBase;
  const baseShapeValid = !!dividendBase && dividendBase.asOf === asOf && Number.isSafeInteger(dividendBase.dpsMicros) && dividendBase.dpsMicros! >= 0
    && ['annual', 'semiannual'].includes(dividendBase.frequency) && dividendBase.requiredBatches === (dividendBase.frequency === 'semiannual' ? 2 : 1)
    && Array.isArray(dividendBase.selectedBatchIds) && dividendBase.selectedBatchIds.length === dividendBase.requiredBatches
    && new Set(dividendBase.selectedBatchIds).size === dividendBase.requiredBatches
    && date(dividendBase.latestExDate) === dividendBase.latestExDate && dividendBase.latestExDate! <= asOf
    && Array.isArray(dividendBase.sourceUrls) && dividendBase.sourceUrls.length > 0
    && dividendBase.sourceUrls.every(url => typeof url === 'string' && url.startsWith('https://'));
  const flags = dividendBase?.flags ?? [];
  block(!dividendBase, 'dividend_ledger_missing');
  block(!!dividendBase && (!baseShapeValid || !dividendBase.verified), 'dividend_base_unverified');
  block(flags.includes('INCOMPLETE') || flags.includes('SOURCE_PAGES_INCOMPLETE'), 'dividend_base_incomplete');
  block(flags.includes('SOURCE_CONFLICT'), 'dividend_source_conflict');
  block(flags.includes('FREQUENCY_UNKNOWN'), 'dividend_frequency_unknown');
  block(flags.includes('CROSSCHECK_MISMATCH'), 'dividend_crosscheck_mismatch');
  const baseUsable = baseShapeValid && dividendBase!.verified && !blockers.length;
  const d1Micros = baseUsable ? Number(BigInt(dividendBase!.dpsMicros!) * BigInt(10000 - taxBps) / 10000n) : undefined;
  block(baseUsable && d1Micros === 0, 'trailing_dividend_zero');
  const treasuryValid = !!treasury && Number.isSafeInteger(treasury.yieldBps) && treasury.yieldBps >= 0 && treasury.yieldBps < 3000
    && !!treasury.sourceUrl.trim();
  const treasuryUsable = treasuryValid && age(treasury!.asOf) <= 10;
  if (!treasuryValid) warnings.push('treasury_missing');
  if (treasury && age(treasury.asOf) > 10) warnings.push('treasury_stale');
  const historyCoverage = dividendPricingHistoryCoverage(history, asOf);
  const historyValues = [...new Map((history?.samples ?? []).filter(sample => Number.isSafeInteger(sample.yieldBps) && sample.yieldBps > 0 && sample.yieldBps < 3000
    && !!date(sample.date) && sample.date.slice(0,7) < asOf.slice(0,7)).sort((a,b) => a.date.localeCompare(b.date)).map(sample => [sample.date.slice(0,7), sample.yieldBps])).values()];
  const historyLongEnough = historyCoverage.usable;
  if (!historyLongEnough) warnings.push('yield_history_missing');
  if (history && !history.capitalActionsVerified) warnings.push('capital_actions_unverified');
  const opportunity = method.opportunityCostBps !== undefined ? { yieldBps: method.opportunityCostBps, asOf: method.opportunityCostAsOf ?? '', sourceUrl: method.opportunityCostSource ?? '', basis: 'User-selected comparable opportunity cost' } : input.opportunity;
  const opportunityValid = !!opportunity && Number.isSafeInteger(opportunity.yieldBps) && opportunity.yieldBps > 0 && opportunity.yieldBps < 3000
    && !!opportunity.sourceUrl.trim() && !!date(opportunity.asOf);
  const opportunityUsable = opportunityValid && age(opportunity!.asOf) <= 30;
  if (!opportunityValid) warnings.push('opportunity_cost_missing');
  if (opportunity && age(opportunity.asOf) > 30) warnings.push('opportunity_cost_stale');
  const riskFreePlusPremiumBps = treasuryUsable ? treasury!.yieldBps + method.riskPremiumBps[riskClass] : undefined;
  const anchors = { riskFreePlusPremiumBps: riskFreePlusPremiumBps && riskFreePlusPremiumBps > 0 ? riskFreePlusPremiumBps : undefined,
    historicalPercentileBps: historyLongEnough ? dividendPricingPercentile(historyValues, method.historicalPercentileBps/10000) : undefined,
    opportunityCostBps: opportunityUsable ? opportunity!.yieldBps : undefined, medianBps: undefined as number | undefined, rangeBps: undefined as number | undefined,
    selectedBps: CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS, selection: 'fixed_classic' as const };
  const anchorValues = [anchors.riskFreePlusPremiumBps, anchors.historicalPercentileBps, anchors.opportunityCostBps]
    .filter((value): value is number => value !== undefined && value > 0);
  if (anchorValues.length) {
    anchors.medianBps = dividendPricingPercentile(anchorValues,.5); anchors.rangeBps = Math.max(...anchorValues)-Math.min(...anchorValues);
  }
  const gordonYieldBps = method.requiredReturnBps - method.growthBps;
  const gordonUsable = method.growthBps < method.requiredReturnBps - 200;
  pause(!gordonUsable, 'growth_return_conflict');
  const currentPrice = typeof input.priceMinor === 'number' && Number.isSafeInteger(input.priceMinor) && input.priceMinor > 0
    && age(input.priceDate) <= 10 ? input.priceMinor : undefined;
  const quoteUsable = currentPrice !== undefined;
  // A recent quote may precede a cash payment, share change or TTM rollover.
  // It can still support its own dated cash yield, but not this new cash grid.
  const quoteMatchesGrid = quoteUsable && baseUsable && (input.priceDate === asOf
    || dividendBase!.latestExDate !== undefined && input.priceDate! >= dividendBase!.latestExDate);
  pause(!quoteUsable || baseUsable && !quoteMatchesGrid, 'quote_missing');
  const roes = recent.flatMap(y => y.roeBps === undefined ? [] : [y.roeBps]);
  const meanRoeBps = roes.length === 3 ? Math.round(roes.reduce((s,v) => s+v,0)/3) : undefined;
  const currentPbBps = input.priceMinor && input.bvpsMicros && input.bvpsMicros > 0 ? Math.round(input.priceMinor * 1e8 / input.bvpsMicros) : undefined;
  if (meanRoeBps === undefined || meanRoeBps <= 0 || currentPbBps === undefined) warnings.push('roe_bps_missing');
  const pbImpliedYieldBps = sustainablePayoutBps !== undefined && meanRoeBps !== undefined && currentPbBps ? Math.round(sustainablePayoutBps * meanRoeBps / currentPbBps) : undefined;
  const reasonablePbBps = sustainablePayoutBps !== undefined && meanRoeBps !== undefined && anchors.selectedBps ? Math.round(sustainablePayoutBps * meanRoeBps / anchors.selectedBps) : undefined;
  const priceFor = (yieldBps?: number) => d1Micros !== undefined && d1Micros > 0 && yieldBps && yieldBps > 0 ? Math.floor(d1Micros/yieldBps) : undefined;
  const gordonPriceMinor = gordonUsable ? priceFor(gordonYieldBps) : undefined, anchorPriceMinor = priceFor(anchors.selectedBps);
  const pbBridgePriceMinor = reasonablePbBps && input.bvpsMicros ? Math.floor(reasonablePbBps * input.bvpsMicros / 1e8 * (1-taxBps/10000)) : undefined;
  // The 5% line is a neutral fixed-yield reference, not a fair-value forecast.
  // Treasury, history, opportunity, Gordon and PB never change the fixed ladder.
  const candidatePriceMinor = anchorPriceMinor;
  pause(quoteMatchesGrid && d1Micros !== undefined && d1Micros/currentPrice! > 3000, 'implausible_yield');
  const buyPrices = CLASSIC_DIVIDEND_BUY_YIELDS.map(yieldBps => priceFor(yieldBps));
  const sellPrices = CLASSIC_DIVIDEND_SELL_YIELDS.map(yieldBps => d1Micros !== undefined ? Number((BigInt(d1Micros) + BigInt(yieldBps) - 1n) / BigInt(yieldBps)) : undefined);
  block(d1Micros !== undefined && d1Micros > 0 && (!candidatePriceMinor
    || [...buyPrices,...sellPrices].some(price => !price || !Number.isSafeInteger(price))
    || buyPrices.some((price,index) => index > 0 && price! >= buyPrices[index-1]!)
    || sellPrices.some((price,index) => index > 0 && price! <= sellPrices[index-1]!)
    || buyPrices[0]! >= sellPrices[0]!), 'implausible_yield');
  const canApply = !blockers.length && !!candidatePriceMinor && !!d1Micros;
  const theoreticalPriceMinor = canApply ? candidatePriceMinor : undefined;
  const marginPriceMinor = theoreticalPriceMinor ? Math.floor(theoreticalPriceMinor*(1-method.safetyMarginBps/10000)) : undefined;
  const grid: DividendPricingGrid[] = canApply ? CLASSIC_DIVIDEND_BUY_YIELDS.map((yieldBps,index) => {
    const priceMinor = buyPrices[index]!;
    return { discountBps: Math.round(priceMinor / theoreticalPriceMinor! * 10000), priceMinor, yieldBps,
      changeFromCurrentBps: quoteMatchesGrid ? Math.round((priceMinor/currentPrice!-1)*10000) : undefined,
      cumulativePortionBps: (index+1)*2500, meetsSafetyMargin: priceMinor <= marginPriceMinor! };
  }) : [];
  // Match the historical spread numerator: implemented trailing cash, not D1.
  const currentSpreadBps = quoteUsable && treasuryUsable && Number.isSafeInteger(input.currentCashYieldBps)
    && input.currentCashYieldBps! >= 0 ? input.currentCashYieldBps! - treasury!.yieldBps : undefined;
  // A current percentile needs the same verified, distinct completed months as
  // the history anchor. Never revive stale data through this auxiliary display.
  const spreadMonths = new Map((history?.samples ?? []).filter(sample => date(sample.date)
    && sample.date.slice(0,7) < asOf.slice(0,7)).sort((a,b) => a.date.localeCompare(b.date))
    .map(sample => [sample.date.slice(0,7), sample]));
  const spreads = historyCoverage.usable ? [...spreadMonths.values()].flatMap(sample =>
    Number.isSafeInteger(sample.yieldBps) && sample.yieldBps > 0 && sample.yieldBps < 3000
      && Number.isSafeInteger(sample.treasuryBps) && sample.treasuryBps! >= 0 && sample.treasuryBps! < 3000
      && Number.isSafeInteger(sample.spreadBps) && sample.spreadBps === sample.yieldBps - sample.treasuryBps!
      ? [sample.spreadBps] : []) : [];
  const spreadPercentileBps = currentSpreadBps !== undefined && spreads.length >= 60 ? Math.round(spreads.filter(v => v <= currentSpreadBps).length / spreads.length * 10000) : undefined;
  return { calculationVersion: DIVIDEND_PRICING_CALCULATION_VERSION, pricingBasis: 'recent_batches', trailingDividend, ledger: input.ledger, dividendBase,
    status: canApply ? 'ready' : 'blocked', canApply, riskClass, blockers: [...new Set(blockers)], pauseReasons: [...new Set(pauseReasons)], warnings: [...new Set(warnings)], annuals,
    normalizedEpsMicros, normalizationBasis: manual ? 'documented_user_normalization' : normalizedEpsMicros === undefined ? 'missing' : 'three_year_adjusted_eps_mean',
    normalizationEvidence: manual ? {source:override!.normalizationSource!,asOf:override!.normalizationAsOf!} : undefined,
    sustainablePayoutBps, taxBps, earningsDividendMicros, fcfDividendCapMicros, fcfCapApplied, fcfEvidence, d1Micros, anchors, gordonYieldBps, gordonPriceMinor, anchorPriceMinor, theoreticalPriceMinor, marginPriceMinor, financialReview:input.financialReview,
    currentPbBps, meanRoeBps, pbImpliedYieldBps, reasonablePbBps, pbBridgePriceMinor, currentSpreadBps, spreadPercentileBps, grid, treasury, history, historyCoverage, opportunity, currentPriceMinor:input.priceMinor,priceDate:input.priceDate,currentCashYieldBps:input.currentCashYieldBps,
    sourceUrls:[...new Set([...(input.sourceUrls ?? []),...(trailingDividend?.sourceUrls ?? []),...annuals.flatMap(year=>year.reportEvidence?.sources.map(source=>source.url) ?? [])])] };
}

const pricingIssueText: Record<DividendPricingBlocker, readonly [string, string]> = {
  dividend_ledger_missing: ['尚未取得逐笔分红台账', 'The distribution ledger is unavailable'],
  dividend_base_unverified: ['所需批次的公告或送转口径尚未核验', 'The required batches or share changes remain unverified'],
  dividend_base_incomplete: ['最近所需分红批次不完整', 'The required recent distribution batches are incomplete'],
  dividend_source_conflict: ['分红来源存在冲突，冲突记录不进入计算', 'Conflicting distribution sources are excluded from calculation'],
  dividend_frequency_unknown: ['分红频率尚不能确定', 'Distribution frequency has not been established'],
  dividend_crosscheck_mismatch: ['分红基数与每股收益乘派息率偏离超过25%，口径待核实', 'The dividend base differs from EPS times payout by over 25%; reconcile the basis'],
  annual_eps_missing: ['缺少三年扣非每股收益或有效归一盈利依据；历史现金网格仍独立计算', 'Three-year recurring EPS or documented normalised earnings are missing; the historical-cash grid remains independent'],
  annual_payout_missing: ['缺少五年可核实派息率；不能据此确认分红持续性', 'Five verified annual payout ratios are missing; dividend sustainability remains unverified'],
  non_positive_earnings: ['归一盈利非正，过去分红不代表未来能维持', 'Normalised earnings are non-positive; past dividends do not establish future sustainability'],
  payout_above_100: ['历史派息率超过100%，需核查分红持续性；固定网格仍使用过去已实施现金', 'A historical payout exceeds earnings; review sustainability. The fixed grid still uses implemented trailing cash'],
  fcf_missing: ['缺少三年可核实每股自由现金流；固定网格不代表现金支持已通过', 'Three verified annual free-cash-flow-per-share observations are missing; the fixed grid does not establish cash support'],
  fcf_below_150: ['现金流覆盖不足150%或现金支持低于盈利分红参考；固定网格未据此调整', 'Cash coverage is below 150% or below the earnings-dividend reference; the fixed grid is not adjusted for this risk'],
  fcf_non_positive: ['近三年存在非正自由现金流，需核查未来分红持续性', 'Recent free cash flow is non-positive; review future dividend sustainability'],
  fcf_dividend_capped: ['旧估值曾按现金流支持上限下调；新网格采用已实施现金', 'The historical estimate used a cash-flow ceiling; the new grid uses implemented cash'],
  financial_sector_review: ['金融行业专项有风险或资料缺口，详见分组检查结果', 'Financial-sector checks identify risks or missing evidence; see the separate result groups'],
  treasury_missing: ['缺少有效十年国债收益率', 'A verified ten-year government yield is missing'],
  treasury_stale: ['十年国债收益率依据已过期', 'The ten-year government yield observation is stale'],
  yield_history_missing: ['历史股息率证据尚未完整核验，详见覆盖与缺口', 'Historical yield evidence is not fully verified; see coverage and gaps'],
  capital_actions_unverified: ['历史送转股口径未核实', 'Historical bonus-share adjustments are unverified'],
  opportunity_cost_missing: ['缺少可核实的机会成本收益率', 'A verified comparable opportunity-cost yield is missing'],
  opportunity_cost_stale: ['机会成本收益率依据已过期', 'The opportunity-cost yield observation is stale'],
  anchors_conflict: ['参考收益率存在分歧；固定收益率网格不据此切换价格', 'Reference yields disagree; the fixed-yield grid does not switch its pricing rule'],
  growth_return_conflict: ['增长与总回报参数不符合戈登参考价条件，固定网格仍独立计算', 'Growth and total-return inputs invalidate the Gordon comparison; the fixed grid remains independent'],
  quote_missing: ['行情缺失、过期或与本次分红股本口径不一致，保留固定网格，价格触发待核实', 'The quote is missing, stale or on a different cash/share basis; preserve the fixed grid and mark price triggers unverified'],
  roe_bps_missing: ['ROE或市净率依据不足，排除PB参考价', 'ROE or book-value evidence is incomplete; exclude the PB comparison'],
  cyclical_normalisation_required: ['周期行业归一盈利待复核，过去12个月现金可能包含景气高点分红', 'Cyclical earnings need normalisation review; trailing cash may include peak-cycle dividends'],
  annual_stale: ['年报依据过期或披露日期待核实，固定网格不代表最新经营检查已通过', 'Annual evidence is stale or publication is unverified; the fixed grid does not establish a current business review'],
  dividend_continuity_missing: ['连续分红记录待核实，固定网格不保证未来分红持续', 'Dividend continuity needs verification; the fixed grid does not guarantee future dividends'],
  implausible_yield: ['计算结果或行情的数量级异常，需要核对', 'The calculated yield or price scale needs verification'],
  anchors_missing: ['收益率参考数据不足，固定网格仍按明示的收益率计算', 'Reference yield evidence is unavailable; the fixed grid uses its stated yields independently'],
  pricing_calculation_stale: ['定价计算已更新，请重新检查该股票；旧结果仅供回顾，不能生成新的价格草案', 'The pricing calculation has changed. Review this stock again; historical results cannot create new price drafts'],
  trailing_dividend_missing: ['缺少覆盖完整12个月的已实施现金分红，不能生成价格计划', 'Implemented cash evidence does not cover a full trailing year; no price plan can be generated'],
  trailing_dividend_invalid: ['过去12个月现金分红的金额、日期、窗口或来源无效', 'The trailing cash amount, date, observation window or source is invalid'],
  trailing_dividend_stale: ['现金分红窗口与本次研究日期不一致，请重新获取', 'The cash-distribution window does not match this review date; refresh the evidence'],
  trailing_dividend_zero: ['过去12个月已实施现金分红为零，无法反推正的买卖价格', 'Implemented trailing-year cash is zero; positive buy and sell prices cannot be derived'],
  cash_distributions_incomplete: ['分红记录不完整或与已核验现金公告冲突，不能生成价格计划', 'Cash records are incomplete or conflict with verified disclosures; no price plan can be generated'],
};

export function dividendPricingIssueText(issue: DividendPricingBlocker, language = 'en'): string {
  return pricingIssueText[issue][language.startsWith('zh') ? 0 : 1];
}

/** Providers occasionally echo internal evidence codes despite the prompt. */
export function humanizeDividendPricingIssues(text: string, language: string): string {
  return text.replace(new RegExp(`\\b(?:${Object.keys(pricingIssueText).join('|')})\\b`, 'g'),
    issue => dividendPricingIssueText(issue as DividendPricingBlocker, language));
}

/** Preserve dated inputs and numbers while preventing reuse of obsolete arithmetic. */
export function invalidateOutdatedDividendPricing(result: DividendPricingResult): DividendPricingResult {
  if (result.calculationVersion === DIVIDEND_PRICING_CALCULATION_VERSION && result.pricingBasis === 'recent_batches') return result;
  return { ...result, status: 'blocked', canApply: false,
    blockers: [...new Set([...result.blockers, 'pricing_calculation_stale' as const])] };
}

/** A dividend-price limit can already be reached; it is never a forecast or a higher execution price. */
export function dividendPricingMarketComparison(result: DividendPricingResult) {
  const quoteUsable = result.calculationVersion === DIVIDEND_PRICING_CALCULATION_VERSION && result.pricingBasis === 'recent_batches'
    && !result.blockers.includes('pricing_calculation_stale') && Number.isSafeInteger(result.currentPriceMinor) && result.currentPriceMinor! > 0
    && result.grid.some(level => level.changeFromCurrentBps !== undefined);
  const estimateGapBps = quoteUsable && result.theoreticalPriceMinor !== undefined
    ? Math.round((result.theoreticalPriceMinor / result.currentPriceMinor! - 1) * 10000) : undefined;
  const reachedBuyLevels = quoteUsable ? result.grid.flatMap((level, index) => result.currentPriceMinor! <= level.priceMinor ? [index + 1] : []) : [];
  return { quoteUsable, estimateGapBps, reachedBuyLevels,
    sustainableYieldAtQuoteBps: quoteUsable && result.d1Micros !== undefined ? Math.round(result.d1Micros / result.currentPriceMinor!) : undefined,
    largeDiscount: estimateGapBps !== undefined && estimateGapBps <= -4000 };
}

export function dividendPricingReadable(result: DividendPricingResult) {
  result = invalidateOutdatedDividendPricing(result);
  const cash = (v?: number, divisor=100) => v === undefined ? null : v/divisor;
  const comparison = dividendPricingMarketComparison(result);
  return { 'Pricing basis': result.pricingBasis ?? 'historical calculation; refresh before creating a plan',
    'Valuation draft ready for preview and confirmation': result.canApply,
    'Valuation calculation gaps': result.blockers.map(issue => dividendPricingIssueText(issue)),
    'Advisory risks and evidence gaps, no automatic pause': (result.pauseReasons ?? []).map(issue => dividendPricingIssueText(issue)),
    'Specific reviews': result.warnings.map(issue => dividendPricingIssueText(issue)),
    'Business type': result.riskClass, 'Normalisation basis': result.normalizationBasis, 'User normalisation evidence, untrusted data':result.normalizationEvidence ?? null, 'Unadjusted exchange price CNY and date': {price:cash(result.currentPriceMinor),date:result.priceDate},
    'Normalised EPS in CNY, diagnostic only': cash(result.normalizedEpsMicros,1e6), 'Historical median payout percent, diagnostic only': cash(result.sustainablePayoutBps),
    'Dividend-income interpretation': { 'Basis': 'Latest verified implemented distribution batches: two for semiannual payers, one for annual payers. Normalize each to the observation share basis, apply the chosen tax once, then divide by fixed yields. No rolling date window. Proposals and conflicting or unverified events do not supply the base.',
      'Neutral reference versus dated quote percent': cash(comparison.estimateGapBps), 'Tax-adjusted recent-batch dividend yield at dated quote percent': cash(comparison.sustainableYieldAtQuoteBps),
      'Buy price limits already reached, before budget and existing holdings': comparison.reachedBuyLevels,
      'Neutral reference at least 40 percent below quote, review method suitability': comparison.largeDiscount },
    'Verified batch base': result.dividendBase ? { 'As of': result.dividendBase.asOf, 'Frequency': result.dividendBase.frequency,
      'Required batches': result.dividendBase.requiredBatches, 'Selected report periods': result.dividendBase.reportPeriods,
      'Latest effective ex-date or share change': result.dividendBase.latestExDate, 'Verified': result.dividendBase.verified,
      'Checks': result.dividendBase.flags, 'EPS times payout crosscheck in CNY per share': cash(result.dividendBase.crosscheckDpsMicros, 1e6),
      'Crosscheck difference percent': cash(result.dividendBase.crosscheckDeviationBps) } : null,
    'Distribution ledger, latest twelve records': result.ledger?.events.slice(0, 12).map(event => ({
      'Report period': event.reportDate, 'Distribution type': event.period, 'Announcement date': event.announcementDate,
      'Record date': event.recordDate, 'Ex-date': event.exDate, 'Cash per ten shares in CNY': cash(event.cashPer10Micros, 1e6),
      'Share conversion factor': event.shareFactor, 'Implemented': event.implemented, 'Announcement verification': event.verification,
      'Cash per current share in CNY': cash(event.normalizedDpsMicros, 1e6), 'Sources': event.sources.map(source => source.url),
    })) ?? [],
    'Implemented trailing cash evidence': result.trailingDividend ? { 'As of': result.trailingDividend.asOf,
      'Window start, exclusive': result.trailingDividend.windowStart, 'Window end, inclusive': result.trailingDividend.asOf,
      'Capital actions verified': result.trailingDividend.capitalActionsVerified,
      'Cash disclosures complete and consistent': result.trailingDividend.cashDistributionsComplete,
      'Earliest dated quote matching this cash window and share basis': result.trailingDividend.quoteComparisonSafeFrom ?? result.trailingDividend.asOf,
      'Sources': result.trailingDividend.sourceUrls } : null,
    'Pretax verified batch dividend base in CNY per share': cash(result.dividendBase?.dpsMicros,1e6),
    'Earnings-based pretax dividend reference in CNY per share, not the grid numerator': cash(result.earningsDividendMicros,1e6),
    'Earnings reference limitation': 'Reported EPS and payout evidence may have different profit or share bases; this diagnostic does not verify future dividends and never replaces the verified implemented batch base.',
    'Cash-supported pretax dividend reference in CNY per share at 1.5x coverage': cash(result.fcfDividendCapMicros,1e6),
    'Cash-flow reference changes fixed grid': false,
    'Cash-flow reference evidence': result.fcfEvidence?.map(year => ({ year: year.year, basis: year.basis,
      'FCF in CNY per share': cash(year.fcfPerShareMicros,1e6), 'Pretax dividend ceiling in CNY per share': cash(year.dividendCapMicros,1e6) })) ?? [],
    'Dividend tax percent': cash(result.taxBps), 'Tax-adjusted batch dividend base in CNY per share': cash(result.d1Micros,1e6),
    'Reference yields percent; no effect on the fixed grid': { 'Government bond plus assumed spread': cash(result.anchors.riskFreePlusPremiumBps), 'Own-history percentile yield': cash(result.anchors.historicalPercentileBps), 'Alternative cash-yield reference, not a total-return hurdle': cash(result.anchors.opportunityCostBps), 'Median, diagnostic only': cash(result.anchors.medianBps), 'Maximum disagreement in percentage points': cash(result.anchors.rangeBps) },
    'Fixed neutral cash yield percent': CLASSIC_DIVIDEND_REFERENCE_YIELD_BPS / 100,
    'Reference calculations, no effect on grid': 'Gordon uses verified recent batches as an illustrative dividend assumption. PB uses historical profitability and payout evidence. Neither establishes a return forecast.',
    'Gordon r minus g percent': cash(result.gordonYieldBps), 'Gordon price CNY': cash(result.gordonPriceMinor),
    'PB bridge comparison price CNY': cash(result.pbBridgePriceMinor), 'Neutral 5 percent reference price CNY': cash(result.theoreticalPriceMinor),
    'Legacy safety-margin illustration CNY, no effect on grid': cash(result.marginPriceMinor),
    'Current PB': cash(result.currentPbBps,10000), 'Three-year mean ROE percent': cash(result.meanRoeBps), 'PB implied yield percent': cash(result.pbImpliedYieldBps), 'Reasonable PB': cash(result.reasonablePbBps,10000),
    'Current verified batch cash yield minus government yield in percentage points': cash(result.currentSpreadBps), 'Own historical spread percentile percent': cash(result.spreadPercentileBps),
    'Government yield percent and source date': result.treasury ? { percent: result.treasury.yieldBps/100, date: result.treasury.asOf, source: result.treasury.sourceUrl } : null,
    'Opportunity comparison': result.opportunity ? { percent: result.opportunity.yieldBps/100, date: result.opportunity.asOf, source: result.opportunity.sourceUrl, basis: result.opportunity.basis } : null,
    'Historical yield basis': result.history ? { basis: result.history.basis, from: result.history.from, through: result.history.through, observations: result.history.samples.length, 'Bonus share conversion captured': result.history.capitalActionsVerified, 'Cash feed consistent with verified issuer disclosures': result.history.cashDistributionsComplete !== false } : null,
    'Historical yield coverage': result.historyCoverage ? { 'Usable historical anchor':result.historyCoverage.usable,
      'Distinct completed monthly observations':result.historyCoverage.sampleCount, 'Required observations':result.historyCoverage.requiredSamples,
      'Observed span in years':result.historyCoverage.spanYears, 'Required span in years':result.historyCoverage.requiredSpanYears,
      from:result.historyCoverage.from, through:result.historyCoverage.through,
      'Latest observation age in days':result.historyCoverage.ageDays, 'Maximum age in days':result.historyCoverage.maxAgeDays,
      'Evidence gaps':result.historyCoverage.reasons.map(reason => ({ history_unavailable:'Historical cash-yield observations unavailable', samples_insufficient:'Fewer than 60 distinct completed monthly observations',
        span_insufficient:'Historical observations span less than 4.8 years', stale:'Latest completed month unavailable or more than 40 days old', capital_actions_unverified:'Bonus-share adjustments unverified', cash_distributions_incomplete:'Cash distribution feed omits cash confirmed in issuer disclosures; exclude this historical yield anchor',
        announcement_unverified:'Distribution announcements for the required historical batches remain unverified', ledger_conflict:'Historical distribution sources conflict' })[reason]) } : null,
    'Annual evidence': result.annuals.map(y => ({ year:y.year, 'Report published':y.noticeDate, 'Reported EPS CNY':cash(y.epsMicros,1e6), 'Adjusted EPS CNY':cash(y.adjustedEpsMicros,1e6), 'Dividend CNY per share':cash(y.dividendMicros,1e6), 'Payout percent':cash(y.payoutBps), 'Payout calculation basis':y.payoutBasis,
      'Matching annual net profit CNY':cash(y.netProfitMinor), 'Archival issuer disclosure, not fetched live':y.reportEvidence ?? null,
      'ROE percent':cash(y.roeBps), 'Operating cash CNY':cash(y.operatingCashMinor), 'Capital expenditure CNY':cash(y.capitalExpenditureMinor), 'Dividend cash CNY':cash(y.dividendCashMinor), 'FCF / dividend percent':cash(y.fcfCoverageBps) })),
    'Four fixed-yield buy prices': result.grid.map((g,i) => ({ level:i+1, 'Price CNY':g.priceMinor/100, 'Fixed target cash yield percent':g.yieldBps/100, 'Change from current price percent':cash(g.changeFromCurrentBps), 'Cumulative allocation percent':g.cumulativePortionBps/100 })), 'Sources':result.sourceUrls };
}
