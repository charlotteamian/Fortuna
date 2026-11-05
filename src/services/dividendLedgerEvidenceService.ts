import { Capacitor, CapacitorHttp } from '@capacitor/core';
import Dexie, { type Table } from 'dexie';
import { buildDividendLedger, parseDividendOfficialAnnouncementText, type DividendLedger, type DividendOfficialEvent } from '../lib/dividendLedger';
import { dateInChina } from '../lib/dividendWorkbench';
import { dividendEvidenceStatus } from '../lib/dividendEvidenceStatus.ts';
import { assertDividendRequestCurrent, awaitDividendRequest, beforeDividendCacheWrite, claimDividendRequest, dividendRequestSignal, type DividendRequestControl } from './dividendRequestControl';

export interface DividendOfficialEvidenceOptions extends DividendRequestControl {
  post?: (path: string, fields: Record<string, string>) => Promise<unknown>;
  readPdf?: (url: string) => Promise<Uint8Array>;
  extractPdf?: (bytes: Uint8Array) => Promise<string>;
  /** An explicit recovery request may retry failed extraction on the same day. */
  retryFailedDocuments?: boolean;
  /** Continue cached-document pagination within one bounded explicit request. */
  maxEvidencePasses?: number;
}

interface DocumentEvidence { url: string; sha256: string; checkedAt: string; event?: DividendOfficialEvent; issue?: string }
const database = new Dexie('FortunaDividendLedger');
database.version(1).stores({ documents: 'url', ledgers: 'code' });
const documents: Table<DocumentEvidence, string> = database.table('documents');
const ledgers: Table<DividendLedger, string> = database.table('ledgers');
const CNINFO = 'https://www.cninfo.com.cn';
// Failed attempts remain available to this run without replacing a successful
// persistent ledger. This is transient evidence state, never business storage.
const latestLedgerAttempts = new Map<string, DividendLedger>();

async function post(path: string, fields: Record<string, string>, control: DividendRequestControl): Promise<unknown> {
  assertDividendRequestCurrent(control);
  const data = new URLSearchParams(fields).toString();
  if (Capacitor.isNativePlatform()) {
    const result = await awaitDividendRequest(CapacitorHttp.post({ url: CNINFO + path, data, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: CNINFO + '/', Origin: CNINFO, 'X-Requested-With': 'XMLHttpRequest' },
      responseType: 'json', connectTimeout: 8000, readTimeout: 10000 }), control);
    if (result.status !== 200) throw new Error(`CNINFO_HTTP_${result.status}`);
    return typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
  }
  const result = await fetch('/dividend-cninfo-api' + path, { method: 'POST', body: data, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: dividendRequestSignal(control, 12000) });
  if (!result.ok) throw new Error(`CNINFO_HTTP_${result.status}`);
  return awaitDividendRequest(result.json(), control);
}

async function readPdf(url: string, control: DividendRequestControl): Promise<Uint8Array> {
  assertDividendRequestCurrent(control);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'static.cninfo.com.cn' || !parsed.pathname.startsWith('/finalpage/')) throw new Error('INVALID_DIVIDEND_DOCUMENT');
  let bytes: Uint8Array;
  if (Capacitor.isNativePlatform()) {
    const response = await awaitDividendRequest(CapacitorHttp.get({ url, responseType: 'arraybuffer', connectTimeout: 8000, readTimeout: 12000 }), control);
    if (response.status !== 200 || typeof response.data !== 'string' || response.data.length > 24_000_000) throw new Error('DIVIDEND_DOCUMENT_DOWNLOAD_FAILED');
    bytes = Uint8Array.from(atob(response.data), character => character.charCodeAt(0));
  } else {
    const response = await fetch(url.replace('https://static.cninfo.com.cn', '/dividend-document-api'), { signal: dividendRequestSignal(control, 15000) });
    if (!response.ok) throw new Error(`DIVIDEND_DOCUMENT_HTTP_${response.status}`);
    bytes = new Uint8Array(await awaitDividendRequest(response.arrayBuffer(), control));
  }
  if (bytes.length > 18_000_000 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('DIVIDEND_DOCUMENT_INVALID');
  return bytes;
}

export async function extractDividendAnnouncementPdf(bytes: Uint8Array, control: DividendRequestControl = {}): Promise<string> {
  assertDividendRequestCurrent(control);
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const abort = () => { void loading.destroy().catch(() => undefined); };
  control.signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await awaitDividendRequest(loading.promise, control);
    let text = '';
    for (let page = 1; page <= pdf.numPages; page++) {
      assertDividendRequestCurrent(control);
      const content = await awaitDividendRequest(pdf.getPage(page).then(value => value.getTextContent()), control);
      text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
      if (text.length > 1_000_000) throw new Error('DIVIDEND_DOCUMENT_TEXT_TOO_LARGE');
    }
    if (!text.trim()) throw new Error('DIVIDEND_DOCUMENT_NO_TEXT');
    return text;
  } finally { control.signal?.removeEventListener('abort', abort); await loading.destroy(); }
}

