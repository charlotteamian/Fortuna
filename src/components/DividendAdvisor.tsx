import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HOLDING_RECOGNITION_PROVIDERS, getHoldingRecognitionProvider, inferHoldingRecognitionProvider } from '../lib/holdingRecognitionProviders';
import type { DividendAdvisorContext, DividendAdvisorMessage } from '../lib/dividendAdvisor';
import { askDividendAdvisor, clearDividendAdvisorConfig, DividendAdvisorError, loadDividendAdvisorConfig, saveDividendAdvisorConfig, type DividendAdvisorConfig } from '../services/dividendAdvisorService';
import { prepareDividendAdvisorContext } from '../services/dividendAdvisorContextService';
import './DividendAdvisor.css';

const provider = getHoldingRecognitionProvider('aliyun');
const EMPTY_CONFIG: DividendAdvisorConfig = { provider: provider.id, protocol: provider.protocol, baseUrl: provider.baseUrl, model: provider.defaultModel, apiKey: '' };
const QUICK_QUESTIONS = ['actions', 'allocation', 'explain'] as const;

export default function DividendAdvisor({ onUpdated, amountVisible }: { onUpdated: () => Promise<unknown>; amountVisible: boolean }) {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<DividendAdvisorConfig>(EMPTY_CONFIG);
  const [saved, setSaved] = useState<DividendAdvisorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'refreshing' | 'thinking' | ''>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [messages, setMessages] = useState<DividendAdvisorMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [snapshot, setSnapshot] = useState<DividendAdvisorContext | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const answerEnd = useRef<HTMLDivElement>(null);
  const selectedProviderId = inferHoldingRecognitionProvider(config);
  const selectedProvider = getHoldingRecognitionProvider(selectedProviderId);
  const configuredLabel = saved ? `${t(getHoldingRecognitionProvider(inferHoldingRecognitionProvider(saved)).nameKey)} · ${saved.model}` : t('div_ai_not_configured');

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void loadDividendAdvisorConfig().then(value => { if (active && value) { setSaved(value); setConfig(value); } })
      .catch(() => { if (active) setError(t('div_ai_error_storage')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; controller.current?.abort(); };
  }, [t]);
  useEffect(() => { if (messages.length) answerEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  const describeError = (cause: unknown) => cause instanceof DividendAdvisorError
    ? t(`div_ai_error_${cause.code.toLowerCase()}`, { defaultValue: t('div_ai_error_network') }) : t('div_ai_error_storage');
  const saveConfig = async () => {
    if (lock.current || loading) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await saveDividendAdvisorConfig(config);
      if (mounted.current) { setSaved({ ...config }); setConfigOpen(false); setNotice(t('div_ai_config_saved')); }
    } catch (cause) { if (mounted.current) setError(describeError(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const clearConfig = async () => {
    if (lock.current || loading) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await clearDividendAdvisorConfig();
      if (mounted.current) { setSaved(null); setConfig(EMPTY_CONFIG); setMessages([]); setSnapshot(null); setLastQuestion(''); setNotice(t('div_ai_config_cleared')); }
    } catch (cause) { if (mounted.current) setError(describeError(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const ask = async (value = question) => {
    const prompt = value.trim();
    if (lock.current || loading || !prompt) return;
    if (!saved) { setConfigOpen(true); setError(t('div_ai_error_config')); return; }
    lock.current = true;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true); setPhase('refreshing'); setProgress(null); setError(''); setNotice(''); setLastQuestion(prompt);
    try {
      const context = await prepareDividendAdvisorContext((done, total) => { if (mounted.current) setProgress({ done, total }); });
      if (!mounted.current || requestController.signal.aborted) return;
      setSnapshot(context); setPhase('thinking');
      await onUpdated();
      if (!mounted.current || requestController.signal.aborted) return;
      const answer = await askDividendAdvisor(saved, context, prompt, messages, { language: i18n.language, signal: requestController.signal });
      if (mounted.current && !requestController.signal.aborted) {
        setMessages(current => [...current, { role: 'user', content: prompt }, { role: 'assistant', content: answer }].slice(-12) as DividendAdvisorMessage[]);
        setQuestion(''); setLastQuestion('');
      }
    } catch (cause) { if (mounted.current && !requestController.signal.aborted) setError(describeError(cause)); }
    finally {
      lock.current = false;
      if (controller.current === requestController) controller.current = null;
      if (mounted.current) { setBusy(false); setPhase(''); setProgress(null); }
    }
  };

  return <details className="div-advisor" aria-labelledby="div-ai-title" onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open && !saved && !loading) setConfigOpen(true);
  }}>
    <summary className="div-advisor-heading"><div><span className="div-advisor-eyebrow">{t('div_ai_eyebrow')}</span><h2 id="div-ai-title">{t('div_ai_title')}</h2><small>{loading ? t('loading') : configuredLabel}</small><p>{t('div_ai_collapsed_hint')}</p></div><span className="div-advisor-badge" aria-hidden="true">AI</span></summary>
    <div className="div-advisor-body">
    <p className="div-muted">{t('div_ai_description')}</p>
    <details className="div-advisor-config" open={configOpen} onToggle={event => setConfigOpen(event.currentTarget.open)}>
      <summary><span>{t('div_ai_model_settings')}</span><small>{loading ? t('loading') : configuredLabel}</small></summary>
      <div className="div-advisor-config-body">
        <p className="div-muted">{t('div_ai_privacy')}</p>
        <div className="form-group"><label className="form-label" htmlFor="div-ai-provider">{t('div_ai_provider')}</label>
          <select className="form-select" id="div-ai-provider" value={selectedProviderId} disabled={busy || loading} onChange={event => {
            const next = getHoldingRecognitionProvider(event.target.value);
            setConfig({ provider: next.id, protocol: next.protocol, baseUrl: next.baseUrl, model: next.defaultModel, apiKey: '' }); setNotice('');
          }}>{HOLDING_RECOGNITION_PROVIDERS.map(item => <option key={item.id} value={item.id}>{t(item.nameKey)}</option>)}</select>
        </div>
        <div className="form-group"><label className="form-label" htmlFor="div-ai-protocol">{t('holding_import_api_protocol')}</label>
          <select className="form-select" id="div-ai-protocol" value={config.protocol} disabled={busy || loading} onChange={event => setConfig(current => ({ ...current, protocol: event.target.value as DividendAdvisorConfig['protocol'] }))}>
            <option value="openai">{t('holding_import_api_openai')}</option><option value="gemini">{t('holding_import_api_gemini')}</option><option value="anthropic">{t('holding_import_api_anthropic')}</option>
          </select>
        </div>
        {(['baseUrl', 'model', 'apiKey'] as const).map(field => <div className="form-group" key={field}>
          <label className="form-label" htmlFor={`div-ai-${field}`}>{t(field === 'model' ? 'div_ai_model' : `holding_import_api_${field}`)}</label>
          <input className="form-input" id={`div-ai-${field}`} disabled={busy || loading} autoComplete="off" spellCheck={false}
            type={field === 'apiKey' ? 'password' : field === 'baseUrl' ? 'url' : 'text'} value={config[field]}
            placeholder={t(field === 'model' && selectedProviderId === 'volcengine' ? 'holding_import_volcengine_model_ph' : `holding_import_api_${field}_ph`)}
            onChange={event => setConfig(current => ({ ...current, [field]: event.target.value }))} />
          {field === 'model' && selectedProvider.models.length > 0 && <select className="form-select div-advisor-presets" aria-label={t('div_ai_model_presets')} disabled={busy || loading}
            value={selectedProvider.models.includes(config.model) ? config.model : ''} onChange={event => { if (event.target.value) setConfig(current => ({ ...current, model: event.target.value })); }}>
            <option value="">{t('holding_import_model_custom')}</option>{selectedProvider.models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>}
        </div>)}
        <p className="div-muted">{t('div_ai_model_hint')}</p>
        <div className="div-actions"><button className="btn btn-primary" disabled={busy || loading} onClick={() => void saveConfig()}>{t('holding_import_save_config')}</button>
          {saved && <button className="btn btn-secondary" disabled={busy || loading} onClick={() => void clearConfig()}>{t('holding_api_clear_config')}</button>}
        </div>
      </div>
    </details>
    <p className="div-advisor-sharing">{t('div_ai_sharing')}</p>
    <div className="div-advisor-quick" aria-label={t('div_ai_quick_questions')}>{QUICK_QUESTIONS.map(key => <button className="btn btn-secondary" key={key} disabled={busy || loading}
      onClick={() => void ask(t(`div_ai_question_${key}`))}>{t(`div_ai_quick_${key}`)}</button>)}</div>
    {messages.length > 0 && !amountVisible && <p className="div-muted" role="status">{t('div_ai_amounts_hidden')}</p>}
    {messages.length > 0 && amountVisible && <div className="div-advisor-conversation" role="log" aria-label={t('div_ai_conversation')} aria-live="polite">{messages.map((message, index) => <article className={`div-advisor-message ${message.role}`} key={index}>
      <strong>{t(message.role === 'user' ? 'div_ai_you' : 'div_ai_title')}</strong><div>{message.content}</div>
    </article>)}<div ref={answerEnd} /></div>}
    {snapshot && <div className="div-advisor-data"><p>{t('div_ai_snapshot_time', { time: new Date(snapshot.generatedAt).toLocaleString(i18n.language) })}</p>
      {(snapshot.coverage.quoteRefreshFailures > 0 || snapshot.coverage.dividendRefreshFailures > 0) && <p className="div-warning">{t('div_ai_source_failures', { quotes: snapshot.coverage.quoteRefreshFailures, dividends: snapshot.coverage.dividendRefreshFailures })}</p>}
      {snapshot.dividendRefreshDeferredCodes.length > 0 && <p className="div-warning">{t('div_ai_dividends_deferred', { count: snapshot.dividendRefreshDeferredCodes.length })}</p>}
      {(snapshot.coverage.priorDateQuotes > 0 || snapshot.coverage.manualFundReferences > 0) && <p>{t('div_ai_dated_inputs', { quotes: snapshot.coverage.priorDateQuotes, references: snapshot.coverage.manualFundReferences })}</p>}
      {amountVisible && <details><summary>{t('div_ai_view_data')}</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details>}
    </div>}
    <form className="div-advisor-question" onSubmit={event => { event.preventDefault(); void ask(); }}>
      <label className="form-label" htmlFor="div-ai-question">{t('div_ai_question_label')}</label>
      <textarea className="form-input" id="div-ai-question" rows={3} maxLength={2000} disabled={busy || loading} value={question} placeholder={t('div_ai_question_placeholder')} onChange={event => setQuestion(event.target.value)} />
      <div className="div-actions"><button type="submit" className="btn btn-primary" disabled={busy || loading || !question.trim()}>{t(busy ? 'loading' : 'div_ai_send')}</button>
        {messages.length > 0 && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setMessages([]); setSnapshot(null); setError(''); setLastQuestion(''); }}>{t('div_ai_clear_chat')}</button>}
      </div>
    </form>
    {phase && <p role="status" className="div-advisor-status">{t(phase === 'thinking' ? 'div_ai_thinking' : 'div_ai_refreshing')}{phase === 'refreshing' && progress ? ` ${progress.done} / ${progress.total}` : ''}</p>}
    {notice && <p className="div-notice" role="status">{notice}</p>}
    {error && <div className="div-warning" role="alert"><p>{error}</p>{lastQuestion && saved && <button className="btn btn-secondary" disabled={busy} onClick={() => void ask(lastQuestion)}>{t('div_ai_retry')}</button>}</div>}
    </div>
  </details>;
}
