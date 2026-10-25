import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import {
  defaultDividendSelectionPrinciples, dividendResearchReadableSnapshot, evaluateDividendResearch, isDividendSelectionPrinciples,
  parseDividendDistributionResearch, parseDividendFinancialResearch, parseDividendResearchCodes,
  parseDividendTechnicalResearch, type DividendStockResearch,
} from '../src/lib/dividendResearch.ts';

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const now = new Date('2026-10-21T08:00:00Z').getTime();
const principles = defaultDividendSelectionPrinciples();
const liveFixtures = JSON.parse(readFileSync(new URL('./fixtures/dividend-research-sources.json', import.meta.url), 'utf8')).fixtures;
const envelope = (data: Record<string, unknown>[]) => ({ success: true, result: { pages: 1, data } });
function financialRow(overrides: Record<string, unknown> = {}) {
  return { SECURITY_CODE: '600036', SECURITY_NAME_ABBR: 'Fixture company', ORG_TYPE: '一般企业',
    REPORT_DATE: '2026-06-30 00:00:00', NOTICE_DATE: '2026-08-30 00:00:00',
    TOTALOPERATEREVETZ: 5, PARENTNETPROFITTZ: 7, ROEJQ: 6, ZCFZL: 40,
    NETCASH_OPERATE_PK: 150, PARENTNETPROFIT: 100, EPSJB: 1, ...overrides };
}
function research(overrides: Partial<DividendStockResearch> = {}): DividendStockResearch {
  return { code: '600036', name: 'Fixture', checks: [], status: 'unknown', sources: [], issues: [], ...overrides };
}
function dividendRow(report: string, exDate: string, bonus = 5) {
  return { SECURITY_CODE: '600036', REPORT_DATE: report, EX_DIVIDEND_DATE: exDate,
    PRETAX_BONUS_RMB: bonus, ASSIGN_PROGRESS: '实施' };
}

test('principles are bounded integer configuration and code input cannot inject a source query', () => {
  assert.equal(isDividendSelectionPrinciples(principles), true);
  assert.equal(isDividendSelectionPrinciples({ ...principles, minYieldBps: 1.5 }), false);
  assert.equal(isDividendSelectionPrinciples({ ...principles, maxPayoutBps: -1 }), false);
  assert.equal(isDividendSelectionPrinciples({ ...principles, notes: 'a'.repeat(4001) }), false);
  assert.deepEqual(parseDividendResearchCodes('600036，SZ000001 600036'), ['600036', '000001']);
  assert.throws(() => parseDividendResearchCodes('600036)(REPORT_DATE>0)'));
  assert.throws(() => parseDividendResearchCodes('512890'));
});

test('technical acceleration compares two separate five-day windows and requires an established fall', () => {
  const closes = Array.from({ length: 60 }, (_, i) => i < 50 ? 12 - i * 0.015 : i < 55 ? 11.25 - (i - 50) * 0.04 : 11.05 - (i - 55) * 0.22);
  const rows = closes.map((close, i) => [new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), String(close), String(close), String(close), String(close)]);
  const parsed = parseDividendTechnicalResearch({ code: 0, data: { sh600036: { qfqday: rows } } }, '600036', 'sh600036', now);
  assert.throws(() => parseDividendTechnicalResearch({ code: 0, data: { sh600036: { qfqday: rows.slice(-31) } } }, '600036', 'sh600036', now), /HISTORY_INCOMPLETE/);
  assert.equal(parsed.state, 'accelerating_down');
  assert.equal(parsed.pacing, 'pause_add');
  assert.ok(parsed.change5Percent < parsed.previous5Percent - 1);
  assert.equal(parsed.priceBasis, 'qfq');
  const rising = rows.map((row, i) => [row[0], String(10 + i / 10), String(10 + i / 10), String(10 + i / 10), String(10 + i / 10)]);
  assert.equal(parseDividendTechnicalResearch({ code: 0, data: { sh000300: { day: rising } } }, '000300', 'sh000300', now).state, 'rising');
});

