import assert from 'node:assert/strict';
import test from 'node:test';
import { DividendCandidateError, parseDividendCandidateMatches, resolveDividendCandidates, searchDividendCandidates } from '../src/services/dividendCandidateService.ts';

const cmb = { code: '600036', name: '招商银行' };
const known = [cmb, { code: '000001', name: '平安银行' }];
const envelope = { QuotationCodeTable: { Data: [
  { Code: '600036', Name: '招商银行', Classify: 'AStock' },
  { Code: '03968', Name: '招商银行', Classify: 'HKStock' },
  { Code: '512890', Name: '红利低波', Classify: 'Fund' },
  { Code: '000001', Name: '平安银行', Classify: 'AStock' },
] } };

test('name/code/mixed candidate input resolves names locally and online, deduplicates and supports list punctuation', async () => {
  const queries: string[] = [];
  const search = async (query: string) => { queries.push(query); return [{ code: '600900', name: '长江电力' }]; };
  assert.deepEqual(await resolveDividendCandidates('招商银行、SZ000001，长江电力 600036', known, search), [...known, { code: '600900', name: '长江电力' }]);
  assert.deepEqual(queries, ['长江电力']);
  assert.deepEqual(await resolveDividendCandidates('招商银行', [], async () => [cmb, { code: '601招商', name: 'Other' }]), [cmb]);
  assert.deepEqual(parseDividendCandidateMatches(envelope), known);
});

test('ambiguous, unavailable and invalid candidate names stop before any research or silent selection', async () => {
  await assert.rejects(resolveDividendCandidates('银行', [], async () => known), error => error instanceof DividendCandidateError && error.reason === 'ambiguous' && error.matches.length === 2);
  await assert.rejects(resolveDividendCandidates('不存在', [], async () => []), error => error instanceof DividendCandidateError && error.reason === 'missing');
  await assert.rejects(resolveDividendCandidates('某公司', [], async () => { throw new Error('HTTP_503'); }), error => error instanceof DividendCandidateError && error.reason === 'request');
  for (const invalid of ['600036)(REPORT_DATE>0)', '512890', Array.from({ length: 21 }, (_, i) => `公司${i}`).join(' ')]) {
    await assert.rejects(resolveDividendCandidates(invalid, known), /INVALID_RESEARCH_CODES/);
  }
});

test('online search uses UTF-8 names, bounded endpoint and filters non-A-share securities', async () => {
  const original = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async input => { requested = String(input); return new Response(JSON.stringify(envelope)); };
  try {
    assert.deepEqual(await searchDividendCandidates('招商银行'), known);
    assert.match(requested, /^\/dividend-search-api\/api\/suggest\/get\?/);
    assert.equal(new URL(requested, 'http://localhost').searchParams.get('input'), '招商银行');
  } finally { globalThis.fetch = original; }
});
