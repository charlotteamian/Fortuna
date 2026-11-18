import type { ClassicGridTierRow, ClassicStockPlan } from './dividendClassicStrategy.ts';

export interface DividendStockTableRow {
  key: string;
  side: 'buy' | 'sell';
  level: number;
  active: boolean;
  priceText: string;
  cumulativePercent: number;
  amountMajor?: number;
}

export interface DividendStockTableModel {
  hasHolding: boolean;
  buyRows: DividendStockTableRow[];
  sellRows: DividendStockTableRow[];
}

/**
 * Formats a ClassicStockPlan into the 3-column plan-page table
 * (threshold price, cumulative position %, and cumulative target/sell amount).
 */
export function buildDividendStockTableModel(
  plan: ClassicStockPlan,
  activeStatus: 'buy' | 'sell' | string,
): DividendStockTableModel {
  const budgetMajor = plan.budgetMinor !== undefined ? plan.budgetMinor / 100 : undefined;
  const hasHolding = plan.shares > 0;

  const mapRow = (side: 'buy' | 'sell') => (row: ClassicGridTierRow): DividendStockTableRow => {
    const active = row.touched && activeStatus === side;
    const prefix = side === 'buy' ? '≤' : '≥';
    const priceText = row.priceMinor > 0 ? `${prefix}¥${(row.priceMinor / 100).toFixed(2)}` : '—';
    const amountMajor = side === 'buy'
      ? (budgetMajor !== undefined ? (budgetMajor * row.cumulativePortionBps) / 10000 : undefined)
      : (hasHolding && row.sellShares !== undefined && row.priceMinor > 0
        ? (row.sellShares * row.priceMinor) / 100
        : undefined);

    return {
      key: `${side}-${row.level}`,
      side,
      level: row.level,
      active,
      priceText,
      cumulativePercent: row.cumulativePortionBps / 100,
      amountMajor,
    };
  };

  return {
    hasHolding,
    buyRows: plan.buyRows.map(mapRow('buy')),
    sellRows: plan.sellRows.map(mapRow('sell')),
  };
}
