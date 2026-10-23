import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { DividendAdvisorMessage } from '../lib/dividendAdvisor';
import { isDividendAdvisorBackSwipe } from '../lib/dividendAdvisorNavigation';
import DividendAdvisorMarkdown from './DividendAdvisorMarkdown';
import type { DividendAdvisorConversationSummary } from '../services/dividendAdvisorHistoryService';

interface Props {
  messages: DividendAdvisorMessage[];
  amountVisible: boolean;
  question: string;
  busy: boolean;
  loading: boolean;
  configured: boolean;
  phase: 'refreshing' | 'thinking' | '';
  error: string;
  retryQuestion: string;
  checkedAt?: string;
  refreshLimited: boolean;
  onQuestion: (value: string) => void;
  onAsk: (value?: string) => void;
  onCancel: () => void;
  onClear: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
  conversations?: DividendAdvisorConversationSummary[];
  activeConversationId?: string;
  onResumeConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onRetrySave?: () => void;
  renderActions?: (message: DividendAdvisorMessage, index: number) => ReactNode;
  workspacePanel?: (tab: 'chat' | 'research' | 'principles', showChat: () => void) => ReactNode;
  initialPanel?: 'chat' | 'plan';
  planManagement?: ReactNode;
}

const QUICK_QUESTIONS = ['actions', 'allocation', 'explain'] as const;

