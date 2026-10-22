import type { DividendFinancialSectorReview } from './dividendFinancialSector.ts';
export type DividendPricingRiskClass = 'bondlike' | 'bank' | 'cyclical' | 'other';
export interface DividendPricingStockOverride {
  riskClass?: DividendPricingRiskClass;
  normalizedEpsMicros?: number;
  normalizationSource?: string;
  normalizationAsOf?: string;
}
export interface DividendPricingMethod {
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
  fcfCoverageBps?: number;
}
export interface DividendYieldHistory {
  basis: 'implemented_cash_ex_date_trailing_year_over_unadjusted_month_close';
  samples: { date: string; yieldBps: number; treasuryBps?: number; spreadBps?: number }[];
  from: string;
  through: string;
  capitalActionsVerified: boolean;
  sourceUrls: string[];
}
export type DividendPricingBlocker = 'annual_eps_missing' | 'annual_payout_missing' | 'non_positive_earnings'
  | 'payout_above_100' | 'fcf_missing' | 'fcf_below_150' | 'fcf_non_positive' | 'fcf_dividend_capped' | 'financial_sector_review'
  | 'treasury_missing' | 'treasury_stale' | 'yield_history_missing' | 'capital_actions_unverified'
  | 'opportunity_cost_missing' | 'opportunity_cost_stale' | 'anchors_conflict' | 'growth_return_conflict'
  | 'quote_missing' | 'roe_bps_missing' | 'cyclical_normalisation_required' | 'annual_stale'
  | 'dividend_continuity_missing' | 'implausible_yield' | 'anchors_missing';
export interface DividendPricingGrid {
  discountBps: 9500 | 8500 | 7500;
  priceMinor: number;
  yieldBps: number;
  changeFromCurrentBps?: number;
  cumulativePortionBps: number;
  meetsSafetyMargin: boolean;
}
export interface DividendPricingResult {
  status: 'ready' | 'blocked';
  canApply: boolean;
  riskClass: DividendPricingRiskClass;
  blockers: DividendPricingBlocker[];
  /** Eligibility/pacing checks never erase a calculable valuation or paused draft. */
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
  d1Micros?: number;
  anchors: { riskFreePlusPremiumBps?: number; historicalPercentileBps?: number; opportunityCostBps?: number; medianBps?: number; rangeBps?: number;
    selectedBps?: number; selection?: 'median' | 'highest_available' };
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
  sourceUrls: string[];
  opportunity?: DividendOpportunityResearch;
  currentPriceMinor?: number;
  priceDate?: string;
  normalizationEvidence?: { source: string; asOf: string };
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
  priceMinor?: number;
  priceDate?: string;
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
  return { requiredReturnBps: 800, growthBps: 0, holdingPeriod: 'over_year', safetyMarginBps: 1500,
    riskPremiumBps: { bondlike: 175, bank: 225, cyclical: 350, other: 300 }, historicalPercentileBps: 7500,
    stockOverrides: {} };
}
export function isDividendPricingMethod(raw: unknown): raw is DividendPricingMethod {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as DividendPricingMethod;
  const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
  const text = (v: unknown, length: number) => v === undefined || typeof v === 'string' && v.length <= length;
  return integer(p.requiredReturnBps, 1, 5000) && integer(p.growthBps, 0, 300)
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
  const lastYear = Number(asOf.slice(0,4)) - (Number(asOf.slice(5,7)) >= 8 ? 1 : 2);
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
    const amounts = ds.map(r => scaled(r.PRETAX_BONUS_RMB, 100000));
    const dividendMicros = ds.length && amounts.every(v => v !== undefined && v >= 0) ? amounts.reduce<number>((s,v) => s + v!, 0) : undefined;
    const cashAmounts = ds.map(r => { const shares = numeric(r.TOTAL_SHARES), dps = scaled(r.PRETAX_BONUS_RMB, 100000); return shares && dps !== undefined ? Math.round(shares * dps / 10000) : undefined; });
    const dividendCashMinor = cashAmounts.length && cashAmounts.every(v => v !== undefined && Number.isSafeInteger(v)) ? cashAmounts.reduce<number>((s,v) => s + v!, 0) : undefined;
    const epsMicros = scaled(f?.EPSJB, 1e6), adjustedEpsMicros = scaled(f?.EPSKCJB, 1e6);
    const operatingCashMinor = scaled(c?.NETCASH_OPERATE, 100), capitalExpenditureMinor = scaled(c?.CONSTRUCT_LONG_ASSET, 100);
    const payoutBps = epsMicros !== undefined && epsMicros > 0 && dividendMicros !== undefined ? Math.round(dividendMicros / epsMicros * 10000) : undefined;
    const fcfCoverageBps = operatingCashMinor !== undefined && capitalExpenditureMinor !== undefined && dividendCashMinor && dividendCashMinor > 0
      ? Math.round((operatingCashMinor - capitalExpenditureMinor) / dividendCashMinor * 10000) : undefined;
    return { year, reportDate, noticeDate: date(f?.NOTICE_DATE), epsMicros, adjustedEpsMicros, roeBps: scaled(f?.ROEJQ, 100),
      operatingCashMinor, capitalExpenditureMinor, totalShares: numeric(f?.TOTAL_SHARE), dividendMicros, dividendCashMinor, payoutBps, fcfCoverageBps };
  });
}

