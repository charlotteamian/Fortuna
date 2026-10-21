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
});

test('the method prompt distinguishes single-period dividends, holding-year events and sustainable valuation D1', () => {
  const prompt = dividendAdvisorSystemPrompt('zh');
  assert.match(prompt, /latest announced reporting period only/);
  assert.match(prompt, /upcoming announcements replace their corresponding historical seasonal estimate/);
  assert.match(prompt, /Do not multiply D1 by growth again/);
  assert.match(prompt, /Do not append generic investment-risk statements/);
  assert.match(prompt, /More than 100 basis points between anchors requires a user decision/);
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