test('captured Tencent and Eastmoney responses preserve verified field meaning for banks, companies and indices', () => {
  const bank = parseDividendFinancialResearch(liveFixtures.bankFinancial.data, '600036', '2026-10-21');
  const company = parseDividendFinancialResearch(liveFixtures.industrialFinancial.data, '000333', '2026-10-21');
  assert.equal(bank.name, '招商银行');
  assert.equal(bank.financialSector, true);
  assert.equal(bank.latest.noticeDate, '2026-08-29');
  assert.equal(bank.latest.debtAssetBps, 9018);
  assert.equal(company.financialSector, false);
  assert.equal(company.latest.profitGrowthBps, 166);
  const distributions = parseDividendDistributionResearch(liveFixtures.bankDistributions.data, '600036', '2026-10-21');
  assert.equal(distributions.annualDpsMicros['2025'], 2016000);
  assert.equal(distributions.dpsMicros, 2016000);
  const index = parseDividendTechnicalResearch(liveFixtures.indexDaily.data, '000300', 'sh000300', now);
  assert.equal(index.priceBasis, 'index');
  assert.equal(index.asOf, '2026-10-21');
  assert.equal(index.currentUsable, true);
});

test('dated technical series stays historical, cannot establish a current yield trigger, and future series is rejected', () => {
  const technical = parseDividendTechnicalResearch(liveFixtures.indexDaily.data, '000300', 'sh000300', now + 11 * 86400000);
  assert.equal(technical.currentUsable, false);
  const checked = evaluateDividendResearch(research({ technical, yieldBps: 600 }), principles, now + 11 * 86400000);
  assert.equal(checked.checks.find(check => check.rule === 'yield')?.status, 'unknown');
  const readable = dividendResearchReadableSnapshot({ generatedAt: now, principles, stocks: [checked], indices: [] });
  const position = readable['Stocks actually downloaded or explicitly deferred'][0]['Daily technical position'];
  assert.match(position!['Current technical reading'], /Unknown/);
  assert.match(position!['Pacing suggestion'], /Wait for recent daily data/);
  assert.throws(() => parseDividendTechnicalResearch(liveFixtures.indexDaily.data, '000300', 'sh000300', now - 86400000));
});

test('readable research converts percentage and money units, preserves URLs, and marks custom criteria unverified', () => {
  const financial = parseDividendFinancialResearch(liveFixtures.bankFinancial.data, '600036', '2026-10-21');
  const data = evaluateDividendResearch(research({ financial, yieldBps: 500,
    sources: [{ kind: 'financial', provider: 'Eastmoney', url: liveFixtures.bankFinancial.url, fetchedAt: now, asOf: financial.latest.reportDate }] }), principles, now);
  const readable = dividendResearchReadableSnapshot({ generatedAt: now, principles: { ...principles, notes: 'Exclude uncertain governance' }, stocks: [data], indices: [] });
  const text = JSON.stringify(readable);
  assert.doesNotMatch(text, /minYieldBps|epsMicros|lastCloseMinor/);
  assert.equal(readable['Editable screening principles']['Minimum trailing cash dividend yield percent'], 4);
  assert.equal(readable['Editable screening principles']['Additional personal screening criteria automatically verified'], false);
  assert.equal(readable['Stocks actually downloaded or explicitly deferred'][0]['Latest cumulative report']!['Basic earnings per share in CNY'], 2.98);
  assert.ok(text.includes(liveFixtures.bankFinancial.url));
  assert.match(text, /No original financial-report text/);
});

