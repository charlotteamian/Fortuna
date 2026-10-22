import 'fake-indexeddb/auto';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import * as XLSX from 'xlsx';
import { buildDividendAdvisorContext, dividendAdvisorReadableSnapshot, dividendAdvisorSystemPrompt } from '../src/lib/dividendAdvisor.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';
import { askDividendAdvisor, askDividendAdvisorWithActions, clearDividendAdvisorConfig, DividendAdvisorError, loadDividendAdvisorConfig, saveDividendAdvisorConfig, validateDividendAdvisorConfig, type DividendAdvisorConfig, type DividendAdvisorRequest } from '../src/services/dividendAdvisorService.ts';
import { defaultDividendSelectionPrinciples } from '../src/lib/dividendResearch.ts';
import type { DividendPricingResult } from '../src/lib/dividendPricing.ts';

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
const { db, initializeSettings, exportData, exportToExcel, importData } = await import('../src/db.ts');
const { buildPortableSnapshot } = await import('../src/lib/portableSnapshot.ts');
const now = new Date('2026-10-16T03:00:00Z').getTime();
const stock: DividendStock = {
  code: '601398', name: 'Fixture bank', group: 'core', weightBps: 5000, shareMode: 'linked', manualShares: 0, lotSize: 100,
  quote: { priceMinor: 500, date: '2026-10-15 15:00', fetchedAt: now - 3600_000 },
  quoteFailedAt: now, dividend: { asOf: '2026-10-15', windowStart: '2025-10-15', dpsMicros: 300000, payments: [], fetchedAt: now - 3600_000 },
};
function context() {
  return buildDividendAdvisorContext({ stocks: [stock], strategy: 'funds', budgetMinor: 10000_00, budgetConfigured: true,
    positions: new Map([['601398', { code: '601398', name: 'Fixture bank', shares: 200, sources: [{ accountName: 'PRIVATE ACCOUNT NAME', holdingId: 'PRIVATE HOLDING ID', shares: 200 }] }]]),
    fundPositions: new Map([['512890', 500]]), fundPlan: { ...defaultDividendFundPlan(), budgetMinor: 20000_00, mode: 'rebalance', funds: [
      { id: 'PRIVATE FUND ID', name: 'Dividend ETF', code: '512890', indexKind: 'low_volatility', weightBps: 10000,
        reference: { asOf: '2026-10-15', highMicros: 1000000, priceMicros: 1000000, indexYieldBps: 500 },
        quote: { priceMicros: 900000, date: '2026-10-16 10:59', fetchedAt: now } },
    ] }, dividendRefreshDeferredCodes: ['601398'],
  }, now);
}
const config = (protocol: DividendAdvisorConfig['protocol'] = 'openai'): DividendAdvisorConfig => ({
  protocol, baseUrl: 'https://model.example', model: 'test-model', apiKey: 'private-secret-123',
});
const response = (protocol: DividendAdvisorConfig['protocol'], answer = 'Please check the dated reference.') => protocol === 'openai'
  ? { choices: [{ message: { content: answer } }] } : protocol === 'anthropic'
    ? { content: [{ type: 'thinking', thinking: 'do not show' }, { type: 'text', text: answer }] }
    : { candidates: [{ content: { parts: [{ thought: true, text: 'do not show' }, { text: answer }] } }] };
const code = (expected: string) => (cause: unknown) => {
  assert.ok(cause instanceof DividendAdvisorError);
  assert.equal(cause.code, expected);
  assert.equal(cause.message, expected);
  assert.doesNotMatch(String(cause), /private-secret|provider-body|sensitive-account/);
  return true;
};

