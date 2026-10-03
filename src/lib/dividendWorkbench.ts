import type { DividendTrend } from './dividendTrend';
import type { Account, Holding, HoldingTxn } from '../db';
import { computeHoldingPosition } from './holdingPosition.ts';
import { getHoldingMode } from './productPortfolio.ts';

export interface DividendPayment { exDate: string; reportDate: string; dpsMicros: number }
export interface DividendData {
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
export function quoteSymbol(code: string) { return `${code.startsWith('6') ? 'sh' : /^(4|8|9)/.test(code) ? 'bj' : 'sz'}${code}`; }
export function dateInChina(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
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
  // A truncated response cannot establish a complete trailing-year total.
  if ((envelope.result.pages ?? 1) > 1) throw new Error('DIVIDEND_SOURCE_INCOMPLETE');
  if (rows.some(row => String(row.SECURITY_CODE) !== code)) throw new Error('DIVIDEND_SYMBOL_MISMATCH');
  const windowStart = trailingYearStart(asOf);
  const payments: DividendPayment[] = [];
  const seen = new Set<string>();
  let pending: DividendData['pending'];
  for (const row of rows) {
    const amount = finiteNumber(row.PRETAX_BONUS_RMB);
    if (amount === null || amount < 0) continue;
    const status = String(row.ASSIGN_PROGRESS ?? '');
    const exDate = String(row.EX_DIVIDEND_DATE ?? '').slice(0, 10);
    const reportDate = String(row.REPORT_DATE ?? '').slice(0, 10);
    const dpsMicros = Math.round(amount * 100000); // RMB per 10 shares → RMB/share × 1e6
    if (!['实施', '实施分配'].includes(status) || !/^\d{4}-\d{2}-\d{2}$/.test(exDate) || exDate > asOf) {
      if (!/取消|不分配|终止/.test(status) && amount > 0 && (!pending || reportDate > pending.reportDate)) {
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
  if (pending && rows.some(row => ['实施', '实施分配'].includes(String(row.ASSIGN_PROGRESS)) && String(row.REPORT_DATE).slice(0, 10) === pending!.reportDate && String(row.EX_DIVIDEND_DATE).slice(0, 10) <= asOf)) pending = undefined;
  const latestReport = [...rows].filter(row => String(row.REPORT_DATE ?? '').slice(0,10) <= asOf && (finiteNumber(row.BVPS) !== null || finiteNumber(row.PNP_YOY_RATIO) !== null)).sort((a,b) => String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)))[0];
  const bvps = latestReport ? finiteNumber(latestReport.BVPS) : null;
  const profitGrowth = latestReport ? finiteNumber(latestReport.PNP_YOY_RATIO) : null;
  const financial = latestReport ? { reportDate: String(latestReport.REPORT_DATE).slice(0,10), bvpsMicros: bvps !== null && bvps > 0 ? Math.round(bvps*1e6) : undefined, profitGrowthPercent: profitGrowth ?? undefined } : undefined;
  payments.sort((a, b) => b.exDate.localeCompare(a.exDate));
  return { asOf, windowStart, dpsMicros: payments.reduce((sum, row) => sum + row.dpsMicros, 0), payments, pending, financial, fetchedAt: now };
}

export function parseDividendQuote(text: string, code: string, now = Date.now()): DividendQuote {
  const match = text.match(new RegExp(`v_${quoteSymbol(code)}="([^"]*)"`));
  const fields = match?.[1].split('~');
  const price = finiteNumber(fields?.[3]);
  const stamp = fields?.[30] ?? '';
  if (!fields || fields[2] !== code || !price || price <= 0 || !/^\d{14}$/.test(stamp)) throw new Error('QUOTE_SOURCE_INVALID');
  return { priceMinor: Math.round(price * 100), date: `${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}`, changePercent: finiteNumber(fields[32]) ?? undefined, fetchedAt: now };
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
export function effectiveDps(stock: DividendStock): number | undefined { return stock.manualDpsMicros ?? stock.dividend?.dpsMicros; }
export function dividendEstimateMinor(shares: number, dpsMicros: number): number { return Math.round(shares * dpsMicros / 10000); }
export function stockBudgetMinor(budgetMinor: number, weightBps: number): number { return Math.round(budgetMinor * weightBps / 10000); }
export function buildGrid(stock: DividendStock, budgetMinor: number, shares: number, side: 'buy' | 'sell') {
  let cumulative = 0;
  let cumulativeBuyShares = 0;
  let completePrices = true;
  const dps = effectiveDps(stock);
  const levels = side === 'buy' ? stock.buyLevels ?? BUY_LEVELS : stock.sellLevels ?? SELL_LEVELS;
  return levels.map(level => {
    cumulative += level.portionBps;
    const priceMinor = level.priceMinor ?? (dps !== undefined && dps > 0 && level.yieldBps > 0 ? Math.round(dps / level.yieldBps) : undefined);
    if (priceMinor) cumulativeBuyShares += stockBudgetMinor(budgetMinor, level.portionBps) / priceMinor;
    else completePrices = false;
    const targetShares = completePrices && side === 'buy' ? Math.floor(cumulativeBuyShares / stock.lotSize) * stock.lotSize : undefined;
    const displayYieldBps = level.priceMinor ? dps === undefined ? undefined : dps / level.priceMinor : level.yieldBps;
    const sellShares = side === 'sell' ? (cumulative >= 10000 ? shares : Math.floor(shares * cumulative / 10000 / stock.lotSize) * stock.lotSize) : undefined;
    const touched = Boolean(priceMinor && stock.quote && (side === 'buy' ? stock.quote.priceMinor <= priceMinor : shares > 0 && stock.quote.priceMinor >= priceMinor));
    return { ...level, displayYieldBps, cumulative, priceMinor, targetShares, sellShares, touched };
  });
}

export function isDividendStock(raw: unknown): raw is DividendStock {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as DividendStock;
  const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
  const validLevels = (levels: GridLevel[] | undefined) => levels === undefined || (Array.isArray(levels) && levels.length > 0 && levels.length <= 20 && levels.every(l => integer(l.yieldBps, 10000) && l.yieldBps > 0 && integer(l.portionBps, 10000) && (l.priceMinor === undefined || integer(l.priceMinor) && l.priceMinor > 0)) && levels.reduce((n,l) => n + l.portionBps, 0) <= 10000);
  return typeof s.code === 'string' && mainlandCode(s.code) === s.code && typeof s.name === 'string' && s.name.trim().length > 0 && ['core', 'watch', 'hidden'].includes(s.group) && integer(s.weightBps, 10000) && ['linked', 'manual'].includes(s.shareMode) && Number.isFinite(s.manualShares) && s.manualShares >= 0 && integer(s.lotSize, 10000) && s.lotSize > 0 && (s.manualDpsMicros === undefined || integer(s.manualDpsMicros)) && validLevels(s.buyLevels) && validLevels(s.sellLevels)
    && (s.quote === undefined || integer(s.quote.priceMinor) && s.quote.priceMinor > 0 && typeof s.quote.date === 'string' && integer(s.quote.fetchedAt))
    && (s.dividend === undefined || integer(s.dividend.dpsMicros) && typeof s.dividend.asOf === 'string' && typeof s.dividend.windowStart === 'string' && integer(s.dividend.fetchedAt) && Array.isArray(s.dividend.payments) && s.dividend.payments.every(p => typeof p.exDate === 'string' && typeof p.reportDate === 'string' && integer(p.dpsMicros)));
}
