import { db } from '../db';
import { buildDividendAdvisorContext } from '../lib/dividendAdvisor';
import { dateInChina, linkedDividendPositions } from '../lib/dividendWorkbench';
import { defaultDividendFundPlan } from '../lib/dividendFundPlan';
import { computeHoldingPosition } from '../lib/holdingPosition';
import { getHoldingMode } from '../lib/productPortfolio';
import { loadDividendWorkbenchReadOnly, refreshDividendStock } from './dividendService';
import { refreshDividendMarketQuotes } from './dividendQuoteService';
import { requestPortableSnapshot } from './portableSnapshotEvents';
import { defaultDividendSelectionPrinciples } from '../lib/dividendResearch';
import { defaultDividendPricingMethod } from '../lib/dividendPricing';
import { assertDividendRequestCurrent, beforeDividendCacheWrite, type DividendRequestControl } from './dividendRequestControl';
import type { DividendDailySource, DividendDailyStage } from '../lib/dividendDailyCheck';
import { dividendSourceUrl } from './dividendService';
import { isExchangeTradedFundCode } from '../lib/dividendQuote';
import { quoteSymbol } from '../lib/dividendWorkbench';
import { fetchDividendResearch } from './dividendResearchService';
import type { DividendFund } from '../lib/dividendFundPlan';
import { loadDividendCheckSummaries } from './dividendCheckSummaryService';
import { saveDividendResearchCache, loadDividendResearchCache } from './dividendResearchCacheService';
import { loadDividendDailyAdvicePlanKey } from './dividendDailyAdviceScopeService';

/** Explain only what is already stored. Unlike the refresh workflow below,
 * this must not initialise settings, seed a plan, redate evidence or download. */
export async function loadDividendAdvisorContext() {
  const [stocks, settings, accounts, holdings, txns, researchCache] = await Promise.all([
    db.dividendStocks.toArray(), db.settings.get('main'), db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray(),
    loadDividendResearchCache().catch(() => null),
  ]);
  const data = {
    stocks, strategy: settings?.dividendStrategy ?? 'stocks',
    fundPlan: settings?.dividendFundPlan ?? defaultDividendFundPlan(),
    budgetMinor: settings?.dividendBudgetMinor ?? 0,
    budgetConfigured: settings?.dividendBudgetMinor !== undefined,
    positions: linkedDividendPositions(accounts, holdings, txns),
  };
  const fundPositions = await loadDividendFundPositions(data.fundPlan.funds);
  const checkSummaries = await loadDividendCheckSummaries(data, { researchCache: researchCache ?? undefined, fundPositions });
  return buildDividendAdvisorContext({ ...data, fundPositions, research: researchCache?.snapshot, checkSummaries });
}

export interface DividendAdvisorRefreshEvent { stage: DividendDailyStage; source?: DividendDailySource; checkedKeys?: string[] }
export interface DividendAdvisorRefreshOptions extends DividendRequestControl {
  itemKeys?: string[];
  onEvent?: (event: DividendAdvisorRefreshEvent) => Promise<void> | void;
}

/** The existing refresh workflow now reports actual work and carries one stop
 * signal through every source. It only writes market/evidence caches. */
