import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CURRENT_ONBOARDING_VERSION, db, type Settings } from '../db';
import { requestPortableSnapshot } from '../services/portableSnapshotEvents';

interface Props {
  settings: Settings;
  onComplete: (settings: Settings, destination: 'assets' | 'settings') => void;
}

const STEP_ICONS = ['👋', '⚙️', '🧭', '📊', '🛡️'];

export default function Onboarding({ settings, onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<Settings['language']>(settings.language ?? 'auto');
  const [primaryCurrency, setPrimaryCurrency] = useState(settings.primaryCurrency);
  const [amountVisible, setAmountVisible] = useState(settings.amountVisible);
  const lastStep = STEP_ICONS.length - 1;
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.querySelectorAll<HTMLElement>('.app-content, .tab-bar')];
    document.documentElement.classList.add('modal-open');
    background.forEach(element => { element.inert = true; });
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = [...cardRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.classList.remove('modal-open');
      background.forEach(element => { element.inert = false; });
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => { titleRef.current?.focus(); }, [step]);

  const setAppLanguage = (value: Settings['language']) => {
    setLanguage(value);
    const nextLanguage = value === 'auto'
      ? (navigator.language.startsWith('zh') ? 'zh' : 'en')
      : value;
    void i18n.changeLanguage(nextLanguage);
    document.documentElement.lang = nextLanguage === 'zh' ? 'zh-CN' : 'en';
  };

  const finish = async (destination: 'assets' | 'settings') => {
    const updated: Settings = {
      ...settings,
      language,
      primaryCurrency,
      amountVisible,
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    };
    await db.settings.put(updated);
    requestPortableSnapshot('onboarding-settings-updated');
    onComplete(updated, destination);
  };

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section className="onboarding-card" ref={cardRef}>
        <div className="onboarding-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_ICONS.length} aria-valuenow={step + 1} aria-label={t('onboarding_progress', { current: step + 1, total: STEP_ICONS.length })}>
          {STEP_ICONS.map((_, index) => <span key={index} className={index <= step ? 'active' : ''} />)}
        </div>
        <div className="onboarding-icon" aria-hidden="true">{STEP_ICONS[step]}</div>
        <h1 id="onboarding-title" ref={titleRef} tabIndex={-1}>{t(`onboarding_${step}_title`)}</h1>
        <p className="onboarding-copy">{t(`onboarding_${step}_body`)}</p>

        {step === 1 && (
          <div className="onboarding-preferences">
            <label className="form-group">
              <span className="form-label">{t('language')}</span>
              <select className="form-select" value={language} onChange={event => setAppLanguage(event.target.value as Settings['language'])}>
                <option value="auto">{t('system_auto')}</option>
                <option value="zh">{t('zh')}</option>
                <option value="en">{t('en')}</option>
              </select>
            </label>
            <label className="form-group">
              <span className="form-label">{t('primary_currency')}</span>
              <select className="form-select" value={primaryCurrency} onChange={event => setPrimaryCurrency(event.target.value)}>
                {settings.currencies.map(currency => <option key={currency} value={currency}>{currency} · {t(`${currency}_name`)}</option>)}
              </select>
            </label>
            <label className="onboarding-switch">
              <span>
                <strong>{t('default_show_amount')}</strong>
                <small>{t('privacy_hint')}</small>
              </span>
              <input type="checkbox" checked={amountVisible} onChange={event => setAmountVisible(event.target.checked)} />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-example-grid">
            <div><strong>{t('onboarding_single_title')}</strong><span>{t('onboarding_single_body')}</span></div>
            <div><strong>{t('onboarding_portfolio_title')}</strong><span>{t('onboarding_portfolio_body')}</span></div>
          </div>
        )}

        {step === lastStep && (
          <div className="onboarding-note">{t('onboarding_final_note')}</div>
        )}

        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => setStep(current => current - 1)}>{t('back')}</button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => void finish('assets')}>{t('skip')}</button>
          )}
          {step < lastStep ? (
            <button type="button" className="btn btn-primary" onClick={() => setStep(current => current + 1)}>{t('next')}</button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void finish('assets')}>{t('start_using')}</button>
          )}
        </div>
        {step === lastStep && (
          <button type="button" className="onboarding-restore" onClick={() => void finish('settings')}>{t('restore_existing_backup')}</button>
        )}
      </section>
    </div>
  );
}
