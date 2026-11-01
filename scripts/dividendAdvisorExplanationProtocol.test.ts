import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDividendAdvisorContext } from '../src/lib/dividendAdvisor.ts';
import { defaultDividendFundPlan } from '../src/lib/dividendFundPlan.ts';
import { defaultDividendSelectionPrinciples } from '../src/lib/dividendResearch.ts';
import { buildDividendExplanationFacts, dividendExplanationPrompt, renderDividendExplanation, type DividendExplanationFact } from '../src/lib/dividendAdvisorExplanation.ts';

const now = Date.parse('2026-10-31T03:00:00Z');
const context = () => {
  const result = buildDividendAdvisorContext({ stocks: [{ code: '601398', name: '模拟银行', group: 'core', weightBps: 10000,
    shareMode: 'manual', manualShares: 100, lotSize: 100, buyPaused: true }], strategy: 'stocks', budgetMinor: 1000000,
    budgetConfigured: true, positions: new Map(), fundPlan: defaultDividendFundPlan(), research: {
      generatedAt: now, principles: defaultDividendSelectionPrinciples(), indices: [], stocks: [{ code: '601398', name: '模拟银行',
        checks: [{ rule: 'roe', status: 'unknown', reason: 'missing', period: '2026-06-30' }], status: 'unknown', sources: [], issues: [],
        financial: { name: '模拟银行', sector: 'bank', financialSector: true,
          periods: [{ reportDate: '2026-06-30', roeBps: 600, loss: false }], latest: { reportDate: '2026-06-30', roeBps: 600, loss: false } },
      }],
    } }, now);
  result.stockPlan.stocks[0].checkSummary.eligibility.checks = [{ rule: 'roe', status: 'unknown', reason: 'missing', period: '2026-06-30' }];
  return result;
};
const envelope = (blocks: unknown[]) => JSON.stringify({ version: 1, blocks });
const facts = (): DividendExplanationFact[] => buildDividendExplanationFacts(context());

test('the fact manifest contains exact existing ROE gaps and preserves context without pretending financial evidence was verified', () => {
  const data = context(), before = structuredClone(data), result = buildDividendExplanationFacts(data);
  const roe = result.find(fact => fact.id === 'stock:601398:check:roe');
  assert.ok(roe); assert.equal(roe.kind, 'check'); assert.match(roe.text, /待核实/); assert.match(roe.text, /缺少可核对资料/);
  const basis = result.find(fact => fact.id === 'stock:601398:financial:roe_basis');
  assert.ok(basis); assert.match(basis.text, /2026-06-30/); assert.match(basis.text, /原值: 6%/);
  assert.match(basis.text, /季度累计ROE未提供已报告月数/); assert.match(basis.text, /未提供可核对的年化ROE/);
  assert.doesNotMatch(basis.text, /原文核验日|2026-10-31|已报告月数: 6/);
  assert.deepEqual(data, before);
});

test('relevant risk entries keep their own existing source and dates rather than inheriting another event', () => {
  const data = context(), risk = data.stockPlan.stocks[0].checkSummary.risk.evidenceInsufficient;
  risk.push({ id: 'special_dividend_review:synthetic', reason: 'special_dividend_review', sources: ['https://example.com/special-source'], reportPeriod: '2025-12-31', publishedAt: '2026-08-01',
    impact: 'new_buy', autoRepair: false, unresolvedAction: 'review' });
  const fact = buildDividendExplanationFacts(data).find(item => item.id.endsWith('risk:special_dividend_review:synthetic'));
  assert.ok(fact); assert.match(fact.text, /special-source/); assert.match(fact.text, /2026-08-01/); assert.doesNotMatch(fact.text, /原文核验日/);
});

for (const [language, text] of [
  ['zh', '自由现金流是经营产生的现金扣除必要长期资产投入后剩下的现金。账面利润与实际收付款的时间不同，因此它们不会总是相同。'],
  ['zh', '可以把自由现金流理解成经营收到的钱在扣掉必要设备投入后留下的余钱。这里说明现金口径，不判断任何证券是否值得持有。'],
  ['en', 'Free cash flow describes cash from operations after capital expenditure. It differs from accounting profit because cash receipts and payments can occur in different periods.'],
] as const) test(`general educational narrative is retained without a fixed concept dictionary (${language}): ${text}`, () => {
  assert.equal(renderDividendExplanation(envelope([{ type: 'concept', text }]), facts(), language), text);
});

test('an evidence explanation displays only the fact IDs supplied by local checks, including exact missing information', () => {
  const text = '缺少报告月数时，季度累计比率不能直接与年度门槛比较。先明确统计期间，才有可比口径。';
  const result = renderDividendExplanation(envelope([{ type: 'evidence', factIds: ['stock:601398:check:roe', 'stock:601398:financial:roe_basis'], text }]), facts());
  assert.ok(result); assert.match(result, /季度累计比率不能直接与年度门槛比较/); assert.match(result, /已有依据/);
  assert.match(result, /ROE.*待核实/); assert.match(result, /2026-06-30/); assert.match(result, /原值: 6%/);
});

