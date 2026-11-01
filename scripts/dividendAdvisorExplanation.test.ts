import 'fake-indexeddb/auto';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { buildDividendAdvisorContext, type DividendAdvisorContext, type DividendAdvisorMessage } from '../src/lib/dividendAdvisor.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { defaultDividendSelectionPrinciples } from '../src/lib/dividendResearch.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';
import { askDividendAdvisorWithActions, type DividendAdvisorConfig, type DividendAdvisorTransport } from '../src/services/dividendAdvisorService.ts';
import { buildDividendExplanationFacts } from '../src/lib/dividendAdvisorExplanation.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { db, initializeSettings } = await import('../src/db.ts');
const now = Date.parse('2026-10-31T03:00:00Z');
const config: DividendAdvisorConfig = { protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'explanation-stub', apiKey: 'synthetic-key' };
const stock: DividendStock = { code: '601398', name: '模拟银行', group: 'core', weightBps: 10000,
  shareMode: 'manual', manualShares: 200, lotSize: 100, buyPaused: true,
  buyLevels: [{ priceMinor: 1000, yieldBps: 550, portionBps: 10000 }],
  sellLevels: [{ priceMinor: 1200, yieldBps: 480, portionBps: 10000 }],
  quote: { priceMinor: 900, date: '2026-10-31 10:00', fetchedAt: now } };
function context(): DividendAdvisorContext {
  return buildDividendAdvisorContext({ stocks: [stock], strategy: 'stocks', budgetMinor: 1000000, budgetConfigured: true,
    positions: new Map(), fundPlan: defaultDividendFundPlan(), research: { generatedAt: now,
      principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [{ code: stock.code, name: stock.name,
        checks: [{ rule: 'roe', status: 'unknown', reason: 'missing', period: '2025-12-31' }], status: 'unknown', sources: [], issues: [],
        financial: { code: stock.code, asOf: '2026-10-31', financialSector: true,
          latest: { reportDate: '2026-09-30', roeBps: 500 }, periods: [{ reportDate: '2026-09-30', roeBps: 500 }] } }] } }, now);
}
const envelope = (blocks: unknown[]) => JSON.stringify({ version: 1, blocks });
const concept = (text: string) => envelope([{ type: 'concept', text }]);
const transport = (content: string): DividendAdvisorTransport => async () => ({ status: 200, data: { choices: [{ finish_reason: 'stop', message: { content } }] } });
const state = async () => JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
async function readOnlyAsk(question: string, content: string, history: DividendAdvisorMessage[] = [], data = context()) {
  const before = await state(), input = structuredClone(data);
  const answer = await askDividendAdvisorWithActions(config, data, question, history, { language: 'zh', transport: transport(content) });
  assert.equal(await state(), before, 'all ledger tables unchanged by explaining');
  assert.deepEqual(data, input, 'explanation does not mutate deterministic inputs');
  assert.deepEqual(answer.actions, [], 'concept, example and risk explanation cannot create a confirmation action');
  return answer;
}
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings(); await db.dividendStocks.put(stock);
});
after(() => db.close());

test('a normal concept outside the fixed glossary receives a relevant model explanation', async () => {
  const text = '自由现金流通常指经营活动现金流减去资本性支出。它帮助理解经营产生的现金在维持必要投资后还剩多少。';
  const answer = await readOnlyAsk('什么是自由现金流', concept(text));
  assert.match(answer.answer, /自由现金流通常指经营活动现金流减去资本性支出/);
  assert.doesNotMatch(answer.answer, /这个概念尚未提供已核对的解释/);
});

test('a requested dividend-yield example is labelled hypothetical and calculated locally', async () => {
  const answer = await readOnlyAsk('举一个股息率计算例子', envelope([{ type: 'example', formula: 'cash_yield', inputs: [0.5, 10] }]));
  assert.match(answer.answer, /假设|示例/); assert.match(answer.answer, /5(?:\.0+)?%/);
  assert.match(answer.answer, /0\.5|0\.50/); assert.match(answer.answer, /10/);
  assert.doesNotMatch(answer.answer, /已满足买入|立即买入/);
});

test('risk explanation quotes the supplied ROE gap without fabricating a report value or source', async () => {
  const data = context(), facts = buildDividendExplanationFacts(data, 'zh');
  const roe = facts.find(fact => fact.id === 'stock:601398:check:roe');
  assert.ok(roe);
  const text = '缺少可核对的完整年度财务口径时，这项指标不能用于可靠比较。季度累计数据不能直接充当全年结果。';
  const answer = await readOnlyAsk('根据已有资料解释ROE为什么待核实', envelope([{ type: 'evidence', factIds: [roe.id, 'stock:601398:financial:roe_basis'], text }]), [], data);
  assert.match(answer.answer, /完整年度财务口径|完整年报|年报ROE/);
  assert.match(answer.answer, /季度|年化/);
  assert.doesNotMatch(answer.answer, /ROE(?:已经|为|达到)15%|https:\/\/invented|核验通过/);
  assert.ok(answer.answer.includes(text), answer.answer);
});

