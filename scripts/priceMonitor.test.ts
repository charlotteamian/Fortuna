import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import * as XLSX from 'xlsx';
import { evaluatePriceMonitor, getPriceMonitorSignal, isPriceMonitor, type PriceMonitor } from '../src/lib/priceMonitor.ts';
import { formatLocalDate } from '../src/lib/localDate.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { db, initializeSettings, exportData, importData, exportToExcel, importFromExcel, hasLedgerData } = await import('../src/db.ts');
const { savePriceMonitor, listPriceMonitors, stopPriceMonitor, restartPriceMonitor, deletePriceMonitor,
  dismissPriceMonitorAlert, evaluatePriceMonitorQuotes, markPriceMonitorQuoteFailures } = await import('../src/services/priceMonitorService.ts');
const now = new Date('2026-10-22T10:00:00').getTime();
const plan: PriceMonitor = { id: 'watch-1', name: 'Fixture ETF', kind: 'security', symbol: '510300', market: 'A股', currency: 'CNY',
  targetPriceMicros: 4_000_000, toleranceBps: 500, direction: 'at_or_below', status: 'active', createdAt: now - 10000, updatedAt: now - 10000 };
const observation = (priceMicros: number, time = now) => ({ priceMicros, fetchedAt: time, date: formatLocalDate(new Date(time)) });

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
});
after(() => db.close());

test('integer target and inclusive bands handle both directions, jumps and zero tolerance', () => {
  assert.equal(getPriceMonitorSignal(plan, 4_200_000), 'near');
  assert.equal(getPriceMonitorSignal(plan, 4_200_001), null);
  assert.equal(getPriceMonitorSignal(plan, 4_000_000), 'reached');
  assert.equal(getPriceMonitorSignal(plan, 3_000_000), 'reached');
  const above = { ...plan, direction: 'at_or_above' as const };
  assert.equal(getPriceMonitorSignal(above, 3_800_000), 'near');
  assert.equal(getPriceMonitorSignal(above, 3_799_999), null);
  assert.equal(getPriceMonitorSignal(above, 4_000_000), 'reached');
  assert.equal(getPriceMonitorSignal(above, 5_000_000), 'reached');
  assert.equal(getPriceMonitorSignal({ ...plan, toleranceBps: 0 }, 4_000_001), null);
  assert.equal(getPriceMonitorSignal(plan, 0), null);
  assert.equal(getPriceMonitorSignal({ ...plan, targetPriceMicros: Number.MAX_SAFE_INTEGER, toleranceBps: 1 }, Number.MAX_SAFE_INTEGER), 'reached');
});

test('near alerts repeat by local calendar day and can upgrade to reached on the same day', () => {
  const near = evaluatePriceMonitor(plan, observation(4_100_000), now);
  assert.equal(near.alert?.kind, 'near');
  const dismissed = { ...near, alert: { ...near.alert!, dismissedAt: now + 1 } };
  const sameDay = evaluatePriceMonitor(dismissed, observation(4_100_000, now + 60000), now + 60000);
  assert.equal(sameDay.alert?.dismissedAt, now + 1);
  const nextDayTime = now + 24 * 60 * 60_000;
  const nextDay = evaluatePriceMonitor(sameDay, observation(4_100_000, nextDayTime), nextDayTime);
  assert.equal(nextDay.alert?.date, formatLocalDate(new Date(nextDayTime)));
  assert.equal(nextDay.alert?.dismissedAt, undefined);
  const reached = evaluatePriceMonitor(dismissed, observation(3_900_000, now + 60000), now + 60000);
  assert.equal(reached.status, 'reached');
  assert.equal(reached.alert?.kind, 'reached');
  assert.equal(reached.alert?.dismissedAt, undefined);
  assert.equal(evaluatePriceMonitor(reached, observation(3_800_000, now + 120000), now + 120000), reached);
});

