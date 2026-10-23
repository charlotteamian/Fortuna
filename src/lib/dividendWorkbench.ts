import type { DividendTrend } from './dividendTrend';
import type { Account, Holding, HoldingTxn } from '../db';
import { computeHoldingPosition } from './holdingPosition.ts';
import { getHoldingMode } from './productPortfolio.ts';
import { mainlandQuoteSymbol, parseDividendMarketQuote } from './dividendQuote.ts';
import { gridAnnualDps, isDividendDataV2, latestReportDividend, parseDividendAnnouncements, type DividendAnnouncement } from './dividendForecast.ts';
export { latestReportDividend, forecastHoldingYearDividends, gridAnnualDps } from './dividendForecast.ts';
export type { DividendAnnouncement, LatestReportDividend, HoldingYearDividendEvent, HoldingYearDividendForecast } from './dividendForecast.ts';

export interface DividendPayment { exDate: string; reportDate: string; dpsMicros: number }
export interface DividendData {
  /** Absent on legacy TTM caches; those remain importable but cannot serve the new display. */
  schemaVersion?: 2;
  announcements?: DividendAnnouncement[];
  scheduleSourceUrl?: string;
  scheduleFetchedAt?: number;
  scheduleFailedAt?: number;
  asOf: string; windowStart: string; dpsMicros: number; payments: DividendPayment[];
  pending?: { reportDate: string; dpsMicros: number; status: string };
  financial?: { reportDate: string; bvpsMicros?: number; profitGrowthPercent?: number };
  fetchedAt: number;
}
export interface DividendQuote { priceMinor: number; date: string; changePercent?: number; fetchedAt: number }
export interface GridLevel { yieldBps: number; portionBps: number; priceMinor?: number }
export interface DividendStock {
  code: string; name: string; group: 'core' | 'watch' | 'hidden'; weightBps: number;
  shareMode: 'linked' | 'manual'; manualShares: number;
  manualDpsMicros?: number; lotSize: number; note?: string;
  buyLevels?: GridLevel[]; sellLevels?: GridLevel[];
  buyPaused?: boolean;
  quote?: DividendQuote; dividend?: DividendData;
  quoteFailedAt?: number; dividendFailedAt?: number;
  trend?: DividendTrend; trendFailedAt?: number;
}

export const BUY_LEVELS: GridLevel[] = [500, 550, 600, 650, 700, 750, 800].map((yieldBps, i) => ({ yieldBps, portionBps: i === 0 ? 4000 : 1000 }));
export const SELL_LEVELS: GridLevel[] = [450, 400, 350, 300].map(yieldBps => ({ yieldBps, portionBps: 2500 }));

// The user's supplied workbook owns the initial groups and relative weights.
// No sample quote or historic manually entered dividend is treated as live data.
export function defaultDividendStocks(): DividendStock[] {
  const rows: [string, string, DividendStock['group'], number][] = [
    ['601398', '工商银行', 'core', 500], ['600036', '招商银行', 'core', 1000],
    ['601088', '中国神华', 'core', 600], ['000651', '格力电器', 'core', 1150],
    ['601166', '兴业银行', 'core', 1150], ['600011', '华能国际', 'core', 800],
    ['600690', '海尔智家', 'watch', 800], ['000333', '美的集团', 'watch', 750],
    ['000001', '平安银行', 'watch', 600], ['000543', '皖能电力', 'watch', 500],
    ['601318', '中国平安', 'watch', 750], ['000538', '云南白药', 'hidden', 600],
    ['000423', '东阿阿胶', 'hidden', 400], ['002032', '苏泊尔', 'hidden', 400],
    ['600900', '长江电力', 'watch', 0], ['601939', '建设银行', 'watch', 0],
    ['601288', '农业银行', 'watch', 0], ['601225', '陕西煤业', 'watch', 0],
    ['600941', '中国移动', 'watch', 0],
  ];
  return rows.map(([code, name, group, weightBps]) => ({ code, name, group, weightBps, shareMode: 'linked', manualShares: 0, lotSize: 100 }));
}

