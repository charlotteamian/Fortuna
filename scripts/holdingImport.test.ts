import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseHoldingImport, exportHoldingImportTemplate, type HoldingImportTemplateOptions } from '../src/lib/holdingImport.ts';

function workbook(rows: unknown[][], sheetName = '持仓', otherSheets: Record<string, unknown[][]> = {}): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  for (const [name, data] of Object.entries(otherSheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), name);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const options = { currency: 'CNY', defaultMarket: 'A股' };

test('broker aliases import total holdings rather than available quantity and preserve leading-zero codes', () => {
  const result = parseHoldingImport(workbook([
    ['证券名称', '证券代码', '股票余额', '可用数量', '现价', '成本价', '币种'],
    ['平安银行', '000001', '1,200', 800, '11.23', '10.1', '人民币'],
  ]), options);
  assert.deepEqual(result, { rows: [{ name: '平安银行', symbol: '000001', market: 'A股', shares: 1200, price: 11.23, costPrice: 10.1 }], issues: [] });
});

test('English aliases support fractional shares and optional blank name and average cost', () => {
  const result = parseHoldingImport(workbook([
    ['Ticker', 'Quantity', 'Current Price', 'Average Cost', 'Market', 'Currency'],
    ['AAPL.US', 1.25, 240, '', 'US', 'USD'],
  ]), { currency: 'USD' });
  assert.deepEqual(result, { rows: [{ name: '', symbol: 'AAPL', market: '美股', shares: 1.25, price: 240 }], issues: [] });
});

test('international broker Qty and average-price headers exclude available shares', () => {
  const result = parseHoldingImport(workbook([
    ['Symbol', 'Description', 'Qty', 'Available', 'Market Price', 'Avg Price'],
    ['AAPL', 'Apple', 1.5, 1, 240, 200],
  ]), { currency: 'USD' });
  assert.deepEqual(result, { rows: [{ name: 'Apple', symbol: 'AAPL', market: '美股', shares: 1.5, price: 240, costPrice: 200 }], issues: [] });
});

test('zero holdings quantity is valid and missing cost never becomes current price', () => {
  const result = parseHoldingImport(workbook([
    ['股票代码', '持仓股数', '最新价'],
    ['000001', 0, 11],
  ]), options);
  assert.equal(result.issues.length, 0);
  assert.equal(result.rows[0].shares, 0);
  assert.equal(result.rows[0].costPrice, undefined);
});

test('a single invalid row blocks the batch with precise row numbers', () => {
  const result = parseHoldingImport(workbook([
    ['代码', '股份余额', '市价'],
    ['000001', 100, 11],
    ['000002', '', 12],
    ['000003', 100, ''],
  ]), options);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.issues.map(issue => [issue.code, issue.line, issue.field]), [
    ['invalid_shares', 3, 'shares'], ['invalid_price', 4, 'price'],
  ]);
});

test('numeric values are strict and never partially parse malformed grouping or units', () => {
  const invalidValues = ['1,00', '100股', '100 200', '1e3', '-1', '**', '—', 'NaN'];
  for (const value of invalidValues) {
    const result = parseHoldingImport(workbook([['代码', '数量', '价格'], ['000001', value, 10]]), options);
    assert.equal(result.issues[0].code, 'invalid_shares', value);
    assert.deepEqual(result.rows, []);
  }
  for (const value of [0, -1, '11元', '1,00', '']) {
    const result = parseHoldingImport(workbook([['代码', '数量', '价格'], ['000001', 100, value]]), options);
    assert.equal(result.issues[0].code, 'invalid_price', String(value));
  }
});

test('available quantity alone never satisfies the total-share requirement', () => {
  const result = parseHoldingImport(workbook([['代码', '可用数量', '最新价'], ['000001', 100, 11]]), options);
  assert.equal(result.issues[0].code, 'missing_columns');
  assert.equal(result.issues[0].field, 'shares');
});

test('backup workbook is rejected even if its Holdings sheet looks importable', () => {
  const result = parseHoldingImport(workbook([['代码', '数量', '价格'], ['000001', 100, 11]], 'Holdings', { BackupInfo: [['format', 'Fortuna']], Accounts: [['account']] }), options);
  assert.equal(result.issues[0].code, 'backup_workbook');
});

test('multiple holdings worksheets are rejected and instructions sheets are ignored', () => {
  const result = parseHoldingImport(workbook([['代码', '数量', '价格'], ['000001', 100, 11]], 'A', { B: [['代码', '数量', '价格'], ['000002', 100, 12]] }), options);
  assert.equal(result.issues[0].code, 'ambiguous_sheets');
});