test('financial periods use actual publication dates, retain quarterly metrics and use annual ROE for the annual rule', () => {
  const financial = parseDividendFinancialResearch(envelope([
    financialRow({ REPORT_DATE: '2026-09-30', NOTICE_DATE: '2026-10-28', ROEJQ: 99 }),
    financialRow(), financialRow({ REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-03-30', ROEJQ: 12, EPSJB: 2 }),
  ]), '600036', '2026-10-21');
  assert.equal(financial.periods.length, 2);
  assert.equal(financial.latest.reportDate, '2026-06-30');
  assert.equal(financial.latest.roeBps, 600);
  assert.equal(financial.annual?.roeBps, 1200);
  assert.equal(financial.latest.cashProfitBps, 15000);
  const evaluated = evaluateDividendResearch(research({ financial }), principles, now);
  assert.equal(evaluated.checks.find(check => check.rule === 'roe')?.status, 'pass');
  assert.throws(() => parseDividendFinancialResearch(envelope([financialRow({ SECURITY_CODE: '000001' })]), '600036'));
});

test('only implemented dated cash dividends count, duplicate events and proposed distributions do not', () => {
  const distributions = parseDividendDistributionResearch(envelope([
    dividendRow('2025-12-31', '2026-06-01'), dividendRow('2025-12-31', '2026-06-01'),
    dividendRow('2024-12-31', '2025-06-01'), dividendRow('2023-12-31', '2024-06-01'),
    { ...dividendRow('2026-06-30', '2026-11-01', 20), ASSIGN_PROGRESS: '董事会预案' },
  ]), '600036', '2026-10-21');
  assert.equal(distributions.dpsMicros, 500000);
  assert.equal(distributions.annualDpsMicros['2025'], 500000);
  assert.equal(distributions.consecutiveYears, 3);
  assert.equal(distributions.latestCompletedYear, 2025);
  const incomplete = { success: true, result: { pages: 2, data: [] } };
  assert.throws(() => parseDividendDistributionResearch(incomplete, '600036'));
});

test('matching report-year dividends and EPS establish payout, missing reports never produce a pass', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow(), financialRow({ REPORT_DATE: '2025-12-31', NOTICE_DATE: '2026-03-30', ROEJQ: 12, EPSJB: 2 })]), '600036', '2026-10-21');
  const distributions = parseDividendDistributionResearch(envelope([
    dividendRow('2025-12-31', '2026-06-01'), dividendRow('2024-12-31', '2025-06-01'), dividendRow('2023-12-31', '2024-06-01'),
    dividendRow('2022-12-31', '2023-06-01'), dividendRow('2021-12-31', '2022-06-01'),
  ]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial, distributions, yieldBps: 500 }), principles, now);
  assert.equal(result.status, 'pass');
  assert.equal(result.checks.find(check => check.rule === 'payout')?.value, 2500);
  assert.equal(evaluateDividendResearch(research(), principles, now).status, 'unknown');
  const old = { ...financial, latest: { ...financial.latest, reportDate: '2025-12-31' } };
  assert.equal(evaluateDividendResearch(research({ financial: old, distributions, yieldBps: 500 }), principles, now).status, 'unknown');
});

test('banks replace industrial leverage/cashflow thresholds with actual specialist checks', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow({ ORG_TYPE: '银行', ZCFZL: 92, NETCASH_OPERATE_PK: -20 })]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial }), principles, now);
  assert.ok(!result.checks.some(item => ['debtAsset', 'cashProfit', 'fcfCoverage'].includes(item.rule)));
  assert.equal(result.checks.find(item => item.rule === 'financialSector')?.status, 'unknown');
  assert.deepEqual(financial.sectorReview?.missing, ['capitalAdequacy', 'coreTier1', 'nonPerformingLoan', 'provisionCoverage']);
});

