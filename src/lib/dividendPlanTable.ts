import {
  CLASSIC_BUY_YIELD_LADDER,
  CLASSIC_SELL_YIELD_LADDER,
  CLASSIC_TIER_PORTION_BPS,
  classicTierPriceForYield,
  type ClassicGridTierRow,
  type ClassicStockPlan,
} from './dividendClassicStrategy.ts';
import type { DividendStock, GridLevel } from './dividendWorkbench.ts';

export interface DividendStockTableRow {
  key: string;
  side: 'buy' | 'sell';
  level: number;
  active: boolean;
  yieldPercent: number;
  portionPercent: number;
  priceMinor: number;
  priceText: string;
  cumulativePercent: number;
  sellShares?: number;
  belowLot: boolean;
  amountMajor?: number;
}

export interface DividendStockTableModel {
  hasHolding: boolean;
  buyRows: DividendStockTableRow[];
  sellRows: DividendStockTableRow[];
}

export interface EditableStockGridRow {
  key: string;
  yieldText: string;
  priceText: string;
  portionText: string;
}

export interface EditableStockGridDraft {
  buy: EditableStockGridRow[];
  sell: EditableStockGridRow[];
}

const fmtNumText = (value: number) => String(Number(value.toFixed(2)));

/**
 * Formats a ClassicStockPlan into the 4-column plan-page table
 * (yield %, threshold price, cumulative position/trim %, and amount).
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
    const belowLot = side === 'sell' && hasHolding && row.sellShares === 0;
    const amountMajor = side === 'buy'
      ? (budgetMajor !== undefined ? (budgetMajor * row.cumulativePortionBps) / 10000 : undefined)
      : (hasHolding && row.sellShares !== undefined && row.sellShares > 0 && row.priceMinor > 0
        ? (row.sellShares * row.priceMinor) / 100
        : undefined);

    return {
      key: `${side}-${row.level}`,
      side,
      level: row.level,
      active,
      yieldPercent: row.yieldBps / 100,
      portionPercent: row.portionBps / 100,
      priceMinor: row.priceMinor,
      priceText,
      cumulativePercent: row.cumulativePortionBps / 100,
      ...(row.sellShares !== undefined ? { sellShares: row.sellShares } : {}),
      belowLot,
      amountMajor,
    };
  };

  return {
    hasHolding,
    buyRows: plan.buyRows.map(mapRow('buy')),
    sellRows: plan.sellRows.map(mapRow('sell')),
  };
}

function toEditableSide(
  side: 'buy' | 'sell',
  planRows: readonly ClassicGridTierRow[],
  savedLevels: readonly GridLevel[] | undefined,
  defaultYields: readonly number[],
): EditableStockGridRow[] {
  if (planRows.length > 0) {
    return planRows.map((row, idx) => ({
      key: `${side}-${idx + 1}`,
      yieldText: fmtNumText(row.yieldBps / 100),
      priceText: row.priceMinor > 0 ? (row.priceMinor / 100).toFixed(2) : '',
      portionText: fmtNumText(row.portionBps / 100),
    }));
  }
  if (savedLevels && savedLevels.length > 0) {
    return savedLevels.map((level, idx) => ({
      key: `${side}-${idx + 1}`,
      yieldText: fmtNumText(level.yieldBps / 100),
      priceText: level.priceMinor !== undefined && level.priceMinor > 0 ? (level.priceMinor / 100).toFixed(2) : '',
      portionText: fmtNumText(level.portionBps / 100),
    }));
  }
  return defaultYields.map((yieldBps, idx) => ({
    key: `${side}-${idx + 1}`,
    yieldText: fmtNumText(yieldBps / 100),
    priceText: '',
    portionText: fmtNumText(CLASSIC_TIER_PORTION_BPS / 100),
  }));
}

/** Seeds an editable buy/sell draft from the active stock plan or default yield tiers. */
export function createEditableStockGridDraft(
  plan: ClassicStockPlan,
  stock?: Pick<DividendStock, 'buyLevels' | 'sellLevels'>,
): EditableStockGridDraft {
  return {
    buy: toEditableSide('buy', plan.buyRows, stock?.buyLevels, CLASSIC_BUY_YIELD_LADDER),
    sell: toEditableSide('sell', plan.sellRows, stock?.sellLevels, CLASSIC_SELL_YIELD_LADDER),
  };
}

