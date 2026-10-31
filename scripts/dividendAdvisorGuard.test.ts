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
  const result = await askDividendAdvisorWithActions(config, data, question, [], { language,
    transport: async request => {
      assert.equal(request.url, 'http://localhost:11434/v1/chat/completions');
      return { status: 200, data: { choices: [{ message: { content: answer } }] } };
    } });
  assert.deepEqual(await state(), before, 'answer and draft generation must not write any ledger table');
  assert.deepEqual(data, input, 'checks and saved input must remain unchanged');
  return result;
}
beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await initializeSettings();
  await db.dividendStocks.add(stock);
});
after(() => db.close());

for (const [language, questions, dangerous] of [
  ['zh', ['今天怎么操作？', '重新生成基金计划并告诉我今天怎么操作？'], '今天已到价，请立即新增买入100份。'],
  ['en', ['What should I do today?', 'Regenerate the fund plan and tell me what to do today.'], 'The target is met today. Buy 100 units immediately.'],
] as const) for (const question of questions) test(`manual-only fund cannot bypass action ownership: ${question}`, async () => {
  const data = fundContext();
  assert.equal(data.fundPlan.funds[0].checkSummary.trigger.buy, 'unknown');
  const result = await ask(data, question, dangerous, language);
  assert.ok(!result.answer.includes(dangerous));
  assert.match(result.answer, language === 'zh' ? /手工参考|未知|待核实/ : /manual reference|Unknown|Unverified/);
  assert.deepEqual(result.actions, []);
});

for (const question of ['更新价格并告诉我今天怎么买？', '重新生成中国石油网格并告诉我今天怎么买？',
  'Update the price and tell me what to buy today.', 'Regenerate the 600000 plan and tell me what to buy today.']) {
  test(`unmatched regeneration still obeys the paused stock check: ${question}`, async () => {
    const result = await ask(stockContext(), question, '今天已经满足全部条件，立即新增买入100股。');
    assert.doesNotMatch(result.answer, /已经满足全部条件|立即新增买入100股/);
    assert.match(result.answer, /手动暂停/); assert.deepEqual(result.actions, []);
  });
}

for (const [language, question] of [['zh', '重新生成工商银行网格并告诉我今天怎么买？'],
  ['en', 'Regenerate the 工商银行 grid and tell me what to buy today.']] as const) {
  test(`actual verified price preview and operation conclusion coexist (${language})`, async () => {
    const data = stockContext(true), before = await state();
    const result = await ask(data, question, 'Buy 100 shares immediately. 全部买入条件已经通过。', language);
    assert.doesNotMatch(result.answer, /Buy 100 shares immediately|全部买入条件已经通过/);
    assert.match(result.answer, language === 'zh' ? /买入四档/ : /Fixed-yield buy levels/);
    assert.match(result.answer, language === 'zh' ? /手动暂停/ : /manually paused/);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].buyPaused, undefined, 'repricing preserves the saved pause');
    assert.equal(result.actions[0].buyLevels?.length, 4); assert.equal(result.actions[0].sellLevels?.length, 4);
    const preview = await previewDividendPlanChange(result.actions[0]);
    assert.equal(preview.after.buyPaused, true);
    assert.deepEqual(preview.after.buyLevels, result.actions[0].buyLevels);
    assert.deepEqual(await state(), before, 'opening the legal paired-price preview remains read-only');
  });
}

for (const [language, question, answer] of [
  ['zh', '什么是股息率？', '股息率是每股现金分红除以股价的比值。'],
  ['en', 'What is dividend yield?', 'Dividend yield is cash dividends per share divided by the share price.'],
] as const) test(`standalone ordinary concept explanation remains useful (${language})`, async () => {
  const result = await ask(stockContext(), question, answer, language);
  assert.match(result.answer, language === 'zh' ? /股息率是每股现金分红除以股价/ : /Dividend yield is cash dividends per share divided by the share price/);
  assert.doesNotMatch(result.answer, /操作建议已按确定性检查限制|Action advice has been limited/);
  assert.deepEqual(result.actions, []);
});

for (const [language, question, answer] of [
  ['zh', '什么是股息率？顺便告诉我今天怎么买。', '股息率是每股现金分红除以股价。现在可以上车了。'],
  ['en', 'What is dividend yield and what should I do today?', 'Dividend yield is a ratio. Go all in today.'],
  ['zh', '什么是股息率？', '股息率是每股现金分红除以股价。现在可以上车了。'],
  ['en', 'What is dividend yield?', 'Dividend yield is a ratio. Go for it.'],
  ['zh', '解释网格的概念', '网格是分批价格计划；这只可以抄底，先接100股。'],
  ['en', 'Explain the concept of a grid', 'A grid is a set of levels, and this fund is ready to top up.'],
] as const) test(`mixed concept or colloquial operation never inherits an explanation exemption: ${answer}`, async () => {
  const result = await ask(stockContext(), question, answer, language);
  assert.ok(!result.answer.includes(answer));
  assert.doesNotMatch(result.answer, /现在可以上车|Go for it|可以抄底|ready to top up/);
});

