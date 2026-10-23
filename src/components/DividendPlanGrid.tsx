import { useTranslation } from 'react-i18next';
import type { buildDividendHomePlan } from '../lib/dividendWorkbench.ts';

const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

export default function DividendPlanGrid({ plan, side, amountVisible }: {
  plan: ReturnType<typeof buildDividendHomePlan>; side: 'buy' | 'sell'; amountVisible: boolean;
}) {
  const { t } = useTranslation();
  const triggeredLevel = plan[`${side}TriggeredLevel`];
  return <details className="div-details div-plan-grid" data-side={side}>
    <summary>{t(`div_grid_${side}`)} <span className={`div-grid-trigger-status${triggeredLevel > 0 ? ' is-triggered' : ''}`}>
      {t(!plan.quoteUsable ? 'div_grid_quote_pending' : plan[side].every(row => row.priceMinor === undefined) ? 'div_grid_prices_pending'
        : triggeredLevel > 0 ? 'div_grid_triggered_level' : 'div_grid_not_triggered', { level: triggeredLevel })}</span></summary>
    <div className="div-table-scroll"><table><thead><tr><th>{t('div_grid_level_column')}</th><th>{t('div_grid_yield')}</th><th>{t('div_grid_price')}</th><th>{t('div_grid_shares')}</th></tr></thead><tbody>
      {plan[side].map((row, index) => {
        const quantity = side === 'buy' ? plan.budgetMinor === undefined ? undefined : row.targetShares : row.sellShares;
        return <tr className={row.touched ? 'div-grid-row-triggered' : ''} key={index}>
          <td><span>{t('div_grid_level', { level: index + 1 })}</span>{row.touched && <small>{t('div_grid_price_triggered')}</small>}</td>
          <td>{row.displayYieldBps === undefined ? '—' : `${numeric(row.displayYieldBps / 100)}%`}</td>
          <td>{row.priceMinor ? `¥${numeric(row.priceMinor / 100)}` : '—'}</td>
          <td>{quantity === undefined ? '—' : amountVisible ? numeric(quantity, 4) : '••••'}</td>
        </tr>;
      })}
    </tbody></table></div>
  </details>;
}
