import 'fake-indexeddb/auto';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { buildDividendAdvisorContext, type DividendAdvisorContext } from '../src/lib/dividendAdvisor.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { defaultDividendSelectionPrinciples } from '../src/lib/dividendResearch.ts';
import { calculateDividendPricing, defaultDividendPricingMethod } from '../src/lib/dividendPricing.ts';
import { dividendPricingPlan } from '../src/lib/dividendPricingPlan.ts';
import type { DividendStock } from '../src/lib/dividendWorkbench.ts';
import { askDividendAdvisorWithActions, type DividendAdvisorConfig } from '../src/services/dividendAdvisorService.ts';
import { verifiedDividendBase } from './helpers/dividendPricingFixture.ts';

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
const { previewDividendPlanChange } = await import('../src/services/dividendAdvisorActionsService.ts');
const now = Date.parse('2026-10-31T03:00:00Z');
const config: DividendAdvisorConfig = { protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'local-guard-stub', apiKey: 'fixture-secret' };
const stock: DividendStock = { code: '601398', name: '工商银行', group: 'core', weightBps: 10000,
  shareMode: 'manual', manualShares: 0, lotSize: 100, buyPaused: true,
  quote: { priceMinor: 700, date: '2026-10-31 10:00', fetchedAt: now },
  buyLevels: [{ priceMinor: 1000, yieldBps: 550, portionBps: 10000 }],
  sellLevels: [{ priceMinor: 1200, yieldBps: 450, portionBps: 10000 }] };
function stockContext(verified = false) {
  const method = defaultDividendPricingMethod();
  const pricing = verified ? calculateDividendPricing({ code: stock.code, name: stock.name, financialSector: true,
    method, asOf: '2026-10-31', annuals: [], dividendBase: verifiedDividendBase(500000, '2026-10-31') }) : undefined;
  return buildDividendAdvisorContext({ stocks: [stock], strategy: 'stocks', budgetMinor: 1000000, budgetConfigured: true,
    positions: new Map(), fundPlan: defaultDividendFundPlan(), research: pricing ? { generatedAt: now,
      pricingMethod: method, principles: defaultDividendSelectionPrinciples(), indices: [],
      stocks: [{ code: stock.code, name: stock.name, checks: [], status: 'unknown', sources: [], issues: [], pricing }] } : undefined }, now);
}
function fundContext() {
  return buildDividendAdvisorContext({ stocks: [], strategy: 'funds', budgetMinor: 0, budgetConfigured: false, positions: new Map(),
    fundPositions: new Map([['512890', 500]]), fundPlan: { ...defaultDividendFundPlan(), budgetMinor: 1000000, mode: 'swing',
      funds: [{ id: 'fund-stub', code: '512890', name: '模拟红利基金', indexKind: 'low_volatility', weightBps: 10000,
        reference: { priceMicros: 900000, highMicros: 1000000, indexYieldBps: 600, asOf: '2026-10-31' } }] } }, now);
}
async function state() { return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))); }
async function ask(data: DividendAdvisorContext, question: string, answer: string, language = 'zh') {
  const before = await state(), input = structuredClone(data);
  let called = 0;
  let lastPayload = '';
  const result = await askDividendAdvisorWithActions(config, data, question, [], { language,
    transport: async request => {
      called++;
      lastPayload = JSON.stringify(request.body);
      assert.equal(request.url, 'http://localhost:11434/v1/chat/completions');
      return { status: 200, data: { choices: [{ message: { content: answer } }] } };
    } });
  assert.deepEqual(await state(), before, 'answer and draft generation must not write any ledger table');
  assert.deepEqual(data, input, 'checks and saved input must remain unchanged');
  return { result, called, lastPayload };
}
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.dividendStocks.add(stock);
});
after(() => db.close());

