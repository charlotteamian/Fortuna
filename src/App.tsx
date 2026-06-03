import React, { useState, useEffect } from 'react';
import './index.css';
import RecordPage from './pages/RecordPage';
import AccountDetail from './pages/AccountDetail';
import ChartPage from './pages/ChartPage';
import ProductsPage from './pages/ProductsPage';
import SettingsPage from './pages/SettingsPage';
import { initializeSettings, getTheme, type Settings } from './db';
import { useTranslation } from 'react-i18next';
import { AppContext } from './app-context';

type Tab = 'record' | 'chart' | 'products' | 'settings';

function App() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('record');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [amountVisible, setAmountVisible] = useState(true);

  const refresh = () => setRefreshKey(k => k + 1);

  const loadSettings = async () => {
    const s = await initializeSettings();
    setSettings(s);
    setAmountVisible(s.amountVisible);
    
    const root = document.documentElement;
    // Theme Mode
    const isDark = s.themeMode === 'dark' || (s.themeMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('light-mode', !isDark);
    root.classList.toggle('dark-mode', isDark);

    // Font Size
    root.classList.remove('font-small', 'font-normal', 'font-large');
    root.classList.add(`font-${s.fontSize || 'normal'}`);

    // Apply theme colors as CSS variables
    const tConfig = getTheme(s.colorTheme);
    root.style.setProperty('--asset-color', tConfig.assetColor);
    root.style.setProperty('--asset-dim', tConfig.assetDim);
    root.style.setProperty('--liability-color', tConfig.liabilityColor);
    root.style.setProperty('--liability-dim', tConfig.liabilityDim);
    
    // Language
    if (s.language === 'auto') {
      const sysLang = navigator.language.startsWith('zh') ? 'zh' : 'en';
      if (i18n.language !== sysLang) i18n.changeLanguage(sysLang);
    } else if (s.language && i18n.language !== s.language) {
      i18n.changeLanguage(s.language);
    }
  };

  useEffect(() => { 
    loadSettings(); 
    // Listen for system theme changes if set to auto
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (settings?.themeMode === 'auto') loadSettings(); };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [settings?.themeMode]);

  const theme = getTheme(settings?.colorTheme || 'red-green');

  const openAccount = (id: string) => setEditingAccountId(id);
  const closeAccount = () => { setEditingAccountId(null); refresh(); };

  if (editingAccountId) {
    return (
      <AppContext.Provider value={{ theme, amountVisible, setAmountVisible, settings, reloadSettings: loadSettings }}>
        <AccountDetail accountId={editingAccountId} onBack={closeAccount} />
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={{ theme, amountVisible, setAmountVisible, settings, reloadSettings: loadSettings }}>
      <div className="app">
        <div className="app-content">
          {tab === 'record' && <RecordPage key={refreshKey} onOpenAccount={openAccount} onRefresh={refresh} />}
          {tab === 'chart' && <ChartPage key={refreshKey} />}
          {tab === 'products' && <ProductsPage />}
          {tab === 'settings' && <SettingsPage onRefresh={() => { loadSettings(); refresh(); }} />}
        </div>
        <nav className="tab-bar">
          {([
            {
              key: 'record' as Tab,
              label: t('assets'),
              icon: (active: boolean) => (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--asset-color)' : 'var(--text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="3"/>
                  <path d="M16 7V5a2 2 0 00-2-2H8a2 2 0 00-2 2v2"/>
                  <circle cx="16" cy="14" r="1.5" fill={active ? 'var(--asset-color)' : 'var(--text-muted)'} stroke="none"/>
                </svg>
              ),
            },
            {
              key: 'chart' as Tab,
              label: t('net_worth'),
              icon: (active: boolean) => (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--asset-color)' : 'var(--text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3,17 8,11 13,14 21,6"/>
                  <line x1="21" y1="6" x2="21" y2="13"/>
                  <line x1="21" y1="6" x2="14" y2="6"/>
                  <line x1="3" y1="21" x2="21" y2="21"/>
                </svg>
              ),
            },
            {
              key: 'products' as Tab,
              label: t('accounts_tab'),
              icon: (active: boolean) => (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--asset-color)' : 'var(--text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                </svg>
              ),
            },
            {
              key: 'settings' as Tab,
              label: t('settings'),
              icon: (active: boolean) => (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--asset-color)' : 'var(--text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6"/>
                  <line x1="4" y1="12" x2="20" y2="12"/>
                  <line x1="4" y1="18" x2="20" y2="18"/>
                  <circle cx="9" cy="6" r="2.5" fill={active ? 'var(--asset-color)' : 'var(--text-muted)'} stroke="none"/>
                  <circle cx="15" cy="12" r="2.5" fill={active ? 'var(--asset-color)' : 'var(--text-muted)'} stroke="none"/>
                  <circle cx="9" cy="18" r="2.5" fill={active ? 'var(--asset-color)' : 'var(--text-muted)'} stroke="none"/>
                </svg>
              ),
            },
          ] as { key: Tab; label: string; icon: (active: boolean) => React.ReactNode }[]).map(({ key, label, icon }) => {
            const active = tab === key;
            return (
              <button key={key} className={`tab-item${active ? ' active' : ''}`} onClick={() => setTab(key)}>
                <div className="tab-icon-wrap">{icon(active)}</div>
                <span className="tab-label">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </AppContext.Provider>
  );
}

export default App;
