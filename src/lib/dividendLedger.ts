/** One row per disclosed distribution; money is integer CNY micros throughout. */
export type DividendLedgerPeriod = 'annual' | 'interim' | 'quarterly' | 'special' | 'unknown';
export type DividendLedgerVerification = 'verified' | 'unverified' | 'conflict';
export interface DividendLedgerSource { provider: 'eastmoney' | 'cninfo' | 'issuer'; url: string; announcementDate?: string; verifiedAt?: string }
export interface DividendOfficialEvent {
  code: string; reportDate: string; period: DividendLedgerPeriod; announcementDate: string;
  recordDate: string; exDate: string; cashPer10Micros: number;
  /** Expansion bps of the old share count: ten-for-eight is 8000, i.e. eight per ten. */
  bonusPer10Bps: number; transferPer10Bps: number; sourceUrl: string; verifiedAt: string;
}
export interface DividendLedgerEvent {
  id: string; batchId: string; code: string; reportDate?: string; period: DividendLedgerPeriod;
  announcementDate?: string; recordDate?: string; exDate?: string; cashPer10Micros?: number;
  bonusPer10Bps?: number; transferPer10Bps?: number; shareFactor?: number; normalizedDpsMicros?: number;
  implemented: boolean; proposal?: boolean; stage?: 'implemented' | 'proposal' | 'cancelled' | 'no_dividend' | 'unknown'; verification: DividendLedgerVerification; sources: DividendLedgerSource[]; issues: string[];
}
export interface DividendLedger { code: string; asOf: string; events: DividendLedgerEvent[]; complete: boolean; issues: string[]; sourceUrls: string[] }
export interface DividendLedgerBase {
  dpsMicros?: number; asOf: string; frequency: 'semiannual' | 'annual' | 'unknown'; requiredBatches: number;
  selectedBatchIds: string[]; latestExDate?: string; verified: boolean; flags: string[]; sourceUrls: string[]; reportPeriods: string[];
  crosscheckDpsMicros?: number; crosscheckDeviationBps?: number;
}
const day = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.slice(0, 10), time = Date.parse(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : undefined;
};
const amount = (value: unknown, scale: number): number | undefined => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
  const result = Number(value) * scale;
  return Number.isFinite(result) && result >= 0 && Number.isSafeInteger(Math.round(result)) ? Math.round(result) : undefined;
};
const distinct = <T>(values: T[]): T[] => [...new Set(values)];
const periodFor = (reportDate?: string, title = ''): DividendLedgerPeriod => /特别|special/i.test(title) ? 'special'
  : reportDate?.endsWith('-12-31') ? 'annual' : reportDate?.endsWith('-06-30') ? 'interim'
  : /-(?:03-31|09-30)$/.test(reportDate ?? '') ? 'quarterly' : 'unknown';
const officialSource = (url: string) => {
  try { const value = new URL(url); return value.protocol === 'https:' && ['cninfo.com.cn', 'sse.com.cn', 'szse.cn', 'hkexnews.hk'].some(host => value.hostname === host || value.hostname.endsWith(`.${host}`)); }
  catch { return false; }
};
function validOfficial(event: DividendOfficialEvent, code: string, asOf: string): boolean {
  return event.code === code && !!day(event.reportDate) && !!day(event.announcementDate) && event.announcementDate <= asOf
    && !!day(event.recordDate) && !!day(event.exDate) && event.recordDate < event.exDate && event.announcementDate <= event.recordDate
    && Number.isSafeInteger(event.cashPer10Micros) && event.cashPer10Micros >= 0
    && Number.isSafeInteger(event.bonusPer10Bps) && event.bonusPer10Bps >= 0 && event.bonusPer10Bps <= 1_000_000
    && Number.isSafeInteger(event.transferPer10Bps) && event.transferPer10Bps >= 0 && event.transferPer10Bps <= 1_000_000
    && ['annual', 'interim', 'quarterly', 'special'].includes(event.period)
    && (event.period === 'special' || periodFor(event.reportDate) === event.period)
    && !!day(event.verifiedAt) && officialSource(event.sourceUrl);
}

