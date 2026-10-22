import Dexie, { type Table } from 'dexie';
import { isDividendSelectionPrinciples, type DividendResearchSnapshot } from '../lib/dividendResearch.ts';
import { mainlandCode } from '../lib/dividendWorkbench.ts';

export interface SavedDividendResearch {
  snapshot: DividendResearchSnapshot;
  scope: 'plan' | 'candidates';
  candidateInput: string;
}

// A dated research result is separate from the asset ledger and contains no API credentials.
const cache = new Dexie('FortunaDividendResearchCache');
cache.version(1).stores({ results: 'id' });
const results: Table<SavedDividendResearch & { id: string }, string> = cache.table('results');

function valid(value: SavedDividendResearch): boolean {
  const snapshot = value?.snapshot;
  return !!snapshot && ['plan', 'candidates'].includes(value.scope) && typeof value.candidateInput === 'string'
    && Number.isSafeInteger(snapshot.generatedAt) && snapshot.generatedAt > 0
    && isDividendSelectionPrinciples(snapshot.principles) && Array.isArray(snapshot.stocks) && snapshot.stocks.length <= 100
    && snapshot.stocks.every(stock => stock && mainlandCode(stock.code) === stock.code && typeof stock.name === 'string'
      && ['pass', 'risk', 'unknown'].includes(stock.status) && Array.isArray(stock.checks) && Array.isArray(stock.sources) && Array.isArray(stock.issues))
    && Array.isArray(snapshot.indices);
}

export async function loadDividendResearchCache(): Promise<SavedDividendResearch | null> {
  const value = await results.get('latest');
  if (!value) return null;
  if (!valid(value)) throw new Error('INVALID_RESEARCH_CACHE');
  return { snapshot: value.snapshot, scope: value.scope, candidateInput: value.candidateInput };
}

export async function saveDividendResearchCache(value: SavedDividendResearch): Promise<void> {
  if (!valid(value)) throw new Error('INVALID_RESEARCH_CACHE');
  // Persist only the research contract, even if the caller supplies extra fields.
  const clean: SavedDividendResearch = JSON.parse(JSON.stringify({ snapshot: value.snapshot, scope: value.scope, candidateInput: value.candidateInput }));
  await cache.transaction('rw', results, async () => {
    const previous = await results.get('latest');
    if (previous && previous.snapshot.generatedAt > clean.snapshot.generatedAt) return;
    await results.put({ id: 'latest', ...clean });
  });
}

export function closeDividendResearchCache() { cache.close(); }
