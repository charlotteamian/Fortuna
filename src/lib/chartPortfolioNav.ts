import { computePortfolioUnitNav, type PortfolioNavInputPoint } from './balanceFlow.ts';

interface PortfolioAccountLike {
  id: string;
  type: 'asset' | 'liability';
  portfolio?: boolean;
  hidden?: boolean;
  archivedAt?: number;
}

interface PortfolioRecordLike {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  createdAt: number;
  deltaAmount?: number;
  kind?: 'buy' | 'sell';
  balanceAdjustment?: boolean;
}

/** Statistics are an explicit opt-in for actual portfolio accounts, independent of global totals. */
export function getEligibleNavAccounts<T extends PortfolioAccountLike>(accounts: readonly T[]): T[] {
  return accounts.filter(account => account.type === 'asset' && account.portfolio === true && !account.hidden && !account.archivedAt);
}

export function normalizeNavAccountIds(ids: readonly string[] | undefined, accounts: readonly PortfolioAccountLike[]): string[] {
  const eligible = new Set(getEligibleNavAccounts(accounts).map(account => account.id));
  return [...new Set(Array.isArray(ids) ? ids : [])].filter(id => eligible.has(id));
}

/** Use this account's own recorded valuations and explicit principal flows; never infer flows from value changes. */
export function buildAccountNavPoints(accountId: string, records: readonly PortfolioRecordLike[]): PortfolioNavInputPoint[] {
  const byDate = new Map<string, { record: PortfolioRecordLike; flowMinor: number }>();
  const ordered = records.filter(record => record.accountId === accountId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const record of ordered) {
    if (!Number.isFinite(record.amount) || record.amount < 0) continue;
    const previous = byDate.get(record.date);
    let flowMinor = previous?.flowMinor ?? 0;
    if (!record.balanceAdjustment && Number.isFinite(record.deltaAmount) && record.kind) {
      flowMinor += Math.round(Math.max(0, record.deltaAmount ?? 0) * 100) * (record.kind === 'buy' ? 1 : -1);
    }
    byDate.set(record.date, { record, flowMinor });
  }
  return [...byDate.entries()].map(([date, { record, flowMinor }]) => ({
    date,
    totalValue: Math.round(record.amount * 100),
    netFlow: flowMinor,
  }));
}

export function summarizeAccountNav(points: readonly PortfolioNavInputPoint[], fromDate?: string) {
  const filtered = points.filter(point => !fromDate || point.date >= fromDate);
  return computePortfolioUnitNav(filtered.map((point, index) => ({ ...point, netFlow: index === 0 ? 0 : point.netFlow })));
}
