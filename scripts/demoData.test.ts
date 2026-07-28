import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

interface DemoData {
  metadata: { synthetic: boolean; warning: string; locale?: string };
  accounts: { id: string; name: string }[];
  records: { id: string; accountId: string }[];
  holdings: { id: string; accountId: string; name: string }[];
  holdingTxns: { id: string; accountId: string; holdingId: string }[];
}

const demo = JSON.parse(
  readFileSync(new URL('../demo/fortuna-demo-data.json', import.meta.url), 'utf8'),
) as DemoData;
const englishDemo = JSON.parse(
  readFileSync(new URL('../demo/fortuna-demo-data.en.json', import.meta.url), 'utf8'),
) as DemoData;

test('demo JSON is explicitly synthetic and uses isolated identifiers', () => {
  assert.equal(demo.metadata.synthetic, true);
  assert.match(demo.metadata.warning, /虚构/);
  assert.ok(demo.accounts.every(account => account.id.startsWith('demo-') && account.name.includes('演示')));
  assert.ok(demo.holdings.every(holding => holding.id.startsWith('demo-') && holding.name.includes('演示')));
  assert.doesNotMatch(JSON.stringify(demo), /哨兵|Charlotte|restartday/i);
});

test('demo account and holding references are internally consistent', () => {
  const accountIds = new Set(demo.accounts.map(account => account.id));
  const holdingIds = new Set(demo.holdings.map(holding => holding.id));
  assert.ok(demo.records.every(record => accountIds.has(record.accountId)));
  assert.ok(demo.holdings.every(holding => accountIds.has(holding.accountId)));
  assert.ok(demo.holdingTxns.every(transaction => accountIds.has(transaction.accountId) && holdingIds.has(transaction.holdingId)));
});

test('English demo is synthetic, isolated, and fully English-facing', () => {
  assert.equal(englishDemo.metadata.synthetic, true);
  assert.equal(englishDemo.metadata.locale, 'en');
  assert.match(englishDemo.metadata.warning, /fictional/i);
  assert.ok(englishDemo.accounts.every(account => account.id.startsWith('demo-') && account.name.includes('(Demo)')));
  assert.ok(englishDemo.holdings.every(holding => holding.id.startsWith('demo-') && holding.name.includes('Demo')));
  assert.doesNotMatch(JSON.stringify(englishDemo), /演示|虚构|哨兵|Charlotte|restartday/i);
});

test('demo workbook contains every Fortuna backup sheet and matches the JSON source', () => {
  const workbook = XLSX.read(
    readFileSync(new URL('../demo/Fortuna-Demo-Portfolio.xlsx', import.meta.url)),
    { type: 'buffer' },
  );
  const requiredSheets = ['BackupInfo', 'Settings', 'ExchangeRates', 'Accounts', 'Records', 'Products', 'Plan', 'PlanTargets', 'Holdings', 'HoldingTxns'];
  assert.deepEqual(workbook.SheetNames, requiredSheets);

  const backupInfo = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.BackupInfo)[0];
  assert.equal(backupInfo.format, 'Fortuna Excel Backup');
  assert.equal(backupInfo.syntheticDemo, true);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Accounts).length, demo.accounts.length);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Records).length, demo.records.length);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Holdings).length, demo.holdings.length);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.HoldingTxns).length, demo.holdingTxns.length);
});

test('English demo workbook matches its English JSON source', () => {
  const workbook = XLSX.read(
    readFileSync(new URL('../demo/Fortuna-Demo-Portfolio.en.xlsx', import.meta.url)),
    { type: 'buffer' },
  );
  const requiredSheets = ['BackupInfo', 'Settings', 'ExchangeRates', 'Accounts', 'Records', 'Products', 'Plan', 'PlanTargets', 'Holdings', 'HoldingTxns'];
  assert.deepEqual(workbook.SheetNames, requiredSheets);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Accounts).length, englishDemo.accounts.length);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Holdings).length, englishDemo.holdings.length);
});