test('ambiguous duplicate total-share columns and unrelated asset spreadsheets are rejected', () => {
  const duplicate = parseHoldingImport(workbook([
    ['代码', '股票余额', '持仓数量', '价格'], ['000001', 100, 200, 11],
  ]), options);
  assert.equal(duplicate.issues[0].code, 'duplicate_columns');
  assert.equal(duplicate.issues[0].field, 'shares');
  const unrelated = parseHoldingImport(workbook([['账户名称', '余额', '币种'], ['银行', 1000, 'CNY']]), options);
  assert.equal(unrelated.issues[0].code, 'no_holdings_sheet');
});

test('duplicates share a canonical code+market identity and conflicting currency is rejected', () => {
  const result = parseHoldingImport(workbook([
    ['代码', '数量', '价格', '市场', '币种'],
    ['000001.SZ', 100, 11, 'A股', 'CNY'],
    ['sz000001', 100, 11, 'A', 'CNY'],
    ['000002', 100, 12, 'A股', 'USD'],
  ]), options);
  assert.deepEqual(result.issues.map(issue => [issue.code, issue.line]), [['duplicate_symbol', 3], ['currency_mismatch', 4]]);
});

test('formatted numeric security codes retain zeroes and XLS numeric codes can use an explicit market', () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['代码', '数量', '价格', '市场'], [1, 100, 11, 'A股']]);
  sheet.A2.z = '000000';
  XLSX.utils.book_append_sheet(book, sheet, '持仓');
  const result = parseHoldingImport(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, options);
  assert.equal(result.rows[0].symbol, '000001');
  const xls = XLSX.write(book, { type: 'array', bookType: 'xls' }) as ArrayBuffer;
  assert.equal(parseHoldingImport(xls, options).rows[0].symbol, '000001');
});

test('CSV codes stay text rather than losing their leading zeros', () => {
  const csv = new TextEncoder().encode('symbol,shares,price,market\n000001,100,11,A\n');
  const result = parseHoldingImport(csv.buffer, options);
  assert.equal(result.issues.length, 0);
  assert.equal(result.rows[0].symbol, '000001');
});

test('formulas with stale cached values are rejected', () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['代码', '数量', '价格'], ['000001', 100, 11]]);
  sheet.B2.f = '50+50';
  XLSX.utils.book_append_sheet(book, sheet, '持仓');
  const result = parseHoldingImport(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, options);
  assert.equal(result.issues[0].code, 'invalid_shares');
});

test('an Excel date cell cannot silently become a large stock quantity', () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['代码', '数量', '价格'], ['000001', new Date('2026-10-05T00:00:00Z'), 11]]);
  XLSX.utils.book_append_sheet(book, sheet, '持仓');
  const result = parseHoldingImport(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, options);
  assert.equal(result.issues[0].code, 'invalid_shares');
  assert.deepEqual(result.rows, []);
});

const templateOptions: HoldingImportTemplateOptions = {
  accountName: 'a股练手', currency: 'CNY', rows: [{ name: '平安银行', symbol: '000001', market: 'A股', shares: 100, price: 11, costPrice: 10 }],
  labels: {
    sheetName: '持仓', instructionsSheetName: '说明', accountLabel: '当前资产', currencyLabel: '币种',
    headers: { symbol: '证券代码', name: '证券名称', market: '市场', shares: '持仓股数', price: '最新价', costPrice: '平均买入成本', currency: '币种' },
    instructions: ['只更新当前资产。成本应为平均买入成本。'],
  },
};

test('prefilled template roundtrips current positions and contains account context without example rows', () => {
  const bytes = exportHoldingImportTemplate(templateOptions);
  assert.deepEqual(parseHoldingImport(bytes, options), { rows: templateOptions.rows, issues: [] });
  const book = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['说明'], { header: 1 })[0], ['当前资产', 'a股练手']);
  const empty = parseHoldingImport(exportHoldingImportTemplate({ ...templateOptions, rows: [] }), options);
  assert.equal(empty.issues[0].code, 'empty_sheet');
});

test('English template instructions and headers roundtrip without any language-specific parser branch', () => {
  const english: HoldingImportTemplateOptions = {
    accountName: 'US shares', currency: 'USD', rows: [{ name: 'Apple', symbol: 'AAPL', market: '美股', shares: 1.25, price: 240, costPrice: 200 }],
    labels: {
      sheetName: 'Positions', instructionsSheetName: 'Instructions', accountLabel: 'Account', currencyLabel: 'Currency',
      headers: { symbol: 'Symbol', name: 'Name', market: 'Market', shares: 'Shares', price: 'Current price', costPrice: 'Average cost', currency: 'Currency' },
      instructions: ['Updates only this account.'],
    },
  };
  assert.deepEqual(parseHoldingImport(exportHoldingImportTemplate(english), { currency: 'USD' }), { rows: english.rows, issues: [] });
});
