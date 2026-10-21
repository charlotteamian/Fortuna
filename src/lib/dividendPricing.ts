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
  | 'payout_above_100' | 'fcf_missing' | 'fcf_below_150' | 'financial_sector_review'
  | 'treasury_missing' | 'treasury_stale' | 'yield_history_missing' | 'capital_actions_unverified'
  | 'opportunity_cost_missing' | 'opportunity_cost_stale' | 'anchors_conflict' | 'growth_return_conflict'
  | 'quote_missing' | 'roe_bps_missing' | 'cyclical_normalisation_required' | 'annual_stale'
  | 'dividend_continuity_missing' | 'implausible_yield';
export interface DividendPricingGrid {
  discountBps: 9500 | 8500 | 7500;
  priceMinor: number;
  yieldBps: number;
  changeFromCurrentBps: number;
  cumulativePortionBps: number;
  meetsSafetyMargin: boolean;
}
export interface DividendPricingResult {
  status: 'ready' | 'blocked';
  canApply: boolean;
  riskClass: DividendPricingRiskClass;
  blockers: DividendPricingBlocker[];
  warnings: DividendPricingBlocker[];
  annuals: DividendPricingAnnual[];
  normalizedEpsMicros?: number;
  normalizationBasis: 'three_year_adjusted_eps_mean' | 'documented_user_normalization' | 'missing';
  sustainablePayoutBps?: number;
  taxBps: number;
  d1Micros?: number;
  anchors: { riskFreePlusPremiumBps?: number; historicalPercentileBps?: number; opportunityCostBps?: number; medianBps?: number; rangeBps?: number };
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
  const riskClass = override?.riskClass ?? (input.financialSector ? 'bank' : /煤|钢|矿|有色|石油|化工|航运/.test(`${input.name} ${input.sector ?? ''}`) ? 'cyclical' : /电力|水电|水务|高速|铁路|长江电力/.test(`${input.name} ${input.sector ?? ''}`) ? 'bondlike' : 'other');
  const blockers: DividendPricingBlocker[] = [], warnings: DividendPricingBlocker[] = [];
  const block = (condition: boolean, key: DividendPricingBlocker) => { if (condition) blockers.push(key); };
  const age = (d?: string) => !date(d) || d! > asOf ? Infinity : (Date.parse(asOf) - Date.parse(d!)) / 86400000;
  const recent = annuals.slice(0,3);
  const manual = override?.normalizedEpsMicros !== undefined && !!override.normalizationSource?.trim() && age(override.normalizationAsOf) <= 550;
  const adjusted = recent.map(y => y.adjustedEpsMicros);
  const normalizedEpsMicros = manual ? override!.normalizedEpsMicros : adjusted.length === 3 && adjusted.every(v => v !== undefined) ? Math.round(adjusted.reduce<number>((s,v) => s+v!,0)/3) : undefined;
  block(normalizedEpsMicros === undefined, 'annual_eps_missing'); block(normalizedEpsMicros !== undefined && normalizedEpsMicros <= 0, 'non_positive_earnings');
  block(riskClass === 'cyclical' && !manual, 'cyclical_normalisation_required');
  block(annuals.length < 5 || annuals.slice(0,5).some(y => y.payoutBps === undefined), 'annual_payout_missing');
  block(annuals.some(y => (y.payoutBps ?? 0) > 10000), 'payout_above_100');
  block(annuals.slice(0,5).some(y => y.dividendMicros === undefined || y.dividendMicros <= 0), 'dividend_continuity_missing');
  block(!annuals[0]?.noticeDate || age(annuals[0].reportDate) > 550, 'annual_stale');
  const payouts = annuals.slice(0,5).flatMap(y => y.payoutBps === undefined ? [] : [y.payoutBps]).sort((a,b) => a-b);
  const sustainablePayoutBps = payouts.length === 5 ? payouts[2] : undefined;
  if (input.financialSector) warnings.push('financial_sector_review');
  else { block(recent.length < 3 || recent.some(y => y.fcfCoverageBps === undefined), 'fcf_missing'); block(recent.some(y => y.fcfCoverageBps !== undefined && y.fcfCoverageBps < 15000), 'fcf_below_150'); }
  const taxBps = method.holdingPeriod === 'over_year' ? 0 : method.holdingPeriod === 'month_to_year' ? 1000 : 2000;
  const d1Micros = normalizedEpsMicros !== undefined && sustainablePayoutBps !== undefined ? Math.round(normalizedEpsMicros * sustainablePayoutBps / 10000 * (1-taxBps/10000)) : undefined;
  block(!treasury, 'treasury_missing'); block(!!treasury && age(treasury.asOf) > 10, 'treasury_stale');
  const historyLongEnough = !!history && history.samples.length >= 60 && age(history.through) <= 40 && Date.parse(history.through)-Date.parse(history.from) >= 4.8*365.25*86400000;
  block(!historyLongEnough, 'yield_history_missing');
  if (history && !history.capitalActionsVerified) warnings.push('capital_actions_unverified');
  const opportunity = method.opportunityCostBps !== undefined ? { yieldBps: method.opportunityCostBps, asOf: method.opportunityCostAsOf ?? '', sourceUrl: method.opportunityCostSource ?? '', basis: 'User-selected comparable opportunity cost' } : input.opportunity;
  block(!opportunity || !opportunity.sourceUrl.trim() || !date(opportunity.asOf), 'opportunity_cost_missing');
  block(!!opportunity && age(opportunity.asOf) > 30, 'opportunity_cost_stale');
  const anchors = { riskFreePlusPremiumBps: treasury ? treasury.yieldBps + method.riskPremiumBps[riskClass] : undefined,
    historicalPercentileBps: historyLongEnough ? dividendPricingPercentile(history!.samples.map(s => s.yieldBps), method.historicalPercentileBps/10000) : undefined,
    opportunityCostBps: opportunity?.yieldBps, medianBps: undefined as number | undefined, rangeBps: undefined as number | undefined };
  const anchorValues = [anchors.riskFreePlusPremiumBps, anchors.historicalPercentileBps, anchors.opportunityCostBps];
  if (anchorValues.every(v => v !== undefined)) { const vs = anchorValues as number[]; anchors.medianBps = dividendPricingPercentile(vs,.5); anchors.rangeBps = Math.max(...vs)-Math.min(...vs); }
  block((anchors.rangeBps ?? 0) > 100, 'anchors_conflict');
  const gordonYieldBps = method.requiredReturnBps - method.growthBps;
  block(method.growthBps >= method.requiredReturnBps - 200, 'growth_return_conflict');
  block(!input.priceMinor || age(input.priceDate) > 10, 'quote_missing');
  const roes = recent.flatMap(y => y.roeBps === undefined ? [] : [y.roeBps]);
  const meanRoeBps = roes.length === 3 ? Math.round(roes.reduce((s,v) => s+v,0)/3) : undefined;
  const currentPbBps = input.priceMinor && input.bvpsMicros && input.bvpsMicros > 0 ? Math.round(input.priceMinor * 1e8 / input.bvpsMicros) : undefined;
  block(meanRoeBps === undefined || meanRoeBps <= 0 || currentPbBps === undefined, 'roe_bps_missing');
  const pbImpliedYieldBps = sustainablePayoutBps !== undefined && meanRoeBps !== undefined && currentPbBps ? Math.round(sustainablePayoutBps * meanRoeBps / currentPbBps) : undefined;
  const reasonablePbBps = sustainablePayoutBps !== undefined && meanRoeBps !== undefined && anchors.medianBps ? Math.round(sustainablePayoutBps * meanRoeBps / anchors.medianBps) : undefined;
  const priceFor = (yieldBps?: number) => d1Micros !== undefined && d1Micros > 0 && yieldBps && yieldBps > 0 ? Math.floor(d1Micros/yieldBps) : undefined;
  const gordonPriceMinor = priceFor(gordonYieldBps), anchorPriceMinor = priceFor(anchors.medianBps);
  const pbBridgePriceMinor = reasonablePbBps && input.bvpsMicros ? Math.floor(reasonablePbBps * input.bvpsMicros / 1e8 * (1-taxBps/10000)) : undefined;
  const prices = [gordonPriceMinor, anchorPriceMinor, pbBridgePriceMinor].filter((v): v is number => v !== undefined && v > 0);
  const candidatePriceMinor = prices.length === 3 ? Math.min(...prices) : undefined;
  block(!!d1Micros && !!input.priceMinor && d1Micros/input.priceMinor > 3000, 'implausible_yield');
  block(candidatePriceMinor !== undefined && candidatePriceMinor < 10, 'implausible_yield');
  const canApply = !blockers.length && !!candidatePriceMinor && !!d1Micros;
  const theoreticalPriceMinor = canApply ? candidatePriceMinor : undefined;
  const marginPriceMinor = theoreticalPriceMinor ? Math.floor(theoreticalPriceMinor*(1-method.safetyMarginBps/10000)) : undefined;
  const grid: DividendPricingGrid[] = canApply ? ([9500,8500,7500] as const).map((discountBps,index) => { const priceMinor = Math.floor(theoreticalPriceMinor! * discountBps / 10000); return { discountBps, priceMinor,
    yieldBps: Math.round(d1Micros!/priceMinor), changeFromCurrentBps: Math.round((priceMinor/input.priceMinor!-1)*10000), cumulativePortionBps: [3333,6666,10000][index], meetsSafetyMargin: priceMinor <= marginPriceMinor! }; }) : [];
  // Match the historical spread numerator: implemented trailing cash, not D1.
  const currentSpreadBps = input.currentCashYieldBps !== undefined && treasury ? input.currentCashYieldBps-treasury.yieldBps : undefined;
  const spreads = history?.samples.flatMap(s => s.spreadBps === undefined ? [] : [s.spreadBps]) ?? [];
  const spreadPercentileBps = currentSpreadBps !== undefined && spreads.length >= 60 ? Math.round(spreads.filter(v => v <= currentSpreadBps).length / spreads.length * 10000) : undefined;
  return { status: canApply ? 'ready' : 'blocked', canApply, riskClass, blockers: [...new Set(blockers)], warnings, annuals,
    normalizedEpsMicros, normalizationBasis: manual ? 'documented_user_normalization' : normalizedEpsMicros === undefined ? 'missing' : 'three_year_adjusted_eps_mean',
    normalizationEvidence: manual ? {source:override!.normalizationSource!,asOf:override!.normalizationAsOf!} : undefined,
    sustainablePayoutBps, taxBps, d1Micros, anchors, gordonYieldBps, gordonPriceMinor, anchorPriceMinor, theoreticalPriceMinor, marginPriceMinor,
    currentPbBps, meanRoeBps, pbImpliedYieldBps, reasonablePbBps, pbBridgePriceMinor, currentSpreadBps, spreadPercentileBps, grid, treasury, history, opportunity, currentPriceMinor:input.priceMinor,priceDate:input.priceDate,currentCashYieldBps:input.currentCashYieldBps, sourceUrls: input.sourceUrls ?? [] };
}

