import Dexie, { type Table } from 'dexie';
import type { DividendAdvisorMessage } from '../lib/dividendAdvisor.ts';
import { isDividendPlanProposal, parseDividendAdvisorActions } from '../lib/dividendAdvisorActions.ts';
import type { GridLevel } from '../lib/dividendWorkbench.ts';
import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../lib/dividendPricing.ts';

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
    const actions = (message.actions ?? []).filter(action => isDividendPlanProposal(action) && allowed.has(action.code)).flatMap(action => {
      if ((!action.buyLevels && !action.sellLevels) || message.pricingCalculationVersion === DIVIDEND_PRICING_CALCULATION_VERSION) return [action];
      // Old numerical drafts have no current calculation evidence. Preserve an
      // explicit pause/resume request, but require new research for new prices.
      return action.buyPaused === undefined ? [] : [{ id: action.id, code: action.code, reason: action.reason, buyPaused: action.buyPaused }];
    });
    const seen = new Set(actions.map(action => action.code));
    for (const draft of parsed.actions) {
      // The original pricing evidence is absent from saved chats. Recover only
      // pause/resume drafts; numerical plans require a fresh research request.
      if (draft.buyPaused === undefined || seen.has(draft.code)) continue;
      actions.push({ id: draft.id, code: draft.code, reason: draft.reason, buyPaused: draft.buyPaused });
      seen.add(draft.code);
    }
    return { role: message.role, content: parsed.answer, ...(actions.length ? { actions: actions.slice(0, 10) } : {}),
      ...(message.pricingCalculationVersion === undefined ? {} : { pricingCalculationVersion: message.pricingCalculationVersion }) };
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
  return { conversations: rows.filter(row => row.messages.length).map(summary), active: rows.find(row => row.id === current?.conversationId) ?? null };
}

export function loadDividendAdvisorHistory(): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('r', conversations, state, readState);
}

export function createDividendAdvisorConversation(now = Date.now(), initialQuestion?: string): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('rw', conversations, state, async () => {
    // Opening the reader or starting a blank chat must not fill history with empty rows.
    const empty = (await conversations.toArray()).filter(row => !row.messages.length);
    await conversations.bulkDelete(empty.map(row => row.id));
    // Commit the first question with its ID. An immediate exit can then archive
    // it even if the create promise has not returned to the reader yet.
    const value: DividendAdvisorConversation = { id: crypto.randomUUID(), title: initialQuestion?.replace(/\s+/g, ' ').trim().slice(0, 48) ?? '',
      createdAt: now, updatedAt: now, messages: initialQuestion ? [{ role: 'user', content: initialQuestion }] : [] };
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

/** End a reader visit. History is resumed only through an explicit user selection. */
export function archiveDividendAdvisorConversation(id?: string): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('rw', conversations, state, async () => {
    const current = await state.get('active');
    const archivedId = id ?? current?.conversationId;
    if (archivedId) {
      const previous = await conversations.get(archivedId);
      if (previous && !previous.messages.length) await conversations.delete(archivedId);
    }
    if (!id || current?.conversationId === id) await state.put({ id: 'active', conversationId: null });
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
      return { role: message.role, content: message.content, ...(actions?.length ? { actions } : {}),
        ...(message.role === 'assistant' && Number.isSafeInteger(message.pricingCalculationVersion)
          ? { pricingCalculationVersion: message.pricingCalculationVersion } : {}) };
    });
    const title = safeMessages.find(message => message.role === 'user')?.content.replace(/\s+/g, ' ').trim().slice(0, 48) ?? '';
    await conversations.put({ id: previous.id, title, createdAt: previous.createdAt, updatedAt: now,
      messages: safeMessages, ...(checkedAt ? { checkedAt } : {}) });
    // Saving a response may finish after the reader has closed. Keep the archived
    // conversation saved without selecting it again or replacing a newer chat.
    return readState();
  });
}

export function deleteDividendAdvisorConversation(id: string): Promise<DividendAdvisorHistoryState> {
  return historyDatabase.transaction('rw', conversations, state, async () => {
    await conversations.delete(id);
    if ((await state.get('active'))?.conversationId === id) await state.put({ id: 'active', conversationId: null });
    return readState();
  });
}

/** Only used by test teardown; ordinary app reset never erases local chats. */
export async function closeDividendAdvisorHistoryDatabase() { historyDatabase.close(); }
