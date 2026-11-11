import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import Dexie from 'dexie';
import { dividendLedgerBase, DIVIDEND_OFFICIAL_PARSER_VERSION } from '../src/lib/dividendLedger.ts';
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

test('structured research never calls retired official transports and saves usable cash without PDF receipts', async () => {
  const run=transport();
  const ledger=await researchDividendLedger(raw,'000001',scope,run.options);
  assert.deepEqual(run.requests,[]); assert.deepEqual(run.downloads,[]);
  assert.equal(await stored.table('documents').count(),0);
  assert.equal(dividendLedgerBase(ledger,scope).dpsMicros,609000);
  assert.equal(dividendEvidenceStatus(ledger,scope).usable,true);
  assert.deepEqual(await loadSavedDividendLedger('000001'),ledger);
});

test('an existing complete Changjiang batch uses its implementation title rather than asking for the same cash again', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-changjiang-2026-11-11.json', import.meta.url), 'utf8'));
  let requests = 0;
  const ledger = await researchDividendLedger(fixture.distribution, '600900', fixture.capturedAt, {
    readAnnouncementIndex: async url => { requests++; assert.equal(new URL(url).searchParams.get('begin_time'), '2026-02-05'); return fixture.announcements; },
    post: async () => { throw new Error('must not request cninfo'); }, readPdf: async () => { throw new Error('must not download PDF'); },
  });
  const base = dividendLedgerBase(ledger, fixture.capturedAt);
  assert.equal(requests, 1); assert.equal(base.frequency, 'semiannual'); assert.equal(base.dpsMicros, 1000000); assert.equal(base.verified, true);
  assert.deepEqual(base.reportPeriods, ['2025-12-31', '2025-06-30']);
  const corrected = ledger.events.find(event => event.exDate === '2026-02-12')!;
  assert.equal(corrected.sourceReportDate, '2025-09-30'); assert.equal(corrected.reportDate, '2025-06-30');
  assert.ok(corrected.sources.some(source => source.title?.includes('2025年中期权益分派实施公告')));
  await researchDividendLedger(fixture.distribution, '600900', fixture.capturedAt, { readAnnouncementIndex: async () => { throw new Error('cached exact title must be reused'); } });
  assert.equal((await loadSavedDividendLedger('600900'))?.events.find(event => event.exDate === '2026-02-12')?.reportDate, '2025-06-30');
});

test('a foreign, ambiguous or actual quarterly title cannot be guessed into an interim distribution', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-changjiang-2026-11-11.json', import.meta.url), 'utf8'));
  for (const announcements of [
    { ...fixture.announcements, data: { list: fixture.announcements.data.list.map((item: object) => ({ ...item, codes: [{ stock_code: '000001' }] })) } },
    { ...fixture.announcements, data: { list: [...fixture.announcements.data.list, { ...fixture.announcements.data.list[0], title: '长江电力2025年第三季度权益分派实施公告' }] } },
    { ...fixture.announcements, data: { list: fixture.announcements.data.list.map((item: object) => ({ ...item, title: '长江电力2025年第三季度权益分派实施公告' })) } },
  ]) {
    const ledger = await researchDividendLedger(fixture.distribution, '600900', fixture.capturedAt, { readAnnouncementIndex: async () => announcements });
    assert.equal(dividendLedgerBase(ledger, fixture.capturedAt).verified, false);
  }
});

test('an obsolete cached PDF extraction cannot override complete gross cash, and its original document is retained', async () => {
  const value = { url: 'https://static.cninfo.com.cn/finalpage/2026-06-05/obsolete.PDF', sha256: 'old', checkedAt: scope,
    event: { code: '000001', reportDate: '2025-12-31', period: 'annual', announcementDate: '2026-06-05', recordDate: '2026-06-11', exDate: '2026-06-12',
      cashPer10Micros: 3240000, bonusPer10Bps: 0, transferPer10Bps: 0, sourceUrl: 'https://static.cninfo.com.cn/finalpage/2026-06-05/obsolete.PDF', verifiedAt: scope } };
  await stored.table('documents').put(value);
  const ledger = await researchDividendLedger(raw, '000001', scope);
  assert.equal(ledger.officialParserVersion, DIVIDEND_OFFICIAL_PARSER_VERSION);
  assert.equal(dividendLedgerBase(ledger, scope).dpsMicros, 609000);
  assert.deepEqual(await stored.table('documents').get(value.url), value);
  assert.ok(ledger.events.every(event => event.sources.every(source => source.url !== value.url)));
});