for (const [language, questions, aiAnswer] of [
  ['zh', ['今天怎么操作？', '重新生成基金计划并告诉我今天怎么操作？'], '该基金当前只有手工参考价，缺少当日行情，建议先核实最新报价。'],
  ['en', ['What should I do today?', 'Regenerate the fund plan and tell me what to do today.'], 'Only a manual reference price is recorded for this fund; verify a current exchange quote first.'],
] as const) for (const question of questions) test(`fund questions send authoritative context to AI and emit no stock actions: ${question}`, async () => {
  const data = fundContext();
  assert.equal(data.fundPlan.funds[0].checkSummary.trigger.buy, 'unknown');
  const { result, called, lastPayload } = await ask(data, question, aiAnswer, language);
  assert.equal(called, 1);
  assert.match(lastPayload, /Manual reference price in CNY/);
  assert.equal(result.answer, aiAnswer);
  assert.deepEqual(result.actions, []);
});

for (const question of ['更新价格并告诉我今天怎么买？', '重新生成中国石油网格并告诉我今天怎么买？',
  'Update the price and tell me what to buy today.', 'Regenerate the 600000 plan and tell me what to buy today.']) {
  test(`unmatched regeneration emits no grid action and still calls AI cleanly: ${question}`, async () => {
    const { result, called } = await ask(stockContext(), question, '未匹配到可重算的标的价格，且工商银行当前已手动暂停买入。');
    assert.equal(called, 1);
    assert.equal(result.explanationStatus, 'complete');
    assert.deepEqual(result.actions, []);
  });
}

for (const [language, question] of [['zh', '重新生成工商银行网格并告诉我今天怎么买？'],
  ['en', 'Regenerate the 工商银行 grid and tell me what to buy today.']] as const) {
  test(`explicit verified repricing attaches deterministic paired levels while preserving manual pause (${language})`, async () => {
    const data = stockContext(true), before = await state();
    const { result, called } = await ask(data, question, language === 'zh' ? '已按最近核验分红重算四买四卖，当前仍保持手动暂停状态。' : 'Recalculated four buy and four sell levels while keeping the manual pause intact.', language);
    assert.equal(called, 1);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].buyPaused, undefined, 'repricing preserves the saved pause');
    assert.equal(result.actions[0].buyLevels?.length, 4); assert.equal(result.actions[0].sellLevels?.length, 4);
    const preview = await previewDividendPlanChange(result.actions[0]);
    assert.equal(preview.after.buyPaused, true);
    assert.deepEqual(preview.after.buyLevels, result.actions[0].buyLevels);
    assert.deepEqual(await state(), before, 'opening the legal paired-price preview remains read-only');
  });
}

test('pause preview reasons stay deterministic and never inherit untrusted model text or emit no-op pauses', async () => {
  const unpaused = buildDividendAdvisorContext({ stocks: [{ ...stock, buyPaused: false }], strategy: 'stocks', budgetMinor: 1000000, budgetConfigured: true,
    positions: new Map(), fundPlan: defaultDividendFundPlan() }, now);
  const draft = { id: 'pause', code: stock.code, reason: '立即新增买入100股，然后再暂停。', buyPaused: true };
  const { result } = await ask(unpaused, '暂停现有计划加仓', `已准备暂停。\n\n\`\`\`fortuna-actions\n${JSON.stringify([draft])}\n\`\`\``);
  assert.equal(result.actions.length, 1); assert.equal(result.actions[0].buyPaused, true);
  assert.doesNotMatch(JSON.stringify(result.actions), /立即新增买入100股/);
  assert.match(result.actions[0].reason, /预览并确认后/);

  // Already paused stock must NOT receive a redundant no-op pause proposal!
  const alreadyPaused = await ask(stockContext(), '暂停现有计划加仓', '该股当前已经是暂停状态。');
  assert.deepEqual(alreadyPaused.result.actions, []);
});