export function dividendPricingPriceHistory(raw: unknown, symbol: string, asOf: string): { date: string; priceMinor: number }[] {
  const p = raw as { code?: number; data?: Record<string, { month?: unknown[][] }> };
  const list = p?.data?.[symbol]?.month;
  if (p?.code !== 0 || !Array.isArray(list)) throw new Error('PRICE_HISTORY_INVALID');
  return list.flatMap(row => { const d = date(row[0]), price = scaled(row[2], 100); return d && d <= asOf && price && price > 0 ? [{ date: d, priceMinor: price }] : []; }).sort((a,b) => a.date.localeCompare(b.date));
}
export function dividendPricingYieldHistory(prices: { date: string; priceMinor: number }[], distributionRaw: unknown, code: string,
  treasury?: DividendTreasuryResearch): DividendYieldHistory | undefined {
  const events = new Map<string, { date: string; dps: number; factor: number }>();
  let capitalActionsVerified = true;
  for (const row of rows(distributionRaw, code)) {
    if (!['实施','实施分配'].includes(String(row.ASSIGN_PROGRESS))) continue;
    const ex = date(row.EX_DIVIDEND_DATE), dps = scaled(row.PRETAX_BONUS_RMB, 100000);
    if (!ex || dps === undefined || dps < 0) continue;
    // Bonus/transfer ratios are per ten pre-event shares. Keep cash and price on
    // the sample date's share basis, including a cash-and-bonus event itself.
    if (!('BONUS_RATIO' in row) || !('IT_RATIO' in row)) capitalActionsVerified = false;
    const bonus = numeric(row.BONUS_RATIO) ?? 0, transfer = numeric(row.IT_RATIO) ?? 0;
    if (bonus < 0 || transfer < 0 || bonus + transfer > 1000) { capitalActionsVerified = false; continue; }
    events.set(`${String(row.REPORT_DATE).slice(0,10)}:${ex}`, { date: ex, dps, factor: 1 + (bonus + transfer) / 10 });
  }
  const ordered = [...events.values()].sort((a,b) => a.date.localeCompare(b.date));
  const samples = prices.flatMap(p => {
    const start = new Date(`${p.date}T00:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 1);
    const previous = start.toISOString().slice(0,10);
    // Require a full preceding distribution observation window.
    if (!ordered.length || ordered[0].date > previous) return [];
    let dps = 0;
    for (const event of ordered.filter(e => e.date > previous && e.date <= p.date)) {
      const factor = ordered.filter(e => e.date >= event.date && e.date <= p.date).reduce((n,e) => n * e.factor, 1);
      dps += event.dps / factor;
    }
    const yieldBps = Math.round(dps / p.priceMinor);
    if (yieldBps <= 0 || yieldBps > 3000) return [];
    const t = treasury?.history.filter(t => t.date <= p.date).at(-1);
    const usableTreasury = t && Date.parse(p.date) - Date.parse(t.date) <= 10 * 86400000 ? t : undefined;
    return [{ date: p.date, yieldBps, ...(usableTreasury ? { treasuryBps: usableTreasury.yieldBps, spreadBps: yieldBps - usableTreasury.yieldBps } : {}) }];
  });
  if (!samples.length) return undefined;
  return { basis: 'implemented_cash_ex_date_trailing_year_over_unadjusted_month_close', samples,
    from: samples[0].date, through: samples.at(-1)!.date, capitalActionsVerified,
    sourceUrls: [`https://data.eastmoney.com/yjfp/detail/${code}.html`] };
}
export function dividendPricingPercentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a,b) => a-b), position = (sorted.length - 1) * fraction, lo = Math.floor(position), hi = Math.ceil(position);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (position-lo));
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
  block(normalizedEpsMicros === undefined, 'annual_eps_missing'); block(normalizedEpsMicros !== undefined && normalizedEpsMicros <= 0, 'non_positive_earnings');
  pause(riskClass === 'cyclical' && !manual, 'cyclical_normalisation_required');
  block(annuals.length < 5 || annuals.slice(0,5).some(y => y.payoutBps === undefined), 'annual_payout_missing');
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
      block(freeCashMinor !== undefined ? freeCashMinor <= 0 : coverageKnown && year.fcfCoverageBps! <= 0, 'fcf_non_positive');
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
    block(recent.length < 3 || fcfEvidence.length !== 3, 'fcf_missing');
  }
  const taxBps = method.holdingPeriod === 'over_year' ? 0 : method.holdingPeriod === 'month_to_year' ? 1000 : 2000;
  const earningsDividendMicros = normalizedEpsMicros !== undefined && sustainablePayoutBps !== undefined
    ? Math.round(normalizedEpsMicros * sustainablePayoutBps / 10000) : undefined;
  const fcfDividendCapMicros = fcfEvidence.length === 3 ? Math.min(...fcfEvidence.map(year => year.dividendCapMicros)) : undefined;
  const fcfCapApplied = earningsDividendMicros !== undefined && fcfDividendCapMicros !== undefined && fcfDividendCapMicros < earningsDividendMicros;
  if (fcfCapApplied) warnings.push('fcf_dividend_capped');
  pause(warnings.includes('fcf_below_150') || fcfCapApplied, 'fcf_below_150');
  const pretaxDividendMicros = earningsDividendMicros === undefined ? undefined : fcfDividendCapMicros === undefined
    ? earningsDividendMicros : Math.min(earningsDividendMicros, fcfDividendCapMicros);
  const d1Micros = pretaxDividendMicros === undefined ? undefined : Math.floor(pretaxDividendMicros * (1-taxBps/10000));
  const treasuryValid = !!treasury && Number.isSafeInteger(treasury.yieldBps) && treasury.yieldBps >= 0 && treasury.yieldBps < 3000
    && !!treasury.sourceUrl.trim();
  const treasuryUsable = treasuryValid && age(treasury!.asOf) <= 10;
  if (!treasuryValid) warnings.push('treasury_missing');
  if (treasury && age(treasury.asOf) > 10) warnings.push('treasury_stale');
  const historyValues = history?.samples.filter(sample => Number.isSafeInteger(sample.yieldBps) && sample.yieldBps > 0 && sample.yieldBps < 3000
    && !!date(sample.date) && sample.date <= asOf).map(sample => sample.yieldBps) ?? [];
  const historyLongEnough = !!history && history.capitalActionsVerified && historyValues.length >= 60 && age(history.through) <= 40 && Date.parse(history.through)-Date.parse(history.from) >= 4.8*365.25*86400000;
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
    selectedBps: undefined as number | undefined, selection: undefined as DividendPricingResult['anchors']['selection'] };
  const anchorValues = [anchors.riskFreePlusPremiumBps, anchors.historicalPercentileBps, anchors.opportunityCostBps]
    .filter((value): value is number => value !== undefined && value > 0);
  if (anchorValues.length) {
    anchors.medianBps = dividendPricingPercentile(anchorValues,.5); anchors.rangeBps = Math.max(...anchorValues)-Math.min(...anchorValues);
    const conflict = anchors.rangeBps > 100;
    const useHighest = conflict || anchorValues.length < 3;
    anchors.selectedBps = useHighest ? Math.max(...anchorValues) : anchors.medianBps;
    anchors.selection = useHighest ? 'highest_available' : 'median';
    if (conflict) warnings.push('anchors_conflict');
  }
  block(!anchorValues.length, 'anchors_missing');
  const gordonYieldBps = method.requiredReturnBps - method.growthBps;
  const gordonUsable = method.growthBps < method.requiredReturnBps - 200;
  pause(!gordonUsable, 'growth_return_conflict');
  const quoteUsable = Number.isSafeInteger(input.priceMinor) && input.priceMinor! > 0 && age(input.priceDate) <= 10;
  pause(!quoteUsable, 'quote_missing');
  const roes = recent.flatMap(y => y.roeBps === undefined ? [] : [y.roeBps]);
  const meanRoeBps = roes.length === 3 ? Math.round(roes.reduce((s,v) => s+v,0)/3) : undefined;
  const currentPbBps = input.priceMinor && input.bvpsMicros && input.bvpsMicros > 0 ? Math.round(input.priceMinor * 1e8 / input.bvpsMicros) : undefined;
  if (meanRoeBps === undefined || meanRoeBps <= 0 || currentPbBps === undefined) warnings.push('roe_bps_missing');
  const pbImpliedYieldBps = sustainablePayoutBps !== undefined && meanRoeBps !== undefined && currentPbBps ? Math.round(sustainablePayoutBps * meanRoeBps / currentPbBps) : undefined;
  const reasonablePbBps = sustainablePayoutBps !== undefined && meanRoeBps !== undefined && anchors.selectedBps ? Math.round(sustainablePayoutBps * meanRoeBps / anchors.selectedBps) : undefined;
  const priceFor = (yieldBps?: number) => d1Micros !== undefined && d1Micros > 0 && yieldBps && yieldBps > 0 ? Math.floor(d1Micros/yieldBps) : undefined;
  const gordonPriceMinor = gordonUsable ? priceFor(gordonYieldBps) : undefined, anchorPriceMinor = priceFor(anchors.selectedBps);
  const pbBridgePriceMinor = reasonablePbBps && input.bvpsMicros ? Math.floor(reasonablePbBps * input.bvpsMicros / 1e8 * (1-taxBps/10000)) : undefined;
  // The user selects the three observable yield anchors as the primary method.
  // Gordon and PB remain independent comparisons, never an implicit price cap.
  const candidatePriceMinor = anchorPriceMinor;
  pause(quoteUsable && !!d1Micros && d1Micros/input.priceMinor! > 3000, 'implausible_yield');
  block(candidatePriceMinor !== undefined && candidatePriceMinor < 10, 'implausible_yield');
  const canApply = !blockers.length && !!candidatePriceMinor && !!d1Micros;
  const theoreticalPriceMinor = canApply ? candidatePriceMinor : undefined;
  const marginPriceMinor = theoreticalPriceMinor ? Math.floor(theoreticalPriceMinor*(1-method.safetyMarginBps/10000)) : undefined;
  const grid: DividendPricingGrid[] = canApply ? ([9500,8500,7500] as const).map((discountBps,index) => { const priceMinor = Math.floor(theoreticalPriceMinor! * discountBps / 10000); return { discountBps, priceMinor,
    yieldBps: Math.round(d1Micros!/priceMinor), changeFromCurrentBps: quoteUsable ? Math.round((priceMinor/input.priceMinor!-1)*10000) : undefined, cumulativePortionBps: [3333,6666,10000][index], meetsSafetyMargin: priceMinor <= marginPriceMinor! }; }) : [];
  // Match the historical spread numerator: implemented trailing cash, not D1.
  const currentSpreadBps = input.currentCashYieldBps !== undefined && treasury ? input.currentCashYieldBps-treasury.yieldBps : undefined;
  const spreads = history?.samples.flatMap(s => s.spreadBps === undefined ? [] : [s.spreadBps]) ?? [];
  const spreadPercentileBps = currentSpreadBps !== undefined && spreads.length >= 60 ? Math.round(spreads.filter(v => v <= currentSpreadBps).length / spreads.length * 10000) : undefined;
  return { status: canApply ? 'ready' : 'blocked', canApply, riskClass, blockers: [...new Set(blockers)], pauseReasons: [...new Set(pauseReasons)], warnings: [...new Set(warnings)], annuals,
    normalizedEpsMicros, normalizationBasis: manual ? 'documented_user_normalization' : normalizedEpsMicros === undefined ? 'missing' : 'three_year_adjusted_eps_mean',
    normalizationEvidence: manual ? {source:override!.normalizationSource!,asOf:override!.normalizationAsOf!} : undefined,
    sustainablePayoutBps, taxBps, earningsDividendMicros, fcfDividendCapMicros, fcfCapApplied, fcfEvidence, d1Micros, anchors, gordonYieldBps, gordonPriceMinor, anchorPriceMinor, theoreticalPriceMinor, marginPriceMinor, financialReview:input.financialReview,
    currentPbBps, meanRoeBps, pbImpliedYieldBps, reasonablePbBps, pbBridgePriceMinor, currentSpreadBps, spreadPercentileBps, grid, treasury, history, opportunity, currentPriceMinor:input.priceMinor,priceDate:input.priceDate,currentCashYieldBps:input.currentCashYieldBps, sourceUrls: input.sourceUrls ?? [] };
}

