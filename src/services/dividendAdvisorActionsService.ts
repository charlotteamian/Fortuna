import { db, initializeSettings, updateSettings } from '../db.ts';
import { BUY_LEVELS, SELL_LEVELS, buildGrid, dateInChina, mainlandCode, type DividendStock } from '../lib/dividendWorkbench.ts';
import { isDividendPlanProposal, type DividendPlanProposal } from '../lib/dividendAdvisorActions.ts';
import { computeHoldingPosition } from '../lib/holdingPosition.ts';
import { defaultDividendSelectionPrinciples, isDividendSelectionPrinciples, type DividendSelectionPrinciples } from '../lib/dividendResearch.ts';
import { requestPortableSnapshot } from './portableSnapshotEvents.ts';

export async function loadDividendSelectionPrinciples(): Promise<DividendSelectionPrinciples> {
  await initializeSettings();
  const settings = await db.settings.get('main');
  return settings?.dividendSelectionPrinciples ?? defaultDividendSelectionPrinciples();
}

export async function saveDividendSelectionPrinciples(principles: DividendSelectionPrinciples) {
  if (!isDividendSelectionPrinciples(principles)) throw new Error('INVALID_DIVIDEND_PRINCIPLES');
  await updateSettings({ dividendSelectionPrinciples: structuredClone(principles) });
  requestPortableSnapshot('dividend-selection-principles');
}

function planState(stock: DividendStock) {
  return { buyLevels: stock.buyLevels ?? BUY_LEVELS, sellLevels: stock.sellLevels ?? SELL_LEVELS, buyPaused: stock.buyPaused ?? false };
}
function fingerprint(stock: DividendStock, proposal: DividendPlanProposal) {
  // Bind confirmation to the full draft and every saved input affecting grid targets.
  return JSON.stringify({ code: stock.code, ...planState(stock), weightBps: stock.weightBps, manualDpsMicros: stock.manualDpsMicros,
    shareMode: stock.shareMode, manualShares: stock.manualShares, lotSize: stock.lotSize, dividend: stock.dividend, proposal });
}
export async function previewDividendPlanChange(proposal: DividendPlanProposal) {
  if (!isDividendPlanProposal(proposal)) throw new Error('INVALID_DIVIDEND_PROPOSAL');
  const stock = await db.dividendStocks.get(proposal.code);
  if (!stock) throw new Error('DIVIDEND_STOCK_MISSING');
  validateCombinedGrid(stock, proposal);
  return { code: stock.code, name: stock.name, before: planState(stock),
    after: { buyLevels: proposal.buyLevels ?? stock.buyLevels ?? BUY_LEVELS, sellLevels: proposal.sellLevels ?? stock.sellLevels ?? SELL_LEVELS,
      buyPaused: proposal.buyPaused ?? stock.buyPaused ?? false },
    fingerprint: fingerprint(stock, proposal) };
}
function validateCombinedGrid(stock: DividendStock, proposal: DividendPlanProposal) {
  if (!proposal.buyLevels && !proposal.sellLevels) return;
  const combined = { ...stock, ...(proposal.buyLevels !== undefined ? { buyLevels: proposal.buyLevels } : {}),
    ...(proposal.sellLevels !== undefined ? { sellLevels: proposal.sellLevels } : {}) };
  const buys = buildGrid(combined, 0, 0, 'buy'), sells = buildGrid(combined, 0, 0, 'sell');
  for (const [side, rows] of [['buy', buys], ['sell', sells]] as const) {
    for (let i = 1; i < rows.length; i++) {
      const current = rows[i].priceMinor, previous = rows[i - 1].priceMinor;
      if (current && previous && (side === 'buy' ? current >= previous : current <= previous)) throw new Error('INVALID_DIVIDEND_PROPOSAL');
    }
  }
  const buyPrices = buys.flatMap(row => row.priceMinor ? [row.priceMinor] : []), sellPrices = sells.flatMap(row => row.priceMinor ? [row.priceMinor] : []);
  if (buyPrices.length && sellPrices.length && Math.max(...buyPrices) >= Math.min(...sellPrices)) throw new Error('INVALID_DIVIDEND_PROPOSAL');
}
export async function applyDividendPlanChange(proposal: DividendPlanProposal, expectedFingerprint: string) {
  if (!isDividendPlanProposal(proposal)) throw new Error('INVALID_DIVIDEND_PROPOSAL');
  await db.transaction('rw', db.dividendStocks, async () => {
    const stock = await db.dividendStocks.get(proposal.code);
    if (!stock || fingerprint(stock, proposal) !== expectedFingerprint) throw new Error('DIVIDEND_PLAN_CHANGED');
    validateCombinedGrid(stock, proposal);
    await db.dividendStocks.update(stock.code, {
      ...(proposal.buyPaused === undefined ? {} : { buyPaused: proposal.buyPaused }),
      ...(proposal.buyLevels ? { buyLevels: proposal.buyLevels.map(level => ({ yieldBps: level.yieldBps, portionBps: level.portionBps, ...(level.priceMinor === undefined ? {} : { priceMinor: level.priceMinor }) })) } : {}),
      ...(proposal.sellLevels ? { sellLevels: proposal.sellLevels.map(level => ({ yieldBps: level.yieldBps, portionBps: level.portionBps, ...(level.priceMinor === undefined ? {} : { priceMinor: level.priceMinor }) })) } : {}),
    });
  });
  requestPortableSnapshot('dividend-ai-grid-confirmed');
}