/** Updates yield text and syncs price when it was blank or matched the previous formula price. */
export function updateEditableStockGridYield(
  row: EditableStockGridRow,
  side: 'buy' | 'sell',
  nextYieldText: string,
  netDpsMicros?: number,
): EditableStockGridRow {
  if (!netDpsMicros || netDpsMicros <= 0) {
    return { ...row, yieldText: nextYieldText };
  }
  const prevYieldNum = Number(row.yieldText.trim());
  const prevYieldBps = Number.isFinite(prevYieldNum) && prevYieldNum > 0 ? Math.round(prevYieldNum * 100) : 0;
  const prevAutoText = prevYieldBps > 0 ? (classicTierPriceForYield(side, netDpsMicros, prevYieldBps) / 100).toFixed(2) : '';
  const curPriceTrimmed = row.priceText.trim();
  const shouldAutoUpdatePrice = !curPriceTrimmed || (prevAutoText && curPriceTrimmed === prevAutoText);
  if (!shouldAutoUpdatePrice) {
    return { ...row, yieldText: nextYieldText };
  }
  const nextYieldNum = Number(nextYieldText.trim());
  const nextYieldBps = Number.isFinite(nextYieldNum) && nextYieldNum > 0 && nextYieldNum <= 100
    ? Math.round(nextYieldNum * 100)
    : 0;
  return {
    ...row,
    yieldText: nextYieldText,
    priceText: nextYieldBps > 0 ? (classicTierPriceForYield(side, netDpsMicros, nextYieldBps) / 100).toFixed(2) : row.priceText,
  };
}

function parseSide(
  rows: readonly EditableStockGridRow[],
  side: 'buy' | 'sell',
  netDpsMicros?: number,
): { ok: true; levels: GridLevel[] } | { ok: false; errorKey: string } {
  if (rows.length === 0 || rows.length > 20) {
    return { ok: false, errorKey: 'plan_grid_invalid_rows' };
  }
  const levels: GridLevel[] = [];
  let portionSumBps = 0;
  for (const row of rows) {
    const yieldNum = Number(row.yieldText.trim());
    const portionNum = Number(row.portionText.trim());
    const yieldBps = row.yieldText.trim() && Number.isFinite(yieldNum) ? Math.round(yieldNum * 100) : NaN;
    const portionBps = row.portionText.trim() && Number.isFinite(portionNum) ? Math.round(portionNum * 100) : NaN;
    if (!Number.isSafeInteger(yieldBps) || yieldBps < 1 || yieldBps > 10000
      || !Number.isSafeInteger(portionBps) || portionBps < 0 || portionBps > 10000) {
      return { ok: false, errorKey: 'plan_grid_invalid_rows' };
    }
    portionSumBps += portionBps;
    const priceTrimmed = row.priceText.trim();
    let priceMinor: number | undefined;
    if (priceTrimmed) {
      const priceNum = Number(priceTrimmed);
      const rounded = Number.isFinite(priceNum) ? Math.round(priceNum * 100) : NaN;
      if (!Number.isSafeInteger(rounded) || rounded < 1) {
        return { ok: false, errorKey: 'plan_grid_invalid_rows' };
      }
      priceMinor = rounded;
    } else if (netDpsMicros && netDpsMicros > 0) {
      priceMinor = classicTierPriceForYield(side, netDpsMicros, yieldBps);
    } else {
      return { ok: false, errorKey: 'plan_grid_price_required' };
    }
    levels.push({ yieldBps, portionBps, priceMinor });
  }
  if (portionSumBps > 10000) {
    return { ok: false, errorKey: 'plan_grid_portion_over' };
  }
  return { ok: true, levels };
}

/** Validates and converts an inline buy/sell stock grid draft into persistable GridLevel arrays. */
export function parseEditableStockGridDraft(
  draft: EditableStockGridDraft,
  netDpsMicros?: number,
): { ok: true; buyLevels: GridLevel[]; sellLevels: GridLevel[] } | { ok: false; errorKey: string } {
  const buy = parseSide(draft.buy, 'buy', netDpsMicros);
  if (!buy.ok) return buy;
  const sell = parseSide(draft.sell, 'sell', netDpsMicros);
  if (!sell.ok) return sell;
  return { ok: true, buyLevels: buy.levels, sellLevels: sell.levels };
}
