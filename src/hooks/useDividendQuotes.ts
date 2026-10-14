import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { refreshDividendMarketQuotes } from '../services/dividendQuoteService';
import { addPortableSnapshotBackgroundListener, addPortableSnapshotForegroundListener } from '../native/portableSnapshot';

export function useDividendQuotes(targetKey: string, onUpdated: () => Promise<unknown>, manualBusy: RefObject<boolean>) {
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof refreshDividendMarketQuotes>> | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const lastAttempt = useRef(0);
  const pending = useRef(false);
  const nativeActive = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = false; };
  }, []);
  const refresh = useCallback(async function refreshQuotes(force = false) {
    if (!mounted.current || !nativeActive.current || document.visibilityState === 'hidden' || manualBusy.current) return;
    if (inFlight.current) { if (force) pending.current = true; return; }
    // Focus and visibility often arrive together; coalesce these wake-up events.
    if (!force && Date.now() - lastAttempt.current < 5000) return;
    inFlight.current = true; lastAttempt.current = Date.now();
    setRefreshing(true); setFailed(false);
    try {
      const next = await refreshDividendMarketQuotes();
      await onUpdated();
      if (mounted.current) setResult(next);
    } catch { if (mounted.current) setFailed(true); }
    finally {
      inFlight.current = false;
      if (mounted.current) {
        setRefreshing(false);
        if (pending.current) { pending.current = false; void refreshQuotes(true); }
      }
    }
  }, [manualBusy, onUpdated]);
  useEffect(() => {
    if (!targetKey) return;
    void refresh(true);
    const wake = () => { void refresh(); };
    let disposed = false;
    const listeners: NonNullable<Awaited<ReturnType<typeof addPortableSnapshotBackgroundListener>>>[] = [];
    for (const job of [
      addPortableSnapshotBackgroundListener(() => { nativeActive.current = false; }),
      addPortableSnapshotForegroundListener(() => { nativeActive.current = true; wake(); }),
    ]) {
      void job.then(listener => {
        if (listener) { if (disposed) void listener.remove(); else listeners.push(listener); }
      }).catch(error => console.warn('Quote lifecycle listener failed', error));
    }
    const timer = window.setInterval(wake, 60000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      disposed = true;
      for (const listener of listeners) void listener.remove();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [targetKey, refresh]);
  return { refreshing, result, failed, refresh };
}
