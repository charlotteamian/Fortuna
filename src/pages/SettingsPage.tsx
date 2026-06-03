import { useState, useEffect, useRef } from 'react';
import { db, initializeSettings, DEFAULT_CATEGORIES, CURRENCY_NAMES, COLOR_THEMES, exportToExcel, importFromExcel, type Settings, type CustomField } from '../db';
import { refreshAllRates, getLastUpdateTime } from '../services/rateService';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { useTranslation } from 'react-i18next';

interface Props { onRefresh: () => void; }

export default function SettingsPage({ onRefresh }: Props) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'asset' | 'liability'>('asset');
  const newCatIcon = '📌';
  const [newCatFields, setNewCatFields] = useState<(CustomField & { optionsStr?: string })[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2000);
  };

  const load = async () => { const s = await initializeSettings(); setSettings(s); const t = await getLastUpdateTime(); setLastUpdate(t); };
  useEffect(() => { load(); }, []);

  const save = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const updated = { ...settings, ...updates };
    await db.settings.put(updated); setSettings(updated); onRefresh();
  };

  const handleRefreshRates = async () => {
    if (!settings) return;
    setSyncing(true);
    try { await refreshAllRates(settings.primaryCurrency); showToast(t('rates_updated')); const updatedTime = await getLastUpdateTime(); setLastUpdate(updatedTime); }
    catch { showToast(t('rates_failed'), 'error'); }
    setSyncing(false);
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
    save({ categories: [...settings.categories, { name: newCatName.trim(), type: newCatType, icon: newCatIcon, fields: fields.length > 0 ? fields : undefined }] });
    setNewCatName(''); setNewCatFields([]); setShowAddCategory(false); showToast(t('cat_added'));
  };

  const handleDeleteCategory = async (name: string) => {
    if (!settings) return;
    const inUse = await db.accounts.where('category').equals(name).count();
    if (inUse > 0) { showToast(t('cat_in_use'), 'error'); return; }
    save({ categories: settings.categories.filter(c => c.name !== name) });
    showToast(t('cat_deleted'));
  };
  const handleResetCategories = () => { save({ categories: [...DEFAULT_CATEGORIES] }); showToast(t('cat_reset')); };
  const handleAddCurrency = (code: string) => { if (!settings || settings.currencies.includes(code)) return; save({ currencies: [...settings.currencies, code] }); };
  const handleRemoveCurrency = (code: string) => { if (!settings) return; save({ currencies: settings.currencies.filter(c => c !== code) }); };

  const handleExport = async () => {
    try {
      const base64Data = await exportToExcel();
      const fileName = `fortuna_backup_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      try {
        const writeResult = await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Cache,
        });
        
        await Share.share({
          title: 'Fortuna 备份数据',
          text: '这是我的 Fortuna 资产备份文件 (Excel)',
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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      if (result) {
        // result is "data:application/vnd...;base64,XXXXXX"
        const base64Data = result.split(',')[1];
        if (base64Data) {
          const success = await importFromExcel(base64Data);
          if (success) { showToast(t('import_success')); load(); onRefresh(); }
          else { showToast(t('import_failed'), 'error'); }
        }
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };



  if (!settings) return <div className="loading"><div className="spinner" /></div>;

  const availableCurrencies = Object.keys(CURRENCY_NAMES).filter(c => !settings.currencies.includes(c));

  return (
    <>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <div className="page-header"><div><h1 className="page-title">{t('settings')}</h1><p className="page-subtitle">{t('about_title')} {t('app_name')}</p></div></div>

      {/* Theme Mode & Font Size & Language */}
      <div className="settings-section">
        <div className="settings-section-title">{t('display')}</div>
        
        <div className="settings-item">
          <span className="settings-item-label">{t('language')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '6px 30px 6px 12px', fontSize: '0.875rem' }}
            value={settings.language || 'auto'} onChange={e => save({ language: e.target.value as Settings['language'] })}>
            <option value="auto">{t('auto')}</option>
            <option value="zh">{t('zh')}</option>
            <option value="en">{t('en')}</option>
          </select>
        </div>

        <div className="settings-item">
          <span className="settings-item-label">{t('theme_mode')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '6px 30px 6px 12px', fontSize: '0.875rem' }}
            value={settings.themeMode || 'auto'} onChange={e => save({ themeMode: e.target.value as Settings['themeMode'] })}>
            <option value="auto">{t('system_auto')}</option>
            <option value="light">{t('light_mode')}</option>
            <option value="dark">{t('dark_mode')}</option>
          </select>
        </div>
 
        <div className="settings-item">
          <span className="settings-item-label">{t('font_size')}</span>
          <select className="form-select" style={{ width: 'auto', padding: '6px 30px 6px 12px', fontSize: '0.875rem' }}
            value={settings.fontSize || 'normal'} onChange={e => save({ fontSize: e.target.value as Settings['fontSize'] })}>
            <option value="small">{t('small')}</option>
            <option value="normal">{t('normal')}</option>
            <option value="large">{t('large')}</option>
          </select>
        </div>
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
              <div style={{ fontSize: 12, color: settings.colorTheme === themeItem.id ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: settings.colorTheme === themeItem.id ? 700 : 400 }}>
                {t(themeItem.id)}
              </div>
              {settings.colorTheme === themeItem.id && <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>✓ {t('current_theme')}</div>}
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
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
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
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{lastUpdate ? new Date(lastUpdate).toLocaleString(t('zh') === '简体中文' ? 'zh-CN' : 'en-US') : t('never_updated')}</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleRefreshRates} disabled={syncing}>{syncing ? '...' : '🔄 ' + t('refresh_rates')}</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('rate_source')}</div>
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
            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteCategory(c.name)} style={{ padding: '4px 8px', fontSize: 11 }}>✕</button>
          </div>
        ))}
      </div>

      {/* Currencies */}
      <div className="settings-section">
        <div className="settings-section-title">{t('common_currencies')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
          {settings.currencies.map(c => <span className="tag" key={c}>{c}<span className="tag-remove" onClick={() => handleRemoveCurrency(c)}>✕</span></span>)}
        </div>
        {availableCurrencies.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{t('click_to_add')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {availableCurrencies.map(c => <span className="tag" key={c} style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => handleAddCurrency(c)}>+ {c}</span>)}
            </div>
          </div>
        )}
      </div>



      {/* Backup and Restore */}
      <div className="settings-section">
        <div className="settings-section-title">{t('backup_restore')}</div>
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
        <div className="settings-item" style={{ cursor: 'pointer' }} onClick={() => setShowGuide(true)}>
          <span className="settings-item-label" style={{ color: 'var(--accent)' }}>{t('user_guide_title')}</span>
          <span className="settings-item-value">{t('click_to_view')}</span>
        </div>
        <div className="settings-item">
          <span className="settings-item-label">Fortuna</span>
          <span className="settings-item-value">v4.0.0</span>
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4 }}>{t('data_security_hint')}</div>
      </div>

      {/* User Guide Modal */}
      {showGuide && (
        <div className="modal-overlay" onClick={() => setShowGuide(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 className="modal-title">{t('user_guide_title')}</h2><button className="modal-close" onClick={() => setShowGuide(false)}>✕</button></div>
            <div style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 4, fontSize: '1rem' }}>{t('guide_assets')}</h3>
              <p style={{ marginBottom: 8 }}>{t('guide_assets_1')}</p>
              <p style={{ marginBottom: 12 }}>{t('guide_assets_2')}</p>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 4, fontSize: '1rem', marginTop: 16 }}>{t('guide_accounts')}</h3>
              <p style={{ marginBottom: 12 }}>{t('guide_accounts_1')}</p>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 4, fontSize: '1rem', marginTop: 16 }}>{t('guide_charts')}</h3>
              <p style={{ marginBottom: 12 }}>{t('guide_charts_1')}</p>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 4, fontSize: '1rem', marginTop: 16 }}>{t('guide_categories')}</h3>
              <p style={{ marginBottom: 12 }}>{t('guide_categories_1')}</p>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 4, fontSize: '1rem', marginTop: 16 }}>{t('guide_export')}</h3>
              <p style={{ marginBottom: 12 }}>{t('guide_export_1')}</p>
              <h3 style={{ color: 'var(--text-primary)', marginBottom: 4, fontSize: '1rem', marginTop: 16 }}>{t('guide_security')}</h3>
              <p style={{ marginBottom: 12 }}>{t('guide_security_1')}</p>
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-primary btn-block" onClick={() => setShowGuide(false)}>{t('i_know')}</button>
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
