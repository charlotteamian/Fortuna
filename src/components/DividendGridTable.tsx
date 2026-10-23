import { useTranslation } from 'react-i18next';
import type { buildDividendHomePlan } from '../lib/dividendWorkbench.ts';

const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

/** Both views render the same saved levels and price touches. Quantities are cumulative. */
export default function DividendGridTable({ plan, side, amountVisible }: {
  plan: ReturnType<typeof buildDividendHomePlan>; side: 'buy' | 'sell'; amountVisible: boolean;
}) {
  const { t } = useTranslation();
  return <div className="div-table-scroll div-grid-scroll"><table className="div-grid-table" aria-label={t(`div_home_${side}`)}>
    <colgroup><col /><col /><col /><col /><col /></colgroup>
    <thead><tr><th scope="col">{t('div_grid_level_column')}<small>{t('div_grid_cumulative_shares_short')}</small></th><th scope="col">{t('div_grid_target_yield')}</th>
      <th scope="col">{t('div_grid_price_short')}</th><th scope="col" title={t(`div_grid_${side}_portion_basis`)}>{t('div_grid_portion')}</th><th scope="col">{t('div_grid_status')}</th></tr></thead>
    <tbody>{plan[side].map((row, index) => {
      const target = side === 'buy' ? plan.budgetMinor === undefined ? undefined : row.targetShares : plan.sellState === 'no_holding' ? undefined : row.sellShares;
      const quantity = target === undefined ? undefined : amountVisible ? numeric(target, 4) : '••••';
      const state = !plan.quoteUsable ? 'pending' : row.priceMinor === undefined ? 'unpriced' : row.touched ? 'triggered' : 'waiting';
      return <tr className={row.touched ? 'div-grid-row-triggered div-home-plan-touched' : undefined} key={index}>
        <th scope="row"><span aria-label={t('div_grid_level', { level: index + 1 })}>{t(`div_grid_${side}_tier`, { level: index + 1 })}</span>
          <small aria-label={quantity === undefined ? t('div_home_allocation', { percent: numeric(row.cumulative / 100) }) : t(`div_home_${side}_target`, { shares: quantity })}>
            {quantity === undefined ? `${numeric(row.cumulative / 100)}%` : `${quantity} ${t('div_one_share')}`}</small></th>
        <td>{numeric(row.yieldBps / 100)}%</td>
        <td>{row.priceMinor === undefined ? '—' : `¥${numeric(row.priceMinor / 100)}`}</td>
        <td>{numeric(row.portionBps / 100)}%</td>
        <td className={`div-grid-cell-${state}`} aria-label={row.touched ? t('div_grid_price_triggered') : undefined}>{t(`div_grid_row_${state}`)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