test('a simpler-language follow-up retains the earlier topic and uses the new model explanation', async () => {
  const initial = await readOnlyAsk('什么是自由现金流', concept('自由现金流通常指经营活动现金流减去资本性支出。'));
  const history: DividendAdvisorMessage[] = [{ role: 'user', content: '什么是自由现金流' }, { role: 'assistant', content: initial.answer }];
  const simpler = '可以把自由现金流理解成经营收到的钱在扣掉必要设备投入后留下的余钱。这里说明现金的来去与结余。';
  let historySeen = false;
  const answer = await askDividendAdvisorWithActions(config, context(), '换个简单说法', history, { language: 'zh', transport: async request => {
    const body = JSON.stringify(request.body);
    historySeen = body.includes('什么是自由现金流') && body.includes('经营活动现金流减去资本性支出');
    return transport(concept(simpler))(request);
  } });
  assert.equal(historySeen, true); assert.ok(answer.answer.includes(simpler));
  assert.notEqual(answer.answer, initial.answer); assert.deepEqual(answer.actions, []);
});

test('known local explanations and operation checks do not require configuration or a successful model', async () => {
  let calls = 0;
  const never: DividendAdvisorTransport = async () => { calls++; throw new Error('should not request a model'); };
  const definition = await askDividendAdvisorWithActions(null, context(), '什么是股息率？', [], { transport: never });
  assert.match(definition.answer, /每股现金分红除以股价/);
  const operation = await askDividendAdvisorWithActions(null, context(), '今天怎么操作？', [], { transport: never });
  assert.match(operation.answer, /手动暂停|受限/);
  assert.equal(calls, 0);
});