export default function DividendAdvisorReader({ messages, amountVisible, question, busy, loading, configured, phase, error, retryQuestion,
  checkedAt, refreshLimited, onQuestion, onAsk, onCancel, onClear, onBack, onOpenSettings, conversations = [], activeConversationId,
  onResumeConversation, onDeleteConversation, onRetrySave, renderActions, workspacePanel, initialPanel = 'chat', planManagement }: Props) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'chat' | 'research' | 'principles' | 'plan'>(initialPanel);
  const [deletingId, setDeletingId] = useState('');
  const pageRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const root = document.getElementById('root');
    const previousInert = root?.inert ?? false;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = 'hidden';
    backRef.current?.focus({ preventScroll: true });
    return () => {
      if (root) root.inert = previousInert;
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (messages.length) latestRef.current?.scrollIntoView({ block: 'start' });
  }, [messages.length]);

  return createPortal(<div className="div-advisor-reader" ref={pageRef} role="dialog" aria-modal="true" aria-labelledby="div-advisor-reader-title"
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onBack(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(pageRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])
        .filter(element => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onTouchStart={event => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.touches.length !== 1 || target?.closest('textarea,input,button,a,.div-advisor-markdown-table,pre')) { touchStart.current = null; return; }
      touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }} onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={event => {
      const start = touchStart.current; touchStart.current = null;
      const end = event.changedTouches[0];
      if (start && end && isDividendAdvisorBackSwipe(start, { x: end.clientX, y: end.clientY })) onBack();
    }}>
    <header className="div-advisor-reader-header">
      <button type="button" className="div-advisor-back" ref={backRef} onClick={onBack} aria-label={t('back')}>← <span>{t('back')}</span></button>
      <h1 id="div-advisor-reader-title">{t('div_ai_title')}</h1>
      <button type="button" className="div-advisor-text-button" disabled={busy || loading} onClick={() => { onClear(); setTab('chat'); }}>{t('div_ai_new_chat')}</button>
    </header>
    <nav className="div-advisor-workspace-tabs" aria-label={t('div_ai_workspace_label')}>
      {(['chat', 'research', ...(planManagement ? ['plan'] as const : []), 'principles'] as const).map(value => <button type="button" key={value} aria-current={tab === value ? 'page' : undefined}
        className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{t(`div_ai_tab_${value}`)}</button>)}
    </nav>
    <main className="div-advisor-reader-scroll" aria-label={t('div_ai_conversation')}>
      <div className="div-advisor-reader-column">
        {tab === 'chat' && <>
        <details className="div-ai-history"><summary>{t('div_ai_history')} <span>{conversations.length}</span></summary>
          <p className="div-ai-muted">{t('div_ai_history_local')}</p>
          {conversations.length === 0 && <p className="div-ai-muted">{t('div_ai_history_empty')}</p>}
          <ul>{conversations.map(conversation => <li key={conversation.id} className={activeConversationId === conversation.id ? 'active' : ''}>
            <button type="button" className="div-ai-history-open" disabled={busy || loading} onClick={() => { onResumeConversation?.(conversation.id); setDeletingId(''); }}
              aria-current={activeConversationId === conversation.id ? 'true' : undefined}>
              <strong>{amountVisible ? conversation.title || t('div_ai_untitled_chat') : t('div_ai_hidden_chat')}</strong>
              <span>{new Date(conversation.updatedAt).toLocaleString(i18n.language)} · {t('div_ai_history_messages', { count: conversation.messageCount })}</span>
            </button>
            <button type="button" className="div-advisor-text-button" disabled={busy || loading} onClick={() => setDeletingId(conversation.id)}>{t('delete')}</button>
            {deletingId === conversation.id && <div className="div-ai-confirm" role="group" aria-label={t('div_ai_delete_chat_confirm')}><p>{t('div_ai_delete_chat_confirm')}</p>
              <div className="div-actions"><button type="button" className="btn btn-danger" disabled={busy || loading} onClick={() => { onDeleteConversation?.(conversation.id); setDeletingId(''); }}>{t('delete')}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setDeletingId('')}>{t('cancel')}</button></div></div>}
          </li>)}</ul>
        </details>
        {messages.length === 0 && <section className="div-advisor-reader-intro">
          <span className="div-advisor-badge" aria-hidden="true">AI</span>
          <h2>{t('div_ai_title')}</h2><p>{t('div_ai_reader_intro')}</p>
          {!configured && !loading ? <button className="btn btn-primary" onClick={onOpenSettings}>{t('div_ai_go_settings')}</button>
            : <div className="div-advisor-reader-quick" aria-label={t('div_ai_quick_questions')}>{QUICK_QUESTIONS.map(key => <button className="btn btn-secondary" key={key} disabled={busy || loading}
              onClick={() => onAsk(t(`div_ai_question_${key}`))}>{t(`div_ai_quick_${key}`)} <span aria-hidden="true">↗</span></button>)}</div>}
        </section>}
        {messages.length > 0 && !amountVisible && <p className="div-advisor-hidden" role="status">{t('div_ai_reading_hidden')}</p>}
        {messages.length > 0 && amountVisible && <div className="div-advisor-reader-messages">{messages.map((message, index) => <article className={`div-advisor-reading-message ${message.role}`} key={index}>
          {index === (messages.at(-1)?.role === 'user' ? messages.length - 1 : messages.length - 2) && <div className="div-advisor-reading-anchor" ref={latestRef} />}
          {message.role === 'user' ? <><span className="div-advisor-question-kicker">{t('div_ai_you')}</span><h2>{message.content}</h2></>
            : <><DividendAdvisorMarkdown language={i18n.language}>{message.content}</DividendAdvisorMarkdown>{renderActions?.(message, index)}</>}
        </article>)}</div>}
        {checkedAt && <p className="div-advisor-answer-date">{t('div_ai_answer_date', { time: new Date(checkedAt).toLocaleString(i18n.language) })}</p>}
        {refreshLimited && <p className="div-advisor-reading-note">{t('div_ai_refresh_limited')}</p>}
        </>}
        {workspacePanel?.(tab === 'plan' ? 'chat' : tab, () => setTab('chat'))}
        {tab === 'plan' && planManagement}
        {phase && <div className="div-advisor-reading-progress" role="status"><span className="div-advisor-thinking-dot" aria-hidden="true" /><p>{t(phase === 'thinking' ? 'div_ai_thinking' : 'div_ai_refreshing')}</p>
          <button type="button" className="div-advisor-text-button" onClick={onCancel}>{t('div_ai_cancel')}</button></div>}
        {error && <div className="div-warning div-advisor-reading-error" role="alert"><p>{error}</p><div className="div-actions">
          {onRetrySave && <button className="btn btn-secondary" disabled={busy || loading} onClick={onRetrySave}>{t('div_ai_retry_save')}</button>}
          {retryQuestion && configured && <button className="btn btn-secondary" disabled={busy} onClick={() => onAsk(retryQuestion)}>{t('div_ai_retry')}</button>}
          {!configured && <button className="btn btn-secondary" onClick={onOpenSettings}>{t('div_ai_go_settings')}</button>}
        </div></div>}
        <p className="div-advisor-return-hint">{t('div_ai_swipe_back_hint')}</p>
      </div>
    </main>
    {tab === 'chat' && <footer className="div-advisor-reader-compose"><form className="div-advisor-compose-column" onSubmit={event => { event.preventDefault(); onAsk(); }}>
      <label htmlFor="div-ai-reader-question">{t('div_ai_question_label')}</label>
      <div className="div-advisor-compose-row"><textarea className="form-input" id="div-ai-reader-question" rows={2} maxLength={2000} disabled={busy || loading || !configured} value={question}
        placeholder={t('div_ai_question_placeholder')} onChange={event => onQuestion(event.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || loading || !configured || !question.trim()}>{t('div_ai_send')}</button></div>
    </form></footer>}
  </div>, document.body);
}