interface Announcement { announcementTitle?: string; adjunctUrl?: string; announcementTime?: number }
export async function fetchDividendOfficialEvidence(code: string, asOf: string, options: DividendOfficialEvidenceOptions = {}): Promise<{ events: DividendOfficialEvent[]; issues: string[] }> {
  assertDividendRequestCurrent(options);
  if (!/^\d{6}$/.test(code)) throw new Error('INVALID_DIVIDEND_CODE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(`${asOf}T00:00:00Z`))
    || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) throw new Error('INVALID_DIVIDEND_DATE');
  const request = (path: string, fields: Record<string, string>) => {
    assertDividendRequestCurrent(options);
    return awaitDividendRequest(options.post ? options.post(path, fields) : post(path, fields, options), options);
  };
  const download = options.readPdf ?? ((url: string) => readPdf(url, options));
  const extract = options.extractPdf ?? ((bytes: Uint8Array) => extractDividendAnnouncementPdf(bytes, options));
  const cached = (await documents.toArray()).flatMap(record => record.event?.code === code ? [record.event] : []);
  const issues: string[] = [];
  try {
    const search = await request('/new/information/topSearch/query', { keyWord: code, maxNum: '10' }) as { code?: string; orgId?: string }[];
    const stock = Array.isArray(search) ? search.find(value => value.code === code && typeof value.orgId === 'string') : undefined;
    if (!stock) throw new Error('CNINFO_COMPANY_NOT_FOUND');
    const found: Announcement[] = [];
    // Search all implementation titles; date bounds limit retrieval, never the dividend-base rule.
    for (let page = 1; page <= 4; page++) {
      assertDividendRequestCurrent(options);
      const response = await request('/new/hisAnnouncement/query', { stock: `${code},${stock.orgId}`, tabName: 'fulltext', pageSize: '30', pageNum: String(page),
        column: code.startsWith('6') ? 'sse' : 'szse', searchkey: '实施', seDate: `${Number(asOf.slice(0, 4)) - 12}-01-01~${asOf}` }) as { announcements?: Announcement[]; hasMore?: boolean };
      if (!Array.isArray(response.announcements)) throw new Error('CNINFO_ANNOUNCEMENTS_INVALID');
      found.push(...response.announcements.filter(value => {
        const title = value.announcementTitle ?? '';
        return /(?:权益分派|利润分配|分红派息|派息)实施/.test(title) && !/优先股|可转债|债券|H股|B股|法律意见|英文|更正前|摘要/.test(title);
      }));
      if (!response.hasMore) break;
      if (page === 4) issues.push('ANNOUNCEMENT_LIST_PARTIAL');
    }
    const unique = [...new Map(found.filter(value => typeof value.adjunctUrl === 'string').map(value => [value.adjunctUrl, value])).values()]
      .sort((a, b) => (b.announcementTime ?? 0) - (a.announcementTime ?? 0));
    const pending: Announcement[] = [];
    for (const item of unique) {
      assertDividendRequestCurrent(options);
      const url = new URL(item.adjunctUrl!, 'https://static.cninfo.com.cn/').href;
      const saved = await documents.get(url);
      if (saved?.event || saved?.checkedAt === asOf && !options.retryFailedDocuments) { if (saved.issue) issues.push(saved.issue); continue; }
      pending.push(item);
    }
    // Continue through older uncached documents on subsequent checks; completed evidence remains immutable.
    if (pending.length > 12) issues.push('ANNOUNCEMENT_VERIFICATION_PARTIAL');
    const selected = pending.slice(0, 12);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (cursor < selected.length) {
        assertDividendRequestCurrent(options);
        const item = selected[cursor++], url = new URL(item.adjunctUrl!, 'https://static.cninfo.com.cn/').href;
        const currentDocument = claimDividendRequest(`document:${url}`);
        try {
          const bytes = await awaitDividendRequest(download(url), options);
          const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
          const text = await awaitDividendRequest(extract(bytes), options);
          const announcementDate = item.announcementTime ? dateInChina(new Date(item.announcementTime)) : url.match(/finalpage\/(\d{4}-\d{2}-\d{2})\//)?.[1];
          const event = announcementDate ? parseDividendOfficialAnnouncementText(text, { code, announcementDate, sourceUrl: url, verifiedAt: asOf }) : undefined;
          await beforeDividendCacheWrite(options);
          if (currentDocument()) await database.transaction('rw', documents, async () => {
            assertDividendRequestCurrent(options);
            await documents.put({ url, sha256, checkedAt: asOf, ...(event ? { event } : { issue: 'ANNOUNCEMENT_FIELDS_UNVERIFIED' }) });
            assertDividendRequestCurrent(options);
          });
          if (!event) issues.push('ANNOUNCEMENT_FIELDS_UNVERIFIED');
        } catch { assertDividendRequestCurrent(options); issues.push('ANNOUNCEMENT_DOWNLOAD_FAILED'); }
      }
    }));
    return { events: (await documents.toArray()).flatMap(record => record.event?.code === code ? [record.event] : []), issues: [...new Set(issues)] };
  } catch (error) {
    assertDividendRequestCurrent(options);
    const reason = error instanceof Error ? error.message : 'ANNOUNCEMENT_DOWNLOAD_FAILED';
    return { events: cached, issues: reason.startsWith('CNINFO_') || reason === 'ANNOUNCEMENT_DOWNLOAD_FAILED' ? [reason] : [reason, 'ANNOUNCEMENT_REFRESH_FAILED'] };
  }
}

