import Dexie, { type Table } from 'dexie';

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
