import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateInChina } from '../lib/dividendWorkbench';
import { prepareDividendAdvisorContext } from '../services/dividendAdvisorContextService';
import { askDividendAdvisorWithActions, DividendAdvisorError, type DividendAdvisorConfig } from '../services/dividendAdvisorService';
import { loadDividendDailyAdvice, saveDividendDailyAdvice, type DividendDailyAdvice as Advice } from '../services/dividendDailyAdviceService';
import DividendAdvisorMarkdown from './DividendAdvisorMarkdown';

export default function DividendDailyAdvice({ config, disabled, amountVisible, planKey, onUpdated, onOpenSettings }: {
  config: DividendAdvisorConfig | null; disabled: boolean; amountVisible: boolean; planKey: string;
  onUpdated: () => Promise<unknown>; onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [phase, setPhase] = useState<'refreshing' | 'thinking' | ''>('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const mounted = useRef(false), lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true; mounted.current = true;
    void loadDividendDailyAdvice().then(value => { if (active) setAdvice(value); })
      .catch(() => { if (active) setError(t('div_ai_error_storage')); });
    return () => { active = false; mounted.current = false; controller.current?.abort(); };
  }, [t]);
  const generate = async () => {
    if (disabled || lock.current) return;
    if (!config) { onOpenSettings(); return; }
    const request = new AbortController();
    controller.current = request; lock.current = true; setPhase('refreshing'); setError(''); setExpanded(true);
    const active = () => mounted.current && controller.current === request && !request.signal.aborted;
    try {
      const context = await prepareDividendAdvisorContext(() => undefined);
      if (!active()) return;
      await onUpdated();
      if (!active()) return;
      setPhase('thinking');
      const result = await askDividendAdvisorWithActions(config, context, t('div_daily_question'), [], { language: i18n.language, signal: request.signal });
      if (!active()) return;
      const value: Advice = { answer: result.answer, generatedAt: context.generatedAt, language: i18n.language, planKey,
        refreshLimited: Boolean(context.coverage.quoteRefreshFailures || context.coverage.dividendRefreshFailures || context.coverage.missingQuotes
          || context.coverage.priorDateQuotes || context.dividendRefreshDeferredCodes.length) };
      setAdvice(value);
      await saveDividendDailyAdvice(value).catch(() => { if (active()) setError(t('div_daily_save_failed')); });
    } catch (cause) {
      if (active()) setError(cause instanceof DividendAdvisorError ? t(`div_ai_error_${cause.code.toLowerCase()}`, { defaultValue: t('div_ai_error_network') }) : t('div_ai_error_storage'));
    } finally {
      if (controller.current === request) { controller.current = null; lock.current = false; if (mounted.current) setPhase(''); }
    }
  };
  const cancel = () => { controller.current?.abort(); controller.current = null; lock.current = false; setPhase(''); setError(t('div_ai_error_cancelled')); };
  const oldDate = advice && dateInChina(new Date(advice.generatedAt)) !== dateInChina();
  const changed = advice && (advice.planKey !== planKey || advice.language !== i18n.language);
  return <section className="div-daily-advice" aria-labelledby="div-daily-title">
    <div className="div-daily-heading"><div><h3 id="div-daily-title">{t('div_daily_title')}</h3><p className="div-ai-muted">{t('div_daily_intro')}</p></div>
      <button type="button" className="btn btn-primary" disabled={disabled || !!phase || !amountVisible} onClick={() => void generate()}>{t(phase ? 'div_daily_loading' : advice ? 'div_daily_refresh' : 'div_daily_generate')}</button></div>
    {phase && <div className="div-daily-progress" role="status"><span>{t(phase === 'thinking' ? 'div_ai_thinking' : 'div_ai_refreshing')}</span><button type="button" className="div-advisor-text-button" onClick={cancel}>{t('div_ai_cancel')}</button></div>}
    {error && <p className="div-warning" role="alert">{error}</p>}
    {!amountVisible && <p className="div-ai-muted">{t('div_ai_reading_hidden')}</p>}
    {advice && amountVisible && <div className="div-daily-result">
      <div className="div-daily-result-heading"><small>{t('div_ai_answer_date', { time: new Date(advice.generatedAt).toLocaleString(i18n.language) })}</small><button type="button" className="div-advisor-text-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'div_home_collapse' : 'div_home_expand')}</button></div>
      {(oldDate || changed) && <p className="div-warning">{t(oldDate ? 'div_daily_old' : 'div_daily_changed')}</p>}
      <div hidden={!expanded}><DividendAdvisorMarkdown language={advice.language}>{advice.answer}</DividendAdvisorMarkdown>
        {advice.refreshLimited && <p className="div-ai-muted">{t('div_ai_refresh_limited')}</p>}</div>
    </div>}
  </section>;
}
