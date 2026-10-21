import Dexie, { type Table } from 'dexie';
import type { DividendAdvisorMessage } from '../lib/dividendAdvisor.ts';
import { isDividendPlanProposal, parseDividendAdvisorActions } from '../lib/dividendAdvisorActions.ts';
import type { GridLevel } from '../lib/dividendWorkbench.ts';

export interface DividendAdvisorConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: DividendAdvisorMessage[];
  checkedAt?: string;
}
export type DividendAdvisorConversationSummary = Omit<DividendAdvisorConversation, 'messages'> & { messageCount: number };
export interface DividendAdvisorHistoryState {
  conversations: DividendAdvisorConversationSummary[];
  active: DividendAdvisorConversation | null;
}

/** Recover provider-formatting failures when opening an older local chat. */
export function recoverDividendAdvisorHistory(value: DividendAdvisorHistoryState, allowedCodes: string[]): DividendAdvisorHistoryState {
  if (!value.active) return value;
  const allowed = new Set(allowedCodes);
  return { ...value, active: { ...value.active, messages: value.active.messages.map(message => {
    if (message.role !== 'assistant') return message;
    const parsed = parseDividendAdvisorActions(message.content, allowedCodes);
    const actions = (message.actions ?? []).filter(action => isDividendPlanProposal(action) && allowed.has(action.code));
    const seen = new Set(actions.map(action => action.code));
    for (const draft of parsed.actions) {
      // The original pricing evidence is absent from saved chats. Recover only
      // pause/resume drafts; numerical plans require a fresh research request.
      if (draft.buyPaused === undefined || seen.has(draft.code)) continue;
      actions.push({ id: draft.id, code: draft.code, reason: draft.reason, buyPaused: draft.buyPaused });
      seen.add(draft.code);
    }
    return { role: message.role, content: parsed.answer, ...(actions.length ? { actions: actions.slice(0, 10) } : {}) };
  }) } };
}

// Conversations stay on this device. Never store the API configuration, full
// asset snapshot, account identities or transport payload alongside a chat.
const historyDatabase = new Dexie('FortunaDividendAdvisorHistory');
historyDatabase.version(1).stores({ conversations: 'id,updatedAt', state: 'id' });
const conversations: Table<DividendAdvisorConversation, string> = historyDatabase.table('conversations');
const state: Table<{ id: string; conversationId: string | null }, string> = historyDatabase.table('state');

function summary(value: DividendAdvisorConversation): DividendAdvisorConversationSummary {
  const { id, title, createdAt, updatedAt, checkedAt, messages } = value;
  return { id, title, createdAt, updatedAt, checkedAt, messageCount: messages.length };
}

async function readState(): Promise<DividendAdvisorHistoryState> {
  const rows = (await conversations.toArray()).sort((left, right) => right.updatedAt - left.updatedAt);
  const current = await state.get('active');
  return { conversations: rows.map(summary), active: rows.find(row => row.id === current?.conversationId) ?? rows[0] ?? null };
}

export function loadDividendAdvisorHistory(): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('r', conversations, state, readState);
}

export function createDividendAdvisorConversation(now = Date.now()): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('rw', conversations, state, async () => {
    const value: DividendAdvisorConversation = { id: crypto.randomUUID(), title: '', createdAt: now, updatedAt: now, messages: [] };
    await conversations.add(value);
    await state.put({ id: 'active', conversationId: value.id });
    return readState();
  });
}

export function resumeDividendAdvisorConversation(id: string): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('rw', conversations, state, async () => {
    if (!await conversations.get(id)) throw new Error('DIVIDEND_HISTORY_MISSING');
    await state.put({ id: 'active', conversationId: id });
    return readState();
  });
}

export function saveDividendAdvisorConversation(id: string, messages: DividendAdvisorMessage[], checkedAt?: string,
  now = Date.now()): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('rw', conversations, state, async () => {
    const previous = await conversations.get(id);
    // A deleted chat must never be silently recreated by a delayed response.
    if (!previous) throw new Error('DIVIDEND_HISTORY_MISSING');
    const safeMessages = messages.map(message => {
      if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('DIVIDEND_HISTORY_INVALID');
      const cleanLevels = (levels: GridLevel[]) => levels.map(level => ({ yieldBps: level.yieldBps, portionBps: level.portionBps,
        ...(level.priceMinor === undefined ? {} : { priceMinor: level.priceMinor }) }));
      const actions = message.role === 'assistant' ? message.actions?.filter(isDividendPlanProposal).map(action => ({ id: action.id, code: action.code, reason: action.reason,
        ...(action.buyLevels ? { buyLevels: cleanLevels(action.buyLevels) } : {}), ...(action.sellLevels ? { sellLevels: cleanLevels(action.sellLevels) } : {}),
        ...(action.buyPaused === undefined ? {} : { buyPaused: action.buyPaused }) })) : undefined;
      return { role: message.role, content: message.content, ...(actions?.length ? { actions } : {}) };
    });
    const title = safeMessages.find(message => message.role === 'user')?.content.replace(/\s+/g, ' ').trim().slice(0, 48) ?? '';
    await conversations.put({ id: previous.id, title, createdAt: previous.createdAt, updatedAt: now,
      messages: safeMessages, ...(checkedAt ? { checkedAt } : {}) });
    await state.put({ id: 'active', conversationId: id });
    return readState();
  });
}

export function deleteDividendAdvisorConversation(id: string): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('rw', conversations, state, async () => {
    await conversations.delete(id);
    const next = await readState();
    await state.put({ id: 'active', conversationId: next.active?.id ?? null });
    return next;
  });
}

/** Only used by test teardown; ordinary app reset never erases local chats. */
export async function closeDividendAdvisorHistoryDatabase() { historyDatabase.close(); }