test('generic mention of current missing evidence does not become an instrument-state claim', () => {
  const text = '当前资料缺少可比口径，因此无法进行可靠的年度比较。';
  assert.ok(renderDividendExplanation(envelope([{ type: 'evidence', factIds: ['stock:601398:financial:roe_basis'], text }]), facts()));
});

test('hypothetical yield arithmetic is calculated locally and clearly distinguished from actual security inputs', () => {
  const result = renderDividendExplanation(envelope([{ type: 'example', formula: 'cash_yield', inputs: [0.5, 10] }]), facts());
  assert.ok(result); assert.match(result, /假设例子（非真实证券资料）/); assert.match(result, /0.5÷10×100%＝5%/);
  assert.doesNotMatch(result, /模拟银行|601398/);
});

test('a free cash flow example is locally subtracted and supports a follow-up explanation without trade guidance', () => {
  const result = renderDividendExplanation(envelope([{ type: 'concept', text: '把经营收支后留下的钱再扣掉设备投入，就得到这个简化例子里的余钱。' },
    { type: 'example', formula: 'free_cash_flow', inputs: [100, 30] }]), facts());
  assert.ok(result); assert.match(result, /自由现金流＝100−30＝70元/);
});

for (const payload of [
  '今天已到价，请立即新增买入100份。',
  '```json\n{"version":1,"blocks":[]}\n```',
  JSON.stringify({ version: 1, blocks: [{ type: 'concept', text: '自由现金流是经营现金扣除资本性支出。' }], actions: [] }),
  envelope([{ type: 'action', text: '继续操作。' }]),
  envelope([{ type: 'concept', text: '自由现金流是经营现金扣除资本性支出。', reason: '立即加仓' }]),
  envelope([{ type: 'evidence', factIds: ['invented-report-id'], text: '缺少口径时无法可靠比较。' }]),
  envelope([{ type: 'evidence', factIds: [], text: '缺少口径时无法可靠比较。' }]),
  envelope([{ type: 'example', formula: 'cash_yield', inputs: [0.5, 10], result: 99 }]),
  envelope([{ type: 'example', formula: 'cash_yield', inputs: [0.5, 0] }]),
  envelope([{ type: 'example', formula: 'cash_yield', inputs: [-0.5, 10] }]),
  envelope([{ type: 'example', formula: 'stock_price', inputs: [0.5, 0.05] }]),
] as const) test(`invalid structure, unknown references or provider-supplied calculations fail closed: ${payload}`, () => {
  assert.equal(renderDividendExplanation(payload, facts()), null);
});

for (const text of ['股息率是赶紧冲，闭眼拿。', '现在可以上车了。', '立即新增买入100份。', '立即新增买入一百份。', '直接买\u200b入。',
  'A dividend yield is a signal to start accumulating.', 'Go for it.', 'This fund is ready to top up.',
  'ROE为15%，已经通过全部条件。', '来源是https://example.com/new-report。', '该股已经满足全部条件。',
  '模拟银行的报告口径已经可靠。']) test(`unsafe or fabricated narrative rejects the whole explanation even after a safe opening: ${text}`, () => {
  assert.equal(renderDividendExplanation(envelope([{ type: 'concept', text: '自由现金流是现金口径指标。' }, { type: 'concept', text }]), facts()), null);
});

test('the prompt has an explanation-only schema, fact manifest and explicit hypothetical arithmetic boundary', () => {
  const prompt = dividendExplanationPrompt(facts(), 'en');
  assert.match(prompt, /plain English/); assert.match(prompt, /Do not emit actions, draft reasons/);
  assert.match(prompt, /stock:601398:financial:roe_basis/); assert.match(prompt, /hypothetical teaching inputs/);
});

test('malformed, empty, excessive and partial explanation envelopes never fall back to raw model prose', () => {
  for (const raw of ['', '{', JSON.stringify(null), '[]', envelope([]), envelope(Array(7).fill({ type: 'concept', text: '正常解释。' })),
    envelope([{ type: 'concept', text: '' }]), 'x'.repeat(18001)]) assert.equal(renderDividendExplanation(raw, facts()), null);
});