test('context excludes private account identities and preserves alternative budgets, dates and actual recorded quantities', () => {
  const data = context();
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE ACCOUNT|PRIVATE HOLDING|PRIVATE FUND/);
  assert.equal(data.activeStrategy, 'funds');
  assert.equal(data.stockPlan.stocks[0].shares, 200);
  assert.equal(data.stockPlan.stocks[0].budgetMinor, 5000_00);
  assert.equal(data.stockPlan.stocks[0].quoteState.refreshFailed, true);
  assert.equal(data.stockPlan.stocks[0].quoteState.priorDate, true);
  assert.equal(data.stockPlan.stocks[0].quoteState.cacheOlderThan15Minutes, true);
  assert.equal(data.fundPlan.fundBudgetMinor, 14000_00);
  assert.equal(data.fundPlan.bondBudgetMinor, 6000_00);
  assert.equal(data.fundPlan.funds[0].budgetMinor, 14000_00);
  assert.equal(data.fundPlan.funds[0].recordedShares, 500);
  assert.equal(data.fundPlan.funds[0].ruleCheck.status, 'update');
  assert.deepEqual(data.fundPlan.funds[0].ruleCheck.issues, ['index_yield_prior_date']);
  assert.deepEqual(data.dividendRefreshDeferredCodes, ['601398']);
});

test('model snapshot uses readable units and dates rather than implementation fields', () => {
  const payload = dividendAdvisorReadableSnapshot(context());
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /manualReference|highMicros|referencePriorDate|ruleCheck|weightBps|budgetMinor|quoteState|PRIVATE/);
  assert.equal(payload['Active plan to discuss first']['Strategy'], 'Dividend funds');
  assert.match(text, /"Planned budget in CNY":20000/);
  assert.match(text, /"Price in CNY per share or unit":0.9/);
  assert.match(text, /"Fixed reference high in CNY, not invalid merely because its date is earlier":1/);
  assert.match(text, /"Underlying index dividend yield percent, not fund cash distribution yield":5/);
  assert.match(text, /"Recorded date":"2026-10-15"/);
  assert.match(text, /"Alternative saved plan, discuss only when the user asks about it"/);
  const prompt = dividendAdvisorSystemPrompt('zh');
  assert.match(prompt, /Write for the person managing their savings, not for a developer/);
  assert.match(prompt, /earlier recorded date alone does NOT make that high invalid/);
  assert.match(prompt, /Do not discuss gaps, old dates or empty holdings in the alternative saved plan/);
});

test('manual annual DPS stays separate from latest-report DPS and manual shares override linked positions', () => {
  const data = buildDividendAdvisorContext({ stocks: [{ ...stock, shareMode: 'manual', manualShares: 50, manualDpsMicros: 0 }],
    strategy: 'stocks', budgetMinor: 0, budgetConfigured: false, fundPlan: defaultDividendFundPlan(), positions: new Map() }, now);
  assert.equal(data.stockPlan.budgetMinor, null);
  assert.equal(data.stockPlan.stocks[0].shares, 50);
  assert.equal(data.stockPlan.stocks[0].dpsMicros, null);
  assert.equal(data.stockPlan.stocks[0].annualGridDpsMicros, 0);
  assert.equal(data.stockPlan.stocks[0].annualGridDpsSource, 'manual-undated');
  assert.match(dividendAdvisorSystemPrompt('zh-CN'), /simplified Chinese/);
  assert.match(dividendAdvisorSystemPrompt('en'), /British English/);
  assert.match(dividendAdvisorSystemPrompt('zh'), /cumulative targets, NOT incremental orders/);
});