test('captured industry fields and explicitly verified insurer-group report extract produce dated specialist conclusions', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/dividend-financial-sector-2026-10-21.json', import.meta.url), 'utf8')).sources;
  const bank = parseDividendFinancialResearch(fixtures['601398'].data, '601398', '2026-10-21').sectorReview!;
  assert.equal(bank.status, 'pass');
  assert.equal(bank.basis, 'dividend_screen');
  assert.equal(bank.metrics.find(m => m.key === 'coreTier1')?.valueBps, 1321);
  assert.equal(bank.metrics.find(m => m.key === 'provisionCoverage')?.valueBps, 21758);
  const insurer = parseDividendFinancialResearch(fixtures['601318'].data, '601318', '2026-10-21').sectorReview!;
  assert.equal(insurer.status, 'pass');
  assert.equal(insurer.metrics[0].valueBps, 19814);
  assert.equal(insurer.metrics[0].reportDate, '2026-06-30');
  assert.equal(insurer.metrics[1].valueBps, 16560);
  assert.deepEqual(insurer.missing, []);
  assert.equal(insurer.reportSupplement?.insuranceRiskRating, 'not_applicable_to_group');
  assert.equal(insurer.reportSupplement?.verifiedAt, '2026-10-21');
  const newerInsurer = structuredClone(fixtures['601318'].data);
  newerInsurer.result.data[0].REPORT_DATE = '2026-09-30';
  assert.equal(parseDividendFinancialResearch(newerInsurer, '601318', '2026-10-21').sectorReview?.reportSupplement, undefined);
  assert.equal(parseDividendFinancialResearch(fixtures['601318'].data, '601318', '2027-06-30').sectorReview?.reportSupplement, undefined);
  const anotherInsurer = structuredClone(fixtures['601318'].data);
  anotherInsurer.result.data.forEach((r:Record<string,unknown>)=>{r.SECURITY_CODE='601628';});
  assert.deepEqual(parseDividendFinancialResearch(anotherInsurer, '601628', '2026-10-21').sectorReview?.missing, ['coreSolvency','insuranceRiskRating']);
  const broker = parseDividendFinancialResearch(fixtures['600030'].data, '600030', '2026-10-21').sectorReview!;
  assert.equal(broker.status, 'pass');
  assert.equal(broker.metrics.find(m => m.key === 'capitalLeverage')?.valueBps, 1270);
  assert.equal(broker.metrics.find(m => m.key === 'liquidityCoverage')?.valueBps, 14406);
  const badBank = structuredClone(fixtures['601398'].data);
  badBank.result.data[0].HXYJBCZL = 6;
  assert.equal(parseDividendFinancialResearch(badBank, '601398', '2026-10-21').sectorReview?.status, 'risk');
  assert.equal(parseDividendFinancialResearch(fixtures['601398'].data, '601398', '2027-10-21').sectorReview?.status, 'unknown');
});

test('confirmed fundamental breaches remain separate from technical market timing', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow({ PARENTNETPROFITTZ: -25 })]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial }), principles, now);
  assert.equal(result.status, 'risk');
  assert.equal(result.checks.find(check => check.rule === 'profitGrowth')?.value, -2500);
});

test('expired financial breaches become unknown and cannot justify removing a plan stock', () => {
  const financial = parseDividendFinancialResearch(envelope([financialRow({ REPORT_DATE: '2024-12-31', NOTICE_DATE: '2025-03-30',
    PARENTNETPROFITTZ: -50, TOTALOPERATEREVETZ: -50, ZCFZL: 95, ROEJQ: 1, NETCASH_OPERATE_PK: -100, PARENTNETPROFIT: -100 })]), '600036', '2026-10-21');
  const result = evaluateDividendResearch(research({ financial }), principles, now);
  assert.equal(result.status, 'unknown');
  for (const rule of ['profitGrowth', 'revenueGrowth', 'debtAsset', 'cashProfit', 'roe', 'payout']) {
    assert.equal(result.checks.find(check => check.rule === rule)?.status, 'unknown');
    assert.equal(result.checks.find(check => check.rule === rule)?.reason, 'stale');
  }
  assert.ok(!result.checks.some(check => check.status === 'risk'));
});

test('research service keeps individual source failures unknown and bounds candidate requests', async () => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError('offline fixture'); };
  try {
    const result = await fetchDividendResearch([{ code: '600036', name: 'First' }, { code: '000001', name: 'Deferred' }], principles, { maxStocks: 1 });
    assert.equal(requests, 20); // Five feeds, three indices, six Treasury pages, workbook, plus five bounded Tencent fallbacks.
    assert.equal(result.stocks[0].status, 'unknown');
    assert.equal(result.stocks[0].issues.length, 5);
    assert.ok(result.stocks[0].issues.every(issue => issue.reason === 'request_failed'));
    assert.ok(result.stocks[0].issues.every(issue => issue.url && issue.detail?.includes('offline fixture')));
    assert.equal(result.stocks[0].issues.find(issue => issue.kind === 'technical')?.attempts, 2);
    assert.ok(result.stocks[1].issues.every(issue => issue.reason === 'deferred'));
    assert.equal(result.indices.length, 3);
    assert.ok(result.indices.every(index => !index.technical));
  } finally { globalThis.fetch = originalFetch; }
});

