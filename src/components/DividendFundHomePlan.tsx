import { useTranslation } from 'react-i18next';
import { dividendFundAllocation, type DividendFundPlan } from '../lib/dividendFundPlan';
import { dividendFundCheckSummary, type DividendFundCheckSummary } from '../lib/dividendCheckSummary';
import DividendCompactPlan from './DividendCompactPlan';
import { dividendHomeCollapsed, matchesDividendReadFilter, type DividendReadFilter } from '../lib/dividendReading';

export default function DividendFundHomePlan({ plan, amountVisible, asOf, onEdit, checks, collapsedCodes, onToggle, readFilter, search }: {
  plan: DividendFundPlan; amountVisible: boolean; asOf: string; onEdit: () => void; checks?: Record<string, DividendFundCheckSummary>;
  collapsedCodes: string[]; onToggle: (key: string) => void; readFilter: DividendReadFilter; search: string;
}) {
  const { t } = useTranslation();
  const number = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
  const money = (value?: number) => value === undefined ? '—' : amountVisible ? `¥${number(value / 100)}` : '••••';
  const price = (value?: number) => value === undefined ? '—' : amountVisible ? `¥${number(value / 1e6, 6)}` : '••••';
  const allocation = dividendFundAllocation(plan);
  const funds = [...plan.funds].sort((a, b) => b.weightBps - a.weightBps || a.name.localeCompare(b.name)).filter(fund => `${fund.name} ${fund.code ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()) && matchesDividendReadFilter(checks?.[fund.id], readFilter));
  return <section className="div-fund-home" aria-labelledby="div-fund-home-title">
    <div className="div-section-heading"><h2 id="div-fund-home-title">{t('div_home_fund_plans')}</h2><button type="button" className="div-advisor-text-button" onClick={onEdit}>{t('div_home_edit_plan')}</button></div>
    <div className="div-fund-home-summary"><span>{t('df_planned_budget')} <strong>{money(plan.budgetMinor)}</strong></span><span>{t(`df_mode_${plan.mode}`)}</span>
      {plan.mode === 'rebalance' && <><span>{t('df_equity_budget')} {money(plan.budgetMinor === undefined ? undefined : allocation.fundBudgetMinor)}</span><span>{t('df_bond_budget')} {money(plan.budgetMinor === undefined ? undefined : allocation.bondBudgetMinor)}</span></>}
    </div>
    <div className="div-stock-list df-home-list">{funds.map(fund => {
      const check = checks?.[fund.id] ?? dividendFundCheckSummary({ plan, fund, asOf });
      const value = check.fundPlan;
      const expanded = !dividendHomeCollapsed(`fund:${fund.id}`, collapsedCodes);
      return <article className="div-stock div-fund-home-card div-compact-row" key={fund.id}>
        <button type="button" className="div-stock-toggle div-fund-toggle" aria-expanded={expanded} aria-controls={`div-fund-body-${fund.id}`} onClick={() => onToggle(`fund:${fund.id}`)}>
          <span className="div-stock-heading"><span><span className="div-stock-title">{fund.name} <span>{fund.code || t('div_read_code_unknown')}</span></span><small>{t(`df_index_${fund.indexKind}`)}</small></span>
            <span className="div-stock-toggle-state"><span className="div-stock-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span><span>{t(expanded ? 'div_read_collapse' : 'div_read_expand')}</span></span></span></button>
        <DividendCompactPlan summary={check} amountVisible={amountVisible} source={!fund.quote && fund.reference ? t('df_data_source', { date: fund.reference.asOf, source: fund.reference.source || t('df_manual_source') }) : undefined}>
          <p>{t('df_entry_summary', { drawdown: number(plan.drawdownBps / 100), yield: number(plan.indexYieldBps / 100), rule: t(`df_rule_${plan.entryRule}`) })}</p>
          <p>{t(`df_mode_${plan.mode}_note`)}</p>
          {fund.reference && <p>{t('df_data_source', { date: fund.reference.asOf, source: fund.reference.source || t('df_manual_source') })}</p>}
          {fund.note && <p>{fund.note}</p>}
        </DividendCompactPlan>
        <p className="div-compact-fund-rule">{t('df_entry_summary', { drawdown: number(plan.drawdownBps / 100), yield: number(plan.indexYieldBps / 100), rule: t(`df_rule_${plan.entryRule}`) })} · {t(`df_mode_${plan.mode}`)}</p>
        <p className="div-compact-fund-rule">{t(`div_fund_exit_${value.exitState}`, { price: price(value.exitPriceMicros) })}</p>
        <div id={`div-fund-body-${fund.id}`} hidden={!expanded}>
        <div className="div-home-plan-budget"><span>{t('df_weight')} {number(fund.weightBps / 100)}%</span><button type="button" className="div-advisor-text-button" onClick={onEdit}>{t('div_home_edit_plan')}</button></div>
        <dl className="div-fund-home-metrics"><div><dt>{t(fund.quote ? 'df_exchange_price' : 'div_check_manual_price_label')}</dt><dd>{price(value.priceMicros)}</dd></div>
          <div><dt>{t('df_entry_price', { percent: number(plan.drawdownBps / 100) })}</dt><dd>{price(value.entry.targetPriceMicros)}</dd></div>
          <div><dt>{t('df_current_drawdown')}</dt><dd>{amountVisible && value.entry.drawdownBps !== undefined ? `${number(value.entry.drawdownBps / 100)}%` : amountVisible ? '—' : '••••'}</dd></div>
          <div><dt>{t('df_index_yield')}</dt><dd>{amountVisible && fund.reference?.indexYieldBps !== undefined ? `${number(fund.reference.indexYieldBps / 100)}%` : amountVisible ? '—' : '••••'}</dd></div></dl>
        <small className="div-muted">{fund.quote ? t('div_quote_source', { date: fund.quote.date }) : fund.reference ? t('df_data_source', { date: fund.reference.asOf, source: fund.reference.source || t('df_manual_source') }) : t('div_not_fetched')}
          {fund.reference && fund.quote && ` · ${t('div_fund_reference_date', { date: fund.reference.asOf })}`}</small>
        </div>
      </article>;
    })}</div>
    {!plan.funds.length && <p className="div-muted">{t('df_empty')}</p>}
    {plan.funds.length > 0 && !funds.length && <p className="div-muted">{t('div_read_no_match')}</p>}
  </section>;
}