test('stopped plans, old cache, future or malformed quotes cannot trigger, while fresh holiday close can', () => {
  for (const quote of [observation(3_900_000, now - 6 * 60_000), { ...observation(3_900_000), date: '2026-10-23' },
    { ...observation(3_900_000), date: '2026-10-01' }, { ...observation(3_900_000), date: '2026-02-30' },
    { ...observation(3_900_000), date: '2026-10-22 25:00' }, { ...observation(3_900_000), date: '2026-10-22 15:60' },
    { ...observation(3_900_000), priceMicros: NaN }, observation(3_900_000, now + 120000)]) {
    assert.equal(evaluatePriceMonitor(plan, quote, now), plan);
  }
  const stopped = { ...plan, status: 'stopped' as const };
  assert.equal(evaluatePriceMonitor(stopped, observation(3_900_000), now), stopped);
  const holidayClose = evaluatePriceMonitor(plan, { ...observation(4_100_000), date: '2026-10-20 15:00:00' }, now);
  assert.equal(holidayClose.alert?.kind, 'near');
  assert.equal(holidayClose.alert?.date, '2026-10-22');
  const newest = { ...plan, lastQuote: observation(4_200_000, now + 1) };
  assert.equal(evaluatePriceMonitor(newest, observation(3_900_000), now), newest);
});

test('monitor validation requires explicit integer percent, positive target, security code or gold identity', () => {
  assert.equal(isPriceMonitor(plan), true);
  for (const invalid of [{ toleranceBps: undefined }, { toleranceBps: NaN }, { toleranceBps: 1.5 }, { toleranceBps: -1 },
    { toleranceBps: 10001 }, { targetPriceMicros: 0 }, { targetPriceMicros: 0.1 }, { symbol: '' }, { currency: '' },
    { status: 'unknown' }, { alert: { kind: 'near', date: '2026-02-30', priceMicros: 1, createdAt: now } }]) {
    assert.equal(isPriceMonitor({ ...plan, ...invalid }), false, JSON.stringify(invalid));
  }
  assert.equal(isPriceMonitor({ ...plan, kind: 'gold', symbol: undefined, metalType: 'XAU' }), true);
});

test('monitor plans survive zero holdings, atomically deduplicate concurrent checks, and retain final target alert', async () => {
  await db.priceMonitors.add(plan);
  assert.equal(await hasLedgerData(), true);
  assert.equal(await db.holdings.count(), 0);
  const quote = { ...observation(4_100_000), planUpdatedAt: plan.updatedAt };
  const results = await Promise.all([evaluatePriceMonitorQuotes({ [plan.id]: quote }, now), evaluatePriceMonitorQuotes({ [plan.id]: quote }, now)]);
  assert.equal(results.reduce((sum, result) => sum + result.near, 0), 1);
  await dismissPriceMonitorAlert(plan.id);
  await evaluatePriceMonitorQuotes({ [plan.id]: { ...observation(3_900_000, now + 1), planUpdatedAt: plan.updatedAt } }, now + 1);
  const reached = (await listPriceMonitors())[0];
  assert.equal(reached.status, 'reached');
  assert.equal(reached.alert?.kind, 'reached');
  assert.equal(reached.alert?.dismissedAt, undefined);
});

test('CRUD clears old notices and request fingerprints protect edited, stopped and deleted plans', async () => {
  const saved = await savePriceMonitor({ ...plan, id: undefined });
  assert.equal(saved.status, 'active');
  const edited = await savePriceMonitor({ ...saved, targetPriceMicros: 2_000_000 });
  const checkTime = edited.updatedAt + 100;
  assert.ok(edited.updatedAt > saved.updatedAt);
  assert.deepEqual(await evaluatePriceMonitorQuotes({ [edited.id]: { ...observation(1_000_000, checkTime), planUpdatedAt: saved.updatedAt } }, checkTime), { checked: 0, near: 0, reached: 0 });
  await markPriceMonitorQuoteFailures([{ id: saved.id, planUpdatedAt: saved.updatedAt }], checkTime);
  assert.equal((await db.priceMonitors.get(saved.id))?.lastErrorAt, undefined);
  await stopPriceMonitor(saved.id);
  await evaluatePriceMonitorQuotes({ [saved.id]: observation(1_000_000, checkTime) }, checkTime);
  assert.equal((await db.priceMonitors.get(saved.id))?.status, 'stopped');
  await db.priceMonitors.update(saved.id, { alert: { kind: 'near', date: formatLocalDate(), priceMicros: 2100000, createdAt: checkTime }, lastCheckedAt: checkTime });
  const oldWithAlert = (await db.priceMonitors.get(saved.id))!;
  const resaved = await savePriceMonitor(oldWithAlert);
  assert.equal(resaved.alert, undefined);
  assert.equal(resaved.lastCheckedAt, undefined);
  await restartPriceMonitor(saved.id);
  assert.equal((await db.priceMonitors.get(saved.id))?.status, 'active');
  assert.equal((await db.priceMonitors.get(saved.id))?.alert, undefined);
  await deletePriceMonitor(saved.id);
  await evaluatePriceMonitorQuotes({ [saved.id]: observation(1_000_000, checkTime) }, checkTime);
  assert.deepEqual(await listPriceMonitors(), []);
  await assert.rejects(savePriceMonitor({ ...plan, id: 'missing' }), /PRICE_MONITOR_NOT_FOUND/);
});

