import test, { beforeEach, after } from 'node:test';
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import * as XLSX from 'xlsx';
import { parseDividendImport } from '../src/lib/dividendImport.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';

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

const { db, initializeSettings } = await import('../src/db.ts');
const { importDividendStocks, loadDividendWorkbench, allocateDividendBudget, deleteDividendStock } = await import('../src/services/dividendService.ts');

function workbook(sheets: Record<string, XLSX.WorkSheet>, bookType: 'xlsx' | 'xls' | 'csv' = 'xlsx'): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name);
  return XLSX.write(book, { type: 'array', bookType }) as ArrayBuffer;
}
function stock(code: string, weightBps: number): DividendStock {
  return { code, name: code, group: 'watch', weightBps, shareMode: 'linked', manualShares: 0, lotSize: 100 };
}

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
});
after(() => db.close());

test('xlsx and xls preserve independent weights, numeric stock codes, percent formats and optional fields', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['股票代码', '股票名称', '计划占比（%）', '分组', '备注'],
    [1, '平安银行', 5.25, '核心', '保留自己的计划'],
    ['600036', '招商银行', 0.125, 'watch', ''],
    ['600900', '长江电力', '0%', '', ''],
  ]);
  sheet.C3.z = '0.00%';
  for (const format of ['xlsx', 'xls'] as const) {
    const parsed = parseDividendImport(workbook({ 红利股票: sheet }, format));
    assert.deepEqual(parsed.issues, []);
    assert.deepEqual(parsed.rows, [
      { line: 2, code: '000001', name: '平安银行', weightBps: 525, group: 'core', note: '保留自己的计划' },
      { line: 3, code: '600036', name: '招商银行', weightBps: 1250, group: 'watch' },
      { line: 4, code: '600900', name: '长江电力', weightBps: 0 },
    ]);
  }
});

test('pasted TSV and CSV retain quoted text and never equalize different plans', () => {
  assert.deepEqual(parseDividendImport('code\tname\tweight (%)\tgroup\tnote\n000001\t平安银行\t12.34%\thidden\t长期观察\n600036\t招商银行\t35\t\t').rows, [
    { line: 2, code: '000001', name: '平安银行', weightBps: 1234, group: 'hidden', note: '长期观察' },
    { line: 3, code: '600036', name: '招商银行', weightBps: 3500 },
  ]);
  const csv = 'code,name,weight,note\n000001,平安银行,7.5,"first, second"';
  assert.deepEqual(parseDividendImport(csv), { rows: [{ line: 2, code: '000001', name: '平安银行', weightBps: 750, note: 'first, second' }], issues: [] });
  assert.deepEqual(parseDividendImport(new TextEncoder().encode(csv).buffer).rows, parseDividendImport(csv).rows);
  assert.deepEqual(parseDividendImport('Stock code,Stock name,Plan weight (%),Group,My notes\n000001,平安银行,+.5,watch,@annual review').rows, [
    { line: 2, code: '000001', name: '平安银行', weightBps: 50, group: 'watch', note: '@annual review' },
  ]);
  assert.equal(parseDividendImport('股票代码,股票名称,计划占比（%）,分组,我的备注\n000001,平安银行,0.0000000001,观察,备注').issues[0].code, 'invalid_weight');
});

test('invalid rows have precise issues while valid rows remain selectable', () => {
  const parsed = parseDividendImport('code,name,weight,group,note\n000001,平安银行,10.25,core,keep\n00700,港股,5,,\n600036,招商银行,3.333,,\n600900,长江电力,10 shares,,\n601398,,5,,\n601939,建行,5,unknown,');
  assert.deepEqual(parsed.rows, [{ line: 2, code: '000001', name: '平安银行', weightBps: 1025, group: 'core', note: 'keep' }]);
  assert.deepEqual(parsed.issues.map(issue => [issue.code, issue.line, issue.field]), [
    ['invalid_code', 3, 'code'], ['invalid_weight', 4, 'weightBps'], ['invalid_weight', 5, 'weightBps'], ['invalid_name', 6, 'name'], ['invalid_group', 7, 'group'],
  ]);
});

test('formula cells, stale cached results and boolean/date/error values cannot become stock plans', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['code', 'name', 'weight', 'note'],
    ['000001', '平安银行', 5, ''],
    ['600036', '招商银行', 5, ''],
    ['600900', '长江电力', true, ''],
    ['601398', '工商银行', new Date('2026-01-01'), ''],
    ['601939', '建设银行', 5, 123],
  ]);
  sheet.C2 = { t: 'n', v: 5, f: '10/2' };
  sheet.D3 = { t: 's', v: 'old cached note', f: 'A1' };
  const parsed = parseDividendImport(workbook({ Stocks: sheet }));
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.issues.map(issue => [issue.code, issue.line]), [['formula_cell', 2], ['formula_cell', 3], ['invalid_weight', 4], ['invalid_weight', 5], ['invalid_note', 6]]);
  assert.equal(parseDividendImport('code,name,weight\n000001,平安银行,=2+3').issues[0].code, 'formula_cell');
});

