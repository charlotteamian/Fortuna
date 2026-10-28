import { useTranslation } from 'react-i18next';
import { buildDividendFundHomePlan, dividendFundAllocation, type DividendFundPlan } from '../lib/dividendFundPlan';

export default function DividendFundHomePlan({ plan, amountVisible, asOf, onEdit }: {
  plan: DividendFundPlan; amountVisible: boolean; asOf: string; onEdit: () => void;
}) {
  const { t } = useTranslation();
  const number = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
  const money = (value?: number) => value === undefined ? '—' : amountVisible ? `¥${number(value / 100)}` : '••••';
  const price = (value?: number) => value === undefined ? '—' : amountVisible ? `¥${number(value / 1e6, 6)}` : '••••';
  const allocation = dividendFundAllocation(plan);
  return <section className="div-fund-home" aria-labelledby="div-fund-home-title">
    <div className="div-section-heading"><h2 id="div-fund-home-title">{t('div_home_fund_plans')}</h2><button type="button" className="div-advisor-text-button" onClick={onEdit}>{t('div_home_edit_plan')}</button></div>
    <div className="div-fund-home-summary"><span>{t('df_planned_budget')} <strong>{money(plan.budgetMinor)}</strong></span><span>{t(`df_mode_${plan.mode}`)}</span>
      {plan.mode === 'rebalance' && <><span>{t('df_equity_budget')} {money(plan.budgetMinor === undefined ? undefined : allocation.fundBudgetMinor)}</span><span>{t('df_bond_budget')} {money(plan.budgetMinor === undefined ? undefined : allocation.bondBudgetMinor)}</span></>}
    </div>
    <div className="div-stock-list df-home-list">{[...plan.funds].sort((a, b) => b.weightBps - a.weightBps || a.name.localeCompare(b.name)).map(fund => {
      const value = buildDividendFundHomePlan(plan, fund, asOf);
      return <article className="div-stock div-fund-home-card" key={fund.id}>
        <div className="div-stock-heading"><div><h3>{fund.name}</h3><small>{fund.code} · {t(`df_index_${fund.indexKind}`)}</small></div>
          <span className={`div-grid-trigger-status${value.entry.status === 'met' ? ' is-triggered' : ''}`}>{t(`df_signal_${value.entry.status}`)}</span></div>
        <div className="div-home-plan-budget"><span>{t('df_target_amount')} <strong>{money(value.targetAmountMinor)}</strong> · {number(fund.weightBps / 100)}%</span></div>
        <dl className="div-fund-home-metrics"><div><dt>{t(fund.quote ? 'df_exchange_price' : 'df_current_price')}</dt><dd>{price(value.priceMicros)}</dd></div>
          <div><dt>{t('df_entry_price', { percent: number(plan.drawdownBps / 100) })}</dt><dd>{price(value.entry.targetPriceMicros)}</dd></div>
          <div><dt>{t('df_current_drawdown')}</dt><dd>{amountVisible && value.entry.drawdownBps !== undefined ? `${number(value.entry.drawdownBps / 100)}%` : amountVisible ? '—' : '••••'}</dd></div>
          <div><dt>{t('df_index_yield')}</dt><dd>{amountVisible && fund.reference?.indexYieldBps !== undefined ? `${number(fund.reference.indexYieldBps / 100)}%` : amountVisible ? '—' : '••••'}</dd></div></dl>
        <p className="div-muted">{t('df_entry_summary', { drawdown: number(plan.drawdownBps / 100), yield: number(plan.indexYieldBps / 100), rule: t(`df_rule_${plan.entryRule}`) })}</p>
        <p className={`div-fund-exit${value.exitState === 'triggered' ? ' div-notice' : ''}`}>{t(`div_fund_exit_${value.exitState}`, { price: price(value.exitPriceMicros) })}</p>
        {value.entry.issues.length > 0 && <p className="div-warning">{value.entry.issues.map(issue => t(`df_issue_${issue}`)).join(' · ')}</p>}
        <small className="div-muted">{fund.quote ? t('div_quote_source', { date: fund.quote.date }) : fund.reference ? t('df_data_source', { date: fund.reference.asOf, source: fund.reference.source || t('df_manual_source') }) : t('div_not_fetched')}
          {fund.reference && fund.quote && ` · ${t('div_fund_reference_date', { date: fund.reference.asOf })}`}</small>
      </article>;
    })}</div>
    {!plan.funds.length && <p className="div-muted">{t('df_empty')}</p>}
  </section>;
}
