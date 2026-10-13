import type { Holding, HoldingTxn } from '../db';
import { canonicalImportMarket, normalizeHoldingIdentity } from './holdingImportIdentity.ts';

const ARCHIVED_SHARE_EPSILON = 1e-6;

export interface PositionedHolding {
  position: {
    shares: number;
  };
}

export function isArchivedHolding(holding: PositionedHolding): boolean {
  return holding.position.shares <= ARCHIVED_SHARE_EPSILON;
}

export function splitHoldingsByArchive<T extends PositionedHolding>(holdings: T[]): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];

  for (const holding of holdings) {
    if (isArchivedHolding(holding)) archived.push(holding);
    else active.push(holding);
  }

  return { active, archived };
}

/** Reuse the import market aliases; explicit non-stock types remain Other. */
export function getArchivedHoldingMarket(holding: Pick<Holding, 'market' | 'symbol' | 'instrumentType'>): string {
  if (holding.instrumentType === 'us_option') return '美股';
  try {
    if (holding.market?.trim()) return canonicalImportMarket(holding.market) ?? '其他';
    if (holding.symbol?.trim()) return normalizeHoldingIdentity(holding.symbol).market;
  } catch { /* Older/manual records can have unrecognised labels or no market. */ }
  return '其他';
}

/** All dated records count, including a position/balance calibration that closed it. */
export function getHoldingLastRecordDates(txns: Pick<HoldingTxn, 'holdingId' | 'date'>[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const tx of txns) {
    if (!tx.date) continue;
    const previous = dates.get(tx.holdingId);
    if (!previous || tx.date > previous) dates.set(tx.holdingId, tx.date);
  }
  return dates;
}
