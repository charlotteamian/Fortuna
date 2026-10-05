import * as XLSX from 'xlsx';
import { mainlandCode, type DividendStock } from './dividendWorkbench.ts';

export interface DividendImportRow {
  /** One-based workbook row. */
  line: number;
  code: string;
  name: string;
  weightBps: number;
  group?: DividendStock['group'];
  note?: string;
}

export type DividendImportField = 'code' | 'name' | 'weightBps' | 'group' | 'note';
export type DividendImportIssueCode =
  | 'unreadable_file' | 'backup_workbook' | 'no_dividend_sheet' | 'ambiguous_sheets'
  | 'missing_columns' | 'duplicate_columns' | 'empty_sheet' | 'too_many_rows'
  | 'formula_cell' | 'missing_code' | 'invalid_code' | 'invalid_name'
  | 'invalid_weight' | 'invalid_group' | 'invalid_note' | 'duplicate_code';

export interface DividendImportIssue {
  code: DividendImportIssueCode;
  /** Zero means the issue applies to the whole file. */
  line: number;
  sheet?: string;
  field?: DividendImportField;
}

export interface DividendImportResult {
  /** Only valid, unambiguous rows; callers may select a subset before saving. */
  rows: DividendImportRow[];
  issues: DividendImportIssue[];
}

const HEADER_ALIASES: Record<DividendImportField, string[]> = {
  code: ['股票代码', '证券代码', '代码', '股票代号', '证券代号', 'code', 'symbol', 'ticker', 'stockcode', 'securitycode'],
  name: ['股票名称', '证券名称', '名称', '股票简称', '证券简称', 'name', 'stockname', 'securityname'],
  weightBps: ['计划占比', '计划比例', '分配比例', '资金占比', '占比', '权重', '计划权重', 'weight', 'weightpercent', 'planweight', 'allocation', 'allocationpercent', 'plannedweight', 'plannedallocation', 'targetpercent', 'plannedpercent'],
  group: ['分组', '组别', 'group'],
  note: ['备注', '我的备注', '说明', 'note', 'notes', 'mynotes'],
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]/g, '').replace(/[（(](?:%|％|百分比|percent)[）)]/g, '').replace(/[%％]$/, '');
}

const HEADER_FIELDS = new Map<string, DividendImportField>(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map(alias => [normalizeHeader(alias), field as DividendImportField])),
);
const REQUIRED_FIELDS: DividendImportField[] = ['code', 'name', 'weightBps'];
const MAX_ROWS = 5000;
type Header = { row: number; columns: Partial<Record<DividendImportField, number>>; duplicates: DividendImportField[]; sheet: string };

function cellAt(sheet: XLSX.WorkSheet, row: number, column: number): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
}

function findHeader(sheet: XLSX.WorkSheet, name: string): Header | undefined {
  if (!sheet['!ref']) return undefined;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 19); row++) {
    const columns: Header['columns'] = {};
    const duplicates: DividendImportField[] = [];
    // Import columns are at the start of an ordinary stock list. Avoid scanning
    // a malformed workbook's million-cell range just to find its header.
    for (let column = range.s.c; column <= Math.min(range.e.c, range.s.c + 199); column++) {
      const cell = cellAt(sheet, row, column);
      if (cell?.f || cell?.t !== 's') continue;
      const field = HEADER_FIELDS.get(normalizeHeader(cell.v));
      if (!field) continue;
      if (columns[field] !== undefined) duplicates.push(field);
      else columns[field] = column;
    }
    if (columns.code !== undefined && (columns.name !== undefined || columns.weightBps !== undefined)) return { row, columns, duplicates, sheet: name };
  }
  return undefined;
}

function stockCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 999999) return mainlandCode(String(value).padStart(6, '0'));
  return typeof value === 'string' ? mainlandCode(value.trim()) : null;
}

/** Spreadsheet percent cells store fractions; ordinary cells store percent points. */
function weightBps(cell: XLSX.CellObject | undefined): number | undefined {
  const value = cell?.v;
  let percentage: number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    // Ignore quoted/escaped literal percent signs in custom number formats.
    const numberFormat = String(cell?.z ?? '').replace(/"[^"]*"|\\./g, '');
    percentage = value * (numberFormat.includes('%') ? 100 : 1);
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!/^\+?(?:\d+(?:\.\d+)?|\.\d+)\s*[%％]?$/.test(text)) return undefined;
    const numericText = text.replace(/[%％]/g, '').trim();
    const decimals = numericText.split('.')[1] ?? '';
    if (/[1-9]/.test(decimals.slice(2))) return undefined;
    percentage = Number(numericText);
  } else return undefined;
  const bps = percentage * 100;
  const rounded = Math.round(bps);
  // Reject fractions of a basis point while tolerating binary floating noise.
  return percentage >= 0 && percentage <= 100 && Math.abs(bps - rounded) < 1e-7 ? rounded : undefined;
}