test('a failed Tencent primary recovers daily and monthly evidence through its verified public proxy', async () => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  const f = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-public-2026-10-21.json', import.meta.url), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.startsWith('/dividend-trend-api')) return new Response('unavailable', { status:503 });
    if (url.startsWith('/dividend-tencent-api')) {
      const symbol = new URL(url, 'https://example.test').searchParams.get('param')!.split(',')[0];
      if (url.includes(',month,')) return Response.json({ code:0, data:{ [symbol]:f.sources.month.data.sh600900 } });
      return Response.json({ code:0, data:{ [symbol]:liveFixtures.indexDaily.data.data.sh000300 } });
    }
    if (url.includes('RPT_F10_FINANCE_MAINFINADATA')) return Response.json(liveFixtures.bankFinancial.data);
    if (url.includes('RPT_SHAREBONUS_DET')) return Response.json(liveFixtures.bankDistributions.data);
    if (url.includes('RPTA_WEB_TREASURYYIELD')) return Response.json(f.sources.treasury);
    throw new TypeError('fixture feed intentionally unavailable');
  };
  try {
    const result = await fetchDividendResearch([{ code:'600036', name:'招商银行' }], principles);
    const stock = result.stocks[0];
    assert.ok(stock.technical?.currentUsable);
    assert.ok(stock.pricing?.history && stock.pricing.history.samples.length >= 60);
    assert.equal(stock.pricing.history.capitalActionsVerified, false, 'mixed-symbol fixture cannot verify capital adjustments');
    assert.equal(stock.pricing.anchors.historicalPercentileBps, undefined);
    assert.ok(stock.pricing.warnings.includes('capital_actions_unverified'));
    assert.ok(stock.sources.filter(source => source.kind === 'technical').every(source => source.url.startsWith('https://proxy.finance.qq.com/')));
    assert.ok(result.indices.every(index => index.technical?.currentUsable));
    assert.ok(!stock.issues.some(issue => issue.kind === 'technical'));
  } finally { globalThis.fetch = originalFetch; }
});

test('both Tencent hosts failing retain the HTTP status, original request URL and bounded attempt count', async () => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream unavailable', { status:503 });
  try {
    const result = await fetchDividendResearch([{ code:'000001', name:'平安银行' }], principles);
    const technical = result.stocks[0].issues.filter(issue => issue.kind === 'technical');
    assert.equal(technical.length, 2);
    assert.ok(technical.every(issue => issue.reason === 'request_failed' && issue.attempts === 2));
    assert.ok(technical.every(issue => issue.url?.startsWith('https://web.ifzq.gtimg.cn/')));
    assert.ok(technical.every(issue => issue.detail === 'RESEARCH_HTTP_503 → RESEARCH_HTTP_503'));
    assert.ok(result.indices.every(index => index.issues[0]?.detail === 'RESEARCH_HTTP_503 → RESEARCH_HTTP_503'));
  } finally { globalThis.fetch = originalFetch; }
});

test('a syntactically valid short monthly response retries an expanded history and restores the historical anchor', async () => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-history-cmb-2026-10-22.json',import.meta.url),'utf8'));
  const originalFetch=globalThis.fetch, monthlyRequests:string[]=[];
  globalThis.fetch=async input => {
    const url=String(input);
    if (url.includes(',month,')) {
      monthlyRequests.push(url);
      const data=structuredClone(f.sources.month.data);
      if (url.startsWith('/dividend-trend-api')) data.data.sh600036.month=data.data.sh600036.month.slice(-36);
      return Response.json(data);
    }
    if (url.includes(',day,')) {
      const symbol=new URL(url,'https://example.test').searchParams.get('param')!.split(',')[0];
      return Response.json({code:0,data:{[symbol]:liveFixtures.indexDaily.data.data.sh000300}});
    }
    if (url.includes('RPT_F10_FINANCE_MAINFINADATA')) return Response.json(liveFixtures.bankFinancial.data);
    if (url.includes('RPT_SHAREBONUS_DET')) return Response.json(f.sources.distribution.data);
    throw new TypeError('fixture feed intentionally unavailable');
  };
  try {
    const result=await fetchDividendResearch([{code:'600036',name:'招商银行'}],principles);
    const stock=result.stocks[0];
    assert.equal(monthlyRequests.length,2);assert.match(monthlyRequests[1],/dividend-tencent-api.*month,,,320,/);
    assert.equal(stock.pricing?.historyCoverage?.sampleCount,118);assert.equal(stock.pricing?.historyCoverage?.usable,true);
    assert.equal(stock.pricing?.anchors.historicalPercentileBps,489);
    assert.ok(!stock.issues.some(issue=>issue.kind==='technical'));
    assert.ok(stock.sources.some(source=>source.url.includes('month,,,320,')));
  } finally { globalThis.fetch=originalFetch; }
});