test('accelerating declines produce a confirmed-preview pause draft even when a provider suggests resuming', async () => {
  const data = buildDividendAdvisorContext({ stocks: [stock], strategy: 'stocks', budgetMinor: 10000_00,
    budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(), research: {
      generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [{ code: stock.code, name: stock.name,
        checks: [], status: 'unknown', sources: [], issues: [], technical: { asOf: '2026-10-16', fetchedAt: now,
          priceBasis: 'qfq', currentUsable: true, lastCloseMinor: 500, ma5Minor: 520, ma10Minor: 530, ma30Minor: 560,
          ma30SlopePercent: -1, rsi6: 20, change5Percent: -5, change10Percent: -7, change30Percent: -12, previous5Percent: -2,
          drawdown60Percent: -15, state: 'accelerating_down', pacing: 'pause_add' } }] } }, now);
  const text = '先复核计划。\n```fortuna-actions\n[{"id":"resume","code":"601398","reason":"draft","buyPaused":false}]\n```';
  const result = await askDividendAdvisorWithActions(config(), data, '今天该做什么？', [], {
    language: 'zh', transport: async () => ({ status: 200, data: response('openai', text) }),
  });
  assert.match(result.answer, /暂停加仓/);
  assert.doesNotMatch(result.answer, /fortuna-actions|buyPaused/);
  assert.deepEqual(result.actions.map(action => [action.code, action.buyPaused]), [['601398', true]]);
  data.research!.stocks[0].technical!.asOf = '2026-09-01';
  const stale = await askDividendAdvisorWithActions(config(), data, '复核', [], {
    transport: async () => ({ status: 200, data: response('openai', '资料待核实。') }),
  });
  assert.equal(stale.actions.length, 0);
});

test('the assistant cannot turn missing or contradicted valuation inputs into executable model prices', async () => {
  const data = buildDividendAdvisorContext({ stocks: [stock], strategy: 'stocks', budgetMinor: 10000_00,
    budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(), research: {
      generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [],
      stocks: [{ code: stock.code, name: stock.name, checks: [], status: 'unknown', sources: [], issues: [],
        pricing: { status: 'blocked', canApply: false, grid: [], anchors: {}, annuals: [], blockers: [], warnings: [], normalizationBasis: 'missing', riskClass: 'other', taxBps: 0, gordonYieldBps: 800, sourceUrls: [] } as DividendPricingResult }] } }, now);
  const levels = [{ yieldBps: 500, portionBps: 3333, priceMinor: 400 }, { yieldBps: 600, portionBps: 3333, priceMinor: 350 }, { yieldBps: 700, portionBps: 3334, priceMinor: 300 }];
  const run = (buyLevels = levels) => askDividendAdvisorWithActions(config(), data, '复核定价', [], { transport: async () => ({ status: 200,
    data: response('openai', `资料检查。\n\`\`\`fortuna-actions\n${JSON.stringify([{ id: 'grid', code: stock.code, reason: 'Review', buyPaused: true, buyLevels }])}\n\`\`\``) }) });
  assert.deepEqual((await run()).actions, [{ id: 'grid', code: stock.code, reason: 'Review', buyPaused: true }]);
  data.research!.stocks[0].pricing = { ...data.research!.stocks[0].pricing!, status: 'ready', canApply: true, grid: levels } as unknown as DividendPricingResult;
  assert.deepEqual((await run()).actions[0].buyLevels, levels);
  assert.equal((await run([{ ...levels[0], priceMinor: 401 }, ...levels.slice(1)])).actions[0].buyLevels, undefined);
  assert.equal((await run(levels.map((level, index) => ({ ...level, portionBps: index === 0 ? 9000 : 500 })))).actions[0].buyLevels, undefined);
});

