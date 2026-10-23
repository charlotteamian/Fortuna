import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db';
import type { DividendAdvisorContext, DividendAdvisorMessage } from '../lib/dividendAdvisor';
import { DIVIDEND_ADVISOR_READER_HASH, DIVIDEND_AI_CONFIG_CHANGED_EVENT, DIVIDEND_AI_SETTINGS_REQUEST_EVENT, dividendAdvisorReaderUrl } from '../lib/dividendAdvisorNavigation';
import { askDividendAdvisorWithActions, DividendAdvisorError, loadDividendAdvisorConfig, type DividendAdvisorConfig } from '../services/dividendAdvisorService';
import { prepareDividendAdvisorContext } from '../services/dividendAdvisorContextService';
import DividendAdvisorReader from './DividendAdvisorReader';
import DividendAdvisorWorkspace from './DividendAdvisorWorkspace';
import DividendAdvisorPlanActions from './DividendAdvisorPlanActions';
import { archiveDividendAdvisorConversation, createDividendAdvisorConversation, deleteDividendAdvisorConversation, loadDividendAdvisorHistory,
  recoverDividendAdvisorHistory, resumeDividendAdvisorConversation, saveDividendAdvisorConversation, type DividendAdvisorHistoryState } from '../services/dividendAdvisorHistoryService';
import type { DividendResearchSnapshot } from '../lib/dividendResearch';
import { prepareDividendDiscussionResearch } from '../services/dividendAdvisorDiscussionService';
import { addPortableSnapshotBackgroundListener } from '../native/portableSnapshot';
import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../lib/dividendPricing';
import './DividendAdvisor.css';

interface ReaderHistoryState { fortunaDividendReader?: boolean; dividendReaderPreviousHash?: string }

async function restoreHistory(value: DividendAdvisorHistoryState) {
  return recoverDividendAdvisorHistory(value, await db.dividendStocks.toCollection().primaryKeys());
}

