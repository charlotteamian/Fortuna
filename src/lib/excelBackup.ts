export type ExcelBackupFailureCode = 'file_read_failed' | 'unreadable_workbook' | 'not_backup' | 'unsupported_version' | 'invalid_data' | 'restore_failed';

export interface ExcelBackupFailure {
  code: ExcelBackupFailureCode;
  sheet?: string;
  detail?: string;
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
