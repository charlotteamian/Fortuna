import { db } from '../db';
import { buildAccountNavPoints, getEligibleNavAccounts } from '../lib/chartPortfolioNav';

export async function getChartPortfolios() {
  const [accounts, records] = await Promise.all([db.accounts.orderBy('sortOrder').toArray(), db.records.toArray()]);
  return getEligibleNavAccounts(accounts).map(account => ({
    account,
    points: buildAccountNavPoints(account.id, records),
  }));
}
