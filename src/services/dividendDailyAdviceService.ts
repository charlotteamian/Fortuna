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
      && !!item.quote && !!item.actions?.buy && !!item.actions?.sell && Array.isArray(item.reasons) && item.reasons.length <= 3
      && typeof item.fingerprint === 'string' && !!item.dates && Array.isArray(item.dates.sources) && Array.isArray(item.dates.evidenceVerifiedDates))
    && Array.isArray(value.sources) && value.sources.every(source => !!source && typeof source.id === 'string'
      && typeof source.itemKey === 'string' && ['pending', 'success', 'failed', 'deferred'].includes(source.status))
    && Array.isArray(value.checkedKeys) && value.checkedKeys.every(key => typeof key === 'string')
    && Array.isArray(value.errors) && value.errors.every(error => typeof error === 'string');
}

function cleanCheck(value: DividendDailyCheck): DividendDailyCheck {
  // Only local result fields, never a spread of an AI/client configuration.
  return JSON.parse(JSON.stringify({ version: 1, batchId: value.batchId, revision: value.revision, startedAt: value.startedAt, deadlineAt: value.deadlineAt,
    finishedAt: value.finishedAt, status: value.status, stage: value.stage, inputKey: value.inputKey, planKey: value.planKey,
    items: value.items, sources: value.sources, checkedKeys: value.checkedKeys, errors: value.errors,
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
