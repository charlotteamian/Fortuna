import { db, initializeSettings } from '../db';
import { buildAccountNavPoints, getEligibleNavAccounts } from '../lib/chartPortfolioNav';

export async function getChartPortfolios() {
  const [settings, accounts, holdings, txns] = await Promise.all([
    initializeSettings(),
    db.accounts.orderBy('sortOrder').toArray(),
    db.holdings.toArray(),
    db.holdingTxns.toArray(),
  ]);
  const feeSettings = {
    defaultCommissionRatePercent: settings.defaultCommissionRatePercent,
    minCommission: settings.minCommission,
  };
  return getEligibleNavAccounts(accounts).map(account => ({
    account,
    points: buildAccountNavPoints(account.id, holdings, txns, feeSettings, account.category),
  }));
}