export default function DividendAdvisor({ onUpdated, amountVisible, planManagement, openPlanRequest = 0 }: { onUpdated: () => Promise<unknown>; amountVisible: boolean; planManagement?: ReactNode; openPlanRequest?: number }) {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState<DividendAdvisorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'refreshing' | 'thinking' | ''>('');
  const [messages, setMessages] = useState<DividendAdvisorMessage[]>([]);
  const [history, setHistory] = useState<DividendAdvisorHistoryState>({ conversations: [], active: null });
  const [historyBusy, setHistoryBusy] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [pendingSave, setPendingSave] = useState<{ conversationId: string; messages: DividendAdvisorMessage[]; checkedAt?: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [snapshot, setSnapshot] = useState<DividendAdvisorContext | null>(null);
  const [error, setError] = useState('');
  const [readerOpen, setReaderOpen] = useState(() => window.location.hash === DIVIDEND_ADVISOR_READER_HASH);
  const [initialPanel, setInitialPanel] = useState<'chat' | 'plan'>('chat');
  const mounted = useRef(false);
  const session = useRef({ generation: 0, open: window.location.hash === DIVIDEND_ADVISOR_READER_HASH, conversationId: undefined as string | undefined });
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const originScroll = useRef<{ element: Element; top: number } | null>(null);
  const entryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const load = () => {
      setLoading(true);
      void loadDividendAdvisorConfig().then(value => {
        if (!active) return;
        setSaved(value);
        if (!value) { controller.current?.abort(); setSnapshot(null); setLastQuestion(''); }
      }).catch(() => { if (active) setError(t('div_ai_error_storage')); })
        .finally(() => { if (active) setLoading(false); });
    };
    load();
    window.addEventListener(DIVIDEND_AI_CONFIG_CHANGED_EVENT, load);
    return () => { active = false; mounted.current = false; controller.current?.abort(); window.removeEventListener(DIVIDEND_AI_CONFIG_CHANGED_EVENT, load); };
  }, [t]);

  useEffect(() => {
    let active = true;
    // A process restart starts a fresh visit, including older versions that left
    // their most recent conversation selected in the local database.
    void archiveDividendAdvisorConversation().then(restoreHistory).then(value => {
      if (active) { setHistory(value); setMessages(value.active?.messages ?? []); setCheckedAt(value.active?.checkedAt); }
    }).catch(() => { if (active) setError(t('div_ai_error_storage')); }).finally(() => { if (active) setHistoryBusy(false); });
    return () => { active = false; };
  }, [t]);

  const openReader = useCallback((panel: 'chat' | 'plan' = 'chat') => {
    setInitialPanel(panel);
    if (window.location.hash !== DIVIDEND_ADVISOR_READER_HASH) {
      const scroller = entryRef.current?.closest('.app-content');
      if (scroller) originScroll.current = { element: scroller, top: scroller.scrollTop };
      const previousHash = window.location.hash;
      window.history.pushState({ ...window.history.state, fortunaDividendReader: true, dividendReaderPreviousHash: previousHash }, '', dividendAdvisorReaderUrl(window.location.href));
    }
    session.current.open = true; setReaderOpen(true);
  }, []);
  useEffect(() => {
    if (openPlanRequest) openReader('plan');
  }, [openPlanRequest, openReader]);
  const endSession = useCallback(() => {
    const generation = ++session.current.generation;
    const conversationId = session.current.conversationId;
    session.current.open = false; session.current.conversationId = undefined;
    controller.current?.abort(); controller.current = null; lock.current = false;
    if (mounted.current) {
      setReaderOpen(false); setBusy(false); setPhase(''); setMessages([]); setQuestion(''); setLastQuestion('');
      setSnapshot(null); setCheckedAt(undefined); setHistory(value => ({ ...value, active: null })); setHistoryBusy(true);
    }
    void archiveDividendAdvisorConversation(conversationId).then(value => {
      if (mounted.current && session.current.generation === generation) setHistory(value);
    }).catch(() => { if (mounted.current) setError(t('div_ai_history_save_failed')); })
      .finally(() => { if (mounted.current && session.current.generation === generation) setHistoryBusy(false); });
  }, [t]);
  const closeReader = useCallback(() => {
    endSession();
    if (window.location.hash === DIVIDEND_ADVISOR_READER_HASH) {
      const state = window.history.state as ReaderHistoryState | null;
      if (state?.fortunaDividendReader) window.history.back();
      else {
        const url = new URL(window.location.href); url.hash = '';
        window.history.replaceState(window.history.state, '', url.href);
      }
    }
    if (originScroll.current) originScroll.current.element.scrollTop = originScroll.current.top;
  }, [endSession]);
  useEffect(() => {
    const syncRoute = () => {
      const open = window.location.hash === DIVIDEND_ADVISOR_READER_HASH;
      if (!open && session.current.open) endSession();
      else if (open) { session.current.open = true; setReaderOpen(true); }
      if (!open && originScroll.current) originScroll.current.element.scrollTop = originScroll.current.top;
    };
    const background = () => { if (session.current.open) closeReader(); };
    const visibility = () => { if (document.visibilityState === 'hidden') background(); };
    let disposed = false;
    let nativeListener: Awaited<ReturnType<typeof addPortableSnapshotBackgroundListener>> = null;
    window.addEventListener('popstate', syncRoute); window.addEventListener('hashchange', syncRoute);
    window.addEventListener('pagehide', background); document.addEventListener('visibilitychange', visibility);
    syncRoute();
    void addPortableSnapshotBackgroundListener(background).then(listener => {
      if (disposed) void listener?.remove(); else nativeListener = listener;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', syncRoute); window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('pagehide', background); document.removeEventListener('visibilitychange', visibility);
      void nativeListener?.remove();
      // Every submitted question was saved before research/network work starts.
      // Archiving on unmount only clears selection and never deletes a saved turn.
      if (session.current.open) endSession();
    };
  }, [closeReader, endSession]);
  const openSettings = () => {
    if (readerOpen) closeReader();
    window.dispatchEvent(new CustomEvent(DIVIDEND_AI_SETTINGS_REQUEST_EVENT));
  };
  const describeError = (cause: unknown) => cause instanceof DividendAdvisorError
    ? t(`div_ai_error_${cause.code.toLowerCase()}`, { defaultValue: t('div_ai_error_network') }) : t('div_ai_error_storage');
  const changeConversation = async (operation: () => Promise<DividendAdvisorHistoryState>) => {
    if (lock.current || historyBusy) return;
    lock.current = true;
    const generation = session.current.generation;
    setHistoryBusy(true); setError('');
    try {
      if (pendingSave) {
        await saveDividendAdvisorConversation(pendingSave.conversationId, pendingSave.messages, pendingSave.checkedAt);
        if (!mounted.current || session.current.generation !== generation) return;
        setPendingSave(null);
      }
      const value = await restoreHistory(await operation());
      if (!mounted.current || session.current.generation !== generation) {
        if (value.active) await archiveDividendAdvisorConversation(value.active.id);
        return;
      }
      session.current.conversationId = value.active?.id;
      setHistory(value); setMessages(value.active?.messages ?? []); setCheckedAt(value.active?.checkedAt);
      const unfinished = value.active?.messages.at(-1);
      setSnapshot(null); setQuestion(unfinished?.role === 'user' ? unfinished.content : ''); setLastQuestion('');
    } catch { if (mounted.current && session.current.generation === generation) setError(t('div_ai_error_storage')); }
    finally { if (session.current.generation === generation) { lock.current = false; if (mounted.current) setHistoryBusy(false); } }
  };
  const ask = async (value = question, suppliedResearch?: DividendResearchSnapshot) => {
    const prompt = value.trim();
    if (lock.current || loading || historyBusy || !prompt) return;
    openReader();
    if (!saved) { setError(t('div_ai_error_config')); return; }
    lock.current = true;
    const requestController = new AbortController();
    const generation = session.current.generation;
    const currentRequest = () => mounted.current && session.current.generation === generation && !requestController.signal.aborted;
    controller.current = requestController;
    setBusy(true); setPhase('refreshing'); setError(''); setLastQuestion(prompt);
    try {
      if (pendingSave) {
        await saveDividendAdvisorConversation(pendingSave.conversationId, pendingSave.messages, pendingSave.checkedAt);
        if (!currentRequest()) return;
        setPendingSave(null);
      }
      let conversation = history.active;
      if (!conversation) {
        const initial = await createDividendAdvisorConversation(Date.now(), prompt);
        conversation = initial.active;
        if (!currentRequest()) { if (conversation) await archiveDividendAdvisorConversation(conversation.id); return; }
        setHistory(initial);
      }
      if (!conversation) throw new Error('DIVIDEND_HISTORY_MISSING');
      session.current.conversationId = conversation.id;
      // Save the question first so closing/backgrounding while a provider is
      // working leaves a resumable question in this conversation's history.
      const previousMessages = messages.at(-1)?.role === 'user' && messages.at(-1)?.content === prompt ? messages.slice(0, -1) : messages;
      const submittedMessages: DividendAdvisorMessage[] = [...previousMessages, { role: 'user', content: prompt }];
      const submittedHistory = await saveDividendAdvisorConversation(conversation.id, submittedMessages, checkedAt);
      if (!currentRequest()) return;
      setHistory(submittedHistory); setMessages(submittedMessages); setQuestion('');
      const prepared = await prepareDividendAdvisorContext(() => undefined);
      const context = suppliedResearch ? { ...prepared, research: await prepareDividendDiscussionResearch(prepared.research,
        suppliedResearch.stocks.map(({ code, name }) => ({ code, name }))) } : prepared;
      if (!currentRequest()) return;
      setPhase('thinking');
      await onUpdated();
      if (!currentRequest()) return;
      const answer = await askDividendAdvisorWithActions(saved, context, prompt, previousMessages, { language: i18n.language, signal: requestController.signal });
      if (currentRequest()) {
        const nextMessages: DividendAdvisorMessage[] = [...submittedMessages, { role: 'assistant', content: answer.answer, actions: answer.actions,
          pricingCalculationVersion: DIVIDEND_PRICING_CALCULATION_VERSION }];
        setSnapshot(context);
        setCheckedAt(context.generatedAt); setMessages(nextMessages);
        setQuestion(''); setLastQuestion('');
        try {
          const savedHistory = await saveDividendAdvisorConversation(conversation.id, nextMessages, context.generatedAt);
          if (currentRequest()) { setHistory(savedHistory); setPendingSave(null); }
        } catch { if (mounted.current) { setPendingSave({ conversationId: conversation.id, messages: nextMessages, checkedAt: context.generatedAt }); setError(t('div_ai_history_save_failed')); } }
      }
    } catch (cause) { if (mounted.current && !requestController.signal.aborted) setError(describeError(cause)); }
    finally {
      if (controller.current === requestController) {
        lock.current = false; controller.current = null;
        if (mounted.current) { setBusy(false); setPhase(''); }
      }
    }
  };

  const refreshLimited = Boolean(snapshot && (snapshot.coverage.quoteRefreshFailures || snapshot.coverage.dividendRefreshFailures || snapshot.dividendRefreshDeferredCodes.length));
  return <>
    <section className="div-advisor div-home-advisor" aria-labelledby="div-ai-title" ref={entryRef}>
      <div className="div-advisor-heading"><span className="div-advisor-badge" aria-hidden="true">AI</span><div><h2 id="div-ai-title">{t('div_ai_title')}</h2></div></div>
      <div className="div-advisor-entry-actions"><button className="div-advisor-text-button" disabled={loading} onClick={() => openReader()}>{t(messages.length || busy ? 'div_ai_resume_reader' : 'div_ai_open_reader')} <span aria-hidden="true">↗</span></button>
        {planManagement && <button type="button" className="div-advisor-text-button" onClick={() => openReader('plan')}>{t('div_ai_tab_plan')} <span aria-hidden="true">↗</span></button>}
        {!saved && !loading && <button type="button" className="div-advisor-text-button" onClick={openSettings}>{t('div_ai_go_settings')}</button>}
      </div>
      {busy && !readerOpen && <p className="div-advisor-status" role="status">{t(phase === 'thinking' ? 'div_ai_thinking' : 'div_ai_refreshing')}</p>}
      {error && !readerOpen && <p className="div-warning" role="alert">{error}</p>}
    </section>
    {readerOpen && <DividendAdvisorReader messages={messages} amountVisible={amountVisible} question={question} busy={busy} loading={loading || historyBusy} configured={Boolean(saved)} phase={phase} error={error}
      retryQuestion={lastQuestion} checkedAt={checkedAt} refreshLimited={refreshLimited} onQuestion={setQuestion} onAsk={value => void ask(value)} onBack={closeReader} onOpenSettings={openSettings}
      onCancel={() => { controller.current?.abort(); controller.current = null; lock.current = false; setBusy(false); setPhase(''); setError(t('div_ai_error_cancelled')); }}
      conversations={history.conversations} activeConversationId={history.active?.id}
      onResumeConversation={id => void changeConversation(() => resumeDividendAdvisorConversation(id))}
      onDeleteConversation={id => void changeConversation(() => deleteDividendAdvisorConversation(id))}
      onRetrySave={pendingSave ? () => void changeConversation(loadDividendAdvisorHistory) : undefined}
      initialPanel={initialPanel} planManagement={planManagement}
      renderActions={message => message.actions?.length ? <DividendAdvisorPlanActions proposals={message.actions} initiallyExpanded disabled={busy || historyBusy} onUpdated={onUpdated} /> : null}
      workspacePanel={(tab, showChat) => <DividendAdvisorWorkspace activePanel={tab} amountVisible={amountVisible} onUpdated={onUpdated} disabled={busy || historyBusy}
        onDiscuss={(stock, research) => { showChat(); void ask(t('div_ai_discuss_stock_question', { name: stock.name, code: stock.code }), { ...research, stocks: [stock] }); }} />}
      onClear={() => void changeConversation(createDividendAdvisorConversation)} />}
  </>;
}
