import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendPlanProposal } from '../lib/dividendAdvisorActions';
import type { GridLevel } from '../lib/dividendWorkbench';
import { applyDividendPlanChange, previewDividendPlanChange } from '../services/dividendAdvisorActionsService';

type Preview = Awaited<ReturnType<typeof previewDividendPlanChange>>;

function Levels({ levels }: { levels: GridLevel[] }) {
  const { t } = useTranslation();
  return <ul className="div-ai-grid-levels">{levels.map((level, index) => <li key={index}>
    {level.priceMinor !== undefined ? t('div_ai_plan_price_level', { price: (level.priceMinor / 100).toFixed(2), weight: level.portionBps / 100 })
      : t('div_ai_plan_level', { yield: level.yieldBps / 100, weight: level.portionBps / 100 })}
  </li>)}</ul>;
}

export default function DividendAdvisorPlanActions({ proposals, disabled, onUpdated, initiallyExpanded = false, previewLabel }: { proposals: DividendPlanProposal[]; disabled: boolean; onUpdated: () => Promise<unknown>; initiallyExpanded?: boolean; previewLabel?: string }) {
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
    catch (cause) { setPreview(null); setError(t(cause instanceof Error && cause.message === 'DIVIDEND_PLAN_CHANGED' ? 'div_ai_plan_changed'
      : cause instanceof Error && cause.message === 'DIVIDEND_GRID_SIDES_CROSS' ? 'div_v2_grid_sides_cross' : 'div_ai_action_error')); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="div-ai-plan-actions">{proposals.map(proposal => <details key={proposal.id} className="div-ai-plan-action" open={initiallyExpanded}><summary>{t('div_ai_plan_proposal')} · {proposal.code}</summary>
    <p>{proposal.reason}</p><button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => void execute(async () => {
      const value = await previewDividendPlanChange(proposal); setPreview({ proposal, value });
    })}>{previewLabel ?? t('div_ai_plan_preview')}</button>
    {preview?.proposal.id === proposal.id && <div className="div-ai-confirm"><strong>{preview.value.name} · {preview.value.code}</strong>
      <div className="div-ai-grid-comparison">{(['before', 'after'] as const).map(side => <section key={side}><h3>{t(`div_ai_plan_${side}`)}</h3>
        <p className={`div-ai-status ${preview.value[side].buyPaused ? 'risk' : ''}`}>{t(preview.value[side].buyPaused ? 'div_ai_buy_paused' : 'div_ai_buy_active')}</p>
        <details open={Boolean(proposal.buyLevels)}><summary>{t('div_ai_plan_buy')} · {t('div_ai_grid_level_count', { count: preview.value[side].buyLevels.length })}</summary><Levels levels={preview.value[side].buyLevels} /></details>
        <details open={Boolean(proposal.sellLevels)}><summary>{t('div_ai_plan_sell')} · {t('div_ai_grid_level_count', { count: preview.value[side].sellLevels.length })}</summary><Levels levels={preview.value[side].sellLevels} /></details>
      </section>)}</div>
      <p className="div-ai-muted">{t('div_ai_plan_preview_hint')}</p><div className="div-actions"><button type="button" className="btn btn-primary" disabled={disabled || busy} onClick={() => void execute(async () => {
        await applyDividendPlanChange(proposal, preview.value.fingerprint); setPreview(null); await onUpdated(); setNotice(t('div_ai_plan_applied'));
      })}>{t('div_ai_plan_confirm')}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPreview(null)}>{t('cancel')}</button></div>
    </div>}
  </details>)}{error && <p className="div-warning" role="alert">{error}</p>}{notice && <p className="div-advisor-status" role="status">{notice}</p>}</div>;
}