test('evidence mode retains a conditional ROE explanation and requires an actually cited relevant fact', () => {
  const text = '缺少可核对的完整年度财务口径时，这项指标不能用于可靠比较。季度累计数据不能直接充当全年结果。';
  const result = renderDividendExplanation(envelope([{ type: 'evidence', factIds: ['stock:601398:financial:roe_basis'], text }]), facts(), 'zh',
    { evidenceOnly: true, requiredFactIds: ['stock:601398:check:roe', 'stock:601398:financial:roe_basis'] });
  assert.ok(result); assert.ok(result.includes(text)); assert.match(result, /原值: 6%/);
  assert.equal(renderDividendExplanation(envelope([{ type: 'evidence', factIds: ['rule:roe'], text }]), facts(), 'zh',
    { evidenceOnly: true, requiredFactIds: ['stock:601398:financial:roe_basis'] }), null);
});

for (const text of ['所需财务资料齐备，规则已经符合，仓位可继续扩张。', '财务材料完备，核对门槛全部吻合。',
  '所有依据都到位，比较结果可采纳。', '信息不再缺失，结论无需复核。', '没有缺口，财务条件全部齐全。',
  '缺少报告时需要复核，所需资料齐备。', 'The available financial information is complete. The stated criteria are fulfilled.']) {
  test(`risk prose cannot turn an unknown fact into an unconditional claim: ${text}`, () => {
    assert.equal(renderDividendExplanation(envelope([{ type: 'evidence', factIds: ['stock:601398:check:roe'], text }]), facts(), 'zh',
      { evidenceOnly: true, requiredFactIds: ['stock:601398:check:roe'] }), null);
  });
}

test('an evidence citation cannot authorise an unrelated unconditional concept block in risk mode', () => {
  const safe = { type: 'evidence', factIds: ['stock:601398:check:roe'], text: '缺少可核对的资料时，无法进行可靠比较。' };
  assert.equal(renderDividendExplanation(envelope([safe, { type: 'concept', text: '财务材料完备，核对门槛全部吻合。' }]), facts(), 'zh',
    { evidenceOnly: true, requiredFactIds: ['stock:601398:check:roe'] }), null);
});

test('a risk follow-up may freely rephrase the comparison limit while retaining its supplied fact reference', () => {
  const text = '如果统计期间不同，就不能把两个比例直接对比。缺少统一口径时，需要先核对资料。';
  const result = renderDividendExplanation(envelope([{ type: 'evidence', factIds: ['stock:601398:financial:roe_basis'], text }]), facts(), 'zh',
    { evidenceOnly: true, requiredFactIds: ['stock:601398:financial:roe_basis'] });
  assert.ok(result); assert.ok(result.includes(text));
});

for (const text of ['资金配置可以随条件变化而改变。', '仓位可继续扩张。', 'An account can place an order.', 'Portfolio risk exposure remains flexible.']) {
  test(`operating entities have no model narration channel: ${text}`, () => {
    assert.equal(renderDividendExplanation(envelope([{ type: 'concept', text }]), facts()), null);
  });
}

test('discussion facts keep the supplied card snapshot separate from current saved execution facts', () => {
  const data = context(), card = structuredClone(data.research!);
  card.generatedAt = Date.parse('2026-10-30T03:00:00Z');
  card.stocks[0].checks = [{ rule: 'roe', status: 'unknown', reason: 'stale', period: '2026-09-30' }];
  card.stocks[0].financial!.latest = { reportDate: '2026-09-30', roeBps: 550, loss: false };
  card.stocks[0].sources = [{ kind: 'financial', provider: 'Eastmoney', url: 'https://example.com/card-only', asOf: '2026-09-30', fetchedAt: card.generatedAt }];
  const before = structuredClone(data), original = structuredClone(card);
  const result = buildDividendExplanationFacts(data, 'zh', card);
  assert.ok(result.filter(fact => fact.subject).every(fact => fact.subject === 'discussion:601398'));
  assert.match(result.find(fact => fact.id === 'discussion:601398:snapshot')!.text, /2026-10-30/);
  assert.match(result.find(fact => fact.id === 'discussion:601398:check:roe')!.text, /2026-09-30/);
  assert.match(result.find(fact => fact.id === 'discussion:601398:financial:roe_basis')!.text, /5.5%/);
  assert.doesNotMatch(result.find(fact => fact.id === 'discussion:601398:financial:roe_basis')!.text, /原值: 6%/);
  assert.match(result.find(fact => fact.id === 'discussion:601398:source:0')!.text, /card-only/);
  assert.deepEqual(data, before); assert.deepEqual(card, original);
});

test('an unsaved candidate has a dated discussion manifest without becoming an actionable saved plan', () => {
  const data = context(), card = structuredClone(data.research!);
  card.stocks[0].code = '600000'; card.stocks[0].name = '模拟候选';
  const result = buildDividendExplanationFacts(data, 'zh', card);
  assert.ok(result.some(fact => fact.id === 'discussion:600000:check:roe'));
  assert.ok(result.filter(fact => fact.subject).every(fact => fact.subject === 'discussion:600000'));
  assert.equal(data.stockPlan.stocks.some(stock => stock.code === '600000'), false);
});
