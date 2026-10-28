import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendPlanProposal } from '../lib/dividendAdvisorActions';
import type { GridLevel } from '../lib/dividendWorkbench';
import { applyDividendPlanChange, previewDividendPlanChange } from '../services/dividendAdvisorActionsService';

type Preview = Awaited<ReturnType<typeof previewDividendPlanChange>>;

function Levels({ levels, side }: { levels: GridLevel[]; side: 'buy' | 'sell' }) {
  const { t } = useTranslation();
  const priceBased = levels.every(level => level.priceMinor !== undefined);
  return <table className="div-ai-grid-levels" aria-label={t(`div_ai_plan_${side}`)}><colgroup><col /><col /><col /></colgroup>
    <thead><tr><th scope="col">{t('div_grid_level_column')}</th><th scope="col">{t(priceBased ? 'div_grid_price_short' : 'div_grid_target_yield')}</th><th scope="col">{t('div_grid_portion')}</th></tr></thead>
    <tbody>{levels.map((level, index) => <tr key={index}><th scope="row">{index + 1}</th>
      <td>{level.priceMinor !== undefined ? `¥${(level.priceMinor / 100).toFixed(2)}` : `${level.yieldBps / 100}%`}</td><td>{level.portionBps / 100}%</td>
    </tr>)}</tbody>
  </table>;
}

function PreviewLevels({ value }: { value: Preview['after'] }) {
  const { t } = useTranslation();
  return <><p className={`div-ai-status ${value.buyPaused ? 'risk' : ''}`}>{t(value.buyPaused ? 'div_ai_buy_paused' : 'div_ai_buy_active')}</p>
    {(['buy', 'sell'] as const).map(side => <section key={side} className={`div-ai-grid-side ${side}`}>
      <h4>{t(`div_ai_plan_${side}`)} <span>{t('div_ai_grid_level_count', { count: value[`${side}Levels`].length })}</span></h4>
      <Levels levels={value[`${side}Levels`]} side={side} />
    </section>)}
  </>;
}

export default function DividendAdvisorPlanActions({ proposals, disabled, onUpdated, initiallyExpanded = false, embedded = false, previewLabel, beforePreview, beforeApply }: { proposals: DividendPlanProposal[]; disabled: boolean; onUpdated: () => Promise<unknown>; initiallyExpanded?: boolean; embedded?: boolean; previewLabel?: string; beforePreview?: () => Promise<void>; beforeApply?: () => Promise<void> }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<{ proposal: DividendPlanProposal; value: Preview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const execute = async (job: () => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await job(); }
    catch (cause) { setPreview(null); setError(t(cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_STALE' ? 'div_v2_review_stale'
      : cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_CHANGED' ? 'div_v2_review_changed'
      : cause instanceof Error && cause.message === 'DIVIDEND_REVIEW_REQUIRED' ? 'div_v2_review_required'
      : cause instanceof Error && cause.message === 'DIVIDEND_PLAN_CHANGED' ? 'div_ai_plan_changed'
      : cause instanceof Error && cause.message === 'DIVIDEND_GRID_SIDES_CROSS' ? 'div_v2_grid_sides_cross' : 'div_ai_action_error')); }
    finally { lock.current = false; setBusy(false); }
  };
  const Container = embedded ? 'section' : 'details';
  return <div className="div-ai-plan-actions">{proposals.map(proposal => <Container key={proposal.id} className="div-ai-plan-action" {...(embedded ? {} : { open: initiallyExpanded })}>
    {!embedded && <><summary>{t('div_ai_plan_proposal')} · {proposal.code}</summary><p>{proposal.reason}</p></>}
    <button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => void execute(async () => {
      await beforePreview?.(); const value = await previewDividendPlanChange(proposal); setPreview({ proposal, value });
    })}>{previewLabel ?? t('div_ai_plan_preview')}</button>
    {preview?.proposal.id === proposal.id && <div className="div-ai-confirm"><strong>{preview.value.name} · {preview.value.code}</strong>
      <div className="div-ai-grid-comparison"><section className="div-ai-grid-proposed"><h3>{t('div_ai_plan_after')}</h3><PreviewLevels value={preview.value.after} /></section>
        <details className="div-ai-grid-current"><summary>{t('div_ai_plan_before')}</summary><PreviewLevels value={preview.value.before} /></details></div>
      <p className="div-ai-muted">{t('div_ai_plan_preview_hint')}</p><div className="div-actions"><button type="button" className="btn btn-primary" disabled={disabled || busy} onClick={() => void execute(async () => {
        await beforeApply?.(); await applyDividendPlanChange(proposal, preview.value.fingerprint); setPreview(null); await onUpdated(); setNotice(t('div_ai_plan_applied'));
      })}>{t('div_ai_plan_confirm')}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPreview(null)}>{t('cancel')}</button></div>
    </div>}
  </Container>)}{error && <p className="div-warning" role="alert">{error}</p>}{notice && <p className="div-advisor-status" role="status">{notice}</p>}</div>;
}
