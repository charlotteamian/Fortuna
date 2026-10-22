import type { DividendData, DividendStock } from './dividendWorkbench.ts';

export type DividendStage = 'proposal' | 'approved' | 'implemented' | 'cancelled' | 'none';
export interface DividendAnnouncement {
  reportDate: string;
  period: 'Q1' | 'H1' | 'Q3' | 'FY' | 'other';
  /** Missing for a policy announcement that has not disclosed a per-share amount. */
  dpsMicros?: number;
  announcedAt: string;
  stage: DividendStage;
  status: string;
  sourceUrl: string;
  recordDate?: string;
  exDate?: string;
  paymentDate?: string;
  paymentSourceUrl?: string;
  nonRecurring?: boolean;
}
export interface LatestReportDividend extends DividendAnnouncement {
  basis: 'latest-report' | 'manual';
  annualized: false;
  reportEventCount: number;
}
export interface HoldingYearDividendEvent {
  reportDate: string;
  dpsMicros: number;
  basis: 'announced' | 'historical';
  basisDate: string;
  /** Original fiscal period supplying an estimated amount, never a current disclosure. */
  basisReportDate?: string;
  /** The current announcement exists but has not supplied its per-share amount. */
  amountUnannounced?: boolean;
  stage: DividendStage;
  expectedExDate: string;
  expectedPaymentDate?: string;
  dateEstimated: boolean;
  recordDate?: string;
  sourceUrl: string;
}
export interface HoldingYearDividendForecast {
  asOf: string;
  through: string;
  dpsMicros?: number;
  amountMinor?: number;
  announcedDpsMicros: number;
  historicalDpsMicros: number;
  events: HoldingYearDividendEvent[];
  basisDate?: string;
  missingReason?: 'refresh-required' | 'no-history' | 'no-upcoming-period' | 'amount-unannounced' | 'schedule-unknown';
  incompleteReportDates: string[];
}

export function validDividendDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
function chinaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shiftYear(value: string, years = 1): string {
  const [year, month, day] = value.split('-').map(Number);
  const max = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return `${year + years}-${String(month).padStart(2, '0')}-${String(Math.min(day, max)).padStart(2, '0')}`;
}
function reportPeriod(reportDate: string): DividendAnnouncement['period'] {
  return ({ '03-31': 'Q1', '06-30': 'H1', '09-30': 'Q3', '12-31': 'FY' } as const)[reportDate.slice(5)] ?? 'other';
}
function stageFor(status: string): DividendStage {
  if (/取消|终止|撤回/.test(status)) return 'cancelled';
  if (/不分配|不分红|不派|不实施/.test(status)) return 'none';
  if (/实施/.test(status)) return 'implemented';
  if (/股东|通过/.test(status)) return 'approved';
  return 'proposal';
}
function numeric(raw: unknown): number | undefined {
  if (raw === '' || raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'number' && typeof raw !== 'string' || typeof raw === 'string' && !/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(raw)) throw new Error('DIVIDEND_AMOUNT_INVALID');
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100000))) throw new Error('DIVIDEND_AMOUNT_INVALID');
  return value;
}

