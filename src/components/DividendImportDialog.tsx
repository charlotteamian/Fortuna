import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { parseDividendImport, type DividendImportResult } from '../lib/dividendImport';
import { stockBudgetMinor, type DividendStock } from '../lib/dividendWorkbench';
import { importDividendStocks } from '../services/dividendService';

const numeric = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function DividendImportDialog({ stocks, budgetMinor, amountVisible, onClose, onSaved }: {
  stocks: DividendStock[]; budgetMinor: number; amountVisible: boolean;
  onClose: () => void; onSaved: (result: { added: number; updated: number }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<DividendImportResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const preview = (data: ArrayBuffer | string) => {
    const parsed = parseDividendImport(data);
    setResult(parsed); setSelected([]); setError('');
  };
  const readFile = async (file: File) => {
    setBusy(true); setResult(null); setSelected([]); setError('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('too_large');
      preview(await file.arrayBuffer());
    } catch (cause) { setError(t(cause instanceof Error && cause.message === 'too_large' ? 'div_import_too_large' : 'div_import_issue_unreadable_file')); }
    finally { setBusy(false); }
  };
  const saveTemplate = async () => {
    setBusy(true); setError('');
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([
        [t('div_import_header_code'), t('div_import_header_name'), t('div_import_header_weight'), t('div_group'), t('div_note')],
        ...stocks.map(stock => [stock.code, stock.name, stock.weightBps / 100, stock.group, stock.note ?? '']),
      ]);
      sheet['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(workbook, sheet, 'DividendStocks');
      const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const fileName = 'Fortuna-dividend-stocks.xlsx';
      if (Capacitor.isNativePlatform()) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
        let binary = '';
        for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
        const file = await Filesystem.writeFile({ path: fileName, data: btoa(binary), directory: Directory.Cache });
        await Share.share({ title: t('div_import_template'), url: file.uri });
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a');
        link.href = url; link.download = fileName; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { setError(t('export_failed')); }
    finally { setBusy(false); }
  };
  const rows = result?.rows ?? [];
  const selectedRows = rows.filter(row => selected.includes(row.code));
  const replacements = new Map(selectedRows.map(row => [row.code, row]));
  const finalWeight = stocks.reduce((sum, stock) => sum + (replacements.get(stock.code)?.weightBps ?? stock.weightBps), 0)
    + selectedRows.filter(row => !stocks.some(stock => stock.code === row.code)).reduce((sum, row) => sum + row.weightBps, 0);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || selectedRows.length === 0 || finalWeight > 10000) return;
    setBusy(true); setError('');
    try { await onSaved(await importDividendStocks(selectedRows)); }
    catch (cause) { setError(t(cause instanceof Error && cause.message === 'DIVIDEND_IMPORT_OVER_BUDGET' ? 'div_import_over_budget' : 'div_save_error')); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="div-dialog" aria-labelledby="div-import-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}><form onSubmit={e => void apply(e)}>
    <div className="div-stock-heading"><h2 id="div-import-title">{t('div_import')}</h2><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('close')}</button></div>
    <p className="div-muted">{t('div_import_note')}</p>
    <div className="div-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => fileInput.current?.click()}>{t('div_import_file')}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void saveTemplate()}>{t('div_import_template')}</button></div>
    <input ref={fileInput} hidden type="file" accept=".xlsx,.xls,.csv,.tsv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void readFile(file); }} />
    <label className="div-form-note div-import-paste">{t('div_import_paste')}<textarea rows={5} disabled={busy} placeholder={t('div_import_placeholder')} value={text} onChange={e => { setText(e.target.value); setResult(null); setSelected([]); }} /></label>
    <button type="button" className="btn btn-secondary" disabled={busy || !text.trim()} onClick={() => preview(text)}>{t('div_import_preview')}</button>
    {result && <>
      {result.issues.length > 0 && <div className="div-warning" role="alert"><p>{t('div_import_issues_note')}</p><ul>{result.issues.slice(0, 20).map((issue, i) => <li key={i}>{issue.line > 0 ? t('div_import_line', { line: issue.line }) + ' · ' : ''}{t(`div_import_issue_${issue.code}`)}{issue.field ? ` (${t(`div_import_field_${issue.field}`)})` : ''}</li>)}</ul>{result.issues.length > 20 && <p>{t('div_import_more_issues', { count: result.issues.length - 20 })}</p>}</div>}
      <p className="div-muted">{t('div_import_preview_note')}</p>
      <label className="div-linked-all"><input type="checkbox" checked={allSelected} disabled={busy || rows.length === 0} onChange={e => setSelected(e.target.checked ? rows.map(row => row.code) : [])} />{t('div_linked_select_all')}</label>
      <div className="div-linked-list">{rows.map(row => {
        const existing = stocks.find(stock => stock.code === row.code);
        return <label className="div-linked-option" key={row.code}><input type="checkbox" checked={selected.includes(row.code)} disabled={busy} onChange={e => setSelected(codes => e.target.checked ? [...codes, row.code] : codes.filter(code => code !== row.code))} /><span>
          <strong>{row.name} <small>{row.code} · {t(existing ? 'div_import_update' : 'div_import_new')}</small></strong>
          <small>{existing ? `${numeric(existing.weightBps / 100)}% → ` : ''}{numeric(row.weightBps / 100)}% · {amountVisible ? `¥${numeric(stockBudgetMinor(budgetMinor, row.weightBps) / 100)}` : '••••'} · {t(`div_group_${row.group ?? existing?.group ?? 'watch'}`)}</small>
          {row.note && <small>{row.note}</small>}
        </span></label>;
      })}</div>
      <p className={finalWeight > 10000 ? 'div-warning' : 'div-muted'}>{t('div_import_total', { percent: numeric(finalWeight / 100) })}</p>
      {finalWeight > 10000 && <p className="div-warning">{t('div_import_over_budget')}</p>}
    </>}
    {error && <p role="alert" className="div-warning">{error}</p>}
    <div className="div-actions"><button type="submit" className="btn btn-primary" disabled={busy || selectedRows.length === 0 || finalWeight > 10000}>{t(busy ? 'loading' : 'div_import_apply', { count: selectedRows.length })}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button></div>
  </form></dialog>;
}