export function buildDividendLedger(distributionRaw: unknown, code: string, asOf: string,
  options: { officialEvents?: DividendOfficialEvent[] } = {}): DividendLedger {
  if (!/^\d{6}$/.test(code) || day(asOf) !== asOf) throw new Error('INVALID_DIVIDEND_LEDGER_SCOPE');
  const payload = distributionRaw as { success?: boolean; result?: { pages?: number; data?: Record<string, unknown>[] } };
  if (!payload?.success || !Array.isArray(payload.result?.data) || payload.result.data.some(row => row.SECURITY_CODE !== code)) throw new Error('INVALID_DIVIDEND_LEDGER_SOURCE');
  const sourceUrl = `https://data.eastmoney.com/yjfp/detail/${code}.html`;
  const ledger: DividendLedger = { code, asOf, events: [], complete: payload.result.pages === undefined || payload.result.pages === 1, issues: [], sourceUrls: [sourceUrl] };
  if (!ledger.complete) ledger.issues.push('SOURCE_PAGES_INCOMPLETE');
  const events = new Map<string, DividendLedgerEvent>();
  for (const row of payload.result.data) {
    const reportDate = day(row.REPORT_DATE), announcementDate = day(row.NOTICE_DATE) ?? day(row.PLAN_NOTICE_DATE);
    if (announcementDate && announcementDate > asOf) continue;
    const exDate = day(row.EX_DIVIDEND_DATE), recordDate = day(row.EQUITY_RECORD_DATE);
    const implemented = ['实施', '实施分配'].includes(String(row.ASSIGN_PROGRESS)) && !!exDate && exDate <= asOf;
    // An explicit empty ratio from this field means no bonus, but an absent field is unknown.
    const ratio = (key: string) => key in row ? row[key] === null || row[key] === '' ? 0 : amount(row[key], 1000) : undefined;
    const cashPer10Micros = amount(row.PRETAX_BONUS_RMB, 1e6), bonusPer10Bps = ratio('BONUS_RATIO'), transferPer10Bps = ratio('IT_RATIO');
    const shareFactor = bonusPer10Bps !== undefined && transferPer10Bps !== undefined ? 1 + (bonusPer10Bps + transferPer10Bps) / 10000 : undefined;
    const progress = String(row.ASSIGN_PROGRESS);
    const stage: DividendLedgerEvent['stage'] = /取消|终止/.test(progress) ? 'cancelled' : /不分配|不分红/.test(progress) ? 'no_dividend' : implemented ? 'implemented'
      : /预案|股东|董事/.test(progress) || /实施/.test(progress) && !!exDate && exDate > asOf ? 'proposal' : 'unknown';
    const period = periodFor(reportDate, String(row.IMPL_PLAN_PROFILE ?? ''));
    const batchId = `${code}:${reportDate ?? 'unknown'}:${exDate ?? 'pending'}:${period}`;
    const event: DividendLedgerEvent = { id: batchId, batchId, code, reportDate, period, announcementDate, recordDate, exDate, cashPer10Micros,
      bonusPer10Bps, transferPer10Bps, shareFactor, implemented, proposal: stage === 'proposal', stage, verification: 'unverified', sources: [{ provider: 'eastmoney', url: sourceUrl, announcementDate }], issues: [] };
    if (!reportDate || !announcementDate || !recordDate || !exDate || cashPer10Micros === undefined) event.issues.push('EVENT_FIELDS_INCOMPLETE');
    if (shareFactor === undefined) event.issues.push('CAPITAL_ACTIONS_UNVERIFIED');
    if (recordDate && exDate && recordDate >= exDate) event.issues.push('EVENT_DATES_INVALID');
    const existing = events.get(batchId);
    if (existing) {
      const fields = ['cashPer10Micros', 'bonusPer10Bps', 'transferPer10Bps', 'recordDate'] as const;
      const conflict = fields.some(key => existing[key] !== undefined && event[key] !== undefined && existing[key] !== event[key]);
      if (conflict) { existing.verification = 'conflict'; existing.issues = distinct([...existing.issues, 'SOURCE_CONFLICT']); }
      // Repeated rows never add the same distribution a second time.
      continue;
    }
    events.set(batchId, event);
  }
  for (const official of options.officialEvents ?? []) {
    if (!validOfficial(official, code, asOf)) { ledger.issues.push('OFFICIAL_EVIDENCE_INVALID'); continue; }
    let matches = [...events.values()].filter(event => event.reportDate === official.reportDate && event.exDate === official.exDate);
    // Different ex-dates for the only disclosed batch in one reporting period
    // are a source conflict, not two independent cash payments to add together.
    if (!matches.length) { const samePeriod = [...events.values()].filter(event => event.reportDate === official.reportDate && event.period === official.period); if (samePeriod.length === 1) matches = samePeriod; }
    const source: DividendLedgerSource = { provider: official.sourceUrl.includes('cninfo.com.cn') ? 'cninfo' : 'issuer', url: official.sourceUrl, announcementDate: official.announcementDate, verifiedAt: official.verifiedAt };
    if (!matches.length) {
      const batchId = `${code}:${official.reportDate}:${official.exDate}:${official.period}`;
      events.set(batchId, { id: batchId, batchId, ...official, implemented: official.exDate <= asOf, proposal: official.exDate > asOf, stage: official.exDate <= asOf ? 'implemented' : 'proposal', verification: 'verified', sources: [source], issues: [], shareFactor: 1 + (official.bonusPer10Bps + official.transferPer10Bps) / 10000 });
      continue;
    }
    for (const event of matches) {
      const differences = (['cashPer10Micros', 'recordDate', 'exDate', 'announcementDate', 'bonusPer10Bps', 'transferPer10Bps'] as const)
        .some(key => event[key] !== undefined && event[key] !== official[key]);
      if (!event.sources.some(current => current.url === source.url && current.announcementDate === source.announcementDate)) event.sources.push(source);
      if (differences || event.verification === 'conflict') { event.verification = 'conflict'; event.issues = distinct([...event.issues, 'SOURCE_CONFLICT']); continue; }
      if (!event.exDate) { events.delete(event.batchId); event.exDate = official.exDate; event.id = event.batchId = `${code}:${official.reportDate}:${official.exDate}:${event.period}`; events.set(event.batchId, event); }
      event.recordDate = official.recordDate; event.announcementDate = official.announcementDate; event.implemented = official.exDate <= asOf; event.proposal = official.exDate > asOf; event.stage = event.implemented ? 'implemented' : 'proposal';
      event.bonusPer10Bps = official.bonusPer10Bps; event.transferPer10Bps = official.transferPer10Bps;
      event.cashPer10Micros = official.cashPer10Micros; event.shareFactor = 1 + (official.bonusPer10Bps + official.transferPer10Bps) / 10000;
      event.verification = 'verified'; event.issues = event.issues.filter(issue => !['EVENT_FIELDS_INCOMPLETE', 'CAPITAL_ACTIONS_UNVERIFIED'].includes(issue));
    }
  }
  ledger.events = [...events.values()].sort((a, b) => (b.exDate ?? b.announcementDate ?? '').localeCompare(a.exDate ?? a.announcementDate ?? '') || a.batchId.localeCompare(b.batchId));
  for (const event of ledger.events) event.normalizedDpsMicros = normalizedCash(ledger, event, asOf);
  ledger.issues = distinct(ledger.issues); ledger.sourceUrls = distinct(ledger.events.flatMap(event => event.sources.map(source => source.url)));
  return ledger;
}

