import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadHoldingRecognitionConfig, saveHoldingRecognitionConfig, clearHoldingRecognitionConfig,
  type HoldingRecognitionConfig,
} from '../services/holdingRecognitionService';
import {
  HOLDING_RECOGNITION_PROVIDERS, getHoldingRecognitionProvider, inferHoldingRecognitionProvider,
} from '../lib/holdingRecognitionProviders';
import './HoldingRecognitionSettings.css';

const DEFAULT_PROVIDER = getHoldingRecognitionProvider('aliyun');
const EMPTY_CONFIG: HoldingRecognitionConfig = {
  provider: DEFAULT_PROVIDER.id, protocol: DEFAULT_PROVIDER.protocol,
  baseUrl: DEFAULT_PROVIDER.baseUrl, model: DEFAULT_PROVIDER.defaultModel, apiKey: '',
};

export default function HoldingRecognitionSettings({ focus = false }: { focus?: boolean }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const [config, setConfig] = useState<HoldingRecognitionConfig>(EMPTY_CONFIG);
  const [expanded, setExpanded] = useState(focus);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedProviderId = inferHoldingRecognitionProvider(config);
  const selectedProvider = getHoldingRecognitionProvider(selectedProviderId);

  useEffect(() => {
    let active = true;
    void loadHoldingRecognitionConfig().then(saved => {
      if (!active) return;
      if (saved) { setConfig(saved); setConfigured(true); }
    }).catch(() => { if (active) setError(t('holding_import_config_failed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    if (focus && !loading) sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [focus, loading]);

  const selectProvider = (id: string) => {
    const provider = getHoldingRecognitionProvider(id);
    setConfig(current => id === inferHoldingRecognitionProvider(current) ? current : {
      provider: provider.id, protocol: provider.protocol,
      baseUrl: provider.baseUrl, model: provider.defaultModel, apiKey: '',
    });
    setError(''); setNotice('');
  };
  const saveConfig = async () => {
    if (busy || loading) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await saveHoldingRecognitionConfig(config);
      setConfigured(true); setNotice(t('holding_import_config_saved'));
    } catch (cause) {
      const code = cause instanceof Error ? cause.message.replace(/^HOLDING_RECOGNITION_/, '').toLowerCase() : '';
      setError(t('holding_recognition_error_' + code, { defaultValue: t('holding_import_config_failed') }));
    } finally { setBusy(false); }
  };
  const clearConfig = async () => {
    if (busy || loading) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await clearHoldingRecognitionConfig();
      setConfig(EMPTY_CONFIG); setConfigured(false); setNotice(t('holding_api_config_cleared'));
    } catch { setError(t('holding_import_config_failed')); }
    finally { setBusy(false); }
  };

  return (
    <section className="settings-section holding-recognition-settings" id="holding-recognition-settings" ref={sectionRef}>
      <h2 className="settings-section-title">{t('holding_import_api_config')}</h2>
      <p className="holding-recognition-note">{t('holding_api_settings_description')}</p>
      <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary className="holding-recognition-summary">{t(configured ? 'holding_api_configured' : 'holding_api_not_configured')}</summary>
        <div className="form-group">
          <label className="form-label" htmlFor="holding-api-provider">{t('holding_import_api_provider')}</label>
          <select className="form-select" id="holding-api-provider" disabled={busy || loading} value={selectedProviderId}
            onChange={event => selectProvider(event.target.value)}>
            <optgroup label={t('holding_import_domestic_providers')}>
              {HOLDING_RECOGNITION_PROVIDERS.filter(provider => ['aliyun', 'zhipu', 'moonshot', 'volcengine'].includes(provider.id))
                .map(provider => <option key={provider.id} value={provider.id}>{t(provider.nameKey)}</option>)}
            </optgroup>
            <optgroup label={t('holding_import_other_providers')}>
              {HOLDING_RECOGNITION_PROVIDERS.filter(provider => !['aliyun', 'zhipu', 'moonshot', 'volcengine'].includes(provider.id))
                .map(provider => <option key={provider.id} value={provider.id}>{t(provider.nameKey)}</option>)}
            </optgroup>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="holding-api-protocol">{t('holding_import_api_protocol')}</label>
          <select className="form-select" id="holding-api-protocol" disabled={busy || loading} value={config.protocol}
            onChange={event => setConfig(current => ({ ...current, protocol: event.target.value as HoldingRecognitionConfig['protocol'] }))}>
            <option value="openai">{t('holding_import_api_openai')}</option>
            <option value="gemini">{t('holding_import_api_gemini')}</option>
            <option value="anthropic">{t('holding_import_api_anthropic')}</option>
          </select>
        </div>
        {(['baseUrl', 'model', 'apiKey'] as const).map(field => <div className="form-group" key={field}>
          <label className="form-label" htmlFor={'holding-api-' + field}>{t('holding_import_api_' + field)}</label>
          <input id={'holding-api-' + field} className="form-input" disabled={busy || loading} type={field === 'apiKey' ? 'password' : field === 'baseUrl' ? 'url' : 'text'}
            autoComplete="off" spellCheck={false} value={config[field]}
            placeholder={t(field === 'model' && selectedProviderId === 'volcengine' ? 'holding_import_volcengine_model_ph' : 'holding_import_api_' + field + '_ph')}
            onChange={event => setConfig(current => ({ ...current, [field]: event.target.value }))} />
          {field === 'model' && selectedProvider.models.length > 0 && <select className="form-select" style={{ marginTop: 8 }}
            aria-label={t('holding_import_model_preset')} disabled={busy || loading} value={selectedProvider.models.includes(config.model) ? config.model : ''}
            onChange={event => { if (event.target.value) setConfig(current => ({ ...current, model: event.target.value })); }}>
            <option value="">{t('holding_import_model_custom')}</option>
            {selectedProvider.models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>}
        </div>)}
        <p className="holding-recognition-note">{t(selectedProviderId === 'volcengine' ? 'holding_import_volcengine_hint' : selectedProviderId === 'zhipu' ? 'holding_import_zhipu_hint' : 'holding_import_provider_hint')}</p>
        <p className="holding-recognition-note">{t('holding_import_api_hint')}</p>
        <div className="holding-recognition-actions">
          <button className="btn btn-primary" disabled={busy || loading} onClick={() => void saveConfig()}>{t('holding_import_save_config')}</button>
          {configured && <button className="btn btn-secondary" disabled={busy || loading} onClick={() => void clearConfig()}>{t('holding_api_clear_config')}</button>}
        </div>
      </details>
      {error && <p className="holding-recognition-error" role="alert">{error}</p>}
      {notice && <p className="holding-recognition-note" role="status">{notice}</p>}
    </section>
  );
}
