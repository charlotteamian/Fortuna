import { useTranslation } from 'react-i18next';
import { dividendFundAllocation, type DividendFundPlan } from '../lib/dividendFundPlan';
import { dividendFundCheckSummary, type DividendFundCheckSummary } from '../lib/dividendCheckSummary';
import DividendFundPlanSummary from './DividendFundPlanSummary';
import { dividendHomeCollapsed, matchesDividendReadFilter, type DividendReadFilter } from '../lib/dividendReading';
import { dividendFundTodayAction } from '../lib/dividendFundToday';

export default function DividendFundHomePlan({ plan, amountVisible, asOf, onEdit, checks, collapsedCodes, onToggle, readFilter, search }: {
  plan: DividendFundPlan; amountVisible: boolean; asOf: string; onEdit: () => void; checks?: Record<string, DividendFundCheckSummary>;
  collapsedCodes: string[]; onToggle: (key: string) => void; readFilter: DividendReadFilter; search: string;
}) {
  const { t } = useTranslation();
  const number = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
  const money = (value?: number) => value === undefined ? '—' : amountVisible ? `¥${number(value / 100)}` : '••••';
  const allocation = dividendFundAllocation(plan);
  const planChecks = new Map(plan.funds.map(fund => [fund.id, checks?.[fund.id] ?? dividendFundCheckSummary({ plan, fund, asOf })]));
  const todayActions = [...planChecks.values()].map(check => dividendFundTodayAction(check, plan.mode));
  const pendingCount = todayActions.filter(action => action === 'update' || action === 'allocate').length;
  const funds = [...plan.funds].sort((a, b) => b.weightBps - a.weightBps || a.name.localeCompare(b.name)).filter(fund => `${fund.name} ${fund.code ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()) && matchesDividendReadFilter(planChecks.get(fund.id), readFilter));
  return <section className="div-fund-home" aria-labelledby="div-fund-home-title">
    <section className="div-wb-daily df-today-overview" aria-labelledby="df-today-title">
      <h2 id="df-today-title">{t('df_today_title')}</h2>
      {plan.funds.length ? <>
        <p>{t('df_today_summary', { buy: todayActions.filter(action => action === 'buy' || action === 'allocate').length, sell: todayActions.filter(action => action === 'sell').length })}</p>
        {pendingCount > 0 && <p className="div-muted">{t('df_today_pending', { count: pendingCount })}</p>}
        {todayActions.includes('wait') && <p className="div-muted">{t('df_today_waiting')}</p>}
      </> : <p className="div-muted">{t('df_today_empty')}</p>}
    </section>
    <div className="div-section-heading"><h2 id="div-fund-home-title">{t('div_home_fund_plans')}</h2><button type="button" className="div-advisor-text-button" onClick={onEdit}>{t('div_home_edit_plan')}</button></div>
    <div className="div-fund-home-summary"><span>{t('df_planned_budget')} <strong>{money(plan.budgetMinor)}</strong></span><span>{t(`df_mode_${plan.mode}`)}</span>
      {plan.mode === 'rebalance' && <><span>{t('df_equity_budget')} {money(plan.budgetMinor === undefined ? undefined : allocation.fundBudgetMinor)}</span><span>{t('df_bond_budget')} {money(plan.budgetMinor === undefined ? undefined : allocation.bondBudgetMinor)}</span></>}
    </div>
    <div className="df-focus-allocation"><div><span>{t('df_focus_allocated')}</span><strong>{money(plan.budgetMinor === undefined ? undefined : allocation.fundBudgetMinor - allocation.unallocatedMinor)}</strong></div>
      <div><span>{t('df_focus_unallocated')}</span><strong>{money(plan.budgetMinor === undefined ? undefined : allocation.unallocatedMinor)}</strong></div></div>
    <div className="div-stock-list df-home-list">{funds.map(fund => {
      const check = planChecks.get(fund.id)!;
      const value = check.fundPlan;
      const expanded = !dividendHomeCollapsed(`fund:${fund.id}`, collapsedCodes);
      return <article className="div-stock div-fund-home-card div-compact-row" id={`div-check-fund:${fund.id}`} key={fund.id}>
        <div className="div-stock-heading"><span><span className="div-stock-title">{fund.name}</span><small>{fund.code || t('div_read_code_unknown')} · {t(`df_index_${fund.indexKind}`)}</small></span>
          <button type="button" className="div-advisor-text-button" onClick={onEdit}>{t('edit')}</button></div>
        <DividendFundPlanSummary plan={plan} fund={fund} check={check} amountVisible={amountVisible} />
        <button type="button" className="div-advisor-text-button df-focus-evidence-toggle" aria-expanded={expanded} aria-controls={`div-fund-body-${fund.id}`} onClick={() => onToggle(`fund:${fund.id}`)}>
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {t('df_focus_evidence')}</button>
        <div id={`div-fund-body-${fund.id}`} hidden={!expanded}>
        <p className="div-muted">{t('df_entry_summary', { drawdown: number(plan.drawdownBps / 100) })}</p>
        <p className="div-muted">{t(`df_mode_${plan.mode}_note`)}</p>
        <dl className="div-fund-home-metrics"><div><dt>{t('df_current_drawdown')}</dt><dd>{amountVisible && value.entry.drawdownBps !== undefined ? `${number(value.entry.drawdownBps / 100)}%` : amountVisible ? '—' : '••••'}</dd></div>
          <div><dt>{t('df_index_yield')}</dt><dd>{amountVisible && fund.reference?.indexYieldBps !== undefined ? `${number(fund.reference.indexYieldBps / 100)}%` : amountVisible ? '—' : '••••'}</dd></div></dl>
        <small className="div-muted">{fund.quote ? t('div_quote_source', { date: fund.quote.date }) : fund.reference ? t('df_data_source', { date: fund.reference.asOf, source: fund.reference.source || t('df_manual_source') }) : t('div_not_fetched')}
          {fund.reference && fund.quote && ` · ${t('div_fund_reference_date', { date: fund.reference.asOf })}`}</small>
        {fund.quoteFailedAt !== undefined && <p className="div-warning">{t('div_quotes_failed')}</p>}
        {fund.note && <p className="div-muted">{fund.note}</p>}
        </div>
      </article>;
    })}</div>
    {!plan.funds.length && <p className="div-muted">{t('df_empty')}</p>}
    {plan.funds.length > 0 && !funds.length && <p className="div-muted">{t('div_read_no_match')}</p>}
  </section>;
}
