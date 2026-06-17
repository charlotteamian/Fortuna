export type HoldingMode = 'unit' | 'balance';

const EXCLUDED_ASSET_PORTFOLIO_CATEGORIES = new Set(['现金', '贵金属', '房产']);
const UNIT_HOLDING_CATEGORIES = new Set(['股票/ETF', '股票', '场外基金', '数字货币']);
const LIVE_QUOTE_CATEGORIES = new Set(['股票/ETF', '股票', '场外基金']);

export function isProductPortfolioCategory(category: string, type: 'asset' | 'liability'): boolean {
  if (type !== 'asset') return false;
  return !EXCLUDED_ASSET_PORTFOLIO_CATEGORIES.has(category);
}

export function getDefaultHoldingModeForCategory(category: string): HoldingMode {
  return UNIT_HOLDING_CATEGORIES.has(category) ? 'unit' : 'balance';
}

export function getHoldingMode(category: string, holding?: { mode?: HoldingMode }): HoldingMode {
  return holding?.mode ?? getDefaultHoldingModeForCategory(category);
}

export function usesBalanceHoldings(category: string, holding?: { mode?: HoldingMode }): boolean {
  return getHoldingMode(category, holding) === 'balance';
}

export function usesLiveQuotes(category: string): boolean {
  return LIVE_QUOTE_CATEGORIES.has(category);
}
