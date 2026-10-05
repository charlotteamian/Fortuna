import * as XLSX from 'xlsx';
import { normalizeHoldingIdentity } from './holdingImportIdentity.ts';

/** A quote and position snapshot in the active account's currency. */
export interface HoldingImportRow {
  name: string;
  symbol: string;
  market?: string;
  shares: number;
  price: number;
  costPrice?: number;
}

export type HoldingImportField = keyof HoldingImportRow | 'currency';
export type HoldingImportIssueCode =
  | 'unreadable_file' | 'backup_workbook' | 'no_holdings_sheet' | 'ambiguous_sheets'
  | 'missing_columns' | 'duplicate_columns' | 'empty_sheet' | 'missing_symbol'
  | 'invalid_symbol' | 'invalid_market' | 'invalid_shares' | 'invalid_price'
  | 'invalid_cost_price' | 'currency_mismatch' | 'duplicate_symbol' | 'too_many_rows';

export interface HoldingImportIssue {
  code: HoldingImportIssueCode;
  /** One-based workbook row; zero for an error applying to the whole file. */
  line: number;
  sheet?: string;
  field?: HoldingImportField;
}

export interface HoldingImportResult {
  rows: HoldingImportRow[];
  issues: HoldingImportIssue[];
}

const HEADER_ALIASES: Record<HoldingImportField, string[]> = {
  symbol: ['证券代码', '股票代码', '代码', '证券代号', '股票代号', 'symbol', 'ticker', 'stockcode', 'securitycode', 'code'],
  name: ['证券名称', '股票名称', '名称', '证券简称', '股票简称', 'name', 'stockname', 'securityname', 'description'],
  market: ['市场', '证券市场', '交易市场', '交易所', 'market', 'exchange'],
  shares: ['股票余额', '证券数量', '持仓数量', '持仓股数', '数量', '股数', '持股数', '持股数量', '股份余额', '证券余额', '持有数量', '总股数', 'shares', 'qty', 'quantity', 'holdingquantity', 'positionquantity', 'position', 'holdings', 'heldshares', 'numberofshares', 'no.ofshares', 'totalquantity', 'totalshares', 'stockbalance'],
  price: ['最新价', '当前价', '市价', '现价', '价格', '最新价格', '当前价格', 'price', 'lastprice', 'currentprice', 'marketprice', 'latestprice'],
  costPrice: ['平均买入成本', '平均成本价', '平均成本', '买入均价', '成本价', '持仓成本价', 'costprice', 'averagecost', 'averagecostprice', 'averageprice', 'avgprice', 'avgcost', 'avgcostprice', 'purchaseprice'],
  currency: ['币种', '货币', '币别', 'currency'],
};

function normaliseHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]/g, '')
    .replace(/[（(](?:股|份|元|shares?|units?|cny|hkd|usd)[）)]/gi, '');
}

const HEADER_FIELDS = new Map<string, HoldingImportField>(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map(alias => [normaliseHeader(alias), field as HoldingImportField])),
);

function normaliseCurrency(value: string): string {
  const code = value.trim().toUpperCase().replace(/\s/g, '');
  if (['人民币', 'RMB', 'CN¥', '¥', '￥'].includes(code)) return 'CNY';
  if (['港币', '港元', 'HK$', 'HK＄'].includes(code)) return 'HKD';
  if (['美元', 'US$', 'US＄'].includes(code)) return 'USD';
  return code;
}

function cellValue(sheet: XLSX.WorkSheet, row: number, column?: number): unknown {
  if (column === undefined) return undefined;
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
  if (!cell) return undefined;
  // A cached formula result may be out of date. Requiring a plain cell keeps preview faithful.
  if (cell.f || cell.t === 'e' || cell.t === 'b') return { invalid: true };
  return cell.v;
}

function symbolValue(sheet: XLSX.WorkSheet, row: number, column: number): string {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
  const value = cellValue(sheet, row, column);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    // Broker sheets often store codes as numbers with a 000000 display format.
    if (cell?.w && /^\d+$/.test(cell.w.trim())) return cell.w.trim();
    return String(value);
  }
  return value == null ? '' : '[invalid]';
}

/** Parse the entire numeric cell; never accept a truncated value such as 100 shares / 10.5元. */
function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!/^[+]?(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\.\d+)$/.test(text)) return undefined;
  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER ? parsed : undefined;
}

const REQUIRED_FIELDS: HoldingImportField[] = ['symbol', 'shares', 'price'];
type Header = { row: number; columns: Partial<Record<HoldingImportField, number>>; duplicates: HoldingImportField[]; sheet: string };

function findHeader(sheet: XLSX.WorkSheet, name: string): Header | undefined {
  if (!sheet['!ref']) return undefined;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 19); row++) {
    const columns: Header['columns'] = {};
    const duplicates: HoldingImportField[] = [];
    for (let column = range.s.c; column <= range.e.c; column++) {
      const field = HEADER_FIELDS.get(normaliseHeader(cellValue(sheet, row, column)));
      if (!field) continue;
      if (columns[field] !== undefined) duplicates.push(field);
      else columns[field] = column;
    }
    // A stock code alone also occurs in unrelated data. Require another position field.
    if (columns.symbol !== undefined && (columns.shares !== undefined || columns.price !== undefined || columns.costPrice !== undefined)) {
      return { row, columns, duplicates, sheet: name };
    }
  }
  return undefined;
}

