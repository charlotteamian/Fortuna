import type { DividendLedger, DividendLedgerBase, DividendLedgerEvent } from './dividendLedger.ts';
import type { DividendPricingResult } from './dividendPricing.ts';

export interface DividendManualBatch {
  reportDate: string; announcementDate: string; recordDate: string; exDate: string;
  cashPer10Micros: number; bonusPer10Bps: number; transferPer10Bps: number; sourceUrl: string;
}
export interface DividendManualInputs {
  code: string; frequency: 'annual' | 'semiannual'; batches: DividendManualBatch[];
  confirmedAt: string; expiresOn: string; coverageConfirmed: boolean; conflictAcknowledged: boolean;
  automaticSignature: string;
  shareActions?: { exDate: string; bonusPer10Bps: number; transferPer10Bps: number; sourceUrl: string }[];
  crosscheck?: { epsMicros: number; payoutBps: number; reportDate: string; sourceUrl: string };
}
export const validManualDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function isDividendOfficialUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
    && ['cninfo.com.cn', 'sse.com.cn', 'szse.cn', 'hkexnews.hk'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; }
}
/** Only material recent source fields participate; downloading older PDFs does not change a user's correction. */
export function dividendAutomaticSignature(ledger?: DividendLedger): string {
  const implemented = (Array.isArray(ledger?.events) ? ledger.events : []).filter(event => event && event.implemented)
    .sort((a, b) => (b.exDate ?? '').localeCompare(a.exDate ?? ''));
  const cash = implemented.filter(event => (event.cashPer10Micros ?? 0) > 0).slice(0, 2);
  const cutoff = cash.map(event => event.exDate).filter((date): date is string => !!date).sort()[0];
  return JSON.stringify(implemented.filter(event => (!cutoff || !event.exDate || event.exDate >= cutoff)
    && ((event.cashPer10Micros ?? 0) > 0 || event.shareFactor !== 1 || (event.bonusPer10Bps ?? 0) > 0 || (event.transferPer10Bps ?? 0) > 0))
    .map(event => [event.reportDate, event.exDate, event.recordDate, event.cashPer10Micros, event.bonusPer10Bps, event.transferPer10Bps]));
}
export function dividendManualCandidates(pricing: DividendPricingResult): DividendLedgerEvent[] {
  return ((pricing.ledger ?? pricing.userConfirmedEvidence?.automaticLedger)?.events ?? []).filter(event => event && event.implemented && (event.cashPer10Micros ?? 0) > 0 && event.period !== 'special')
    .sort((a, b) => (b.exDate ?? '').localeCompare(a.exDate ?? '')).slice(0, 2);
}
export function dividendManualFingerprint(value: DividendManualInputs): string { return JSON.stringify(value); }
export function buildDividendManualBase(value: DividendManualInputs, asOf: string, existing?: DividendPricingResult): DividendLedgerBase {
  const required = value.frequency === 'semiannual' ? 2 : 1;
  if (!/^\d{6}$/.test(value.code) || !['annual', 'semiannual'].includes(value.frequency)
    || !validManualDate(asOf) || !validManualDate(value.confirmedAt) || !validManualDate(value.expiresOn)
    || value.confirmedAt > asOf || value.expiresOn < asOf || Date.parse(value.expiresOn) - Date.parse(value.confirmedAt) > 30 * 86400000
    || !value.coverageConfirmed || value.batches.length !== required) throw new Error('DIVIDEND_MANUAL_INVALID');
  const hasConflict = existing?.blockers.some(issue => ['dividend_source_conflict', 'dividend_crosscheck_mismatch'].includes(issue));
  if (hasConflict && !value.conflictAcknowledged) throw new Error('DIVIDEND_MANUAL_CONFLICT');
  for (const batch of value.batches) {
    if (![batch.reportDate, batch.announcementDate, batch.recordDate, batch.exDate].every(validManualDate)
      || batch.reportDate > batch.announcementDate || batch.announcementDate > batch.recordDate || batch.recordDate >= batch.exDate || batch.exDate > asOf
      || !isDividendOfficialUrl(batch.sourceUrl)
      || !Number.isSafeInteger(batch.cashPer10Micros) || batch.cashPer10Micros <= 0
      || !Number.isSafeInteger(batch.bonusPer10Bps) || batch.bonusPer10Bps < 0 || batch.bonusPer10Bps > 1000000
      || !Number.isSafeInteger(batch.transferPer10Bps) || batch.transferPer10Bps < 0 || batch.transferPer10Bps > 1000000
      || !/-(06-30|12-31)$/.test(batch.reportDate) || value.frequency === 'annual' && !batch.reportDate.endsWith('-12-31')) throw new Error('DIVIDEND_MANUAL_INVALID');
  }
  const batches = [...value.batches].sort((a, b) => b.exDate.localeCompare(a.exDate));
  if (new Set(batches.map(batch => batch.exDate)).size !== required || new Set(batches.map(batch => batch.reportDate)).size !== required) throw new Error('DIVIDEND_MANUAL_INVALID');
  if (required === 2) {
    const month = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
    if (Math.abs(month(batches[0].reportDate) - month(batches[1].reportDate)) !== 6) throw new Error('DIVIDEND_MANUAL_INVALID');
  }
  const earliestCash = batches.at(-1)!.exDate;
  const extraActions = new Map<string, { bonusPer10Bps: number; transferPer10Bps: number; sourceUrls: string[] }>();
  const automatic = existing?.ledger ?? existing?.userConfirmedEvidence?.automaticLedger;
  const suppliedActions = value.shareActions ?? [];
  for (const action of suppliedActions) {
    if (!validManualDate(action.exDate) || action.exDate < earliestCash || action.exDate > asOf || !isDividendOfficialUrl(action.sourceUrl)
      || !Number.isSafeInteger(action.bonusPer10Bps) || action.bonusPer10Bps < 0 || action.bonusPer10Bps > 1000000
      || !Number.isSafeInteger(action.transferPer10Bps) || action.transferPer10Bps < 0 || action.transferPer10Bps > 1000000
      || extraActions.has(action.exDate)) throw new Error('DIVIDEND_MANUAL_SHARE_ACTION');
    extraActions.set(action.exDate, { ...action, sourceUrls: [action.sourceUrl] });
  }
  for (const action of automatic?.events ?? []) {
    if (!action?.implemented || !action.exDate || action.exDate < earliestCash || action.exDate > asOf || action.shareFactor === 1) continue;
    const batch = batches.find(batch => batch.exDate === action.exDate);
    if (batch) {
      if (action.verification === 'verified' && (action.bonusPer10Bps !== batch.bonusPer10Bps || action.transferPer10Bps !== batch.transferPer10Bps)) throw new Error('DIVIDEND_MANUAL_SHARE_ACTION');
      continue;
    }
    if (extraActions.has(action.exDate)) continue;
    if (action.verification !== 'verified' || !Number.isSafeInteger(action.bonusPer10Bps) || !Number.isSafeInteger(action.transferPer10Bps)) throw new Error('DIVIDEND_MANUAL_SHARE_ACTION');
    extraActions.set(action.exDate, { bonusPer10Bps: action.bonusPer10Bps!, transferPer10Bps: action.transferPer10Bps!, sourceUrls: action.sources.map(source => source.url) });
  }
  // Fold each same-day share factor once, including standalone later share actions.
  const factors = new Map<string, number>();
  for (const batch of batches) factors.set(batch.exDate, 10000 + batch.bonusPer10Bps + batch.transferPer10Bps);
  for (const [date, action] of extraActions) {
    const factor = 10000 + action.bonusPer10Bps + action.transferPer10Bps;
    if (factors.has(date) && factors.get(date) !== factor) throw new Error('DIVIDEND_MANUAL_SHARE_ACTION');
    factors.set(date, factor);
  }
  let dpsMicros = 0;
  for (const batch of batches) {
    let numerator = BigInt(batch.cashPer10Micros), denominator = 10n;
    for (const [date, factor] of factors) if (date >= batch.exDate) { numerator *= 10000n; denominator *= BigInt(factor); }
    dpsMicros += Number((numerator + denominator / 2n) / denominator);
  }
  const flags = ['USER_CONFIRMED_INPUT'];
  let crosscheckDpsMicros = existing?.dividendBase?.crosscheckDpsMicros;
  if (value.crosscheck) {
    const item = value.crosscheck;
    if (!Number.isSafeInteger(item.epsMicros) || item.epsMicros <= 0 || !Number.isSafeInteger(item.payoutBps) || item.payoutBps < 0
      || !validManualDate(item.reportDate) || !item.reportDate.endsWith('-12-31') || item.reportDate > asOf || !isDividendOfficialUrl(item.sourceUrl)) throw new Error('DIVIDEND_MANUAL_INVALID');
    crosscheckDpsMicros = Number((BigInt(item.epsMicros) * BigInt(item.payoutBps) + 5000n) / 10000n);
  }
  if (crosscheckDpsMicros === undefined) flags.push('CROSSCHECK_MISSING');
  const crosscheckDeviationBps = crosscheckDpsMicros === undefined ? undefined : Math.round(Math.abs(dpsMicros - crosscheckDpsMicros) / dpsMicros * 10000);
  if (crosscheckDpsMicros !== undefined && BigInt(Math.abs(dpsMicros - crosscheckDpsMicros)) * 4n > BigInt(dpsMicros)) throw new Error('DIVIDEND_MANUAL_CROSSCHECK');
  if (!Number.isSafeInteger(dpsMicros) || dpsMicros <= 0) throw new Error('DIVIDEND_MANUAL_INVALID');
  return { dpsMicros, asOf, frequency: value.frequency, requiredBatches: required, verified: true,
    selectedBatchIds: batches.map(batch => `user:${value.code}:${batch.reportDate}:${batch.exDate}`),
    latestExDate: [...batches.map(batch => batch.exDate), ...[...extraActions].filter(([, action]) => action.bonusPer10Bps + action.transferPer10Bps > 0).map(([date]) => date)].sort().at(-1),
    flags, sourceUrls: [...new Set([...batches.map(batch => batch.sourceUrl), ...[...extraActions.values()].flatMap(action => action.sourceUrls), ...(value.crosscheck ? [value.crosscheck.sourceUrl] : [])])],
    reportPeriods: batches.map(batch => batch.reportDate), crosscheckDpsMicros, crosscheckDeviationBps };
}
export function hasCurrentUserDividendEvidence(pricing: DividendPricingResult | undefined, asOf: string, currentLedger?: DividendLedger): boolean {
  const evidence = pricing?.userConfirmedEvidence;
  return !!evidence && !!pricing?.dividendBase?.verified && validManualDate(evidence.confirmedAt) && validManualDate(evidence.expiresOn)
    && evidence.confirmedAt <= asOf && evidence.expiresOn >= asOf && pricing.dividendBase.asOf === asOf
    && (!currentLedger || dividendAutomaticSignature(currentLedger) === evidence.automaticSignature);
}

/** Backup validation preserves dated entries even when their confirmation has expired. */
export function isDividendManualInputsMap(value: unknown): value is Record<string, DividendManualInputs> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([code, item]) => {
    try {
      if (!item || item.code !== code || typeof item.automaticSignature !== 'string' || typeof item.conflictAcknowledged !== 'boolean' || !Array.isArray(item.batches)) return false;
      buildDividendManualBase(item, item.confirmedAt); return true;
    } catch { return false; }
  });
}
