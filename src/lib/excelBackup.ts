export type ExcelBackupFailureCode = 'file_read_failed' | 'unreadable_workbook' | 'not_backup' | 'unsupported_version' | 'invalid_data' | 'restore_failed';

export type ExcelBackupValidationReason = 'missing_value' | 'invalid_number' | 'invalid_date' | 'invalid_kind' | 'duplicate_id' | 'missing_account' | 'missing_holding' | 'holding_account_mismatch' | 'requires_quantity_snapshot';

export interface ExcelBackupFailure {
  code: ExcelBackupFailureCode;
  sheet?: string;
  row?: number;
  field?: string;
  reason?: ExcelBackupValidationReason;
  detail?: string;
}

/** Accept complete Excel text numbers without turning blank or malformed cells into zero. */
export function normalizeExcelBackupNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\d{1,3}(?:,\d{3})+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return value;
  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : value;
}

export function describeExcelBackupError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return `${error.name}: ${error.message}`.slice(0, 500);
}

/** Read bytes directly, independent of a document provider's MIME/data-URL encoding. */
export async function readExcelBackupFile(file: Blob): Promise<ArrayBuffer> {
  const bytes = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new Error('BACKUP_FILE_READ_FAILED'));
      reader.onerror = () => reject(reader.error ?? new Error('BACKUP_FILE_READ_FAILED'));
      reader.onabort = () => reject(new Error('BACKUP_FILE_READ_ABORTED'));
      reader.readAsArrayBuffer(file);
    });
  if (bytes.byteLength === 0 || bytes.byteLength !== file.size) throw new Error('BACKUP_FILE_INCOMPLETE');
  return bytes;
}
