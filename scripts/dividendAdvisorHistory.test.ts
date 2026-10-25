import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Dexie from 'dexie';
import type { DividendAdvisorMessage } from '../src/lib/dividendAdvisor.ts';
import { DIVIDEND_PRICING_CALCULATION_VERSION } from '../src/lib/dividendPricing.ts';
import { archiveDividendAdvisorConversation, closeDividendAdvisorHistoryDatabase, createDividendAdvisorConversation, deleteDividendAdvisorConversation,
  loadDividendAdvisorHistory, recoverDividendAdvisorHistory, resumeDividendAdvisorConversation, saveDividendAdvisorConversation } from '../src/services/dividendAdvisorHistoryService.ts';

let reopenedClose: (() => Promise<void>) | undefined;
after(async () => {
  await closeDividendAdvisorHistoryDatabase();
  await reopenedClose?.();
  await Dexie.delete('FortunaDividendAdvisorHistory');
});

test('local history archives visits, isolates delayed saves, and preserves all turns across reopening', async () => {
  const initial = await loadDividendAdvisorHistory();
  assert.equal(initial.active, null);
  const first = (await createDividendAdvisorConversation(100)).active!;
  assert.equal((await loadDividendAdvisorHistory()).conversations.length, 0, 'a blank visit must not appear in history');
  const messages: DividendAdvisorMessage[] = Array.from({ length: 16 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: index ? `Message ${index}` : 'Review\nmy dividend plan' }));
  const stored = await saveDividendAdvisorConversation(first.id, messages, '2026-10-21T10:00:00Z', 200);
  assert.equal(stored.active?.messages.length, 16, 'older conversation turns must not disappear when more than six questions are asked');
  assert.equal(stored.active?.title, 'Review my dividend plan');
  assert.equal(stored.active?.checkedAt, '2026-10-21T10:00:00Z');

  const immediateCreate = createDividendAdvisorConversation(225, 'Exit immediately after Send');
  const immediateArchive = archiveDividendAdvisorConversation();
  const immediate = (await immediateCreate).active!;
  assert.equal((await immediateArchive).active, null);
  assert.deepEqual((await resumeDividendAdvisorConversation(immediate.id)).active?.messages, [{ role: 'user', content: 'Exit immediately after Send' }], 'creation and the first submitted question commit atomically even when exit is already queued');
  await deleteDividendAdvisorConversation(immediate.id);
  await resumeDividendAdvisorConversation(first.id);

  const archived = await archiveDividendAdvisorConversation(first.id);
  assert.equal(archived.active, null, 'leaving the reader ends the current conversation');
  assert.equal(archived.conversations[0].messageCount, 16);
  const late = await saveDividendAdvisorConversation(first.id, messages, '2026-10-21T10:00:00Z', 250);
  assert.equal(late.active, null, 'a delayed response save cannot reopen an archived conversation');

  const second = (await createDividendAdvisorConversation(300)).active!;
  assert.notEqual(first.id, second.id);
  assert.equal((await saveDividendAdvisorConversation(first.id, messages)).active?.id, second.id, 'an earlier response cannot replace the new chat');
  assert.equal((await archiveDividendAdvisorConversation(first.id)).active?.id, second.id, 'a stale close cannot archive the new chat');
  const submitted: DividendAdvisorMessage[] = [{ role: 'user', content: 'An in-flight question' }];
  await saveDividendAdvisorConversation(second.id, submitted);
  assert.equal((await archiveDividendAdvisorConversation(second.id)).active, null);
  assert.deepEqual((await resumeDividendAdvisorConversation(second.id)).active?.messages, submitted, 'leaving during research preserves the submitted question for explicit resumption');
  assert.equal((await loadDividendAdvisorHistory()).active?.id, second.id);
  assert.equal((await resumeDividendAdvisorConversation(first.id)).active?.messages.length, 16);
  const afterDelete = await deleteDividendAdvisorConversation(second.id);
  assert.equal(afterDelete.active?.id, first.id);
  await assert.rejects(saveDividendAdvisorConversation(second.id, messages), /DIVIDEND_HISTORY_MISSING/);
  assert.equal((await loadDividendAdvisorHistory()).conversations.length, 1);

  await closeDividendAdvisorHistoryDatabase();
  const reopened = await import('../src/services/dividendAdvisorHistoryService.ts?reopen=1');
  reopenedClose = reopened.closeDividendAdvisorHistoryDatabase;
  const restored = await reopened.loadDividendAdvisorHistory();
  assert.equal(restored.active?.id, first.id);
  assert.deepEqual(restored.active?.messages, messages);
  assert.equal((await reopened.archiveDividendAdvisorConversation()).active, null, 'a new app session clears the previous selection without erasing history');
  assert.deepEqual((await reopened.resumeDividendAdvisorConversation(first.id)).active?.messages, messages);
  assert.equal((await reopened.deleteDividendAdvisorConversation(first.id)).active, null);
  // Keep the reopened module for the remaining test since the original connection was deliberately closed.
  const chat = (await reopened.createDividendAdvisorConversation()).active!;
  const unsafe = {
    role: 'assistant', content: 'Pause additions for review.', apiKey: 'PRIVATE_API_KEY', context: { account: 'PRIVATE_ACCOUNT' },
    actions: [{ id: 'pause', code: '601398', reason: 'Downtrend', buyPaused: true, arbitrary: 'PRIVATE_ACTION_FIELD' }],
  } as unknown as DividendAdvisorMessage;
  const saved = await reopened.saveDividendAdvisorConversation(chat.id, [{ role: 'user', content: 'Check risk' }, unsafe]);
  const serialised = JSON.stringify(saved);
  assert.doesNotMatch(serialised, /PRIVATE_API_KEY|PRIVATE_ACCOUNT|PRIVATE_ACTION_FIELD|apiKey|context/);
  assert.equal(saved.active?.messages[1].actions?.[0].buyPaused, true);
  assert.deepEqual(Object.keys(saved.active?.messages[1] ?? {}).sort(), ['actions', 'content', 'role']);
  const blank = (await reopened.createDividendAdvisorConversation()).active!;
  assert.equal((await reopened.archiveDividendAdvisorConversation(blank.id)).conversations.length, 1, 'empty visits are discarded while completed chats stay saved');
  assert.equal((await reopened.loadDividendAdvisorHistory()).active, null, 'ending a blank visit must not automatically select an older chat');
  await assert.rejects(reopened.resumeDividendAdvisorConversation(blank.id), /DIVIDEND_HISTORY_MISSING/);
  await reopened.resumeDividendAdvisorConversation(chat.id);

  const pause = { id: 'pause_midea_buy', code: '000333', reason: '等待财报确认现金流覆盖改善。', buyPaused: true };
  const numerical = { id: 'unverified', code: '601398', reason: 'Old price draft', buyLevels: [{ yieldBps: 500, portionBps: 10000, priceMinor: 7500 }] };
  const raw = `建议暂停86元起步的网格加仓。\n\n\`\`\`json\n${JSON.stringify([pause, numerical])}\n\`\`\``;
  await reopened.saveDividendAdvisorConversation(chat.id, [{ role: 'user', content: '复核计划' }, { role: 'assistant', content: raw }]);
  const storedLegacy = await reopened.loadDividendAdvisorHistory();
  const recovered = recoverDividendAdvisorHistory(storedLegacy, ['000333', '601398']);
  assert.deepEqual(recovered.active?.messages[1], { role: 'assistant', content: '建议暂停86元起步的网格加仓。', actions: [pause] });
  assert.equal(storedLegacy.active?.messages[1].content, raw, 'recovery must leave the stored source untouched');
  assert.deepEqual(recoverDividendAdvisorHistory(recovered, ['000333', '601398']), recovered, 'reopening is idempotent');
  assert.equal(recoverDividendAdvisorHistory(storedLegacy, []).active?.messages[1].actions, undefined, 'removed stocks cannot acquire an action');
  const mixed = { ...storedLegacy, active: { ...storedLegacy.active!, messages: [
    { role: 'user' as const, content: raw },
    { role: 'assistant' as const, content: raw, actions: [{ ...pause, id: 'already-verified', buyPaused: false }, numerical] },
    { role: 'assistant' as const, content: '```json\n[{"code":"000333","price":86}]\n```' },
  ] } };
  const restoredMixed = recoverDividendAdvisorHistory(mixed, ['000333', '601398']);
  assert.equal(restoredMixed.active?.messages[0].content, raw, 'user-provided JSON stays untouched');
  assert.deepEqual(restoredMixed.active?.messages[1].actions, [mixed.active.messages[1].actions![0]], 'legacy numerical actions cannot bypass updated pricing by reopening a chat');
  const current = { ...mixed, active: { ...mixed.active, messages: [{ ...mixed.active.messages[1], pricingCalculationVersion: DIVIDEND_PRICING_CALCULATION_VERSION }] } };
  assert.deepEqual(recoverDividendAdvisorHistory(current, ['000333', '601398']).active?.messages[0].actions, [mixed.active.messages[1].actions![0]], 'a calculation version cannot revive a historical cash-price draft without current evidence');
  assert.equal(restoredMixed.active?.messages[2].content, mixed.active.messages[2].content);
});
