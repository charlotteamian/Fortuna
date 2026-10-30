import { Capacitor, CapacitorHttp } from '@capacitor/core';
import Dexie, { type Table } from 'dexie';
import { buildDividendLedger, parseDividendOfficialAnnouncementText, type DividendLedger, type DividendOfficialEvent } from '../lib/dividendLedger';
import { dateInChina } from '../lib/dividendWorkbench';

export interface DividendOfficialEvidenceOptions {
  post?: (path: string, fields: Record<string, string>) => Promise<unknown>;
  readPdf?: (url: string) => Promise<Uint8Array>;
  extractPdf?: (bytes: Uint8Array) => Promise<string>;
}

interface DocumentEvidence { url: string; sha256: string; checkedAt: string; event?: DividendOfficialEvent; issue?: string }
const database = new Dexie('FortunaDividendLedger');
database.version(1).stores({ documents: 'url', ledgers: 'code' });
const documents: Table<DocumentEvidence, string> = database.table('documents');
const ledgers: Table<DividendLedger, string> = database.table('ledgers');
const CNINFO = 'https://www.cninfo.com.cn';

async function post(path: string, fields: Record<string, string>): Promise<unknown> {
  const data = new URLSearchParams(fields).toString();
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.post({ url: CNINFO + path, data, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: CNINFO + '/', Origin: CNINFO, 'X-Requested-With': 'XMLHttpRequest' },
      responseType: 'json', connectTimeout: 8000, readTimeout: 10000 });
    if (result.status !== 200) throw new Error(`CNINFO_HTTP_${result.status}`);
    return typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
  }
  const result = await fetch('/dividend-cninfo-api' + path, { method: 'POST', body: data, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(12000) });
  if (!result.ok) throw new Error(`CNINFO_HTTP_${result.status}`);
  return result.json();
}