test('untrusted provider drafts cannot originate an action; explicit local repricing retains safe preview reasons', async () => {
  const data = stockContext(true), plan = dividendPricingPlan(data.research!.stocks[0].pricing!)!;
  const draft = { id: 'prices', code: stock.code, reason: 'All conditions passed; buy 100 shares now.', ...plan };
  const { result } = await ask(data, '复核计划', `已完成复核。\n\n\`\`\`fortuna-actions\n${JSON.stringify([draft])}\n\`\`\``);
  assert.deepEqual(result.actions, [], 'only the explicit local repricing request can originate a draft');
  assert.doesNotMatch(result.answer, /fortuna-actions|All conditions passed/);

  const { result: requested } = await ask(data, '重新生成工商银行的网格计划', `已重算网格。\n\n\`\`\`fortuna-actions\n${JSON.stringify([draft])}\n\`\`\``);
  assert.equal(requested.actions.length, 1); assert.deepEqual(requested.actions[0].buyLevels, plan.buyLevels);
  assert.doesNotMatch(requested.actions[0].reason, /All conditions passed|buy 100 shares now/);
  assert.match(requested.actions[0].reason, /重算|保留当前手动暂停/);
});

for (const [question, language, expected] of [
  ['什么是股息率？', 'zh', /股息率是每股现金分红/],
  ['股息率是什么意思？', 'zh', /股息率是每股现金分红/],
  ['能解释一下股息率吗？', 'zh', /股息率是每股现金分红/],
  ['请问能解释一下股息率吗？', 'zh', /股息率是每股现金分红/],
  ['Explain dividend yield in simple terms.', 'en', /Dividend yield is cash dividends per share/],
  ['What does dividend yield mean?', 'en', /Dividend yield is cash dividends per share/],
  ['解释一下PB', 'zh', /PB是市净率/],
  ['市净率是什么意思？', 'zh', /股价除以每股净资产/],
  ['Explain the price-to-book ratio in plain English.', 'en', /PB is the price-to-book ratio/],
  ['PE是什么？', 'zh', /PE是市盈率/],
  ['Explain PE briefly.', 'en', /PE is the price-to-earnings ratio/],
  ['每股收益是什么意思？', 'zh', /EPS是每股收益/],
  ['What is EPS?', 'en', /EPS is earnings per share/],
  ['能解释一下安全边际吗？', 'zh', /不另加安全边际折价/],
  ['Explain margin of safety in simple terms.', 'en', /A margin of safety is the buffer/],
  ['解释一下股息率', 'zh', /股息率是每股现金分红/],
  ['解释网格公式', 'zh', /四档买入、四档卖出/],
  ['解释持有期税率', 'zh', /默认1个月至1年为10%/],
  ['What is both/either?', 'en', /Fund entry follows the saved both\/either rule/],
] as const) test(`offline built-in concept variants remain concise and helpful: ${question}`, async () => {
  const result = await askDividendAdvisorWithActions(null, stockContext(), question, [], { language });
  assert.match(result.answer, expected);
  assert.equal(result.explanationStatus, 'not_needed');
  assert.deepEqual(result.actions, []);
});

for (const [language, question] of [['zh', '如何恢复工商银行网格？'], ['en', 'How do I resume the 工商银行 grid?']] as const) {
  test(`resume questions pass the deterministic review route to AI and never emit a resume action (${language})`, async () => {
    const before = await state();
    const { result, called, lastPayload } = await ask(stockContext(), question, language === 'zh' ? '请在选股检查中完成最新复核并确认恢复。' : 'Run a fresh review in Stock Checks and confirm resuming there.', language);
    assert.equal(called, 1);
    assert.match(lastPayload, language === 'zh' ? /选股检查.*新的经营、价格与技术复核/ : /Stock Checks, read the risks and missing evidence/);
    assert.deepEqual(result.actions, []); assert.deepEqual(await state(), before);
    assert.equal((await db.dividendStocks.get(stock.code))?.buyPaused, true);
  });
}
