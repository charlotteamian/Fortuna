import { dateInChina } from './dividendWorkbench.ts';

export type DividendStrategy = 'stocks' | 'funds';
export type DividendFundMode = 'hold' | 'rebalance' | 'swing';
export interface DividendFund {
  id: string;
  name: string;
  code?: string;
  indexKind: 'low_volatility' | 'low_volatility_100' | 'other';
  weightBps: number; // share of the dividend-fund sleeve, not the entire stock/bond plan
  note?: string;
  reference?: {
    priceMicros?: number;
    highMicros?: number;
    indexYieldBps?: number; // underlying index yield, never the fund's cash distribution rate
    asOf: string;
    source?: string;
  };
}
export interface DividendFundPlan {
  budgetMinor?: number; // entire strategy budget in CNY cents
  mode: DividendFundMode;
  entryRule: 'both' | 'either';
  drawdownBps: number;
  indexYieldBps: number;
  funds: DividendFund[];
}

export function defaultDividendFundPlan(): DividendFundPlan {
  return { mode: 'hold', entryRule: 'both', drawdownBps: 1000, indexYieldBps: 500, funds: [] };
}

const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= dateInChina();
}
export function isDividendFund(value: unknown): value is DividendFund {
  if (!value || typeof value !== 'object') return false;
  const fund = value as DividendFund;
  if (!text(fund.id, 100) || !text(fund.name, 120) || (fund.code !== undefined && (typeof fund.code !== 'string' || !/^\d{6}$/.test(fund.code)))
    || !['low_volatility', 'low_volatility_100', 'other'].includes(fund.indexKind)
    || !integer(fund.weightBps, 0, 10000) || (fund.note !== undefined && (typeof fund.note !== 'string' || fund.note.length > 2000))) return false;
  const ref = fund.reference;
  return ref === undefined || (!!ref && typeof ref === 'object' && validDate(ref.asOf)
    && (ref.priceMicros === undefined || integer(ref.priceMicros, 1, 1e12))
    && (ref.highMicros === undefined || integer(ref.highMicros, 1, 1e12))
    && (ref.indexYieldBps === undefined || integer(ref.indexYieldBps, 0, 10000))
    && [ref.priceMicros, ref.highMicros, ref.indexYieldBps].some(value => value !== undefined)
    && (ref.source === undefined || (typeof ref.source === 'string' && ref.source.length <= 300)));
}
export function isDividendFundPlan(value: unknown): value is DividendFundPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as DividendFundPlan;
  if ((plan.budgetMinor !== undefined && !integer(plan.budgetMinor, 0, 1e14))
    || !['hold', 'rebalance', 'swing'].includes(plan.mode) || !['both', 'either'].includes(plan.entryRule)
    || !integer(plan.drawdownBps, 1, 9999) || !integer(plan.indexYieldBps, 1, 10000)
    || !Array.isArray(plan.funds) || plan.funds.length > 500 || !plan.funds.every(isDividendFund)) return false;
  const codes = plan.funds.flatMap(fund => fund.code ? [fund.code] : []);
  return new Set(plan.funds.map(fund => fund.id)).size === plan.funds.length
    && new Set(codes).size === codes.length && plan.funds.reduce((sum, fund) => sum + fund.weightBps, 0) <= 10000;
}

/** Largest-remainder allocation including the unassigned sleeve; every cent is accounted for. */
export function dividendFundAllocation(plan: DividendFundPlan) {
  const budget = plan.budgetMinor ?? 0;
  const fundBudgetMinor = plan.mode === 'rebalance' ? Number((BigInt(budget) * 7000n + 5000n) / 10000n) : budget;
  const totalWeightBps = plan.funds.reduce((sum, fund) => sum + fund.weightBps, 0);
  const rows = [...plan.funds.map(fund => ({ id: fund.id, weight: fund.weightBps })), { id: null, weight: 10000 - totalWeightBps }].map(row => {
    const numerator = BigInt(fundBudgetMinor) * BigInt(row.weight);
    return { id: row.id, amount: Number(numerator / 10000n), remainder: Number(numerator % 10000n) };
  });
  const cents = fundBudgetMinor - rows.reduce((sum, row) => sum + row.amount, 0);
  [...rows].sort((a, b) => b.remainder - a.remainder || (a.id ?? '').localeCompare(b.id ?? '')).slice(0, cents).forEach(row => row.amount++);
  return { fundBudgetMinor, bondBudgetMinor: budget - fundBudgetMinor, totalWeightBps,
    amounts: new Map(rows.filter(row => row.id !== null).map(row => [row.id!, row.amount])),
    unallocatedMinor: rows.find(row => row.id === null)!.amount };
}

/** Dated manual inputs remain visible but cannot produce a current entry signal. */
export function dividendFundEntry(plan: DividendFundPlan, fund: DividendFund, today = dateInChina()) {
  const ref = fund.reference;
  const drawdownBps = ref?.priceMicros !== undefined && ref.highMicros !== undefined
    ? Math.max(0, (ref.highMicros - ref.priceMicros) / ref.highMicros * 10000) : undefined;
  const targetPriceMicros = ref?.highMicros !== undefined ? Math.round(ref.highMicros * (10000 - plan.drawdownBps) / 10000) : undefined;
  const checks = [ref?.priceMicros === undefined || ref.highMicros === undefined ? null
    : BigInt(ref.highMicros - ref.priceMicros) * 10000n >= BigInt(ref.highMicros) * BigInt(plan.drawdownBps),
    ref?.indexYieldBps === undefined ? null : ref.indexYieldBps >= plan.indexYieldBps];
  const ready = plan.entryRule === 'both'
    ? checks.includes(false) ? false : checks.every(check => check === true) ? true : null
    : checks.includes(true) ? true : checks.every(check => check === false) ? false : null;
  const status = !ref || ref.asOf !== today ? 'update' : ready === null ? 'incomplete' : ready ? 'met' : 'wait';
  return { drawdownBps, targetPriceMicros, status };
}