test('template round trips literal notes beginning with formula-like punctuation as text', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['股票代码', '股票名称', '计划占比（%）', '我的备注'],
    ['000001', '平安银行', 5, '=长期计划'],
    ['600036', '招商银行', 15, '@下次复查'],
    ['600900', '长江电力', 20, '+增加关注'],
  ]);
  assert.deepEqual(parseDividendImport(workbook({ 红利股票: sheet })), {
    rows: [
      { line: 2, code: '000001', name: '平安银行', weightBps: 500, note: '=长期计划' },
      { line: 3, code: '600036', name: '招商银行', weightBps: 1500, note: '@下次复查' },
      { line: 4, code: '600900', name: '长江电力', weightBps: 2000, note: '+增加关注' },
    ],
    issues: [],
  });
});

test('all duplicate identities are excluded instead of choosing an arbitrary plan', () => {
  const parsed = parseDividendImport('code,name,weight\n000001,平安银行,5\nSZ.000001,平安银行,6\n600036,招商银行,4');
  assert.deepEqual(parsed.rows, [{ line: 4, code: '600036', name: '招商银行', weightBps: 400 }]);
  assert.deepEqual(parsed.issues.map(issue => [issue.code, issue.line]), [['duplicate_code', 2], ['duplicate_code', 3]]);
});

test('missing/duplicate columns, backups and ambiguous or oversized workbooks are rejected', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['code', 'name', 'weight'], ['000001', '平安银行', 5]]);
  assert.equal(parseDividendImport('code,name\n000001,平安银行').issues[0].code, 'missing_columns');
  assert.equal(parseDividendImport('code,name,weight,计划占比\n000001,平安银行,5,5').issues[0].code, 'duplicate_columns');
  assert.equal(parseDividendImport(workbook({ Stocks: sheet, BackupInfo: XLSX.utils.aoa_to_sheet([['backup']]) })).issues[0].code, 'backup_workbook');
  assert.equal(parseDividendImport(workbook({ Stocks: sheet, Other: sheet })).issues[0].code, 'ambiguous_sheets');
  const tooLarge = { ...sheet, '!ref': 'A1:C5002' };
  assert.equal(parseDividendImport(workbook({ Stocks: tooLarge })).issues[0].code, 'too_many_rows');
  assert.equal(parseDividendImport('code,name,weight').issues[0].code, 'empty_sheet');
  assert.equal(parseDividendImport('unrelated,document').issues[0].code, 'no_dividend_sheet');
});

test('name and note lengths are bounded consistently with the editable template', () => {
  const parsed = parseDividendImport(`code,name,weight,note\n000001,${'n'.repeat(81)},5,\n600036,招商银行,5,${'x'.repeat(2001)}`);
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.issues.map(issue => [issue.code, issue.line]), [['invalid_name', 2], ['invalid_note', 3]]);
});

test('selected import adds stocks and updates only specified fields while preserving trading data and holdings', async () => {
  const existing: DividendStock = {
    ...stock('000001', 1000), group: 'core', shareMode: 'manual', manualShares: 1234, manualDpsMicros: 310000, lotSize: 200, note: 'retain note',
    buyLevels: [{ yieldBps: 550, portionBps: 10000, priceMinor: 512 }], sellLevels: [{ yieldBps: 300, portionBps: 10000 }],
    quote: { priceMinor: 1100, date: '2026-10-04', fetchedAt: 1 }, quoteFailedAt: 2,
  };
  await db.dividendStocks.add(existing);
  await db.accounts.add({ id: 'account', name: 'ledger', category: '股票/ETF', type: 'asset', currency: 'CNY', createdAt: 1, sortOrder: 0 });
  await db.holdings.add({ id: 'holding', accountId: 'account', name: 'held stock', symbol: '000001', createdAt: 1 });
  const holdingsBefore = await db.holdings.toArray();
  const parsed = parseDividendImport('code,name,weight,group,note\n000001,新名称,25,,\n600036,招商银行,15,核心,新备注\n600900,长江电力,20,,');
  assert.deepEqual(await importDividendStocks(parsed.rows.slice(0, 2)), { added: 1, updated: 1 });
  assert.deepEqual(await db.dividendStocks.get('000001'), { ...existing, name: '新名称', weightBps: 2500 });
  assert.deepEqual(await db.dividendStocks.get('600036'), { ...stock('600036', 1500), name: '招商银行', group: 'core', note: '新备注' });
  assert.equal(await db.dividendStocks.get('600900'), undefined);
  assert.deepEqual(await db.holdings.toArray(), holdingsBefore);
  assert.equal((await loadDividendWorkbench()).stocks.length, 2);
});