/** Dated events in one report can be ordinary and special dividends; revisions replace their event. */
export function parseDividendAnnouncements(rows: Record<string, unknown>[], code: string, asOf: string): DividendAnnouncement[] {
  const byPeriod = new Map<string, DividendAnnouncement>();
  for (const row of rows) {
    const reportDate = validDividendDate(row.REPORT_DATE);
    const announcedAt = [validDividendDate(row.NOTICE_DATE), validDividendDate(row.PLAN_NOTICE_DATE), validDividendDate(row.PUBLISH_DATE)].filter((value): value is string => Boolean(value)).sort().at(-1);
    // Reporting period alone is not proof the information was publicly available.
    if (!reportDate || !announcedAt || reportDate > asOf || announcedAt > asOf) continue;
    const status = String(row.ASSIGN_PROGRESS ?? '');
    const stage = stageFor(`${status} ${String(row.IMPL_PLAN_PROFILE ?? '')}`);
    const amount = numeric(row.PRETAX_BONUS_RMB);
    if (amount !== undefined && amount < 0) continue;
    const candidate: DividendAnnouncement = {
      reportDate, period: reportPeriod(reportDate), announcedAt, status, stage,
      dpsMicros: stage === 'cancelled' || stage === 'none' ? 0 : amount === undefined ? undefined : Math.round(amount * 100000),
      sourceUrl: `https://data.eastmoney.com/yjfp/detail/${code}.html`,
      recordDate: validDividendDate(row.EQUITY_RECORD_DATE),
      exDate: validDividendDate(row.EX_DIVIDEND_DATE),
      paymentDate: validDividendDate(row.PAY_CASH_DATE) ?? validDividendDate(row.DIVIDEND_DATE) ?? validDividendDate(row.PAYMENT_DATE),
      ...(/特别|一次性|特殊股息/.test(String(row.IMPL_PLAN_PROFILE ?? '')) ? {nonRecurring:true} : {}),
    };
    const key = `${reportDate}:${candidate.exDate ?? candidate.recordDate ?? 'unscheduled'}`;
    const previous = byPeriod.get(key);
    const priority = { proposal: 0, approved: 1, implemented: 2, none: 3, cancelled: 4 };
    if (!previous || candidate.announcedAt > previous.announcedAt || candidate.announcedAt === previous.announcedAt && priority[candidate.stage] > priority[previous.stage]) byPeriod.set(key, candidate);
  }
  return [...byPeriod.values()].filter(item => {
    const cancellation=[...byPeriod.values()].find(other=>other.reportDate===item.reportDate && !other.exDate && !other.recordDate && ['cancelled','none'].includes(other.stage) && other.announcedAt>=item.announcedAt);
    if (cancellation && item!==cancellation && item.stage!=='implemented') return false;
    return item.exDate || item.recordDate || ![...byPeriod.values()].some(other => other.reportDate === item.reportDate && (other.exDate || other.recordDate) && other.announcedAt >= item.announcedAt);
  })
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.announcedAt.localeCompare(a.announcedAt));
}

/** The displayed numerator is the latest disclosed period, never a trailing sum or an annualisation. */
export function latestReportDividend(stock: DividendStock): LatestReportDividend | undefined {
  const latest = stock.dividend?.schemaVersion === 2 ? [...(stock.dividend.announcements ?? [])].sort((a,b) => b.reportDate.localeCompare(a.reportDate))[0] : undefined;
  if (!latest) return undefined;
  const group = stock.dividend!.announcements!.filter(item => item.reportDate === latest.reportDate);
  const active = group.filter(item => !['cancelled','none'].includes(item.stage));
  const complete = active.every(item => item.dpsMicros !== undefined) && !(active.some(item => !item.exDate && !item.recordDate) && active.some(item => item.stage === 'implemented'));
  const dpsMicros = complete ? active.reduce((sum,item) => sum + (item.dpsMicros ?? 0),0) : undefined;
  return { ...latest, ...(group.length > 1 ? {recordDate:undefined,exDate:undefined,paymentDate:undefined} : {}), dpsMicros, basis: 'latest-report', annualized: false, reportEventCount: group.length };
}

/** Yield-labelled grid plans require a full-year numerator; manual input is an explicit annual assumption. */
export function gridAnnualDps(stock: DividendStock, asOf = chinaToday()): number | undefined {
  return stock.manualDpsMicros ?? forecastHoldingYearDividends(stock, asOf).dpsMicros;
}

/**
 * Forecast the next calendar year of entitlement for a new holding today.
 * Disclosed amounts replace only their matching fiscal period. An announcement with
 * an unknown amount uses the exact prior-year period as an explicitly labelled estimate.
 * An already ex-dividend period supplies the following year's estimate, with its dates shifted forward.
 */
