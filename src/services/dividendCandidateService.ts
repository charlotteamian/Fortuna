import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { httpResponseDataToText } from '../lib/httpResponse.ts';
import { mainlandCode, type DividendStock } from '../lib/dividendWorkbench.ts';

type Candidate = Pick<DividendStock, 'code' | 'name'>;
const normalName = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export class DividendCandidateError extends Error {
  readonly reason: 'missing' | 'ambiguous' | 'request';
  readonly query: string;
  readonly matches: Candidate[];
  constructor(reason: 'missing' | 'ambiguous' | 'request', query: string, matches: Candidate[] = []) {
    super('DIVIDEND_CANDIDATE_LOOKUP'); this.reason = reason; this.query = query; this.matches = matches;
  }
}

export function parseDividendCandidateMatches(raw: unknown): Candidate[] {
  const rows = (raw as { QuotationCodeTable?: { Data?: unknown } })?.QuotationCodeTable?.Data;
  if (!Array.isArray(rows)) throw new Error('INVALID_CANDIDATE_RESPONSE');
  const matches = new Map<string, Candidate>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value = row as Record<string, unknown>;
    if (value.Classify !== 'AStock' || typeof value.Code !== 'string' || mainlandCode(value.Code) !== value.Code
      || typeof value.Name !== 'string' || !value.Name.trim() || value.Name.length > 80) continue;
    matches.set(value.Code, { code: value.Code, name: value.Name.trim() });
  }
  return [...matches.values()];
}

export async function searchDividendCandidates(query: string): Promise<Candidate[]> {
  const path = `/api/suggest/get?${new URLSearchParams({ input: query, type: '14', count: '30' })}`;
  let text: string;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url: `https://searchapi.eastmoney.com${path}`, responseType: 'text', connectTimeout: 8000, readTimeout: 8000 });
    if (response.status !== 200) throw new Error(`CANDIDATE_HTTP_${response.status}`);
    text = httpResponseDataToText(response.data);
  } else {
    const response = await fetch(`/dividend-search-api${path}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`CANDIDATE_HTTP_${response.status}`);
    text = await response.text();
  }
  return parseDividendCandidateMatches(JSON.parse(text));
}

/** Resolve every token before any research starts. Ambiguous names are never silently selected. */
export async function resolveDividendCandidates(input: string, known: Candidate[],
  search: (query: string) => Promise<Candidate[]> = searchDividendCandidates): Promise<Candidate[]> {
  const tokens = [...new Set(input.trim().split(/[\s,，、;；]+/).filter(Boolean))];
  if (!tokens.length || tokens.length > 20 || input.length > 400) throw new Error('INVALID_RESEARCH_CODES');
  const resolved = await Promise.all(tokens.map(async token => {
    const code = mainlandCode(token);
    if (code) return known.find(stock => stock.code === code) ?? { code, name: code };
    if (/^\d+$/.test(token) || !/^[\p{L}\p{N}*·.（）()-]{1,40}$/u.test(token)) throw new Error('INVALID_RESEARCH_CODES');
    const exact = known.filter(stock => normalName(stock.name) === normalName(token));
    if (exact.length === 1) return exact[0];
    let matches: Candidate[];
    try { matches = await search(token); }
    catch { throw new DividendCandidateError('request', token); }
    const named = matches.filter(stock => normalName(stock.name) === normalName(token));
    if (named.length === 1) return named[0];
    if (matches.length === 1) return matches[0];
    throw new DividendCandidateError(matches.length ? 'ambiguous' : 'missing', token, matches.slice(0, 8));
  }));
  return [...new Map(resolved.map(stock => [stock.code, stock])).values()];
}
