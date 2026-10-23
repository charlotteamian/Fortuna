/** Historical issuer disclosures checked on 2026-10-23, not a live report download. */
export interface DividendAnnualReportEvidence {
  year: number;
  publishedAt: string;
  verifiedAt: string;
  basis: 'reported_no_dividend' | 'reported_implemented_cash';
  dividendMicros: number;
  dividendCashMinor: number;
  netProfitMinor: number;
  sources: { url: string; pdfPages: number[] }[];
}

// The structured distribution feed omits CATL's 2021 non-distribution and
// 2023/2024 special cash. Never infer a zero from an absent provider row, or
// substitute these historical facts for another issuer/year or a forecast.
const CATL_ANNUAL_CASH: DividendAnnualReportEvidence[] = [
  { year:2021, publishedAt:'2022-04-22', verifiedAt:'2026-10-23', basis:'reported_no_dividend',
    dividendMicros:0, dividendCashMinor:0, netProfitMinor:1593131790000,
    sources:[{url:'https://static.cninfo.com.cn/finalpage/2022-04-22/1213027685.PDF',pdfPages:[1]}] },
  { year:2023, publishedAt:'2026-03-10', verifiedAt:'2026-10-23', basis:'reported_implemented_cash',
    dividendMicros:5028000, dividendCashMinor:2206000611497, netProfitMinor:4412124834263,
    sources:[{url:'https://www.hkexnews.hk/listedco/listconews/sehk/2026/0310/2026031000015_c.pdf',pdfPages:[17,18]},
      {url:'https://disc.static.szse.cn/download/disc/disk03/finalpage/2025-03-14/60f3502e-72d6-4b20-9f9f-026c73a57c83.PDF',pdfPages:[58]}] },
  { year:2024, publishedAt:'2026-03-10', verifiedAt:'2026-10-23', basis:'reported_implemented_cash',
    dividendMicros:5783000, dividendCashMinor:2537244178983, netProfitMinor:5074468158398,
    sources:[{url:'https://www.hkexnews.hk/listedco/listconews/sehk/2026/0310/2026031000015_c.pdf',pdfPages:[17,18]},
      {url:'https://static.sse.com.cn/disclosure/bond/announcement/company/c/new/2025-08-29/241526_20250829_3ZTB.pdf',pdfPages:[30]}] },
];

export function dividendAnnualReportEvidence(code: string, year: number, asOf: string, reportedNetProfitMinor?: number): DividendAnnualReportEvidence | undefined {
  const evidence = code === '300750' ? CATL_ANNUAL_CASH.find(record => record.year === year && record.publishedAt <= asOf) : undefined;
  // Provider financial amounts are rounded. A materially restated profit must
  // be reviewed instead of combining its new denominator with an old extract.
  return evidence && reportedNetProfitMinor !== undefined
    && Math.abs(reportedNetProfitMinor-evidence.netProfitMinor) <= Math.max(1,evidence.netProfitMinor*1e-6)
    ? structuredClone(evidence) : undefined;
}

/** Cash disclosures can audit a dividend feed independently of its profit denominator. */
export function dividendAnnualCashEvidence(code: string, asOf: string): DividendAnnualReportEvidence[] {
  return code === '300750' ? structuredClone(CATL_ANNUAL_CASH.filter(record => record.publishedAt <= asOf)) : [];
}
