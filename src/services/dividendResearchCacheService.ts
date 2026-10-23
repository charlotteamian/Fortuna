import Dexie, { type Table } from 'dexie';
import { isDividendSelectionPrinciples, type DividendResearchSnapshot } from '../lib/dividendResearch.ts';
import { mainlandCode } from '../lib/dividendWorkbench.ts';

export interface SavedDividendResearch {
  snapshot: DividendResearchSnapshot;
  scope: 'plan' | 'candidates';
  candidateInput: string;
  stockContexts?: Record<string, Omit<DividendResearchSnapshot, 'stocks'>>;
  collapsedCodes?: string[];
}

// A dated research result is separate from the asset ledger and contains no API credentials.
const cache = new Dexie('FortunaDividendResearchCache');
cache.version(1).stores({ results: 'id' });
const results: Table<SavedDividendResearch & { id: string }, string> = cache.table('results');

function validContext(value: Omit<DividendResearchSnapshot, 'stocks'>): boolean {
  return !!value && Number.isSafeInteger(value.generatedAt) && value.generatedAt > 0
    && isDividendSelectionPrinciples(value.principles) && Array.isArray(value.indices);
}

function valid(value: SavedDividendResearch): boolean {
  const snapshot = value?.snapshot;
  return !!snapshot && ['plan', 'candidates'].includes(value.scope) && typeof value.candidateInput === 'string'
    && validContext(snapshot) && Array.isArray(snapshot.stocks)
    && snapshot.stocks.every(stock => stock && mainlandCode(stock.code) === stock.code && typeof stock.name === 'string'
      && ['pass', 'risk', 'unknown'].includes(stock.status) && Array.isArray(stock.checks) && Array.isArray(stock.sources) && Array.isArray(stock.issues))
    && (value.stockContexts === undefined || (!!value.stockContexts && typeof value.stockContexts === 'object'
      && Object.entries(value.stockContexts).every(([code, context]) => mainlandCode(code) === code && validContext(context))))
    && (value.collapsedCodes === undefined || (Array.isArray(value.collapsedCodes)
      && value.collapsedCodes.every(code => typeof code === 'string' && mainlandCode(code) === code)));
}

function contextOf(snapshot: Omit<DividendResearchSnapshot, 'stocks'>): Omit<DividendResearchSnapshot, 'stocks'> {
  return { generatedAt: snapshot.generatedAt, principles: snapshot.principles, indices: snapshot.indices,
    ...(snapshot.pricingMethod ? { pricingMethod: snapshot.pricingMethod } : {}),
    ...(snapshot.macro ? { macro: snapshot.macro } : {}), ...(snapshot.opportunity ? { opportunity: snapshot.opportunity } : {}) };
}

function cleanResearch(value: SavedDividendResearch): SavedDividendResearch {
  return JSON.parse(JSON.stringify({ snapshot: value.snapshot, scope: value.scope, candidateInput: value.candidateInput,
    stockContexts: Object.fromEntries(value.snapshot.stocks.map(stock => [stock.code, contextOf(value.stockContexts?.[stock.code] ?? value.snapshot)])),
    collapsedCodes: [...new Set(value.collapsedCodes ?? [])].filter(code => value.snapshot.stocks.some(stock => stock.code === code)) }));
}

export function dividendResearchSnapshotForStock(value: SavedDividendResearch, code: string): DividendResearchSnapshot {
  return { ...contextOf(value.stockContexts?.[code] ?? value.snapshot), stocks: value.snapshot.stocks.filter(stock => stock.code === code) };
}

function mergeResearch(previous: SavedDividendResearch | null, incoming: SavedDividendResearch): SavedDividendResearch {
  if (!previous) return cleanResearch(incoming);
  const saved = cleanResearch(previous), next = cleanResearch(incoming);
  const stocks = new Map(saved.snapshot.stocks.map(stock => [stock.code, stock]));
  const contexts = { ...saved.stockContexts };
  for (const stock of next.snapshot.stocks) {
    const context = next.stockContexts![stock.code];
    // A slow single-stock review may finish after a newer batch. Compare each stock's own evidence date.
    if (!contexts[stock.code] || context.generatedAt >= contexts[stock.code].generatedAt) {
      stocks.set(stock.code, stock); contexts[stock.code] = context;
    }
  }
  const latest = next.snapshot.generatedAt >= saved.snapshot.generatedAt ? next : saved;
  return { ...latest, snapshot: { ...latest.snapshot, stocks: [...stocks.values()] }, stockContexts: contexts,
    collapsedCodes: saved.collapsedCodes };
}

export async function loadDividendResearchCache(): Promise<SavedDividendResearch | null> {
  const value = await results.get('latest');
  if (!value) return null;
  if (!valid(value)) throw new Error('INVALID_RESEARCH_CACHE');
  return cleanResearch(value);
}

export async function saveDividendResearchCache(value: SavedDividendResearch): Promise<SavedDividendResearch> {
  if (!valid(value)) throw new Error('INVALID_RESEARCH_CACHE');
  return cache.transaction('rw', results, async () => {
    const previous = await results.get('latest');
    if (previous && !valid(previous)) throw new Error('INVALID_RESEARCH_CACHE');
    const merged = mergeResearch(previous ?? null, value);
    await results.put({ id: 'latest', ...merged });
    return merged;
  });
}

export async function saveDividendResearchCollapse(code: string, collapsed: boolean): Promise<void> {
  if (mainlandCode(code) !== code) throw new Error('INVALID_RESEARCH_CACHE');
  await cache.transaction('rw', results, async () => {
    const previous = await results.get('latest');
    if (!previous) return;
    if (!valid(previous)) throw new Error('INVALID_RESEARCH_CACHE');
    const clean = cleanResearch(previous);
    const collapsedCodes = new Set(clean.collapsedCodes);
    if (collapsed && clean.snapshot.stocks.some(stock => stock.code === code)) collapsedCodes.add(code);
    else collapsedCodes.delete(code);
    await results.put({ id: 'latest', ...clean, collapsedCodes: [...collapsedCodes] });
  });
}

export function closeDividendResearchCache() { cache.close(); }
