import { useTranslation } from 'react-i18next';
import type { DividendFund, DividendFundPlan } from '../lib/dividendFundPlan';
import type { DividendFundCheckSummary } from '../lib/dividendCheckSummary';
import { dividendFundTodayAction } from '../lib/dividendFundToday';
import { dividendFundGridPrices } from '../lib/dividendFundGrid';
import './DividendFundPlanSummary.css';

/** A reading view of the common fund check; conditions remain owned by its engine. */
export default function DividendFundPlanSummary({ plan, fund, check, amountVisible }: {
  plan: DividendFundPlan; fund: DividendFund; check: DividendFundCheckSummary; amountVisible: boolean;
}) {
  const { t, i18n } = useTranslation();
  const number = (value: number, digits = 2) => value.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const price = (value?: number) => value === undefined ? t('df_focus_price_missing') : amountVisible ? `¥${number(value / 1e6, 6)}` : '••••';
  const money = (value?: number) => value === undefined ? t('df_focus_budget_missing') : amountVisible ? `¥${number(value / 100)}` : '••••';
  const quote = check.trigger.quote;
  const currentPrice = quote.priceMicros ?? check.fundPlan.priceMicros;
  const priceLabel = !fund.quote && fund.reference?.priceMicros !== undefined ? 'div_check_manual_price_label'
    : quote.status === 'current' ? 'df_focus_current_price' : 'div_read_quote_reference';
  const sourceDate = quote.date ?? fund.reference?.asOf;
  const todayAction = dividendFundTodayAction(check, plan.mode);
  const gridPrices = dividendFundGridPrices(check.grid.entryPriceMicros);
  const knownHolding = check.actionCheck.shares !== null;
  const actionNote = (todayAction === 'buy' || todayAction === 'sell') && knownHolding
    ? `df_today_${todayAction}_holding_note` : `df_today_${todayAction}_note`;
  return <div className="df-focus-plan">
    <div className={`df-today-action is-${todayAction}`}>
      <strong>{t(`df_today_${todayAction}`)}</strong>
      <p>{t(actionNote, { shares: amountVisible && check.actionCheck.shares !== null ? number(check.actionCheck.shares, 4) : '••••' })}</p>
    </div>
    <div className="df-focus-leading">
      <div className="df-focus-price"><span>{t(priceLabel)}</span><strong>{price(currentPrice)}</strong>
        <small>{sourceDate ?? t('div_check_quote_unknown')}</small></div>
      <div className="df-focus-amount"><span>{t('df_target_amount')}</span><strong>{money(check.actionCheck.budgetMinor)}</strong>
        <small>{t('df_focus_weight', { percent: number(fund.weightBps / 100) })}</small></div>
    </div>
    <div className="df-focus-buy-grid">
      <table>
        <caption>{t('df_focus_buy_grid')}</caption>
        <thead><tr><th scope="col">{t('df_focus_buy_level')}</th><th scope="col">{t('df_focus_grid_price')}</th></tr></thead>
        <tbody>{gridPrices.length ? gridPrices.map((value, index) => <tr key={index}>
          <th scope="row">{t('df_focus_grid_level', { level: index + 1 })}</th><td>{price(value)}</td>
        </tr>) : <tr><td colSpan={2}>{t('df_focus_grid_missing')}</td></tr>}</tbody>
      </table>
      <small className={`df-focus-signal is-${check.trigger.buy}`}>{t(`df_focus_buy_${check.trigger.buy}`)}</small>
      {gridPrices.length > 0 && <small>{t('df_focus_grid_reference_note')}</small>}
    </div>
    <dl className="df-focus-targets">
      <div><dt>{t('df_focus_sell_plan')}</dt><dd>{plan.mode === 'swing' ? price(check.grid.exitPriceMicros) : t(`df_focus_sell_${plan.mode}`)}</dd>
        <small className={plan.mode === 'swing' ? `df-focus-signal is-${check.trigger.sell}` : ''}>{t(plan.mode === 'swing' ? `df_focus_sell_${check.trigger.sell}` : `df_focus_sell_${plan.mode}_note`)}</small></div>
    </dl>
  </div>;
}
