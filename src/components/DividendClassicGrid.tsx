import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { getClassicAdviceFacts } from '../lib/dividendClassicAdvice';
import {
  classicTierPriceForYield,
  type ClassicGridTierRow,
  type ClassicStockPlan,
} from '../lib/dividendClassicStrategy';
import {
  createEditableStockGridDraft,
  parseEditableStockGridDraft,
  updateEditableStockGridYield,
  type EditableStockGridDraft,
} from '../lib/dividendPlanTable';
import { stockBudgetMinor, type DividendStock, type GridLevel } from '../lib/dividendWorkbench';

const price = (minor?: number) => minor === undefined ? '—' : `¥${(minor / 100).toFixed(2)}`;
const percent = (bps?: number) => bps === undefined ? '—' : `${(bps / 100).toFixed(2)}%`;

export default function DividendClassicGrid({ plan, stock, facts, amountVisible, busy, onSaveGrid, onEditGrid }: {
  plan: ClassicStockPlan;
  stock?: DividendStock;
  facts: ReturnType<typeof getClassicAdviceFacts>;
  amountVisible: boolean;
  busy: boolean;
  onSaveGrid: () => void;
  onEditGrid?: (buyLevels?: GridLevel[], sellLevels?: GridLevel[]) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [side, setSide] = useState<'buy' | 'sell'>(() => facts.status === 'sell' ? 'sell' : 'buy');
  const [preview, setPreview] = useState(false);
  const [editingGrid, setEditingGrid] = useState(false);
  const [draft, setDraft] = useState<EditableStockGridDraft | null>(null);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const custom = plan.gridOrigin === 'custom_saved';
  const rows = side === 'buy' ? plan.buyRows : plan.sellRows;
  const shares = (value: number) => amountVisible ? value.toLocaleString(i18n.language, { maximumFractionDigits: 4 }) : '••••';
  const quoteSource = !facts.quoteCurrent && plan.quoteSource === 'live' ? 'cached' : plan.quoteSource;
  const netDps = plan.base.netDpsMicros;

  const describeRow = (row: ClassicGridTierRow) => {
    if (side === 'sell' && plan.shares <= 0) return t('div_new_grid_no_holding');
    if (side === 'buy' && plan.buyPaused) return t('div_new_status_paused');
    if (side === 'buy' && !plan.budgetMinor) return t('div_new_status_no_budget');
    if (!facts.quoteCurrent) return t('div_new_status_quote_unverified');
    if (row.touched && plan.base.tier !== 'recent_batches') return t('div_new_grid_reference');
    return t(row.status === 'triggered' ? 'div_new_grid_touched' : `div_cs_row_${row.status}`);
  };

  const startEdit = () => {
    setDraft(createEditableStockGridDraft(plan, stock));
    setEditError('');
    setEditingGrid(true);
  };

  const cancelEdit = () => {
    setEditingGrid(false);
    setDraft(null);
    setEditError('');
  };

  const saveEdit = async () => {
    if (!onEditGrid || !draft || savingEdit) return;
    const parsed = parseEditableStockGridDraft(draft, netDps);
    if (!parsed.ok) {
      setEditError(t(parsed.errorKey));
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      await onEditGrid(parsed.buyLevels, parsed.sellLevels);
      setEditingGrid(false);
      setDraft(null);
    } catch {
      setEditError(t('plan_grid_save_failed'));
    } finally {
      setSavingEdit(false);
    }
  };

  const resetEdit = async () => {
    if (!onEditGrid || savingEdit) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await onEditGrid(undefined, undefined);
      setEditingGrid(false);
      setDraft(null);
    } catch {
      setEditError(t('plan_grid_save_failed'));
    } finally {
      setSavingEdit(false);
    }
  };

  const recalcPrices = () => {
    if (!draft || !netDps || netDps <= 0) return;
    const recalcSide = (s: 'buy' | 'sell') => draft[s].map(r => {
      const y = Number(r.yieldText.trim());
      const bps = Number.isFinite(y) && y > 0 && y <= 100 ? Math.round(y * 100) : 0;
      return bps ? { ...r, priceText: (classicTierPriceForYield(s, netDps, bps) / 100).toFixed(2) } : r;
    });
    setDraft({ buy: recalcSide('buy'), sell: recalcSide('sell') });
  };

  const renderEditableList = () => {
    if (!draft) return null;
    const activeRows = draft[side];
    const sumPct = activeRows.reduce((sum, r) => sum + (Number.isFinite(Number(r.portionText)) ? Math.max(0, Number(r.portionText)) : 0), 0);
    let cumulativePortionBps = 0;
    let cumulativeBuySharesFloat = 0;
    return (
      <>
        <div className="div-wb-grid-toolbar">
          <span className={sumPct > 100.001 ? 'div-warning' : 'div-muted'}>
            {t(side === 'buy' ? 'plan_grid_side_buy_sum' : 'plan_grid_side_sell_sum', { pct: Number(sumPct.toFixed(2)) })}
          </span>
          {activeRows.length < 20 && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={savingEdit}
              onClick={() => setDraft(prev => prev ? ({
                ...prev,
                [side]: [
                  ...prev[side],
                  { key: `${side}-${Date.now()}-${prev[side].length}`, yieldText: side === 'buy' ? '6.0' : '4.2', priceText: '', portionText: '25' },
                ],
              }) : prev)}
            >
              {t(side === 'buy' ? 'plan_grid_add_buy' : 'plan_grid_add_sell')}
            </button>
          )}
        </div>
        <ol className="div-wb-grid-rows" aria-label={t(`div_new_grid_${side}`)}>
          {activeRows.map((row, index) => {
            const pNum = Number(row.portionText);
            const pBps = Number.isFinite(pNum) && pNum >= 0 ? Math.round(pNum * 100) : 0;
            cumulativePortionBps += pBps;
            const prNum = Number(row.priceText);
            const prMinor = Number.isFinite(prNum) && prNum > 0 ? Math.round(prNum * 100) : 0;
            if (side === 'buy' && plan.budgetMinor && plan.budgetMinor > 0 && prMinor > 0) {
              cumulativeBuySharesFloat += stockBudgetMinor(plan.budgetMinor, pBps) / prMinor;
            }
            const estBuyShares = side === 'buy' && plan.budgetMinor && plan.budgetMinor > 0
              ? Math.floor(cumulativeBuySharesFloat / plan.lotSize) * plan.lotSize
              : undefined;
            const estSellShares = side === 'sell' && plan.shares > 0
              ? cumulativePortionBps >= 10000
                ? plan.shares
                : Math.floor(((plan.shares * cumulativePortionBps) / 10000) / plan.lotSize) * plan.lotSize
              : undefined;
            return (
              <li key={row.key}>
                <div className="div-wb-tier-head">
                  <strong>{t(`div_cs_${side}_tier_name`, { level: index + 1 })}</strong>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    aria-label={t('plan_grid_delete_row')}
                    disabled={activeRows.length <= 1 || savingEdit}
                    onClick={() => setDraft(prev => prev ? ({
                      ...prev,
                      [side]: prev[side].filter((_, i) => i !== index),
                    }) : prev)}
                  >
                    ✕
                  </button>
                </div>
                <div className="div-wb-tier-edit-fields">
                  <label>
                    <span>{t('plan_col_point_price')} (¥)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      placeholder={netDps ? t('div_auto') : ''}
                      value={row.priceText}
                      onChange={e => setDraft(prev => prev ? ({
                        ...prev,
                        [side]: prev[side].map((r, i) => i === index ? { ...r, priceText: e.target.value } : r),
                      }) : prev)}
                    />
                  </label>
                  <label>
                    <span>{t('plan_col_yield')} (%)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={row.yieldText}
                      onChange={e => setDraft(prev => prev ? ({
                        ...prev,
                        [side]: prev[side].map((r, i) => i === index ? updateEditableStockGridYield(r, side, e.target.value, netDps) : r),
                      }) : prev)}
                    />
                  </label>
                  <label>
                    <span>{t('plan_grid_portion_col')}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={row.portionText}
                      onChange={e => setDraft(prev => prev ? ({
                        ...prev,
                        [side]: prev[side].map((r, i) => i === index ? { ...r, portionText: e.target.value } : r),
                      }) : prev)}
                    />
                  </label>
                </div>
                <div className="div-wb-tier-meta">
                  <span>{t('plan_grid_cum_preview', { pct: Number((cumulativePortionBps / 100).toFixed(2)) })}</span>
                  {side === 'buy' && estBuyShares !== undefined && (
                    <span>{t('div_cs_shares_buy_format', { target: shares(estBuyShares), add: shares(Math.max(0, estBuyShares - plan.shares)) })}</span>
                  )}
                  {side === 'sell' && estSellShares !== undefined && (
                    <span>{t('div_cs_shares_sell_format', { sell: shares(estSellShares), pct: cumulativePortionBps / 100 })}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {editError && <p className="div-warning" role="alert">{editError}</p>}
        <div className="div-actions div-wb-grid-edit-actions">
          <button type="button" className="btn btn-primary" disabled={savingEdit} onClick={() => void saveEdit()}>
            {savingEdit ? t('plan_saving') : t('plan_grid_save')}
          </button>
          <button type="button" className="btn btn-secondary" disabled={savingEdit} onClick={cancelEdit}>
            {t('cancel')}
          </button>
          {netDps !== undefined && netDps > 0 && (
            <button type="button" className="btn btn-secondary" disabled={savingEdit} onClick={recalcPrices}>
              {t('plan_grid_recalc_prices')}
            </button>
          )}
          {(stock?.buyLevels || stock?.sellLevels) && (
            <button type="button" className="btn btn-secondary" disabled={savingEdit} onClick={() => void resetEdit()}>
              {t('plan_grid_reset_default')}
            </button>
          )}
        </div>
      </>
    );
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
    <div className="div-wb-grid-toolbar">
      <p className="div-muted" style={{ margin: 0 }}>{t(custom ? 'div_new_grid_saved_note' : 'div_new_grid_net_note')}</p>
      {stock && onEditGrid && !editingGrid && (
        <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={startEdit}>
          {t('plan_grid_edit_inline')}
        </button>
      )}
    </div>

    {editingGrid ? renderEditableList() : (
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
    )}

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
