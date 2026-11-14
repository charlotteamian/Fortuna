import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { getClassicAdviceFacts } from '../lib/dividendClassicAdvice';
import type { ClassicGridTierRow, ClassicStockPlan } from '../lib/dividendClassicStrategy';

const price = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toFixed(2)}`;
const percent = (bps?: number) => bps === undefined ? '—' : `${(bps / 100).toFixed(2)}%`;

export default function DividendClassicGrid({ plan, facts, amountVisible, busy, onSaveGrid }: {
  plan: ClassicStockPlan;
  facts: ReturnType<typeof getClassicAdviceFacts>;
  amountVisible: boolean;
  busy: boolean;
  onSaveGrid: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [side, setSide] = useState<'buy' | 'sell'>(() => facts.status === 'sell' ? 'sell' : 'buy');
  const [preview, setPreview] = useState(false);
  const custom = plan.gridOrigin === 'custom_saved';
  const rows = side === 'buy' ? plan.buyRows : plan.sellRows;
  const shares = (value: number) => amountVisible ? value.toLocaleString(i18n.language, { maximumFractionDigits: 4 }) : '••••';
  const quoteSource = !facts.quoteCurrent && plan.quoteSource === 'live' ? 'cached' : plan.quoteSource;
  const describeRow = (row: ClassicGridTierRow) => {
    if (side === 'sell' && plan.shares <= 0) return t('div_new_grid_no_holding');
    if (side === 'buy' && plan.buyPaused) return t('div_new_status_paused');
    if (side === 'buy' && !plan.budgetMinor) return t('div_new_status_no_budget');
    if (!facts.quoteCurrent) return t('div_new_status_quote_unverified');
    if (row.touched && plan.base.tier !== 'recent_batches') return t('div_new_grid_reference');
    return t(row.status === 'triggered' ? 'div_new_grid_touched' : `div_cs_row_${row.status}`);
  };

  return <>
    <section className="div-wb-stock-snapshot" aria-label={t('div_new_overview')}>
      <dl className="div-wb-stock-metrics">
        <div><dt>{t('div_new_quote')}</dt><dd>{price(plan.quotePriceMinor)}</dd>
          <small>{t(`div_new_quote_${quoteSource}`)}{plan.quoteDate ? ` · ${plan.quoteDate}` : ''}</small></div>
        <div><dt>{t('div_new_net_yield')}</dt><dd>{percent(plan.currentNetYieldBps)}</dd>
          <small>{t(`div_cs_tier_${plan.base.tier}`)}</small></div>
        <div><dt>{t('div_cs_detail_holding')}</dt><dd>{shares(plan.shares)}</dd></div>
        <div><dt>{t('div_cs_detail_budget', { weight: plan.weightBps / 100 })}</dt>
          <dd>{plan.budgetMinor === undefined ? '—' : amountVisible ? price(plan.budgetMinor) : '••••'}</dd></div>
      </dl>
      <p className={`div-wb-stock-state is-${facts.status}`}>
        <strong>{t(`div_new_status_${facts.status}`)}</strong>
        {(facts.status === 'buy' || facts.status === 'sell') && <span>
          {t(`div_cs_${facts.status}_tier_name`, { level: facts.status === 'buy' ? facts.touchedBuyLevel : facts.touchedSellLevel })}
          {t('div_new_action_shares', { shares: shares(facts.shares) })}
        </span>}
        {facts.buy1GapBps !== undefined && facts.status === 'waiting' &&
          <span>{t('div_new_buy_distance', { gap: facts.buy1GapBps === 0 ? '<0.01%' : percent(facts.buy1GapBps) })}</span>}
      </p>
    </section>

    <div className="div-wb-segment" role="group" aria-label={t('div_new_grid')}>
      {(['buy', 'sell'] as const).map(value => (
        <button type="button" key={value} aria-pressed={side === value} onClick={() => setSide(value)}>
          {t(`div_new_grid_${value}`)}
        </button>
      ))}
    </div>
    <p className="div-muted">{t(custom ? 'div_new_grid_saved_note' : 'div_new_grid_net_note')}</p>

    <ol className="div-wb-grid-rows" aria-label={t(`div_new_grid_${side}`)}>
      {rows.map(row => {
        const savedPrice = custom || row.yieldBps !== (side === 'buy' ? plan.classicBuyLevels : plan.classicSellLevels)[row.level - 1]?.yieldBps;
        const impliedYield = plan.base.netDpsMicros !== undefined && row.priceMinor > 0 ? Math.round(plan.base.netDpsMicros / row.priceMinor) : undefined;
        const highlighted = facts.quoteCurrent && row.touched && facts.status === side;
        return <li className={highlighted ? 'is-touched' : ''} key={row.level}>
          <div className="div-wb-tier-head">
            <strong>{t(`div_cs_${side}_tier_name`, { level: row.level })}</strong>
            <strong className="div-wb-tier-price">{side === 'buy' ? '≤' : '≥'} {price(row.priceMinor)}</strong>
          </div>
          <div className="div-wb-tier-meta">
            <span>{t(savedPrice ? 'div_new_grid_implied_yield' : 'div_new_grid_target_yield', {
              yield: percent(savedPrice ? impliedYield : row.yieldBps),
            })}</span>
            <span>{describeRow(row)}</span>
            {side === 'buy' && row.targetShares !== undefined
              ? <span>{t('div_cs_shares_buy_format', { target: shares(row.targetShares), add: shares(row.incrementalShares ?? 0) })}</span>
              : side === 'sell' && row.sellShares !== undefined
                ? <span>{t('div_cs_shares_sell_format', { sell: shares(row.sellShares), pct: row.cumulativePortionBps / 100 })}</span>
                : <span>{t('div_cs_shares_portion_only', { pct: row.cumulativePortionBps / 100 })}</span>}
          </div>
        </li>;
      })}
    </ol>

    <details className="div-wb-disclosure">
      <summary>{t('div_new_basis')}</summary>
      <p className="div-muted">{t(`div_cs_origin_${plan.gridOrigin}`)}</p>
      <dl className="div-wb-stock-metrics">
        <div><dt>{t('div_cs_detail_dps')}</dt><dd>{plan.base.grossDpsMicros === undefined ? '—' : `¥${(plan.base.grossDpsMicros / 1e6).toFixed(4)}`}</dd>
          <small>{plan.base.grossDpsMicros === undefined ? t('div_cs_detail_dps_unavailable') : t('div_cs_detail_dps_sub', { net: ((plan.base.netDpsMicros ?? 0) / 1e6).toFixed(4), period: plan.base.periodLabel })}</small></div>
        {plan.base.cappedAtEarnings && plan.base.implementedDpsMicros !== undefined && plan.base.earningsCap && <div><dt>{t('div_classic_implemented_dividend')}</dt><dd>¥{(plan.base.implementedDpsMicros / 1e6).toFixed(4)}</dd>
          <small>{t('div_cs_detail_cap_sub', { cap: (plan.base.earningsCap.epsMicros / 1e6).toFixed(4), report: plan.base.earningsCap.reportDate })}</small></div>}
        {plan.neutralPriceMinor !== undefined && <div><dt>{t('div_cs_detail_anchor')}</dt><dd>{price(plan.neutralPriceMinor)}</dd>
          <small>{t('div_cs_detail_anchor_sub', { price: ((plan.grossNeutralPriceMinor ?? 0) / 100).toFixed(2) })}</small></div>}
      </dl>
      {plan.healthChecks.map(check => <p className="div-muted" key={check.key}>
        <strong>{i18n.language.startsWith('zh') ? check.labelZh : check.labelEn}</strong>{' · '}
        {i18n.language.startsWith('zh') ? check.detailZh : check.detailEn}
      </p>)}
      {plan.gridOrigin !== 'classic_saved' && plan.base.tier === 'recent_batches' && (preview ? <div className="div-wb-grid-preview">
        {custom && <p className="div-warning">{t('div_new_grid_replace')}</p>}
        <ul className="div-wb-grid-rows">
          {(['buy', 'sell'] as const).flatMap(value => {
            const active = value === 'buy' ? plan.buyRows : plan.sellRows;
            const generated = value === 'buy' ? plan.classicBuyLevels : plan.classicSellLevels;
            return Array.from({ length: Math.max(active.length, generated.length) }, (_, index) => (
              <li key={`${value}-${index}`} className="div-wb-tier-head">
                <strong>{t(`div_cs_${value}_tier_name`, { level: index + 1 })}</strong>
                <span>{custom ? `${price(active[index]?.priceMinor)} → ` : ''}{price(generated[index]?.priceMinor)}</span>
              </li>
            ));
          })}
        </ul>
        <div className="div-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onSaveGrid}>{t('div_new_confirm_grid')}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPreview(false)}>{t('cancel')}</button>
        </div>
      </div> : <button type="button" className="btn btn-secondary" onClick={() => setPreview(true)}>{t('div_new_preview_grid')}</button>)}
    </details>
  </>;
}
