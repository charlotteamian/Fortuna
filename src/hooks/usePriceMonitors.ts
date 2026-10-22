import { useEffect } from 'react';
import { addPortableSnapshotBackgroundListener, addPortableSnapshotForegroundListener } from '../native/portableSnapshot';
import { refreshPriceMonitorQuotes } from '../services/priceMonitorQuoteService';

export function usePriceMonitors(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let disposed = false;
    const listeners: NonNullable<Awaited<ReturnType<typeof addPortableSnapshotBackgroundListener>>>[] = [];
    const refresh = () => {
      if (active && document.visibilityState !== 'hidden') {
        void refreshPriceMonitorQuotes().catch(error => console.warn('Price monitor refresh failed', error));
      }
    };
    const startup = window.setTimeout(refresh, 2200);
    const timer = window.setInterval(refresh, 60000);
    for (const job of [
      addPortableSnapshotBackgroundListener(() => { active = false; }),
      addPortableSnapshotForegroundListener(() => { active = true; refresh(); }),
    ]) void job.then(listener => {
      if (listener) { if (disposed) void listener.remove(); else listeners.push(listener); }
    }).catch(error => console.warn('Price monitor lifecycle failed', error));
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('price-monitors-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      window.clearTimeout(startup);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('price-monitors-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
      for (const listener of listeners) void listener.remove();
    };
  }, [enabled]);
}