const pricingIssueText: Record<DividendPricingBlocker, readonly [string, string]> = {
  annual_eps_missing: ['缺少三年扣非每股收益或有效归一盈利依据', 'Three-year recurring EPS or documented normalised earnings are missing'],
  annual_payout_missing: ['缺少五年可核实派息率', 'Five verified annual payout ratios are missing'],
  non_positive_earnings: ['归一盈利非正，无法形成正的可持续分红', 'Normalised earnings are non-positive'],
  payout_above_100: ['历史派息率超过100%，先暂停加仓；估值派息率最多取100%', 'A historical payout exceeds earnings; pause buying and cap the valuation payout at 100%'],
  fcf_missing: ['缺少三年可核实每股自由现金流', 'Three verified annual free-cash-flow-per-share observations are missing'],
  fcf_below_150: ['现金流覆盖不足150%，按现金支持上限估值并暂停加仓', 'Cash-flow coverage is below 150%; use the cash-supported dividend ceiling and pause buying'],
  fcf_non_positive: ['近三年存在非正自由现金流，无法确认正的现金支持分红', 'Recent free cash flow is non-positive'],
  fcf_dividend_capped: ['估值分红已按现金流支持上限下调', 'The valuation dividend has been reduced to its cash-flow ceiling'],
  financial_sector_review: ['金融行业专项证据未通过或待补充，估值可保留但暂停加仓', 'Financial-sector evidence is incomplete, stale or failed; preserve the valuation and pause buying'],
  treasury_missing: ['缺少有效十年国债收益率', 'A verified ten-year government yield is missing'],
  treasury_stale: ['十年国债收益率依据已过期', 'The ten-year government yield observation is stale'],
  yield_history_missing: ['自身历史股息率样本不足或已过期', 'Own-history dividend-yield observations are insufficient or stale'],
  capital_actions_unverified: ['历史送转股口径未核实', 'Historical bonus-share adjustments are unverified'],
  opportunity_cost_missing: ['缺少可核实的机会成本收益率', 'A verified comparable opportunity-cost yield is missing'],
  opportunity_cost_stale: ['机会成本收益率依据已过期', 'The opportunity-cost yield observation is stale'],
  anchors_conflict: ['三锚收益率分歧较大，采用有效锚中最高收益率', 'The yield anchors disagree; use the highest verified yield'],
  growth_return_conflict: ['增长与总回报参数不符合戈登参考价条件，三锚估值仍独立计算', 'Growth and total-return inputs invalidate the Gordon comparison; the three-anchor valuation remains independent'],
  quote_missing: ['当前行情缺失或过期，保留估值但暂停加仓，涨跌幅待更新', 'The current quote is missing or stale; preserve the valuation, pause buying and defer the price comparison'],
  roe_bps_missing: ['ROE或市净率依据不足，排除PB参考价', 'ROE or book-value evidence is incomplete; exclude the PB comparison'],
  cyclical_normalisation_required: ['周期行业尚需归一盈利复核，暂按三年扣非均值估值并暂停加仓', 'Cyclical earnings need normalisation review; use the three-year recurring-EPS mean provisionally and pause buying'],
  annual_stale: ['年报依据过期或披露日期待核实，按列示历史数据估值并暂停加仓', 'Annual evidence is stale or its publication date is unverified; preserve the dated historical valuation and pause buying'],
  dividend_continuity_missing: ['连续分红记录待核实，保留估值并暂停加仓', 'Dividend continuity needs verification; preserve the valuation and pause buying'],
  implausible_yield: ['计算结果或行情的数量级异常，需要核对', 'The calculated yield or price scale needs verification'],
  anchors_missing: ['三锚均无有效收益率，需补齐至少一个带日期和来源的锚', 'No verified yield anchor is available; supply at least one dated, sourced anchor'],
};

