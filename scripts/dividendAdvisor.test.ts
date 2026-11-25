import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import 'fake-indexeddb/auto';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Dexie from 'dexie';
import * as XLSX from 'xlsx';
import { buildDividendAdvisorContext, dividendAdvisorReadableSnapshot, dividendAdvisorSystemPrompt } from '../src/lib/dividendAdvisor.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { parseDividendResponse, type DividendStock } from '../src/lib/dividendWorkbench.ts';
import { askDividendAdvisor, askDividendAdvisorWithActions, clearDividendAdvisorConfig, DividendAdvisorError, loadDividendAdvisorConfig, saveDividendAdvisorConfig, validateDividendAdvisorConfig, type DividendAdvisorConfig, type DividendAdvisorRequest } from '../src/services/dividendAdvisorService.ts';
import { defaultDividendSelectionPrinciples } from '../src/lib/dividendResearch.ts';
import type { DividendPricingResult } from '../src/lib/dividendPricing.ts';
import { verifiedDividendBase } from './helpers/dividendPricingFixture.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';

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
const dividendBase = (dpsMicros=500000) => verifiedDividendBase(dpsMicros, '2026-10-16');
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

test('daily, portfolio, follow-up and single-stock questions invoke the configured AI and never dump local check walls', async () => {
  const data = buildDividendAdvisorContext({ stocks: [{ ...stock, buyPaused: true, quoteFailedAt: undefined,
    quote: { priceMinor: 900, date: '2026-10-16 10:00', fetchedAt: now },
    buyLevels: [{ priceMinor: 1000, yieldBps: 550, portionBps: 10000 }], sellLevels: [{ priceMinor: 1200, yieldBps: 450, portionBps: 10000 }] }],
    strategy: 'stocks', budgetMinor: 1000000, budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(),
    research: { generatedAt: now, principles: defaultDividendSelectionPrinciples(), stocks: [{ code: stock.code, name: stock.name,
      checks: [{ rule: 'roe', status: 'risk', value: 500, threshold: 800 }], status: 'risk', sources: [], issues: [] }], indices: [] } }, now);
  assert.equal(data.stockPlan.stocks[0].checkSummary.trigger.buy, 'triggered');
  for (const [language, question, aiReply] of [
    ['zh', '按我当前的红利计划，现在可以怎么做？', '## 今日建议\n\n模拟银行虽然触及买档，但你已手动暂停新增买入，建议先复核 ROE 风险后再决定。'],
    ['zh', '我的预算分配和已记录仓位，有哪些需要注意？', '当前预算集中在单只标的，且尚未记录实际持仓。'],
    ['zh', '解释一下', '因为你已手动暂停该股买入，所以即便到价也不会自动建议加仓。'],
    ['en', 'What should I do today?', 'Hold off for now: buying is manually paused and ROE failed the saved threshold.'],
  ] as const) {
    let calls = 0;
    let payload = '';
    const result = await askDividendAdvisorWithActions(config(), data, question, [], {
      language,
      transport: async request => {
        calls++;
        payload = JSON.stringify(request.body);
        return { status: 200, data: response('openai', aiReply) };
      },
    });
    assert.equal(calls, 1, `AI transport must be invoked for: ${question}`);
    assert.match(payload, /Additional buying paused by user\\":true/);
    assert.equal(result.explanationStatus, 'complete');
    assert.equal(result.answer, aiReply);
    assert.deepEqual(result.actions, []);
    assert.doesNotMatch(result.answer, /操作建议已按确定性检查限制|已有的本地说明和检查会保留|### 本地检查/);
  }
});

test('model grids share the homepage current-quote gate and never receive implicit seven-tier prices', () => {
  for (const patch of [{ quote: { priceMinor: 900, date: '2026-10-01 15:00', fetchedAt: now } },
    { quote: { priceMinor: 900, date: '2026-10-16 10:00', fetchedAt: now }, quoteFailedAt: now }]) {
    const data = buildDividendAdvisorContext({ stocks: [{ ...stock, ...patch, buyLevels: [{ priceMinor: 1000, yieldBps: 550, portionBps: 10000 }], sellLevels: [{ priceMinor: 1200, yieldBps: 450, portionBps: 10000 }] }],
      strategy: 'stocks', budgetMinor: 1000000, budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan() }, now);
    assert.equal(data.stockPlan.stocks[0].checkSummary.trigger.buy, 'unknown');
    assert.ok(data.stockPlan.stocks[0].buyGrid.every(row => !row.touched));
  }
  assert.equal(context().stockPlan.stocks[0].buyGrid.length, 0);
});

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
  assert.equal(data.fundPlan.funds[0].ruleCheck.status, 'met');
  assert.deepEqual(data.fundPlan.funds[0].ruleCheck.issues, []);
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

test('model receives the exact prior-year dividend estimate alongside the undisclosed current amount', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dividend-forecast-cmb-2026-10-22.json', import.meta.url), 'utf8'));
  const dividend = parseDividendResponse(fixture.report, '600036', '2026-10-22', 1);
  const data = buildDividendAdvisorContext({ stocks: [{ ...stock, code: '600036', name: '招商银行', dividend }],
    strategy: 'stocks', budgetMinor: 1000000, budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan() }, new Date('2026-10-22T03:00:00Z').getTime());
  const payload = JSON.stringify(dividendAdvisorReadableSnapshot(data));
  assert.equal(data.stockPlan.stocks[0].dpsMicros, null);
  assert.equal(data.stockPlan.stocks[0].holdingYearForecast.dpsMicros, 2016000);
  assert.match(payload, /"Original reporting period supplying the estimated amount":"2025-06-30"/);
  assert.match(payload, /"Current announcement amount remains undisclosed":true/);
  assert.match(payload, /"Historical seasonal estimate CNY per share":2.016/);
  assert.match(payload, /"CNY per share":1.013/);
  assert.doesNotMatch(payload, /basisReportDate|amountUnannounced/);
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

test('accelerating declines pass risk context to AI and strip unsolicited pause or resume actions', async () => {
  const data = buildDividendAdvisorContext({ stocks: [stock], strategy: 'stocks', budgetMinor: 10000_00,
    budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(), research: {
      generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [{ code: stock.code, name: stock.name,
        checks: [], status: 'unknown', sources: [], issues: [], technical: { asOf: '2026-10-16', fetchedAt: now,
          priceBasis: 'qfq', currentUsable: true, lastCloseMinor: 500, ma5Minor: 520, ma10Minor: 530, ma30Minor: 560,
          ma30SlopePercent: -1, rsi6: 20, change5Percent: -5, change10Percent: -7, change30Percent: -12, previous5Percent: -2,
          drawdown60Percent: -15, state: 'accelerating_down', pacing: 'pause_add' } }] } }, now);
  const text = '日线呈现下跌加速，短期波动风险偏高，但不会自动暂停网格。\n```fortuna-actions\n[{"id":"resume","code":"601398","reason":"draft","buyPaused":false}]\n```';
  let sentPayload = '';
  const result = await askDividendAdvisorWithActions(config(), data, '今天该做什么？', [], {
    language: 'zh', transport: async request => { sentPayload = JSON.stringify(request.body); return { status: 200, data: response('openai', text) }; },
  });
  assert.match(sentPayload, /下跌加速/); assert.match(sentPayload, /不自动暂停/);
  assert.match(result.answer, /下跌加速/);
  assert.doesNotMatch(result.answer, /fortuna-actions|buyPaused/);
  assert.deepEqual(result.actions, []);
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
  const verifiedPricing=calculateDividendPricing({code:stock.code,name:stock.name,financialSector:true,method:defaultDividendPricingMethod(),annuals:[],asOf:'2026-10-16',dividendBase:dividendBase(200000)});
  const levels=verifiedPricing.grid.map(level=>({yieldBps:level.yieldBps,portionBps:2500,priceMinor:level.priceMinor}));
  const run = (buyLevels = levels) => askDividendAdvisorWithActions(config(), data, '复核定价', [], { transport: async () => ({ status: 200,
    data: response('openai', `资料检查。\n\`\`\`fortuna-actions\n${JSON.stringify([{ id: 'grid', code: stock.code, reason: 'Review', buyPaused: true, buyLevels }])}\n\`\`\``) }) });
  assert.deepEqual((await run()).actions, []);
  data.research!.stocks[0].pricing = verifiedPricing;
  assert.deepEqual((await run()).actions, [], 'even a matching model draft cannot originate a local confirmation action');
  const explicit = await askDividendAdvisorWithActions(null, data, '重新生成网格计划');
  assert.deepEqual(explicit.actions[0].buyLevels, levels, 'an explicit request uses the verified local plan without a model');
  assert.equal((await run([{ ...levels[0], priceMinor: 401 }, ...levels.slice(1)])).actions.length, 0);
  assert.equal((await run(levels.map((level, index) => ({ ...level, portionBps: index === 0 ? 9000 : 500 })))).actions.length, 0);
  // Bypass the cache deliberately: persisted or caller-supplied obsolete math
  // must not become a new draft just because an AI repeats its old prices.
  delete data.research!.stocks[0].pricing!.calculationVersion;
  assert.deepEqual((await run()).actions, []);
  assert.equal((await askDividendAdvisorWithActions(config(), data, '重新生成网格计划', [], { transport: async () => ({ status: 200,
    data: response('openai', '已经按历史价格重算。') }) })).actions.length, 0);
});

test('regeneration supplies a verified ladder without changing manual pause state, and suppresses identical grid proposals', async () => {
  const { calculateDividendPricing, defaultDividendPricingMethod } = await import('../src/lib/dividendPricing.ts');
  const pricing = calculateDividendPricing({ code: stock.code, name: stock.name, financialSector: false,
    method: defaultDividendPricingMethod(), asOf: '2026-10-16', priceMinor: 1000, priceDate: '2026-10-16', dividendBase: dividendBase(),
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
  let lastPayload = '';
  const run = (question: string) => askDividendAdvisorWithActions(config(), data, question, [], {
    transport: async request => { lastPayload = JSON.stringify(request.body); return { status: 200, data: response('openai', '已结合最新分红与走势完成解读。') }; } });
  const result = await run('重新生成美的的网格计划');
  const midea = result.actions.find(action => action.code === '000333')!;
  assert.deepEqual(midea.buyLevels?.map(level => level.priceMinor), pricing.grid.map(level => level.priceMinor));
  assert.equal(midea.buyPaused, undefined);
  assert.equal(result.actions.find(action => action.code === stock.code)?.buyLevels, undefined);
  assert.match(lastPayload, /5%股息率中性参考线|买入四档/);
  assert.deepEqual(data.stockPlan, before, 'draft generation cannot write or mutate the saved plan');
  const riskOnly = await run('不要计算美的集团价格，只复核风险');
  assert.equal(riskOnly.actions.length, 0);
  assert.match(lastPayload, /下跌加速/);
  assert.doesNotMatch(riskOnly.answer, /操作建议已按确定性检查限制/);
  data.research!.stocks.forEach(row => { row.technical!.state = 'rising'; row.technical!.pacing = 'observe'; });
  assert.equal((await run('什么是股息率？')).actions.length, 0);
  const all = await run('重新生成网格计划');
  assert.equal(all.actions.length, 2);
  assert.ok(all.actions.every(action => action.buyLevels?.length === 4 && action.sellLevels?.length === 4 && action.buyPaused === undefined));
  const pausedByUser = await run('重新生成美的集团网格并暂停加仓');
  assert.equal(pausedByUser.actions[0].buyPaused, true, 'an explicit user pause request remains actionable after repricing');
  data.stockPlan.stocks[0].code = '601288'; data.stockPlan.stocks[0].name = '农业银行';
  data.research!.stocks[0].code = '601288'; data.research!.stocks[0].name = '农业银行';
  assert.deepEqual((await run('重新生成农行网格计划')).actions.map(action => action.code), ['601288']);
  assert.equal((await run('重新生成美的和农行的网格计划')).actions.length, 2);
  assert.equal((await run('不要重新生成计划，先解释美的的估值')).actions.length, 0);
  for (const question of ['不要计算美的集团价格，只复核风险', '别估算美的集团价格', '无需给出美的集团价格', '不用给个美的集团价格', '不需要提供美的集团价格',
    'Do not calculate 美的集团 price; review risk only', "Don't estimate 美的集团 price; review risk only"]) {
    const review = await run(question);
    assert.equal(review.actions.length, 0, question);
  }
  assert.equal((await run('重新生成中国石油网格计划')).actions.length, 0);
  data.stockPlan.stocks[1].sellGrid = [{ yieldBps: 100, portionBps: 10000, priceMinor: 100 } as typeof data.stockPlan.stocks[1]['sellGrid'][number]];
  const crossing = await run('重新生成美的集团的网格计划');
  assert.equal(crossing.actions.length, 1);
  assert.equal(crossing.actions[0].sellLevels?.length, 4);
  assert.ok(crossing.actions[0].sellLevels!.every(level => level.priceMinor! > Math.max(...pricing.grid.map(row => row.priceMinor))));
  assert.match(crossing.localAnswer, /卖出四档/);
  assert.ok(crossing.localAnswer.includes(`${(pricing.theoreticalPriceMinor! / 100).toFixed(2)}元`));
  assert.ok(crossing.localAnswer.includes(pricing.grid.map(level => (level.priceMinor / 100).toFixed(2)).join('／')));
  assert.match(crossing.localAnswer, /同时替换两侧/);
  data.stockPlan.stocks[1].sellGrid = [];
  data.research!.stocks[1].technical!.state = 'accelerating_down';
  const modelDraft = { id: 'long-reason', code: '000333', buyPaused: false, reason: '复核'.repeat(995), buyLevels: all.actions[0].buyLevels };
  const merged = await askDividendAdvisorWithActions(config(), data, '复核', [], { transport: async () => ({ status: 200,
    data: response('openai', `已复核。\n\`\`\`fortuna-actions\n${JSON.stringify([modelDraft])}\n\`\`\``) }) });
  const { isDividendPlanProposal } = await import('../src/lib/dividendAdvisorActions.ts');
  assert.deepEqual(merged.actions, [], 'provider drafts and their long reasons cannot originate an adjustment');
  const localDraft = await run('重新生成美的集团网格计划');
  assert.equal(localDraft.actions[0].buyLevels?.length, 4);
  assert.equal(isDividendPlanProposal(localDraft.actions[0]), true);
  assert.doesNotMatch(localDraft.actions[0].reason, /复核复核复核/);

  // Regression: when the saved grid ALREADY matches the newly calculated grid, suppress the proposal card completely!
  const plan = dividendPricingPlan(pricing)!;
  const identicalData = buildDividendAdvisorContext({
    stocks: [{ ...stock, code: '000333', name: '美的集团', buyLevels: plan.buyLevels, sellLevels: plan.sellLevels }],
    strategy: 'stocks', budgetMinor: 10000_00, budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(),
    research: { generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [],
      stocks: [{ code: '000333', name: '美的集团', checks: [], status: 'pass', sources: [], issues: [], pricing }] },
  }, now);
  let unchangedPayload = '';
  const noOp = await askDividendAdvisorWithActions(config(), identicalData, '重新生成美的集团网格计划', [], {
    transport: async request => { unchangedPayload = JSON.stringify(request.body); return { status: 200, data: response('openai', '美的集团当前已保存的网格已与最新计算一致，无需更新。') }; },
  });
  assert.deepEqual(noOp.actions, [], 'identical recalculated grid must not emit a redundant proposal card');
  assert.match(unchangedPayload, /完全一致/);
  const noOpOffline = await askDividendAdvisorWithActions(null, identicalData, '重新生成美的集团网格计划');
  assert.deepEqual(noOpOffline.actions, []);
  assert.match(noOpOffline.answer, /已与最新核验计算结果一致/);
});

test('pricing questions use verified recent batches, selected tax and directional rounding without automatic financial pauses', async () => {
  const { calculateDividendPricing, defaultDividendPricingMethod } = await import('../src/lib/dividendPricing.ts');
  const pricing = calculateDividendPricing({ code: stock.code, name: stock.name, financialSector: false, method: defaultDividendPricingMethod(),
    asOf: '2026-10-16', priceMinor: 1000, priceDate: '2026-10-16', dividendBase: dividendBase(),
    treasury: { yieldBps: 200, asOf: '2026-10-16', fetchedAt: now, history: [], sourceUrl: 'https://example.com/treasury' },
    annuals: Array.from({ length: 5 }, (_, i) => ({ year: 2025 - i, reportDate: `${2025 - i}-12-31`, noticeDate: `${2026 - i}-03-20`,
      epsMicros: 1000000, adjustedEpsMicros: 1000000, dividendMicros: 500000, payoutBps: i === 0 ? 10021 : 5000, fcfCoverageBps: i === 0 ? 12664 : 20000 })) });
  const data = buildDividendAdvisorContext({ stocks: [stock], strategy: 'stocks', budgetMinor: 10000_00, budgetConfigured: true,
    positions: new Map(), fundPlan: defaultDividendFundPlan(), research: { generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [],
      stocks: [{ code: stock.code, name: stock.name, checks: [], status: 'risk', sources: [], issues: [], pricing }] } }, now);
  const result = await askDividendAdvisorWithActions(config(), data, '计算价格', [], { language: 'zh', transport: async () => ({ status: 200,
    data: response('openai', '已按最近核验分红计算四买四卖，注意 payout_above_100 和 fcf_below_150 风险提示。') }) });
  assert.equal(pricing.pricingBasis, 'recent_batches'); assert.equal(pricing.taxBps, 1000);
  assert.equal(pricing.d1Micros, 450000);
  assert.deepEqual(pricing.grid.map(level => level.priceMinor), [818, 782, 750, 692]);
  const plan = dividendPricingPlan(pricing); assert.ok(plan);
  assert.deepEqual(plan.sellLevels.map(level => level.priceMinor), [938, 1000, 1072, 1125]);
  assert.equal(result.actions.length, 1); assert.equal(result.actions[0].buyPaused, undefined);
  assert.deepEqual(result.actions[0].buyLevels?.map(level => level.priceMinor), pricing.grid.map(level => level.priceMinor));
  assert.deepEqual(result.actions[0].sellLevels?.map(level => level.priceMinor), plan.sellLevels.map(level => level.priceMinor));
  assert.match(result.localAnswer, /9\.00元/); assert.match(result.localAnswer, /风险提示/);
  assert.doesNotMatch(result.answer, /payout_above_100|fcf_below_150/);
  assert.doesNotMatch(result.actions[0].reason, /payout_above_100|fcf_below_150/);
  const resume = await askDividendAdvisorWithActions(config(), data, '复核', [], { language: 'zh', transport: async () => ({ status: 200,
    data: response('openai', `payout_above_100，暂时观察。\n\`\`\`fortuna-actions\n${JSON.stringify([{ id: 'resume', code: stock.code, reason: 'fcf_below_150', buyPaused: false }])}\n\`\`\``) }) });
  assert.deepEqual(resume.actions, []); assert.doesNotMatch(resume.answer, /payout_above_100/);
  const fabricated = await askDividendAdvisorWithActions(config(), data, '复核', [], { transport: async () => ({ status: 200,
    data: response('openai', `已复核。\n\`\`\`fortuna-actions\n${JSON.stringify([{ id: 'bad-grid-resume', code: stock.code, reason: 'resume', buyPaused: false,
      buyLevels: pricing.grid.map(level => ({ priceMinor: level.priceMinor + 100, yieldBps: level.yieldBps, portionBps: 2500 })) }])}\n\`\`\``) }) });
  assert.deepEqual(fabricated.actions, []);
});

for (const protocol of ['openai', 'gemini', 'anthropic'] as const) test(`${protocol} explicit pause produces a local preview while ignoring provider pause drafts`, async () => {
  const draft = { id: 'pause_bank_buy', code: stock.code, reason: '等待现金流覆盖改善后复核。', buyPaused: true };
  let calls = 0;
  const result = await askDividendAdvisorWithActions(config(protocol), context(), '暂停现有股票计划加仓', [], { transport: async () => {
    calls++;
    return { status: 200, data: response(protocol, `建议暂停现有计划加仓。\n\n\`\`\`json\n${JSON.stringify([draft])}\n\`\`\``) };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.actions, [{ ...draft, id: `pause-${stock.code}`, reason: '已准备暂停草案；预览并确认后才会修改计划。' }]);
  assert.equal(result.answer, '建议暂停现有计划加仓。');
  assert.doesNotMatch(result.answer, /pause_bank_buy|```/);
  const advisory = await askDividendAdvisorWithActions(config(protocol), context(), '复核计划', [], { transport: async () => ({ status: 200,
    data: response(protocol, `现金流风险。\n\n\`\`\`json\n${JSON.stringify([draft])}\n\`\`\``) }) });
  assert.deepEqual(advisory.actions, [], 'a provider cannot create an unsolicited pause action');
});

test('single-stock AI analysis (进一步请 AI 解读) invokes AI with focused research and emits zero grid proposals', async () => {
  const { dividendAiWorkspaceZh, dividendAiWorkspaceEn } = await import('../src/i18n/dividendAiWorkspaceTranslations.ts');
  const mideaPricing = calculateDividendPricing({
    code: '000333', name: '美的集团', financialSector: false, method: defaultDividendPricingMethod(),
    asOf: '2026-10-16', priceMinor: 7500, priceDate: '2026-10-16', dividendBase: verifiedDividendBase(4_300_000, '2026-10-16'),
    annuals: [],
  });
  const mideaPlan = dividendPricingPlan(mideaPricing)!;
  assert.deepEqual(mideaPlan.buyLevels.map(level => level.priceMinor), [7036, 6730, 6450, 5953]);
  assert.deepEqual(mideaPlan.sellLevels.map(level => level.priceMinor), [8063, 8600, 9215, 9675]);
  const mideaResearch = {
    generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [],
    stocks: [{ code: '000333', name: '美的集团', checks: [], status: 'pass' as const, sources: [], issues: [], pricing: mideaPricing }],
  };
  const data = buildDividendAdvisorContext({
    stocks: [{ ...stock, code: '000333', name: '美的集团', buyLevels: mideaPlan.buyLevels, sellLevels: mideaPlan.sellLevels,
      quote: { priceMinor: 7500, date: '2026-10-16 14:30', fetchedAt: now } }],
    strategy: 'stocks', budgetMinor: 99000_00, budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(),
    research: mideaResearch,
  }, now);
  for (const [language, template] of [
    ['zh', dividendAiWorkspaceZh.div_ai_discuss_stock_question],
    ['en', dividendAiWorkspaceEn.div_ai_discuss_stock_question],
  ] as const) {
    const prompt = template.replace('{{name}}', '美的集团').replace('{{code}}', '000333');
    let calls = 0;
    let body = '';
    const result = await askDividendAdvisorWithActions(config(), data, prompt, [], {
      language,
      explanationResearch: mideaResearch,
      transport: async request => {
        calls++;
        body = JSON.stringify(request.body);
        return { status: 200, data: response('openai', '## 美的集团深度解读\n\n当前现价 75.00 元，高于买一档 70.36 元，暂无触发。') };
      },
    });
    assert.equal(calls, 1, `single-stock AI analysis must call provider (${language})`);
    assert.match(body, /Focused stock research card/);
    assert.equal(result.explanationStatus, 'complete');
    assert.deepEqual(result.actions, [], `single-stock AI analysis must never pop up a grid adjustment card (${language})`);
    assert.match(result.answer, /美的集团深度解读/);
  }
});

test('unconfigured and failed AI calls report explicit connection reasons without dumping local check walls', async () => {
  const data = context();
  const unconfigured = await askDividendAdvisorWithActions(null, data, '我的预算分配和已记录仓位，有哪些需要注意？', [], { language: 'zh' });
  assert.equal(unconfigured.explanationStatus, 'unconfigured');
  assert.equal(unconfigured.errorCode, 'CONFIG');
  assert.deepEqual(unconfigured.actions, []);
  assert.match(unconfigured.answer, /尚未配置 AI/);
  assert.doesNotMatch(unconfigured.answer, /操作建议已按确定性检查限制|选股资格|价格依据|本地检查/);

  for (const [label, transport, expectedCode, expectedStatus, expectedMatch] of [
    ['auth 401', async () => ({ status: 401, data: JSON.stringify({ error: { code: 'invalid_api_key', message: 'Invalid key private-secret-123' } }) }), 'AUTH', 401, /HTTP 401|认证失败/],
    ['rate 429', async () => ({ status: 429, data: JSON.stringify({ error: { type: 'rate_limit_error', message: 'Too many requests' } }) }), 'RATE_LIMIT', 429, /HTTP 429|请求受限/],
    ['http 404', async () => ({ status: 404, data: JSON.stringify({ error: { code: 'model_not_found', message: 'Model does not exist' } }) }), 'HTTP', 404, /HTTP 404.*model_not_found/],
    ['network', async () => { throw new Error('ECONNREFUSED private-secret-123'); }, 'NETWORK', undefined, /网络异常|无法连接/],
    ['timeout', async () => new Promise<never>(() => {}), 'TIMEOUT', undefined, /超时/],
    ['empty response', async () => ({ status: 200, data: response('openai', '') }), 'RESPONSE', undefined, /可用回答|为空/],
  ] as const) {
    const failed = await askDividendAdvisorWithActions(config(), data, '今天做什么？', [], {
      language: 'zh', timeoutMs: 10, transport,
    });
    assert.equal(failed.explanationStatus, 'unavailable', label);
    assert.equal(failed.errorCode, expectedCode, label);
    assert.equal(failed.httpStatus, expectedStatus, label);
    assert.match(failed.answer, expectedMatch, label);
    assert.doesNotMatch(failed.answer, /private-secret-123|操作建议已按确定性检查限制|选股资格|### 本地检查/, label);
    assert.deepEqual(failed.actions, [], label);
  }
});

test('the method prompt preserves verified recent batches, directional rounding and provisional saved-grid states', () => {
  const prompt = dividendAdvisorSystemPrompt('zh');
  assert.match(prompt, /latest announced reporting period only/);
  assert.match(prompt, /upcoming announcements replace their corresponding historical seasonal estimate/);
  assert.match(prompt, /exact prior-year same-reporting-period implemented amount as a labelled estimate/);
  assert.match(prompt, /Never double an interim amount/);
  assert.match(prompt, /Do not append generic investment-risk statements/);
  assert.match(prompt, /latest TWO distinct implemented batches for a confirmed semiannual payer, or latest ONE for an annual payer/);
  assert.match(prompt, /official announcement verification/);
  assert.match(prompt, /Source conflicts and unverified selected batches block a new price draft/);
  assert.match(prompt, /Announced but unimplemented proposals are forward references only/);
  assert.match(prompt, /Never use a rolling twelve-month window/);
  assert.match(prompt, /EPS × payout is a cross-check: a deviation over 25%/);
  assert.match(prompt, /selected tax once \(default 10%; options 20%, 10%, 0%\)/);
  assert.match(prompt, /distinguish pretax and after-tax prices/);
  assert.match(prompt, /buy yields 5\.5%, 5\.75%, 6%, 6\.5% and sell yields 4\.8%, 4\.5%, 4\.2%, 4%, each level 25%/);
  assert.match(prompt, /Buy prices round DOWN to cents; sell prices round UP/);
  assert.match(prompt, /5% neutral reference.*not intrinsic fair value/);
  assert.match(prompt, /base change over 10%, a later ex-date or changed parameters prompts regeneration review; never automatically replace prices/);
  assert.match(prompt, /incomplete or conflicting but a saved explicit grid exists.*provisional: '按已保存网格：触发／未触发（基数未核对）'/);
  assert.match(prompt, /If no saved grid exists and the new base cannot be verified, say '无法判断'/);
  assert.match(prompt, /Missing quotes prevent current trigger claims/);
  assert.match(prompt, /EXACT four calculated explicit priceMinor\/yieldBps pairs with portionBps 2500 each/);
  assert.doesNotMatch(prompt, /highest available valid yield|EXACTLY THREE buy/);
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