test('regeneration supplies a verified paused ladder without a model draft and preserves it during accelerating declines', async () => {
  const { calculateDividendPricing, defaultDividendPricingMethod } = await import('../src/lib/dividendPricing.ts');
  const pricing = calculateDividendPricing({ code: stock.code, name: stock.name, financialSector: false,
    method: defaultDividendPricingMethod(), asOf: '2026-10-16', priceMinor: 1000, priceDate: '2026-10-16',
    treasury: { yieldBps: 200, asOf: '2026-10-16', fetchedAt: now, history: [], sourceUrl: 'https://example.com/treasury' },
    annuals: Array.from({ length: 5 }, (_, index) => ({ year: 2025 - index, reportDate: `${2025 - index}-12-31`, noticeDate: `${2026 - index}-03-20`,
      epsMicros: 1000000, adjustedEpsMicros: 1000000, dividendMicros: 500000, payoutBps: 5000, fcfCoverageBps: 20000 })) });
  assert.equal(pricing.canApply, true);
  const data = buildDividendAdvisorContext({ stocks: [stock, { ...stock, code: '000333', name: '美的集团' }], strategy: 'stocks', budgetMinor: 10000_00,
    budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(), research: {
      generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [],
      stocks: [stock, { ...stock, code: '000333', name: '美的集团' }].map(saved => ({ code: saved.code, name: saved.name,
        checks: [], status: 'unknown', sources: [], issues: [], pricing, technical: { asOf: '2026-10-16', fetchedAt: now,
          priceBasis: 'qfq', currentUsable: true, lastCloseMinor: 500, state: 'accelerating_down', pacing: 'pause_add' } })) } }, now);
  const before = structuredClone(data.stockPlan);
  const run = (question: string) => askDividendAdvisorWithActions(config(), data, question, [], {
    transport: async () => ({ status: 200, data: response('openai', '已复核估值和走势。') }) });
  const result = await run('重新生成美的的网格计划');
  const midea = result.actions.find(action => action.code === '000333')!;
  assert.deepEqual(midea.buyLevels?.map(level => level.priceMinor), pricing.grid.map(level => level.priceMinor));
  assert.equal(midea.buyPaused, true);
  assert.equal(result.actions.find(action => action.code === stock.code)?.buyLevels, undefined);
  assert.match(result.answer, /三锚估值/);
  assert.deepEqual(data.stockPlan, before, 'draft generation cannot write or mutate the saved plan');
  const riskOnly=await run('不要计算美的集团价格，只复核风险');
  assert.ok(riskOnly.actions.length>0);assert.ok(riskOnly.actions.every(action=>action.buyPaused && !action.buyLevels));
  assert.match(riskOnly.answer,/暂停加仓/);assert.match(riskOnly.answer,/已复核估值和走势/);assert.doesNotMatch(riskOnly.answer,/新三档/);
  data.research!.stocks.forEach(row => { row.technical!.state = 'rising'; row.technical!.pacing = 'observe'; });
  assert.equal((await run('什么是股息率？')).actions.length, 0);
  const all = await run('重新生成网格计划');
  assert.equal(all.actions.length, 2);
  assert.ok(all.actions.every(action => action.buyLevels?.length === 3 && action.buyPaused));
  data.stockPlan.stocks[0].code = '601288'; data.stockPlan.stocks[0].name = '农业银行';
  data.research!.stocks[0].code = '601288'; data.research!.stocks[0].name = '农业银行';
  assert.deepEqual((await run('重新生成农行网格计划')).actions.map(action => action.code), ['601288']);
  assert.equal((await run('重新生成美的和农行的网格计划')).actions.length, 2);
  assert.equal((await run('不要重新生成计划，先解释美的的估值')).actions.length, 0);
  for (const question of ['不要计算美的集团价格，只复核风险','别估算美的集团价格','无需给出美的集团价格','不用给个美的集团价格','不需要提供美的集团价格',
    'Do not calculate 美的集团 price; review risk only',"Don't estimate 美的集团 price; review risk only"]) {
    const review=await run(question);
    assert.equal(review.actions.length,0,question);
    assert.equal(review.answer,'已复核估值和走势。',question);
  }
  assert.equal((await run('重新生成中国石油网格计划')).actions.length, 0);
  data.stockPlan.stocks[1].sellGrid = [{ yieldBps: 100, portionBps: 10000, priceMinor: 100 } as typeof data.stockPlan.stocks[1]['sellGrid'][number]];
  const crossing = await run('重新生成美的集团的网格计划');
  assert.equal(crossing.actions.length, 0);
  assert.match(crossing.answer, /卖出计划/);
  assert.ok(crossing.answer.includes(`三锚估值${(pricing.theoreticalPriceMinor!/100).toFixed(2)}元`));
  assert.ok(crossing.answer.includes(pricing.grid.map(level=>(level.priceMinor/100).toFixed(2)).join('／')));
  assert.match(crossing.answer,/暂不能写入/);
  data.stockPlan.stocks[1].sellGrid = [];
  data.research!.stocks[1].technical!.state = 'accelerating_down';
  const modelDraft = { id: 'long-reason', code: '000333', buyPaused: false, reason: '复核'.repeat(995), buyLevels: all.actions[0].buyLevels };
  const merged = await askDividendAdvisorWithActions(config(), data, '复核', [], { transport: async () => ({ status: 200,
    data: response('openai', `\`\`\`fortuna-actions\n${JSON.stringify([modelDraft])}\n\`\`\``) }) });
  const { isDividendPlanProposal } = await import('../src/lib/dividendAdvisorActions.ts');
  assert.equal(merged.actions[0].buyLevels?.length, 3);
  assert.equal(isDividendPlanProposal(merged.actions[0]), true);
});