test('genuinely short listing history keeps the actual current price and explains the missing anchor after bounded retry', async () => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  const f=JSON.parse(readFileSync(new URL('./fixtures/dividend-history-cmb-2026-10-22.json',import.meta.url),'utf8'));
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input => {
    const url=String(input);
    if (url.includes(',month,')) {
      const data=structuredClone(f.sources.month.data);
      data.data.sh600036.month=data.data.sh600036.month.slice(url.startsWith('/dividend-trend-api')?-24:-48);
      return Response.json(data);
    }
    if (url.includes('RPT_F10_FINANCE_MAINFINADATA')) return Response.json(liveFixtures.bankFinancial.data);
    if (url.includes('RPT_SHAREBONUS_DET')) return Response.json(f.sources.distribution.data);
    throw new TypeError('fixture feed intentionally unavailable');
  };
  try {
    const result=await fetchDividendResearch([{code:'600036',name:'招商银行'}],principles);
    const stock=result.stocks[0];
    assert.equal(stock.pricing?.historyCoverage?.sampleCount,47);assert.equal(stock.pricing?.anchors.historicalPercentileBps,undefined);
    assert.ok(stock.pricing?.historyCoverage?.reasons.includes('samples_insufficient'));
    assert.equal(stock.pricing?.currentPriceMinor,4179);
    const issue=stock.issues.find(issue=>issue.url?.includes(',month,'));
    assert.equal(issue?.attempts,2);assert.match(issue?.detail??'',/PRICE_HISTORY_INCOMPLETE:47\/60/);
    assert.ok(stock.sources.some(source=>source.url.includes('month,,,320,')));
  } finally { globalThis.fetch=originalFetch; }
});

test('current research yields use verified trailing cash on the dated quote share basis, independently of long history coverage', async context => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T08:00:00Z') });
  const originalFetch = globalThis.fetch;
  const cashRows = [
    { ...dividendRow('2023-12-31', '2024-06-01', 1), NOTICE_DATE: '2024-05-20', BONUS_RATIO: 0, IT_RATIO: 0 },
    { ...dividendRow('2025-12-31', '2026-06-01', 10), NOTICE_DATE: '2026-05-20', BONUS_RATIO: 10, IT_RATIO: 0 },
  ];
  async function check(options: { code?: string; quoteDate?: string; quotePrice?: string; rows?: Record<string, unknown>[] } = {}) {
    const code = options.code ?? '600036', symbol = `${code.startsWith('6') ? 'sh' : 'sz'}${code}`;
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.includes(',month,')) return Response.json({ code: 0, data: { [symbol]: {
        month: [[options.quoteDate ?? '2026-10-23', '10', options.quotePrice ?? '10', '10', '10']],
      } } });
      if (url.includes('RPT_F10_FINANCE_MAINFINADATA')) return Response.json(envelope([financialRow({ SECURITY_CODE: code })]));
      if (url.includes('RPT_SHAREBONUS_DET')) return Response.json(envelope((options.rows ?? cashRows).map(row => ({ ...row, SECURITY_CODE: code }))));
      throw new TypeError('fixture feed intentionally unavailable');
    };
    const result = await fetchDividendResearch([{ code, name: 'Cash basis fixture' }], principles);
    return result.stocks[0];
  }
  try {
    const verified = await check();
    assert.equal(verified.yieldBps, 500, 'ten yuan per ten pre-bonus shares becomes 0.5 yuan per current share');
    assert.equal(verified.pricing?.currentCashYieldBps, 500);
    assert.equal(verified.pricing?.historyCoverage?.usable, false, 'no 60-month gate applies to this current cash observation');
    assert.equal(verified.distributions?.dpsMicros, 1000000, 'raw distribution display retains its report-share basis');
    assert.equal(verified.distributions?.annualDpsMicros['2025'], 1000000, 'fiscal-year payout evidence stays unchanged');
    assert.equal(verified.checks.find(item => item.rule === 'yield')?.value, 500);

    const afterQuote = await check({ rows: [...cashRows,
      { ...dividendRow('2026-06-30', '2026-10-24', 20), NOTICE_DATE: '2026-10-20', BONUS_RATIO: 0, IT_RATIO: 0 },
    ] });
    assert.equal(afterQuote.distributions?.dpsMicros, 3000000);
    assert.equal(afterQuote.yieldBps, 500, 'implemented cash after the quote date cannot enter that quote yield');
    assert.equal(afterQuote.pricing?.currentCashYieldBps, 500);

    const missingActions = cashRows.map(row => ({ ...row } as Record<string, unknown>));
    delete missingActions[1].BONUS_RATIO;
    const unverified = await check({ rows: missingActions });
    assert.equal(unverified.yieldBps, undefined);
    assert.equal(unverified.pricing?.currentCashYieldBps, undefined);
    assert.equal(unverified.checks.find(item => item.rule === 'yield')?.status, 'unknown');

    const contradicted = await check({ code: '300750' });
    assert.equal(contradicted.yieldBps, undefined, 'a feed omitting verified issuer cash cannot establish a current yield');
    assert.equal(contradicted.pricing?.currentCashYieldBps, undefined);

    const lastUsableDay = await check({ quoteDate: '2026-10-14' });
    assert.equal(lastUsableDay.yieldBps, 500);
    for (const options of [{ quoteDate: '2026-10-13' }, { quoteDate: '2026-10-25' }, { quotePrice: '0' }]) {
      const unavailable = await check(options);
      assert.equal(unavailable.yieldBps, undefined);
      assert.equal(unavailable.pricing?.currentCashYieldBps, undefined);
      assert.equal(unavailable.checks.find(item => item.rule === 'yield')?.status, 'unknown');
    }
  } finally {
    globalThis.fetch = originalFetch;
    context.mock.timers.reset();
  }
});

