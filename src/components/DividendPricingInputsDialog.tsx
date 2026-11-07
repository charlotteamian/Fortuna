import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendPricingResult } from '../lib/dividendPricing';
import type { DividendResearchSnapshot } from '../lib/dividendResearch';
import { dividendAutomaticSignature, dividendManualCandidates, validManualDate, type DividendManualInputs } from '../lib/dividendManualInputs';
import { saveDividendManualInputs } from '../services/dividendManualInputsService';
import { dateInChina } from '../lib/dividendWorkbench';

type Draft = Record<'reportDate' | 'announcementDate' | 'recordDate' | 'exDate' | 'cash' | 'bonus' | 'transfer' | 'sourceUrl', string>;
const fields = ['reportDate', 'announcementDate', 'recordDate', 'exDate', 'cash', 'bonus', 'transfer', 'sourceUrl'] as const;
export default function DividendPricingInputsDialog({ code, pricing, onClose, onSaved }: {
  code: string; pricing: DividendPricingResult; onClose: () => void; onSaved: (value: DividendResearchSnapshot) => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const candidates = dividendManualCandidates(pricing);
  const [frequency, setFrequency] = useState<'annual' | 'semiannual'>(pricing.dividendBase?.frequency === 'semiannual' || candidates.some(row => row.period === 'interim') ? 'semiannual' : 'annual');
  const [drafts, setDrafts] = useState<Draft[]>(() => [0, 1].map(index => {
    const row = candidates[index], source = row?.sources.find(item => item.provider !== 'eastmoney')?.url;
    return { reportDate: row?.reportDate ?? '', announcementDate: row?.announcementDate ?? '', recordDate: row?.recordDate ?? '', exDate: row?.exDate ?? '',
      cash: row?.cashPer10Micros === undefined ? '' : String(row.cashPer10Micros / 1e6), bonus: row?.bonusPer10Bps === undefined ? '' : String(row.bonusPer10Bps / 1000),
      transfer: row?.transferPer10Bps === undefined ? '' : String(row.transferPer10Bps / 1000), sourceUrl: source ?? '' };
  }));
  const ledger = pricing.ledger ?? pricing.userConfirmedEvidence?.automaticLedger;
  const [shareActions, setShareActions] = useState(() => (ledger?.events ?? []).filter(event => event?.implemented && event.exDate
    && event.shareFactor !== 1).map(event => ({ sourceExDate: event.exDate!, exDate: event.exDate!, bonus: event.bonusPer10Bps === undefined ? '' : String(event.bonusPer10Bps / 1000),
      transfer: event.transferPer10Bps === undefined ? '' : String(event.transferPer10Bps / 1000), sourceUrl: event.sources.find(source => source.provider !== 'eastmoney')?.url ?? '' })));
  const selectedCashDates = drafts.slice(0, frequency === 'semiannual' ? 2 : 1).map(draft => draft.exDate).filter(validManualDate);
  const earliestCash = [...selectedCashDates].sort()[0];
  const requiredShareActions = shareActions.map((action, index) => ({ action, index })).filter(({ action }) => earliestCash
    && action.sourceExDate >= earliestCash && !selectedCashDates.includes(action.sourceExDate));
  const conflict = pricing.blockers.some(issue => ['dividend_source_conflict', 'dividend_crosscheck_mismatch'].includes(issue));
  const crosscheck = pricing.blockers.includes('dividend_crosscheck_mismatch');
  const [reference, setReference] = useState({ eps: '', payout: '', reportDate: pricing.annuals[0]?.reportDate ?? '', sourceUrl: '' });
  const [coverageConfirmed, setCoverageConfirmed] = useState(false), [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const confirmedAt = dateInChina(), expiresOn = new Date(Date.parse(confirmedAt) + 30 * 86400000).toISOString().slice(0, 10);
      const scale = (value: string, multiple: number) => value.trim() === '' ? NaN : Math.round(Number(value) * multiple);
      const value: DividendManualInputs = { code, frequency, confirmedAt, expiresOn, coverageConfirmed, conflictAcknowledged,
        automaticSignature: dividendAutomaticSignature(pricing.ledger ?? pricing.userConfirmedEvidence?.automaticLedger),
        batches: drafts.slice(0, frequency === 'semiannual' ? 2 : 1).map(draft => ({ reportDate: draft.reportDate, announcementDate: draft.announcementDate,
          recordDate: draft.recordDate, exDate: draft.exDate, cashPer10Micros: scale(draft.cash, 1e6), bonusPer10Bps: scale(draft.bonus, 1000), transferPer10Bps: scale(draft.transfer, 1000), sourceUrl: draft.sourceUrl.trim() })),
        ...(requiredShareActions.length ? { shareActions: requiredShareActions.map(({ action }) => ({ exDate: action.exDate, bonusPer10Bps: scale(action.bonus, 1000), transferPer10Bps: scale(action.transfer, 1000), sourceUrl: action.sourceUrl.trim() })) } : {}),
        ...(crosscheck ? { crosscheck: { epsMicros: scale(reference.eps, 1e6), payoutBps: scale(reference.payout, 100), reportDate: reference.reportDate, sourceUrl: reference.sourceUrl.trim() } } : {}) };
      const snapshot = await saveDividendManualInputs(value);
      await onSaved(snapshot); onClose();
    } catch (cause) { setError(t(cause instanceof Error && cause.message === 'DIVIDEND_MANUAL_SHARE_ACTION' ? 'div_manual_share_action_invalid'
      : cause instanceof Error && cause.message === 'DIVIDEND_MANUAL_CROSSCHECK' ? 'div_manual_crosscheck_failed'
      : cause instanceof Error && cause.message === 'DIVIDEND_MANUAL_CHANGED' ? 'div_manual_changed' : 'div_manual_invalid')); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="div-dialog div-manual-inputs" aria-labelledby="div-manual-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="div-stock-heading"><h2 id="div-manual-title">{t('div_manual_title')}</h2><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('close')}</button></div>
      <p>{t('div_manual_intro')}</p><p className="div-ai-muted">{t('div_manual_find', { code })}</p>
      <a href="https://www.cninfo.com.cn/new/index" target="_blank" rel="noopener noreferrer">{t('div_ai_open_company_reports')}</a>
      <label><span>{t('div_manual_frequency')}</span><select className="form-input" value={frequency} disabled={busy} onChange={event => setFrequency(event.target.value as typeof frequency)}>
        <option value="annual">{t('div_price_guide_annual')}</option><option value="semiannual">{t('div_price_guide_semiannual')}</option>
      </select></label>
      {drafts.slice(0, frequency === 'semiannual' ? 2 : 1).map((draft, index) => <fieldset key={index}><legend>{t('div_manual_batch', { index: index + 1 })}</legend>
        {fields.map(field => <label key={field}><span>{t(`div_manual_${field}`)}</span><input className="form-input" required disabled={busy}
          type={field.endsWith('Date') ? 'date' : field === 'sourceUrl' ? 'url' : 'number'} step={field === 'cash' ? '0.000001' : field === 'bonus' || field === 'transfer' ? '0.001' : undefined}
          min={['cash', 'bonus', 'transfer'].includes(field) ? '0' : undefined} value={draft[field]}
          onChange={event => setDrafts(current => current.map((row, i) => i === index ? { ...row, [field]: event.target.value } : row))} />
          <small>{t(`div_manual_help_${field}`)}</small></label>)}
      </fieldset>)}
      {requiredShareActions.map(({ action, index }) => <fieldset key={index}><legend>{t('div_manual_share_action')}</legend>{(['exDate', 'bonus', 'transfer', 'sourceUrl'] as const).map(field => <label key={field}><span>{t(`div_manual_${field}`)}</span><input className="form-input" required disabled={busy} type={field === 'exDate' ? 'date' : field === 'sourceUrl' ? 'url' : 'number'} step={field === 'bonus' || field === 'transfer' ? '0.001' : undefined} min={field === 'bonus' || field === 'transfer' ? 0 : undefined} value={action[field]} onChange={event => setShareActions(current => current.map((row, i) => i === index ? { ...row, [field]: event.target.value } : row))} /></label>)}</fieldset>)}
      {crosscheck && <fieldset><legend>{t('div_manual_crosscheck')}</legend><p>{t('div_manual_crosscheck_help')}</p>
        {(['eps', 'payout', 'reportDate', 'sourceUrl'] as const).map(field => <label key={field}><span>{t(`div_manual_${field}`)}</span><input className="form-input" required disabled={busy}
          type={field === 'reportDate' ? 'date' : field === 'sourceUrl' ? 'url' : 'number'} step={field === 'eps' ? '0.000001' : field === 'payout' ? '0.01' : undefined}
          value={reference[field]} onChange={event => setReference(current => ({ ...current, [field]: event.target.value }))} /></label>)}
      </fieldset>}
      <label className="div-manual-check"><input type="checkbox" checked={coverageConfirmed} disabled={busy} onChange={event => setCoverageConfirmed(event.target.checked)} /><span>{t('div_manual_coverage')}</span></label>
      {conflict && <label className="div-manual-check"><input type="checkbox" checked={conflictAcknowledged} disabled={busy} onChange={event => setConflictAcknowledged(event.target.checked)} /><span>{t('div_manual_conflict')}</span></label>}
      <p className="div-ai-muted">{t('div_manual_provenance')}</p>
      {error && <p className="div-warning" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy || !coverageConfirmed || conflict && !conflictAcknowledged}>{t(busy ? 'loading' : 'div_manual_save')}</button>
    </form>
  </dialog>;
}