function normalizedCash(ledger: DividendLedger, event: DividendLedgerEvent, asOf: string): number | undefined {
  if (!event.implemented || !event.exDate || event.exDate > asOf || event.verification !== 'verified' || event.cashPer10Micros === undefined) return undefined;
  const actions = ledger.events.filter(other => other.implemented && !!other.exDate && other.exDate >= event.exDate! && other.exDate <= asOf);
  if (actions.some(action => action.shareFactor === undefined || action.verification === 'conflict'
    || action.shareFactor !== 1 && action.verification !== 'verified')) return undefined;
  // Same-day share capital changes are applied once, even if cash is represented by multiple batches.
  const factors = new Map<string, number>();
  for (const action of actions) {
    const factorBps = 10000 + (action.bonusPer10Bps ?? 0) + (action.transferPer10Bps ?? 0);
    if (factors.has(action.exDate!) && factors.get(action.exDate!) !== factorBps) return undefined;
    factors.set(action.exDate!, factorBps);
  }
  let numerator = BigInt(event.cashPer10Micros), denominator = 10n;
  for (const factor of factors.values()) { numerator *= 10000n; denominator *= BigInt(factor); }
  const result = Number((numerator + denominator / 2n) / denominator);
  return Number.isSafeInteger(result) ? result : undefined;
}