export function dividendPricingIssueText(issue: DividendPricingBlocker, language = 'en'): string {
  return pricingIssueText[issue][language.startsWith('zh') ? 0 : 1];
}

/** Providers occasionally echo internal evidence codes despite the prompt. */
export function humanizeDividendPricingIssues(text: string, language: string): string {
  return text.replace(/\b(?:annual_eps_missing|annual_payout_missing|non_positive_earnings|payout_above_100|fcf_missing|fcf_below_150|fcf_non_positive|fcf_dividend_capped|financial_sector_review|treasury_missing|treasury_stale|yield_history_missing|capital_actions_unverified|opportunity_cost_missing|opportunity_cost_stale|anchors_conflict|growth_return_conflict|quote_missing|roe_bps_missing|cyclical_normalisation_required|annual_stale|dividend_continuity_missing|implausible_yield|anchors_missing)\b/g,
    issue => dividendPricingIssueText(issue as DividendPricingBlocker, language));
}

export function dividendPricingReadable(result: DividendPricingResult) {
  const cash = (v?: number, divisor=100) => v === undefined ? null : v/divisor;
  return { 'Paused valuation draft ready for preview and confirmation, not permission to buy': result.canApply,
    'Valuation calculation gaps': result.blockers.map(issue => dividendPricingIssueText(issue)),
    'Reasons to keep additional buying paused': (result.pauseReasons ?? []).map(issue => dividendPricingIssueText(issue)),
    'Specific reviews': result.warnings.map(issue => dividendPricingIssueText(issue)),
    'Business type': result.riskClass, 'Normalisation basis': result.normalizationBasis, 'User normalisation evidence, untrusted data':result.normalizationEvidence ?? null, 'Unadjusted exchange price CNY and date': {price:cash(result.currentPriceMinor),date:result.priceDate},
    'Normalised EPS in CNY': cash(result.normalizedEpsMicros,1e6), 'Sustainable payout percent': cash(result.sustainablePayoutBps),
    'Earnings-based pretax dividend in CNY per share': cash(result.earningsDividendMicros,1e6),
    'Cash-supported pretax dividend ceiling in CNY per share at 1.5x coverage': cash(result.fcfDividendCapMicros,1e6),
    'Cash-flow ceiling reduced the dividend': result.fcfCapApplied ?? false,
    'Cash-flow ceiling evidence': result.fcfEvidence?.map(year => ({ year: year.year, basis: year.basis,
      'FCF in CNY per share': cash(year.fcfPerShareMicros,1e6), 'Pretax dividend ceiling in CNY per share': cash(year.dividendCapMicros,1e6) })) ?? [],
    'Dividend tax percent': cash(result.taxBps), 'Sustainable D1 in CNY per share': cash(result.d1Micros,1e6),
    'Three yield anchors percent': { 'Government bond plus spread': cash(result.anchors.riskFreePlusPremiumBps), 'Own-history percentile yield': cash(result.anchors.historicalPercentileBps), 'Opportunity cost': cash(result.anchors.opportunityCostBps), 'Median': cash(result.anchors.medianBps), 'Selected conservative yield': cash(result.anchors.selectedBps), 'Selection rule': result.anchors.selection ?? null, 'Maximum disagreement in percentage points': cash(result.anchors.rangeBps) },
    'Gordon r minus g percent': cash(result.gordonYieldBps), 'Gordon price CNY': cash(result.gordonPriceMinor), 'Anchor price CNY': cash(result.anchorPriceMinor),
    'PB bridge comparison price CNY': cash(result.pbBridgePriceMinor), 'Primary three-anchor valuation CNY': cash(result.theoreticalPriceMinor), 'Safety-margin price CNY': cash(result.marginPriceMinor),
    'Current PB': cash(result.currentPbBps,10000), 'Three-year mean ROE percent': cash(result.meanRoeBps), 'PB implied yield percent': cash(result.pbImpliedYieldBps), 'Reasonable PB': cash(result.reasonablePbBps,10000),
    'Current implemented trailing cash yield minus government yield in percentage points': cash(result.currentSpreadBps), 'Own historical spread percentile percent': cash(result.spreadPercentileBps),
    'Government yield percent and source date': result.treasury ? { percent: result.treasury.yieldBps/100, date: result.treasury.asOf, source: result.treasury.sourceUrl } : null,
    'Opportunity comparison': result.opportunity ? { percent: result.opportunity.yieldBps/100, date: result.opportunity.asOf, source: result.opportunity.sourceUrl, basis: result.opportunity.basis } : null,
    'Historical yield basis': result.history ? { basis: result.history.basis, from: result.history.from, through: result.history.through, observations: result.history.samples.length, 'Bonus share conversion captured': result.history.capitalActionsVerified } : null,
    'Annual evidence': result.annuals.map(y => ({ year:y.year, 'Report published':y.noticeDate, 'Reported EPS CNY':cash(y.epsMicros,1e6), 'Adjusted EPS CNY':cash(y.adjustedEpsMicros,1e6), 'Dividend CNY per share':cash(y.dividendMicros,1e6), 'Payout percent':cash(y.payoutBps), 'ROE percent':cash(y.roeBps), 'Operating cash CNY':cash(y.operatingCashMinor), 'Capital expenditure CNY':cash(y.capitalExpenditureMinor), 'Dividend cash CNY':cash(y.dividendCashMinor), 'FCF / dividend percent':cash(y.fcfCoverageBps) })),
    'Three exact grid prices': result.grid.map((g,i) => ({ level:i+1, 'Price CNY':g.priceMinor/100, 'D1 yield percent':g.yieldBps/100, 'Change from current price percent':cash(g.changeFromCurrentBps), 'Cumulative allocation percent':g.cumulativePortionBps/100, 'Meets selected margin':g.meetsSafetyMargin })), 'Sources':result.sourceUrls };
}
