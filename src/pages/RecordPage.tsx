import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { getAccountsWithLatest, deleteAccount, updateAccount, archiveAccount, restoreAccount, type AccountWithLatest } from '../services/assetService';
import { db, type Settings } from '../db';
import { useAppContext } from '../app-context';
import AccountForm from '../components/AccountForm';
import { useTranslation } from 'react-i18next';
import { getFieldsForCategory } from '../lib/categoryFields';
import { isProductPortfolioCategory } from '../lib/productPortfolio';
import { setAccountPortfolioMode } from '../services/holdingService';
import { RATES_REFRESHED_EVENT } from '../services/rateService';
import { formatLocalDate } from '../lib/localDate';
import { isAccountHidden, isAccountIncludedInTotals } from '../lib/accountPreferences';

interface Props { onOpenAccount: (id: string) => void; onRefresh: () => void; }
interface EditingAccountState {
  id: string;
  name: string;
  category: string;
  institution: string;
  currency: string;
  type: 'asset' | 'liability';
  portfolio: boolean;
  includeInTotals: boolean;
}

const SCROLL_Y_KEY = 'fortuna-record-scroll-y';
const getSavedScrollY = () => Number(sessionStorage.getItem(SCROLL_Y_KEY) || 0);
const setSavedScrollY = (value: number) => sessionStorage.setItem(SCROLL_Y_KEY, String(value));