export function forecastHoldingYearDividends(stock: DividendStock, asOf = chinaToday(), shares = 1): HoldingYearDividendForecast {
  if (!validDividendDate(asOf) || !Number.isFinite(shares) || shares < 0 || shares > 1e12) throw new Error('INVALID_DIVIDEND_FORECAST');
  const through = shiftYear(asOf);
  const result: HoldingYearDividendForecast = { asOf, through, announcedDpsMicros: 0, historicalDpsMicros: 0, events: [], incompleteReportDates: [] };
  const data = stock.dividend;
  if (data?.schemaVersion !== 2 || !Array.isArray(data.announcements)) return { ...result, missingReason: 'refresh-required' };
  const announcements = data.announcements.filter(item => item.announcedAt <= asOf && item.reportDate <= asOf).sort((a,b) => b.reportDate.localeCompare(a.reportDate));
  const completed = announcements.filter(item => item.stage === 'implemented' && item.exDate && item.exDate <= asOf);
  const priorYearAmount = (item: DividendAnnouncement) => {
    if (item.nonRecurring) return undefined;
    const priorReportDate = shiftYear(item.reportDate, -1);
    const previous = completed.filter(old => old.reportDate === priorReportDate && !old.nonRecurring);
    // Several current events cannot each inherit a whole prior period's amount.
    // An ambiguous partial disclosure remains incomplete until its events can be matched.
    if (!previous.length || previous.some(old => old.dpsMicros === undefined)
      || announcements.filter(current => current.reportDate === item.reportDate && !['cancelled', 'none'].includes(current.stage)).length !== 1) return undefined;
    return { dpsMicros: previous.reduce((sum, old) => sum + old.dpsMicros!, 0),
      basisDate: previous.map(old => old.announcedAt).sort().at(-1)!, basisReportDate: priorReportDate, sourceUrl: previous[0].sourceUrl };
  };
  const recentCutoff = shiftYear(asOf, -1);
  // At day granularity, buying on record date is eligible if held at that day's close.
  const future = announcements.filter(item => !['cancelled', 'none'].includes(item.stage) && item.announcedAt > recentCutoff
    && !(item.stage === 'implemented' && !item.exDate && !item.recordDate)
    && (!item.exDate || item.exDate > asOf) && (!item.recordDate || item.recordDate >= asOf));
  const events = new Map<string, HoldingYearDividendEvent>();
  // Only the latest observed cycle of each reporting period establishes the cadence.
  // Do not resurrect a discontinued interim dividend from several years ago.
  const mostRecentBySeason = new Map<string, DividendAnnouncement>();
  for (const item of announcements) if (!mostRecentBySeason.has(item.reportDate.slice(5))) mostRecentBySeason.set(item.reportDate.slice(5), item);
  const newestFiscalYear = Math.max(...announcements.map(item => Number(item.reportDate.slice(0, 4))));
  let unknownSchedule = false;
  for (const item of announcements) if (item.stage === 'implemented' && !item.exDate && !item.recordDate && item.announcedAt > recentCutoff
    && mostRecentBySeason.get(item.reportDate.slice(5))?.reportDate === item.reportDate) { result.incompleteReportDates.push(item.reportDate); unknownSchedule = true; }
  for (const item of completed) {
    if (item.nonRecurring) continue;
    if (mostRecentBySeason.get(item.reportDate.slice(5))?.reportDate !== item.reportDate || Number(item.reportDate.slice(0, 4)) < newestFiscalYear - 1) continue;
    const expectedExDate = shiftYear(item.exDate!);
    const reportDate = shiftYear(item.reportDate);
    const expectedPaymentDate = item.paymentDate ? shiftYear(item.paymentDate) : undefined;
    // One cadence shift is enough; older evidence must not be rolled forward forever.
    if (expectedExDate <= asOf || expectedExDate > through) continue;
    if (announcements.some(known => known.reportDate === reportDate)) continue;
    // Payment may fall after ex-date; entitlement controls eligibility, payment controls receipt window when known.
    if (expectedPaymentDate && expectedPaymentDate > through) continue;
    if (item.dpsMicros === undefined) { result.incompleteReportDates.push(reportDate); continue; }
    if (item.dpsMicros <= 0) continue;
    events.set(`${reportDate}:${expectedExDate}`, { reportDate, dpsMicros: item.dpsMicros, basis: 'historical', basisDate: item.announcedAt,
      basisReportDate: item.reportDate, stage: 'implemented', expectedExDate, expectedPaymentDate, dateEstimated: true, sourceUrl: item.sourceUrl });
  }
  for (const item of future) {
    const prior = completed.filter(old => old.reportDate.slice(5) === item.reportDate.slice(5)).sort((a,b) => b.reportDate.localeCompare(a.reportDate))[0];
    const yearDelta = prior ? Number(item.reportDate.slice(0, 4)) - Number(prior.reportDate.slice(0, 4)) : 0;
    const seasonalExDate = prior?.exDate && yearDelta > 0 ? shiftYear(prior.exDate, yearDelta) : undefined;
    // If an announcement has no schedule/history, retain its amount in this horizon
    // and use a clearly estimated date, never fabricate an official pay date.
    const expectedExDate = item.exDate ?? (seasonalExDate && seasonalExDate > asOf ? seasonalExDate : through);
    if (expectedExDate <= asOf || expectedExDate > through || item.paymentDate && item.paymentDate > through) continue;
    const previousAmount = item.dpsMicros === undefined ? priorYearAmount(item) : undefined;
    const dpsMicros = item.dpsMicros ?? previousAmount?.dpsMicros;
    if (dpsMicros === undefined) { result.incompleteReportDates.push(item.reportDate); continue; }
    events.set(`${item.reportDate}:${expectedExDate}`, { reportDate: item.reportDate, dpsMicros, basis: previousAmount ? 'historical' : 'announced',
      basisDate: previousAmount?.basisDate ?? item.announcedAt, basisReportDate: previousAmount?.basisReportDate,
      amountUnannounced: item.dpsMicros === undefined || undefined,
      stage: item.stage, expectedExDate, expectedPaymentDate: item.paymentDate, dateEstimated: !item.exDate,
      recordDate: item.recordDate, sourceUrl: previousAmount?.sourceUrl ?? item.sourceUrl });
  }
  // Explicit cancellation/non-distribution is evidence for zero; it also blocks the
  // same season's prior-year extrapolation, already handled by report-date matching.
  const noDividend = [...mostRecentBySeason.values()].some(item => item.period === 'FY' && item.announcedAt > recentCutoff && item.dpsMicros === 0 && ['none', 'cancelled', 'implemented'].includes(item.stage));
  const ordered = [...events.values()].sort((a, b) => a.expectedExDate.localeCompare(b.expectedExDate));
  result.events = ordered;
  result.announcedDpsMicros = ordered.filter(item => item.basis === 'announced').reduce((sum, item) => sum + item.dpsMicros, 0);
  result.historicalDpsMicros = ordered.filter(item => item.basis === 'historical').reduce((sum, item) => sum + item.dpsMicros, 0);
  result.basisDate = announcements.map(item => item.announcedAt).sort().at(-1);
  if (!result.incompleteReportDates.length && (ordered.length || noDividend)) {
    result.dpsMicros = result.announcedDpsMicros + result.historicalDpsMicros;
    const amount = Math.round(shares * result.dpsMicros / 10000);
    if (Number.isSafeInteger(amount)) result.amountMinor = amount;
  } else result.missingReason = unknownSchedule ? 'schedule-unknown' : result.incompleteReportDates.length ? 'amount-unannounced' : announcements.length ? 'no-upcoming-period' : 'no-history';
  return result;
}

