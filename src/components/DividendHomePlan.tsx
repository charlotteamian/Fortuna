import { useTranslation } from 'react-i18next';
import { buildDividendHomePlan, type DividendStock } from '../lib/dividendWorkbench.ts';
import DividendGridTable from './DividendGridTable.tsx';

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
      <h4>{t(`div_home_${side}`)} <span className={`div-grid-trigger-status${plan[`${side}TriggeredLevel`] > 0 ? ' is-triggered' : ''}`}>
        {t(!plan.quoteUsable ? 'div_grid_quote_pending' : plan[side].every(row => row.priceMinor === undefined) ? 'div_grid_prices_pending'
          : plan[`${side}TriggeredLevel`] > 0 ? 'div_grid_triggered_level' : 'div_grid_not_triggered', { level: plan[`${side}TriggeredLevel`] })}</span></h4>
      {(side === 'buy' ? plan.buyState : plan.sellState) !== 'waiting' && <p className={`div-home-plan-state${(side === 'buy' ? plan.buyState : plan.sellState) === 'triggered' ? ' div-home-plan-triggered' : ''}`}>
        {t(`div_home_${side}_${side === 'buy' ? plan.buyState : plan.sellState}`, { shares: quantity(side === 'buy' ? plan.additionalBuyShares : plan.sellShares) })}</p>}
      <DividendGridTable plan={plan} side={side} amountVisible={amountVisible} />
    </div>)}
    {plan.incompletePrices && <p className="div-warning">{t('div_home_partial_prices')}</p>}
    <details className="div-home-plan-note"><summary>{t('div_home_plan_calculation')}</summary><p>{t('div_home_plan_note')}</p></details>
  </section>;
}
