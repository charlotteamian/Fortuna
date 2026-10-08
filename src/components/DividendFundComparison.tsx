import { useTranslation } from 'react-i18next';
import { DIVIDEND_FUND_CATALOG_AS_OF, DIVIDEND_FUND_EXAMPLES, type DividendFundExample } from '../lib/dividendFundCatalog';
import type { DividendFundPlan } from '../lib/dividendFundPlan';

export default function DividendFundComparison({ plan, disabled, onSelect }: {
  plan: DividendFundPlan;
  disabled: boolean;
  onSelect: (fund: DividendFundExample) => void;
}) {
  const { t } = useTranslation();
  const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;
  return <details className="div-method df-comparison" open>
    <summary>{t('df_compare_title')}</summary>
    <p>{t('df_compare_note')}</p>
    <div className="df-comparison-table">
      <table>
        <caption className="div-muted">{t('df_compare_as_of', { date: DIVIDEND_FUND_CATALOG_AS_OF })}</caption>
        <thead><tr><th scope="col">{t('df_name')}</th><th scope="col">{t('df_compare_product')}</th><th scope="col">{t('df_compare_fees')}</th><th scope="col">{t('df_compare_plan')}</th></tr></thead>
        <tbody>{DIVIDEND_FUND_EXAMPLES.map(fund => <tr key={fund.code}>
          <th scope="row"><strong>{t(fund.nameKey)}</strong><span className="df-comparison-code">{fund.code}</span><a href={fund.sourceUrl} target="_blank" rel="noreferrer">{t('df_compare_source')}</a></th>
          <td data-label={t('df_compare_product')}><div><strong>{t(fund.indexKey)}</strong><span>{t(fund.productKey)}</span><span>{t(fund.marketKey)}</span></div></td>
          <td data-label={t('df_compare_fees')}><div><span>{t('df_management_fee', { percent: percent(fund.managementFeeBps) })}</span><span>{t('df_custody_fee', { percent: percent(fund.custodyFeeBps) })}</span></div></td>
          <td><button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onSelect(fund)}>{t(plan.funds.some(row => row.code === fund.code) ? 'df_edit' : 'df_compare_add')}</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="div-muted">{t('df_compare_fee_note')}</p>
    <p>{t('df_compare_etf_note')}</p>
    <p>{t('df_compare_index_note')}</p>
    <details className="df-bond-example"><summary>{t('df_bond_example_title')}</summary><p>{t('df_bond_example_note')}</p><p><a href="https://www.cmfchina.com/web/fundDetail/161716/" target="_blank" rel="noreferrer">{t('df_bond_example_source')}</a></p></details>
  </details>;
}