export async function prepareDividendAdvisorContext(onProgress: (done: number, total: number) => void,
  options: DividendAdvisorRefreshOptions = {}) {
  assertDividendRequestCurrent(options);
  const initial = await loadDividendWorkbenchReadOnly();
  const settings = await db.settings.get('main');
  const principles = settings?.dividendSelectionPrinciples ?? defaultDividendSelectionPrinciples();
  const stored = settings?.dividendPricingMethod;
  const pricingMethod = !stored ? defaultDividendPricingMethod() : stored.strategy === 'recent_batches' ? stored
    : { ...stored, strategy: 'recent_batches' as const, holdingPeriod: 'month_to_year' as const };
  const selected = options.itemKeys ? new Set(options.itemKeys) : undefined;
  const stocks = initial.stocks.filter(stock => !selected || selected.has(`stock:${stock.code}`))
    .sort((a, b) => Number(initial.positions.has(b.code)) - Number(initial.positions.has(a.code)) || b.weightBps - a.weightBps || a.code.localeCompare(b.code));
  const funds = initial.fundPlan.funds.filter(fund => !selected || selected.has(`fund:${fund.id}`));
  const emit = async (event: DividendAdvisorRefreshEvent) => { assertDividendRequestCurrent(options); await options.onEvent?.(event); assertDividendRequestCurrent(options); };
  const report = (source: DividendDailySource) => emit({ stage: source.stage, source });
  await emit({ stage: 'quotes' });
  const quoteCodes = [...stocks.map(stock => stock.code), ...funds.filter(fund => isExchangeTradedFundCode(fund.code)).map(fund => fund.code!)];
  let quotes: Awaited<ReturnType<typeof refreshDividendMarketQuotes>> | undefined;
  try { quotes = await refreshDividendMarketQuotes({ ...options, codes: quoteCodes }); }
  catch { assertDividendRequestCurrent(options); }
  for (const item of [...stocks.map(stock => ({ key: `stock:${stock.code}`, code: stock.code })), ...funds.map(fund => ({ key: `fund:${fund.id}`, code: isExchangeTradedFundCode(fund.code) ? fund.code : undefined }))]) {
    const quote = item.code ? quotes?.quotes.get(item.code) : undefined;
    await report({ id: `${item.key}:quote`, itemKey: item.key, stage: 'quotes', provider: item.code ? 'Tencent' : 'manual',
      url: item.code ? `https://qt.gtimg.cn/q=${quoteSymbol(item.code)}` : undefined, attemptedAt: item.code ? Date.now() : undefined,
      status: !item.code ? 'deferred' : quote ? 'success' : 'failed', sourceDate: quote?.date, detail: !item.code ? 'manual_reference' : quote ? undefined : 'quote_download_failed' });
  }
  await emit({ stage: 'evidence' });
  let cursor = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(3, stocks.length) }, async () => {
    while (cursor < stocks.length) {
      assertDividendRequestCurrent(options);
      const stock = stocks[cursor++], itemKey = `stock:${stock.code}`;
      try {
        const ok = await refreshDividendStock(stock.code, { ...options, skipQuote: true });
        const current = await db.dividendStocks.get(stock.code);
        await report({ id: `${itemKey}:disclosure`, itemKey, stage: 'evidence', provider: 'Eastmoney', url: dividendSourceUrl(stock.code),
          attemptedAt: Date.now(), status: ok ? 'success' : 'failed', sourceDate: current?.dividend?.announcements?.map(item => item.announcedAt).sort().at(-1), detail: ok ? undefined : 'dividend_download_failed' });
        await report({ id: `${itemKey}:schedule`, itemKey, stage: 'evidence', provider: 'Eastmoney',
          url: `https://emweb.eastmoney.com/PC_HSF10/BonusFinancing/PageAjax?code=${quoteSymbol(stock.code).toUpperCase()}`,
          attemptedAt: Date.now(), status: current?.dividend && !current.dividend.scheduleFailedAt ? 'success' : 'failed', detail: current?.dividend?.scheduleFailedAt ? 'schedule_download_failed' : undefined });
      } catch { assertDividendRequestCurrent(options); await report({ id: `${itemKey}:disclosure`, itemKey, stage: 'evidence', provider: 'Eastmoney', url: dividendSourceUrl(stock.code), status: 'failed', attemptedAt: Date.now(), detail: 'disclosure_failed' }); }
      onProgress(++done, stocks.length);
    }
  }));
  const previous = await loadDividendResearchCache().catch(() => null);
  const saveResearch = async (snapshot: Parameters<typeof saveDividendResearchCache>[0]['snapshot']) => {
    await beforeDividendCacheWrite(options);
    try {
      await saveDividendResearchCache({ snapshot, scope: previous?.scope ?? 'plan', candidateInput: previous?.candidateInput ?? '',
        reviewedCodes: previous?.scope === 'candidates' ? previous.reviewedCodes : initial.stocks.map(stock => stock.code) }, { ...options, preserveFailedSources: true });
    } catch { assertDividendRequestCurrent(options); return false; }
    return true;
  };
  if (stocks.length) {
    const research = await fetchDividendResearch(stocks, principles, { ...options, pricingMethod,
      marketContext: selected ? previous?.snapshot ?? { indices: [] } : undefined,
      onStock: async snapshot => {
        const saved = await saveResearch(snapshot);
        const stock = snapshot.stocks[0], itemKey = `stock:${stock.code}`;
        await report({ id: `${itemKey}:research`, itemKey, stage: 'evidence', provider: 'research', attemptedAt: Date.now(),
          status: stock.issues.length ? stock.issues.every(issue => issue.reason === 'deferred') ? 'deferred' : 'failed' : 'success',
          detail: stock.issues.length ? stock.issues.map(issue => issue.detail ?? issue.reason).join('; ').slice(0, 500) : undefined });
        for (const source of stock.sources) await report({ id: `${itemKey}:research:${source.url}`, itemKey, stage: 'evidence', provider: source.provider,
          url: source.url, status: 'success', attemptedAt: source.fetchedAt, sourceDate: source.asOf });
        for (const issue of stock.issues) await report({ id: `${itemKey}:research:${issue.url ?? issue.kind}`, itemKey, stage: 'evidence', provider: issue.kind,
          url: issue.url, status: issue.reason === 'deferred' ? 'deferred' : 'failed', attemptedAt: Date.now(), detail: issue.detail ?? issue.reason });
        const ledger = stock.pricing?.ledger;
        await report({ id: `${itemKey}:official`, itemKey, stage: 'evidence', provider: 'CNINFO', url: 'https://www.cninfo.com.cn/new/hisAnnouncement/query',
          status: ledger?.complete ? 'success' : 'failed', attemptedAt: Date.now(), sourceDate: ledger?.events.flatMap(event => event.announcementDate ? [event.announcementDate] : []).sort().at(-1),
          verifiedDates: [...new Set(ledger?.events.flatMap(event => event.sources.flatMap(source => source.verifiedAt ? [source.verifiedAt] : [])) ?? [])],
          detail: ledger?.complete ? undefined : ledger?.issues.join('; ').slice(0, 500) || 'official_evidence_unavailable' });
        if (!saved) await report({ id: `${itemKey}:cache`, itemKey, stage: 'evidence', provider: 'cache', status: 'failed', detail: 'research_save_failed' });
      },
    });
    await saveResearch(research);
    if (!selected) {
      for (const index of research.indices) {
        for (const source of index.sources) await report({ id: `market:${index.code}`, itemKey: 'market', stage: 'evidence', provider: source.provider, url: source.url,
          status: 'success', attemptedAt: source.fetchedAt, sourceDate: source.asOf });
        for (const issue of index.issues) await report({ id: `market:${index.code}`, itemKey: 'market', stage: 'evidence', provider: 'Tencent', url: issue.url,
          status: 'failed', attemptedAt: Date.now(), detail: issue.detail ?? issue.reason });
      }
      await report({ id: 'market:treasury', itemKey: 'market', stage: 'evidence', provider: 'Eastmoney', url: research.macro?.sourceUrl,
        status: research.macro ? 'success' : 'failed', sourceDate: research.macro?.asOf, attemptedAt: Date.now(), detail: research.macro ? undefined : 'treasury_unavailable' });
      await report({ id: 'market:opportunity', itemKey: 'market', stage: 'evidence', provider: 'CSI', url: research.opportunity?.sourceUrl,
        status: research.opportunity ? 'success' : 'failed', sourceDate: research.opportunity?.asOf, attemptedAt: Date.now(), detail: research.opportunity ? undefined : 'comparison_unavailable' });
    }
  }
  for (const fund of funds) await report({ id: `fund:${fund.id}:reference`, itemKey: `fund:${fund.id}`, stage: 'evidence', provider: 'manual',
    status: fund.reference ? 'success' : 'deferred', sourceDate: fund.reference?.asOf, detail: 'manual_reference' });
  await emit({ stage: 'plans' });
  const data = await loadDividendWorkbenchReadOnly();
  const fundPositions = await loadDividendFundPositions(data.fundPlan.funds);
  const checkSummaries = await loadDividendCheckSummaries(data, { fundPositions });
  const inspectionPlanKey = await loadDividendDailyAdvicePlanKey(data, checkSummaries);
  await emit({ stage: 'plans', checkedKeys: [...stocks.map(stock => `stock:${stock.code}`), ...funds.map(fund => `fund:${fund.id}`)] });
  await emit({ stage: 'result' });
  assertDividendRequestCurrent(options);
  if (stocks.length || quoteCodes.length) requestPortableSnapshot('dividend-daily-check-cache');
  return { ...buildDividendAdvisorContext({ ...data, fundPositions, research: (await loadDividendResearchCache().catch(() => null))?.snapshot, checkSummaries }), inspectionPlanKey };
}

