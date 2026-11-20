import { db, DEFAULT_COMMISSION_RATE_PERCENT, initializeSettings } from '../db';
import { buildAccountNavPoints, getEligibleNavAccounts } from '../lib/chartPortfolioNav';

export async function getChartPortfolios() {
  const [settings, accounts, holdings, txns] = await Promise.all([
    initializeSettings(),
    db.accounts.orderBy('sortOrder').toArray(),
    db.holdings.toArray(),
    db.holdingTxns.toArray(),
  ]);
  const defaultRate = settings.defaultCommissionRatePercent ?? DEFAULT_COMMISSION_RATE_PERCENT;
  return getEligibleNavAccounts(accounts).map(account => ({
    account,
    points: buildAccountNavPoints(account.id, holdings, txns, defaultRate, account.category),
  }));
}
