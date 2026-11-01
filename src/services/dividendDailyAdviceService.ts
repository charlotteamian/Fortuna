import Dexie, { type Table } from 'dexie';
import type { DividendDailyCheck } from '../lib/dividendDailyCheck.ts';

export interface DividendDailyAdvice {
  answer: string;
  generatedAt: string;
  language: string;
  planKey: string;
  refreshLimited: boolean;
}
interface Record extends DividendDailyAdvice { id: 'latest' }
const database = new Dexie('FortunaDividendDailyAdvice');
database.version(1).stores({ advice: 'id' });
const advice: Table<Record, string> = database.table('advice');

function valid(value: DividendDailyAdvice): boolean {
  return !!value && typeof value.answer === 'string' && value.answer.trim().length > 0 && value.answer.length <= 30_000
    && typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt))
    && typeof value.language === 'string' && value.language.length > 0 && value.language.length <= 30
    && typeof value.planKey === 'string' && value.planKey.length <= 500_000 && typeof value.refreshLimited === 'boolean';
}
export async function loadDividendDailyAdvice(): Promise<DividendDailyAdvice | null> {
  const value = await advice.get('latest');
  if (!value || !valid(value)) return null;
  return { answer: value.answer, generatedAt: value.generatedAt, language: value.language, planKey: value.planKey, refreshLimited: value.refreshLimited };
}
export async function saveDividendDailyAdvice(value: DividendDailyAdvice): Promise<void> {
  if (!valid(value)) throw new Error('INVALID_DAILY_ADVICE');
  // Store only the readable result and its scope; never a provider config or credentials.
  await advice.put({ id: 'latest', answer: value.answer, generatedAt: value.generatedAt, language: value.language, planKey: value.planKey, refreshLimited: value.refreshLimited });
}
export function closeDividendDailyAdvice() { database.close(); }

// Additional record IDs in the existing v1 table. The legacy `latest` answer,
// main ledger schema and backup formats are untouched.
const checks: Table<{ id: string; check: DividendDailyCheck }, string> = database.table('advice');
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const actionValid = (value: DividendDailyCheck['items'][number]['actions']['buy']) => !!value
  && ['blocked', 'review', 'wait', 'confirmation_candidate', 'unknown'].includes(value.status) && strings(value.reasons)
  && typeof value.requiresUserConfirmation === 'boolean';
function validCheck(value: DividendDailyCheck): boolean {
  return !!value && value.version === 1 && typeof value.batchId === 'string' && value.batchId.length <= 100
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && Number.isSafeInteger(value.startedAt) && value.startedAt > 0 && Number.isSafeInteger(value.deadlineAt)
    && value.deadlineAt >= value.startedAt && (value.finishedAt === undefined || Number.isSafeInteger(value.finishedAt))
    && ['running', 'completed', 'partial', 'cancelled', 'timed_out', 'changed'].includes(value.status)
    && ['quotes', 'evidence', 'plans', 'result'].includes(value.stage)
    && typeof value.planKey === 'string' && value.planKey.length <= 500_000 && typeof value.inputKey === 'string'
    && Array.isArray(value.items) && value.items.length <= 10_000
    && value.items.every(item => !!item && typeof item.key === 'string' && typeof item.name === 'string'
      && ['stock', 'fund'].includes(item.kind) && ['review', 'wait', 'unknown'].includes(item.bucket)
      && typeof item.id === 'string' && typeof item.trigger === 'string'
      && !!item.quote && ['current', 'last_available', 'unknown'].includes(item.quote.status)
      && (item.quote.date === undefined || typeof item.quote.date === 'string')
      && actionValid(item.actions?.buy) && actionValid(item.actions?.sell) && strings(item.reasons) && item.reasons.length <= 3
      && !!item.eligibility && ['pass', 'fail', 'unknown'].includes(item.eligibility.status) && strings(item.eligibility.reasons)
      && Array.isArray(item.eligibility.checks) && item.eligibility.checks.every(check => !!check && typeof check.rule === 'string' && ['pass', 'risk', 'unknown'].includes(check.status))
      && typeof item.fingerprint === 'string' && !!item.dates && strings(item.dates.sources) && strings(item.dates.evidenceVerifiedDates))
    && Array.isArray(value.sources) && value.sources.every(source => !!source && typeof source.id === 'string'
      && typeof source.itemKey === 'string' && typeof source.provider === 'string' && ['quotes', 'evidence', 'plans', 'result'].includes(source.stage)
      && (source.url === undefined || typeof source.url === 'string') && (source.detail === undefined || typeof source.detail === 'string')
      && (source.sourceDate === undefined || typeof source.sourceDate === 'string') && (source.verifiedDates === undefined || strings(source.verifiedDates))
      && ['pending', 'success', 'failed', 'deferred'].includes(source.status))
    && Array.isArray(value.checkedKeys) && value.checkedKeys.every(key => typeof key === 'string')
    && Array.isArray(value.errors) && value.errors.every(error => typeof error === 'string');
}

