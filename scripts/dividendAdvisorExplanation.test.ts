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

test('normal Markdown AI answers are displayed directly for concepts and risk explanations', async () => {
  const conceptReply = '自由现金流通常指经营活动现金流减去资本性支出，用于衡量公司维持必要投资后还能剩下多少可自由支配现金。';
  const conceptAnswer = await readOnlyAsk('什么是自由现金流', conceptReply);
  assert.equal(conceptAnswer.explanationStatus, 'complete');
  assert.equal(conceptAnswer.answer, conceptReply);

  const riskReply = '模拟银行目前只有 2026-09-30 季度累计 ROE（5%），缺少完整年报口径，因此 ROE 暂标记为待核实。';
  const riskAnswer = await readOnlyAsk('根据已有资料解释ROE为什么待核实', riskReply);
  assert.equal(riskAnswer.explanationStatus, 'complete');
  assert.equal(riskAnswer.answer, riskReply);
  assert.doesNotMatch(riskAnswer.answer, /已有的本地说明和检查会保留|### 本地检查/);
});

test('a requested dividend-yield example is labelled hypothetical and calculated locally', async () => {
  const answer = await readOnlyAsk('举一个股息率计算例子', 'should not need model');
  assert.match(answer.answer, /假设|示例/); assert.match(answer.answer, /5(?:\.0+)?%/);
  assert.match(answer.answer, /0\.5|0\.50/); assert.match(answer.answer, /10/);
  assert.doesNotMatch(answer.answer, /已满足买入|立即买入/);
});

test('a follow-up like 解释一下 or 换个简单说法 passes conversation history to AI', async () => {
  const initialReply = '自由现金流是经营活动现金流减去资本性支出。';
  const history: DividendAdvisorMessage[] = [{ role: 'user', content: '什么是自由现金流' }, { role: 'assistant', content: initialReply }];
  const simpler = '可以把自由现金流理解成经营收到的钱在扣掉必要设备投入后留下的余钱。';
  let historySeen = false;
  const answer = await askDividendAdvisorWithActions(config, context(), '解释一下', history, { language: 'zh', transport: async request => {
    const body = JSON.stringify(request.body);
    historySeen = body.includes('什么是自由现金流') && body.includes(initialReply);
    return transport(simpler)(request);
  } });
  assert.equal(historySeen, true);
  assert.equal(answer.explanationStatus, 'complete');
  assert.equal(answer.answer, simpler);
  assert.deepEqual(answer.actions, []);
});

test('built-in glossary definitions work offline while operational questions honestly report unconfigured AI', async () => {
  let calls = 0;
  const never: DividendAdvisorTransport = async () => { calls++; throw new Error('should not request a model'); };
  const definition = await askDividendAdvisorWithActions(null, context(), '什么是股息率？', [], { transport: never });
  assert.match(definition.answer, /每股现金分红除以股价/);
  assert.equal(definition.explanationStatus, 'not_needed');

  const operation = await askDividendAdvisorWithActions(null, context(), '今天怎么操作？', [], { transport: never });
  assert.equal(operation.explanationStatus, 'unconfigured');
  assert.equal(operation.errorCode, 'CONFIG');
  assert.match(operation.answer, /尚未配置 AI/);
  assert.doesNotMatch(operation.answer, /操作建议已按确定性检查限制|选股资格|### 本地检查/);
  assert.equal(calls, 0);
});

test('pending AI calls do not flash a premature local check dump before the provider responds', async () => {
  let localCalled = false;
  let release: ((value: { status: number; data: unknown }) => void) | undefined;
  const pending = askDividendAdvisorWithActions(config, context(), '根据已有资料解释ROE为什么待核实', [], {
    onLocalResult: () => { localCalled = true; },
    transport: async () => new Promise(resolve => { release = resolve; }),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(localCalled, false, 'normal AI questions must wait for the real AI response instead of flashing local dumps');
  assert.ok(release);
  release({ status: 200, data: { choices: [{ message: { content: '财务比较需要可核对的完整年度报告口径。' } }] } });
  const result = await pending;
  assert.equal(result.explanationStatus, 'complete');
  assert.equal(result.answer, '财务比较需要可核对的完整年度报告口径。');
});

for (const failure of ['unconfigured', 'http', 'network', 'timeout'] as const) test(`model ${failure} returns an explicit failure reason without leaking secrets or dumping checks`, async () => {
  const data = context(), before = await state();
  const result = await askDividendAdvisorWithActions(failure === 'unconfigured' ? null : config, data, '根据已有资料解释ROE为什么待核实', [], {
    timeoutMs: 5,
    transport: async () => {
      if (failure === 'http') return { status: 503, data: 'PRIVATE_PROVIDER_ERROR' };
      if (failure === 'network') throw new Error('PRIVATE_PROVIDER_ERROR');
      return new Promise(() => {});
    },
  });
  assert.equal(result.explanationStatus, failure === 'unconfigured' ? 'unconfigured' : 'unavailable');
  assert.match(result.answer, failure === 'unconfigured' ? /尚未配置 AI/ : failure === 'http' ? /HTTP 503/ : failure === 'timeout' ? /超时/ : /网络异常/);
  assert.doesNotMatch(result.answer, /PRIVATE_PROVIDER_ERROR|synthetic-key|操作建议已按确定性检查限制|### 本地检查/);
  assert.deepEqual(result.actions, []); assert.equal(await state(), before);
});

test('explaining a pause is not a request to pause or regenerate the plan', async () => {
  const data = context(); data.stockPlan.stocks[0].buyPaused = false;
  const answer = await readOnlyAsk('解释模拟银行为什么暂停现有计划加仓', '资料不足本身不会自动暂停网格，手动暂停需要用户自己确认。', [], data);
  assert.deepEqual(answer.actions, []);
  assert.equal(data.stockPlan.stocks[0].buyPaused, false);
  const definition = await readOnlyAsk('解释网格价格为什么这样计算', '价格由税后已实施分红除以固定股息率计算。');
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

test('repeated short follow-ups retain the substantive topic beyond the provider history window', async () => {
  const history: DividendAdvisorMessage[] = [{ role: 'user', content: '根据已有资料解释ROE为什么待核实' }, { role: 'assistant', content: '缺少可核对的年度口径，不能直接比较。' }];
  for (let i = 0; i < 6; i++) history.push({ role: 'user', content: '换个简单说法' }, { role: 'assistant', content: '缺少可核对的口径，不能直接比较。' });
  const reply = '简单来说，现在只有三季报累计数字，缺少完整年度口径，所以暂时不能直接和年化门槛对比。';
  let topicSent = false;
  const answer = await askDividendAdvisorWithActions(config, context(), '换个简单说法', history, { transport: async request => {
    topicSent = JSON.stringify(request.body).includes('根据已有资料解释ROE为什么待核实');
    return transport(reply)(request);
  } });
  assert.equal(topicSent, true); assert.equal(answer.explanationStatus, 'complete');
  assert.equal(answer.answer, reply);
  assert.deepEqual(answer.actions, []);
  const more = await askDividendAdvisorWithActions(config, context(), '再详细一点', history, { transport: transport(reply) });
  assert.equal(more.explanationStatus, 'complete'); assert.deepEqual(more.actions, []);
});