export function detectDividendLedgerFrequency(ledger: DividendLedger, asOf = ledger.asOf): DividendLedgerBase['frequency'] {
  const regular = ledger.events.filter(event => event.implemented && !!event.exDate && event.exDate <= asOf && (event.cashPer10Micros ?? 0) > 0 && event.period !== 'special');
  if (!regular.length) return 'unknown';
  const recent = [...regular].sort((a, b) => b.exDate!.localeCompare(a.exDate!)).slice(0, 6);
  const latestYear = recent[0].reportDate?.slice(0, 4);
  const relevant = recent.filter(event => Number(latestYear) - Number(event.reportDate?.slice(0, 4)) <= 2);
  if (relevant.some(event => event.period === 'unknown' || event.period === 'quarterly')) return 'unknown';
  if (relevant.some(event => event.period === 'interim')) {
    const pair = recent.slice(0, 2);
    const reportMonth = (event: DividendLedgerEvent) => Number(event.reportDate?.slice(0, 4)) * 12 + Number(event.reportDate?.slice(5, 7));
    // A missing interim record or a changed payout schedule must not make the
    // latest two whole-year distributions masquerade as one semiannual base.
    return pair.length === 2 && new Set(pair.map(event => event.period)).size === 2
      && pair.every(event => event.period === 'annual' || event.period === 'interim')
      && Math.abs(reportMonth(pair[0]) - reportMonth(pair[1])) === 6 ? 'semiannual' : 'unknown';
  }
  if (ledger.complete && relevant.length >= 2 && relevant.every(event => event.period === 'annual')
    && distinct(relevant.map(event => event.reportDate?.slice(0, 4))).length >= 2) return 'annual';
  return 'unknown';
}

export function dividendLedgerBase(ledger: DividendLedger, asOf: string, crosscheck: { epsMicros?: number; payoutBps?: number } = {}): DividendLedgerBase {
  if (day(asOf) !== asOf || asOf > ledger.asOf) throw new Error('INVALID_DIVIDEND_LEDGER_DATE');
  const frequency = detectDividendLedgerFrequency(ledger, asOf), requiredBatches = frequency === 'semiannual' ? 2 : frequency === 'annual' ? 1 : 0;
  const implemented = ledger.events.filter(event => event.implemented && !!event.exDate && event.exDate <= asOf && !!event.announcementDate && event.announcementDate <= asOf
    && (event.cashPer10Micros ?? 0) > 0);
  const selected = [...new Map([...implemented].sort((a, b) => b.exDate!.localeCompare(a.exDate!)).map(event => [event.batchId, event])).values()].slice(0, requiredBatches);
  const flags: string[] = [];
  if (!ledger.complete) flags.push('SOURCE_PAGES_INCOMPLETE');
  if (frequency === 'unknown') flags.push('FREQUENCY_UNKNOWN');
  if (selected.length < requiredBatches || !selected.length) flags.push('INCOMPLETE');
  if (ledger.events.some(event => event.proposal && !event.implemented && event.announcementDate && event.announcementDate <= asOf && (event.cashPer10Micros ?? 0) > 0)) flags.push('PROPOSAL_NOT_COUNTED');
  if (selected.some(event => event.verification === 'conflict')) flags.push('SOURCE_CONFLICT');
  if (selected.some(event => event.verification === 'unverified')) flags.push('ANNOUNCEMENT_UNVERIFIED');
  const latestExDate = ledger.events.filter(event => event.implemented && !!event.exDate && event.exDate <= asOf
    && (event.cashPer10Micros === undefined || event.cashPer10Micros > 0 || event.shareFactor !== 1)).map(event => event.exDate!).sort().at(-1);
  const normalized = selected.map(event => normalizedCash(ledger, event, asOf));
  if (normalized.some(value => value === undefined)) flags.push('CAPITAL_OR_CASH_UNVERIFIED');
  const blocked = flags.some(flag => flag !== 'PROPOSAL_NOT_COUNTED');
  const dpsMicros = !blocked ? normalized.reduce<number>((sum, value) => sum + value!, 0) : undefined;
  const eps = crosscheck.epsMicros, payout = crosscheck.payoutBps;
  const crosscheckDpsMicros = eps !== undefined && Number.isSafeInteger(eps) && eps > 0 && payout !== undefined && Number.isSafeInteger(payout) && payout >= 0
    ? Number((BigInt(eps) * BigInt(payout) + 5000n) / 10000n) : undefined;
  const crosscheckDeviationBps = dpsMicros !== undefined && dpsMicros > 0 && crosscheckDpsMicros !== undefined ? Math.round(Math.abs(dpsMicros - crosscheckDpsMicros) / dpsMicros * 10000) : undefined;
  if (crosscheckDpsMicros === undefined) flags.push('CROSSCHECK_MISSING');
  if (dpsMicros !== undefined && dpsMicros > 0 && crosscheckDpsMicros !== undefined
    && (BigInt(Math.abs(dpsMicros - crosscheckDpsMicros)) * 4n > BigInt(dpsMicros))) flags.push('CROSSCHECK_MISMATCH');
  return { dpsMicros, asOf, frequency, requiredBatches, selectedBatchIds: selected.map(event => event.batchId), latestExDate,
    verified: dpsMicros !== undefined && dpsMicros > 0 && !flags.includes('CROSSCHECK_MISMATCH'), flags: distinct(flags),
    sourceUrls: distinct(selected.flatMap(event => event.sources.map(source => source.url))), reportPeriods: selected.flatMap(event => event.reportDate ? [event.reportDate] : []),
    crosscheckDpsMicros, crosscheckDeviationBps };
}