/** The same eligible fund ledger positions back the AI context and saved-advice freshness. */
export async function loadDividendFundPositions(funds: DividendFund[]) {
  const today = dateInChina();
  const codes = new Set(funds.flatMap(fund => fund.code ? [fund.code] : []));
  const fundPositions = new Map<string, number>();
  if (codes.size) {
    const [accounts, holdings, txns] = await Promise.all([db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray()]);
    // Only a successful ledger read establishes zero. An omitted position input
    // remains unknown in the shared check instead of pretending it was loaded.
    for (const code of codes) fundPositions.set(code, 0);
    const validAccounts = new Set(accounts.filter(account => !account.archivedAt && account.type === 'asset' && account.currency === 'CNY' && account.portfolio).map(account => account.id));
    const accountById = new Map(accounts.map(account => [account.id, account]));
    for (const holding of holdings) {
      const code = holding.symbol?.trim().toUpperCase().replace(/^(?:SH|SZ)[.:]?/, '').replace(/\.(?:SH|SZ)$/, '');
      const account = accountById.get(holding.accountId);
      if (!code || !codes.has(code) || !validAccounts.has(holding.accountId) || !account || holding.instrumentType
        || /美|港|US|HK/i.test(holding.market ?? '') || getHoldingMode(account.category, holding) !== 'unit') continue;
      const position = computeHoldingPosition(txns.filter(txn => txn.holdingId === holding.id && txn.accountId === holding.accountId && txn.date <= today));
      fundPositions.set(code, (fundPositions.get(code) ?? 0) + position.shares);
    }
  }
  return fundPositions;
}
