import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HOLDING_RECOGNITION_PROVIDERS, getHoldingRecognitionProvider, inferHoldingRecognitionProvider } from '../lib/holdingRecognitionProviders';
import { DIVIDEND_AI_CONFIG_CHANGED_EVENT } from '../lib/dividendAdvisorNavigation';
import { clearDividendAdvisorConfig, DividendAdvisorError, loadDividendAdvisorConfig, saveDividendAdvisorConfig, type DividendAdvisorConfig } from '../services/dividendAdvisorService';
import './HoldingRecognitionSettings.css';
import './DividendAdvisor.css';

const provider = getHoldingRecognitionProvider('aliyun');
const EMPTY_CONFIG: DividendAdvisorConfig = { provider: provider.id, protocol: provider.protocol, baseUrl: provider.baseUrl, model: provider.defaultModel, apiKey: '' };

export default function DividendAdvisorSettings({ focus = false }: { focus?: boolean }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const [config, setConfig] = useState<DividendAdvisorConfig>(EMPTY_CONFIG);
  const [saved, setSaved] = useState<DividendAdvisorConfig | null>(null);
  const [expanded, setExpanded] = useState(focus);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedProviderId = inferHoldingRecognitionProvider(config);
  const selectedProvider = getHoldingRecognitionProvider(selectedProviderId);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void loadDividendAdvisorConfig().then(value => {
      if (active && value) { setSaved(value); setConfig(value); }
    }).catch(() => { if (active) setError(t('div_ai_error_storage')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [t]);
  useEffect(() => {
    if (focus && !loading) { setExpanded(true); sectionRef.current?.scrollIntoView({ block: 'start' }); }
  }, [focus, loading]);

  const describeError = (cause: unknown) => cause instanceof DividendAdvisorError
    ? t(`div_ai_error_${cause.code.toLowerCase()}`, { defaultValue: t('div_ai_error_storage') }) : t('div_ai_error_storage');
  const save = async (clear = false) => {
    if (lock.current || loading) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (clear) await clearDividendAdvisorConfig();
      else await saveDividendAdvisorConfig(config);
      window.dispatchEvent(new CustomEvent(DIVIDEND_AI_CONFIG_CHANGED_EVENT));
      if (mounted.current) {
        setSaved(clear ? null : { ...config });
        if (clear) setConfig(EMPTY_CONFIG);
        setNotice(t(clear ? 'div_ai_config_cleared' : 'div_ai_config_saved'));
      }
    } catch (cause) { if (mounted.current) setError(describeError(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };

  return <section className="settings-section holding-recognition-settings" id="dividend-advisor-settings" ref={sectionRef}>
    <button type="button" className="settings-menu-summary holding-recognition-toggle" disabled={loading || busy}
      aria-expanded={expanded} aria-controls="dividend-advisor-config" onClick={() => setExpanded(value => !value)}>
      <span>{t('div_ai_settings_title')}</span><span className="settings-menu-value">{t(loading ? 'loading' : saved ? 'div_ai_ready' : 'div_ai_setup_needed')}<span className="settings-menu-chevron" aria-hidden="true">›</span></span>
    </button>
    <div id="dividend-advisor-config" hidden={!expanded}>
      <p className="holding-recognition-note">{t('div_ai_settings_description')}</p>
      <p className="holding-recognition-note">{t('div_ai_privacy')}</p>
      <p className="holding-recognition-note">{t('div_ai_sharing')}</p>
      <div className="form-group"><label className="form-label" htmlFor="div-ai-provider">{t('div_ai_provider')}</label>
        <select className="form-select" id="div-ai-provider" value={selectedProviderId} disabled={busy || loading} onChange={event => {
          const next = getHoldingRecognitionProvider(event.target.value);
          setConfig({ provider: next.id, protocol: next.protocol, baseUrl: next.baseUrl, model: next.defaultModel, apiKey: '' }); setNotice(''); setError('');
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
      <p className="holding-recognition-note">{t('div_ai_model_hint')}</p>
      <div className="holding-recognition-actions"><button className="btn btn-primary" disabled={busy || loading} onClick={() => void save()}>{t('holding_import_save_config')}</button>
        {saved && <button className="btn btn-secondary" disabled={busy || loading} onClick={() => void save(true)}>{t('holding_api_clear_config')}</button>}
      </div>
    </div>
    {error && <p className="holding-recognition-error" role="alert">{error}</p>}
    {notice && <p className="holding-recognition-note" role="status">{notice}</p>}
  </section>;
}
