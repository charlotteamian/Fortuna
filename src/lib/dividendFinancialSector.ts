/** Specialist numeric screens replace industrial leverage and free-cash-flow rules. */
export interface DividendFinancialSectorMetric {
  key: string;
  valueBps?: number;
  thresholdBps: number;
  direction: 'minimum' | 'maximum';
  status: 'pass' | 'risk' | 'unknown';
  reportDate: string;
  changeBps?: number;
}
export interface DividendFinancialSectorReview {
  sector: 'bank' | 'insurance' | 'securities' | 'other_financial';
  status: 'pass' | 'risk' | 'unknown';
  asOf: string;
  metrics: DividendFinancialSectorMetric[];
  sourceUrl: string;
  policySourceUrls: string[];
  missing: string[];
  basis: 'dividend_screen' | 'published_regulatory_minimum';
  reportSupplement?: {
    reportDate: string;
    publishedAt: string;
    verifiedAt: string;
    sourceUrl: string;
    sha256: string;
    pdfPages: number[];
    insuranceRiskRating: 'not_applicable_to_group';
  };
}

// Source-verified archival evidence, explicitly distinct from the live structured
// feed. Never carry this extract into a newer reporting period or beyond expiry.
const PING_AN_H1_2026 = {
  reportDate:'2026-06-30', publishedAt:'2026-08-21', verifiedAt:'2026-10-21',
  sourceUrl:'https://group.pingan.com/resource/pingan/IR-Docs/2026/Summary-of-Solvency-Report-of-PAG-for-1H-2026.pdf',
  sha256:'aae32edfa330a1e206e7f9f91afd55c44cb1360880b55ba3258a7588b7423958',
  pdfPages:[22,24,34], insuranceRiskRating:'not_applicable_to_group' as const,
};

function numeric(value: unknown) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

/** Rows must already have passed security-code and publication-date validation. */
export function reviewDividendFinancialSector(available: Record<string, unknown>[], code: string, asOf: string): DividendFinancialSectorReview | undefined {
  const kind = String(available[0]?.ORG_TYPE ?? '');
  if (!/银行|保险|证券|金融|信托/.test(kind)) return undefined;
  const sector = /银行/.test(kind) ? 'bank' : /保险/.test(kind) ? 'insurance' : /证券/.test(kind) ? 'securities' : 'other_financial';
  const definitions: [string, string, number, 'minimum' | 'maximum'][] = sector === 'bank' ? [
    // These are dividend-screen buffers, not a certification of bank-specific regulatory compliance.
    ['capitalAdequacy', 'NEWCAPITALADER', 1200, 'minimum'], ['coreTier1', 'HXYJBCZL', 900, 'minimum'],
    ['nonPerformingLoan', 'NONPERLOAN', 300, 'maximum'], ['provisionCoverage', 'BLDKBBL', 15000, 'minimum'],
  ] : sector === 'securities' ? [
    ['riskCoverage', 'RISK_COVERAGE', 10000, 'minimum'], ['capitalLeverage', 'CAPITAL_LEVERAGE_RATIO', 800, 'minimum'],
    ['liquidityCoverage', 'LIQUIDITY_COVERAGE_RATIO', 10000, 'minimum'], ['netStableFunding', 'NET_FUNDING_RATIO', 10000, 'minimum'],
  ] : sector === 'insurance' ? [['comprehensiveSolvency', 'SOLVENCY_AR', 10000, 'minimum']] : [];
  const missing: string[] = [];
  const metrics = definitions.map(([key, field, thresholdBps, direction]): DividendFinancialSectorMetric => {
    const row = available.find(r => numeric(r[field]) !== undefined);
    const reportDate = String(row?.REPORT_DATE ?? available[0].REPORT_DATE).slice(0, 10);
    const stale = Date.parse(asOf) - Date.parse(reportDate) > 230 * 86400000;
    const valueBps = stale ? undefined : numeric(row?.[field]);
    const previousYear = `${Number(reportDate.slice(0, 4)) - 1}${reportDate.slice(4)}`;
    const priorValue = numeric(available.find(r => String(r.REPORT_DATE).slice(0, 10) === previousYear)?.[field]);
    if (valueBps === undefined) missing.push(key);
    return { key, valueBps, thresholdBps, direction, reportDate,
      changeBps: valueBps !== undefined && priorValue !== undefined ? valueBps - priorValue : undefined,
      status: valueBps === undefined ? 'unknown' : (direction === 'minimum' ? valueBps >= thresholdBps : valueBps <= thresholdBps) ? 'pass' : 'risk' };
  });
  // The structured source exposes only comprehensive solvency. Never infer core capital or the risk rating from it.
  if (sector === 'insurance') missing.push('coreSolvency', 'insuranceRiskRating');
  if (sector === 'other_financial') missing.push('financialSectorEvidence');
  let reportSupplement: DividendFinancialSectorReview['reportSupplement'];
  const supplement = PING_AN_H1_2026;
  // The issuer's group report explicitly says no integrated risk rating has yet
  // been conducted for insurance groups. Do not substitute a subsidiary rating.
  if (code === '601318' && sector === 'insurance' && asOf >= supplement.publishedAt
    && String(available[0].REPORT_DATE).slice(0,10) === supplement.reportDate
    && Date.parse(asOf) - Date.parse(supplement.reportDate) <= 230 * 86400000
    && metrics[0]?.valueBps === 19810) {
    metrics[0].valueBps = 19814;
    metrics[0].changeBps = undefined;
    metrics.push({ key:'coreSolvency', valueBps:16560, thresholdBps:5000, direction:'minimum', status:'pass', reportDate:supplement.reportDate });
    missing.splice(missing.indexOf('coreSolvency'), 1);
    missing.splice(missing.indexOf('insuranceRiskRating'), 1);
    reportSupplement = { ...supplement, pdfPages:[...supplement.pdfPages] };
  }
  const status = metrics.some(m => m.status === 'risk') ? 'risk' : missing.length ? 'unknown' : 'pass';
  return { sector, status, asOf: metrics.map(m => m.reportDate).sort().at(-1) ?? String(available[0].REPORT_DATE).slice(0, 10), metrics, missing,
    reportSupplement,
    basis: sector === 'bank' || sector === 'other_financial' ? 'dividend_screen' : 'published_regulatory_minimum',
    sourceUrl: `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/Index?type=web&code=${code.startsWith('6') ? 'SH' : 'SZ'}${code}`,
    policySourceUrls: sector === 'securities' ? ['https://www.csrc.gov.cn/csrc/c106256/c1653957/content.shtml']
      : sector === 'insurance' ? ['https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId=962016&generaltype=0&itemId=925']
        : ['https://www.nfra.gov.cn/cn/view/pages/rulesDetail.html?docId=1134197&itemId=4214'] };
}
