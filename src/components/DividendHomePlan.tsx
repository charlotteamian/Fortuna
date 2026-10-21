import { useTranslation } from 'react-i18next';
import { buildDividendHomePlan, type DividendStock } from '../lib/dividendWorkbench.ts';

const numeric = (value: number, max = 2) => value.toLocaleString(undefined, { maximumFractionDigits: max });

export default function DividendHomePlan({ stock, totalBudgetMinor, shares, amountVisible, asOf, onEdit }: {
  stock: DividendStock; totalBudgetMinor?: number; shares: number; amountVisible: boolean; asOf: string; onEdit: () => void;
}) {
  const { t } = useTranslation();
  const plan = buildDividendHomePlan(stock, totalBudgetMinor, shares, asOf);
  const quantity = (value: number) => amountVisible ? numeric(value, 4) : '••••';
  return <section className="div-home-plan" aria-label={t('div_home_plan')}>
    <div className="div-home-plan-heading"><h3>{t('div_home_plan')}</h3><button type="button" className="div-advisor-text-button" onClick={onEdit}>{t('div_home_edit_plan')}</button></div>
    <div className="div-home-plan-budget"><span>{t('div_stock_budget')} <strong>{plan.budgetMinor === undefined ? '—' : amountVisible ? `¥${numeric(plan.budgetMinor / 100)}` : '••••'}</strong> · {numeric(stock.weightBps / 100)}%</span>
      <span>{t('div_home_held_shares', { shares: quantity(shares) })}</span></div>
    {(['buy', 'sell'] as const).map(side => <div className="div-home-plan-side" key={side}>
      <h4>{t(`div_home_${side}`)}</h4>
      <p className={`div-home-plan-state${(side === 'buy' ? plan.buyState : plan.sellState) === 'triggered' ? ' div-home-plan-triggered' : ''}`}>
        {t(`div_home_${side}_${side === 'buy' ? plan.buyState : plan.sellState}`, { shares: quantity(side === 'buy' ? plan.additionalBuyShares : plan.sellShares) })}</p>
      <ol className="div-home-plan-levels">{plan[side].map((row, index) => {
        const target = side === 'buy' ? row.targetShares : row.sellShares;
        return <li className={row.touched ? 'div-home-plan-touched' : ''} key={index}>
          <strong>{row.priceMinor === undefined ? t('div_home_unpriced', { yield: numeric(row.yieldBps / 100) }) : `¥${numeric(row.priceMinor / 100)}`}</strong>
          <span>{target === undefined || side === 'buy' && totalBudgetMinor === undefined || side === 'sell' && shares <= 0
            ? t('div_home_allocation', { percent: numeric(row.cumulative / 100) })
            : t(`div_home_${side}_target`, { shares: quantity(target) })}</span>
          {row.touched && <small>{t('div_touched')}</small>}
        </li>;
      })}</ol>
    </div>)}
    {plan.incompletePrices && <p className="div-warning">{t('div_home_partial_prices')}</p>}
    <p className="div-home-plan-note">{t('div_home_plan_note')}</p>
  </section>;
}