export function dividendPricingReadable(result: DividendPricingResult) {
  const cash = (v?: number, divisor=100) => v === undefined ? null : v/divisor;
  return { 'Valuation ready for confirmation': result.canApply, 'Missing or conflicting checks': result.blockers, 'Specific reviews': result.warnings,
    'Business type': result.riskClass, 'Normalisation basis': result.normalizationBasis, 'User normalisation evidence, untrusted data':result.normalizationEvidence ?? null, 'Unadjusted exchange price CNY and date': {price:cash(result.currentPriceMinor),date:result.priceDate},
    'Normalised EPS in CNY': cash(result.normalizedEpsMicros,1e6), 'Sustainable payout percent': cash(result.sustainablePayoutBps),
    'Dividend tax percent': cash(result.taxBps), 'Sustainable D1 in CNY per share': cash(result.d1Micros,1e6),
    'Three yield anchors percent': { 'Government bond plus spread': cash(result.anchors.riskFreePlusPremiumBps), 'Own-history percentile yield': cash(result.anchors.historicalPercentileBps), 'Opportunity cost': cash(result.anchors.opportunityCostBps), 'Median': cash(result.anchors.medianBps), 'Maximum disagreement in percentage points': cash(result.anchors.rangeBps) },
    'Gordon r minus g percent': cash(result.gordonYieldBps), 'Gordon price CNY': cash(result.gordonPriceMinor), 'Anchor price CNY': cash(result.anchorPriceMinor),
    'PB bridge price CNY': cash(result.pbBridgePriceMinor), 'Conservative base price CNY': cash(result.theoreticalPriceMinor), 'Safety-margin price CNY': cash(result.marginPriceMinor),
    'Current PB': cash(result.currentPbBps,10000), 'Three-year mean ROE percent': cash(result.meanRoeBps), 'PB implied yield percent': cash(result.pbImpliedYieldBps), 'Reasonable PB': cash(result.reasonablePbBps,10000),
    'Current implemented trailing cash yield minus government yield in percentage points': cash(result.currentSpreadBps), 'Own historical spread percentile percent': cash(result.spreadPercentileBps),
    'Government yield percent and source date': result.treasury ? { percent: result.treasury.yieldBps/100, date: result.treasury.asOf, source: result.treasury.sourceUrl } : null,
    'Opportunity comparison': result.opportunity ? { percent: result.opportunity.yieldBps/100, date: result.opportunity.asOf, source: result.opportunity.sourceUrl, basis: result.opportunity.basis } : null,
    'Historical yield basis': result.history ? { basis: result.history.basis, from: result.history.from, through: result.history.through, observations: result.history.samples.length, 'Bonus share conversion captured': result.history.capitalActionsVerified } : null,
    'Annual evidence': result.annuals.map(y => ({ year:y.year, 'Report published':y.noticeDate, 'Reported EPS CNY':cash(y.epsMicros,1e6), 'Adjusted EPS CNY':cash(y.adjustedEpsMicros,1e6), 'Dividend CNY per share':cash(y.dividendMicros,1e6), 'Payout percent':cash(y.payoutBps), 'ROE percent':cash(y.roeBps), 'Operating cash CNY':cash(y.operatingCashMinor), 'Capital expenditure CNY':cash(y.capitalExpenditureMinor), 'Dividend cash CNY':cash(y.dividendCashMinor), 'FCF / dividend percent':cash(y.fcfCoverageBps) })),
    'Three exact grid prices': result.grid.map((g,i) => ({ level:i+1, 'Price CNY':g.priceMinor/100, 'D1 yield percent':g.yieldBps/100, 'Change from current price percent':g.changeFromCurrentBps/100, 'Cumulative allocation percent':g.cumulativePortionBps/100, 'Meets selected margin':g.meetsSafetyMargin })), 'Sources':result.sourceUrls };
}