async function removalPreview(codes: string[]) {
  if (!Array.isArray(codes) || !codes.length || codes.length > 500 || codes.some(code => typeof code !== 'string' || mainlandCode(code) !== code)) throw new Error('INVALID_DIVIDEND_REMOVAL');
  const [stocks, holdings, txns] = await Promise.all([db.dividendStocks.toArray(), db.holdings.toArray(), db.holdingTxns.toArray()]);
  const today = dateInChina();
  const held = new Set<string>();
  for (const holding of holdings) {
    const code = mainlandCode(holding.symbol ?? '');
    if (!code || holding.instrumentType || /美|港|US|HK/i.test(holding.market ?? '')) continue;
    const history = txns.filter(txn => txn.holdingId === holding.id && txn.accountId === holding.accountId);
    // Include archived/hidden accounts, current positions and scheduled future buys.
    if (computeHoldingPosition(history.filter(txn => txn.date <= today)).shares > 0
      || history.some(txn => txn.date > today && (txn.kind === 'buy' && txn.shares > 0 || (txn.quantitySnapshot ?? 0) > 0))) held.add(code);
  }
  const selected = stocks.filter(stock => codes.includes(stock.code));
  const protectedStocks = selected.filter(stock => stock.manualShares > 0 || held.has(stock.code));
  const protectedCodes = new Set(protectedStocks.map(stock => stock.code));
  const label = (stock: DividendStock) => ({ code: stock.code, name: stock.name });
  return { removable: selected.filter(stock => !protectedCodes.has(stock.code)).map(label), protected: protectedStocks.map(label) };
}
export async function previewDividendRiskRemoval(codes: string[]) {
  return db.transaction('r', db.dividendStocks, db.holdings, db.holdingTxns, () => removalPreview(codes));
}
export async function removeDividendRiskStocks(codes: string[]) {
  const result = await db.transaction('rw', db.dividendStocks, db.holdings, db.holdingTxns, async () => {
    const preview = await removalPreview(codes);
    await db.dividendStocks.bulkDelete(preview.removable.map(stock => stock.code));
    return preview;
  });
  if (result.removable.length) requestPortableSnapshot('dividend-ai-risk-removal');
  return result;
}
export async function addDividendResearchCandidate(code: string, name: string) {
  if (mainlandCode(code) !== code || typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('INVALID_DIVIDEND_CANDIDATE');
  await initializeSettings();
  await db.transaction('rw', db.dividendStocks, async () => {
    if (await db.dividendStocks.get(code)) throw new Error('DIVIDEND_CANDIDATE_EXISTS');
    await db.dividendStocks.add({ code, name: name.trim(), group: 'watch', weightBps: 0, shareMode: 'linked', manualShares: 0,
      lotSize: code.startsWith('68') ? 200 : 100 });
  });
  requestPortableSnapshot('dividend-ai-candidate-added');
}