export default function RecordPage({ onOpenAccount }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, amountVisible, setAmountVisible, settings: appSettings } = useAppContext();
  const [accounts, setAccounts] = useState<AccountWithLatest[]>([]);
  const [archivedAccounts, setArchivedAccounts] = useState<AccountWithLatest[]>([]);
  const [activeAccountCount, setActiveAccountCount] = useState(0);
  const [hiddenAccountCount, setHiddenAccountCount] = useState(0);
  const [totals, setTotals] = useState({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
  const [unavailableValuations, setUnavailableValuations] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [editingAcct, setEditingAcct] = useState<EditingAccountState | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ acctId: string; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2000);
  };

  const load = useCallback(async (showSpinner = true) => {
    if (!appSettings) return;
    if (showSpinner) setLoading(true);
    setLoadError(false);
    try {
      const allData = await getAccountsWithLatest({ includeArchived: true, settings: appSettings });
      const active = allData.accounts.filter(account => !account.archivedAt);
      const visibleActive = active.filter(account => !isAccountHidden(account));
      const archived = allData.accounts
        .filter(account => Boolean(account.archivedAt) && !isAccountHidden(account))
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
      const included = active.filter(isAccountIncludedInTotals);
      const totalAssets = included.filter(account => account.type === 'asset').reduce((sum, account) => sum + account.convertedAmount, 0);
      const totalLiabilities = included.filter(account => account.type === 'liability').reduce((sum, account) => sum + account.convertedAmount, 0);
      setSettings(appSettings);
      setAccounts(visibleActive);
      setArchivedAccounts(archived);
      setActiveAccountCount(active.length);
      setHiddenAccountCount(allData.accounts.filter(isAccountHidden).length);
      setTotals({ totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities });
      setUnavailableValuations(included.filter(account => account.conversionUnavailable).length);
    } catch (error) {
      console.error('Failed to load asset overview', error);
      setLoadError(true);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [appSettings]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onRatesRefreshed = () => { void load(false); };
    window.addEventListener(RATES_REFRESHED_EVENT, onRatesRefreshed);
    return () => window.removeEventListener(RATES_REFRESHED_EVENT, onRatesRefreshed);
  }, [load]);

  useEffect(() => {
    const hasOpenModal = showForm || showExportMenu || Boolean(confirmDelete) || Boolean(editingAcct);
    document.documentElement.classList.toggle('modal-open', hasOpenModal);
    return () => document.documentElement.classList.remove('modal-open');
  }, [showForm, showExportMenu, confirmDelete, editingAcct]);

  useLayoutEffect(() => {
    const savedScrollY = getSavedScrollY();
    if (!loading && savedScrollY > 0) {
      const sc = document.querySelector('.app-content') as HTMLElement | null;
      if (sc) sc.scrollTop = savedScrollY;
      else window.scrollTo(0, savedScrollY);
    }
  }, [loading]);

  const openAccount = (id: string) => {
    const sc = document.querySelector('.app-content') as HTMLElement | null;
    setSavedScrollY(sc ? sc.scrollTop : window.scrollY);
    onOpenAccount(id);
  };

  const handleDelete = async (id: string) => { await deleteAccount(id); setConfirmDelete(null); setContextMenu(null); showToast(t('deleted_toast')); load(); };
  const handleArchive = async (id: string) => { await archiveAccount(id); setContextMenu(null); showToast(t('archived_toast')); load(); };
  const handleRestore = async (id: string) => { await restoreAccount(id); setContextMenu(null); showToast(t('restored_toast')); load(); };
  const handleHide = async (id: string) => {
    await updateAccount(id, { hidden: true });
    setContextMenu(null);
    showToast(t('account_hidden_toast'));
    load();
  };
  const handleToggleIncludeInTotals = async (account: AccountWithLatest) => {
    const includeInTotals = !isAccountIncludedInTotals(account);
    await updateAccount(account.id, { includeInTotals });
    setContextMenu(null);
    showToast(t(includeInTotals ? 'account_included_toast' : 'account_excluded_toast'));
    load();
  };
  const toggleArchivedAccounts = async () => {
    if (!settings) return;
    const updated = { ...settings, showArchivedAccounts: !(settings.showArchivedAccounts ?? true) };
    await db.settings.put(updated);
    setSettings(updated);
  };

  const handleEditSave = async () => {
    if (!editingAcct) return;
    const currentAcct = [...accounts, ...archivedAccounts].find(acct => acct.id === editingAcct.id);
    const supportsPortfolio = isProductPortfolioCategory(editingAcct.category, editingAcct.type);
    const nextPortfolio = supportsPortfolio && editingAcct.portfolio;
    if (currentAcct?.portfolio && !nextPortfolio) await setAccountPortfolioMode(editingAcct.id, false);
    await updateAccount(editingAcct.id, {
      name: editingAcct.name.trim() || editingAcct.name,
      category: editingAcct.category,
      institution: editingAcct.institution.trim() || undefined,
      currency: editingAcct.currency,
      icon: settings?.categories.find(c => c.name === editingAcct.category)?.icon,
      includeInTotals: editingAcct.includeInTotals,
    });
    if (!currentAcct?.portfolio && nextPortfolio) await setAccountPortfolioMode(editingAcct.id, true);
    if (currentAcct?.portfolio && nextPortfolio) await setAccountPortfolioMode(editingAcct.id, true);
    setEditingAcct(null);
    load();
  };

  const handleCreated = (id: string) => { setShowForm(false); load(); onOpenAccount(id); };

  const handleExportImage = async () => {
    try {
      const [{ Share }, { Filesystem, Directory }, { generateReportCanvas }] = await Promise.all([
        import('@capacitor/share'),
        import('@capacitor/filesystem'),
        import('../lib/reportGenerator'),
      ]);
      const canvas = generateReportCanvas({
        accounts,
        totalAssets: totals.totalAssets,
        totalLiabilities: totals.totalLiabilities,
        netWorth: totals.netWorth,
        settings: settings!,
        t,
        isEn: i18n.language.startsWith('en'),
        assetColor: theme.assetColor,
        liabilityColor: theme.liabilityColor,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const fileName = `Fortuna_Report_${formatLocalDate()}.png`;
      try {
        const f = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
        await Share.share({ title: t('export_report_title'), url: f.uri, dialogTitle: t('export_report_title') });
      } catch {
        const byteArr = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([byteArr], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
      }
      showToast(t('export_success'));
    } catch (e) {
      console.error(e);
      showToast(t('export_failed'), 'error');
    }
  };

  const handleExportExcel = async () => {
    if (!settings) return;
    try {
      const [{ Share }, { Filesystem, Directory }, XLSX] = await Promise.all([
        import('@capacitor/share'),
        import('@capacitor/filesystem'),
        import('xlsx'),
      ]);
      const isEn = i18n.language.startsWith('en');
      const primary = settings.primaryCurrency;

      // Group accounts by category
      const catMap: Record<string, { accounts: AccountWithLatest[]; total: number; type: 'asset' | 'liability' }> = {};
      for (const a of accounts) {
        if (!catMap[a.category]) catMap[a.category] = { accounts: [], total: 0, type: a.type };
        catMap[a.category].accounts.push(a);
        if (isAccountIncludedInTotals(a)) catMap[a.category].total += a.convertedAmount;
      }
      const groups = Object.entries(catMap).sort(([, a], [, b]) => {
        if (a.type !== b.type) return a.type === 'asset' ? -1 : 1;
        return b.total - a.total;
      });

      const fmtNum = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const rows: (string | number)[][] = [];
      const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

      // Top header
      const dateStr = new Date().toLocaleDateString(isEn ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      rows.push([t('export_report_title'), '', '', '', '', dateStr]);
      rows.push([
        `${t('total_assets')}: ${primary} ${fmtNum(totals.totalAssets)}  |  ${t('total_liabilities')}: ${primary} ${fmtNum(totals.totalLiabilities)}  |  ${t('net_worth_val')}: ${primary} ${fmtNum(totals.netWorth)}`,
      ]);
      rows.push([]);
      rows.push([]);

      const commonHeaders = [
        t('institution'),
        t('account_name'),
        t('currency_label'),
        t('latest_balance'),
        t('converted') + ' (' + primary + ')',
        t('last_updated_date'),
      ];

      for (const [catName, v] of groups) {
        const titleRow = rows.length;
        rows.push([`${t(catName)}  —  ${t('subtotal')}: ${primary} ${fmtNum(v.total)}`]);
        merges.push({ s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 5 } });

        // Column headers with category fields appended
        const fields = getFieldsForCategory(catName, settings, t);
        const header = [...commonHeaders, ...fields.map(f => f.label)];
        rows.push(header);

        for (const a of v.accounts) {
          const baseRow = [
            a.institution || '',
            a.name,
            a.unit === 'gram' ? 'g' : a.currency,
            a.unit === 'gram' ? a.latestAmount.toFixed(2) + ' g' : Number(a.latestAmount.toFixed(2)),
            Number(a.convertedAmount.toFixed(2)),
            a.latestDate,
          ];
          for (const f of fields) {
            baseRow.push(a.productData?.[f.key] || '');
          }
          rows.push(baseRow);
        }
        rows.push([]);
        rows.push([]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!merges'] = merges;
      ws['!cols'] = [
        { wch: 16 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      ];

      const wb = XLSX.utils.book_new();
      const sheetName = isEn ? 'Assets' : '资产清单';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      const fileName = `Fortuna_Assets_${formatLocalDate()}.xlsx`;
      try {
        const f = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
        await Share.share({ title: t('export_report_title'), url: f.uri, dialogTitle: t('export_report_title') });
      } catch {
        const byteArr = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([byteArr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
      }
      showToast(t('export_success'));
    } catch (e) {
      console.error(e);
      showToast(t('export_failed'), 'error');
    }
  };

  const fmt = (n: number) => {
    const isEn = i18n.language.startsWith('en');
    if (isEn) {
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + t('unit_yi');
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + t('unit_wan');
      return n.toFixed(2);
    }
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + t('unit_yi');
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + t('unit_wan');
    return n.toFixed(2);
  };
  const masked = (text: string) => amountVisible ? text : '****';
  const assetAccounts = accounts.filter(a => a.type === 'asset');
  const liabilityAccounts = accounts.filter(a => a.type === 'liability');
  const hasAnyAccounts = accounts.length > 0 || archivedAccounts.length > 0 || hiddenAccountCount > 0;
  const showArchivedAccounts = settings?.showArchivedAccounts ?? true;

  // Long-press handlers
  const startLongPress = useCallback((acctId: string, e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ acctId, x: Math.min(clientX, window.innerWidth - 180), y: Math.min(clientY, window.innerHeight - 140) });
    }, 500);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const handleItemClick = useCallback((id: string) => {
    if (!contextMenu) {
      const sc = document.querySelector('.app-content') as HTMLElement | null;
      setSavedScrollY(sc ? sc.scrollTop : window.scrollY);
      onOpenAccount(id);
    }
  }, [contextMenu, onOpenAccount]);

  const renderAmount = (acct: AccountWithLatest) => {
    if (acct.unit === 'gram') {
      return (
        <div className="entry-amount">
          <div className="entry-amount-value" style={{ color: acct.type === 'asset' ? theme.assetColor : theme.liabilityColor }}>
            {masked(acct.latestAmount.toFixed(2) + ' ' + (acct.unit === 'gram' ? 'g' : ''))}
          </div>
          {acct.metalValueInCurrency !== undefined && (
            <div className="entry-amount-currency">{masked('≈ ' + fmt(acct.metalValueInCurrency) + ' ' + acct.currency)}</div>
          )}
        </div>
      );
    }
    return (
      <div className="entry-amount">
        <div className="entry-amount-value" style={{ color: acct.type === 'asset' ? theme.assetColor : theme.liabilityColor }}>
          {masked(acct.latestAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
        </div>
        <div className="entry-amount-currency">
          {acct.currency !== settings?.primaryCurrency && (
            acct.conversionUnavailable
              ? t('conversion_unavailable')
              : masked('≈ ' + fmt(acct.convertedAmount) + ' ' + (settings?.primaryCurrency || ''))
          )}
        </div>
      </div>
    );
  };

  const renderEntryItem = (acct: AccountWithLatest) => (
      <div className="entry-item" key={acct.id}
        role="button"
        tabIndex={0}
        aria-label={`${acct.name}, ${t('view_details')}`}
        style={acct.archivedAt ? { opacity: 0.72 } : undefined}
        onClick={() => handleItemClick(acct.id)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleItemClick(acct.id);
          } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            setContextMenu({ acctId: acct.id, x: Math.max(16, window.innerWidth / 2 - 90), y: Math.max(16, window.innerHeight / 2 - 70) });
          }
        }}
        onTouchStart={e => startLongPress(acct.id, e)}
        onTouchEnd={cancelLongPress} onTouchMove={cancelLongPress}
        onContextMenu={e => { e.preventDefault(); setContextMenu({ acctId: acct.id, x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 140) }); }}>
        <div className="entry-info">
          <div className="entry-category">{acct.name}</div>
          <div className="entry-note-text">
            {acct.archivedAt && <span style={{ background: 'var(--bg-glass)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 7px', marginRight: 5, fontSize: '0.65rem', fontWeight: 600 }}>{t('archived_badge')}</span>}
            {!isAccountIncludedInTotals(acct) && <span style={{ background: 'var(--bg-glass)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 7px', marginRight: 5, fontSize: '0.65rem', fontWeight: 600 }}>{t('excluded_from_totals_badge')}</span>}
            {acct.institution && <span style={{ background: 'var(--asset-dim)', color: 'var(--asset-color)', borderRadius: 10, padding: '1px 7px', marginRight: 5, fontSize: '0.65rem', fontWeight: 600 }}>{acct.institution}</span>}
            {t(acct.category)} · {acct.unit === 'gram' ? t('precious_metal_label') : acct.currency}
          </div>
        </div>
        {renderAmount(acct)}
      </div>
  );

  return (
    <>
      {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live="polite">{toast.msg}</div>}
      <div className="page-header">
        <div>
          <h1 className="page-title">Fortuna</h1>
          <p className="page-subtitle">{t('smart_tracking')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowExportMenu(true)} title={t('export_accounts')} aria-label={t('export_accounts')}>📥</button>
          <button className="btn btn-sm btn-secondary" onClick={() => setAmountVisible(!amountVisible)}
            title={amountVisible ? t('hide_amount') : t('show_amount')} aria-label={amountVisible ? t('hide_amount') : t('show_amount')}>
            {amountVisible ? '👁️' : '🔒'}
          </button>
        </div>
      </div>

      {activeAccountCount > 0 && settings && (
        <div className={`summary-strip ${i18n.language.startsWith('en') ? 'no-box' : ''}`}>
          <div className="summary-strip-item">
            <span className="stat-label">{t('total_assets')}</span>
            <span className="stat-value" style={{ color: theme.assetColor }}>
              {masked(fmt(totals.totalAssets))}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '-1px' }}>{settings.primaryCurrency}</span>
          </div>
          <div className="summary-strip-item">
            <span className="stat-label">{t('total_liabilities')}</span>
            <span className="stat-value" style={{ color: theme.liabilityColor }}>
              {masked(fmt(totals.totalLiabilities))}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '-1px' }}>{settings.primaryCurrency}</span>
          </div>
          <div className="summary-strip-item">
            <span className="stat-label">{t('net_worth_val')}</span>
            <span className="stat-value" style={{ color: totals.netWorth >= 0 ? theme.assetColor : theme.liabilityColor }}>
              {masked(fmt(totals.netWorth))}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '-1px' }}>{settings.primaryCurrency}</span>
          </div>
        </div>
      )}
      {unavailableValuations > 0 && (
        <div className="valuation-warning" role="status">⚠️ {t('some_values_excluded', { count: unavailableValuations })}</div>
      )}

      {loading ? <div className="loading" role="status" aria-label={t('loading')}><div className="spinner" /></div>
      : loadError ? (
        <div className="empty-state" role="alert">
          <div className="empty-icon">⚠️</div>
          <div className="empty-text">{t('load_failed')}</div>
          <div className="empty-hint">{t('load_failed_hint')}</div>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => void load()}>{t('retry')}</button>
        </div>
      )
      : !hasAnyAccounts ? (
        <div className="empty-state">
          <div className="empty-icon">💎</div>
          <div className="empty-text">{t('start_tracking')}</div>
          <div className="empty-hint">{t('add_first_hint')}</div>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setShowForm(true)}>{t('add_first_account')}</button>
        </div>
      ) : (
        <>
          {accounts.length === 0 && (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <div className="empty-icon">{hiddenAccountCount > 0 ? '🙈' : '📦'}</div>
              <div className="empty-text">{hiddenAccountCount > 0 ? t('all_accounts_hidden') : t('no_active_accounts')}</div>
              <div className="empty-hint">{hiddenAccountCount > 0 ? t('all_accounts_hidden_hint') : t('archived_accounts_hint')}</div>
            </div>
          )}
          {assetAccounts.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '1rem 0 0.5rem', color: theme.assetColor }}>{t('assets')}</h2>
              {Object.entries(assetAccounts.reduce((acc, acct) => {
                if (!acc[acct.category]) acc[acct.category] = [];
                acc[acct.category].push(acct);
                return acc;
              }, {} as Record<string, AccountWithLatest[]>)).map(([category, items]) => {
                const subtotal = items.filter(isAccountIncludedInTotals).reduce((sum, item) => sum + (item.convertedAmount || 0), 0);
                return (
                  <div key={category} style={{ marginBottom: '0.75rem' }}>
                    <div className="entry-group-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="dot" style={{ background: theme.assetColor }} />{t(category)} ({items.length})
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)' }}>{masked(fmt(subtotal))}</div>
                    </div>
                    {items.map(acct => renderEntryItem(acct))}
                  </div>
                );
              })}
            </div>
          )}
          
          {liabilityAccounts.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '1rem 0 0.5rem', color: theme.liabilityColor }}>{t('liabilities')}</h2>
              {Object.entries(liabilityAccounts.reduce((acc, acct) => {
                if (!acc[acct.category]) acc[acct.category] = [];
                acc[acct.category].push(acct);
                return acc;
              }, {} as Record<string, AccountWithLatest[]>)).map(([category, items]) => {
                const subtotal = items.filter(isAccountIncludedInTotals).reduce((sum, item) => sum + (item.convertedAmount || 0), 0);
                return (
                  <div key={category} style={{ marginBottom: '0.75rem' }}>
                    <div className="entry-group-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="dot" style={{ background: theme.liabilityColor }} />{t(category)} ({items.length})
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)' }}>{masked(fmt(subtotal))}</div>
                    </div>
                    {items.map(acct => renderEntryItem(acct))}
                  </div>
                );
              })}
            </div>
          )}
          {archivedAccounts.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '1rem 0 0.5rem' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--text-muted)' }}>{t('archived_accounts')} ({archivedAccounts.length})</h2>
                <button
                  className={`btn btn-sm ${showArchivedAccounts ? 'btn-secondary' : 'btn-primary'}`}
                  role="switch"
                  aria-checked={showArchivedAccounts}
                  onClick={toggleArchivedAccounts}
                  style={{ flexShrink: 0, minWidth: 88, whiteSpace: 'nowrap' }}>
                  {showArchivedAccounts ? `👁️ ${t('hide_archived_assets')}` : `📦 ${t('show_archived_assets')}`}
                </button>
              </div>
              {showArchivedAccounts && (
                <>
                  <div className="entry-group-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="dot" style={{ background: 'var(--text-muted)' }} />{t('archived_history')}
                    </div>
                    <div>{t('history_records')}</div>
                  </div>
                  {archivedAccounts.map(acct => renderEntryItem(acct))}
                </>
              )}
            </div>
          )}
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textAlign: 'center', margin: '12px 0 24px' }}>{t('long_press_hint')}</div>
        </>
      )}

      {showExportMenu && (
        <div className="modal-overlay" onClick={() => setShowExportMenu(false)} role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="export-format-title" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <h2 className="modal-title" id="export-format-title">{t('choose_export_format')}</h2>
              <button type="button" className="modal-close" onClick={() => setShowExportMenu(false)} aria-label={t('close')}>✕</button>
            </div>
            <button className="btn btn-primary btn-block" style={{ marginBottom: 10 }} onClick={() => { setShowExportMenu(false); handleExportImage(); }}>
              🖼️ {t('export_as_image')}
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => { setShowExportMenu(false); handleExportExcel(); }}>
              📊 {t('export_as_excel')}
            </button>
          </div>
        </div>
      )}

      <button type="button" className="fab" onClick={() => setShowForm(true)} aria-label={t('add_account')}>+</button>
      {showForm && settings && <AccountForm settings={settings} onClose={() => setShowForm(false)} onCreated={handleCreated} />}

      {/* Context Menu (long-press) */}
      {contextMenu && (
        <>
          <div className="context-menu-overlay" onClick={() => setContextMenu(null)} />
          <div className="context-menu" role="menu" aria-label={t('account_actions')} style={{ left: contextMenu.x, top: contextMenu.y }}>
            {(() => {
              const acct = [...accounts, ...archivedAccounts].find(a => a.id === contextMenu.acctId);
              if (!acct) return null;
              return (
                <>
                  <button className="context-menu-item" onClick={() => { setContextMenu(null); openAccount(contextMenu.acctId); }}>
                    📝 {t('view_details')}
                  </button>
                  {!acct.archivedAt && (
                    <button className="context-menu-item" onClick={() => {
                      setEditingAcct({
                        id: acct.id,
                        name: acct.name,
                        category: acct.category,
                        institution: acct.institution || '',
                        currency: acct.currency,
                        type: acct.type,
                        portfolio: Boolean(acct.portfolio),
                        includeInTotals: isAccountIncludedInTotals(acct),
                      });
                      setContextMenu(null);
                    }}>
                      ✏️ {t('edit_account')}
                    </button>
                  )}
                  {!acct.archivedAt && (
                    <button className="context-menu-item" onClick={() => handleHide(acct.id)}>
                      🙈 {t('hide_account')}
                    </button>
                  )}
                  {!acct.archivedAt && (
                    <button className="context-menu-item" onClick={() => handleToggleIncludeInTotals(acct)}>
                      {isAccountIncludedInTotals(acct) ? '➖' : '➕'} {t(isAccountIncludedInTotals(acct) ? 'exclude_from_totals_action' : 'include_in_totals_action')}
                    </button>
                  )}
                  {acct.archivedAt ? (
                    <button className="context-menu-item" onClick={() => handleRestore(acct.id)}>
                      ↩️ {t('restore_account')}
                    </button>
                  ) : (
                    <button className="context-menu-item" onClick={() => handleArchive(acct.id)}>
                      📦 {t('archive_account')}
                    </button>
                  )}
                  <button className="context-menu-item danger" onClick={() => { setConfirmDelete(contextMenu.acctId); setContextMenu(null); }}>
                    🗑️ {t('delete_account_menu')}
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}

      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div className="confirm-msg">{t('delete_confirm_msg')}</div>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>{t('confirm_delete')}</button>
            </div>
          </div>
        </div>
      )}

      {editingAcct && settings && (
        <div className="confirm-overlay" onClick={() => setEditingAcct(null)}>
          <div className="modal-content" style={{ maxWidth: 440, width: '92%', borderRadius: 16, padding: '20px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{t('edit_account')}</h2>
              <button className="modal-close" onClick={() => setEditingAcct(null)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">{t('name')}</label>
              <input className="form-input" value={editingAcct.name}
                onChange={e => setEditingAcct(prev => prev ? { ...prev, name: e.target.value } : null)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('category')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {settings.categories.filter(c => c.type === editingAcct.type).map(c => (
                  <button key={c.name}
                    style={{ padding: '6px 12px', borderRadius: 20, border: `1px solid ${editingAcct.category === c.name ? 'var(--asset-color)' : 'var(--border)'}`, background: editingAcct.category === c.name ? 'var(--asset-dim)' : 'var(--bg-glass)', color: editingAcct.category === c.name ? 'var(--asset-color)' : 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer', fontWeight: editingAcct.category === c.name ? 600 : 400 }}
                    onClick={() => setEditingAcct(prev => prev ? { ...prev, category: c.name } : null)}>
                    {t(c.name)}
                  </button>
                ))}
              </div>
            </div>
            {isProductPortfolioCategory(editingAcct.category, editingAcct.type) && (
              <div className="form-group">
                <label className="form-label">{t('manage_mode')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button className={`btn ${editingAcct.portfolio ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setEditingAcct(prev => prev ? { ...prev, portfolio: true } : null)}>{t('mode_portfolio')}</button>
                  <button className={`btn ${!editingAcct.portfolio ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setEditingAcct(prev => prev ? { ...prev, portfolio: false } : null)}>{t('mode_single')}</button>
                </div>
                {editingAcct.portfolio && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, padding: '8px 12px', background: 'var(--bg-glass)', borderRadius: 8 }}>
                    {t('portfolio_hint')}
                  </div>
                )}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">{t('institution')}</label>
              <input className="form-input" placeholder={t('institution_ph')} value={editingAcct.institution}
                onChange={e => setEditingAcct(prev => prev ? { ...prev, institution: e.target.value } : null)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('currency_label')}</label>
              <select className="form-select" value={editingAcct.currency}
                onChange={e => setEditingAcct(prev => prev ? { ...prev, currency: e.target.value } : null)}>
                {settings.currencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <div className="preference-toggle-card">
                <div className="preference-toggle-copy">
                  <div className="preference-toggle-title">{t('include_in_totals')}</div>
                  <div className="preference-toggle-hint">{t('include_in_totals_hint')}</div>
                </div>
                <button type="button"
                  className={`toggle-switch ${editingAcct.includeInTotals ? 'active' : ''}`}
                  role="switch" aria-checked={editingAcct.includeInTotals}
                  aria-label={t('include_in_totals')}
                  onClick={() => setEditingAcct(prev => prev ? { ...prev, includeInTotals: !prev.includeInTotals } : null)}>
                  <span />
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary btn-block" onClick={() => setEditingAcct(null)}>{t('cancel')}</button>
              <button className="btn btn-primary btn-block" onClick={handleEditSave}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