for (const [language, answer] of [['zh', '股息率是赶紧冲，闭眼拿。'], ['en', 'A dividend yield is a signal to start accumulating.']] as const) {
  test(`a definition-shaped instruction cannot bypass deterministic concept content (${language})`, async () => {
    const result = await ask(stockContext(), language === 'zh' ? '什么是股息率？' : 'What is dividend yield?', answer, language);
    assert.ok(!result.answer.includes(answer));
    assert.match(result.answer, language === 'zh' ? /不代表已经满足买入条件/ : /does not establish.*buying readiness/);
  });
}

test('unknown concept labels cannot pass provider action prose through', async () => {
  const result = await ask(stockContext(), '什么是一个未知概念？', '一个未知概念是赶紧冲，闭眼拿。');
  assert.doesNotMatch(result.answer, /赶紧冲|闭眼拿/);
  assert.match(result.answer, /这个概念尚未提供已核对的解释/);
});

for (const [question, language, expected] of [
  ['解释一下股息率', 'zh', /股息率是每股现金分红/], ['解释网格公式', 'zh', /四档买入、四档卖出/],
  ['解释持有期税率', 'zh', /默认1个月至1年为10%/], ['What is both/either?', 'en', /Fund entry follows the saved both\/either rule/],
] as const) test(`normal app concept routing is retained: ${question}`, async () => {
  const result = await ask(stockContext(), question, '股息率是赶紧冲，闭眼拿。', language);
  assert.match(result.answer, expected); assert.doesNotMatch(result.answer, /赶紧冲|闭眼拿/);
});

test('an apparently ready check still requires deterministic manual confirmation, including sell prose', async () => {
  const data = stockContext();
  data.stockPlan.stocks[0].checkSummary.actionCheck.buy.status = 'confirmation_candidate';
  data.stockPlan.stocks[0].checkSummary.actionCheck.buy.requiresUserConfirmation = true;
  const result = await ask(data, '今天怎么操作？', '立即新增买入100股，同时卖出100股。');
  assert.doesNotMatch(result.answer, /立即新增买入100股|同时卖出100股/);
  assert.match(result.answer, /进入人工确认/); assert.match(result.answer, /没有可用于此计划的已知持仓/);
});

test('pause preview reasons cannot retain a contradictory model trading instruction', async () => {
  const draft = { id: 'pause', code: stock.code, reason: '立即新增买入100股，然后再暂停。', buyPaused: true };
  const result = await ask(stockContext(), '暂停现有计划加仓', `立即新增买入100股。\n\n\`\`\`fortuna-actions\n${JSON.stringify([draft])}\n\`\`\``);
  assert.equal(result.actions.length, 1); assert.equal(result.actions[0].buyPaused, true);
  assert.doesNotMatch(JSON.stringify(result), /立即新增买入100股/);
  assert.match(result.actions[0].reason, /预览并确认后/);
});

test('verified model price drafts rebuild their visible reason from deterministic preview guidance', async () => {
  const data = stockContext(true), plan = dividendPricingPlan(data.research!.stocks[0].pricing!)!;
  const draft = { id: 'prices', code: stock.code, reason: 'All conditions passed; buy 100 shares now.', ...plan };
  const result = await ask(data, '复核计划', `All conditions passed; buy 100 shares now.\n\n\`\`\`fortuna-actions\n${JSON.stringify([draft])}\n\`\`\``);
  assert.equal(result.actions.length, 1); assert.deepEqual(result.actions[0].buyLevels, plan.buyLevels);
  assert.doesNotMatch(JSON.stringify(result), /All conditions passed|buy 100 shares now/);
  assert.match(result.actions[0].reason, /只有明确确认才替换计划/);
});

for (const [question, language, expected] of [
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
] as const) test(`ordinary concept variants retain checked explanations: ${question}`, async () => {
  const result = await ask(stockContext(), question, '股息率是赶紧冲，闭眼拿。', language);
  assert.match(result.answer, expected); assert.doesNotMatch(result.answer, /赶紧冲|闭眼拿/);
  assert.doesNotMatch(result.answer, /这个概念尚未提供已核对的解释|A checked explanation for this topic is not available/);
  assert.deepEqual(result.actions, []);
});

for (const [language, question] of [['zh', '如何恢复工商银行网格？'], ['en', 'How do I resume the 工商银行 grid?']] as const) {
  test(`resume questions retain the deterministic review and confirmation route (${language})`, async () => {
    const before = await state();
    const result = await ask(stockContext(), question, '已经恢复，可以立即新增买入100股。', language);
    assert.match(result.answer, language === 'zh' ? /选股检查.*新的经营、价格与技术复核.*阅读风险与待补充项后预览并确认/ : /Stock Checks, read the risks and missing evidence, then preview and confirm/);
    assert.match(result.answer, language === 'zh' ? /不要求全部通过/ : /Alerts do not need to all pass/);
    assert.match(result.answer, language === 'zh' ? /你已手动暂停新增买入/ : /You manually paused new buying/);
    assert.doesNotMatch(result.answer, /已经恢复|可以立即新增买入100股/);
    assert.deepEqual(result.actions, []); assert.deepEqual(await state(), before);
    assert.equal((await db.dividendStocks.get(stock.code))?.buyPaused, true);
  });
}
