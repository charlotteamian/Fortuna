import type { DividendFund } from './dividendFundPlan';

export interface DividendFundExample {
  code: string;
  nameKey: string;
  indexKind: DividendFund['indexKind'];
  indexKey: string;
  productKey: string;
  marketKey: string;
  managementFeeBps: number;
  custodyFeeBps: number;
  sourceUrl: string;
}

// Public product information, checked on this date. Fees are annual basis points.
// This catalogue is separate from saved plans and contains no prices or entry signals.
export const DIVIDEND_FUND_CATALOG_AS_OF = '2026-10-08';
export const DIVIDEND_FUND_EXAMPLES: readonly DividendFundExample[] = [
  { code: '512890', nameKey: 'df_fund_512890', indexKind: 'low_volatility', indexKey: 'df_catalog_index_low_volatility', productKey: 'df_product_etf', marketKey: 'df_market_shanghai', managementFeeBps: 50, custodyFeeBps: 10,
    sourceUrl: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-18/512890_20260318_FNWM.pdf' },
  { code: '563020', nameKey: 'df_fund_563020', indexKind: 'low_volatility', indexKey: 'df_catalog_index_low_volatility', productKey: 'df_product_etf', marketKey: 'df_market_shanghai', managementFeeBps: 15, custodyFeeBps: 5,
    sourceUrl: 'https://www.efunds.com.cn/fund/563020.shtml' },
  { code: '005561', nameKey: 'df_fund_005561', indexKind: 'low_volatility', indexKey: 'df_catalog_index_low_volatility', productKey: 'df_product_index', marketKey: 'df_market_off_exchange', managementFeeBps: 50, custodyFeeBps: 10,
    sourceUrl: 'https://e.boc.cn/cmsimage/ezcms/public/89968496/20241213/eb1dd17987474d1ba3a8c87c64e31f85.pdf' },
  { code: '159547', nameKey: 'df_fund_159547', indexKind: 'low_volatility', indexKey: 'df_catalog_index_low_volatility', productKey: 'df_product_etf', marketKey: 'df_market_shenzhen', managementFeeBps: 15, custodyFeeBps: 5,
    sourceUrl: 'https://fund.chinaamc.com/fund/159547/jijinfeilv.shtml' },
  { code: '560150', nameKey: 'df_fund_560150', indexKind: 'low_volatility', indexKey: 'df_catalog_index_low_volatility', productKey: 'df_product_etf', marketKey: 'df_market_shanghai', managementFeeBps: 40, custodyFeeBps: 10,
    sourceUrl: 'https://www.tkfunds.com.cn/products/ETF/560150/feilv/index.html' },
  { code: '515180', nameKey: 'df_fund_515180', indexKind: 'other', indexKey: 'df_catalog_index_dividend', productKey: 'df_product_etf', marketKey: 'df_market_shanghai', managementFeeBps: 15, custodyFeeBps: 5,
    sourceUrl: 'https://www.efunds.com.cn/fund/515180.shtml' },
  { code: '515080', nameKey: 'df_fund_515080', indexKind: 'other', indexKey: 'df_catalog_index_dividend', productKey: 'df_product_etf', marketKey: 'df_market_shanghai', managementFeeBps: 20, custodyFeeBps: 10,
    sourceUrl: 'https://static.cmfchina.com/web/fundDetail/515080/index.html' },
  { code: '100032', nameKey: 'df_fund_100032', indexKind: 'other', indexKey: 'df_catalog_index_dividend', productKey: 'df_product_enhanced', marketKey: 'df_market_off_exchange', managementFeeBps: 120, custodyFeeBps: 20,
    sourceUrl: 'https://www.fullgoal.com.cn/fundDetail/100032/index.html' },
  { code: '090010', nameKey: 'df_fund_090010', indexKind: 'other', indexKey: 'df_catalog_index_dividend', productKey: 'df_product_index', marketKey: 'df_market_off_exchange', managementFeeBps: 75, custodyFeeBps: 15,
    sourceUrl: 'https://www.dcfund.com.cn/plat_files/upload/ann_upload/20260330/202603301774868519904.pdf' },
  { code: '159581', nameKey: 'df_fund_159581', indexKind: 'other', indexKey: 'df_catalog_index_dividend', productKey: 'df_product_etf', marketKey: 'df_market_shenzhen', managementFeeBps: 50, custodyFeeBps: 10,
    sourceUrl: 'https://www.wjasset.com/products/etf/159581/index.html' },
];