/** Read xlsx/xls/CSV locally. Any invalid row blocks the entire batch, so no partial write occurs. */
export function parseHoldingImport(
  data: ArrayBuffer,
  options: { currency: string; defaultMarket?: string },
): HoldingImportResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array', raw: true, cellDates: true, cellNF: true, cellText: true });
  } catch {
    return { rows: [], issues: [{ code: 'unreadable_file', line: 0 }] };
  }
  const names = new Set(workbook.SheetNames.map(name => name.toLowerCase()));
  if (names.has('backupinfo') || names.has('holdingtxns') || (names.has('accounts') && names.has('records'))) {
    return { rows: [], issues: [{ code: 'backup_workbook', line: 0 }] };
  }
  const headers = workbook.SheetNames.map(name => findHeader(workbook.Sheets[name], name)).filter((header): header is Header => !!header);
  const complete = headers.filter(header => REQUIRED_FIELDS.every(field => header.columns[field] !== undefined));
  if (complete.length > 1) return { rows: [], issues: [{ code: 'ambiguous_sheets', line: 0 }] };
  const header = complete[0] ?? headers[0];
  if (!header) return { rows: [], issues: [{ code: 'no_holdings_sheet', line: 0 }] };
  const issues: HoldingImportIssue[] = [];
  const issue = (code: HoldingImportIssueCode, line: number, field?: HoldingImportField) => issues.push({ code, line, sheet: header.sheet, ...(field ? { field } : {}) });
  for (const field of REQUIRED_FIELDS) if (header.columns[field] === undefined) issue('missing_columns', header.row + 1, field);
  for (const field of header.duplicates) issue('duplicate_columns', header.row + 1, field);
  if (issues.length) return { rows: [], issues };
  const sheet = workbook.Sheets[header.sheet];
  const range = XLSX.utils.decode_range(sheet['!ref']!);
  if (range.e.r - header.row > 5000) return { rows: [], issues: [{ code: 'too_many_rows', line: 0, sheet: header.sheet }] };
  const rows: HoldingImportRow[] = [];
  const identities = new Set<string>();
  for (let row = header.row + 1; row <= range.e.r; row++) {
    const values = Object.fromEntries(Object.entries(header.columns).map(([field, column]) => [field, cellValue(sheet, row, column)])) as Partial<Record<HoldingImportField, unknown>>;
    if (Object.values(values).every(value => value == null || value === '')) continue;
    const line = row + 1;
    const rawSymbol = symbolValue(sheet, row, header.columns.symbol!);
    const rawMarket = typeof values.market === 'string' ? values.market.trim() : values.market == null ? '' : '[invalid]';
    let identity: ReturnType<typeof normalizeHoldingIdentity> | undefined;
    let identityError = 'invalid_symbol' as HoldingImportIssueCode;
    try {
      identity = normalizeHoldingIdentity(rawSymbol, rawMarket || (/^\d{1,5}$/.test(rawSymbol) ? options.defaultMarket : undefined), options.currency);
    } catch (error) {
      if (error instanceof Error && error.message === 'HOLDING_POSITION_MARKET_INVALID') identityError = 'invalid_market';
    }
    const issueCount = issues.length;
    if (!rawSymbol) issue('missing_symbol', line, 'symbol');
    else if (!identity) issue(identityError, line, identityError === 'invalid_market' ? 'market' : 'symbol');
    const shares = parseNumber(values.shares);
    const price = parseNumber(values.price);
    const costMissing = values.costPrice == null || values.costPrice === '' || (typeof values.costPrice === 'string' && values.costPrice.trim() === '');
    const costPrice = costMissing ? undefined : parseNumber(values.costPrice);
    if (shares === undefined || shares < 0) issue('invalid_shares', line, 'shares');
    if (price === undefined || price <= 0) issue('invalid_price', line, 'price');
    if (!costMissing && (costPrice === undefined || costPrice < 0)) issue('invalid_cost_price', line, 'costPrice');
    if (values.currency != null && String(values.currency).trim() !== '' && normaliseCurrency(String(values.currency)) !== normaliseCurrency(options.currency)) issue('currency_mismatch', line, 'currency');
    if (identity) {
      const key = `${identity.market}:${identity.symbol}`;
      if (identities.has(key)) issue('duplicate_symbol', line, 'symbol');
      identities.add(key);
    }
    if (issues.length !== issueCount || !identity || shares === undefined || price === undefined) continue;
    rows.push({ name: typeof values.name === 'string' ? values.name.trim() : '', symbol: identity.symbol, market: identity.market, shares, price, ...(costPrice === undefined ? {} : { costPrice }) });
  }
  if (!issues.length && !rows.length) issue('empty_sheet', header.row + 1);
  return { rows: issues.length ? [] : rows, issues };
}

/** Workbook copy is passed from i18next by the UI; the template includes no example holdings. */
export interface HoldingImportTemplateOptions {
  accountName: string;
  currency: string;
  rows: HoldingImportRow[];
  labels: {
    sheetName: string;
    instructionsSheetName: string;
    accountLabel: string;
    currencyLabel: string;
    headers: Record<HoldingImportField, string>;
    instructions: string[];
  };
}

export function exportHoldingImportTemplate(options: HoldingImportTemplateOptions): ArrayBuffer {
  const fields: HoldingImportField[] = ['symbol', 'name', 'market', 'shares', 'price', 'costPrice', 'currency'];
  const sheet = XLSX.utils.aoa_to_sheet([
    fields.map(field => options.labels.headers[field]),
    ...options.rows.map(row => fields.map(field => field === 'currency' ? options.currency : row[field] ?? '')),
  ]);
  sheet['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 12 }];
  const instructions = XLSX.utils.aoa_to_sheet([
    [options.labels.accountLabel, options.accountName],
    [options.labels.currencyLabel, options.currency],
    ...options.labels.instructions.map(instruction => [instruction]),
  ]);
  instructions['!cols'] = [{ wch: 110 }, { wch: 26 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, options.labels.sheetName);
  XLSX.utils.book_append_sheet(workbook, instructions, options.labels.instructionsSheetName);
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
}