async function rememberFailedLedgerAttempt(code: string, asOf: string, issues: string[], control: DividendRequestControl): Promise<void> {
  const previous = await ledgers.get(code).catch(() => undefined);
  assertDividendRequestCurrent(control);
  latestLedgerAttempts.set(code, { code, asOf, events: previous?.events ?? [], complete: false,
    issues: [...new Set(issues)], sourceUrls: previous?.sourceUrls ?? [] });
}

export async function researchDividendLedger(raw: unknown, code: string, asOf: string, options: DividendOfficialEvidenceOptions = {}): Promise<DividendLedger> {
  assertDividendRequestCurrent(options);
  const current = claimDividendRequest(`ledger:${code}`);
  const control = { ...options, isCurrent: () => current() && (options.isCurrent?.() ?? true) };
  let evidence: Awaited<ReturnType<typeof fetchDividendOfficialEvidence>>;
  try {
    const startedAt = Date.now();
    evidence = await fetchDividendOfficialEvidence(code, asOf, control);
    const passes = Number.isSafeInteger(options.maxEvidencePasses) ? Math.max(1, Math.min(3, options.maxEvidencePasses!)) : 1;
    for (let pass = 1; pass < passes && Date.now() - startedAt < 20_000
      && evidence.issues.includes('ANNOUNCEMENT_VERIFICATION_PARTIAL')
      && evidence.issues.every(issue => ['ANNOUNCEMENT_VERIFICATION_PARTIAL', 'ANNOUNCEMENT_FIELDS_UNVERIFIED'].includes(issue)); pass++) {
      assertDividendRequestCurrent(control);
      // Successful documents are immutable. Further passes only advance into
      // uncached older PDFs; cached unsupported layouts do not consume another
      // slot. Stop on list/download failures or a slow first batch. A remaining
      // field gap is still checked against the required cash/share batches below.
      evidence = await fetchDividendOfficialEvidence(code, asOf, { ...control, retryFailedDocuments: false });
    }
  }
  catch (error) {
    await beforeDividendCacheWrite(control);
    await rememberFailedLedgerAttempt(code, asOf, [error instanceof Error ? error.message : 'ANNOUNCEMENT_DOWNLOAD_FAILED', 'ANNOUNCEMENT_REFRESH_FAILED'], control);
    throw error;
  }
  let ledger: DividendLedger;
  try { ledger = buildDividendLedger(raw, code, asOf, { officialEvents: evidence.events }); }
  catch (error) {
    await beforeDividendCacheWrite(control);
    await rememberFailedLedgerAttempt(code, asOf, [...evidence.issues, error instanceof Error ? error.message : 'INVALID_DIVIDEND_LEDGER_SOURCE', 'DIVIDEND_SOURCE_REFRESH_FAILED'], control);
    throw error;
  }
  ledger.issues = [...new Set([...ledger.issues, ...evidence.issues])];
  await beforeDividendCacheWrite(control);
  if (!dividendEvidenceStatus(ledger, asOf).usable) {
    // Existing complete=false already means source coverage is incomplete. It
    // prevents an unsuccessful new attempt from becoming a verified cash base,
    // while leaving all cached facts, their dates and the last success intact.
    ledger.complete = false;
    latestLedgerAttempts.set(code, structuredClone(ledger));
    return ledger;
  }
  await database.transaction('rw', ledgers, async () => {
    assertDividendRequestCurrent(control); await ledgers.put(ledger); assertDividendRequestCurrent(control);
  });
  latestLedgerAttempts.delete(code);
  return ledger;
}
export async function loadSavedDividendLedger(code: string): Promise<DividendLedger | undefined> { return ledgers.get(code); }
/** Prefer the latest attempt for checks, including a same-day failed refresh. */
export async function loadDividendLedgerForCheck(code: string): Promise<DividendLedger | undefined> {
  const attempted = latestLedgerAttempts.get(code);
  return attempted ? structuredClone(attempted) : loadSavedDividendLedger(code);
}

export function closeDividendLedgerEvidence() { latestLedgerAttempts.clear(); database.close(); }