function fields<T, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as Pick<T, K>;
}
function cleanCheck(value: DividendDailyCheck): DividendDailyCheck {
  // Only local result fields, never a spread of an AI/client configuration.
  return JSON.parse(JSON.stringify({ version: 1, batchId: value.batchId, revision: value.revision, startedAt: value.startedAt, deadlineAt: value.deadlineAt,
    finishedAt: value.finishedAt, status: value.status, stage: value.stage, inputKey: value.inputKey, planKey: value.planKey,
    items: value.items.map(item => ({ ...fields(item, ['key', 'kind', 'id', 'code', 'name', 'bucket', 'trigger', 'nextBuyState', 'nextSellState', 'reasons', 'fingerprint', 'checkedAt', 'stale']),
      quote: fields(item.quote, ['status', 'reasons', 'date', 'priceMinor', 'priceMicros', 'fetchedAt', 'historicalUsable', 'sessionConfirmed']),
      nextBuy: item.nextBuy && fields(item.nextBuy, ['index', 'priceMinor', 'priceMicros', 'basis', 'targetShares', 'sellShares']),
      nextSell: item.nextSell && fields(item.nextSell, ['index', 'priceMinor', 'priceMicros', 'basis', 'targetShares', 'sellShares']),
      actions: { buy: fields(item.actions.buy, ['status', 'reasons', 'requiresUserConfirmation']), sell: fields(item.actions.sell, ['status', 'reasons', 'requiresUserConfirmation']) },
      eligibility: { status: item.eligibility.status, reasons: item.eligibility.reasons,
        checks: item.eligibility.checks.map(check => fields(check, ['rule', 'status', 'value', 'threshold', 'period', 'reason'])) },
      dates: fields(item.dates, ['reportPeriod', 'noticeDate', 'researchGeneratedAt', 'evidenceVerifiedDates', 'sources']) })),
    sources: value.sources.map(source => fields(source, ['id', 'itemKey', 'stage', 'provider', 'url', 'status', 'attemptedAt', 'sourceDate', 'verifiedDates', 'detail'])),
    checkedKeys: value.checkedKeys, errors: value.errors,
    retryOf: value.retryOf, retryKeys: value.retryKeys }));
}

export async function loadDividendDailyChecks(): Promise<{ current: DividendDailyCheck | null; completed: DividendDailyCheck | null }> {
  const [current, completed] = await Promise.all([checks.get('check:current'), checks.get('check:completed')]);
  return { current: current && validCheck(current.check) ? cleanCheck(current.check) : null,
    completed: completed && validCheck(completed.check) ? cleanCheck(completed.check) : null };
}

export async function saveDividendDailyCheck(value: DividendDailyCheck, options: { claim?: boolean; isCurrent?: () => boolean } = {}): Promise<boolean> {
  if (!validCheck(value)) throw new Error('INVALID_DAILY_CHECK');
  const check = cleanCheck(value);
  return database.transaction('rw', checks, async () => {
    if (options.isCurrent && !options.isCurrent()) return false;
    const previous = await checks.get('check:current');
    if (!options.claim && previous?.check.batchId !== check.batchId) return false;
    if (previous?.check.batchId === check.batchId && previous.check.revision > check.revision) return false;
    if (options.isCurrent && !options.isCurrent()) return false;
    await checks.put({ id: 'check:current', check });
    if (check.status === 'completed') await checks.put({ id: 'check:completed', check });
    return true;
  });
}