/** Only mainland equities: six-digit US/HK codes and funds must not silently link. */
export function mainlandCode(symbol: string): string | null {
  const match = symbol.trim().toUpperCase().match(/^(?:(?:SH|SZ|BJ)[.:]?)?((?:60|68|00|30|43|83|87|88|92)\d{4})(?:\.(?:SH|SZ|BJ))?$/);
  return match?.[1] ?? null;
}
export const quoteSymbol = mainlandQuoteSymbol;
export function dateInChina(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function trailingYearStart(asOf: string): string {
  const [year, month, day] = asOf.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
function finiteNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseDividendResponse(raw: unknown, code: string, asOf = dateInChina(), now = Date.now()): DividendData {
  const envelope = raw as { success?: boolean; result?: { data?: Record<string, unknown>[]; pages?: number } };
  if (envelope?.success !== true || !Array.isArray(envelope.result?.data)) throw new Error('DIVIDEND_SOURCE_INVALID');
  const rows = envelope.result.data;
  // A truncated response cannot establish a complete event history.
  if ((envelope.result.pages ?? 1) > 1) throw new Error('DIVIDEND_SOURCE_INCOMPLETE');
  if (rows.some(row => String(row.SECURITY_CODE) !== code)) throw new Error('DIVIDEND_SYMBOL_MISMATCH');
  const windowStart = trailingYearStart(asOf);
  const announcements = parseDividendAnnouncements(rows, code, asOf);
  const payments: DividendPayment[] = [];
  const seen = new Set<string>();
  let pending: DividendData['pending'];
  for (const announcement of announcements) {
    const { status, exDate, reportDate, dpsMicros, stage } = announcement;
    if (dpsMicros === undefined) continue;
    if (stage !== 'implemented' || !exDate || exDate > asOf) {
      if (!['cancelled', 'none'].includes(stage) && dpsMicros > 0 && (!pending || reportDate > pending.reportDate)) {
        pending = { reportDate, dpsMicros, status };
      }
      continue;
    }
    if (exDate <= windowStart) continue;
    const key = `${reportDate}:${exDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payments.push({ exDate, reportDate, dpsMicros });
  }
  const disclosedPeriods = new Set(announcements.map(item => item.reportDate));
  const latestReport = [...rows].filter(row => disclosedPeriods.has(String(row.REPORT_DATE ?? '').slice(0,10)) && (finiteNumber(row.BVPS) !== null || finiteNumber(row.PNP_YOY_RATIO) !== null)).sort((a,b) => String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)))[0];
  const bvps = latestReport ? finiteNumber(latestReport.BVPS) : null;
  const profitGrowth = latestReport ? finiteNumber(latestReport.PNP_YOY_RATIO) : null;
  const financial = latestReport ? { reportDate: String(latestReport.REPORT_DATE).slice(0,10), bvpsMicros: bvps !== null && bvps > 0 ? Math.round(bvps*1e6) : undefined, profitGrowthPercent: profitGrowth ?? undefined } : undefined;
  payments.sort((a, b) => b.exDate.localeCompare(a.exDate));
  return { schemaVersion: 2, announcements, asOf, windowStart, dpsMicros: payments.reduce((sum, row) => sum + row.dpsMicros, 0), payments, pending, financial, fetchedAt: now };
}

export function parseDividendQuote(text: string, code: string, now = Date.now()): DividendQuote {
  const quote = parseDividendMarketQuote(text, code, now);
  return { priceMinor: Math.round(quote.priceMicros / 10000), date: quote.date, changePercent: quote.changePercent, fetchedAt: quote.fetchedAt };
}

export interface LinkedDividendPosition { code: string; name: string; shares: number; sources: { accountName: string; holdingId: string; shares: number }[] }
export function linkedDividendPositions(accounts: Account[], holdings: Holding[], txns: HoldingTxn[], asOf = dateInChina()): Map<string, LinkedDividendPosition> {
  const accountMap = new Map(accounts.filter(a => !a.archivedAt && a.type === 'asset' && a.currency === 'CNY' && a.portfolio && ['股票/ETF', '股票'].includes(a.category)).map(a => [a.id, a]));
  const out = new Map<string, LinkedDividendPosition>();
  for (const holding of holdings) {
    const account = accountMap.get(holding.accountId);
    if (!account || holding.instrumentType || getHoldingMode(account.category, holding) !== 'unit' || /美|港|US|HK/i.test(holding.market ?? '')) continue;
    const code = mainlandCode(holding.symbol ?? '');
    if (!code) continue;
    const shares = computeHoldingPosition(txns.filter(tx => tx.holdingId === holding.id && tx.accountId === account.id && tx.date <= asOf)).shares;
    if (shares <= 0) continue;
    const row = out.get(code) ?? { code, name: holding.name, shares: 0, sources: [] };
    row.shares += shares;
    row.sources.push({ accountName: account.name, holdingId: holding.id, shares });
    out.set(code, row);
  }
  return out;
}
export function effectiveDps(stock: DividendStock): number | undefined { return latestReportDividend(stock)?.dpsMicros; }
export function dividendEstimateMinor(shares: number, dpsMicros: number): number { return Math.round(shares * dpsMicros / 10000); }
export function stockBudgetMinor(budgetMinor: number, weightBps: number): number { return Math.round(budgetMinor * weightBps / 10000); }

/** Execution plans include only stocks with an actual, positive allocation in minor units. */
export function fundedDividendStocks(stocks: DividendStock[], totalBudgetMinor: number | undefined): DividendStock[] {
  return totalBudgetMinor === undefined ? [] : stocks.filter(stock => stockBudgetMinor(totalBudgetMinor, stock.weightBps) > 0);
}

/** Holdings take priority, then the user's groups and allocation; never mutate the saved order. */
export function sortDividendStocks(stocks: DividendStock[], sharesFor: (stock: DividendStock) => number): DividendStock[] {
  const groupOrder = { core: 0, watch: 1, hidden: 2 };
  return [...stocks].sort((a, b) => Number(sharesFor(b) > 0) - Number(sharesFor(a) > 0)
    || groupOrder[a.group] - groupOrder[b.group] || b.weightBps - a.weightBps || a.code.localeCompare(b.code));
}

/** Reassign a removed allocation proportionally, preserving unallocated budget and zero weights. */
export function redistributeDividendWeights(stocks: DividendStock[], removedCode: string): DividendStock[] {
  const removed = stocks.find(stock => stock.code === removedCode);
  const remaining = stocks.filter(stock => stock.code !== removedCode);
  const remainingWeight = remaining.reduce((sum, stock) => sum + stock.weightBps, 0);
  if (!removed?.weightBps || remainingWeight === 0) return remaining;
  const targetWeight = Math.min(10000, remainingWeight + removed.weightBps);
  return scaleDividendWeights(remaining, targetWeight);
}

/** Allocate an explicit total in the existing proportions, keeping zero weights at zero. */
export function scaleDividendWeights(stocks: DividendStock[], targetWeight = 10000): DividendStock[] {
  if (!Number.isSafeInteger(targetWeight) || targetWeight < 0 || targetWeight > 10000) throw new Error('INVALID_DIVIDEND_WEIGHT');
  const remainingWeight = stocks.reduce((sum, stock) => sum + stock.weightBps, 0);
  if (remainingWeight === 0) return stocks.map(stock => ({ ...stock }));
  const allocations = stocks.map(stock => {
    const numerator = stock.weightBps * targetWeight;
    return { stock, weightBps: Math.floor(numerator / remainingWeight), remainder: numerator % remainingWeight };
  });
  const leftover = targetWeight - allocations.reduce((sum, row) => sum + row.weightBps, 0);
  // Largest remainders keep the stored total exact to 0.01%, with stable code ordering for ties.
  const ranked = [...allocations].sort((a, b) => b.remainder - a.remainder || a.stock.code.localeCompare(b.stock.code));
  for (let i = 0; i < leftover; i++) ranked[i].weightBps++;
  return allocations.map(({ stock, weightBps }) => ({ ...stock, weightBps }));
}

export function buildGrid(stock: DividendStock, budgetMinor: number, shares: number, side: 'buy' | 'sell', asOf = dateInChina()) {
  let cumulative = 0;
  let cumulativeBuyShares = 0;
  let completePrices = true;
  const dps = gridAnnualDps(stock, asOf);
  const levels = side === 'buy' ? stock.buyLevels ?? BUY_LEVELS : stock.sellLevels ?? SELL_LEVELS;
  return levels.map(level => {
    cumulative += level.portionBps;
    const priceMinor = level.priceMinor ?? (dps !== undefined && dps > 0 && level.yieldBps > 0 ? Math.round(dps / level.yieldBps) : undefined);
    if (priceMinor) cumulativeBuyShares += stockBudgetMinor(budgetMinor, level.portionBps) / priceMinor;
    else completePrices = false;
    const targetShares = completePrices && side === 'buy' ? Math.floor(cumulativeBuyShares / stock.lotSize) * stock.lotSize : undefined;
    const displayYieldBps = level.priceMinor ? dps === undefined ? undefined : dps / level.priceMinor : level.yieldBps;
    const sellShares = side === 'sell' ? (cumulative >= 10000 ? shares : Math.floor(shares * cumulative / 10000 / stock.lotSize) * stock.lotSize) : undefined;
    const priceTouched = Boolean(priceMinor && stock.quote && (side === 'buy' ? stock.quote.priceMinor <= priceMinor : stock.quote.priceMinor >= priceMinor));
    const touched = priceTouched && (side === 'buy' ? !stock.buyPaused : shares > 0);
    return { ...level, displayYieldBps, cumulative, priceMinor, targetShares, sellShares, priceTouched, touched };
  });
}

/** Describe the saved plan against current holdings, without presenting cumulative targets as new orders. */
export function buildDividendHomePlan(stock: DividendStock, totalBudgetMinor: number | undefined, shares: number, asOf = dateInChina()) {
  const budgetMinor = totalBudgetMinor === undefined ? undefined : stockBudgetMinor(totalBudgetMinor, stock.weightBps);
  const quoteDate = stock.quote?.date.slice(0, 10);
  const quoteAge = quoteDate ? (Date.parse(asOf) - Date.parse(quoteDate)) / 86400000 : NaN;
  const quoteUsable = !!stock.quote && Number.isSafeInteger(stock.quote.priceMinor) && stock.quote.priceMinor > 0
    && stock.quoteFailedAt === undefined && quoteAge >= 0 && quoteAge <= 10;
  // Price touches remain visible when the user pauses execution or has no sellable shares.
  const buy = buildGrid(stock, budgetMinor ?? 0, shares, 'buy', asOf).map(row => ({ ...row, touched: quoteUsable && row.priceTouched }));
  const sell = buildGrid(stock, budgetMinor ?? 0, shares, 'sell', asOf).map(row => ({ ...row, touched: quoteUsable && row.priceTouched }));
  const touchedBuy = buy.filter(row => row.touched);
  const buyTargetShares = Math.max(0, ...touchedBuy.map(row => row.targetShares ?? 0));
  const additionalBuyShares = Math.max(0, Math.floor((buyTargetShares - shares) / stock.lotSize) * stock.lotSize);
  const sellShares = Math.max(0, ...sell.filter(row => row.touched).map(row => row.sellShares ?? 0));
  const buyState = stock.buyPaused ? 'paused' : budgetMinor === undefined ? 'budget_missing' : budgetMinor <= 0 ? 'budget_empty'
    : buy.every(row => row.priceMinor === undefined) ? 'price_missing' : !quoteUsable ? 'quote_missing'
    : touchedBuy.length && touchedBuy.every(row => row.targetShares === undefined) ? 'price_missing'
    : additionalBuyShares > 0 ? 'triggered' : touchedBuy.length ? buyTargetShares > shares || buyTargetShares <= 0 ? 'below_lot' : 'covered' : 'waiting';
  const sellState = shares <= 0 ? 'no_holding' : sell.every(row => row.priceMinor === undefined) ? 'price_missing'
    : !quoteUsable ? 'quote_missing' : sellShares > 0 ? 'triggered' : 'waiting';
  const buyTriggeredLevel = buy.findLastIndex(row => row.touched) + 1;
  const sellTriggeredLevel = sell.findLastIndex(row => row.touched) + 1;
  return { budgetMinor, buy, sell, buyState, sellState, additionalBuyShares, sellShares, quoteUsable, buyTriggeredLevel, sellTriggeredLevel,
    incompletePrices: [...buy, ...sell].some(row => row.priceMinor === undefined) };
}

export function isDividendStock(raw: unknown): raw is DividendStock {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as DividendStock;
  const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
  const validLevels = (levels: GridLevel[] | undefined) => levels === undefined || (Array.isArray(levels) && levels.length > 0 && levels.length <= 20 && levels.every(l => integer(l.yieldBps, 10000) && l.yieldBps > 0 && integer(l.portionBps, 10000) && (l.priceMinor === undefined || integer(l.priceMinor) && l.priceMinor > 0)) && levels.reduce((n,l) => n + l.portionBps, 0) <= 10000);
  return typeof s.code === 'string' && mainlandCode(s.code) === s.code && typeof s.name === 'string' && s.name.trim().length > 0 && ['core', 'watch', 'hidden'].includes(s.group) && integer(s.weightBps, 10000) && ['linked', 'manual'].includes(s.shareMode) && Number.isFinite(s.manualShares) && s.manualShares >= 0 && integer(s.lotSize, 10000) && s.lotSize > 0 && (s.manualDpsMicros === undefined || integer(s.manualDpsMicros)) && validLevels(s.buyLevels) && validLevels(s.sellLevels)
    && (s.buyPaused === undefined || typeof s.buyPaused === 'boolean')
    && (s.quote === undefined || integer(s.quote.priceMinor) && s.quote.priceMinor > 0 && typeof s.quote.date === 'string' && integer(s.quote.fetchedAt))
    && (s.dividend === undefined || integer(s.dividend.dpsMicros) && typeof s.dividend.asOf === 'string' && typeof s.dividend.windowStart === 'string' && integer(s.dividend.fetchedAt) && Array.isArray(s.dividend.payments) && s.dividend.payments.every(p => typeof p.exDate === 'string' && typeof p.reportDate === 'string' && integer(p.dpsMicros)) && isDividendDataV2(s.dividend));
}