test('classic pricing survives failed financial and market feeds but never substitutes a missing cash feed', async context => {
  const { fetchDividendResearch } = await import('../src/services/dividendResearchService.ts');
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T08:00:00Z') });
  const originalFetch = globalThis.fetch;
  const cash = envelope([
    { ...dividendRow('2023-12-31', '2024-06-01', 1), NOTICE_DATE: '2024-05-20', BONUS_RATIO: 0, IT_RATIO: 0 },
    { ...dividendRow('2025-12-31', '2026-06-01', 6.09), NOTICE_DATE: '2026-05-20', BONUS_RATIO: 0, IT_RATIO: 0 },
  ]);
  let cashAvailable = true;
  globalThis.fetch = async input => {
    if (cashAvailable && String(input).includes('RPT_SHAREBONUS_DET')) return Response.json(cash);
    throw new TypeError('fixture feed intentionally unavailable');
  };
  try {
    const ready = (await fetchDividendResearch([{ code: '600036', name: '招商银行' }], principles)).stocks[0];
    assert.equal(ready.financial, undefined);
    assert.equal(ready.pricing?.canApply, true);
    assert.equal(ready.pricing?.d1Micros, 609000);
    assert.equal(ready.pricing?.theoreticalPriceMinor, 1218);
    assert.deepEqual(ready.pricing?.grid.map(level => level.priceMinor), [1107,1059,1015,936]);
    assert.equal(ready.pricing?.grid[0].changeFromCurrentBps, undefined);
    assert.ok(ready.issues.some(issue => issue.kind === 'financial'));
    assert.ok(ready.pricing?.pauseReasons?.includes('financial_sector_review'));
    cashAvailable = false;
    const missing = (await fetchDividendResearch([{ code: '600036', name: '招商银行' }], principles)).stocks[0];
    assert.equal(missing.pricing?.canApply, false);
    assert.ok(missing.pricing?.blockers.includes('trailing_dividend_missing'));
    assert.deepEqual(missing.pricing?.grid, []);
    assert.ok(missing.issues.some(issue => issue.kind === 'dividend' && issue.reason === 'request_failed'));
  } finally {
    globalThis.fetch = originalFetch;
    context.mock.timers.reset();
  }
});