test('pricing questions produce a cash-supported paused draft despite payout warnings and a contradictory provider refusal', async () => {
  const { calculateDividendPricing, defaultDividendPricingMethod } = await import('../src/lib/dividendPricing.ts');
  const pricing=calculateDividendPricing({code:stock.code,name:stock.name,financialSector:false,method:defaultDividendPricingMethod(),
    asOf:'2026-10-16',priceMinor:1000,priceDate:'2026-10-16',
    treasury:{yieldBps:200,asOf:'2026-10-16',fetchedAt:now,history:[],sourceUrl:'https://example.com/treasury'},
    annuals:Array.from({length:5},(_,i)=>({year:2025-i,reportDate:`${2025-i}-12-31`,noticeDate:`${2026-i}-03-20`,
      epsMicros:1000000,adjustedEpsMicros:1000000,dividendMicros:500000,payoutBps:i===0?10021:5000,fcfCoverageBps:i===0?12664:20000}))});
  const data=buildDividendAdvisorContext({stocks:[stock],strategy:'stocks',budgetMinor:10000_00,budgetConfigured:true,
    positions:new Map(),fundPlan:defaultDividendFundPlan(),research:{generatedAt:now,principles:defaultDividendSelectionPrinciples(),indices:[],
      stocks:[{code:stock.code,name:stock.name,checks:[],status:'risk',sources:[],issues:[],pricing}]}},now);
  const result=await askDividendAdvisorWithActions(config(),data,'计算价格',[],{language:'zh',transport:async()=>({status:200,
    data:response('openai','payout_above_100 和 fcf_below_150，所以无法生成价格。')})});
  assert.equal(result.actions.length,1);assert.equal(result.actions[0].buyPaused,true);
  assert.deepEqual(result.actions[0].buyLevels?.map(level=>level.priceMinor),pricing.grid.map(level=>level.priceMinor));
  assert.match(result.answer,/三锚估值8.44元/);assert.match(result.answer,/暂停加仓/);
  assert.doesNotMatch(result.answer,/payout_above_100|fcf_below_150|无法生成价格/);
  assert.doesNotMatch(result.actions[0].reason,/payout_above_100|fcf_below_150/);
  const resume=await askDividendAdvisorWithActions(config(),data,'复核',[],{language:'zh',transport:async()=>({status:200,
    data:response('openai',`payout_above_100，暂时观察。\n\`\`\`fortuna-actions\n${JSON.stringify([{id:'resume',code:stock.code,reason:'fcf_below_150',buyPaused:false}])}\n\`\`\``)})});
  assert.equal(resume.actions[0].buyPaused,true);assert.doesNotMatch(resume.answer,/payout_above_100/);
  const fabricated=await askDividendAdvisorWithActions(config(),data,'复核',[],{transport:async()=>({status:200,
    data:response('openai',`\`\`\`fortuna-actions\n${JSON.stringify([{id:'bad-grid-resume',code:stock.code,reason:'resume',buyPaused:false,
      buyLevels:pricing.grid.map((level,i)=>({priceMinor:level.priceMinor+100,yieldBps:level.yieldBps,portionBps:i===2?3334:3333}))}])}\n\`\`\``)})});
  assert.equal(fabricated.actions[0].buyPaused,true);assert.equal(fabricated.actions[0].buyLevels,undefined);
});

