export type HoldingMode = 'unit' | 'balance';

const EXCLUDED_ASSET_PORTFOLIO_CATEGORIES = new Set(['现金', '贵金属', '房产']);
const UNIT_HOLDING_CATEGORIES = new Set(['股票/ETF', '股票', '场外基金', '数字货币']);
const LIVE_QUOTE_CATEGORIES = new Set(['股票/ETF', '股票', '场外基金']);
const PRODUCT_CODE_CATEGORIES = new Set(['理财产品', '债券', '债权', '数字货币', '其他资产']);

export interface ProductHoldingField {
  key: string;
  labelKey: string;
  placeholderKey?: string;
  required?: boolean;
}

const PRODUCT_HOLDING_FIELDS: Record<string, ProductHoldingField[]> = {
  银行存款: [
    { key: 'rate', labelKey: 'f_rate', placeholderKey: 'f_rate_ph', required: true },
    { key: 'maturity', labelKey: 'f_maturity', placeholderKey: 'f_maturity_ph', required: true },
  ],
};

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

export function shouldShowProductCodeForCategory(category: string): boolean {
  return PRODUCT_CODE_CATEGORIES.has(category);
}

export function getProductHoldingFields(category: string): ProductHoldingField[] {
  return PRODUCT_HOLDING_FIELDS[category] ?? [];
}
