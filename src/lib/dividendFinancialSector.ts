/** Specialist numeric screens replace industrial leverage and free-cash-flow rules. */
export interface DividendFinancialSectorMetric {
  key: string;
  valueBps?: number;
  thresholdBps?: number;
  direction: 'minimum' | 'maximum';
  status: 'pass' | 'risk' | 'unknown';
  reportDate: string;
  changeBps?: number;
  comparisonReportDate?: string;
  basis?: 'previous_year_same_period' | 'overdue_90_days_to_npl' | 'retained_roe_vs_rwa';
  sourceUrls?: string[];
  capitalInputs?: { roeBps: number; payoutBps: number; rwaGrowthBps: number; priorReportDate: string };
}

/** Normalised original-report observations. Provider totals are not substitutes for these fields. */
export interface DividendBankReportEvidence {
  code: string;
  reportDate: string;
  publishedAt: string;
  verifiedAt: string;
  sourceUrls: string[];
  verified: boolean;
  specialMentionLoansBps?: number;
  overdue90DaysLoansMinor?: number;
  nonPerformingLoansMinor?: number;
  riskWeightedAssetsMinor?: number;
  payoutBps?: number;
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
export function reviewDividendFinancialSector(available: Record<string, unknown>[], code: string, asOf: string,
  bankEvidence: DividendBankReportEvidence[] = []): DividendFinancialSectorReview | undefined {
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
  if (sector === 'bank') {
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    const evidence = bankEvidence.filter(row => row && row.code === code && row.verified === true
      && validDate(row.reportDate) && validDate(row.publishedAt) && validDate(row.verifiedAt) && row.reportDate <= row.publishedAt
      && row.publishedAt <= asOf && row.publishedAt <= row.verifiedAt && row.verifiedAt <= asOf
      && Array.isArray(row.sourceUrls) && row.sourceUrls.length > 0 && row.sourceUrls.every(url => /^https:\/\//.test(url)));
    const valid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
    const observed = (period: string, key: keyof DividendBankReportEvidence) => {
      const maximum = key === 'specialMentionLoansBps' ? 10000 : key === 'payoutBps' ? 50000 : Number.MAX_SAFE_INTEGER;
      const rows = evidence.filter(row => row.reportDate === period && valid(row[key]) && (row[key] as number) <= maximum);
      const values = [...new Set(rows.map(row => row[key] as number))];
      return { value: values.length === 1 ? values[0] : undefined,
        sources: [...new Set(rows.flatMap(row => row.sourceUrls))], conflict: values.length > 1 };
    };
    const append = (metric: DividendFinancialSectorMetric) => {
      metrics.push(metric);
      if (metric.status === 'unknown') missing.push(metric.key);
    };
    const latestPeriod = String(available[0].REPORT_DATE).slice(0, 10);
    const latestPrior = `${Number(latestPeriod.slice(0, 4)) - 1}${latestPeriod.slice(4)}`;
    const latestStale = Date.parse(asOf) - Date.parse(latestPeriod) > 230 * 86400000;
    const special = observed(latestPeriod, 'specialMentionLoansBps'), priorSpecial = observed(latestPrior, 'specialMentionLoansBps');
    const specialValue = latestStale ? undefined : special.value;
    append({ key: 'specialMentionLoans', valueBps: specialValue, thresholdBps: priorSpecial.value, direction: 'maximum', reportDate: latestPeriod,
      comparisonReportDate: latestPrior, basis: 'previous_year_same_period', sourceUrls: [...new Set([...special.sources, ...priorSpecial.sources])],
      changeBps: specialValue !== undefined && priorSpecial.value !== undefined ? specialValue - priorSpecial.value : undefined,
      status: specialValue === undefined || priorSpecial.value === undefined ? 'unknown' : specialValue <= priorSpecial.value ? 'pass' : 'risk' });
    const overdue = observed(latestPeriod, 'overdue90DaysLoansMinor'), nonPerforming = observed(latestPeriod, 'nonPerformingLoansMinor');
    const deviation = !latestStale && overdue.value !== undefined && nonPerforming.value !== undefined && nonPerforming.value > 0
      ? Number((BigInt(overdue.value) * 10000n + BigInt(nonPerforming.value) / 2n) / BigInt(nonPerforming.value)) : undefined;
    append({ key: 'overdue90DaysDeviation', valueBps: deviation, thresholdBps: 10000, direction: 'maximum', reportDate: latestPeriod,
      basis: 'overdue_90_days_to_npl', sourceUrls: [...new Set([...overdue.sources, ...nonPerforming.sources])],
      status: deviation === undefined ? 'unknown' : deviation <= 10000 ? 'pass' : 'risk' });
    const marginRow = available.find(row => numeric(row.NET_INTEREST_MARGIN) !== undefined);
    const marginPeriod = String(marginRow?.REPORT_DATE ?? available[0].REPORT_DATE).slice(0, 10);
    const marginPriorPeriod = `${Number(marginPeriod.slice(0, 4)) - 1}${marginPeriod.slice(4)}`;
    const marginStale = Date.parse(asOf) - Date.parse(marginPeriod) > 230 * 86400000;
    const margin = marginStale ? undefined : numeric(marginRow?.NET_INTEREST_MARGIN);
    const priorMargin = numeric(available.find(row => String(row.REPORT_DATE).slice(0, 10) === marginPriorPeriod)?.NET_INTEREST_MARGIN);
    append({ key: 'netInterestMargin', valueBps: margin, thresholdBps: priorMargin, direction: 'minimum', reportDate: marginPeriod,
      comparisonReportDate: marginPriorPeriod, basis: 'previous_year_same_period',
      changeBps: margin !== undefined && priorMargin !== undefined ? margin - priorMargin : undefined,
      status: margin === undefined || priorMargin === undefined ? 'unknown' : margin >= priorMargin ? 'pass' : 'risk' });
    const annual = available.find(row => String(row.REPORT_DATE).slice(0, 10).endsWith('-12-31'));
    const annualPeriod = String(annual?.REPORT_DATE ?? '').slice(0, 10);
    const annualPriorPeriod = annualPeriod ? `${Number(annualPeriod.slice(0, 4)) - 1}${annualPeriod.slice(4)}` : '';
    const annualRoe = numeric(annual?.ROEJQ), payout = observed(annualPeriod, 'payoutBps');
    const rwa = observed(annualPeriod, 'riskWeightedAssetsMinor'), priorRwa = observed(annualPriorPeriod, 'riskWeightedAssetsMinor');
    const annualCutoff = new Date(`${asOf}T00:00:00Z`); annualCutoff.setUTCMonth(annualCutoff.getUTCMonth() - 15);
    const capitalCurrent = annualPeriod >= annualCutoff.toISOString().slice(0, 10);
    const capitalComplete = capitalCurrent && annualRoe !== undefined && Number.isSafeInteger(annualRoe) && payout.value !== undefined
      && rwa.value !== undefined && priorRwa.value !== undefined && priorRwa.value > 0;
    const retention = capitalComplete ? Math.round(annualRoe! * (10000 - payout.value!) / 10000) : undefined;
    const rwaGrowth = capitalComplete ? Math.round((rwa.value! - priorRwa.value!) / priorRwa.value! * 10000) : undefined;
    const capitalSufficient = capitalComplete && BigInt(annualRoe!) * BigInt(10000 - payout.value!) * BigInt(priorRwa.value!)
      >= BigInt(rwa.value! - priorRwa.value!) * 100000000n;
    append({ key: 'internalCapitalCapacity', valueBps: retention, thresholdBps: rwaGrowth, direction: 'minimum', reportDate: annualPeriod || latestPeriod,
      comparisonReportDate: annualPriorPeriod || undefined, basis: 'retained_roe_vs_rwa',
      sourceUrls: [...new Set([...payout.sources, ...rwa.sources, ...priorRwa.sources])],
      capitalInputs: capitalComplete ? { roeBps: annualRoe!, payoutBps: payout.value!, rwaGrowthBps: rwaGrowth!, priorReportDate: annualPriorPeriod } : undefined,
      status: retention === undefined || rwaGrowth === undefined ? 'unknown' : capitalSufficient ? 'pass' : 'risk' });
    if ([special, priorSpecial, overdue, nonPerforming, payout, rwa, priorRwa].some(value => value.conflict)) missing.push('bankReportConflict');
  }
  // The structured source exposes only comprehensive solvency. Never infer core capital or the risk rating from it.
  if (sector === 'insurance') missing.push('coreSolvency', 'insuranceRiskRating');
  if (sector === 'other_financial') missing.push('financialSectorEvidence');
  let reportSupplement: DividendFinancialSectorReview['reportSupplement'];
  const supplement = PING_AN_H1_2026;
  // The issuer's group report explicitly says no integrated risk rating has yet
  // been conducted for insurance groups. Do not substitute a subsidiary rating.
  // This extract was verified against the feed's 198.10% representation of the
  // report's 198.14%. A changed value keeps the explicit missing-evidence state.
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
