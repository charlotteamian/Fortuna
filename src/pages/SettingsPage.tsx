import { useState, useEffect, useRef, useCallback } from 'react';
import { db, initializeSettings, DEFAULT_CATEGORIES, CURRENCY_NAMES, COLOR_THEMES, exportToExcel, importFromExcel, type Account, type Settings, type CustomField } from '../db';
import { refreshAllRates, getLastUpdateTime } from '../services/rateService';
import { useTranslation } from 'react-i18next';
import {
  getDefaultSnapshotFocusAccountIds,
  getSnapshotFocusAccountIds,
  isSnapshotFocusCandidate,
} from '../lib/portableSnapshot';
import {
  configurePortableSnapshot as configureAutomaticSnapshot,
  disconnectPortableSnapshot as disconnectAutomaticSnapshot,
  flushPortableSnapshot as flushAutomaticSnapshot,
  getPortableSnapshotStatus as getAutomaticSnapshotStatus,
  AUTOMATIC_SNAPSHOT_FILE,
  schedulePortableSnapshot as scheduleAutomaticSnapshot,
} from '../services/portableSnapshotService';
import type { PortableSnapshotStatus as AutomaticSnapshotStatus } from '../native/portableSnapshot';
import UserGuide from '../components/UserGuide';
import { formatLocalDate } from '../lib/localDate';
import { Capacitor } from '@capacitor/core';
import { updateAccount } from '../services/assetService';
import { isAccountHidden } from '../lib/accountPreferences';

interface Props { onRefresh: () => void; onOpenOnboarding: () => void; }