for (const protocol of ['openai', 'gemini', 'anthropic'] as const) test(`${protocol} converts a JSON-fenced pause draft to an action while retaining pricing verification`, async () => {
  const draft = { id: 'pause_bank_buy', code: stock.code, reason: '等待现金流覆盖改善后复核。', buyPaused: true };
  const result = await askDividendAdvisorWithActions(config(protocol), context(), '复核计划', [], { transport: async () => ({ status: 200,
    data: response(protocol, `建议暂停现有计划加仓。\n\n\`\`\`json\n${JSON.stringify([draft])}\n\`\`\``) }) });
  assert.deepEqual(result, { answer: '建议暂停现有计划加仓。', actions: [draft] });
});

test('the method prompt distinguishes single-period dividends, holding-year events and sustainable valuation D1', () => {
  const prompt = dividendAdvisorSystemPrompt('zh');
  assert.match(prompt, /latest announced reporting period only/);
  assert.match(prompt, /upcoming announcements replace their corresponding historical seasonal estimate/);
  assert.match(prompt, /Do not multiply D1 by growth again/);
  assert.match(prompt, /Do not append generic investment-risk statements/);
  assert.match(prompt, /Anchor disagreement is not a veto/);
  assert.match(prompt, /highest available valid yield/);
  assert.match(prompt, /Never offer a separate manual anchor price/);
});

for (const protocol of ['openai', 'gemini', 'anthropic'] as const) test(`${protocol} sends text, current snapshot and bounded conversation with the proper authentication`, async () => {
  const result = await askDividendAdvisor(config(protocol), context(), 'What should I check?', [{ role: 'user', content: 'Previous question' }, { role: 'assistant', content: 'Previous answer' }], {
    transport: async (request: DividendAdvisorRequest) => {
      const body = JSON.stringify(request.body);
      assert.match(body, /Current dividend snapshot/);
      assert.match(body, /Previous question/);
      assert.match(body, /What should I check/);
      assert.doesNotMatch(body, /private-secret|PRIVATE ACCOUNT|PRIVATE HOLDING|PRIVATE FUND/);
      assert.doesNotMatch(body, /manualReference|highMicros|referencePriorDate|ruleCheck|budgetMinor|weightBps/);
      assert.match(body, /Price in CNY per share or unit/);
      assert.equal(request.timeoutMs, 90_000);
      if (protocol === 'openai') { assert.equal(request.url, 'https://model.example/v1/chat/completions'); assert.equal(request.headers.Authorization, 'Bearer private-secret-123'); assert.equal(request.body.stream, false); }
      else if (protocol === 'gemini') { assert.equal(request.url, 'https://model.example/v1beta/models/test-model:generateContent'); assert.equal(request.headers['x-goog-api-key'], 'private-secret-123'); assert.ok(request.body.systemInstruction); }
      else { assert.equal(request.url, 'https://model.example/v1/messages'); assert.equal(request.headers['x-api-key'], 'private-secret-123'); assert.equal(request.headers['anthropic-version'], '2023-06-01'); assert.ok(request.body.system); }
      return { status: 200, data: JSON.stringify(response(protocol)) };
    },
  });
  assert.equal(result, 'Please check the dated reference.');
});

test('full endpoints preserve custom query parameters, and vendor compatibility flags remain available', async () => {
  await askDividendAdvisor({ ...config(), provider: 'aliyun', model: 'qwen3-vl-flash', baseUrl: 'https://model.example/proxy/chat/completions/?api-version=1' }, context(), 'Check', [], {
    transport: async request => { assert.equal(request.url, 'https://model.example/proxy/chat/completions?api-version=1'); assert.equal(request.body.enable_thinking, false); return { status: 200, data: response('openai') }; },
  });
});

