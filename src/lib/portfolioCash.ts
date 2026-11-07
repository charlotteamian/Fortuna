import type { Account } from '../db';

interface CashHolding {
  marketValue: number;
  position: { realizedPnl: number };
}

export function usesCalculatedPortfolioCash(account: Pick<Account, 'category' | 'portfolio' | 'cashCalculationMode' | 'cashInitialAmountMinor'>): boolean {
  return Boolean(account.portfolio)
    && ['股票/ETF', '股票'].includes(account.category)
    && account.cashCalculationMode === 'initial-minus-holdings'
    && Number.isSafeInteger(account.cashInitialAmountMinor)
    && (account.cashInitialAmountMinor ?? -1) >= 0;
}

/** Keep the user's reverse calculation in minor units, including a possible negative balance. */
export function calculatePortfolioCash(account: Pick<Account, 'category' | 'portfolio' | 'cashBalance' | 'cashCalculationMode' | 'cashInitialAmountMinor'>, holdings: CashHolding[]) {
  const marketValueMinor = Math.round(holdings.reduce((sum, holding) => sum + holding.marketValue, 0) * 100);
  const realizedPnlMinor = Math.round(holdings.reduce((sum, holding) => sum + holding.position.realizedPnl, 0) * 100);
  const calculated = usesCalculatedPortfolioCash(account);
  const cashMinor = calculated
    ? account.cashInitialAmountMinor! + realizedPnlMinor - marketValueMinor
    : Math.round((account.cashBalance ?? 0) * 100);
  return { calculated, cashMinor, marketValueMinor, realizedPnlMinor };
}
