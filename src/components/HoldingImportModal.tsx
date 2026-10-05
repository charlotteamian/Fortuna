import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import type { Account } from '../db';
import { importHoldingScreenshot, type HoldingWithPosition } from '../services/holdingService';
import { parseHoldingImport, exportHoldingImportTemplate } from '../lib/holdingImport';
import { normalizeHoldingIdentity } from '../lib/holdingImportIdentity';
import {
  loadHoldingRecognitionConfig, recognizeHoldingScreenshot,
  type HoldingRecognitionConfig,
} from '../services/holdingRecognitionService';
import { formatLocalDate } from '../lib/localDate';
import {
  getHoldingRecognitionProvider, inferHoldingRecognitionProvider,
} from '../lib/holdingRecognitionProviders';
import './HoldingImportModal.css';

interface Props {
  account: Account;
  holdings: HoldingWithPosition[];
  onClose: () => void;
  onImported: () => Promise<void>;
  onOpenApiSettings: () => void;
  configRevision: number;
}
interface DraftRow {
  id: number;
  name: string;
  symbol: string;
  market: string;
  shares: string;
  price: string;
  costPrice: string;
}
interface DraftTrade {
  id: number;
  name: string;
  symbol: string;
  market: string;
  date: string;
  kind: string;
  shares: string;
  price: string;
  brokerRef?: string;
}

