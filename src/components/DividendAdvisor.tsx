import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DividendAdvisorContext, DividendAdvisorMessage } from '../lib/dividendAdvisor';
import { DIVIDEND_ADVISOR_READER_HASH, DIVIDEND_AI_CONFIG_CHANGED_EVENT, DIVIDEND_AI_SETTINGS_REQUEST_EVENT, dividendAdvisorReaderUrl } from '../lib/dividendAdvisorNavigation';
import { askDividendAdvisorWithActions, DividendAdvisorError, loadDividendAdvisorConfig, type DividendAdvisorConfig } from '../services/dividendAdvisorService';
import { prepareDividendAdvisorContext } from '../services/dividendAdvisorContextService';
import DividendAdvisorReader from './DividendAdvisorReader';
import DividendAdvisorWorkspace from './DividendAdvisorWorkspace';
import DividendAdvisorPlanActions from './DividendAdvisorPlanActions';
import { createDividendAdvisorConversation, deleteDividendAdvisorConversation, loadDividendAdvisorHistory,
  resumeDividendAdvisorConversation, saveDividendAdvisorConversation, type DividendAdvisorHistoryState } from '../services/dividendAdvisorHistoryService';
import type { DividendResearchSnapshot } from '../lib/dividendResearch';
import { prepareDividendDiscussionResearch } from '../services/dividendAdvisorDiscussionService';
import './DividendAdvisor.css';

interface ReaderHistoryState { fortunaDividendReader?: boolean; dividendReaderPreviousHash?: string }

export default function DividendAdvisor({ onUpdated, amountVisible }: { onUpdated: () => Promise<unknown>; amountVisible: boolean }) {
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
  const mounted = useRef(false);
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
    void loadDividendAdvisorHistory().then(value => {
      if (active) { setHistory(value); setMessages(value.active?.messages ?? []); setCheckedAt(value.active?.checkedAt); }
    }).catch(() => { if (active) setError(t('div_ai_error_storage')); }).finally(() => { if (active) setHistoryBusy(false); });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    const syncRoute = () => {
      const open = window.location.hash === DIVIDEND_ADVISOR_READER_HASH;
      setReaderOpen(open);
      if (!open && originScroll.current) originScroll.current.element.scrollTop = originScroll.current.top;
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => { window.removeEventListener('popstate', syncRoute); window.removeEventListener('hashchange', syncRoute); };
  }, []);

  const openReader = () => {
    if (window.location.hash !== DIVIDEND_ADVISOR_READER_HASH) {
      const scroller = entryRef.current?.closest('.app-content');
      if (scroller) originScroll.current = { element: scroller, top: scroller.scrollTop };
      const previousHash = window.location.hash;
      window.history.pushState({ ...window.history.state, fortunaDividendReader: true, dividendReaderPreviousHash: previousHash }, '', dividendAdvisorReaderUrl(window.location.href));
    }
    setReaderOpen(true);
  };
  const closeReader = () => {
    setReaderOpen(false);
    if (window.location.hash === DIVIDEND_ADVISOR_READER_HASH) {
      const state = window.history.state as ReaderHistoryState | null;
      if (state?.fortunaDividendReader) window.history.back();
      else {
        const url = new URL(window.location.href); url.hash = '';
        window.history.replaceState(window.history.state, '', url.href);
      }
    }
    if (originScroll.current) originScroll.current.element.scrollTop = originScroll.current.top;
  };
  const openSettings = () => {
    if (readerOpen) closeReader();
    window.dispatchEvent(new CustomEvent(DIVIDEND_AI_SETTINGS_REQUEST_EVENT));
  };
  const describeError = (cause: unknown) => cause instanceof DividendAdvisorError
    ? t(`div_ai_error_${cause.code.toLowerCase()}`, { defaultValue: t('div_ai_error_network') }) : t('div_ai_error_storage');
  const changeConversation = async (operation: () => Promise<DividendAdvisorHistoryState>) => {
    if (lock.current || historyBusy) return;
    lock.current = true;
    setHistoryBusy(true); setError('');
    try {
      if (pendingSave) {
        await saveDividendAdvisorConversation(pendingSave.conversationId, pendingSave.messages, pendingSave.checkedAt);
        if (mounted.current) setPendingSave(null);
      }
      const value = await operation();
      if (!mounted.current) return;
      setHistory(value); setMessages(value.active?.messages ?? []); setCheckedAt(value.active?.checkedAt);
      setSnapshot(null); setQuestion(''); setLastQuestion('');
    } catch { if (mounted.current) setError(t('div_ai_error_storage')); }
    finally { lock.current = false; if (mounted.current) setHistoryBusy(false); }
  };
  const ask = async (value = question, suppliedResearch?: DividendResearchSnapshot) => {
    const prompt = value.trim();
    if (lock.current || loading || historyBusy || !prompt) return;
    openReader();
    if (!saved) { setError(t('div_ai_error_config')); return; }
    lock.current = true;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true); setPhase('refreshing'); setError(''); setLastQuestion(prompt);
    try {
      let conversation = history.active;
      if (!conversation) {
        const initial = await createDividendAdvisorConversation();
        conversation = initial.active;
        if (mounted.current) setHistory(initial);
      }
      if (!conversation) throw new Error('DIVIDEND_HISTORY_MISSING');
      const prepared = await prepareDividendAdvisorContext(() => undefined);
      const context = suppliedResearch ? { ...prepared, research: await prepareDividendDiscussionResearch(prepared.research,
        suppliedResearch.stocks.map(({ code, name }) => ({ code, name }))) } : prepared;
      if (!mounted.current || requestController.signal.aborted) return;
      setPhase('thinking');
      await onUpdated();
      if (!mounted.current || requestController.signal.aborted) return;
      const answer = await askDividendAdvisorWithActions(saved, context, prompt, messages, { language: i18n.language, signal: requestController.signal });
      if (mounted.current && !requestController.signal.aborted) {
        const nextMessages: DividendAdvisorMessage[] = [...messages, { role: 'user', content: prompt }, { role: 'assistant', content: answer.answer, actions: answer.actions }];
        setSnapshot(context);
        setCheckedAt(context.generatedAt); setMessages(nextMessages);
        setQuestion(''); setLastQuestion('');
        try {
          const savedHistory = await saveDividendAdvisorConversation(conversation.id, nextMessages, context.generatedAt);
          if (mounted.current) { setHistory(savedHistory); setPendingSave(null); }
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
    <section className="div-advisor" aria-labelledby="div-ai-title" ref={entryRef}>
      <div className="div-advisor-heading"><span className="div-advisor-badge" aria-hidden="true">AI</span><div><h2 id="div-ai-title">{t('div_ai_title')}</h2></div></div>
      <div className="div-advisor-entry-actions"><button className="btn btn-primary" disabled={loading} onClick={openReader}>{t(messages.length || busy ? 'div_ai_resume_reader' : 'div_ai_open_reader')} <span aria-hidden="true">↗</span></button>
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
      renderActions={message => message.actions?.length ? <DividendAdvisorPlanActions proposals={message.actions} disabled={busy || historyBusy} onUpdated={onUpdated} /> : null}
      workspacePanel={(tab, showChat) => <DividendAdvisorWorkspace activePanel={tab} amountVisible={amountVisible} onUpdated={onUpdated} disabled={busy || historyBusy}
        onDiscuss={(stock, research) => { showChat(); void ask(t('div_ai_discuss_stock_question', { name: stock.name, code: stock.code }), { ...research, stocks: [stock] }); }} />}
      onClear={() => void changeConversation(createDividendAdvisorConversation)} />}
  </>;
}
