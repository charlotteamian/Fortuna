import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import './index.css';
import RecordPage from './pages/RecordPage';
import Onboarding from './components/Onboarding';
import { CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION, CURRENT_ONBOARDING_VERSION, initializeSettings, getTheme, type Settings } from './db';
import { useTranslation } from 'react-i18next';
import { AppContext } from './app-context';
import { PORTABLE_SNAPSHOT_REQUEST_EVENT } from './services/portableSnapshotEvents';
import { flushPortableSnapshot, schedulePortableSnapshot } from './services/portableSnapshotService';
import { addPortableSnapshotBackgroundListener } from './native/portableSnapshot';
import { refreshRatesInBackground } from './services/rateService';

const AccountDetail = lazy(() => import('./pages/AccountDetail'));
const ChartPage = lazy(() => import('./pages/ChartPage'));
const PlanPage = lazy(() => import('./pages/PlanPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

type Tab = 'record' | 'plan' | 'chart' | 'products' | 'settings';

function App() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('record');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [amountVisible, setAmountVisible] = useState(false);
  const [resolvedAppearance, setResolvedAppearance] = useState<'dark' | 'light'>('dark');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [startupError, setStartupError] = useState(false);

  const refresh = () => setRefreshKey(k => k + 1);

  const applySettings = useCallback((s: Settings) => {
    setSettings(s);
    setAmountVisible(s.amountVisible);
    setOnboardingOpen((s.onboardingVersion ?? CURRENT_ONBOARDING_VERSION) < CURRENT_ONBOARDING_VERSION);

    const root = document.documentElement;
    const isDark = s.themeMode === 'dark' || (s.themeMode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setResolvedAppearance(isDark ? 'dark' : 'light');
    root.classList.toggle('light-mode', !isDark);
    root.classList.toggle('dark-mode', isDark);
    root.classList.remove('font-small', 'font-normal', 'font-large');
    root.classList.add(`font-${s.fontSize || 'normal'}`);

    const themeConfig = getTheme(s.colorTheme, isDark ? 'dark' : 'light');
    root.style.setProperty('--asset-color', themeConfig.assetColor);
    root.style.setProperty('--asset-dim', themeConfig.assetDim);
    root.style.setProperty('--liability-color', themeConfig.liabilityColor);
    root.style.setProperty('--liability-dim', themeConfig.liabilityDim);

    const language = s.language === 'auto'
      ? (navigator.language.startsWith('zh') ? 'zh' : 'en')
      : (s.language ?? 'en');
    root.lang = language === 'zh' ? 'zh-CN' : 'en';
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [i18n]);

  const loadSettings = useCallback(async () => {
    setStartupError(false);
    try {
      applySettings(await initializeSettings());
    } catch (error) {
      console.error('Failed to initialize Fortuna', error);
      setStartupError(true);
    }
  }, [applySettings]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (settings?.themeMode === 'auto') void loadSettings(); };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [loadSettings, settings?.themeMode]);

  useEffect(() => {
    if (!settings) return;
    const timer = window.setTimeout(() => {
      void refreshRatesInBackground(settings.primaryCurrency, settings.goldPriceSource ?? 'international')
        .then(updated => { if (updated) schedulePortableSnapshot('market-data-refreshed'); })
        .catch(error => console.warn('Background market-data refresh failed', error));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [settings?.goldPriceSource, settings?.primaryCurrency]);

  useEffect(() => {
    if (!settings || (settings.automaticSnapshotSchemaVersion ?? 0) >= CURRENT_AUTOMATIC_SNAPSHOT_SCHEMA_VERSION) return;
    schedulePortableSnapshot('snapshot-schema-upgrade', 4000);
  }, [settings]);

  useEffect(() => {
    let nativeBackgroundListener: Awaited<ReturnType<typeof addPortableSnapshotBackgroundListener>> = null;
    let disposed = false;
    const onSyncRequested = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason ?? 'data-changed';
      schedulePortableSnapshot(reason);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushPortableSnapshot('app-backgrounded').catch(error => console.warn('Automatic snapshot background write failed', error));
      }
    };
    const onPageHide = () => {
      void flushPortableSnapshot('app-pagehide').catch(error => console.warn('Automatic snapshot page-hide write failed', error));
    };

    window.addEventListener(PORTABLE_SNAPSHOT_REQUEST_EVENT, onSyncRequested);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    void addPortableSnapshotBackgroundListener(() => {
      void flushPortableSnapshot('android-app-backgrounded').catch(error => console.warn('Automatic snapshot native background write failed', error));
    }).then(listener => {
      if (disposed) void listener?.remove();
      else nativeBackgroundListener = listener;
    });
    return () => {
      disposed = true;
      window.removeEventListener(PORTABLE_SNAPSHOT_REQUEST_EVENT, onSyncRequested);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      void nativeBackgroundListener?.remove();
    };
  }, []);

  const theme = getTheme(settings?.colorTheme || 'emerald-rose', resolvedAppearance);

  const openAccount = (id: string) => setEditingAccountId(id);
  const closeAccount = () => { setEditingAccountId(null); refresh(); };

  const pageFallback = <div className="loading" role="status" aria-label={t('loading')}><div className="spinner" /></div>;

  if (startupError) {
    return (
      <div className="startup-error" role="alert">
        <div className="empty-icon">⚠️</div>
        <div className="empty-text">{t('startup_failed')}</div>
        <div className="empty-hint">{t('startup_failed_hint')}</div>
        <button className="btn btn-primary" onClick={() => void loadSettings()}>{t('retry')}</button>
      </div>
    );
  }

  if (editingAccountId) {
    return (
      <AppContext.Provider value={{ theme, amountVisible, setAmountVisible, settings, reloadSettings: loadSettings }}>
        <Suspense fallback={pageFallback}><AccountDetail accountId={editingAccountId} onBack={closeAccount} /></Suspense>
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={{ theme, amountVisible, setAmountVisible, settings, reloadSettings: loadSettings }}>
      <div className="app">
        <main className="app-content">
          {tab === 'record' && <RecordPage key={refreshKey} onOpenAccount={openAccount} onRefresh={refresh} />}
          <Suspense fallback={pageFallback}>
            {tab === 'plan' && <PlanPage key={refreshKey} />}
            {tab === 'chart' && <ChartPage key={refreshKey} />}
            {tab === 'products' && <ProductsPage />}
            {tab === 'settings' && <SettingsPage onRefresh={() => { void loadSettings(); refresh(); }} onOpenOnboarding={() => setOnboardingOpen(true)} />}
          </Suspense>
        </main>
        <nav className="tab-bar" aria-label={t('main_navigation')}>
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
              key: 'plan' as Tab,
              label: t('plan_tab'),
              icon: (active: boolean) => (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--asset-color)' : 'var(--text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9"/>
                  <circle cx="12" cy="12" r="4.5"/>
                  <circle cx="12" cy="12" r="1.5" fill={active ? 'var(--asset-color)' : 'var(--text-muted)'} stroke="none"/>
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
              <button key={key} type="button" className={`tab-item${active ? ' active' : ''}`} onClick={() => setTab(key)} aria-current={active ? 'page' : undefined} aria-label={label}>
                <div className="tab-icon-wrap">{icon(active)}</div>
                <span className="tab-label">{label}</span>
              </button>
            );
          })}
        </nav>
        {onboardingOpen && settings && (
          <Onboarding
            settings={settings}
            onComplete={(updated, destination) => {
              applySettings(updated);
              setOnboardingOpen(false);
              if (destination === 'settings') setTab('settings');
            }}
          />
        )}
      </div>
    </AppContext.Provider>
  );
}

export default App;
