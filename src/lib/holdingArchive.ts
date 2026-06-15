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
