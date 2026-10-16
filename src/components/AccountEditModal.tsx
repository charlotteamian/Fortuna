import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Settings } from '../db';
import { getAccount, updateAccount } from '../services/assetService';
import { setAccountPortfolioMode } from '../services/holdingService';
import { isProductPortfolioCategory } from '../lib/productPortfolio';
import { isAccountIncludedInTotals } from '../lib/accountPreferences';

interface Props {
  account: Account;
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}

/** Both visible and hidden accounts use the same editor; visibility is never a save field. */
export default function AccountEditModal({ account, settings, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(account.name);
  const [category, setCategory] = useState(account.category);
  const [institution, setInstitution] = useState(account.institution ?? '');
  const [currency, setCurrency] = useState(account.currency);
  const [portfolio, setPortfolio] = useState(Boolean(account.portfolio));
  const [includeInTotals, setIncludeInTotals] = useState(isAccountIncludedInTotals(account));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const categories = settings.categories.filter(item => item.type === account.type);
  const currencies = [...new Set([account.currency, ...settings.currencies])];
  const supportsPortfolio = isProductPortfolioCategory(category, account.type);

  const save = async () => {
    if (saving || !name.trim() || !category) return;
    setSaving(true);
    setFailed(false);
    try {
      const current = await getAccount(account.id);
      if (!current) throw new Error('Account is unavailable');
      const nextPortfolio = supportsPortfolio && portfolio;
      if (current.portfolio && !nextPortfolio) await setAccountPortfolioMode(account.id, false);
      await updateAccount(account.id, {
        name: name.trim(), category,
        institution: institution.trim() || undefined,
        currency, includeInTotals,
        icon: settings.categories.find(item => item.name === category)?.icon,
      });
      if (nextPortfolio) await setAccountPortfolioMode(account.id, true);
      onSaved();
    } catch (error) {
      console.error('Account edit failed', error);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-overlay" role="presentation" onClick={() => { if (!saving) onClose(); }}>
    <form className="modal-content" role="dialog" aria-modal="true" aria-labelledby="edit-account-title"
      onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="modal-header">
        <h2 className="modal-title" id="edit-account-title">{t('edit_account')}</h2>
        <button type="button" className="modal-close" disabled={saving} onClick={onClose} aria-label={t('close')}>✕</button>
      </div>
      {account.hidden && <p className="settings-note">{t('hidden_account_edit_hint')}</p>}
      <div className="form-group">
        <label className="form-label" htmlFor="edit-account-name">{t('name')}</label>
        <input id="edit-account-name" className="form-input" value={name} required onChange={event => setName(event.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="edit-account-category">{t('category')}</label>
        <select id="edit-account-category" className="form-select" value={category} onChange={event => setCategory(event.target.value)}>
          {!categories.some(item => item.name === category) && <option value={category}>{t(category)}</option>}
          {categories.map(item => <option key={item.name} value={item.name}>{t(item.name)}</option>)}
        </select>
      </div>
      {supportsPortfolio && <div className="form-group">
        <div className="form-label">{t('manage_mode')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" className={`btn ${portfolio ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={portfolio} onClick={() => setPortfolio(true)}>{t('mode_portfolio')}</button>
          <button type="button" className={`btn ${!portfolio ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={!portfolio} onClick={() => setPortfolio(false)}>{t('mode_single')}</button>
        </div>
        {portfolio && <p className="preference-toggle-hint">{t('portfolio_hint')}</p>}
      </div>}
      <div className="form-group">
        <label className="form-label" htmlFor="edit-account-institution">{t('institution')}</label>
        <input id="edit-account-institution" className="form-input" value={institution} placeholder={t('institution_ph')} onChange={event => setInstitution(event.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="edit-account-currency">{t('currency_label')}</label>
        <select id="edit-account-currency" className="form-select" value={currency} onChange={event => setCurrency(event.target.value)}>
          {currencies.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="form-group preference-toggle-card">
        <div className="preference-toggle-copy">
          <div className="preference-toggle-title">{t('include_in_totals')}</div>
          <div className="preference-toggle-hint">{t('include_in_totals_hint')}</div>
        </div>
        <button type="button" className={`toggle-switch ${includeInTotals ? 'active' : ''}`} role="switch"
          aria-checked={includeInTotals} aria-label={t('include_in_totals')} onClick={() => setIncludeInTotals(!includeInTotals)}><span /></button>
      </div>
      {failed && <p className="backup-import-error" role="alert">{t('account_edit_failed')}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary btn-block" disabled={saving} onClick={onClose}>{t('cancel')}</button>
        <button type="submit" className="btn btn-primary btn-block" disabled={saving || !name.trim()}>{t(saving ? 'plan_saving' : 'save')}</button>
      </div>
    </form>
  </div>;
}