/** Diagnose every monthly observation separately; long price history does not prove complete cash evidence. */
export function dividendLedgerHistoryDiagnostics(ledger: DividendLedger, prices: { date: string; priceMinor: number }[], asOf = ledger.asOf) {
  const unique = [...new Map(prices.filter(price => day(price.date) && price.date <= asOf && price.date.slice(0, 7) < asOf.slice(0, 7)).map(price => [price.date.slice(0, 7), price])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const observations = unique.map(price => {
    const then: DividendLedger = { ...ledger, asOf: price.date, events: ledger.events.filter(event => !event.announcementDate || event.announcementDate <= price.date).map(event => ({ ...event, implemented: !!event.exDate && event.exDate <= price.date && event.implemented })) };
    const base = dividendLedgerBase(then, price.date);
    const usable = base.dpsMicros !== undefined && base.dpsMicros > 0 && price.priceMinor > 0 && Number.isSafeInteger(price.priceMinor);
    return { date: price.date, dpsMicros: base.dpsMicros, yieldBps: usable ? Math.round(base.dpsMicros! / price.priceMinor) : undefined, usable, flags: base.flags.filter(flag => flag !== 'CROSSCHECK_MISSING') };
  });
  const samples = observations.filter(observation => observation.usable), from = samples[0]?.date, through = samples.at(-1)?.date;
  const spanYears = from && through ? (Date.parse(through) - Date.parse(from)) / (365.25 * 86400000) : 0;
  const ageDays = through ? (Date.parse(asOf) - Date.parse(through)) / 86400000 : undefined;
  const reasons = distinct(observations.filter(observation => !observation.usable).flatMap(observation => observation.flags));
  if (samples.length < 60) reasons.push('SAMPLES_INSUFFICIENT');
  if (spanYears < 4.8) reasons.push('SPAN_INSUFFICIENT');
  if (ageDays === undefined || ageDays < 0 || ageDays > 40) reasons.push('STALE');
  const usable = samples.length >= 60 && spanYears >= 4.8 && ageDays !== undefined && ageDays >= 0 && ageDays <= 40;
  return { observations, samples, exclusionReasons: distinct(observations.filter(observation => !observation.usable).flatMap(observation => observation.flags)), priceSampleCount: unique.length, sampleCount: samples.length, from, through, spanYears, ageDays, reasons: usable ? [] : distinct(reasons), usable };
}

/** Conservative Shenzhen/Shanghai cash implementation parser. Unsupported layouts stay unverified. */
export function parseDividendOfficialAnnouncementText(text: string, metadata: { code: string; announcementDate: string; sourceUrl: string; verifiedAt: string }): DividendOfficialEvent | undefined {
  if (!officialSource(metadata.sourceUrl) || !/^\d{6}$/.test(metadata.code) || !text.includes(metadata.code)) return undefined;
  const compact = text.replace(/(?:^|\n)\s*\d{1,3}\s*(?=\n|$)/g, '').replace(/\s+/g, '');
  if (!new RegExp(`(?:证券|股票)代码[：:]?${metadata.code}(?=\\D|$)`).test(compact)) return undefined;
  const title = compact.match(/(20\d{2})年(半年度|中期|年度)(?:A股)?(?:权益分派|利润分配|分红派息)实施公告/);
  if (!title) return undefined;
  const reportDate = `${title[1]}-${/半年度|中期/.test(title[2]) ? '06-30' : '12-31'}`;
  const section = compact.match(/二[、.．](?:本次实施的权益分派方案|分配方案|本次利润分配方案)([\s\S]*?)(?:三[、.．]|$)/)?.[1];
  if (!section) return undefined;
  const perTen = section.match(/每10股派(?:发)?(?:现金(?:股利|红利)?)?(?:人民币)?([\d.]+)元/);
  // A Shanghai final implementation can mention both this cash and the annual
  // total including interim cash. Read the first current implementation amount.
  const currentScheme = section.split(/连同已派|全年/)[0];
  const perShare = currentScheme.match(/每股派发现金(?:股利|红利)(?:人民币)?([\d.]+)元/);
  const cashPer10Micros = perTen ? amount(perTen[1], 1e6) : perShare ? amount(perShare[1], 1e7) : undefined;
  const datePattern = '(20\\d{2})年(\\d{1,2})月(\\d{1,2})日';
  const readDate = (label: string) => { const match = compact.match(new RegExp(`${label}(?:为|是)?[：:]?${datePattern}`)); return match ? day(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`) : undefined; };
  let recordDate = readDate('股权登记日'), exDate = readDate('除权除息日');
  if ((!recordDate || !exDate) && /股权登记日最后交易日除权[（(]息[）)]日/.test(compact)) {
    const table = compact.match(/A股(20\d{2})\/(\d{1,2})\/(\d{1,2})[－—-](20\d{2})\/(\d{1,2})\/(\d{1,2})/);
    if (table) { recordDate = day(`${table[1]}-${table[2].padStart(2, '0')}-${table[3].padStart(2, '0')}`); exDate = day(`${table[4]}-${table[5].padStart(2, '0')}-${table[6].padStart(2, '0')}`); }
  }
  const bonus = section.match(/每10股(?:派[^，。;；]*[,，])?送(?:红股)?([\d.]+)股/), transfer = section.match(/每10股(?:转增|以资本公积金转增)([\d.]+)股/);
  // The complete Shanghai allocation section explicitly describes a cash-only
  // scheme; an unrecognised bonus clause must not be silently treated as zero.
  const cashOnlyScheme = !!perShare && /本次利润分配/.test(section) && !/送(?:红)?股|转增/.test(section);
  const bonusPer10Bps = bonus ? amount(bonus[1], 1000) : /不送红股|不送股/.test(compact) || cashOnlyScheme ? 0 : undefined;
  const transferPer10Bps = transfer ? amount(transfer[1], 1000) : /不以(?:资本)?公积金转增股本|不转增股本/.test(compact) || cashOnlyScheme ? 0 : undefined;
  if (!recordDate || !exDate || cashPer10Micros === undefined || bonusPer10Bps === undefined || transferPer10Bps === undefined) return undefined;
  const event: DividendOfficialEvent = { code: metadata.code, announcementDate: metadata.announcementDate, sourceUrl: metadata.sourceUrl, verifiedAt: metadata.verifiedAt,
    reportDate, period: title[2] === '年度' ? 'annual' : 'interim', recordDate, exDate, cashPer10Micros, bonusPer10Bps, transferPer10Bps };
  return validOfficial(event, metadata.code, metadata.verifiedAt) ? event : undefined;
}