export default function SettingsPage({ onRefresh, onOpenOnboarding }: Props) {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'asset' | 'liability'>('asset');
  const newCatIcon = '📌';
  const [newCatFields, setNewCatFields] = useState<(CustomField & { optionsStr?: string })[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [snapshotAccounts, setSnapshotAccounts] = useState<Account[]>([]);
  const [snapshotStatus, setSnapshotStatus] = useState<AutomaticSnapshotStatus>({ supported: false, configured: false });
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setLoadError(false);
    try {
      const [s, ratesUpdatedAt, accounts, syncStatus] = await Promise.all([
        initializeSettings(),
        getLastUpdateTime(),
        db.accounts.toArray(),
        getAutomaticSnapshotStatus(),
      ]);
      setSettings(s);
      setLastUpdate(ratesUpdatedAt);
      setSnapshotAccounts(accounts);
      setSnapshotStatus(syncStatus);
    } catch (error) {
      console.error('Settings load failed', error);
      setLoadError(true);
    } finally {
      if (initial) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(true); }, [load]);

  useEffect(() => {
    const hasOpenModal = showAddCategory || Boolean(pendingImport);
    document.documentElement.classList.toggle('modal-open', hasOpenModal);
    return () => document.documentElement.classList.remove('modal-open');
  }, [pendingImport, showAddCategory]);

  const save = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const updated = { ...settings, ...updates };
    await db.settings.put(updated); setSettings(updated); onRefresh();
    scheduleAutomaticSnapshot('settings-updated');
  };

  const handleRefreshRates = async () => {
    if (!settings) return;
    setSyncing(true);
    try {
      await refreshAllRates(settings.primaryCurrency, settings.goldPriceSource ?? 'international');
      showToast(t('rates_updated'));
      const updatedTime = await getLastUpdateTime();
      setLastUpdate(updatedTime);
      scheduleAutomaticSnapshot('exchange-rates-refreshed');
    }
    catch { showToast(t('rates_failed'), 'error'); }
    setSyncing(false);
  };

  const handleUnhideAccount = async (accountId: string) => {
    await updateAccount(accountId, { hidden: false });
    setSnapshotAccounts(current => current.map(account => account.id === accountId ? { ...account, hidden: false } : account));
    onRefresh();
    showToast(t('account_unhidden_toast'));
  };

  const newFieldKey = (i: number) => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* ignore */ }
    return 'f_' + Date.now() + '_' + i;
  };

  const addDraftField = () => {
    setNewCatFields(prev => [...prev, { key: newFieldKey(prev.length), label: '', placeholder: '', optionsStr: '' }]);
  };
  const updateDraftField = (idx: number, patch: Partial<CustomField & { optionsStr?: string }>) => {
    setNewCatFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  };
  const removeDraftField = (idx: number) => {
    setNewCatFields(prev => prev.filter((_, i) => i !== idx));
  };
  const closeAddCategory = () => {
    setShowAddCategory(false);
    setNewCatName('');
    setNewCatFields([]);
  };

  const handleAddCategory = () => {
    if (!newCatName.trim() || !settings) return;
    const categoryName = newCatName.trim();
    if (settings.categories.some(category => category.name === categoryName)) {
      showToast(t('category_exists'), 'error');
      return;
    }
    if (categoryName.includes('@') || /^(acct|hold|cash):/i.test(categoryName)) {
      showToast(t('category_reserved_chars'), 'error');
      return;
    }
    const fields: CustomField[] = newCatFields
      .filter(f => f.label.trim())
      .map(f => {
        const opts = (f.optionsStr || '').split(',').map(s => s.trim()).filter(Boolean);
        return {
          key: f.key,
          label: f.label.trim(),
          placeholder: f.placeholder?.trim() || undefined,
          options: opts.length > 0 ? opts : undefined,
        };
      });
    void save({ categories: [...settings.categories, { name: categoryName, type: newCatType, icon: newCatIcon, fields: fields.length > 0 ? fields : undefined }] });
    setNewCatName(''); setNewCatFields([]); setShowAddCategory(false); showToast(t('cat_added'));
  };

  const handleDeleteCategory = async (name: string) => {
    if (!settings) return;
    const category = settings.categories.find(candidate => candidate.name === name);
    if (!category || settings.categories.filter(candidate => candidate.type === category.type).length <= 1) {
      showToast(t('last_category_required'), 'error');
      return;
    }
    const inUse = await db.accounts.where('category').equals(name).count();
    if (inUse > 0) { showToast(t('cat_in_use'), 'error'); return; }
    save({ categories: settings.categories.filter(c => c.name !== name) });
    showToast(t('cat_deleted'));
  };
  const handleResetCategories = async () => {
    if (!settings) return;
    const defaultNames = new Set(DEFAULT_CATEGORIES.map(category => category.name));
    const usedCustomCategories = (await db.accounts.toArray())
      .map(account => account.category)
      .filter((name, index, values) => !defaultNames.has(name) && values.indexOf(name) === index);
    if (usedCustomCategories.length > 0) {
      showToast(t('categories_reset_blocked', { categories: usedCustomCategories.join('、') }), 'error');
      return;
    }
    if (!confirm(t('categories_reset_confirm'))) return;
    await save({ categories: [...DEFAULT_CATEGORIES] });
    showToast(t('cat_reset'));
  };
  const handleAddCurrency = (code: string) => { if (!settings || settings.currencies.includes(code)) return; save({ currencies: [...settings.currencies, code] }); };
  const handleRemoveCurrency = async (code: string) => {
    if (!settings) return;
    if (code === settings.primaryCurrency || await db.accounts.where('currency').equals(code).count() > 0) {
      showToast(t('currency_in_use'), 'error');
      return;
    }
    await save({ currencies: settings.currencies.filter(currency => currency !== code) });
  };

  const handleSnapshotFocusToggle = async (accountId: string) => {
    if (!settings) return;
    const current = new Set(settings.snapshotFocusAccountIds ?? getDefaultSnapshotFocusAccountIds());
    if (current.has(accountId)) current.delete(accountId);
    else current.add(accountId);
    await save({ snapshotFocusAccountIds: [...current] });
    if (snapshotStatus.configured) {
      void flushAutomaticSnapshot('focus-accounts-changed')
        .then(result => setSnapshotStatus(result.status))
        .catch(error => console.warn('Automatic snapshot account selection failed', error));
    }
  };

  const handleChooseSnapshotDirectory = async () => {
    setSnapshotBusy(true);
    try {
      const result = await configureAutomaticSnapshot();
      setSnapshotStatus(result.status);
      if (result.written) showToast(t('snapshot_sync_success'));
    } catch {
      showToast(t('snapshot_sync_failed'), 'error');
      setSnapshotStatus(await getAutomaticSnapshotStatus());
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleWriteSnapshotNow = async () => {
    setSnapshotBusy(true);
    try {
      const result = await flushAutomaticSnapshot('manual-sync');
      setSnapshotStatus(result.status);
      showToast(result.written ? t('snapshot_sync_success') : t('snapshot_choose_directory_first'), result.written ? 'success' : 'error');
    } catch {
      showToast(t('snapshot_sync_failed'), 'error');
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleDisconnectSnapshot = async () => {
    setSnapshotBusy(true);
    try {
      await disconnectAutomaticSnapshot();
      setSnapshotStatus(await getAutomaticSnapshotStatus());
      showToast(t('snapshot_sync_disconnected'));
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      const base64Data = await exportToExcel();
      const fileName = `fortuna_backup_${formatLocalDate()}.xlsx`;
      
      try {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import('@capacitor/filesystem'),
          import('@capacitor/share'),
        ]);
        const writeResult = await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Cache,
        });
        
        await Share.share({
          title: t('backup_share_title'),
          text: t('backup_share_text'),
          url: writeResult.uri,
          dialogTitle: t('backup_restore'),
        });
        showToast(t('export_success'));
      } catch (e) {
        console.log('Share failed, fallback to web download', e);
        // Base64 string to Blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        a.click(); URL.revokeObjectURL(url);
        showToast(t('export_success'));
      }
    } catch {
      showToast(t('export_failed'), 'error');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      showToast(t('import_file_too_large'), 'error');
    } else {
      setPendingImport(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(pendingImport);
      });
      const base64Data = dataUrl.split(',')[1];
      const success = Boolean(base64Data) && await importFromExcel(base64Data);
      if (success) {
        setPendingImport(null);
        showToast(t('import_success'));
        await load();
        onRefresh();
        scheduleAutomaticSnapshot('backup-restored');
      } else {
        showToast(t('import_failed'), 'error');
      }
    } catch (error) {
      console.error('Backup import failed', error);
      showToast(t('import_failed'), 'error');
    } finally {
      setImporting(false);
    }
  };



  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (loadError && !settings) return (
    <div className="empty-state" role="alert">
      <div className="empty-icon">⚠️</div>
      <div className="empty-text">{t('load_failed')}</div>
      <div className="empty-hint">{t('load_failed_hint')}</div>
      <button type="button" className="btn btn-primary" onClick={() => void load(true)}>{t('retry')}</button>
    </div>
  );
  if (!settings) return null;

  const availableCurrencies = Object.keys(CURRENCY_NAMES).filter(c => !settings.currencies.includes(c));
  const snapshotCandidates = snapshotAccounts.filter(isSnapshotFocusCandidate);
  const selectedSnapshotIds = new Set(getSnapshotFocusAccountIds(snapshotAccounts, settings.snapshotFocusAccountIds));
  const hiddenAccounts = snapshotAccounts
    .filter(isAccountHidden)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt);
  const automaticSnapshotUnavailableLabel = Capacitor.getPlatform() === 'ios'
    ? t('snapshot_ios_unavailable')
    : t('snapshot_android_only');

  return (
    <>
      {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live="polite">{toast.msg}</div>}
      <div className="page-header"><div><h1 className="page-title">{t('settings')}</h1><p className="page-subtitle">{t('about_title')} {t('app_name')}</p></div></div>

      {/* Theme Mode & Font Size & Language */}
      <div className="settings-section">
        <div className="settings-section-title">{t('display')}</div>
        
        <div className="settings-item">
          <span className="settings-item-label">{t('language')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '6px 30px 6px 12px', fontSize: '0.875rem' }}
            aria-label={t('language')}
            value={settings.language || 'auto'} onChange={e => save({ language: e.target.value as Settings['language'] })}>
            <option value="auto">{t('auto')}</option>
            <option value="zh">{t('zh')}</option>
            <option value="en">{t('en')}</option>
          </select>
        </div>

        <div className="settings-item">
          <span className="settings-item-label">{t('theme_mode')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '6px 30px 6px 12px', fontSize: '0.875rem' }}
            aria-label={t('theme_mode')}
            value={settings.themeMode || 'auto'} onChange={e => save({ themeMode: e.target.value as Settings['themeMode'] })}>
            <option value="auto">{t('system_auto')}</option>
            <option value="light">{t('light_mode')}</option>
            <option value="dark">{t('dark_mode')}</option>
          </select>
        </div>
 
        <div className="settings-item">
          <span className="settings-item-label">{t('font_size')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '6px 30px 6px 12px', fontSize: '0.875rem' }}
            aria-label={t('font_size')}
            value={settings.fontSize || 'normal'} onChange={e => save({ fontSize: e.target.value as Settings['fontSize'] })}>
            <option value="small">{t('small')}</option>
            <option value="normal">{t('normal')}</option>
            <option value="large">{t('large')}</option>
          </select>
        </div>
        <div className="settings-item">
          <div>
            <div className="settings-item-label">{t('show_archived_assets_setting')}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {t('show_archived_assets_hint')}
            </div>
          </div>
          <button
            className={`btn btn-sm ${(settings.showArchivedAccounts ?? true) ? 'btn-primary' : 'btn-secondary'}`}
            role="switch"
            aria-checked={settings.showArchivedAccounts ?? true}
            style={{ flexShrink: 0, minWidth: 78, whiteSpace: 'nowrap' }}
            onClick={() => save({ showArchivedAccounts: !(settings.showArchivedAccounts ?? true) })}>
            {(settings.showArchivedAccounts ?? true) ? t('shown') : t('hidden')}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('hidden_accounts')}</div>
        <div className="settings-note">{t('hidden_accounts_hint')}</div>
        {hiddenAccounts.length === 0 ? (
          <div className="settings-item">
            <span className="settings-item-label">{t('no_hidden_accounts')}</span>
          </div>
        ) : hiddenAccounts.map(account => (
          <div className="settings-item" key={account.id}>
            <div>
              <div className="settings-item-label">{account.name}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {[account.institution, t(account.category), account.currency].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-secondary"
              onClick={() => void handleUnhideAccount(account.id)}>
              👁️ {t('unhide_account')}
            </button>
          </div>
        ))}
      </div>

      {/* Color Theme */}
      <div className="settings-section">
        <div className="settings-section-title">{t('color_theme')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {COLOR_THEMES.map(themeItem => (
            <button key={themeItem.id} className="theme-option" onClick={() => save({ colorTheme: themeItem.id })}
              style={{ border: settings.colorTheme === themeItem.id ? `2px solid var(--accent)` : '1px solid var(--border)',
                background: 'var(--bg-glass)', borderRadius: 'var(--radius-sm)', padding: '12px', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: themeItem.assetColor, display: 'inline-block' }} />
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: themeItem.liabilityColor, display: 'inline-block' }} />
              </div>
              <div style={{ fontSize: '0.75rem', color: settings.colorTheme === themeItem.id ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: settings.colorTheme === themeItem.id ? 700 : 400 }}>
                {t(themeItem.id)}
              </div>
              {settings.colorTheme === themeItem.id && <div style={{ fontSize: '0.625rem', color: 'var(--accent)', marginTop: 2 }}>✓ {t('current_theme')}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Amount Visibility */}
      <div className="settings-section">
        <div className="settings-section-title">{t('privacy')}</div>
        <div className="settings-item">
          <div>
            <div className="settings-item-label">{t('default_show_amount')}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {t('privacy_hint')}
            </div>
          </div>
          <button className={`btn btn-sm ${settings.amountVisible ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flexShrink: 0, whiteSpace: 'nowrap', minWidth: '90px' }}
            onClick={() => save({ amountVisible: !settings.amountVisible })}>
            {settings.amountVisible ? '👁️ ' + t('show_amount') : '🔒 ' + t('hide_amount')}
          </button>
        </div>
      </div>

      {/* Primary Currency */}
      <div className="settings-section">
        <div className="settings-section-title">{t('primary_currency')}</div>
        <div className="settings-item">
          <span className="settings-item-label">{t('summary_currency')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '8px 32px 8px 12px' }}
            aria-label={t('summary_currency')}
            value={settings.primaryCurrency} onChange={e => save({ primaryCurrency: e.target.value })}>
            {settings.currencies.map(c => <option key={c} value={c}>{c} - {t(c + '_name')}</option>)}
          </select>
        </div>
      </div>

      {/* Exchange Rates */}
      <div className="settings-section">
        <div className="settings-section-title">{t('exchange_rates_title')}</div>
        <div className="settings-item">
          <div>
            <div className="settings-item-label">{t('last_updated')}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{lastUpdate ? new Date(lastUpdate).toLocaleString(t('zh') === '简体中文' ? 'zh-CN' : 'en-US') : t('never_updated')}</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleRefreshRates} disabled={syncing}>{syncing ? '...' : '🔄 ' + t('refresh_rates')}</button>
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('rate_source')}</div>
      </div>

      {/* Gold Price Source */}
      <div className="settings-section">
        <div className="settings-section-title">{t('gold_price_section')}</div>
        <div className="settings-item">
          <span className="settings-item-label">{t('gold_price_source')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '6px 30px 6px 12px', fontSize: '0.875rem' }}
            aria-label={t('gold_price_source')}
            value={settings.goldPriceSource ?? 'international'} onChange={e => save({ goldPriceSource: e.target.value as Settings['goldPriceSource'] })}>
            <option value="domestic">{t('gold_src_domestic')}</option>
            <option value="international">{t('gold_src_international')}</option>
          </select>
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('gold_price_source_hint')}</div>
      </div>

      {/* Categories */}
      <div className="settings-section">
        <div className="settings-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('categories_title')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-secondary" onClick={handleResetCategories}>{t('reset')}</button>
            <button className="btn btn-sm btn-primary" onClick={() => setShowAddCategory(true)}>+ {t('new')}</button>
          </div>
        </div>
        {settings.categories.map(c => (
          <div className="category-item" key={c.name}>
            <span className="category-name">{t(c.name)}</span>
            <span className="category-type" style={{ background: c.type === 'asset' ? 'var(--asset-dim)' : 'var(--liability-dim)', color: c.type === 'asset' ? 'var(--asset-color)' : 'var(--liability-color)' }}>
              {c.type === 'asset' ? t('assets') : t('liabilities')}
            </span>
            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteCategory(c.name)} style={{ padding: '4px 8px', fontSize: '0.6875rem' }}>✕</button>
          </div>
        ))}
      </div>

      {/* Currencies */}
      <div className="settings-section">
        <div className="settings-section-title">{t('common_currencies')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
          {settings.currencies.map(c => (
            <span className="tag" key={c}>
              {c}
              <button type="button" className="tag-remove" aria-label={t('remove_currency', { currency: c })} onClick={() => void handleRemoveCurrency(c)}>✕</button>
            </span>
          ))}
        </div>
        {availableCurrencies.length > 0 && (
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>{t('click_to_add')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {availableCurrencies.map(c => <button type="button" className="tag tag-add" key={c} aria-label={t('add_currency', { currency: c })} onClick={() => handleAddCurrency(c)}>+ {c}</button>)}
            </div>
          </div>
        )}
      </div>


      {/* Optional portable JSON snapshot */}
      <div className="settings-section">
        <div className="settings-section-title">{t('snapshot_sync_title')}</div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 10 }}>
          {t('snapshot_sync_desc', { file: AUTOMATIC_SNAPSHOT_FILE })}
        </div>
        <div className="settings-item">
          <div style={{ minWidth: 0 }}>
            <div className="settings-item-label">{t('snapshot_sync_directory')}</div>
            <div style={{ fontSize: '0.6875rem', color: snapshotStatus.configured ? 'var(--asset-color)' : 'var(--text-muted)', marginTop: 2, overflowWrap: 'anywhere' }}>
              {!snapshotStatus.supported
                ? automaticSnapshotUnavailableLabel
                : snapshotStatus.configured
                  ? `✓ ${snapshotStatus.directoryName || t('snapshot_directory_configured')}`
                  : t('snapshot_directory_not_set')}
            </div>
            {snapshotStatus.lastWriteAt && (
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {t('snapshot_last_sync', { time: new Date(snapshotStatus.lastWriteAt).toLocaleString() })}
              </div>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" disabled={!snapshotStatus.supported || snapshotBusy}
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick={handleChooseSnapshotDirectory}>
            📁 {snapshotStatus.configured ? t('snapshot_change_directory') : t('snapshot_choose_directory')}
          </button>
        </div>

        <div style={{ marginTop: 10, marginBottom: 6, fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
          {t('snapshot_focus_accounts')}
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 4 }}>
          {t('snapshot_focus_accounts_hint')}
        </div>
        {snapshotCandidates.length === 0 ? (
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', padding: '8px 0 12px' }}>{t('snapshot_no_focus_accounts')}</div>
        ) : snapshotCandidates.map(account => (
          <label key={account.id} className="settings-item" style={{ cursor: 'pointer', padding: '10px 0' }}>
            <div style={{ minWidth: 0 }}>
              <div className="settings-item-label">{account.name}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {[account.institution, t(account.category), account.currency].filter(Boolean).join(' · ')}
              </div>
            </div>
            <input type="checkbox" checked={selectedSnapshotIds.has(account.id)}
              onChange={() => handleSnapshotFocusToggle(account.id)}
              style={{ width: 20, height: 20, accentColor: 'var(--asset-color)', flexShrink: 0 }} />
          </label>
        ))}

        {snapshotStatus.configured && (
          <div className="snapshot-actions">
            <button className="btn btn-primary btn-sm" disabled={snapshotBusy} onClick={handleWriteSnapshotNow}>
              🔄 {t('snapshot_sync_now')}
            </button>
            <button className="btn btn-danger btn-sm" disabled={snapshotBusy} onClick={handleDisconnectSnapshot}>
              {t('snapshot_disconnect')}
            </button>
          </div>
        )}
      </div>



      {/* Backup and Restore */}
      <div className="settings-section">
        <div className="settings-section-title">{t('backup_restore')}</div>
        <div className="settings-note">{t('backup_plaintext_warning')}</div>
        <div className="settings-item">
          <div>
            <div className="settings-item-label">{t('export_data')}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>{t('excel_export_desc')}</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>📥 {t('export_data')}</button>
        </div>
        <div className="settings-item">
          <div>
            <div className="settings-item-label">{t('import_data')}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>{t('excel_import_desc')}</div>
          </div>
          <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0, whiteSpace: 'nowrap', minWidth: '90px' }} 
            onClick={() => fileInputRef.current?.click()}>📤 {t('import_data')}</button>
          <input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} ref={fileInputRef} onChange={handleImport} />
        </div>
      </div>

      {/* About */}
      <div className="settings-section">
        <div className="settings-section-title">{t('about_title')}</div>
        <button type="button" className="settings-item settings-link settings-button" onClick={() => setShowGuide(true)}>
          <span className="settings-item-label" style={{ color: 'var(--accent)' }}>{t('user_guide_title')}</span>
          <span className="settings-item-value">{t('click_to_view')}</span>
        </button>
        <button type="button" className="settings-item settings-link settings-button" onClick={onOpenOnboarding}>
          <span className="settings-item-label">{t('reopen_onboarding')}</span>
          <span className="settings-item-value">{t('click_to_view')}</span>
        </button>
        <a className="settings-item settings-link" href={i18n.resolvedLanguage?.startsWith('zh') ? './privacy-policy-zh.html' : './privacy-policy.html'} target="_blank" rel="noreferrer">
          <span className="settings-item-label">{t('privacy_policy')}</span>
          <span className="settings-item-value">↗</span>
        </a>
        <a className="settings-item settings-link" href="https://github.com/charlotteamian/Fortuna/issues" target="_blank" rel="noreferrer">
          <span className="settings-item-label">{t('support_and_feedback')}</span>
          <span className="settings-item-value">{t('open_support')} ↗</span>
        </a>
        <div className="settings-item">
          <span className="settings-item-label">Fortuna</span>
          <span className="settings-item-value">v{__APP_VERSION__}</span>
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('data_security_hint')}</div>
      </div>

      {showGuide && <UserGuide onClose={() => setShowGuide(false)} />}

      {pendingImport && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="import-confirm-title" onClick={() => !importing && setPendingImport(null)}>
          <div className="confirm-box" onClick={event => event.stopPropagation()}>
            <h2 className="confirm-title" id="import-confirm-title">{t('import_confirm_title')}</h2>
            <p className="confirm-msg">{t('import_confirm_message', { file: pendingImport.name })}</p>
            <p className="confirm-warning">{t('import_confirm_warning')}</p>
            <div className="confirm-actions">
              <button className="btn btn-secondary" disabled={importing} onClick={() => setPendingImport(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" disabled={importing} onClick={() => void confirmImport()}>{importing ? t('importing') : t('replace_and_restore')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {showAddCategory && (
        <div className="modal-overlay" onClick={closeAddCategory}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 className="modal-title">{t('add_category_title')}</h2><button className="modal-close" onClick={closeAddCategory}>✕</button></div>
            <div className="form-group">
              <label className="form-label">{t('type')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={`btn btn-block ${newCatType === 'asset' ? '' : 'btn-secondary'}`} style={newCatType === 'asset' ? { background: 'var(--asset-color)', color: '#fff' } : {}} onClick={() => setNewCatType('asset')}>{t('assets')}</button>
                <button className={`btn btn-block ${newCatType === 'liability' ? '' : 'btn-secondary'}`} style={newCatType === 'liability' ? { background: 'var(--liability-color)', color: '#fff' } : {}} onClick={() => setNewCatType('liability')}>{t('liabilities')}</button>
              </div>
            </div>
            <div className="form-group"><label className="form-label">{t('name')}</label><input className="form-input" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder={t('category_name_placeholder')} autoFocus /></div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{t('category_fields')}</label>
                <button className="btn btn-sm btn-secondary" onClick={addDraftField}>{t('add_field')}</button>
              </div>
              {newCatFields.map((f, idx) => (
                <div key={f.key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8, background: 'var(--bg-glass)' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input className="form-input" style={{ flex: 1 }} placeholder={t('field_label_ph')}
                      value={f.label} onChange={e => updateDraftField(idx, { label: e.target.value })} />
                    <button className="btn btn-sm btn-danger" style={{ flexShrink: 0 }} onClick={() => removeDraftField(idx)}>✕</button>
                  </div>
                  <input className="form-input" style={{ marginBottom: 6 }} placeholder={t('field_placeholder_ph')}
                    value={f.placeholder || ''} onChange={e => updateDraftField(idx, { placeholder: e.target.value })} />
                  <input className="form-input" placeholder={t('field_options_ph')}
                    value={f.optionsStr || ''} onChange={e => updateDraftField(idx, { optionsStr: e.target.value })} />
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={closeAddCategory}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleAddCategory}>{t('add')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