test('import validates selected rows and current final weight before any writes', async () => {
  await db.dividendStocks.bulkAdd([stock('000001', 6000), stock('600036', 3000)]);
  const before = await db.dividendStocks.toArray();
  await assert.rejects(importDividendStocks([{ line: 2, code: '600900', name: '长江电力', weightBps: 2000 }]), /DIVIDEND_IMPORT_OVER_BUDGET/);
  await assert.rejects(importDividendStocks([{ line: 2, code: '000001', name: '平安银行', weightBps: 4000 }, { line: 3, code: '000001', name: '重复', weightBps: 1000 }]), /INVALID_DIVIDEND_IMPORT/);
  await assert.rejects(importDividendStocks([{ line: 2, code: '00700', name: '腾讯', weightBps: 0 }]), /INVALID_DIVIDEND_IMPORT/);
  await assert.rejects(importDividendStocks([{ line: 2, code: '600900', name: 'n'.repeat(81), weightBps: 0 }]), /INVALID_DIVIDEND_IMPORT/);
  await assert.rejects(importDividendStocks([{ line: 2, code: '600900', name: '长江电力', weightBps: 0, note: 'x'.repeat(2001) }]), /INVALID_DIVIDEND_IMPORT/);
  assert.deepEqual(await db.dividendStocks.toArray(), before);
  assert.deepEqual(await importDividendStocks([{ line: 2, code: '000001', name: '平安银行', weightBps: 4000 }, { line: 3, code: '600900', name: '长江电力', weightBps: 2000 }]), { added: 1, updated: 1 });
  assert.equal((await db.dividendStocks.toArray()).reduce((sum, row) => sum + row.weightBps, 0), 9000);
  await importDividendStocks([{ line: 2, code: '688981', name: '中芯国际', weightBps: 0 }]);
  assert.equal((await db.dividendStocks.get('688981'))?.lotSize, 200);
});

test('a write failure rolls back both updated plans and additions', async () => {
  await db.dividendStocks.add(stock('000001', 1000));
  const failCreate = (_key: unknown, row: DividendStock) => { if (row.code === '600036') throw new Error('simulated import failure'); };
  db.dividendStocks.hook('creating', failCreate);
  try {
    await assert.rejects(importDividendStocks([{ line: 2, code: '000001', name: 'changed', weightBps: 2000 }, { line: 3, code: '600036', name: '招商银行', weightBps: 1000 }]), /simulated import failure/);
    assert.deepEqual(await db.dividendStocks.toArray(), [stock('000001', 1000)]);
    assert.notEqual((await db.settings.get('main'))?.dividendWorkbenchInitialized, true);
  } finally { db.dividendStocks.hook('creating').unsubscribe(failCreate); }
});

test('delete can retain unallocated budget and later allocation preserves proportional weights and metadata', async () => {
  await db.dividendStocks.bulkAdd([stock('000001', 1000), { ...stock('600036', 2000), note: 'retain', shareMode: 'manual', manualShares: 200 }, stock('600900', 0)]);
  await deleteDividendStock('000001', false);
  assert.equal((await db.dividendStocks.get('600036'))?.weightBps, 2000);
  await allocateDividendBudget();
  assert.deepEqual(await db.dividendStocks.get('600036'), { ...stock('600036', 10000), note: 'retain', shareMode: 'manual', manualShares: 200 });
  assert.equal((await db.dividendStocks.get('600900'))?.weightBps, 0);
});

test('allocation refuses an empty or overcommitted plan and rolls back on write failure', async () => {
  await assert.rejects(allocateDividendBudget(), /NO_DIVIDEND_WEIGHTS/);
  await db.dividendStocks.bulkAdd([stock('000001', 6000), stock('600036', 5000)]);
  await assert.rejects(allocateDividendBudget(), /DIVIDEND_IMPORT_OVER_BUDGET/);
  await db.dividendStocks.update('600036', { weightBps: 2000 });
  const before = await db.dividendStocks.toArray();
  const failUpdate = (_changes: unknown, key: string) => { if (key === '600036') throw new Error('simulated allocation failure'); };
  db.dividendStocks.hook('updating', failUpdate);
  try {
    await assert.rejects(allocateDividendBudget(), /simulated allocation failure/);
    assert.deepEqual(await db.dividendStocks.toArray(), before);
  } finally { db.dividendStocks.hook('updating').unsubscribe(failUpdate); }
});