test('provider failures, invalid responses and network exceptions expose stable codes without provider data or keys', async () => {
  for (const [status, expected] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'HTTP'], [302, 'HTTP']] as const) {
    await assert.rejects(askDividendAdvisor(config(), context(), 'Check', [], { transport: async () => ({ status, data: 'provider-body private-secret-123 sensitive-account' }) }), code(expected));
  }
  await assert.rejects(askDividendAdvisor(config(), context(), 'Check', [], { transport: async () => { throw new Error('provider-body private-secret-123'); } }), code('NETWORK'));
  for (const data of ['not JSON private-secret-123', { choices: [] }, response('openai', ''), response('openai', 'x'.repeat(30_001))]) {
    await assert.rejects(askDividendAdvisor(config(), context(), 'Check', [], { transport: async () => ({ status: 200, data }) }), code('RESPONSE'));
  }
});

test('timeouts and navigation cancellation end a hung request and abort browser transport', async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(askDividendAdvisor(config(), context(), 'Check', [], { timeoutMs: 10, transport: async request => { signal = request.signal; return new Promise(() => {}); } }), code('TIMEOUT'));
  assert.equal(signal?.aborted, true);
  const controller = new AbortController();
  const pending = askDividendAdvisor(config(), context(), 'Check', [], { signal: controller.signal, transport: async () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(pending, code('CANCELLED'));
});

test('truncated or blocked answers are not presented as complete operational guidance', async () => {
  const cases = [
    ['openai', { choices: [{ finish_reason: 'length', message: { content: 'Consider buying before…' } }] }],
    ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Consider buying before…' }] } }] }],
    ['anthropic', { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Consider buying before…' }] }],
  ] as const;
  for (const [protocol, data] of cases) await assert.rejects(askDividendAdvisor(config(protocol), context(), 'Check', [], {
    transport: async () => ({ status: 200, data }),
  }), code('RESPONSE'));
});

test('bad configuration/questions and non-HTTPS remote URLs fail before any API call', async () => {
  assert.throws(() => validateDividendAdvisorConfig({ ...config(), apiKey: 'bad\nkey' }), code('CONFIG'));
  assert.throws(() => validateDividendAdvisorConfig({ ...config(), baseUrl: 'http://model.example/v1' }), code('URL'));
  assert.throws(() => validateDividendAdvisorConfig({ ...config(), baseUrl: 'https://user:password@model.example' }), code('URL'));
  assert.equal(validateDividendAdvisorConfig({ ...config(), baseUrl: 'http://localhost:11434/v1' }).baseUrl, 'http://localhost:11434/v1');
  await assert.rejects(askDividendAdvisor(config(), context(), ' '), code('QUESTION'));
  await assert.rejects(askDividendAdvisor(config(), context(), 'x'.repeat(2001)), code('QUESTION'));
});

test('model credentials stay outside JSON/Excel backups, asset snapshots and ledger restore', async () => {
  await saveDividendAdvisorConfig(config());
  assert.equal((await loadDividendAdvisorConfig())?.apiKey, 'private-secret-123');
  assert.equal((await Dexie.getDatabaseNames()).includes('FortunaDividendAdvisorConfig'), true);
  const settings = await initializeSettings();
  const json = await exportData();
  assert.doesNotMatch(json, /private-secret-123|model.example|test-model|DividendAdvisorConfig/);
  const workbook = XLSX.read(await exportToExcel(), { type: 'base64' });
  assert.doesNotMatch(JSON.stringify(workbook), /private-secret-123|model.example|test-model|DividendAdvisorConfig/);
  const snapshot = buildPortableSnapshot({ accounts: [], records: [], holdings: [], transactions: [], exchangeRates: [], settings,
    planStatus: { items: [], totalAssets: 0, base: 0, targetPercentSum: 0, allocationWarnings: [], unavailableValuationCount: 0, unplanned: [], equityAccounts: [] } });
  assert.doesNotMatch(JSON.stringify(snapshot), /private-secret-123|model.example|test-model|DividendAdvisorConfig/);
  assert.equal(await importData(json), true);
  assert.equal((await loadDividendAdvisorConfig())?.apiKey, 'private-secret-123');
  await clearDividendAdvisorConfig();
  assert.equal(await loadDividendAdvisorConfig(), null);
});
after(() => db.close());