test('previous official receipts stay immutable optional evidence without a new official request', async () => {
  const legacy=transport();
  await fetchDividendOfficialEvidence('000001',scope,legacy.options);
  const documents=await stored.table('documents').toArray();
  assert.equal(documents.length,2);
  for (const doc of documents) {
    assert.equal(doc.checkedAt,scope); assert.equal(doc.event.verifiedAt,scope);
    assert.equal(doc.sha256,createHash('sha256').update('%PDF-ISOLATED:'+doc.url).digest('hex'));
  }
  const current=transport();
  const ledger=await researchDividendLedger(raw,'000001','2026-10-30',current.options);
  assert.deepEqual(current.requests,[]); assert.deepEqual(current.downloads,[]);
  assert.deepEqual(await stored.table('documents').toArray(),documents);
  assert.equal(dividendLedgerBase(ledger,'2026-10-30').dpsMicros,609000);
  assert.ok(ledger.events.some(event=>event.sources.some(source=>source.verifiedAt===scope)));
});

test('missing latest cash and duplicate source conflicts never save an older substitute as a new success', async () => {
  const missing=structuredClone(raw); missing.result.data[0].PRETAX_BONUS_RMB=null;
  const result=await researchDividendLedger(missing,'000001',scope,transport().options);
  assert.equal(dividendLedgerBase(result,scope).verified,false);
  assert.equal(await loadSavedDividendLedger('000001'),undefined);
  const conflict=structuredClone(raw);
  conflict.result.data.push({...conflict.result.data[0],PRETAX_BONUS_RMB:2.5});
  const conflicted=await researchDividendLedger(conflict,'000001',scope,transport().options);
  assert.ok(dividendLedgerBase(conflicted,scope).flags.includes('SOURCE_CONFLICT'));
  assert.equal(await loadSavedDividendLedger('000001'),undefined);
});

test('invalid provider input cannot overwrite a successful saved ledger or mutate its original dates', async () => {
  const saved=await researchDividendLedger(raw,'000001',scope,transport().options);
  await assert.rejects(researchDividendLedger({success:false},'000001','2026-10-30'),/INVALID_DIVIDEND_LEDGER_SOURCE/);
  assert.deepEqual(await loadSavedDividendLedger('000001'),saved);
  const attempted=await loadDividendLedgerForCheck('000001');
  assert.ok(attempted?.issues.includes('DIVIDEND_SOURCE_REFRESH_FAILED'));
  assert.equal(await stored.table('documents').count(),0);
});

test('retired PDF issues do not become current requests or rewrite the saved ledger', async () => {
  const ledger=await researchDividendLedger(raw,'000001',scope);
  const legacy={...ledger,issues:['CNINFO_HTTP_503','ANNOUNCEMENT_DOWNLOAD_FAILED']};
  await stored.table('ledgers').put(legacy);
  const checked=await loadDividendLedgerForCheck('000001');
  assert.deepEqual(checked?.issues,[]); assert.equal(checked?.asOf,scope);
  assert.deepEqual(await loadSavedDividendLedger('000001'),legacy);
});

test('cancellation before cache commit preserves the last success without starting official requests', async () => {
  const original=await researchDividendLedger(raw,'000001',scope);
  const controller=new AbortController(); const run=transport();
  await assert.rejects(researchDividendLedger(raw,'000001','2026-10-30',{
    ...run.options,signal:controller.signal,beforeWrite:async()=>controller.abort(),
  }));
  assert.deepEqual(await loadSavedDividendLedger('000001'),original);
  assert.deepEqual(run.requests,[]);
});

test('a newer structured refresh owns the ledger even when an older cache write resumes late', async () => {
  let release!:()=>void, started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const older=researchDividendLedger(raw,'000001',scope,{beforeWrite:async()=>{started();await gate;}});
  await entered;
  const updated=structuredClone(raw);updated.result.data[0].PRETAX_BONUS_RMB=2.5;
  const current=await researchDividendLedger(updated,'000001','2026-10-30');
  release();await assert.rejects(older);
  assert.deepEqual(await loadSavedDividendLedger('000001'),current);
});

// Compatibility checks for the retired adapter and its optional legacy receipts.
test('explicit recovery retries a failed same-day extraction and preserves every successful document', async () => {
  const partial = transport();
  const extract = partial.options.extractPdf;
  partial.options.extractPdf = async bytes => {
    const url = new TextDecoder().decode(bytes).replace('%PDF-ISOLATED:', '');
    return url === fixtures[0].sourceUrl ? extract(bytes) : 'Temporarily unparseable implementation notice';
  };
  const first = await fetchDividendOfficialEvidence('000001', scope, partial.options);
  assert.equal(first.events.length, 1);
  const savedSuccess = await stored.table('documents').get(fixtures[0].sourceUrl);
  const retry = transport();
  const recovered = await fetchDividendOfficialEvidence('000001', scope, { ...retry.options, retryFailedDocuments: true });
  assert.equal(recovered.events.length, 2);
  assert.deepEqual(recovered.issues, []);
  assert.deepEqual(retry.downloads, [fixtures[1].sourceUrl]);
  assert.deepEqual(await stored.table('documents').get(fixtures[0].sourceUrl), savedSuccess,
    'successful hash, facts and original verification date remain immutable');
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