export default function HoldingImportModal({ account, holdings, onClose, onImported, onOpenApiSettings, configRevision }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [trades, setTrades] = useState<DraftTrade[]>([]);
  const [config, setConfig] = useState<HoldingRecognitionConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [date, setDate] = useState(formatLocalDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [source, setSource] = useState('');
  const defaultMarket = account.currency === 'HKD' ? '港股' : account.currency === 'USD' ? '美股' : 'A股';
  const regularHoldings = holdings.filter(h => !h.instrumentType && h.mode !== 'balance');
  const inferredMarket = (symbol: string, market: string) => {
    if (market) return market;
    try { return normalizeHoldingIdentity(symbol, undefined, account.currency).market; } catch { return ''; }
  };
  const rowIdentity = (symbol: string, market: string) => {
    try { return normalizeHoldingIdentity(symbol, market, account.currency).key; }
    catch { return market + ':' + symbol.trim().toUpperCase(); }
  };

  useEffect(() => {
    let active = true;
    void loadHoldingRecognitionConfig().then(saved => {
      if (active) setConfig(saved);
    }).catch(() => { if (active) setError(t('holding_import_config_failed')); })
      .finally(() => { if (active) setConfigLoading(false); });
    return () => { active = false; };
  }, [t, configRevision]);
  const recognitionError = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : '';
    const code = (cause as { code?: string })?.code || message;
    return t('holding_recognition_error_' + code.replace(/^HOLDING_RECOGNITION_/, '').toLowerCase(), { defaultValue: t('holding_import_api_failed') });
  };
  const findExisting = (row: DraftRow) => {
    try {
      const identity = normalizeHoldingIdentity(row.symbol, row.market, account.currency);
      return regularHoldings.filter(h => {
        try { return normalizeHoldingIdentity(h.symbol ?? '', h.market, account.currency).key === identity.key; }
        catch { return false; }
      });
    } catch { return []; }
  };
  const updateRow = (id: number, field: keyof Omit<DraftRow, 'id'>, value: string) => {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row));
    setError('');
  };
  const moveTrade = (index: number, delta: number) => {
    setTrades(current => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const addRows = (incoming: Omit<DraftRow, 'id'>[], append: boolean) => {
    const base = append ? [...rows] : [];
    const conflicts: string[] = [];
    for (const row of incoming) {
      // Keep a reviewed row when overlapping screenshots include it again.
      const duplicate = append && base.find(existing => existing.symbol && rowIdentity(existing.symbol, existing.market) === rowIdentity(row.symbol, row.market));
      if (duplicate && (['shares', 'price', 'costPrice'] as const).some(field => duplicate[field] !== row[field])) conflicts.push(row.symbol);
      if (!duplicate) base.push({ ...row, id: nextId.current++ });
    }
    setRows(base);
    return conflicts;
  };
  const readScreenshot = async (file: File) => {
    setBusy(true); setError('');
    try {
      const currentConfig = await loadHoldingRecognitionConfig();
      if (!currentConfig) throw new Error('HOLDING_RECOGNITION_CONFIG');
      setConfig(currentConfig);
      if (file.size > 10 * 1024 * 1024) throw new Error('HOLDING_RECOGNITION_TOO_LARGE');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('HOLDING_RECOGNITION_IMAGE');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('HOLDING_RECOGNITION_IMAGE'));
        reader.readAsDataURL(file);
      });
      const result = await recognizeHoldingScreenshot(currentConfig, { base64, mimeType: file.type }, { accountCurrency: account.currency });
      if (!result.rows.length && !result.trades.length) { setError(t('holding_import_no_candidates')); return; }
      const conflicts = addRows(result.rows.map(row => ({ ...row, market: inferredMarket(row.symbol, row.market) })), true);
      const incomingTrades = result.trades.map(trade => ({ ...trade, market: inferredMarket(trade.symbol, trade.market), id: nextId.current++ }));
      const overlappingTrades = incomingTrades.some(trade => trades.some(existing =>
        rowIdentity(existing.symbol, existing.market) === rowIdentity(trade.symbol, trade.market)
        && existing.date === trade.date && existing.kind === trade.kind && existing.shares === trade.shares && existing.price === trade.price));
      setTrades(current => [...current, ...incomingTrades]);
      setSource(file.name);
      setNotice([
        t('holding_import_ai_review'), ...result.warnings.map(warning => t(warning, { defaultValue: warning })),
        ...(conflicts.length ? [t('holding_import_overlap_conflict', { symbols: conflicts.join(', ') })] : []),
        ...(overlappingTrades ? [t('holding_import_overlap_trades')] : []),
      ].join('\n'));
    } catch (cause) {
      setError(recognitionError(cause));
    } finally { setBusy(false); }
  };
  const readExcel = async (file: File) => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > 10 * 1024 * 1024) { setError(t('import_file_too_large')); return; }
      const result = parseHoldingImport(await file.arrayBuffer(), { currency: account.currency, defaultMarket });
      if (result.issues.length) {
        setError(result.issues.map(issue => t('holding_import_file_issue', {
          line: issue.line || '—', message: t('holding_import_issue_' + issue.code),
        })).join('\n'));
        return;
      }
      addRows(result.rows.map(row => ({
        name: row.name, symbol: row.symbol, market: row.market || defaultMarket,
        shares: String(row.shares), price: String(row.price),
        costPrice: row.costPrice == null ? '' : String(row.costPrice),
      })), false);
      setTrades([]);
      setSource(file.name);
      setNotice(t('holding_import_excel_review'));
    } catch { setError(t('holding_import_issue_unreadable_file')); }
    finally { setBusy(false); }
  };
  const saveTemplate = async () => {
    setBusy(true); setError('');
    try {
      const bytes = exportHoldingImportTemplate({
        accountName: account.name, currency: account.currency,
        rows: regularHoldings.filter(h => h.position.shares > 0 && h.symbol).map(h => ({
          name: h.name, symbol: h.symbol!, market: h.market, shares: h.position.shares,
          price: h.lastPrice, costPrice: h.position.avgCost,
        })),
        labels: {
          sheetName: t('holding_import_sheet'), instructionsSheetName: t('holding_import_instructions_sheet'),
          accountLabel: t('xh_account'), currencyLabel: t('xh_currency'),
          headers: {
            symbol: t('holding_import_header_symbol'), name: t('holding_import_header_name'),
            market: t('holding_import_header_market'), shares: t('holding_import_header_shares'),
            price: t('holding_import_header_price'), costPrice: t('holding_import_header_cost'),
            currency: t('holding_import_header_currency'),
          },
          instructions: [t('holding_import_scope', { name: account.name }), t('holding_import_cost_hint'), t('holding_import_template_hint')],
        },
      });
      const fileName = 'Fortuna-holdings-' + formatLocalDate() + '.xlsx';
      if (Capacitor.isNativePlatform()) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import('@capacitor/filesystem'), import('@capacitor/share'),
        ]);
        const array = new Uint8Array(bytes);
        let binary = '';
        for (const byte of array) binary += String.fromCharCode(byte);
        const file = await Filesystem.writeFile({ path: fileName, data: btoa(binary), directory: Directory.Cache });
        await Share.share({ title: t('holding_import_template'), url: file.uri });
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a');
        link.href = url; link.download = fileName; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { setError(t('export_failed')); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setError('');
    try {
      const seen = new Set<string>();
      const parsed = rows.map((row, index) => {
        const identity = normalizeHoldingIdentity(row.symbol, row.market, account.currency);
        if (seen.has(identity.key)) throw new Error('HOLDING_POSITION_DUPLICATE');
        seen.add(identity.key);
        const matched = findExisting(row);
        const shares = row.shares.trim() === '' ? NaN : Number(row.shares);
        const price = row.price.trim() === '' ? NaN : Number(row.price);
        const costPrice = row.costPrice.trim() === '' ? undefined : Number(row.costPrice);
        if (!Number.isFinite(shares) || shares < 0 || !Number.isFinite(price) || price <= 0
          || (costPrice != null && (!Number.isFinite(costPrice) || costPrice < 0))) {
          throw new Error(t('holding_import_row_invalid', { row: index + 1 }));
        }
        if (!matched.length && (!row.name.trim() || (shares > 0 && costPrice == null))) {
          throw new Error(t('holding_import_new_required', { row: index + 1 }));
        }
        return { name: row.name.trim(), ...identity, shares, price, costPrice };
      });
      const parsedTrades = trades.map((trade, index) => {
        const identity = normalizeHoldingIdentity(trade.symbol, trade.market, account.currency);
        const shares = trade.shares.trim() === '' ? NaN : Number(trade.shares);
        const price = trade.price.trim() === '' ? NaN : Number(trade.price);
        if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0
          || !['buy', 'sell'].includes(trade.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(trade.date)) {
          throw new Error(t('holding_import_trade_invalid', { row: index + 1 }));
        }
        return { name: trade.name.trim(), ...identity, date: trade.date, kind: trade.kind as 'buy' | 'sell', shares, price, brokerRef: trade.brokerRef };
      });
      setBusy(true);
      await importHoldingScreenshot(account.id, { holdings: parsed, trades: parsedTrades }, date);
      await onImported();
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      const key = 'holding_import_error_' + message.replace(/^HOLDING_POSITION_/, '').toLowerCase();
      setError(message.startsWith('HOLDING_POSITION_') ? t(key, { defaultValue: t('holding_import_failed') }) : message || t('holding_import_failed'));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-content holding-import-modal" role="dialog" aria-modal="true" aria-labelledby="holding-import-title" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="holding-import-title">{t('holding_import_title')}</h2>
          <button className="modal-close" aria-label={t('cancel')} disabled={busy} onClick={onClose}>✕</button>
        </div>
        <p className="holding-import-note">{t('holding_import_scope', { name: account.name })}</p>
        <div className="holding-import-api-status">
          <p className="holding-import-note">{config
            ? t('holding_api_ready', { provider: t(getHoldingRecognitionProvider(inferHoldingRecognitionProvider(config)).nameKey), model: config.model })
            : t('holding_api_setup_first')}</p>
          <button className="btn btn-sm btn-secondary" disabled={busy || configLoading} onClick={onOpenApiSettings}>
            {t(config ? 'holding_api_edit_settings' : 'holding_api_open_settings')}
          </button>
        </div>
        <div className="holding-import-sources">
          <button className="btn btn-primary" disabled={busy || configLoading || !config} onClick={() => screenshotRef.current?.click()}>
            {t(busy ? 'holding_import_reading' : rows.length || trades.length ? 'holding_import_add_screenshot' : 'holding_import_screenshot')}
          </button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>{t('holding_import_excel')}</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => void saveTemplate()}>{t('holding_import_template')}</button>
          <input hidden ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) void readExcel(file);
          }} />
          <input hidden ref={screenshotRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) void readScreenshot(file);
          }} />
        </div>
        <p className="holding-import-note">{t('holding_import_api_upload_note')}</p>
        {notice && <p className="holding-import-note" role="status">{notice}</p>}
        {source && <p className="holding-import-note">{source} · {t('holding_import_count', { count: rows.length })} · {t('holding_import_trade_count', { count: trades.length })}</p>}
        {error && <p className="holding-import-error" role="alert">{error}</p>}
        {(rows.length > 0 || trades.length > 0) && <>
          <div className="form-group">
            <label className="form-label" htmlFor="holding-import-date">{t('holding_import_date')}</label>
            <input id="holding-import-date" className="form-input" type="date" max={formatLocalDate()} value={date} disabled={busy} onChange={event => setDate(event.target.value)} />
          </div>
          <p className="holding-import-note">{t('holding_import_cost_hint')}</p>
          {rows.length > 0 && <h3 className="holding-import-section-title">{t('holding_import_holdings_preview')}</h3>}
          {rows.map((row, index) => {
            const existing = findExisting(row);
            return <fieldset className="holding-import-row" key={row.id} disabled={busy}>
              <legend>{index + 1} · {t(existing.length === 1 ? 'holding_import_update' : 'holding_import_new')}</legend>
              <div className="holding-import-grid">
                {(['name', 'symbol'] as const).map(field => <label className="form-label" key={field}>
                  {t('holding_import_header_' + field)}
                  <input className="form-input" value={row[field]} onChange={event => updateRow(row.id, field, event.target.value)} />
                </label>)}
                <label className="form-label">{t('holding_import_header_market')}
                  <select className="form-select" value={row.market} onChange={event => updateRow(row.id, 'market', event.target.value)}>
                    <option value="">{t('holding_import_select_market')}</option>
                    <option value="A股">{t('opt_a_share')}</option><option value="港股">{t('opt_hk_market')}</option><option value="美股">{t('opt_us_market')}</option>
                  </select>
                </label>
                {(['shares', 'price', 'costPrice'] as const).map(field => <label className="form-label" key={field}>
                  {t(field === 'costPrice' ? 'holding_import_header_cost' : 'holding_import_header_' + field)}{field !== 'shares' ? ' (' + account.currency + ')' : ''}
                  <input className="form-input" type="number" inputMode="decimal" min="0" step="any" value={row[field]}
                    placeholder={field === 'costPrice' && existing.length === 1 ? String(existing[0].position.avgCost) : ''}
                    onChange={event => updateRow(row.id, field, event.target.value)} />
                </label>)}
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => setRows(current => current.filter(candidate => candidate.id !== row.id))}>{t('holding_import_remove_row')}</button>
            </fieldset>;
          })}
          {trades.length > 0 && <>
            <h3 className="holding-import-section-title">{t('holding_import_trades_preview')}</h3>
            <p className="holding-import-note">{t('holding_import_trade_hint')}</p>
            {trades.map((trade, index) => <fieldset className="holding-import-row" key={trade.id} disabled={busy}>
              <legend>{index + 1} · {trade.name || trade.symbol}</legend>
              <div className="holding-import-grid">
                {(['name', 'symbol'] as const).map(field => <label className="form-label" key={field}>
                  {t('holding_import_header_' + field)}
                  <input className="form-input" value={trade[field]} onChange={event => setTrades(current => current.map(row => row.id === trade.id ? { ...row, [field]: event.target.value } : row))} />
                </label>)}
                <label className="form-label">{t('holding_import_header_market')}
                  <select className="form-select" value={trade.market} onChange={event => setTrades(current => current.map(row => row.id === trade.id ? { ...row, market: event.target.value } : row))}>
                    <option value="">{t('holding_import_select_market')}</option>
                    <option value="A股">{t('opt_a_share')}</option><option value="港股">{t('opt_hk_market')}</option><option value="美股">{t('opt_us_market')}</option>
                  </select>
                </label>
                <label className="form-label">{t('holding_import_trade_direction')}
                  <select className="form-select" value={trade.kind} onChange={event => setTrades(current => current.map(row => row.id === trade.id ? { ...row, kind: event.target.value } : row))}>
                    <option value="">{t('holding_import_select_direction')}</option><option value="buy">{t('buy_in')}</option><option value="sell">{t('sell_out')}</option>
                  </select>
                </label>
                <label className="form-label">{t('xh_date')}
                  <input className="form-input" type="date" max={formatLocalDate()} value={trade.date}
                    onChange={event => setTrades(current => current.map(row => row.id === trade.id ? { ...row, date: event.target.value } : row))} />
                </label>
                {(['shares', 'price'] as const).map(field => <label className="form-label" key={field}>
                  {t(field === 'price' ? 'holding_import_trade_price' : 'holding_import_header_shares')}
                  <input className="form-input" type="number" min="0" step="any" inputMode="decimal" value={trade[field]}
                    onChange={event => setTrades(current => current.map(row => row.id === trade.id ? { ...row, [field]: event.target.value } : row))} />
                </label>)}
                {trade.brokerRef !== undefined && <label className="form-label">{t('holding_import_trade_reference')}
                  <input className="form-input" value={trade.brokerRef}
                    onChange={event => setTrades(current => current.map(row => row.id === trade.id ? { ...row, brokerRef: event.target.value || undefined } : row))} />
                </label>}
              </div>
              <div className="holding-import-sources">
                <button className="btn btn-sm btn-secondary" disabled={index === 0} onClick={() => moveTrade(index, -1)}>{t('holding_import_trade_up')}</button>
                <button className="btn btn-sm btn-secondary" disabled={index === trades.length - 1} onClick={() => moveTrade(index, 1)}>{t('holding_import_trade_down')}</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setTrades(current => current.filter(row => row.id !== trade.id))}>{t('holding_import_remove_row')}</button>
              </div>
            </fieldset>)}
          </>}
        </>}
        <div className="modal-actions">
          <button className="btn btn-secondary btn-block" disabled={busy} onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary btn-block" disabled={busy || (!rows.length && !trades.length)} onClick={() => void apply()}>{t(busy ? 'importing' : 'holding_import_apply')}</button>
        </div>
      </div>
    </div>
  );
}