test('local output is delivered before an explanation request completes', async () => {
  let callbackAnswer = '', release: ((value: { status: number; data: unknown }) => void) | undefined;
  const pending = askDividendAdvisorWithActions(config, context(), '根据已有资料解释ROE为什么待核实', [], {
    onLocalResult: result => { callbackAnswer = result.answer; },
    transport: async () => new Promise(resolve => { release = resolve; }),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(callbackAnswer, /ROE|净资产收益率/); assert.match(callbackAnswer, /缺|待核实|复核/);
  assert.ok(release);
  release({ status: 200, data: { choices: [{ message: { content: concept('财务比较需要可核对的报告口径。') } }] } });
  await pending;
});

for (const failure of ['unconfigured', 'http', 'network', 'timeout'] as const) test(`model ${failure} retains local known facts and deterministic restrictions`, async () => {
  const data = context(), before = await state();
  const result = await askDividendAdvisorWithActions(failure === 'unconfigured' ? null : config, data, '根据已有资料解释ROE为什么待核实', [], {
    timeoutMs: 5,
    transport: async () => {
      if (failure === 'http') return { status: 503, data: 'PRIVATE_PROVIDER_ERROR' };
      if (failure === 'network') throw new Error('PRIVATE_PROVIDER_ERROR');
      return new Promise(() => {});
    },
  });
  assert.match(result.answer, /ROE|净资产收益率/);
  assert.match(result.answer, /缺|待核实|复核/); assert.match(result.answer, /手动暂停|受限/);
  assert.doesNotMatch(result.answer, /PRIVATE_PROVIDER_ERROR|synthetic-key/);
  assert.deepEqual(result.actions, []); assert.equal(await state(), before);
});

for (const [label, payload] of [
  ['raw action prose', '今天已到价，请立即新增买入100份。'],
  ['action field', JSON.stringify({ version: 1, blocks: [{ type: 'concept', text: '自由现金流描述经营现金。' }], actions: [{ buyPaused: false }] })],
  ['concept instruction', concept('自由现金流是赶紧冲，闭眼拿。')],
  ['fabricated evidence', envelope([{ type: 'evidence', factIds: ['stock:601398:invented'], text: '原资料可以用于财务比较。' }])],
  ['invented factual number', concept('模拟银行的ROE为15%，已经达到门槛。')],
  ['invented source', concept('根据https://invented.example/report，财务已经通过。')],
] as const) test(`explanation protocol rejects ${label} while retaining local checks`, async () => {
  const answer = await readOnlyAsk('根据已有资料解释ROE为什么待核实', payload);
  assert.doesNotMatch(answer.answer, /立即新增买入100份|赶紧冲|闭眼拿|ROE为15%|invented\.example|已经达到门槛/);
  assert.match(answer.answer, /ROE|净资产收益率/);
  assert.match(answer.answer, /手动暂停|受限/);
});

test('explaining a pause is not a request to pause or regenerate the plan', async () => {
  const data = context(); data.stockPlan.stocks[0].buyPaused = false;
  const answer = await readOnlyAsk('解释模拟银行为什么暂停现有计划加仓', concept('资料不足不代表经营已经恶化。'), [], data);
  assert.deepEqual(answer.actions, []);
  assert.equal(data.stockPlan.stocks[0].buyPaused, false);
  const definition = await readOnlyAsk('解释网格价格为什么这样计算', concept('价格纪律需要区分假设与事实。'));
  assert.deepEqual(definition.actions, []);
});

test('a teaching example uses the supplied operands instead of silently replacing them with defaults', async () => {
  let calls = 0;
  const answer = await askDividendAdvisorWithActions(null, context(), '请按每股现金分红0.8元和股价20元举一个股息率计算例子', [], {
    transport: async () => { calls++; throw new Error('not needed'); },
  });
  assert.match(answer.answer, /0\.8÷20×100%＝4%/);
  assert.doesNotMatch(answer.answer, /0\.5|＝5%/); assert.equal(calls, 0);
});

test('a partial or invalid teaching input stays missing instead of inventing another input', async () => {
  const missing = await askDividendAdvisorWithActions(null, context(), '按每股现金分红0.8元举一个股息率计算例子');
  assert.match(missing.answer, /同时给出每股现金分红和股价/); assert.doesNotMatch(missing.answer, /10元|5%/);
  const invalid = await askDividendAdvisorWithActions(null, context(), '按每股现金分红0.8元和股价0元举一个股息率计算例子');
  assert.match(invalid.answer, /未生成结果/); assert.deepEqual(invalid.actions, []);
});

for (const text of ['所需财务资料齐备，规则已经符合，仓位可继续扩张。', '材料均已到位，条件完全具备。', '证据充分，账户能够增加敞口。']) {
  test(`a real fact ID cannot legitimise contradictory readiness prose: ${text}`, async () => {
    const answer = await readOnlyAsk('根据已有资料解释ROE为什么待核实', envelope([{ type: 'evidence', factIds: ['stock:601398:check:roe'], text }]));
    assert.ok(!answer.answer.includes(text)); assert.equal(answer.explanationStatus, 'rejected');
    assert.match(answer.answer, /缺少|待核实/); assert.match(answer.answer, /手动暂停/);
  });
}

test('an evidence follow-up retains the evidence constraint as well as the conversational topic', async () => {
  const history: DividendAdvisorMessage[] = [{ role: 'user', content: '根据已有资料解释ROE为什么待核实' }, { role: 'assistant', content: '缺少可核对的年度口径，不能直接比较。' }];
  const unsafe = envelope([{ type: 'concept', text: '材料均已到位，条件完全具备。' }, { type: 'evidence', factIds: ['stock:601398:check:roe'], text: '缺少完整年度口径，不能直接比较。' }]);
  const answer = await readOnlyAsk('换个简单说法', unsafe, history);
  assert.equal(answer.explanationStatus, 'rejected'); assert.doesNotMatch(answer.answer, /材料均已到位/);
});

test('repeated short follow-ups retain the substantive topic beyond the provider history window', async () => {
  const history: DividendAdvisorMessage[] = [{ role: 'user', content: '根据已有资料解释ROE为什么待核实' }, { role: 'assistant', content: '缺少可核对的年度口径，不能直接比较。' }];
  for (let i = 0; i < 6; i++) history.push({ role: 'user', content: '换个简单说法' }, { role: 'assistant', content: '缺少可核对的口径，不能直接比较。' });
  const payload = envelope([{ type: 'evidence', factIds: ['stock:601398:check:roe'], text: '缺少完整年度口径，不能直接比较。' }]);
  let topicSent = false;
  const answer = await askDividendAdvisorWithActions(config, context(), '换个简单说法', history, { transport: async request => {
    topicSent = JSON.stringify(request.body).includes('根据已有资料解释ROE为什么待核实');
    return transport(payload)(request);
  } });
  assert.equal(topicSent, true); assert.equal(answer.explanationStatus, 'complete');
  assert.match(answer.localAnswer, /年化口径|未提供已报告月数/);
  assert.deepEqual(answer.actions, []);
  const more = await askDividendAdvisorWithActions(config, context(), '再详细一点', history, { transport: transport(payload) });
  assert.equal(more.explanationStatus, 'complete'); assert.deepEqual(more.actions, []);
});
