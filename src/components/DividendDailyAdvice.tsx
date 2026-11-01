import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateInChina } from '../lib/dividendWorkbench';
import { dividendDailyCheckIsStale, dividendDailyCoverage, type DividendDailyCheck, type DividendDailyItem } from '../lib/dividendDailyCheck';
import { dividendCheckReasonLabel } from '../lib/dividendCheckLabels';
import { loadDividendAdvisorContext } from '../services/dividendAdvisorContextService';
import { askDividendAdvisorWithActions, type DividendAdvisorConfig } from '../services/dividendAdvisorService';
import { loadDividendDailyAdvice, loadDividendDailyChecks, type DividendDailyAdvice as Advice } from '../services/dividendDailyAdviceService';
import { dividendDailyCheckRunner, loadDividendDailyCheckSnapshot } from '../services/dividendDailyCheckService';
import DividendAdvisorMarkdown from './DividendAdvisorMarkdown';
import './DividendDailyAdvice.css';
import { addPortableSnapshotBackgroundListener } from '../native/portableSnapshot';

export default function DividendDailyAdvice({ config, disabled, amountVisible, planKey, onUpdated, onOpenSettings, onOpenItem }: {
  config: DividendAdvisorConfig | null; disabled: boolean; amountVisible: boolean; planKey: string;
  onUpdated: () => Promise<unknown>; onOpenSettings: () => void; onOpenItem: (item: DividendDailyItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const [current, setCurrent] = useState<DividendDailyCheck | null>(null);
  const [completed, setCompleted] = useState<DividendDailyCheck | null>(null);
  const [local, setLocal] = useState<DividendDailyItem[]>([]);
  const [legacy, setLegacy] = useState<Advice | null>(null);
  const [running, setRunning] = useState(false), [explaining, setExplaining] = useState(false);
  const [ready, setReady] = useState(false);
  const [explanation, setExplanation] = useState(''), [error, setError] = useState('');
  const mounted = useRef(false), lock = useRef(false);
  const checkController = useRef<AbortController | null>(null), explanationController = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true; mounted.current = true;
    void Promise.all([loadDividendDailyChecks(), loadDividendDailyAdvice(), loadDividendDailyCheckSnapshot()]).then(([saved, old, snapshot]) => {
      if (!active) return;
      const restored = saved.current?.status === 'running' ? { ...saved.current, status: 'partial' as const,
        errors: [...saved.current.errors, 'interrupted'], sources: saved.current.sources.map(source => source.status === 'pending' ? { ...source, status: 'deferred' as const, detail: 'interrupted' } : source) } : saved.current;
      setCurrent(restored); setCompleted(saved.completed); setLegacy(old); setLocal(snapshot.items);
    }).catch(() => { if (active) setError(t('div_ai_error_storage')); }).finally(() => { if (active) setReady(true); });
    const stop = () => { checkController.current?.abort(); explanationController.current?.abort(); };
    const visibility = () => { if (document.visibilityState === 'hidden') stop(); };
    let nativeListener: Awaited<ReturnType<typeof addPortableSnapshotBackgroundListener>>;
    void addPortableSnapshotBackgroundListener(stop).then(listener => { if (active) nativeListener = listener; else void listener?.remove(); }).catch(() => undefined);
    window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', visibility);
    return () => { active = false; mounted.current = false; stop(); void nativeListener?.remove(); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', visibility); };
  }, [t]);
  useEffect(() => { if (disabled) { checkController.current?.abort(); explanationController.current?.abort(); } }, [disabled]);
  useEffect(() => {
    if (!amountVisible || explanationController.current && current?.planKey !== planKey) {
      explanationController.current?.abort(); setExplanation('');
    }
  }, [amountVisible, planKey]);
  const generate = async (retryKey?: string) => {
    if (disabled || !ready || lock.current || !amountVisible) return;
    const request = new AbortController(); checkController.current = request; lock.current = true;
    explanationController.current?.abort(); setExplanation(''); setError(''); setRunning(true);
    const active = () => mounted.current && checkController.current === request;
    try {
      const result = await dividendDailyCheckRunner.run({ signal: request.signal,
        previous: retryKey && current ? current : undefined, retryKeys: retryKey ? [retryKey] : undefined,
        onUpdate: value => { if (active()) setCurrent(value); } });
      if (active()) { setCurrent(result); if (result.status === 'completed') setCompleted(result); }
      await onUpdated();
    } catch { if (active()) setError(t('div_s3_check_failed')); }
    finally { if (checkController.current === request) { checkController.current = null; lock.current = false; if (mounted.current) setRunning(false); } }
  };
  const explain = async () => {
    if (running || explaining || !current || !amountVisible) return;
    const request = new AbortController(); explanationController.current = request; setExplaining(true); setError('');
    const active = () => mounted.current && explanationController.current === request && !request.signal.aborted;
    try {
      const snapshot = await loadDividendDailyCheckSnapshot();
      if (!active()) return;
      if (snapshot.planKey !== current.planKey || dividendDailyCheckIsStale(current, snapshot.planKey)) { setError(t('div_s3_stale')); return; }
      const context = await loadDividendAdvisorContext();
      if (!active()) return;
      const result = await askDividendAdvisorWithActions(config, context, t('div_s3_explain_question'), [], { signal: request.signal, language: i18n.language,
        onLocalResult: result => { if (active()) setExplanation(result.answer); } });
      if (active()) setExplanation(result.answer);
    } catch { if (active()) setError(t('div_s3_explain_failed')); }
    finally { if (explanationController.current === request) { explanationController.current = null; if (mounted.current) setExplaining(false); } }
  };
  const time = (at: number) => new Date(at).toLocaleString(i18n.language);
  const price = (minor?: number, micros?: number) => micros !== undefined ? `¥${(micros / 1e6).toLocaleString(i18n.language, { maximumFractionDigits: 6 })}`
    : minor !== undefined ? `¥${(minor / 100).toLocaleString(i18n.language, { maximumFractionDigits: 2 })}` : '—';
  const target = (item: DividendDailyItem, side: 'buy' | 'sell') => {
    const tier = side === 'buy' ? item.nextBuy : item.nextSell;
    const state = side === 'buy' ? item.nextBuyState : item.nextSellState;
    const quantity = side === 'buy' ? tier?.targetShares : tier?.sellShares;
    return tier ? `${item.kind === 'stock' ? t('div_read_original_tier', { level: tier.index }) + ' · ' : ''}${price(tier.priceMinor, tier.priceMicros)}${tier.basis === 'price_reference' ? ` (${t('div_read_price_reference')})` : quantity !== undefined ? ` · ${t(side === 'buy' ? 'div_read_target_shares' : 'div_read_sell_shares', { shares: quantity.toLocaleString(i18n.language) })}` : ''}`
      : state ? t(`div_read_next_${state}`) : t('div_s3_reference_unknown');
  };
  const list = (items: DividendDailyItem[], check?: DividendDailyCheck, allowRetry = false) => <div className="div-daily-groups">{(['review', 'unknown', 'wait'] as const).map(bucket => {
    const rows = items.filter(item => item.bucket === bucket);
    return <details key={bucket} className={`div-daily-group is-${bucket}`} open={bucket !== 'wait'}><summary>{t(`div_s3_group_${bucket}`)} <span>{rows.length}</span></summary>
      {!rows.length && <p className="div-ai-muted">{t('div_s3_group_empty')}</p>}
      <ul>{rows.map(item => <li key={item.key} data-check-key={item.key}>
        <div className="div-daily-item-heading"><strong>{item.name} <small>{item.code ?? t('div_read_code_unknown')}</small></strong><small>{t(item.stale ? 'div_s3_item_stale' : item.checkedAt ? 'div_s3_item_checked' : 'div_s3_item_provisional')}</small></div>
        <p className="div-daily-item-quote">{price(item.quote.priceMinor, item.quote.priceMicros)} · {t(item.quote.status === 'current' ? 'div_read_quote_current' : 'div_read_quote_reference')}
          <small>{t('div_read_market_source')} · {item.quote.date ?? t('div_check_quote_unknown')}</small></p>
        <p>{t(item.kind === 'stock' ? 'div_read_next_buy' : 'div_read_fund_entry')}: {target(item, 'buy')}<br />{t(item.kind === 'stock' ? 'div_read_next_sell' : 'div_read_fund_exit')}: {target(item, 'sell')}</p>
        <p>{t('div_check_buy')} · {t(`div_check_action_${item.actions.buy.status}`)} / {t('div_check_sell')} · {t(`div_check_action_${item.actions.sell.status}`)}</p>
        {item.reasons.length > 0 && <ul className="div-daily-reasons">{item.reasons.map(reason => <li key={reason}>{dividendCheckReasonLabel(reason, item.eligibility, t, key => i18n.exists(key))}</li>)}</ul>}
        <div className="div-daily-item-actions"><button type="button" className="div-advisor-text-button" onClick={() => onOpenItem(item)}>{t('div_s3_open_item')}</button>
          {allowRetry && check?.sources.some(source => source.itemKey === item.key && ['failed', 'deferred'].includes(source.status)) && <button type="button" className="div-advisor-text-button div-daily-retry" disabled={running || disabled} onClick={() => void generate(item.key)}>{t('div_s3_retry')}</button>}</div>
      </li>)}</ul>
    </details>;
  })}</div>;
  const coverage = current && dividendDailyCoverage(current.sources);
  const stale = current && dividendDailyCheckIsStale(current, planKey);
  return <section className="div-daily-advice" aria-labelledby="div-daily-title">
    <div className="div-daily-heading"><div><h3 id="div-daily-title">{t('div_s3_title')}</h3><p className="div-ai-muted">{t('div_s3_intro')}</p></div>
      <button type="button" className="btn btn-primary div-daily-generate" disabled={disabled || !ready || running || !amountVisible} onClick={() => void generate()}>{t(running ? 'div_s3_running' : current ? 'div_s3_refresh' : 'div_s3_generate')}</button></div>
    {error && <p className="div-warning" role="alert">{error}</p>}
    {!amountVisible && <p className="div-ai-muted">{t('div_ai_reading_hidden')}</p>}
    {running && <div className="div-daily-progress" role="status"><span>{t('div_s3_deadline', { time: current ? time(current.deadlineAt) : '—' })}</span><button type="button" className="div-advisor-text-button div-daily-cancel" onClick={() => checkController.current?.abort()}>{t('div_ai_cancel')}</button></div>}
    {amountVisible && <>
      {current ? <div className="div-daily-result">
        <div className="div-daily-result-heading"><strong role="status">{t(`div_s3_status_${current.status}`)}</strong><small>{t('div_s3_batch', { id: current.batchId.slice(0, 8) })} · {time(current.startedAt)}{current.finishedAt && ` → ${time(current.finishedAt)}`}</small></div>
        {stale && !running && <p className="div-warning">{t('div_s3_stale')}</p>}
        {current.status !== 'completed' && <p className="div-ai-muted">{t(running ? 'div_s3_provisional' : 'div_s3_partial_note')}</p>}
        {['cancelled', 'timed_out'].includes(current.status) && <p className="div-ai-muted">{t('div_s3_detached_note')}</p>}
        {current.errors.map(key => <p key={key} className="div-warning">{t(`div_s3_error_${key}`, { defaultValue: t('div_s3_check_failed') })}</p>)}
        <details className="div-daily-stage-details" open={running}><summary>{t('div_s3_progress')} · {t('div_s3_checked', { done: current.checkedKeys.length, total: current.items.length })}</summary>
        <ol className="div-daily-stages" aria-label={t('div_s3_progress')}>{(['quotes', 'evidence', 'plans', 'result'] as const).map(stage => {
          const counts = dividendDailyCoverage(current.sources, stage);
          return <li key={stage} aria-current={running && stage === current.stage ? 'step' : undefined}><strong>{t(`div_s3_stage_${stage}`)}</strong>
            <small>{stage === 'result' ? t('div_s3_checked', { done: current.checkedKeys.length, total: current.items.length }) : t('div_s3_coverage', counts)}</small></li>;
        })}</ol></details>
        <p className="div-ai-muted">{t('div_s3_coverage', coverage!)} · {t('div_s3_coverage_unit')}</p>
        <p className="div-daily-observation-note">{t('div_s3_observation_note')}</p>
        {list(current.items, current, !running)}
        <details className="div-daily-sources"><summary>{t('div_s3_sources')}</summary><ul>{current.sources.filter(source => !source.id.endsWith(':research') || source.status === 'pending').sort((a, b) => Number(a.status === 'success') - Number(b.status === 'success') || a.itemKey.localeCompare(b.itemKey)).map(source => <li key={source.id}>
          <strong>{current.items.find(item => item.key === source.itemKey)?.name ?? t('div_s3_market')} · {source.provider} · {t(`div_s3_source_${source.status}`)}</strong>
          {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer">{t('div_check_source', { index: current.sources.indexOf(source) + 1 })}</a>}
          {source.sourceDate && <span>{t('div_s3_source_date', { date: source.sourceDate })}</span>}
          {source.verifiedDates?.length ? <span>{t('div_check_verified_date', { date: source.verifiedDates.join(' / ') })}</span> : null}
          {source.detail && <small>{t('div_s3_source_detail', { detail: t(`div_s3_detail_${source.detail}`, { defaultValue: source.detail }) })}</small>}
        </li>)}</ul></details>
        {!running && <div className="div-daily-explanation"><button type="button" className="div-advisor-text-button" disabled={explaining || stale || disabled} onClick={() => void explain()}>{t(explaining ? 'div_ai_thinking' : 'div_s3_explain')}</button>
          {explaining && <button type="button" className="div-advisor-text-button" onClick={() => explanationController.current?.abort()}>{t('div_ai_cancel')}</button>}
          {!config && <button type="button" className="div-advisor-text-button" onClick={onOpenSettings}>{t('div_ai_go_settings')}</button>}
          {explanation && <DividendAdvisorMarkdown language={i18n.language}>{explanation}</DividendAdvisorMarkdown>}</div>}
      </div> : <details className="div-daily-local"><summary>{t('div_s3_local', { count: local.length })}</summary>{list(local)}</details>}
      {completed && completed.batchId !== current?.batchId && <details className="div-daily-previous"><summary>{t('div_s3_previous', { time: time(completed.finishedAt ?? completed.startedAt) })}</summary>
        {dividendDailyCheckIsStale(completed, planKey) && <p className="div-warning">{t('div_s3_stale')}</p>}{list(completed.items)}</details>}
      {legacy && <details className="div-daily-legacy"><summary>{t('div_s3_legacy', { time: new Date(legacy.generatedAt).toLocaleString(i18n.language) })}</summary>
        {(dateInChina(new Date(legacy.generatedAt)) !== dateInChina() || legacy.planKey !== planKey) && <p className="div-warning">{t('div_s3_stale')}</p>}<DividendAdvisorMarkdown language={legacy.language}>{legacy.answer}</DividendAdvisorMarkdown></details>}
    </>}
  </section>;
}