/** The F10 structured schedule includes PAY_CASH_DATE, absent from the main report API. */
export function enrichDividendPaymentDates(data: DividendData, raw: unknown, code: string, now = Date.now()): DividendData {
  const envelope = raw as { fhyx?: Record<string, unknown>[] };
  if (!Array.isArray(envelope?.fhyx)) throw new Error('DIVIDEND_SCHEDULE_INVALID');
  if (envelope.fhyx.some(row => String(row.SECURITY_CODE) !== code)) throw new Error('DIVIDEND_SCHEDULE_SYMBOL_MISMATCH');
  const sourceUrl = `https://emweb.eastmoney.com/PC_HSF10/BonusFinancing/Index?code=${code.startsWith('6') ? 'SH' : code.startsWith('0') || code.startsWith('3') ? 'SZ' : 'BJ'}${code}&type=web`;
  const announcements = data.announcements?.map(item => {
    const matched = envelope.fhyx!.filter(row => validDividendDate(row.EX_DIVIDEND_DATE) === item.exDate && item.exDate !== undefined
      && Boolean(validDividendDate(row.NOTICE_DATE)) && validDividendDate(row.NOTICE_DATE)! <= data.asOf).sort((a, b) => String(b.NOTICE_DATE).localeCompare(String(a.NOTICE_DATE)))[0];
    const paymentDate = matched ? validDividendDate(matched.PAY_CASH_DATE) : undefined;
    return paymentDate ? { ...item, paymentDate, paymentSourceUrl: sourceUrl } : item;
  });
  return { ...data, announcements, scheduleSourceUrl: sourceUrl, scheduleFetchedAt: now, scheduleFailedAt: undefined };
}

export function isDividendDataV2(data: DividendData): boolean {
  const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  return data.schemaVersion === undefined || data.schemaVersion === 2 && Array.isArray(data.announcements) && data.announcements.every(item =>
    validDividendDate(item.reportDate) && validDividendDate(item.announcedAt) && (item.dpsMicros === undefined || integer(item.dpsMicros)) && ['proposal', 'approved', 'implemented', 'cancelled', 'none'].includes(item.stage)
    && ['Q1', 'H1', 'Q3', 'FY', 'other'].includes(item.period) && typeof item.status === 'string' && typeof item.sourceUrl === 'string'
    && (item.nonRecurring === undefined || typeof item.nonRecurring === 'boolean')
    && [item.recordDate, item.exDate, item.paymentDate].every(value => value === undefined || Boolean(validDividendDate(value))));
}