test('failures retain dated quote and never trigger an alert', async () => {
  await db.priceMonitors.add({ ...plan, lastQuote: observation(4_100_000, now - 60000) });
  await markPriceMonitorQuoteFailures([{ id: plan.id, planUpdatedAt: plan.updatedAt }], now);
  const failed = await db.priceMonitors.get(plan.id);
  assert.equal(failed?.lastErrorAt, now);
  assert.equal(failed?.lastQuote?.priceMicros, 4_100_000);
  assert.equal(failed?.alert, undefined);
  assert.equal(failed?.status, 'active');
});

test('JSON and Excel round trips include independent monitors and full replacement clears absent old-version plans', async () => {
  const full = JSON.parse(JSON.stringify(evaluatePriceMonitor(plan, observation(4_100_000), now)));
  await db.priceMonitors.add(full);
  const json = await exportData();
  await db.priceMonitors.clear();
  assert.equal(await importData(json), true);
  assert.deepEqual(await db.priceMonitors.toArray(), [full]);
  const excel = await exportToExcel();
  await db.priceMonitors.clear();
  assert.equal(await importFromExcel(excel), true);
  assert.deepEqual(await db.priceMonitors.toArray(), [full]);
  const oldData = JSON.parse(json); delete oldData.priceMonitors; oldData.version = 13;
  assert.equal(await importData(JSON.stringify(oldData)), true);
  assert.equal(await db.priceMonitors.count(), 0);
  await db.priceMonitors.add(full);
  const oldWorkbook = XLSX.read(excel, { type: 'base64' });
  delete oldWorkbook.Sheets.PriceMonitors;
  oldWorkbook.SheetNames = oldWorkbook.SheetNames.filter(name => name !== 'PriceMonitors');
  oldWorkbook.Sheets.BackupInfo = XLSX.utils.json_to_sheet([{ format: 'Fortuna Excel Backup', version: 5 }]);
  assert.equal(await importFromExcel(XLSX.write(oldWorkbook, { type: 'base64', bookType: 'xlsx' })), true);
  assert.equal(await db.priceMonitors.count(), 0);
});

test('malformed or duplicate monitor backups reject atomically without clearing existing ledger', async context => {
  context.mock.method(console, 'error', () => {});
  await db.priceMonitors.add(plan);
  const original = JSON.parse(await exportData());
  for (const monitors of [[{ ...plan, targetPriceMicros: -1 }], [plan, plan]]) {
    assert.equal(await importData(JSON.stringify({ ...original, priceMonitors: monitors })), false);
    assert.deepEqual(await db.priceMonitors.toArray(), [plan]);
    const wb = XLSX.read(await exportToExcel(), { type: 'base64' });
    wb.Sheets.PriceMonitors = XLSX.utils.json_to_sheet(monitors.map(p => ({ id: p.id, data: JSON.stringify(p) })));
    const failures: { sheet?: string }[] = [];
    assert.equal(await importFromExcel(XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }), failure => failures.push(failure)), false);
    assert.equal(failures[0].sheet, 'PriceMonitors');
    assert.deepEqual(await db.priceMonitors.toArray(), [plan]);
  }
});
