import { useTranslation } from 'react-i18next';
import type { buildDividendHomePlan } from '../lib/dividendWorkbench.ts';
import DividendGridTable from './DividendGridTable.tsx';

export default function DividendPlanGrid({ plan, side, amountVisible }: {
  plan: ReturnType<typeof buildDividendHomePlan>; side: 'buy' | 'sell'; amountVisible: boolean;
}) {
  const { t } = useTranslation();
  const triggeredLevel = plan[`${side}TriggeredLevel`];
  return <details className="div-details div-plan-grid" data-side={side}>
    <summary>{t(`div_grid_${side}`)} <span className={`div-grid-trigger-status${triggeredLevel > 0 ? ' is-triggered' : ''}`}>
      {t(!plan.quoteUsable ? 'div_grid_quote_pending' : plan[side].every(row => row.priceMinor === undefined) ? 'div_grid_prices_pending'
        : triggeredLevel > 0 ? 'div_grid_triggered_level' : 'div_grid_not_triggered', { level: triggeredLevel })}</span></summary>
    <DividendGridTable plan={plan} side={side} amountVisible={amountVisible} />
  </details>;
}