async function readPdf(url: string): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'static.cninfo.com.cn' || !parsed.pathname.startsWith('/finalpage/')) throw new Error('INVALID_DIVIDEND_DOCUMENT');
  let bytes: Uint8Array;
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, responseType: 'arraybuffer', connectTimeout: 8000, readTimeout: 12000 });
    if (response.status !== 200 || typeof response.data !== 'string' || response.data.length > 24_000_000) throw new Error('DIVIDEND_DOCUMENT_DOWNLOAD_FAILED');
    bytes = Uint8Array.from(atob(response.data), character => character.charCodeAt(0));
  } else {
    const response = await fetch(url.replace('https://static.cninfo.com.cn', '/dividend-document-api'), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`DIVIDEND_DOCUMENT_HTTP_${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.length > 18_000_000 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('DIVIDEND_DOCUMENT_INVALID');
  return bytes;
}

export async function extractDividendAnnouncementPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  try {
    const pdf = await loading.promise;
    let text = '';
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
      if (text.length > 1_000_000) throw new Error('DIVIDEND_DOCUMENT_TEXT_TOO_LARGE');
    }
    if (!text.trim()) throw new Error('DIVIDEND_DOCUMENT_NO_TEXT');
    return text;
  } finally { await loading.destroy(); }
}

interface Announcement { announcementTitle?: string; adjunctUrl?: string; announcementTime?: number }
export async function fetchDividendOfficialEvidence(code: string, asOf: string, options: DividendOfficialEvidenceOptions = {}): Promise<{ events: DividendOfficialEvent[]; issues: string[] }> {
  if (!/^\d{6}$/.test(code)) throw new Error('INVALID_DIVIDEND_CODE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(`${asOf}T00:00:00Z`))
    || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) throw new Error('INVALID_DIVIDEND_DATE');
  const request = options.post ?? post, download = options.readPdf ?? readPdf, extract = options.extractPdf ?? extractDividendAnnouncementPdf;
  const cached = (await documents.toArray()).flatMap(record => record.event?.code === code ? [record.event] : []);
  const issues: string[] = [];
  try {
    const search = await request('/new/information/topSearch/query', { keyWord: code, maxNum: '10' }) as { code?: string; orgId?: string }[];
    const stock = Array.isArray(search) ? search.find(value => value.code === code && typeof value.orgId === 'string') : undefined;
    if (!stock) throw new Error('CNINFO_COMPANY_NOT_FOUND');
    const found: Announcement[] = [];
    // Search all implementation titles; date bounds limit retrieval, never the dividend-base rule.
    for (let page = 1; page <= 4; page++) {
      const response = await request('/new/hisAnnouncement/query', { stock: `${code},${stock.orgId}`, tabName: 'fulltext', pageSize: '30', pageNum: String(page),
        column: code.startsWith('6') ? 'sse' : 'szse', searchkey: '实施', seDate: `${Number(asOf.slice(0, 4)) - 12}-01-01~${asOf}` }) as { announcements?: Announcement[]; hasMore?: boolean };
      if (!Array.isArray(response.announcements)) throw new Error('CNINFO_ANNOUNCEMENTS_INVALID');
      found.push(...response.announcements.filter(value => /权益分派|利润分配|分红派息|派息/.test(value.announcementTitle ?? '')));
      if (!response.hasMore) break;
      if (page === 4) issues.push('ANNOUNCEMENT_LIST_PARTIAL');
    }
    const unique = [...new Map(found.filter(value => typeof value.adjunctUrl === 'string').map(value => [value.adjunctUrl, value])).values()]
      .sort((a, b) => (b.announcementTime ?? 0) - (a.announcementTime ?? 0));
    const pending: Announcement[] = [];
    for (const item of unique) {
      const url = new URL(item.adjunctUrl!, 'https://static.cninfo.com.cn/').href;
      const saved = await documents.get(url);
      if (saved?.event || saved?.checkedAt === asOf) { if (saved.issue) issues.push(saved.issue); continue; }
      pending.push(item);
    }
    // Continue through older uncached documents on subsequent checks; completed evidence remains immutable.
    if (pending.length > 12) issues.push('ANNOUNCEMENT_VERIFICATION_PARTIAL');
    const selected = pending.slice(0, 12);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (cursor < selected.length) {
        const item = selected[cursor++], url = new URL(item.adjunctUrl!, 'https://static.cninfo.com.cn/').href;
        try {
          const bytes = await download(url);
          const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
          const text = await extract(bytes);
          const announcementDate = item.announcementTime ? dateInChina(new Date(item.announcementTime)) : url.match(/finalpage\/(\d{4}-\d{2}-\d{2})\//)?.[1];
          const event = announcementDate ? parseDividendOfficialAnnouncementText(text, { code, announcementDate, sourceUrl: url, verifiedAt: asOf }) : undefined;
          await documents.put({ url, sha256, checkedAt: asOf, ...(event ? { event } : { issue: 'ANNOUNCEMENT_FIELDS_UNVERIFIED' }) });
          if (!event) issues.push('ANNOUNCEMENT_FIELDS_UNVERIFIED');
        } catch { issues.push('ANNOUNCEMENT_DOWNLOAD_FAILED'); }
      }
    }));
    return { events: (await documents.toArray()).flatMap(record => record.event?.code === code ? [record.event] : []), issues: [...new Set(issues)] };
  } catch (error) {
    return { events: cached, issues: [error instanceof Error ? error.message : 'ANNOUNCEMENT_DOWNLOAD_FAILED'] };
  }
}

export async function researchDividendLedger(raw: unknown, code: string, asOf: string, options: DividendOfficialEvidenceOptions = {}): Promise<DividendLedger> {
  const evidence = await fetchDividendOfficialEvidence(code, asOf, options);
  const ledger = buildDividendLedger(raw, code, asOf, { officialEvents: evidence.events });
  ledger.issues = [...new Set([...ledger.issues, ...evidence.issues])];
  await ledgers.put(ledger);
  return ledger;
}
export async function loadSavedDividendLedger(code: string): Promise<DividendLedger | undefined> { return ledgers.get(code); }

export function closeDividendLedgerEvidence() { database.close(); }
