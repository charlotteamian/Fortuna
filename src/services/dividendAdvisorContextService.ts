import { db } from '../db';
import { buildDividendAdvisorContext } from '../lib/dividendAdvisor';
import { dateInChina } from '../lib/dividendWorkbench';
import { computeHoldingPosition } from '../lib/holdingPosition';
import { getHoldingMode } from '../lib/productPortfolio';
import { loadDividendWorkbench, refreshDividendStock } from './dividendService';
import { refreshDividendMarketQuotes } from './dividendQuoteService';
import { requestPortableSnapshot } from './portableSnapshotEvents';

/** Refresh on each explicit question. Off-exchange NAV/high/index-yield remain dated manual inputs. */
export async function prepareDividendAdvisorContext(onProgress: (done: number, total: number) => void) {
  const initial = await loadDividendWorkbench();
  const today = dateInChina();
  const staleDividends = initial.stocks.filter(stock => stock.manualDpsMicros === undefined
    && (!stock.dividend || stock.dividend.asOf !== today || stock.dividendFailedAt !== undefined));
  // Start quotes immediately. Stop starting dividend requests after 15 seconds;
  // the last existing 10s-connect/10s-read request completes within its own bound.
  // This avoids an unbounded serial queue for large workbenches.
  const deadline = Date.now() + 15_000;
  const prioritized = [...staleDividends].sort((a, b) => Number(initial.positions.has(b.code)) - Number(initial.positions.has(a.code)) || b.weightBps - a.weightBps);
  const attempted = new Set<string>();
  let cursor = 0, done = 0;
  const updateDividends = async () => {
    await Promise.all(Array.from({ length: Math.min(3, prioritized.length) }, async () => {
      while (cursor < prioritized.length && Date.now() < deadline) {
        const stock = prioritized[cursor++];
        attempted.add(stock.code);
        await refreshDividendStock(stock.code);
        onProgress(++done, prioritized.length);
      }
    }));
    if (attempted.size) requestPortableSnapshot('dividend-advisor-market-data');
  };
  await Promise.all([refreshDividendMarketQuotes(), updateDividends()]);
  const data = await loadDividendWorkbench();
  const codes = new Set(data.fundPlan.funds.flatMap(fund => fund.code ? [fund.code] : []));
  const fundPositions = new Map<string, number>();
  if (codes.size) {
    const [accounts, holdings, txns] = await Promise.all([db.accounts.toArray(), db.holdings.toArray(), db.holdingTxns.toArray()]);
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
  return buildDividendAdvisorContext({ ...data, fundPositions,
    dividendRefreshDeferredCodes: prioritized.filter(stock => !attempted.has(stock.code)).map(stock => stock.code) });
}
