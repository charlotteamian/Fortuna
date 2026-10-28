import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import Dexie from 'dexie';
import { closeDividendDailyAdvice, loadDividendDailyAdvice, saveDividendDailyAdvice, type DividendDailyAdvice } from '../src/services/dividendDailyAdviceService.ts';

const stored = new Dexie('FortunaDividendDailyAdvice');
stored.version(1).stores({ advice: 'id' });
let closeReopened: (() => void) | undefined;
beforeEach(async () => { await stored.table('advice').clear(); });
after(async () => { closeDividendDailyAdvice(); closeReopened?.(); stored.close(); await Dexie.delete('FortunaDividendDailyAdvice'); });

const result = (answer = '先核对基金参考日期；股票计划继续等待触价。'): DividendDailyAdvice => ({
  answer, generatedAt: '2026-10-28T01:30:00.000Z', language: 'zh',
  planKey: JSON.stringify({ budget: 1000000, stocks: [{ code: '000001', shares: 200 }], funds: [{ code: '512890', weight: 10000 }] }),
  refreshLimited: true,
});

test('daily advice preserves readable results, source time and plan scope without storing credentials or machine actions', async () => {
  assert.equal(await loadDividendDailyAdvice(), null);
  const value = result();
  const supplied = { ...value, apiKey: 'PRIVATE_DAILY_KEY', config: { baseUrl: 'https://private.example', apiKey: 'PRIVATE_NESTED_KEY' }, actions: [{ code: '000001', buyPaused: true }] };
  await saveDividendDailyAdvice(supplied);
  assert.deepEqual(await loadDividendDailyAdvice(), value);
  const raw = await stored.table('advice').get('latest');
  assert.deepEqual(raw, { id: 'latest', ...value });
  assert.doesNotMatch(JSON.stringify(raw), /PRIVATE_|apiKey|config|actions|private\.example/);
  const returned = (await loadDividendDailyAdvice())!;
  returned.answer = 'Local mutation';
  assert.deepEqual(await loadDividendDailyAdvice(), value, 'mutating a displayed copy must not rewrite the saved recommendation');
});

test('invalid daily results reject atomically and preserve the last completed advice', async () => {
  const value = result();
  await saveDividendDailyAdvice(value);
  for (const invalid of [
    { ...value, answer: '' }, { ...value, answer: '   ' }, { ...value, answer: 'a'.repeat(30_001) },
    { ...value, generatedAt: 'not-a-date' }, { ...value, language: '' }, { ...value, language: 'a'.repeat(31) },
    { ...value, planKey: 'a'.repeat(500_001) }, { ...value, refreshLimited: 'true' }, null,
  ]) {
    await assert.rejects(saveDividendDailyAdvice(invalid as DividendDailyAdvice), /INVALID_DAILY_ADVICE/);
    assert.deepEqual(await loadDividendDailyAdvice(), value);
  }
});

test('malformed stored daily results are ignored without deleting other local evidence', async () => {
  const corrupt = { id: 'latest', ...result(), generatedAt: 'invalid' };
  await stored.table('advice').put(corrupt);
  assert.equal(await loadDividendDailyAdvice(), null);
  assert.deepEqual(await stored.table('advice').get('latest'), corrupt);
  await saveDividendDailyAdvice(result('已完成本次检查，等待保存的买入价。'));
  assert.equal((await loadDividendDailyAdvice())?.answer, '已完成本次检查，等待保存的买入价。');
});

test('a reopened advice database restores the last completed answer without silently redating it', async () => {
  const historical = { ...result(), generatedAt: '2026-10-27T01:30:00.000Z' };
  await saveDividendDailyAdvice(historical);
  closeDividendDailyAdvice();
  const reopened = await import('../src/services/dividendDailyAdviceService.ts?reopened');
  closeReopened = reopened.closeDividendDailyAdvice;
  assert.deepEqual(await reopened.loadDividendDailyAdvice(), historical);
  const next = result('本次建议已更新。');
  await reopened.saveDividendDailyAdvice(next);
  assert.deepEqual(await reopened.loadDividendDailyAdvice(), next);
});
