import { useTranslation } from 'react-i18next';
import type { DividendLedger, DividendLedgerBase, DividendLedgerEvent } from '../lib/dividendLedger';
import './DividendLedgerView.css';

const ISSUE_KEYS: Record<string, string> = {
  SOURCE_PAGES_INCOMPLETE: 'div_ledger_issue_source_pages', FREQUENCY_UNKNOWN: 'div_ledger_issue_frequency', INCOMPLETE: 'div_ledger_issue_incomplete',
  PROPOSAL_NOT_COUNTED: 'div_ledger_issue_proposal', SOURCE_CONFLICT: 'div_ledger_issue_conflict', ANNOUNCEMENT_UNVERIFIED: 'div_ledger_issue_announcement',
  CAPITAL_OR_CASH_UNVERIFIED: 'div_ledger_issue_capital_cash', CROSSCHECK_MISSING: 'div_ledger_issue_crosscheck_missing', CROSSCHECK_MISMATCH: 'div_ledger_issue_crosscheck_mismatch',
  EVENT_FIELDS_INCOMPLETE: 'div_ledger_issue_fields', CAPITAL_ACTIONS_UNVERIFIED: 'div_ledger_issue_capital', EVENT_DATES_INVALID: 'div_ledger_issue_dates', OFFICIAL_EVIDENCE_INVALID: 'div_ledger_issue_official',
};
const sourceUrl = (value: string) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };

export default function DividendLedgerView({ ledger, base }: { ledger: DividendLedger; base?: DividendLedgerBase }) {
  const { t, i18n } = useTranslation();
  const number = (value: number, digits = 6) => value.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  const cash = (value?: number) => value === undefined ? t('div_ledger_pending') : t('div_ledger_cash', { amount: number(value / 1e6) });
  const shares = (value?: number) => value === undefined ? t('div_ledger_pending') : t('div_ledger_shares', { amount: number(value / 1000, 3) });
  const selected = new Set(base?.selectedBatchIds ?? []);
  const isImplemented = (event: DividendLedgerEvent) => event.implemented && !!event.exDate && event.exDate <= ledger.asOf;
  const implemented = ledger.events.filter(isImplemented);
  const forward = ledger.events.filter(event => !isImplemented(event) && event.stage === 'proposal' && !!event.announcementDate && event.announcementDate <= ledger.asOf);
  const unresolved = ledger.events.filter(event => !isImplemented(event) && !forward.includes(event));
  const issueLabels = (issues: string[]) => [...new Set(issues.map(issue => ISSUE_KEYS[issue] ?? 'div_ledger_issue_other'))];
  const flags = issueLabels([...(base?.flags ?? []), ...ledger.issues]);
  const eventCard = (event: DividendLedgerEvent) => {
    const counted = selected.has(event.batchId) && !!base?.verified && isImplemented(event) && event.verification === 'verified' && event.normalizedDpsMicros !== undefined;
    return <li className={`div-ledger-event ${event.verification}${counted ? ' is-selected' : ''}`} key={event.id}>
      <div className="div-ledger-event-heading"><strong>{event.reportDate ?? t('div_ledger_pending')} · {t(`div_ledger_period_${event.period}`)}</strong>
        <span>{t(`div_ledger_stage_${event.stage ?? 'unknown'}`)}</span>
        <span className={`div-ledger-verification ${event.verification}`}>{t(`div_ledger_verification_${event.verification}`)}</span></div>
      {selected.has(event.batchId) && <p className="div-ledger-selection">{t(counted ? 'div_ledger_selected' : 'div_ledger_selected_pending')}</p>}
      <dl className="div-ledger-dates">{([['announcementDate', 'div_ledger_announcement_date'], ['recordDate', 'div_ledger_record_date'], ['exDate', 'div_ledger_ex_date']] as const).map(([key, label]) => <div key={key}>
        <dt>{t(label)}</dt><dd>{event[key] ?? t('div_ledger_pending')}</dd>
      </div>)}</dl>
      <dl className="div-ledger-amounts"><div><dt>{t('div_ledger_cash_per_10')}</dt><dd>{cash(event.cashPer10Micros)}</dd></div>
        <div><dt>{t('div_ledger_normalized')}</dt><dd>{isImplemented(event) ? cash(event.normalizedDpsMicros) : t('div_ledger_not_counted')}</dd></div>
        <div><dt>{t('div_ledger_bonus_per_10')}</dt><dd>{shares(event.bonusPer10Bps)}</dd></div><div><dt>{t('div_ledger_transfer_per_10')}</dt><dd>{shares(event.transferPer10Bps)}</dd></div>
        <div><dt>{t('div_ledger_share_factor')}</dt><dd>{event.shareFactor === undefined ? t('div_ledger_pending') : `×${number(event.shareFactor)}`}</dd></div></dl>
      {event.issues.length > 0 && <ul className="div-ledger-issues">{issueLabels(event.issues).map(key => <li key={key}>{t(key)}</li>)}</ul>}
      <div className="div-ledger-sources"><span>{t('div_ledger_sources')}</span><ul>{event.sources.map((source, index) => {
        const href = sourceUrl(source.url), label = t(`div_ledger_source_${source.provider}`);
        return <li key={`${source.provider}-${index}`}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label} · {t('div_ledger_source_unavailable')}</span>}
          <small>{t('div_ledger_source_announcement', { date: source.announcementDate ?? t('div_ledger_pending') })}</small>
          <small>{t('div_ledger_source_verified', { date: source.verifiedAt ?? t('div_ledger_pending') })}</small>
        </li>;
      })}</ul>{!event.sources.length && <p>{t('div_ledger_source_unavailable')}</p>}</div>
    </li>;
  };
  return <section className="div-ledger" aria-label={t('div_ledger_title')}>
    <h4>{t('div_ledger_title')}</h4><p className="div-ledger-caption">{t('div_ledger_intro')}</p><p className="div-ledger-caption">{t('div_ledger_asof', { date: ledger.asOf })}</p>
    {base && <div className={`div-ledger-summary${base.verified ? ' is-verified' : ''}`}>
      <strong>{t(base.verified ? 'div_ledger_base_verified' : 'div_ledger_base_unverified')}</strong>
      <dl><div><dt>{t('div_ledger_base')}</dt><dd>{cash(base.dpsMicros)}</dd></div><div><dt>{t('div_ledger_frequency')}</dt><dd>{t(`div_ledger_frequency_${base.frequency}`)}</dd></div></dl>
      <p>{t('div_ledger_base_asof', { date: base.asOf })}{base.requiredBatches > 0 && ` · ${t('div_ledger_batches', { count: base.selectedBatchIds.length, required: base.requiredBatches })}`}</p>
      {base.reportPeriods.length > 0 && <p>{t('div_ledger_selected_periods', { periods: base.reportPeriods.join(' / ') })}</p>}
      {base.crosscheckDpsMicros !== undefined && <p>{t('div_ledger_crosscheck')}：{cash(base.crosscheckDpsMicros)}{base.crosscheckDeviationBps !== undefined && ` · ${t('div_ledger_crosscheck_gap', { percent: number(base.crosscheckDeviationBps / 100, 2) })}`}</p>}
    </div>}
    {flags.length > 0 && <ul className="div-ledger-issues div-ledger-base-flags">{flags.map(key => <li key={key}>{t(key)}</li>)}</ul>}
    <p className="div-ledger-caption">{t('div_ledger_normalization_note')}</p>
    {([{ key: 'implemented', events: implemented }, { key: 'forward', events: forward }, { key: 'unresolved', events: unresolved }] as const).filter(group => group.events.length).map(group => <section className={`div-ledger-group ${group.key}`} key={group.key}>
      <h5>{t(`div_ledger_${group.key}`)} <span>{group.events.length}</span></h5>{group.key !== 'implemented' && <p className="div-ledger-caption">{t(`div_ledger_${group.key}_note`)}</p>}
      <ol className="div-ledger-events">{group.events.map(eventCard)}</ol>
    </section>)}
    {!ledger.events.length && <p className="div-ledger-caption">{t('div_ledger_empty')}</p>}
  </section>;
}
