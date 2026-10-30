import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import Dexie from 'dexie';
import { dividendLedgerBase } from '../src/lib/dividendLedger.ts';
import { dividendEvidenceStatus } from '../src/lib/dividendEvidenceStatus.ts';
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const path = new URL(`${specifier}.ts`, context.parentURL); if (existsSync(path)) return { url: path.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { fetchDividendOfficialEvidence, researchDividendLedger, loadSavedDividendLedger, loadDividendLedgerForCheck, closeDividendLedgerEvidence } = await import('../src/services/dividendLedgerEvidenceService.ts');
const stored = new Dexie('FortunaDividendLedger'); stored.version(1).stores({ documents: 'url', ledgers: 'code' });
beforeEach(async () => { await stored.table('documents').clear(); await stored.table('ledgers').clear(); });
after(async () => { closeDividendLedgerEvidence(); stored.close(); await Dexie.delete('FortunaDividendLedger'); });
const fixtures = ['pingan-2026-interim', 'pingan-2025-final'].map(name => JSON.parse(readFileSync(new URL(`./fixtures/dividend-official/${name}.json`, import.meta.url), 'utf8')));
const raw = JSON.parse(readFileSync(new URL('./fixtures/dividend-pricing-pingan-2026-10-23.json', import.meta.url), 'utf8')).sources.distribution.data;
const scope = '2026-10-29';
function transport() {
  const downloads: string[] = [], requests: { path: string; fields: Record<string, string> }[] = [];
  const options = {
    post: async (path: string, fields: Record<string, string>) => {
      requests.push({ path, fields });
      if (path.includes('topSearch')) return [{ code: '000001', orgId: 'gssz0000001' }];
      return { hasMore: false, announcements: fixtures.map(value => ({ secCode: '000001', announcementTitle: '年度权益分派实施公告', adjunctUrl: new URL(value.sourceUrl).pathname.slice(1), announcementTime: Date.parse(`${value.announcementDate}T00:00:00+08:00`) })) };
    },
    readPdf: async (url: string) => { downloads.push(url); return new TextEncoder().encode(`%PDF-ISOLATED:${url}`); },
    extractPdf: async (bytes: Uint8Array) => { const url = new TextDecoder().decode(bytes).replace('%PDF-ISOLATED:', ''); return fixtures.find(value => value.sourceUrl === url)!.text; },
  };
  return { options, downloads, requests };
}

test('official adapter derives verified event facts from actual announcement text and caches only exact document evidence', async () => {
  const { options, downloads, requests } = transport();
  const ledger = await researchDividendLedger(raw, '000001', scope, options);
  assert.equal(dividendLedgerBase(ledger, scope).dpsMicros, 609000); assert.equal(dividendLedgerBase(ledger, scope).verified, true);
  assert.equal(downloads.length, 2); assert.equal(requests[1].fields.stock, '000001,gssz0000001'); assert.equal(requests[1].fields.column, 'szse');
  const docs = await stored.table('documents').toArray();
  for (const doc of docs) { assert.equal(doc.checkedAt, scope); assert.equal(doc.event.verifiedAt, scope); assert.equal(doc.sha256, createHash('sha256').update(`%PDF-ISOLATED:${doc.url}`).digest('hex')); assert.equal('text' in doc.event, false); }
  assert.deepEqual(await loadSavedDividendLedger('000001'), ledger);
});

test('cached official evidence retains its original verification date and hash on later checks', async () => {
  const first = transport(); await researchDividendLedger(raw, '000001', scope, first.options);
  const saved = await stored.table('documents').toArray();
  const second = transport(); const result = await fetchDividendOfficialEvidence('000001', '2026-10-30', second.options);
  assert.equal(second.downloads.length, 0); assert.equal(result.events.length, 2); assert.ok(result.events.every(event => event.verifiedAt === scope));
  assert.deepEqual(await stored.table('documents').toArray(), saved);
  const current = await researchDividendLedger(raw, '000001', '2026-10-30', second.options);
  assert.equal(second.downloads.length, 0);
  assert.equal(dividendEvidenceStatus(current, '2026-10-30').usable, true);
  assert.equal(dividendLedgerBase(current, '2026-10-30').verified, true);
  assert.deepEqual(await stored.table('documents').toArray(), saved, 'a successful current list reuses immutable documents');
  assert.deepEqual(await loadSavedDividendLedger('000001'), current);
});

test('a source discrepancy survives official extraction as a conflict, never a substituted verified amount', async () => {
  const changed = structuredClone(raw); changed.result.data[0].PRETAX_BONUS_RMB = 2.5;
  const ledger = await researchDividendLedger(changed, '000001', scope, transport().options);
  const latest = ledger.events.find(event => event.reportDate === '2026-06-30')!;
  assert.equal(latest.verification, 'conflict'); assert.equal(latest.cashPer10Micros, 2500000);
  const base = dividendLedgerBase(ledger, scope); assert.equal(base.dpsMicros, undefined); assert.equal(base.verified, false); assert.ok(base.flags.includes('SOURCE_CONFLICT'));
});

test('an empty official list or unparseable PDF does not create a verified dividend record', async () => {
  const empty = transport(); empty.options.post = async path => path.includes('topSearch') ? [{ code: '000001', orgId: 'gssz0000001' }] : { hasMore: false, announcements: [] };
  const unknown = await researchDividendLedger(raw, '000001', scope, empty.options);
  assert.equal(dividendLedgerBase(unknown, scope).verified, false); assert.ok(unknown.events.every(event => event.verification === 'unverified'));
  const malformed = transport(); malformed.options.extractPdf = async () => 'This document has no verified implementation facts.';
  const result = await fetchDividendOfficialEvidence('000001', scope, malformed.options);
  assert.equal(result.events.length, 0); assert.ok(result.issues.includes('ANNOUNCEMENT_FIELDS_UNVERIFIED'));
  const cachedFailure = await fetchDividendOfficialEvidence('000001', scope, malformed.options);
  assert.equal(cachedFailure.events.length, 0); assert.ok(cachedFailure.issues.includes('ANNOUNCEMENT_FIELDS_UNVERIFIED'), 'same-day cached extraction gaps must remain visible');
});

test('failed requests preserve earlier document facts; invalid provider input cannot erase a saved ledger', async () => {
  const saved = await researchDividendLedger(raw, '000001', scope, transport().options);
  const documents = await stored.table('documents').toArray();
  const failed = { post: async () => { throw new Error('CNINFO_HTTP_503'); } };
  const retry = await fetchDividendOfficialEvidence('000001', '2026-10-30', failed);
  assert.equal(retry.events.length, 2); assert.deepEqual(retry.issues, ['CNINFO_HTTP_503']); assert.deepEqual(await stored.table('documents').toArray(), documents);
  await assert.rejects(researchDividendLedger({ success: false }, '000001', '2026-10-30', failed), /INVALID_DIVIDEND_LEDGER_SOURCE/);
  assert.deepEqual(await loadSavedDividendLedger('000001'), saved);
  const currentAttempt = await loadDividendLedgerForCheck('000001');
  assert.equal(currentAttempt?.complete, false); assert.equal(currentAttempt?.asOf, '2026-10-30');
  assert.ok(currentAttempt?.issues.includes('INVALID_DIVIDEND_LEDGER_SOURCE'));
});

test('a failed next-day official refresh cannot promote cached facts or overwrite the last successful ledger', async () => {
  const saved = await researchDividendLedger(raw, '000001', scope, transport().options);
  const documents = await stored.table('documents').toArray();
  const attempted = await researchDividendLedger(raw, '000001', '2026-10-30', { post: async () => { throw new Error('CNINFO_HTTP_503'); } });
  assert.equal(attempted.asOf, '2026-10-30'); assert.equal(attempted.complete, false);
  assert.equal(dividendLedgerBase(attempted, '2026-10-30').verified, false);
  assert.deepEqual(dividendEvidenceStatus(attempted, '2026-10-30'), { status: 'failed', usable: false, reasons: ['CNINFO_HTTP_503'] });
  assert.deepEqual(await stored.table('documents').toArray(), documents);
  assert.deepEqual(await loadSavedDividendLedger('000001'), saved);
  assert.deepEqual(await loadDividendLedgerForCheck('000001'), attempted);
  assert.ok(attempted.events.flatMap(event => event.sources).filter(source => source.verifiedAt).every(source => source.verifiedAt === scope));
});

test('same-day failure remains visible to checks until a successful retry without changing successful facts', async () => {
  const saved = await researchDividendLedger(raw, '000001', scope, transport().options);
  const failed = await researchDividendLedger(raw, '000001', scope, { post: async () => { throw new Error('Failed to fetch'); } });
  assert.equal(dividendEvidenceStatus(failed, scope).status, 'failed');
  assert.ok(failed.issues.includes('ANNOUNCEMENT_REFRESH_FAILED'));
  assert.deepEqual(await loadSavedDividendLedger('000001'), saved);
  assert.equal((await loadDividendLedgerForCheck('000001'))?.complete, false);
  const retry = transport(); const recovered = await researchDividendLedger(raw, '000001', scope, retry.options);
  assert.equal(retry.downloads.length, 0);
  assert.deepEqual(await loadDividendLedgerForCheck('000001'), recovered);
  assert.equal(dividendEvidenceStatus(recovered, scope).status, 'current');
});

test('incomplete official listing does not replace the last successful complete coverage', async () => {
  const saved = await researchDividendLedger(raw, '000001', scope, transport().options);
  const options = transport().options;
  const request = options.post;
  options.post = async (path, fields) => {
    const result = await request(path, fields);
    return Array.isArray(result) ? result : { ...result, hasMore: true };
  };
  const incomplete = await researchDividendLedger(raw, '000001', '2026-10-30', options);
  assert.equal(incomplete.complete, false); assert.ok(incomplete.issues.includes('ANNOUNCEMENT_LIST_PARTIAL'));
  assert.equal(dividendEvidenceStatus(incomplete, '2026-10-30').status, 'incomplete');
  assert.equal(dividendLedgerBase(incomplete, '2026-10-30').verified, false);
  assert.deepEqual(await loadSavedDividendLedger('000001'), saved);
});

test('a newly listed document download failure keeps successful facts and cannot certify current coverage', async () => {
  const saved = await researchDividendLedger(raw, '000001', scope, transport().options);
  const documents = await stored.table('documents').toArray();
  const options = transport().options;
  const request = options.post;
  options.post = async (path, fields) => {
    const result = await request(path, fields);
    return Array.isArray(result) ? result : { ...result, announcements: [...result.announcements,
      { secCode: '000001', announcementTitle: '权益分派实施公告', adjunctUrl: 'finalpage/2026-10-30/new.PDF', announcementTime: Date.parse('2026-10-30T00:00:00+08:00') }] };
  };
  options.readPdf = async () => { throw new Error('SYNTHETIC_OFFLINE'); };
  const failed = await researchDividendLedger(raw, '000001', '2026-10-30', options);
  assert.equal(failed.complete, false); assert.equal(dividendEvidenceStatus(failed, '2026-10-30').status, 'failed');
  assert.ok(failed.issues.includes('ANNOUNCEMENT_DOWNLOAD_FAILED'));
  assert.equal(dividendLedgerBase(failed, '2026-10-30').verified, false);
  assert.deepEqual(await loadSavedDividendLedger('000001'), saved);
  assert.deepEqual(await stored.table('documents').toArray(), documents);
});

test('an unsupported unrelated older document remains a visible gap without changing required-batch rules', async () => {
  await researchDividendLedger(raw, '000001', scope, transport().options);
  const options = transport().options;
  const request = options.post;
  options.post = async (path, fields) => {
    const result = await request(path, fields);
    return Array.isArray(result) ? result : { ...result, announcements: [...result.announcements,
      { secCode: '000001', announcementTitle: '历史权益分派实施公告', adjunctUrl: 'finalpage/2017-06-01/old-unparsed.PDF', announcementTime: Date.parse('2017-06-01T00:00:00+08:00') }] };
  };
  options.extractPdf = async () => 'Unsupported older layout';
  const ledger = await researchDividendLedger(raw, '000001', '2026-10-30', options);
  assert.ok(ledger.issues.includes('ANNOUNCEMENT_FIELDS_UNVERIFIED'));
  assert.equal(dividendEvidenceStatus(ledger, '2026-10-30').usable, true);
  assert.equal(dividendLedgerBase(ledger, '2026-10-30').verified, true);
});

test('invalid dates and missing company matches stay explicit failures instead of querying another issuer', async () => {
  await assert.rejects(fetchDividendOfficialEvidence('000001', '2026-02-30', transport().options), /INVALID_DIVIDEND_DATE/);
  await assert.rejects(fetchDividendOfficialEvidence('BAD', scope, transport().options), /INVALID_DIVIDEND_CODE/);
  const wrong = transport(); wrong.options.post = async () => [{ code: '600036', orgId: 'gssh0600036' }];
  const evidence = await fetchDividendOfficialEvidence('000001', scope, wrong.options);
  assert.deepEqual(evidence.events, []); assert.deepEqual(evidence.issues, ['CNINFO_COMPANY_NOT_FOUND']); assert.equal(wrong.downloads.length, 0);
});

test('announcement pagination and the 12-document budget continue into older uncached evidence on the next check', async () => {
  const calls: number[] = [], files: string[] = []; let active = 0, maximumActive = 0;
  const list = Array.from({ length: 15 }, (_, index) => ({ announcementTitle: '权益分派实施公告', adjunctUrl: `finalpage/2026-09-17/test-${index}.PDF`, announcementTime: Date.parse('2026-09-17T00:00:00+08:00') }));
  const options = {
    post: async (path: string, fields: Record<string, string>) => {
      if (path.includes('topSearch')) return [{ code: '000001', orgId: 'gssz0000001' }];
      const page = Number(fields.pageNum); calls.push(page); return { announcements: page === 1 ? list.slice(0, 10) : list.slice(10), hasMore: page === 1 };
    },
    readPdf: async (url: string) => { files.push(url); active++; maximumActive = Math.max(maximumActive, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return new TextEncoder().encode(`%PDF-ISOLATED:${url}`); },
    extractPdf: async () => fixtures[0].text,
  };
  const first = await fetchDividendOfficialEvidence('000001', scope, options);
  assert.equal(first.events.length, 12); assert.ok(first.issues.includes('ANNOUNCEMENT_VERIFICATION_PARTIAL')); assert.equal(files.length, 12);
  const second = await fetchDividendOfficialEvidence('000001', scope, options);
  assert.equal(second.events.length, 15); assert.equal(second.issues.includes('ANNOUNCEMENT_VERIFICATION_PARTIAL'), false); assert.equal(files.length, 15);
  assert.deepEqual(calls, [1, 2, 1, 2]); assert.ok(maximumActive <= 3);
});

test('Shanghai company lookup uses its exact official orgId and SSE query column', async () => {
  const source = JSON.parse(readFileSync(new URL('./fixtures/dividend-official/cmb-2025-final.json', import.meta.url), 'utf8'));
  const seen: Record<string, string>[] = [];
  const evidence = await fetchDividendOfficialEvidence('600036', scope, {
    post: async (path, fields) => { if (path.includes('topSearch')) return [{ code: '600036', orgId: 'gssh0600036' }]; seen.push(fields); return { hasMore: false, announcements: [{ announcementTitle: '2025年度A股分红派息实施公告', adjunctUrl: new URL(source.sourceUrl).pathname.slice(1), announcementTime: Date.parse(`${source.announcementDate}T00:00:00+08:00`) }] }; },
    readPdf: async () => new TextEncoder().encode('%PDF-SHANGHAI'), extractPdf: async () => source.text,
  });
  assert.equal(seen[0].column, 'sse'); assert.equal(seen[0].stock, '600036,gssh0600036'); assert.equal(evidence.events[0].cashPer10Micros, 10030000);
});