function stockGroup(value: unknown): DividendStock['group'] | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['core', '核心', '核心股', '核心股票'].includes(normalized)) return 'core';
  if (['watch', '观察', '观察股', '观察股票', '关注', '关注股'].includes(normalized)) return 'watch';
  if (['hidden', '隐藏', '隐藏股', '隐藏股票'].includes(normalized)) return 'hidden';
  return undefined;
}

function isEmpty(value: unknown): boolean { return value == null || (typeof value === 'string' && value.trim() === ''); }

/** Parse xlsx/xls/CSV or pasted TSV/CSV locally, without accepting cached formulas. */
export function parseDividendImport(data: ArrayBuffer | string): DividendImportResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: typeof data === 'string' ? 'string' : 'array', raw: true, cellDates: true, cellNF: true, cellText: true, codepage: 65001 });
  } catch {
    return { rows: [], issues: [{ code: 'unreadable_file', line: 0 }] };
  }
  const names = new Set(workbook.SheetNames.map(name => name.toLowerCase()));
  if (names.has('backupinfo') || names.has('holdingtxns') || (names.has('accounts') && names.has('records'))) return { rows: [], issues: [{ code: 'backup_workbook', line: 0 }] };
  const headers = workbook.SheetNames.map(name => findHeader(workbook.Sheets[name], name)).filter((header): header is Header => !!header);
  const complete = headers.filter(header => REQUIRED_FIELDS.every(field => header.columns[field] !== undefined));
  if (complete.length > 1) return { rows: [], issues: [{ code: 'ambiguous_sheets', line: 0 }] };
  const header = complete[0] ?? headers[0];
  if (!header) return { rows: [], issues: [{ code: 'no_dividend_sheet', line: 0 }] };
  const issues: DividendImportIssue[] = [];
  const issue = (code: DividendImportIssueCode, line: number, field?: DividendImportField) => issues.push({ code, line, sheet: header.sheet, ...(field ? { field } : {}) });
  for (const field of REQUIRED_FIELDS) if (header.columns[field] === undefined) issue('missing_columns', header.row + 1, field);
  for (const field of header.duplicates) issue('duplicate_columns', header.row + 1, field);
  if (issues.length) return { rows: [], issues };
  const sheet = workbook.Sheets[header.sheet];
  const range = XLSX.utils.decode_range(sheet['!ref']!);
  if (range.e.r - header.row > MAX_ROWS) return { rows: [], issues: [{ code: 'too_many_rows', line: 0, sheet: header.sheet }] };
  const rows: DividendImportRow[] = [];
  const firstLines = new Map<string, number>();
  const duplicateCodes = new Set<string>();
  for (let row = header.row + 1; row <= range.e.r; row++) {
    const cells = Object.fromEntries(Object.entries(header.columns).map(([field, column]) => [field, cellAt(sheet, row, column)])) as Partial<Record<DividendImportField, XLSX.CellObject>>;
    if (Object.values(cells).every(cell => !cell?.f && isEmpty(cell?.v))) continue;
    const line = row + 1;
    const issueCount = issues.length;
    let unsafe = false;
    for (const [field, cell] of Object.entries(cells)) {
      if (cell?.f !== undefined || ((field === 'code' || field === 'weightBps') && typeof cell?.v === 'string' && cell.v.trim().startsWith('='))) {
        issue('formula_cell', line, field as DividendImportField);
        unsafe = true;
      }
    }
    if (unsafe) continue;
    const code = stockCode(cells.code?.v);
    if (isEmpty(cells.code?.v)) issue('missing_code', line, 'code');
    else if (!code) issue('invalid_code', line, 'code');
    const name = typeof cells.name?.v === 'string' ? cells.name.v.trim() : '';
    if (!name || name.length > 80 || cells.name?.t === 'e' || cells.name?.t === 'b') issue('invalid_name', line, 'name');
    const allocation = weightBps(cells.weightBps);
    if (allocation === undefined || cells.weightBps?.t === 'e' || cells.weightBps?.t === 'b') issue('invalid_weight', line, 'weightBps');
    const group = isEmpty(cells.group?.v) ? undefined : stockGroup(cells.group?.v);
    if (!isEmpty(cells.group?.v) && !group) issue('invalid_group', line, 'group');
    const note = isEmpty(cells.note?.v) ? undefined : typeof cells.note?.v === 'string' && cells.note.t !== 'e' && cells.note.t !== 'b' ? cells.note.v.trim() : undefined;
    if (!isEmpty(cells.note?.v) && (note === undefined || note.length > 2000)) issue('invalid_note', line, 'note');
    if (code) {
      const firstLine = firstLines.get(code);
      if (firstLine !== undefined) {
        if (!duplicateCodes.has(code)) issue('duplicate_code', firstLine, 'code');
        issue('duplicate_code', line, 'code');
        duplicateCodes.add(code);
      } else firstLines.set(code, line);
    }
    if (issues.length !== issueCount || !code || allocation === undefined) continue;
    rows.push({ line, code, name, weightBps: allocation, ...(group ? { group } : {}), ...(note === undefined ? {} : { note }) });
  }
  if (!issues.length && !rows.length) issue('empty_sheet', header.row + 1);
  return { rows: rows.filter(row => !duplicateCodes.has(row.code)), issues };
}
