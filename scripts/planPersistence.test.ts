import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// The app uses bundler-style extensionless imports and JSON modules. Teach the
// native Node test runner just enough of Vite's resolution rules for this unit.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
      return {
        format: 'module',
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const { db, initializeSettings, exportToExcel, importFromExcel } = await import('../src/db.ts');
const { createPlanItem, createInitialPlanItems, updatePlanItem, getPlanStatus, createPlanTarget, updatePlanTarget, setPlanTargetTotal } = await import('../src/services/planService.ts');

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await initializeSettings();
  await db.settings.update('main', { primaryCurrency: 'CNY' });
});
after(() => db.close());

async function seedAccount() {
  await db.accounts.add({ id: 'qa-account', name: 'Synthetic cash', category: '现金', type: 'asset', currency: 'CNY', createdAt: 1, sortOrder: 0 });
  await db.records.add({ id: 'qa-record', accountId: 'qa-account', date: '2026-09-22', amount: 240000, createdAt: 1 });
  await setPlanTargetTotal(1000000);
}

test('plan amount, actual progress and purchase notes survive updates and Excel restore', async () => {
  await seedAccount();
  const notes = 'Unowned ETF 001\nDeposit; compare terms';
  const id = await createPlanItem({ name: 'Cash plan', categories: ['现金'], targetPercent: 36, plannedPurchases: notes });
  const targetId = await createPlanTarget({ planItemId: id, label: 'Legacy reserve', targetPercent: 20, refKeys: ['a:qa-account'], allocations: [{ refKey: 'a:qa-account', amountMinor: 10000000 }] });
  await updatePlanItem(id, { targetPercent: 350000.01 / 1000000 * 100 });
  const before = await getPlanStatus();
  assert.ok(Math.abs(before.items[0].targetValue - 350000.01) < 0.000001);
  assert.equal(before.items[0].currentValue, 240000);
  assert.equal(before.items[0].currentPercent, 100);
  assert.equal(before.items[0].plannedPurchases, notes);
  assert.equal(before.items[0].targets[0].currentValue, 100000);
  const backup = await exportToExcel();
  await updatePlanItem(id, { plannedPurchases: 'changed' });
  assert.equal(await importFromExcel(backup), true);
  assert.equal((await db.planItems.get(id))?.plannedPurchases, notes);
  assert.deepEqual((await db.planTargets.get(targetId))?.refKeys, ['a:qa-account']);
  assert.deepEqual((await db.planTargets.get(targetId))?.allocations, [{ refKey: 'a:qa-account', amountMinor: 10000000 }]);
  await updatePlanTarget(targetId, { refKeys: [], allocations: [] });
  const after = await getPlanStatus();
  assert.equal(after.items[0].currentValue, 240000);
  assert.equal(after.items[0].targets[0].currentValue, 0);
});

test('old plans without purchase notes remain readable and gain notes without losing links', async () => {
  await seedAccount();
  const id = await createPlanItem({ name: 'Old plan', categories: ['现金'], targetPercent: 50 });
  const before = await getPlanStatus();
  assert.equal(before.items[0].plannedPurchases, undefined);
  await updatePlanItem(id, { plannedPurchases: 'Future deposit' });
  const after = await getPlanStatus();
  assert.equal(after.items[0].currentValue, 240000);
  assert.deepEqual(after.items[0].categories, ['现金']);
  assert.equal(after.items[0].plannedPurchases, 'Future deposit');
});

test('initial plan keeps fractional allocations and rejects a duplicate retry', async () => {
  const entries = ['现金', '银行存款', '其他资产'].map(name => ({ name, categories: [name], targetPercent: 100 / 3 }));
  await createInitialPlanItems(entries);
  const status = await getPlanStatus();
  assert.ok(Math.abs(status.targetPercentSum - 100) < 0.000001);
  await assert.rejects(createInitialPlanItems(entries), /PLAN_ALREADY_EXISTS/);
  assert.equal(await db.planItems.count(), 3);
});

test('initial plan rolls back all categories if one write fails', async () => {
  const failSecond = (_key: unknown, item: { name: string }) => {
    if (item.name === 'fail') throw new Error('simulated write failure');
  };
  db.planItems.hook('creating', failSecond);
  try {
    await assert.rejects(createInitialPlanItems([
      { name: 'first', categories: ['现金'], targetPercent: 50 },
      { name: 'fail', categories: ['银行存款'], targetPercent: 50 },
    ]), /simulated write failure/);
    assert.equal(await db.planItems.count(), 0);
  } finally {
    db.planItems.hook('creating').unsubscribe(failSecond);
  }
});
