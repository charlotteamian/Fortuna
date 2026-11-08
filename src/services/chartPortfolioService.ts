import { db } from '../db';
import { buildAccountNavPoints, getEligibleNavAccounts } from '../lib/chartPortfolioNav';

export async function getChartPortfolios() {
  const [accounts, holdings, txns] = await Promise.all([db.accounts.orderBy('sortOrder').toArray(), db.holdings.toArray(), db.holdingTxns.toArray()]);
  return getEligibleNavAccounts(accounts).map(account => ({
    account,
    points: buildAccountNavPoints(account.id, holdings, txns),
  }));
}
